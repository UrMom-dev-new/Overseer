import { degreesLat, degreesLong, eciToGeodetic, gstime, json2satrec, propagate, twoline2satrec } from 'satellite.js';
import type { OMMJsonObject, SatRec } from 'satellite.js';
import { collectionStatus, sourceIdentity } from './helpers';
import type { SourceCollectionStatus } from './types';

export const GNSS_REPO = 'https://github.com/Ringmast4r/GNSS';
export const GNSS_MAX_ELEMENT_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const GNSS_POSITION_TTL_MS = 2 * 60 * 1000;
const CATALOG_TTL_MS = 60 * 60 * 1000;
const RETRY_MS = 60 * 1000;
const MAX_BODY_BYTES = 1024 * 1024;

export const GNSS_PROVIDERS = [
  {
    id: 'gnss:ringmast4r-tle', name: 'Ringmast4r GNSS GPS snapshot', format: 'tle',
    url: 'https://raw.githubusercontent.com/Ringmast4r/GNSS/main/gps-satellites.txt',
  },
  {
    id: 'gnss:celestrak-gps-ops', name: 'CelesTrak GPS operational catalog', format: 'omm',
    url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=GPS-OPS&FORMAT=JSON',
  },
] as const;

type Provider = typeof GNSS_PROVIDERS[number];
interface Orbit {
  name: string;
  noradId: string;
  prn: number;
  epoch: string;
  satrec: SatRec;
}

export interface GnssSatellite {
  name: string;
  noradId: string;
  prn: number;
  lat: number;
  lng: number;
  alt: number;
  elementEpoch: string;
  predictedAt: string;
  expiresAt: string;
  source_url: string;
  provider: string;
  evidence_kind: 'reference';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validTleLine(line: string, prefix: string): boolean {
  if (line.length !== 69 || !line.startsWith(prefix) || !/^\d$/.test(line[68])) return false;
  let checksum = 0;
  for (const char of line.slice(0, 68)) checksum += /\d/.test(char) ? Number(char) : char === '-' ? 1 : 0;
  return checksum % 10 === Number(line[68]);
}

function orbit(name: unknown, satrec: SatRec, epoch: string): Orbit | null {
  if (typeof name !== 'string' || !/^GPS\b/i.test(name)) return null;
  const prn = /\bPRN\s+(\d{1,2})\b/i.exec(name)?.[1];
  if (!prn || Number(prn) < 1 || Number(prn) > 32 || satrec.error) return null;
  if (!/^\d+$/.test(satrec.satnum)) return null;
  return { name: name.trim().slice(0, 120), noradId: satrec.satnum, prn: Number(prn), epoch, satrec };
}

export function parseGnssCatalog(text: string, format: Provider['format']): { orbits: Orbit[]; received: number } {
  const orbits: Orbit[] = [];
  let received = 0;
  if (format === 'tle') {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i += 3) {
      received++;
      const [name, line1, line2] = lines.slice(i, i + 3);
      if (!line1 || !line2 || !validTleLine(line1, '1 ') || !validTleLine(line2, '2 ')) continue;
      if (line1.slice(2, 7) !== line2.slice(2, 7)) continue;
      const year = Number(line1.slice(18, 20));
      const fullYear = year >= 57 ? 1900 + year : 2000 + year;
      const day = Number(line1.slice(20, 32));
      const daysInYear = (Date.UTC(fullYear + 1, 0, 1) - Date.UTC(fullYear, 0, 1)) / 86400000;
      if (!Number.isInteger(year) || !Number.isFinite(day) || day < 1 || day >= daysInYear + 1) continue;
      try {
        const epoch = new Date(Date.UTC(fullYear, 0, 1) + (day - 1) * 86400000).toISOString();
        const parsed = orbit(name.replace(/^0\s+/, ''), twoline2satrec(line1, line2), epoch);
        if (parsed) orbits.push(parsed);
      } catch { /* Invalid orbital elements are omitted. */ }
    }
  } else {
    let data: unknown;
    try { data = JSON.parse(text); } catch { return { orbits, received: 0 }; }
    if (!Array.isArray(data)) return { orbits, received: 0 };
    received = data.length;
    for (const item of data) {
      if (!isRecord(item) || typeof item.EPOCH !== 'string') continue;
      const numericFields = ['NORAD_CAT_ID', 'MEAN_MOTION', 'ECCENTRICITY', 'INCLINATION', 'RA_OF_ASC_NODE', 'ARG_OF_PERICENTER', 'MEAN_ANOMALY', 'BSTAR', 'MEAN_MOTION_DOT', 'MEAN_MOTION_DDOT'];
      if (!numericFields.every((key) => typeof item[key] === 'number' && Number.isFinite(item[key]))) continue;
      if (!Number.isInteger(item.NORAD_CAT_ID) || Number(item.NORAD_CAT_ID) <= 0 || Number(item.MEAN_MOTION) <= 0 || Number(item.ECCENTRICITY) < 0 || Number(item.ECCENTRICITY) >= 1) continue;
      if (Number(item.INCLINATION) < 0 || Number(item.INCLINATION) > 180) continue;
      if (!['RA_OF_ASC_NODE', 'ARG_OF_PERICENTER', 'MEAN_ANOMALY'].every((key) => Number(item[key]) >= 0 && Number(item[key]) < 360)) continue;
      // CelesTrak's OMM JSON epochs are UTC without a timezone suffix.
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?$/.test(item.EPOCH)) continue;
      const epochMs = Date.parse(item.EPOCH.endsWith('Z') ? item.EPOCH : `${item.EPOCH}Z`);
      if (!Number.isFinite(epochMs)) continue;
      try {
        const parsed = orbit(item.OBJECT_NAME, json2satrec(item as unknown as OMMJsonObject), new Date(epochMs).toISOString());
        if (parsed) orbits.push(parsed);
      } catch { /* Invalid orbital elements are omitted. */ }
    }
  }
  return { orbits, received };
}

