
import { NextResponse } from 'next/server';
import { stealthFetch } from '@/lib/stealthFetch';
import { collectionStatus, nowIso, sourceIdentity, updateSourceStatuses } from '@/lib/feed-integrity';

/**
 * OVERSEER — Flight Data API
 * Fetches real-time aircraft positions from adsb.lol (no API key required)
 * Covers 6 global regions for maximum coverage
 */

const REGIONS = [
  { lat: 39.8, lon: -98.5, dist: 2000 },   // North America
  { lat: 50.0, lon: 15.0, dist: 2000 },     // Europe
  { lat: 35.0, lon: 105.0, dist: 2000 },    // Asia
  { lat: -25.0, lon: 133.0, dist: 2000 },   // Australia
  { lat: 0.0, lon: 20.0, dist: 2500 },      // Africa
  { lat: -15.0, lon: -60.0, dist: 2000 },   // South America
];

// Helicopter type codes
const HELI_TYPES = new Set([
  'R22','R44','R66','B06','B06T','B204','B205','B206','B212','B222','B230',
  'B407','B412','B427','B429','B430','B505','B525',
  'AS32','AS35','AS50','AS55','AS65',
  'EC20','EC25','EC30','EC35','EC45','EC55','EC75',
  'H125','H130','H135','H145','H155','H160','H175','H215','H225',
  'S55','S58','S61','S64','S70','S76','S92',
  'A109','A119','A139','A169','A189','AW09',
  'MD52','MD60','MDHI','MD90','NOTR',
  'B47G','HUEY','GAMA','CABR','EXE',
]);

// Private jet types
const PRIVATE_JET_TYPES = new Set([
  'G150','G200','G280','GLEX','G500','G550','G600','G650','G700',
  'GLF2','GLF3','GLF4','GLF5','GLF6','GL5T','GL7T','GV','GIV',
  'CL30','CL35','CL60','BD70','BD10',
  'C25A','C25B','C25C','C500','C510','C525','C550','C560','C56X','C680','C700','C750',
  'E35L','E50P','E55P','E545','E550',
  'FA50','FA7X','FA8X','F900','F2TH',
  'LJ35','LJ40','LJ45','LJ60','LJ70','LJ75',
  'PC12','PC24','TBM7','TBM8','TBM9',
  'PRM1','SF50','EA50','VLJ',
]);

// Military type indicators
const MILITARY_INDICATORS = new Set([
  'C17','C5M','C130','C30J','KC10','KC46','KC35','E3CF','E3TF','E8A',
  'B1B','B2','B52','F16','F15','F18','F22','F35','A10','F117',
  'RC135','E6B','P8A','P3','MQ9','RQ4','U2','EP3','RC12',
  'V22','CH47','UH60','AH64','AH1Z','MV22',
  'EUFI','RFAL','TORD','TYP','GR4',
]);

const AIRLINE_CODE_RE = /^([A-Z]{3})\d/;

async function fetchRegion(region: typeof REGIONS[0]): Promise<any[]> {
  try {
    const url = `https://api.airplanes.live/v2/point/${region.lat}/${region.lon}/${region.dist}`;
    const res = await stealthFetch(url, {
      signal: AbortSignal.timeout(12000),
    });
    if (res.ok) {
      const data = await res.json();
      return data.ac || [];
    }
  } catch (e) {
    console.warn(`Region fetch failed for lat=${region.lat}:`, e);
  }
  return [];
}

