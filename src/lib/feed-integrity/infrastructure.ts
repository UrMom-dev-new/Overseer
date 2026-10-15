import { INFRASTRUCTURE_TTL_MS, type InfrastructureBounds, type InfrastructureSector } from '../infrastructure-catalog';
import { collectionStatus, isValidLngLat, parseDateOrNull, sourceIdentity } from './helpers';
import type { SourceCollectionStatus } from './types';
import { parseRetryAfterMs } from '../client-feed-store';

export const INFRASTRUCTURE_PROVIDERS = [
  { name: 'FOSSGIS Overpass', url: 'https://overpass-api.de/api/interpreter' },
  { name: 'Private.coffee Overpass', url: 'https://overpass.private.coffee/api/interpreter' },
] as const;
const MAX_ELEMENTS = 5000;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_REPLICA_AGE_MS = 48 * 60 * 60 * 1000;

type Geometry = { type: 'Point'; coordinates: number[] } | { type: 'LineString'; coordinates: number[][] } |
  { type: 'Polygon'; coordinates: number[][][] };
export interface InfrastructureAsset {
  id: string;
  name: string;
  sectors: InfrastructureSector[];
  geometry: Geometry;
  tags: Record<string, string>;
  source_url: string;
  source_id: string;
  sourceUpdatedAt: string | null;
  collectedAt: string;
  evidence_kind: 'reference';
  coordinate_precision: 'source_mapped' | 'unknown';
}
export interface InfrastructurePayload {
  assets: InfrastructureAsset[];
  status: SourceCollectionStatus[];
  bounds: InfrastructureBounds;
  sectors: InfrastructureSector[];
  fetchedAt: string | null;
  expiresAt: string | null;
  replicaUpdatedAt: string | null;
  attribution: string;
  license_url: string;
  alternate_sources: { name: string; url: string }[];
  error?: string;
}

const tagRules: Record<InfrastructureSector, [string, string[]][]> = {
  power: [['power', ['plant', 'substation', 'line', 'minor_line']]],
  water: [['man_made', ['water_works', 'water_tower', 'reservoir_covered', 'water_well']], ['amenity', ['drinking_water']], ['waterway', ['dam']]],
  wastewater: [['man_made', ['wastewater_plant', 'sewage_pumping_station']], ['substance', ['sewage']]],
  medical: [['amenity', ['hospital', 'clinic']], ['healthcare', ['hospital', 'clinic', 'centre']]],
  telecom: [['man_made', ['communications_tower']], ['telecom', ['exchange', 'data_center']], ['tower:type', ['communication']]],
};
const lifecyclePrefixes = ['', 'construction:', 'disused:', 'abandoned:', 'demolished:'];