export function projectGnss(orbits: Orbit[], provider: Provider, nowMs: number): GnssSatellite[] {
  const date = new Date(nowMs);
  const seen = new Set<string>();
  const satellites: GnssSatellite[] = [];
  for (const item of orbits) {
    const age = nowMs - Date.parse(item.epoch);
    if (age > GNSS_MAX_ELEMENT_AGE_MS || age < -5 * 60 * 1000 || seen.has(item.noradId)) continue;
    try {
      const result = propagate(item.satrec, date);
      if (!result?.position || item.satrec.error) continue;
      const position = eciToGeodetic(result.position, gstime(date));
      const lat = degreesLat(position.latitude);
      const lng = degreesLong(position.longitude);
      if (![lat, lng, position.height].every(Number.isFinite) || position.height < 15000 || position.height > 30000) continue;
      satellites.push({
        name: item.name, noradId: item.noradId, prn: item.prn,
        lat, lng, alt: Math.round(position.height), elementEpoch: item.epoch,
        predictedAt: date.toISOString(), expiresAt: new Date(Math.min(nowMs + GNSS_POSITION_TTL_MS, Date.parse(item.epoch) + GNSS_MAX_ELEMENT_AGE_MS)).toISOString(),
        source_url: provider.url, provider: provider.name, evidence_kind: 'reference',
      });
      seen.add(item.noradId);
    } catch { /* A propagation failure must not produce a map point. */ }
  }
  return satellites;
}

