
import { NextResponse } from 'next/server';
import { stealthFetch } from '@/lib/stealthFetch';
import {
  collectionStatus,
  nowIso,
  sourceIdentity,
  updateSourceStatuses,
  type SourceCollectionStatus,
} from '@/lib/feed-integrity';

/**
 * OVERSEER — Satellite Tracking API
 * Fetches TLE data from real public sources.
 * If sources are unavailable and no real cache exists, the stream is omitted.
 */

// Mission classification by NORAD name keywords
const MISSION_CLASSIFY: Record<string, { mission: string; color: string }> = {
  'USA': { mission: 'Military Recon', color: '#FF3D3D' },
  'NROL': { mission: 'NRO Classified', color: '#FF3D3D' },
  'LACROSSE': { mission: 'SAR Imaging', color: '#00E5FF' },
  'MENTOR': { mission: 'SIGINT', color: '#FFFFFF' },
  'ORION': { mission: 'SIGINT', color: '#FFFFFF' },
  'TRUMPET': { mission: 'SIGINT', color: '#FFFFFF' },
  'GPS': { mission: 'Navigation', color: '#448AFF' },
  'NAVSTAR': { mission: 'Navigation', color: '#448AFF' },
  'GLONASS': { mission: 'Navigation', color: '#448AFF' },
  'GALILEO': { mission: 'Navigation', color: '#448AFF' },
  'BEIDOU': { mission: 'Navigation', color: '#448AFF' },
  'SBIRS': { mission: 'Early Warning', color: '#FF00FF' },
  'DSP': { mission: 'Early Warning', color: '#FF00FF' },
  'STARLINK': { mission: 'Commercial Comms', color: '#00E676' },
  'ONEWEB': { mission: 'Commercial Comms', color: '#00E676' },
  'PLANET': { mission: 'Earth Imaging', color: '#00E676' },
  'WORLDVIEW': { mission: 'Commercial Imaging', color: '#00E676' },
  'ISS': { mission: 'Space Station', color: '#FFD700' },
  'TIANGONG': { mission: 'Space Station', color: '#FFD700' },
  'COSMOS': { mission: 'Russian Military', color: '#FF6B6B' },
  'YAOGAN': { mission: 'Chinese Recon', color: '#FF6B6B' },
  'FENGYUN': { mission: 'Weather', color: '#87CEEB' },
  'GOES': { mission: 'Weather', color: '#87CEEB' },
  'NOAA': { mission: 'Weather', color: '#87CEEB' },
  'METEOSAT': { mission: 'Weather', color: '#87CEEB' },
  'LANDSAT': { mission: 'Earth Observation', color: '#90EE90' },
  'SENTINEL': { mission: 'Earth Observation', color: '#90EE90' },
  'TERRA': { mission: 'Earth Science', color: '#90EE90' },
  'AQUA': { mission: 'Earth Science', color: '#90EE90' },
  'HUBBLE': { mission: 'Space Telescope', color: '#FFD700' },
  'JAMES WEBB': { mission: 'Space Telescope', color: '#FFD700' },
};

function classifySatellite(name: string): { mission: string; color: string } {
  const upper = name.toUpperCase();
  for (const [keyword, info] of Object.entries(MISSION_CLASSIFY)) {
    if (upper.includes(keyword)) return info;
  }
  return { mission: 'Unknown', color: '#00E5FF' };
}

function gmst(jd: number): number {
  const t = (jd - 2451545.0) / 36525.0;
  const gmstSec = 67310.54841 + (876600.0 * 3600 + 8640184.812866) * t + 0.093104 * t * t - 6.2e-6 * t * t * t;
  return ((gmstSec % 86400) / 86400.0) * 2 * Math.PI;
}

// No longer needed: function parseTLE(tleText: string) {}

