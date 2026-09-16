import {
  buildMetadata,
  clampText,
  collectionStatus,
  isValidLngLat,
  pointGeometry,
  sourceIdentity,
  stableId,
} from './helpers';
import type { IntegrityMetadata, SourceCollectionStatus } from './types';

export const GLOBAL_DATA_CENTER_MAP_REPO = 'https://github.com/Ringmast4r/Global-Data-Center-Map';
export const GLOBAL_DATA_CENTER_MAP_RAW_BASE = 'https://raw.githubusercontent.com/Ringmast4r/Global-Data-Center-Map/main';

export const DATA_CENTER_SOURCE_FILES = {
  readme: {
    path: 'README.md',
    providerId: 'data-center-map:readme',
    providerName: 'Global Data Center Map README',
  },
  statistics: {
    path: 'STATISTICS.md',
    providerId: 'data-center-map:statistics',
    providerName: 'Global Data Center Map statistics',
  },
  json: {
    path: 'datacenters.json',
    providerId: 'data-center-map:datacenters-json',
    providerName: 'Global Data Center Map deduplicated JSON',
  },
  geojson: {
    path: 'datacenters.geojson',
    providerId: 'data-center-map:datacenters-geojson',
    providerName: 'Global Data Center Map coordinate GeoJSON',
  },
} as const;

export type DataCenterFileKey = keyof typeof DATA_CENTER_SOURCE_FILES;

export interface DataCenterRecord {
  id: string;
  name: string;
  operator: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  address: string | null;
  lat: number;
  lng: number;
  location_precision: 'unknown';
  location_note: string;
  source_file: string;
  source_url: string;
  raw_url: string;
  evidence_kind: 'reference';
  integrity: IntegrityMetadata;
}

export interface DataCenterSummary {
  id: string;
  source_file: string;
  source_url: string;
  raw_url: string;
  total_facilities: number;
  coordinate_facilities: number;
  country_count: number;
  operator_count: number;
  top_countries: Array<{ country: string; count: number }>;
  top_operators: Array<{ operator: string; count: number }>;
  metadata: Record<string, string>;
  evidence_kind: 'reference';
}

export interface DataCenterNormalizeInput {
  datacentersJson?: string | null;
  datacentersGeoJson?: string | null;
  statisticsMarkdown?: string | null;
  readmeMarkdown?: string | null;
  collectedAt: string;
  maxLocations?: number;
}

export interface DataCenterNormalizeResult {
  dataCenters: DataCenterRecord[];
  summaries: DataCenterSummary[];
  statuses: SourceCollectionStatus[];
  counts: {
    receivedFiles: number;
    acceptedFiles: number;
    rejectedFiles: number;
    receivedFacilities: number;
    acceptedCoordinateFacilities: number;
    rejectedCoordinateFacilities: number;
    returnedDataCenters: number;
    countryCount: number;
    operatorCount: number;
  };
}

interface RawDataCenter {
  name?: unknown;
  company?: unknown;
  street?: unknown;
  city?: unknown;
  state?: unknown;
  zip?: unknown;
  country?: unknown;
  address?: unknown;
  city_coords?: unknown;
}

interface GeoJsonFeature {
  type?: unknown;
  geometry?: {
    type?: unknown;
    coordinates?: unknown;
  } | null;
  properties?: Record<string, unknown> | null;
}

interface GeoJsonPayload {
  type?: unknown;
  features?: unknown;
}