function classifyFlight(f: any) {
  const modelUpper = (f.t || '').toUpperCase();
  const flightStr = (f.flight || '').trim().toUpperCase();
  const dbFlags = (f.dbFlags || 0);

  // Skip fixed structures
  if (modelUpper === 'TWR') return null;

  const lat = f.lat;
  const lon = f.lon;
  if (
    typeof lat !== 'number' ||
    typeof lon !== 'number' ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) return null;

  const callsign = flightStr || f.hex || 'UNKNOWN';
  const altRaw = f.alt_baro;
  const altMeters = typeof altRaw === 'number' && Number.isFinite(altRaw) ? altRaw * 0.3048 : null;
  const speedKnots = typeof f.gs === 'number' ? Math.round(f.gs * 10) / 10 : null;
  const heading = typeof f.track === 'number' && Number.isFinite(f.track) ? f.track : null;
  const isHeli = HELI_TYPES.has(modelUpper) || f.category_os === 8;
  const isGrounded = typeof altRaw === 'number' && altRaw < 100;

  // OpenSky specific categorizations
  const isOsMilitary = f.category_os === 14; // UAVs often default to military in OSINT context
  const isOsJet = f.category_os === 7 || f.category_os === 3;
  const isOsPrivate = f.category_os === 2;

  // Extract airline code
  const airlineMatch = AIRLINE_CODE_RE.exec(callsign);
  const airlineCode = airlineMatch ? airlineMatch[1] : '';

  // Classification
  let category: 'commercial' | 'private' | 'jet' | 'military' = 'commercial';
  if (isOsMilitary || dbFlags & 1 || MILITARY_INDICATORS.has(modelUpper) || (f.flight || '').match(/^(RCH|KING|DUKE|EVAC|JAKE|REACH|CONVOY)\d/i)) {
    category = 'military';
  } else if (isOsJet || PRIVATE_JET_TYPES.has(modelUpper)) {
    category = 'jet';
  } else if (isOsPrivate || (!airlineCode && modelUpper && !['A319','A320','A321','A332','A333','A339','A343','A359','A388','B737','B738','B739','B38M','B39M','B752','B753','B763','B764','B772','B77L','B77W','B788','B789','B78X','E170','E175','E190','E195','CRJ7','CRJ9','AT43','AT72','DH8D'].includes(modelUpper))) {
    category = 'private';
  }

  return {
    callsign,
    lat: Math.round(lat * 100000) / 100000,
    lng: Math.round(lon * 100000) / 100000,
    alt: altMeters === null ? null : Math.round(altMeters),
    heading: heading === null ? null : Math.round(heading),
    speed_knots: speedKnots,
    model: f.t || 'Unknown',
    icao24: f.hex || '',
    registration: f.r || 'N/A',
    squawk: f.squawk || '',
    airline_code: airlineCode,
    aircraft_category: isHeli ? 'heli' : 'plane',
    category,
    grounded: isGrounded,
    nac_p: f.nac_p,
    type: 'flight',
  };
}

// In-memory cache to prevent global fan-out abuse
// NOTE (Issue #110): This cache is per-isolate in serverless environments (Vercel).
// Multiple isolates may each hold their own cache, but this is acceptable because:
// 1. It coalesces concurrent requests within the same isolate
// 2. It prevents hammering adsb.lol which would cause rate-limit bans
// For a globally shared cache, migrate to Vercel KV or similar persistent store.
let cachedData: any = null;
let lastFetchTime = 0;
const CACHE_TTL = 45000; // 45 seconds cache window
let fetchPromise: Promise<any> | null = null;

const AIRCRAFT_SOURCES = {
  opensky: 'https://opensky-network.org/api/states/all',
  airplanesMil: 'https://api.airplanes.live/v2/mil',
  airplanesLadd: 'https://api.airplanes.live/v2/ladd',
  adsbLolMil: 'https://api.adsb.lol/v2/mil',
  adsbLolLadd: 'https://api.adsb.lol/v2/ladd',
};

async function fetchAircraftJson(url: string, label: string, collectedAt: string) {
  try {
    const res = await stealthFetch(url, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) {
      return {
        aircraft: [] as any[],
        status: collectionStatus({
          source: sourceIdentity(label.toLowerCase().replace(/[^a-z0-9]+/g, '-'), label, url),
          availability: res.status === 429 ? 'rate_limited' : 'error',
          dataState: 'unavailable',
          lastAttemptAt: collectedAt,
          errorCode: `HTTP_${res.status}`,
          message: `${label} returned HTTP ${res.status}; stream omitted.`,
        }),
      };
    }
    const data = await res.json();
    const aircraft = Array.isArray(data.ac) ? data.ac : [];
    return {
      aircraft,
      status: collectionStatus({
        source: sourceIdentity(label.toLowerCase().replace(/[^a-z0-9]+/g, '-'), label, url),
        availability: 'ok',
        dataState: aircraft.length > 0 ? 'present' : 'empty',
        freshness: 'fresh',
        lastAttemptAt: collectedAt,
        lastSuccessfulFetchAt: collectedAt,
        receivedRecords: aircraft.length,
        acceptedRecords: aircraft.length,
        message: aircraft.length > 0 ? `${label} aircraft records returned.` : `${label} returned no aircraft records.`,
      }),
    };
  } catch (error) {
    return {
      aircraft: [] as any[],
      status: collectionStatus({
        source: sourceIdentity(label.toLowerCase().replace(/[^a-z0-9]+/g, '-'), label, url),
        availability: 'error',
        dataState: 'unavailable',
        lastAttemptAt: collectedAt,
        errorCode: error instanceof Error ? error.name : 'FETCH_ERROR',
        message: `${label} unavailable; stream omitted.`,
      }),
    };
  }
}