function propagateSGP4Simple(line1: string, line2: string): { lat: number; lng: number; alt: number } | null {
  try {
    const incDeg = parseFloat(line2.substring(8, 16));
    const raanDeg = parseFloat(line2.substring(17, 25));
    const eccStr = '0.' + line2.substring(26, 33).trim();
    const ecc = parseFloat(eccStr);
    const argPerDeg = parseFloat(line2.substring(34, 42));
    const meanAnomDeg = parseFloat(line2.substring(43, 51));
    const meanMotion = parseFloat(line2.substring(52, 63));

    if (isNaN(meanMotion) || meanMotion === 0) return null;

    const now = new Date();
    const epochYear = parseInt(line1.substring(18, 20));
    const epochDay = parseFloat(line1.substring(20, 32));
    const fullYear = epochYear > 56 ? 1900 + epochYear : 2000 + epochYear;

    const epochDate = new Date(fullYear, 0, 1);
    epochDate.setDate(epochDate.getDate() + epochDay - 1);
    const elapsedMin = (now.getTime() - epochDate.getTime()) / 60000;

    // Reject stale TLEs (> 30 days old).
    if (Math.abs(elapsedMin) > 43200) return null;

    const n = meanMotion * 2 * Math.PI / 1440;
    const M = ((meanAnomDeg * Math.PI / 180) + n * elapsedMin) % (2 * Math.PI);

    let E = M;
    for (let j = 0; j < 10; j++) {
      E = M + ecc * Math.sin(E);
    }

    const sinV = Math.sqrt(1 - ecc * ecc) * Math.sin(E) / (1 - ecc * Math.cos(E));
    const cosV = (Math.cos(E) - ecc) / (1 - ecc * Math.cos(E));
    const v = Math.atan2(sinV, cosV);

    const a = Math.pow(398600.4418 / (meanMotion * 2 * Math.PI / 86400) ** 2, 1 / 3);
    const r = a * (1 - ecc * Math.cos(E));

    const inc = incDeg * Math.PI / 180;
    const raan = raanDeg * Math.PI / 180;
    const argPer = argPerDeg * Math.PI / 180;
    const u = v + argPer;

    const x = r * (Math.cos(raan) * Math.cos(u) - Math.sin(raan) * Math.sin(u) * Math.cos(inc));
    const y = r * (Math.sin(raan) * Math.cos(u) + Math.cos(raan) * Math.sin(u) * Math.cos(inc));
    const z = r * Math.sin(u) * Math.sin(inc);

    const jd = 2440587.5 + now.getTime() / 86400000;
    const theta = gmst(jd);

    const xRot = x * Math.cos(theta) + y * Math.sin(theta);
    const yRot = -x * Math.sin(theta) + y * Math.cos(theta);

    const lng = Math.atan2(yRot, xRot) * 180 / Math.PI;
    const lat = Math.atan2(z, Math.sqrt(xRot * xRot + yRot * yRot)) * 180 / Math.PI;
    const alt = r - 6371;

    if (isNaN(lat) || isNaN(lng) || Math.abs(lat) > 90) return null;
    if (alt < 100 || alt > 50000) return null; // sanity check

    return {
      lat: Math.round(lat * 10000) / 10000,
      lng: Math.round(((lng + 540) % 360 - 180) * 10000) / 10000,
      alt: Math.round(alt),
    };
  } catch {
    return null;
  }
}

interface TleSat {
  name: string;
  line1: string;
  line2: string;
}

// SatNOGS Open API - Provides full TLE JSON without API keys or IP blocks
const SATNOGS_API = 'https://db.satnogs.org/api/tle/?format=json';
const CELESTRAK_ACTIVE_TLE = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle';

let globalCachedSats: TleSat[] = [];
let globalCacheTime = 0;
let globalCacheSource = 'none';

function parseSatnogs(input: unknown): { sats: TleSat[]; received: number } {
  if (!Array.isArray(input)) return { sats: [], received: 0 };
  const fetchedSats: TleSat[] = [];
  const seen = new Set<string>();

  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const tle = item as { tle0?: unknown; tle1?: unknown; tle2?: unknown };
    const rawName = typeof tle.tle0 === 'string' ? tle.tle0.trim() : '';
    const line1 = typeof tle.tle1 === 'string' ? tle.tle1.trim() : '';
    const line2 = typeof tle.tle2 === 'string' ? tle.tle2.trim() : '';
    const cleanName = rawName.replace(/^0\s+/, '');
    if (cleanName && line1.startsWith('1 ') && line2.startsWith('2 ') && !seen.has(cleanName)) {
      seen.add(cleanName);
      fetchedSats.push({ name: cleanName, line1, line2 });
    }
  }

  return { sats: fetchedSats, received: input.length };
}