export function normalizeGlobalDataCenters(input: DataCenterNormalizeInput): DataCenterNormalizeResult {
  const maxLocations = positiveInt(input.maxLocations, 5000);
  const statuses: SourceCollectionStatus[] = [];
  const summaries: DataCenterSummary[] = [];
  const fullRecords = parseDataCenterJson(input.datacentersJson);
  const geoFeatures = parseGeoJsonFeatures(input.datacentersGeoJson);
  const topCountries = summarizeCounts(fullRecords.map((record) => clean(record.country) ?? 'Unknown'), 'Unknown');
  const topOperators = summarizeCounts(fullRecords.map((record) => clean(record.company) ?? 'Unknown'), 'Unknown');
  const countryCount = new Set(fullRecords.map((record) => clean(record.country)).filter(Boolean)).size;
  const operatorCount = new Set(fullRecords.map((record) => clean(record.company)).filter(Boolean)).size;
  const metadata = {
    ...parseStatisticsMarkdown(input.statisticsMarkdown),
    ...parseReadmeStats(input.readmeMarkdown),
  };
  const allDataCenters: DataCenterRecord[] = [];
  let rejectedCoordinateFacilities = 0;

  for (const feature of geoFeatures) {
    const record = normalizeGeoFeature(feature, input.collectedAt);
    if (!record) {
      rejectedCoordinateFacilities++;
      continue;
    }
    allDataCenters.push(record);
  }

  const dataCenters = allDataCenters.slice(0, maxLocations);
  const jsonAvailable = fullRecords.length > 0;
  const summary = buildSummary({
    totalFacilities: fullRecords.length,
    coordinateFacilities: allDataCenters.length,
    countryCount,
    operatorCount,
    topCountries,
    topOperators,
    metadata,
  });
  summaries.push(summary);

  statuses.push(collectionStatus({
    source: sourceIdentity(DATA_CENTER_SOURCE_FILES.json.providerId, DATA_CENTER_SOURCE_FILES.json.providerName, dataCenterBlobUrl(DATA_CENTER_SOURCE_FILES.json.path)),
    availability: jsonAvailable ? 'ok' : 'error',
    dataState: jsonAvailable ? 'present' : 'unavailable',
    freshness: jsonAvailable ? 'fresh' : 'unknown',
    lastAttemptAt: input.collectedAt,
    lastSuccessfulFetchAt: jsonAvailable ? input.collectedAt : null,
    receivedRecords: fullRecords.length,
    acceptedRecords: fullRecords.length,
    errorCode: jsonAvailable ? null : 'DATA_CENTER_JSON_EMPTY',
    message: jsonAvailable ? null : 'datacenters.json was unavailable or did not parse into source records.',
  }));
  statuses.push(collectionStatus({
    source: sourceIdentity(DATA_CENTER_SOURCE_FILES.geojson.providerId, DATA_CENTER_SOURCE_FILES.geojson.providerName, dataCenterBlobUrl(DATA_CENTER_SOURCE_FILES.geojson.path)),
    availability: allDataCenters.length > 0 ? 'ok' : 'error',
    dataState: allDataCenters.length > 0 ? 'present' : 'unavailable',
    freshness: allDataCenters.length > 0 ? 'fresh' : 'unknown',
    lastAttemptAt: input.collectedAt,
    lastSuccessfulFetchAt: allDataCenters.length > 0 ? input.collectedAt : null,
    receivedRecords: geoFeatures.length,
    acceptedRecords: allDataCenters.length,
    rejectedRecords: rejectedCoordinateFacilities,
    errorCode: allDataCenters.length > 0 ? null : 'DATA_CENTER_GEOJSON_EMPTY',
    message: allDataCenters.length > 0
      ? allDataCenters.length > dataCenters.length ? `Returned ${dataCenters.length} of ${allDataCenters.length} coordinate-bearing data centers due to maxLocations cap.` : null
      : 'datacenters.geojson was unavailable or no valid source point geometries were parsed.',
  }));

  return {
    dataCenters,
    summaries,
    statuses,
    counts: {
      receivedFiles: [input.datacentersJson, input.datacentersGeoJson, input.statisticsMarkdown, input.readmeMarkdown].filter((value) => value !== undefined).length,
      acceptedFiles: [input.datacentersJson, input.datacentersGeoJson, input.statisticsMarkdown, input.readmeMarkdown].filter((value) => typeof value === 'string' && value.trim()).length,
      rejectedFiles: [input.datacentersJson, input.datacentersGeoJson, input.statisticsMarkdown, input.readmeMarkdown].filter((value) => value !== undefined && !(typeof value === 'string' && value.trim())).length,
      receivedFacilities: fullRecords.length,
      acceptedCoordinateFacilities: allDataCenters.length,
      rejectedCoordinateFacilities,
      returnedDataCenters: dataCenters.length,
      countryCount,
      operatorCount,
    },
  };
}

export function dataCenterBlobUrl(path: string): string {
  return `${GLOBAL_DATA_CENTER_MAP_REPO}/blob/main/${encodeURIComponent(path)}`;
}

export function dataCenterRawUrl(path: string): string {
  return `${GLOBAL_DATA_CENTER_MAP_RAW_BASE}/${encodeURIComponent(path)}`;
}