async function readCatalog(response: Response): Promise<string> {
  if (Number(response.headers.get('content-length')) > MAX_BODY_BYTES) throw new Error('GNSS response exceeds size limit');
  if (!response.body) throw new Error('Empty GNSS response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) throw new Error('GNSS response exceeds size limit');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

export function createGnssCollector(options: { fetcher?: typeof fetch; now?: () => number } = {}) {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  let cached: { orbits: Orbit[]; provider: Provider; fetchedAt: number; statuses: SourceCollectionStatus[] } | null = null;
  let lastStatuses: SourceCollectionStatus[] = [];
  let retryAt = 0;
  let pending: Promise<void> | null = null;

  async function collect() {
    const statuses: SourceCollectionStatus[] = [];
    for (const provider of GNSS_PROVIDERS) {
      const collectedAt = new Date(now()).toISOString();
      const source = sourceIdentity(provider.id, provider.name, provider.url);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6500);
      try {
        const response = await fetcher(provider.url, { cache: 'no-store', signal: controller.signal, headers: { Accept: provider.format === 'omm' ? 'application/json' : 'text/plain' } });
        if (!response.ok) throw new Error(`HTTP_${response.status}`);
        const parsed = parseGnssCatalog(await readCatalog(response), provider.format);
        const satellites = projectGnss(parsed.orbits, provider, now());
        statuses.push(collectionStatus({
          source, availability: satellites.length ? 'ok' : 'error', dataState: satellites.length ? 'present' : 'unavailable',
          freshness: satellites.length ? 'fresh' : 'unknown', lastAttemptAt: collectedAt,
          lastSuccessfulFetchAt: satellites.length ? collectedAt : null,
          receivedRecords: parsed.received, acceptedRecords: satellites.length, rejectedRecords: parsed.received - satellites.length,
          errorCode: satellites.length ? null : 'NO_USABLE_GPS_ORBITS',
          message: satellites.length ? 'SGP4 orbital predictions; no receiver signal measurements.' : 'No current, valid GPS orbits; malformed, expired or unusable records omitted.',
        }));
        if (satellites.length) {
          cached = { orbits: parsed.orbits, provider, fetchedAt: now(), statuses };
          lastStatuses = statuses;
          return;
        }
      } catch (error) {
        statuses.push(collectionStatus({ source, availability: 'error', dataState: 'unavailable', lastAttemptAt: collectedAt,
          errorCode: controller.signal.aborted ? 'TIMEOUT' : 'FETCH_ERROR', message: error instanceof Error ? error.message : String(error) }));
      } finally { clearTimeout(timer); }
    }
    cached = null;
    lastStatuses = statuses;
    retryAt = now() + RETRY_MS;
  }

  return {
    async get() {
      if ((!cached || now() - cached.fetchedAt >= CATALOG_TTL_MS) && now() >= retryAt) {
        pending ??= collect().finally(() => { pending = null; });
        await pending;
      }
      const snapshot = cached;
      const satellites = snapshot ? projectGnss(snapshot.orbits, snapshot.provider, now()) : [];
      const status = (snapshot?.statuses ?? lastStatuses).map((entry) => {
        if (entry.source.providerId !== snapshot?.provider.id) return entry;
        return { ...entry, acceptedRecords: satellites.length, rejectedRecords: entry.receivedRecords - satellites.length,
          availability: satellites.length ? 'ok' as const : 'error' as const,
          dataState: satellites.length ? 'present' as const : 'unavailable' as const,
          freshness: satellites.length ? 'fresh' as const : 'stale' as const };
      });
      return {
        httpStatus: satellites.length ? 200 : 503,
        payload: {
          gnss_satellites: satellites, total: satellites.length, status,
          timestamp: new Date(now()).toISOString(), collectedAt: snapshot ? new Date(snapshot.fetchedAt).toISOString() : null,
          source_url: GNSS_REPO, alternate_sources: GNSS_PROVIDERS.map((provider) => ({ provider: provider.name, url: provider.url })),
          attribution: { name: 'Ringmast4r/GNSS', url: GNSS_REPO, license: 'CC BY 4.0', license_url: 'https://creativecommons.org/licenses/by/4.0/',
            changes: 'Overseer adds validated catalog collection, current CelesTrak alternate, SGP4 map predictions and expiry checks.' },
          note: 'Predicted GPS satellite positions from orbital elements, not measured receiver visibility, signal strength, fix status or jamming.',
        },
      };
    },
  };
}
