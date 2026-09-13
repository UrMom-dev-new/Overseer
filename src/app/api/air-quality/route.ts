import { NextResponse } from 'next/server';

/**
 * OVERSEER — Air Quality Monitoring API
 * Fetches real air quality observations/forecasts.
 * Missing sources are omitted; no estimated stations are emitted.
 */

const OPENAQ_V2_LATEST = 'https://api.openaq.org/v2/latest?limit=500&parameter=pm25&order_by=lastUpdated&sort=desc';
const OPEN_METEO_CITIES = [
  { id: 'nyc', name: 'New York', city: 'New York', country: 'US', lat: 40.7128, lng: -74.0060 },
  { id: 'london', name: 'London', city: 'London', country: 'GB', lat: 51.5074, lng: -0.1278 },
  { id: 'delhi', name: 'Delhi', city: 'Delhi', country: 'IN', lat: 28.6139, lng: 77.2090 },
  { id: 'beijing', name: 'Beijing', city: 'Beijing', country: 'CN', lat: 39.9042, lng: 116.4074 },
  { id: 'tokyo', name: 'Tokyo', city: 'Tokyo', country: 'JP', lat: 35.6762, lng: 139.6503 },
  { id: 'sydney', name: 'Sydney', city: 'Sydney', country: 'AU', lat: -33.8688, lng: 151.2093 },
  { id: 'los-angeles', name: 'Los Angeles', city: 'Los Angeles', country: 'US', lat: 34.0522, lng: -118.2437 },
  { id: 'sao-paulo', name: 'Sao Paulo', city: 'Sao Paulo', country: 'BR', lat: -23.5505, lng: -46.6333 },
];

function classifyPm25(val: number) {
  if (val > 150) return { level: 'Hazardous', color: '#8B0000' };
  if (val > 100) return { level: 'Unhealthy', color: '#FF1744' };
  if (val > 55) return { level: 'Unhealthy (Sensitive)', color: '#FF9500' };
  if (val > 35) return { level: 'Moderate', color: '#FFD700' };
  return { level: 'Good', color: '#00E676' };
}

function latestOpenMeteoValue(data: any): { pm25: number; pm10: number | null; time: string } | null {
  const times = data?.hourly?.time;
  const pm25s = data?.hourly?.pm2_5;
  const pm10s = data?.hourly?.pm10;
  if (!Array.isArray(times) || !Array.isArray(pm25s)) return null;
  const now = Date.now();
  let selected: { pm25: number; pm10: number | null; time: string } | null = null;
  for (let i = 0; i < times.length; i++) {
    const pm25 = pm25s[i];
    if (typeof pm25 !== 'number' || !Number.isFinite(pm25)) continue;
    const t = new Date(times[i]).getTime();
    if (!Number.isFinite(t) || t > now + 90 * 60 * 1000) continue;
    selected = { pm25, pm10: typeof pm10s?.[i] === 'number' ? pm10s[i] : null, time: times[i] };
  }
  return selected;
}

export async function GET() {
  const source_status: Array<{ source: string; availability: 'ok' | 'error'; dataState: 'present' | 'empty' | 'unavailable'; message: string }> = [];
  try {
    const stations: any[] = [];
    try {
      const res = await fetch(OPENAQ_V2_LATEST, {
        signal: AbortSignal.timeout(10000),
        headers: { 'Accept': 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
      for (const loc of data.results || []) {
        if (typeof loc.coordinates?.latitude !== 'number' || typeof loc.coordinates?.longitude !== 'number') continue;
        const pm25 = loc.measurements?.find((m: any) => m.parameter === 'pm25');
        if (!pm25) continue;
        const val = pm25.value;
        if (typeof val !== 'number' || !Number.isFinite(val)) continue;
        const { level, color } = classifyPm25(val);

        stations.push({
          id: `aq-${loc.location}`,
          name: loc.location,
          city: loc.city || 'Unknown',
          country: loc.country,
          lat: loc.coordinates.latitude,
          lng: loc.coordinates.longitude,
          pm25: val,
          unit: pm25.unit,
          level,
          color,
          lastUpdated: pm25.lastUpdated,
          source: 'OpenAQ',
        });
      }
        source_status.push({ source: 'OpenAQ v2 latest', availability: 'ok', dataState: stations.length > 0 ? 'present' : 'empty', message: 'OpenAQ PM2.5 measurements returned.' });
      } else {
        source_status.push({ source: 'OpenAQ v2 latest', availability: 'error', dataState: 'unavailable', message: `HTTP ${res.status}; OpenAQ stream omitted.` });
      }
    } catch (error) {
      source_status.push({ source: 'OpenAQ v2 latest', availability: 'error', dataState: 'unavailable', message: error instanceof Error ? error.message : 'OpenAQ unavailable.' });
    }

    if (stations.length === 0) {
      const alternateResults = await Promise.allSettled(OPEN_METEO_CITIES.map(async city => {
        const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${city.lat}&longitude=${city.lng}&hourly=pm2_5,pm10&forecast_days=1`;
        const res = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { 'Accept': 'application/json' } });
        if (!res.ok) return null;
        const latest = latestOpenMeteoValue(await res.json());
        if (!latest) return null;
        const { level, color } = classifyPm25(latest.pm25);
        return {
          id: `open-meteo-${city.id}`,
          name: city.name,
          city: city.city,
          country: city.country,
          lat: city.lat,
          lng: city.lng,
          pm25: latest.pm25,
          pm10: latest.pm10,
          unit: 'µg/m³',
          level,
          color,
          lastUpdated: latest.time,
          source: 'Open-Meteo Air Quality API',
          sampling_note: 'Fixed-city alternate sample; not a global latest station feed.',
        };
      }));

      for (const result of alternateResults) {
        if (result.status === 'fulfilled' && result.value) stations.push(result.value);
      }
      source_status.push({
        source: 'Open-Meteo Air Quality API',
        availability: stations.length > 0 ? 'ok' : 'error',
        dataState: stations.length > 0 ? 'present' : 'unavailable',
        message: stations.length > 0 ? 'Open-Meteo fixed-city alternate records returned.' : 'Open-Meteo alternate unavailable.',
      });
    }

    const unavailable = stations.length === 0;
    return NextResponse.json({
      stations,
      total: stations.length,
      source_status,
      alternate_sources: [
        { name: 'Open-Meteo Air Quality API', url: 'https://air-quality-api.open-meteo.com/' },
      ],
      message: unavailable ? 'Air quality sources unavailable; stream omitted.' : 'Air quality records returned.',
      timestamp: new Date().toISOString(),
    }, { status: unavailable ? 503 : 200, headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch (error) {
    console.error('Air Quality API error:', error);
    return NextResponse.json({ stations: [], source_status, error: 'Failed to fetch air quality data' }, { status: 500 });
  }
}