function normalizeGeoFeature(feature: GeoJsonFeature, collectedAt: string): DataCenterRecord | null {
  if (!feature || feature.type !== 'Feature') return null;
  const coordinates = feature.geometry?.coordinates;
  if (feature.geometry?.type !== 'Point' || !Array.isArray(coordinates)) return null;
  const lng = Number(coordinates[0]);
  const lat = Number(coordinates[1]);
  if (!isValidLngLat(lng, lat)) return null;
  const props = feature.properties ?? {};
  const name = clean(props.name);
  if (!name) return null;
  const operator = clean(props.company);
  const city = clean(props.city);
  const state = clean(props.state);
  const country = clean(props.country);
  const address = clean(props.address);
  const sourceFile = DATA_CENTER_SOURCE_FILES.geojson.path;
  const sourceUrl = dataCenterBlobUrl(sourceFile);
  const rawUrl = dataCenterRawUrl(sourceFile);
  const recordId = stableId('data-center', [name, operator, city, state, country, address, lat, lng]);
  return {
    id: recordId,
    name,
    operator,
    city,
    state,
    country,
    address,
    lat,
    lng,
    location_precision: 'unknown',
    location_note: 'Source coordinate from Global-Data-Center-Map. Upstream license notes that coordinate precision varies from building-level to city, state, or country centroid.',
    source_file: sourceFile,
    source_url: sourceUrl,
    raw_url: rawUrl,
    evidence_kind: 'reference',
    integrity: buildMetadata({
      recordId,
      upstreamId: recordId,
      source: sourceIdentity(DATA_CENTER_SOURCE_FILES.geojson.providerId, DATA_CENTER_SOURCE_FILES.geojson.providerName, sourceUrl),
      itemUrl: sourceUrl,
      originalPublisher: 'Ringmast4r/Global-Data-Center-Map',
      evidenceKind: 'reference',
      verification: 'unassessed',
      methodology: 'Parsed only explicit Point features from the upstream datacenters.geojson file. Facilities without valid source point geometry are omitted from plotted records instead of geocoded or inferred.',
      timing: { collectedAt },
      location: {
        geometry: pointGeometry(lng, lat),
        representativePoint: [lng, lat],
        precision: 'unknown',
        relationship: 'source_location',
        resolutionMethod: 'upstream_geojson_coordinate',
        qualityFlags: ['upstream_precision_varies'],
      },
      evidenceReferences: [
        { label: 'Global Data Center Map GeoJSON', url: sourceUrl },
        { label: 'Source repository', url: GLOBAL_DATA_CENTER_MAP_REPO },
      ],
    }),
  };
}

function buildSummary(args: {
  totalFacilities: number;
  coordinateFacilities: number;
  countryCount: number;
  operatorCount: number;
  topCountries: Array<{ label: string; count: number }>;
  topOperators: Array<{ label: string; count: number }>;
  metadata: Record<string, string>;
}): DataCenterSummary {
  const sourceFile = DATA_CENTER_SOURCE_FILES.json.path;
  return {
    id: stableId('data-center-summary', [sourceFile]),
    source_file: sourceFile,
    source_url: dataCenterBlobUrl(sourceFile),
    raw_url: dataCenterRawUrl(sourceFile),
    total_facilities: args.totalFacilities,
    coordinate_facilities: args.coordinateFacilities,
    country_count: args.countryCount,
    operator_count: args.operatorCount,
    top_countries: args.topCountries.map((entry) => ({ country: entry.label, count: entry.count })),
    top_operators: args.topOperators.map((entry) => ({ operator: entry.label, count: entry.count })),
    metadata: args.metadata,
    evidence_kind: 'reference',
  };
}

function parseDataCenterJson(value: string | null | undefined): RawDataCenter[] {
  if (!value?.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((record): record is RawDataCenter => Boolean(record) && typeof record === 'object' && !Array.isArray(record));
  } catch {
    return [];
  }
}

function parseGeoJsonFeatures(value: string | null | undefined): GeoJsonFeature[] {
  if (!value?.trim()) return [];
  try {
    const parsed = JSON.parse(value) as GeoJsonPayload;
    if (parsed.type !== 'FeatureCollection' || !Array.isArray(parsed.features)) return [];
    return parsed.features.filter((feature): feature is GeoJsonFeature => Boolean(feature) && typeof feature === 'object' && !Array.isArray(feature));
  } catch {
    return [];
  }
}

function parseStatisticsMarkdown(value: string | null | undefined): Record<string, string> {
  if (!value) return {};
  const stats: Record<string, string> = {};
  const statPattern = /^- \*\*([^*]+)\*\*:\s*(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = statPattern.exec(value))) {
    const key = match[1].toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const statValue = clampText(match[2], 80);
    if (key && statValue) stats[key] = statValue;
  }
  return stats;
}

function parseReadmeStats(value: string | null | undefined): Record<string, string> {
  if (!value) return {};
  const stats: Record<string, string> = {};
  const rows = value.match(/\|\s*[^|]+\|\s*[\d,]+\s*\|/g) ?? [];
  for (const row of rows) {
    const cells = row.split('|').map((cell) => cell.trim()).filter(Boolean);
    if (cells.length < 2) continue;
    const key = cells[0].toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (key && /^[\d,]+$/.test(cells[1])) stats[`readme_${key}`] = cells[1];
  }
  return stats;
}

function summarizeCounts(values: string[], unknownLabel: string): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values) {
    const label = value || unknownLabel;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 30);
}

function clean(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text || null;
}

function positiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}