function parseCelestrakTle(text: string): { sats: TleSat[]; received: number } {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const sats: TleSat[] = [];

  for (let i = 0; i < lines.length - 2; i++) {
    const name = lines[i];
    const line1 = lines[i + 1];
    const line2 = lines[i + 2];
    if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) continue;
    sats.push({ name: name.replace(/^0\s+/, ''), line1, line2 });
    i += 2;
  }

  return { sats, received: Math.floor(lines.length / 3) };
}

async function fetchSatnogs(collectedAt: string): Promise<{ sats: TleSat[]; status: SourceCollectionStatus }> {
  const res = await stealthFetch(SATNOGS_API, {
    signal: AbortSignal.timeout(15000),
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) {
    return {
      sats: [],
      status: collectionStatus({
        source: sourceIdentity('satnogs-tle', 'SatNOGS DB', SATNOGS_API),
        availability: 'error',
        dataState: 'unavailable',
        lastAttemptAt: collectedAt,
        errorCode: `HTTP_${res.status}`,
        message: `SatNOGS returned HTTP ${res.status}; stream omitted.`,
      }),
    };
  }
  const parsed = parseSatnogs(await res.json());
  return {
    sats: parsed.sats,
    status: collectionStatus({
      source: sourceIdentity('satnogs-tle', 'SatNOGS DB', SATNOGS_API),
      availability: parsed.sats.length > 0 ? 'ok' : 'error',
      dataState: parsed.sats.length > 0 ? 'present' : 'empty',
      freshness: parsed.sats.length > 0 ? 'fresh' : 'unknown',
      lastAttemptAt: collectedAt,
      lastSuccessfulFetchAt: parsed.sats.length > 0 ? collectedAt : null,
      receivedRecords: parsed.received,
      acceptedRecords: parsed.sats.length,
      message: parsed.sats.length > 0 ? 'SatNOGS TLE records returned.' : 'No usable SatNOGS TLE records returned.',
    }),
  };
}

async function fetchCelestrak(collectedAt: string): Promise<{ sats: TleSat[]; status: SourceCollectionStatus }> {
  const res = await stealthFetch(CELESTRAK_ACTIVE_TLE, {
    signal: AbortSignal.timeout(15000),
    headers: { 'Accept': 'text/plain' },
  });
  if (!res.ok) {
    return {
      sats: [],
      status: collectionStatus({
        source: sourceIdentity('celestrak-active-tle', 'CelesTrak GP active satellites', CELESTRAK_ACTIVE_TLE),
        availability: 'error',
        dataState: 'unavailable',
        lastAttemptAt: collectedAt,
        errorCode: `HTTP_${res.status}`,
        message: `CelesTrak returned HTTP ${res.status}; alternate stream omitted.`,
      }),
    };
  }
  const parsed = parseCelestrakTle(await res.text());
  return {
    sats: parsed.sats,
    status: collectionStatus({
      source: sourceIdentity('celestrak-active-tle', 'CelesTrak GP active satellites', CELESTRAK_ACTIVE_TLE),
      availability: parsed.sats.length > 0 ? 'ok' : 'error',
      dataState: parsed.sats.length > 0 ? 'present' : 'empty',
      freshness: parsed.sats.length > 0 ? 'fresh' : 'unknown',
      lastAttemptAt: collectedAt,
      lastSuccessfulFetchAt: parsed.sats.length > 0 ? collectedAt : null,
      receivedRecords: parsed.received,
      acceptedRecords: parsed.sats.length,
      message: parsed.sats.length > 0 ? 'CelesTrak alternate TLE records returned.' : 'No usable CelesTrak alternate TLE records returned.',
    }),
  };
}

export async function GET() {
  try {
    const nowTime = Date.now();
    const collectedAt = nowIso();
    let allSats: TleSat[] = globalCachedSats;
    let source = globalCachedSats.length > 0 ? `memory-cache:${globalCacheSource}` : 'unavailable';
    const source_status: SourceCollectionStatus[] = [];

    if (globalCachedSats.length === 0 || nowTime - globalCacheTime > 3600000) { // 1 hour cache
      const primary = await fetchSatnogs(collectedAt).catch((error) => ({
        sats: [],
        status: collectionStatus({
          source: sourceIdentity('satnogs-tle', 'SatNOGS DB', SATNOGS_API),
          availability: 'error',
          dataState: 'unavailable',
          lastAttemptAt: collectedAt,
          errorCode: error instanceof Error ? error.name : 'FETCH_ERROR',
          message: error instanceof Error ? error.message : 'SatNOGS fetch error; stream omitted.',
        }),
      }));
      source_status.push(primary.status);

      let selected = primary.sats;
      let selectedSource = 'satnogs-api';

      if (selected.length === 0) {
        const alternate = await fetchCelestrak(collectedAt).catch((error) => ({
          sats: [],
          status: collectionStatus({
            source: sourceIdentity('celestrak-active-tle', 'CelesTrak GP active satellites', CELESTRAK_ACTIVE_TLE),
            availability: 'error',
            dataState: 'unavailable',
            lastAttemptAt: collectedAt,
            errorCode: error instanceof Error ? error.name : 'FETCH_ERROR',
            message: error instanceof Error ? error.message : 'CelesTrak fetch error; alternate stream omitted.',
          }),
        }));
        source_status.push(alternate.status);
        selected = alternate.sats;
        selectedSource = 'celestrak-gp-active';
      }

      if (selected.length > 0) {
        globalCachedSats = selected;
        globalCacheTime = nowTime;
        globalCacheSource = selectedSource;
        allSats = selected;
        source = selectedSource;
      }
    } else {
      source_status.push(collectionStatus({
        source: sourceIdentity(
          globalCacheSource === 'celestrak-gp-active' ? 'celestrak-active-tle' : 'satnogs-tle',
          globalCacheSource === 'celestrak-gp-active' ? 'CelesTrak GP active satellites' : 'SatNOGS DB',
          globalCacheSource === 'celestrak-gp-active' ? CELESTRAK_ACTIVE_TLE : SATNOGS_API
        ),
        availability: 'ok',
        dataState: 'present',
        freshness: 'fresh',
        lastAttemptAt: collectedAt,
        lastSuccessfulFetchAt: collectedAt,
        message: 'Serving cached real TLE records.',
        receivedRecords: globalCachedSats.length,
        acceptedRecords: globalCachedSats.length,
      }));
    }

    if (allSats.length === 0) {
      updateSourceStatuses(source_status);
      return NextResponse.json({
        satellites: [],
        total: 0,
        source: 'unavailable',
        source_status,
        status: source_status,
        alternate_sources: [
          { provider: 'CelesTrak GP active satellites', url: CELESTRAK_ACTIVE_TLE },
        ],
        message: 'Satellite TLE streams unavailable; no synthetic satellite records emitted.',
        timestamp: new Date().toISOString(),
      }, { status: 503, headers: { 'Cache-Control': 'no-store, max-age=0' } });
    }

    // Sample for performance (max 2000 satellites)
    const sampled = allSats.length > 2000
      ? allSats.filter((_, i) => i % Math.ceil(allSats.length / 2000) === 0)
      : allSats;

    const satellites = [];
    for (const sat of sampled) {
      const pos = propagateSGP4Simple(sat.line1, sat.line2);
      if (!pos) continue;

      const classification = classifySatellite(sat.name);
      satellites.push({
        name: sat.name,
        lat: pos.lat,
        lng: pos.lng,
        alt: pos.alt,
        mission: classification.mission,
        color: classification.color,
        noradId: sat.line1.substring(2, 7).trim(),
      });
    }

    const cacheControl = satellites.length < 10 
      ? 'no-store, max-age=0' 
      : 'public, s-maxage=120, stale-while-revalidate=300';

    updateSourceStatuses(source_status);
    return NextResponse.json({
      satellites,
      total: satellites.length,
      source,
      source_status,
      status: source_status,
      raw_count: allSats.length,
      timestamp: new Date().toISOString(),
    }, {
      headers: {
        'Cache-Control': cacheControl,
      },
    });
  } catch (error) {
    console.error('Satellite fetch error:', error);
    return NextResponse.json({ satellites: [], error: 'Failed to fetch satellite data' }, { status: 500 });
  }
}