export function buildInfrastructureQuery(bounds: InfrastructureBounds, sectors: InfrastructureSector[]): string {
  const [west, south, east, north] = bounds;
  const selectors = sectors.flatMap((sector) => tagRules[sector].map(([key, values]) =>
    `nw[~"^(${lifecyclePrefixes.filter(Boolean).join('|')})?${key}$"~"^(${values.join('|')})$"](${south},${west},${north},${east});`));
  return `[out:json][timeout:10][maxsize:16777216];(${selectors.join('')});out meta geom ${MAX_ELEMENTS + 1};`;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeInfrastructure(payload: unknown, sectors: InfrastructureSector[], collectedAt: string): {
  assets: InfrastructureAsset[]; received: number; rejected: number; replicaUpdatedAt: string;
} {
  if (!record(payload) || !Array.isArray(payload.elements) || !record(payload.osm3s) || payload.remark) {
    throw new Error('Malformed or incomplete Overpass response; no assets accepted.');
  }
  const replicaUpdatedAt = parseDateOrNull(payload.osm3s.timestamp_osm_base);
  const age = Date.parse(collectedAt) - Date.parse(replicaUpdatedAt ?? '');
  if (!Number.isFinite(age) || age > MAX_REPLICA_AGE_MS || age < -5 * 60 * 1000) throw new Error('OSM replica timestamp is missing, expired, or invalid.');
  if (payload.elements.length > MAX_ELEMENTS) throw new Error('Infrastructure result exceeds 5,000 objects. Narrow the map area.');
  const assets: InfrastructureAsset[] = [];
  const seen = new Set<string>();
  let rejected = 0;
  for (const element of payload.elements) {
    if (!record(element) || !Number.isSafeInteger(element.id) || Number(element.id) <= 0 || !record(element.tags)) { rejected++; continue; }
    const tags = Object.fromEntries(Object.entries(element.tags).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
    const matched = sectors.filter((sector) => tagRules[sector].some(([key, values]) =>
      lifecyclePrefixes.some((prefix) => values.includes(tags[`${prefix}${key}`]))));
    const geometry = elementGeometry(element, tags);
    if (!matched.length || !geometry) { rejected++; continue; }
    const id = `osm:${element.type}/${element.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    assets.push({ id, name: tags.name || tags['name:en'] || `${element.type}/${element.id}`, sectors: matched, geometry, tags,
      source_url: `https://www.openstreetmap.org/${element.type}/${element.id}`, source_id: 'S01',
      sourceUpdatedAt: parseDateOrNull(element.timestamp), collectedAt, evidence_kind: 'reference', coordinate_precision: 'source_mapped' });
  }
  if (rejected) throw new Error('Unusable infrastructure records in the provider response; stream omitted.');
  return { assets, received: payload.elements.length, rejected, replicaUpdatedAt: replicaUpdatedAt! };
}

function elementGeometry(element: Record<string, unknown>, tags: Record<string, string>): Geometry | null {
  if (element.type === 'node') return isValidLngLat(element.lon, element.lat) ? { type: 'Point', coordinates: [element.lon as number, element.lat as number] } : null;
  if (element.type !== 'way' || !Array.isArray(element.geometry) || element.geometry.length < 2 ||
    !element.geometry.every((point) => record(point) && isValidLngLat(point.lon, point.lat))) return null;
  const coordinates = element.geometry.map((point) => [point.lon as number, point.lat as number]);
  if (new Set(coordinates.map((point) => point.join(','))).size < 2) return null;
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  const linear = tags.area === 'no' || lifecyclePrefixes.some((prefix) => ['line', 'minor_line'].includes(tags[`${prefix}power`])) || Boolean(tags.waterway) || Boolean(tags.substance);
  return !linear && coordinates.length >= 4 && first[0] === last[0] && first[1] === last[1] &&
    new Set(coordinates.map((point) => point.join(','))).size >= 3
    ? { type: 'Polygon', coordinates: [coordinates] } : { type: 'LineString', coordinates };
}