export async function GET() {
  const now = Date.now();
  const collectedAt = nowIso();

  // Return cached data if within TTL
  if (cachedData && now - lastFetchTime < CACHE_TTL) {
    return NextResponse.json(cachedData, {
      headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' },
    });
  }

  // Coalesce concurrent requests: wait for the active fetch rather than starting a new one
  if (fetchPromise) {
    try {
      const data = await fetchPromise;
      return NextResponse.json(data, {
        headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' },
      });
    } catch {
      // Fallback to error if the pending fetch failed
      return NextResponse.json({ error: 'Failed to fetch flight data' }, { status: 500 });
    }
  }

  const JAMMING_NACAP_THRESHOLD = 4;

  // Start new global fetch
  fetchPromise = (async () => {
    // Fetch OpenSky for global traffic and airplanes.live/ADSB.lol for military & private aircraft.
    const [osRes, milPrimary, laddPrimary] = await Promise.allSettled([
      stealthFetch(AIRCRAFT_SOURCES.opensky, { signal: AbortSignal.timeout(15000) }),
      fetchAircraftJson(AIRCRAFT_SOURCES.airplanesMil, 'airplanes.live military', collectedAt),
      fetchAircraftJson(AIRCRAFT_SOURCES.airplanesLadd, 'airplanes.live LADD', collectedAt),
    ]);
    const sourceStatuses = [];

    const allRaw: any[] = [];
    const seenHex = new Set<string>();

    // Process military flights first so they take precedence (preserves nac_p for jamming)
    let milData = milPrimary.status === 'fulfilled' ? milPrimary.value : null;
    if (!milData || milData.aircraft.length === 0) {
      const alternate = await fetchAircraftJson(AIRCRAFT_SOURCES.adsbLolMil, 'ADSB.lol military', collectedAt);
      if (milData) sourceStatuses.push(milData.status);
      milData = alternate;
    }
    if (milData) {
      sourceStatuses.push(milData.status);
      for (const ac of milData.aircraft) {
        const hex = (ac.hex || '').toLowerCase().trim();
        if (hex && !seenHex.has(hex)) {
          seenHex.add(hex);
          allRaw.push(ac);
        }
      }
    }

    // Process LADD (Private Jets) flights
    let laddData = laddPrimary.status === 'fulfilled' ? laddPrimary.value : null;
    if (!laddData || laddData.aircraft.length === 0) {
      const alternate = await fetchAircraftJson(AIRCRAFT_SOURCES.adsbLolLadd, 'ADSB.lol LADD', collectedAt);
      if (laddData) sourceStatuses.push(laddData.status);
      laddData = alternate;
    }
    if (laddData) {
      sourceStatuses.push(laddData.status);
      for (const ac of laddData.aircraft) {
        const hex = (ac.hex || '').toLowerCase().trim();
        if (hex && !seenHex.has(hex)) {
          seenHex.add(hex);
          allRaw.push(ac);
        }
      }
    }

    // Process OpenSky flights globally
    if (osRes.status === 'fulfilled' && osRes.value.ok) {
      try {
        const data = await osRes.value.json();
        for (const s of (data.states || [])) {
          const hex = (s[0] || '').toLowerCase().trim();
          if (hex && !seenHex.has(hex)) {
            seenHex.add(hex);
            // Translate OpenSky to tar1090 format
            allRaw.push({
              hex: s[0],
              flight: s[1]?.trim(),
              lon: s[5],
              lat: s[6],
              alt_baro: typeof s[7] === 'number' ? s[7] * 3.28084 : null, // meters to feet
              gs: typeof s[9] === 'number' ? s[9] * 1.94384 : null, // m/s to knots
              track: s[10],
              squawk: s[14],
              category_os: s[17], // OpenSky category
            });
          }
        }
        sourceStatuses.push(collectionStatus({
          source: sourceIdentity('opensky-network', 'OpenSky Network', AIRCRAFT_SOURCES.opensky),
          availability: 'ok',
          dataState: Array.isArray(data.states) && data.states.length > 0 ? 'present' : 'empty',
          freshness: 'fresh',
          lastAttemptAt: collectedAt,
          lastSuccessfulFetchAt: collectedAt,
          receivedRecords: Array.isArray(data.states) ? data.states.length : 0,
          acceptedRecords: Array.isArray(data.states) ? data.states.length : 0,
          message: 'OpenSky global aircraft states returned.',
        }));
      } catch(e) {}
    } else {
      sourceStatuses.push(collectionStatus({
        source: sourceIdentity('opensky-network', 'OpenSky Network', AIRCRAFT_SOURCES.opensky),
        availability: 'error',
        dataState: 'unavailable',
        lastAttemptAt: collectedAt,
        errorCode: osRes.status === 'fulfilled' ? `HTTP_${osRes.value.status}` : 'FETCH_ERROR',
        message: 'OpenSky global aircraft stream unavailable; stream omitted.',
      }));
    }

    // Classify all flights
    const commercial: any[] = [];
    const privateFl: any[] = [];
    const jets: any[] = [];
    const military: any[] = [];
    const gpsJamming: any[] = [];

    for (const raw of allRaw) {
      const flight = classifyFlight(raw);
      if (!flight) continue;

      // GPS jamming detection
      if (typeof flight.nac_p === 'number' && flight.nac_p <= JAMMING_NACAP_THRESHOLD && !flight.grounded) {
        gpsJamming.push({
          lat: flight.lat,
          lng: flight.lng,
          nac_p: flight.nac_p,
          callsign: flight.callsign,
        });
      }

      switch (flight.category) {
        case 'military': military.push(flight); break;
        case 'jet': jets.push(flight); break;
        case 'private': privateFl.push(flight); break;
        default: commercial.push(flight);
      }
    }

    // Aggregate GPS jamming zones (grid-based)
    const jammingZones = aggregateJamming(gpsJamming, JAMMING_NACAP_THRESHOLD);

    const sourceStatus = collectionStatus({
      source: sourceIdentity('air-traffic-combined', 'OpenSky / airplanes.live', 'https://opensky-network.org/api/states/all'),
      availability: allRaw.length > 0 ? 'ok' : 'partial',
      dataState: allRaw.length > 0 ? 'present' : 'empty',
      freshness: allRaw.length > 0 ? 'fresh' : 'unknown',
      lastAttemptAt: collectedAt,
      lastSuccessfulFetchAt: allRaw.length > 0 ? collectedAt : null,
      receivedRecords: allRaw.length,
      acceptedRecords: commercial.length + privateFl.length + jets.length + military.length,
      rejectedRecords: Math.max(0, allRaw.length - (commercial.length + privateFl.length + jets.length + military.length)),
      message: allRaw.length > 0 ? 'Aircraft position reports returned.' : 'No usable aircraft position reports returned from configured sources.',
    });
    updateSourceStatuses([sourceStatus, ...sourceStatuses]);

    return {
      commercial_flights: commercial,
      private_flights: privateFl,
      private_jets: jets,
      military_flights: military,
      gps_jamming: jammingZones,
      total: allRaw.length,
      timestamp: collectedAt,
      collectedAt,
      dataMode: 'real',
      status: [sourceStatus, ...sourceStatuses],
      alternate_sources: [
        { name: 'ADSB.lol military', url: AIRCRAFT_SOURCES.adsbLolMil },
        { name: 'ADSB.lol LADD', url: AIRCRAFT_SOURCES.adsbLolLadd },
      ],
    };
  })();

  try {
    const data = await fetchPromise;
    cachedData = data;
    lastFetchTime = Date.now();
    fetchPromise = null;

    const cacheControl = data.total < 100 
      ? 'no-store, max-age=0' 
      : 'public, s-maxage=30, stale-while-revalidate=60';

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': cacheControl,
      },
    });
  } catch (error) {
    console.error('Flight fetch error:', error);
    fetchPromise = null;
    const sourceStatus = collectionStatus({
      source: sourceIdentity('air-traffic-combined', 'OpenSky / airplanes.live', 'https://opensky-network.org/api/states/all'),
      availability: 'error',
      dataState: 'unavailable',
      lastAttemptAt: collectedAt,
      errorCode: error instanceof Error ? error.name : 'FETCH_ERROR',
      message: 'Aircraft source collection failed.',
    });
    updateSourceStatuses([sourceStatus]);
    return NextResponse.json(
      { error: 'Failed to fetch flight data', status: [sourceStatus], timestamp: collectedAt },
      { status: 500 }
    );
  }
}

function aggregateJamming(points: any[], threshold: number) {
  if (points.length === 0) return [];
  const grid = new Map<string, { lat: number; lng: number; count: number; total_nac_p: number }>();
  const GRID_SIZE = 2; // degrees

  for (const p of points) {
    const gLat = Math.floor(p.lat / GRID_SIZE) * GRID_SIZE;
    const gLng = Math.floor(p.lng / GRID_SIZE) * GRID_SIZE;
    const key = `${gLat},${gLng}`;

    if (!grid.has(key)) {
      grid.set(key, { lat: gLat + GRID_SIZE / 2, lng: gLng + GRID_SIZE / 2, count: 0, total_nac_p: 0 });
    }
    const cell = grid.get(key)!;
    cell.count++;
    cell.total_nac_p += p.nac_p;
  }

  return Array.from(grid.values())
    .filter(z => z.count >= 3) // Minimum 3 aircraft with degraded NACp
    .map(z => ({
      lat: z.lat,
      lng: z.lng,
      severity: Math.round((1 - (z.total_nac_p / z.count) / threshold) * 100),
      count: z.count,
    }));
}