async function readBody(response: Response): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > MAX_BYTES || !response.body) throw new Error('Missing or oversized infrastructure response.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error('Infrastructure response exceeds 8 MiB.');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function createInfrastructureCollector(options: { fetcher?: typeof fetch; now?: () => number; timeoutMs?: number } = {}) {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { payload: InfrastructurePayload; until: number }>();
  const pending = new Map<string, Promise<InfrastructurePayload>>();
  const providerCooldown = new Map<string, number>();
  let nextQueryAt = 0;

  async function collect(bounds: InfrastructureBounds, sectors: InfrastructureSector[]): Promise<InfrastructurePayload> {
    const statuses: SourceCollectionStatus[] = [];
    const base = { bounds, sectors, attribution: 'OpenStreetMap contributors (ODbL 1.0)', license_url: 'https://www.openstreetmap.org/copyright',
      alternate_sources: [...INFRASTRUCTURE_PROVIDERS, { name: 'Geofabrik regional extracts (manual bulk alternative)', url: 'https://download.geofabrik.de/' }] };
    for (const provider of INFRASTRUCTURE_PROVIDERS) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 12_000);
      const attemptedAt = new Date(now()).toISOString();
      try {
        if ((providerCooldown.get(provider.url) ?? 0) > now()) throw new Error('Provider cooldown active after an upstream failure.');
        const response = await fetcher(provider.url, { method: 'POST', cache: 'no-store', signal: controller.signal,
          redirect: 'error',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: new URLSearchParams({ data: buildInfrastructureQuery(bounds, sectors) }).toString() });
        if (!response.ok) {
          if (response.status === 429 || response.status === 503) providerCooldown.set(provider.url, Math.max(now() + 30_000, parseRetryAfterMs(response.headers.get('retry-after'), now()) ?? 0));
          throw new Error(`HTTP ${response.status}`);
        }
        const normalized = normalizeInfrastructure(await readBody(response), sectors, new Date(now()).toISOString());
        const fetchedAt = new Date(now()).toISOString();
        for (const sector of sectors) statuses.push(collectionStatus({
          source: sourceIdentity(`infrastructure-${sector}:${new URL(provider.url).host}`, provider.name, provider.url),
          availability: normalized.rejected ? 'partial' : 'ok',
          dataState: normalized.assets.some((asset) => asset.sectors.includes(sector)) ? 'present' : 'empty', freshness: 'fresh',
          lastAttemptAt: attemptedAt, lastSuccessfulFetchAt: fetchedAt,
          acceptedRecords: normalized.assets.filter((asset) => asset.sectors.includes(sector)).length,
          rejectedRecords: normalized.rejected, receivedRecords: normalized.received,
          message: 'OSM reference geometry in the requested area. Object edit time is not an observation or operating-status assessment.',
        }));
        return { ...base, assets: normalized.assets, fetchedAt, expiresAt: new Date(now() + INFRASTRUCTURE_TTL_MS).toISOString(), replicaUpdatedAt: normalized.replicaUpdatedAt, status: statuses };
      } catch (error) {
        if ((providerCooldown.get(provider.url) ?? 0) <= now()) providerCooldown.set(provider.url, now() + 30_000);
        for (const sector of sectors) statuses.push(collectionStatus({
          source: sourceIdentity(`infrastructure-${sector}:${new URL(provider.url).host}`, provider.name, provider.url),
          availability: 'error', dataState: 'unavailable', freshness: 'unknown', lastAttemptAt: attemptedAt,
          nextRetryAt: new Date(providerCooldown.get(provider.url)!).toISOString(),
          message: error instanceof Error ? error.message : 'Infrastructure provider failed.', errorCode: 'INFRASTRUCTURE_UNAVAILABLE',
        }));
      } finally { clearTimeout(timer); }
    }
    return { ...base, assets: [], fetchedAt: null, expiresAt: null, replicaUpdatedAt: null, status: statuses, error: 'OSM query sources unavailable. No substitute assets were generated.' };
  }

  return async (bounds: InfrastructureBounds, sectors: InfrastructureSector[]): Promise<InfrastructurePayload> => {
    const key = JSON.stringify([bounds, [...sectors].sort()]);
    const cached = cache.get(key);
    if (cached && cached.until > now()) return cached.payload;
    const inflight = pending.get(key);
    if (inflight) return inflight;
    if (pending.size >= 2) throw new Error('Infrastructure query capacity reached. Retry shortly.');
    if (now() < nextQueryAt) throw new Error('Infrastructure query cooldown active. Retry shortly.');
    nextQueryAt = now() + 5_000;
    const promise = collect(bounds, sectors).then((payload) => {
      if (cache.size >= 24) cache.delete(cache.keys().next().value!);
      cache.set(key, { payload, until: payload.expiresAt ? Date.parse(payload.expiresAt) : now() + 30_000 });
      return payload;
    }).finally(() => pending.delete(key));
    pending.set(key, promise);
    return promise;
  };
}
