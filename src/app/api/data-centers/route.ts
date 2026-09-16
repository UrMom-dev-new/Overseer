import { NextRequest, NextResponse } from 'next/server';
import { collectionStatus, nowIso, sourceIdentity, updateSourceStatuses } from '@/lib/feed-integrity';
import {
  DATA_CENTER_SOURCE_FILES,
  GLOBAL_DATA_CENTER_MAP_REPO,
  dataCenterBlobUrl,
  dataCenterRawUrl,
  normalizeGlobalDataCenters,
  type DataCenterFileKey,
} from '@/lib/feed-integrity/data-centers';
import type { SourceCollectionStatus } from '@/lib/feed-integrity';

const FETCH_TIMEOUT_MS = 25_000;
const MEMORY_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MAX_LOCATIONS = 5000;
const MAX_LOCATIONS_LIMIT = 10_000;

interface FetchedDataCenterFile {
  key: DataCenterFileKey;
  text: string | null;
  status: SourceCollectionStatus;
}

interface CachedPayload {
  storedAtMs: number;
  cacheKey: string;
  payload: Record<string, unknown>;
  statuses: SourceCollectionStatus[];
}

const globalForDataCenters = globalThis as unknown as {
  overseerDataCentersCache?: Map<string, CachedPayload>;
};

if (!globalForDataCenters.overseerDataCentersCache) {
  globalForDataCenters.overseerDataCentersCache = new Map();
}

function parsePositiveParam(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

async function fetchDataCenterFile(key: DataCenterFileKey, collectedAt: string): Promise<FetchedDataCenterFile> {
  const file = DATA_CENTER_SOURCE_FILES[key];
  const rawUrl = dataCenterRawUrl(file.path);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(rawUrl, {
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Accept: 'application/json, text/markdown, text/plain;q=0.9, */*;q=0.5',
        'User-Agent': 'Overseer-Source-Verifier',
      },
    });
    if (!response.ok) {
      return {
        key,
        text: null,
        status: collectionStatus({
          source: sourceIdentity(file.providerId, file.providerName, rawUrl),
          availability: response.status === 403 || response.status === 429 ? 'rate_limited' : 'error',
          dataState: 'unavailable',
          freshness: 'unknown',
          lastAttemptAt: collectedAt,
          errorCode: `HTTP_${response.status}`,
          message: `GitHub raw returned HTTP ${response.status}; the GitHub blob page is the alternate source view: ${dataCenterBlobUrl(file.path)}`,
        }),
      };
    }

    const text = await response.text();
    return {
      key,
      text,
      status: collectionStatus({
        source: sourceIdentity(file.providerId, file.providerName, rawUrl),
        availability: 'ok',
        dataState: text.trim() ? 'present' : 'empty',
        freshness: 'fresh',
        lastAttemptAt: collectedAt,
        lastSuccessfulFetchAt: collectedAt,
        receivedRecords: text.length,
        acceptedRecords: text.trim() ? 1 : 0,
      }),
    };
  } catch (error) {
    return {
      key,
      text: null,
      status: collectionStatus({
        source: sourceIdentity(file.providerId, file.providerName, rawUrl),
        availability: 'error',
        dataState: 'unavailable',
        freshness: 'unknown',
        lastAttemptAt: collectedAt,
        errorCode: error instanceof Error && error.name === 'AbortError' ? 'TIMEOUT' : 'FETCH_ERROR',
        message: error instanceof Error ? error.message : String(error),
      }),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: NextRequest) {
  const collectedAt = nowIso();
  const maxLocations = parsePositiveParam(request.nextUrl.searchParams.get('maxLocations'), DEFAULT_MAX_LOCATIONS, MAX_LOCATIONS_LIMIT);
  const cacheKey = `${maxLocations}`;
  const cache = globalForDataCenters.overseerDataCentersCache!;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.storedAtMs <= MEMORY_TTL_MS) {
    updateSourceStatuses(cached.statuses);
    return NextResponse.json({
      ...cached.payload,
      cached: true,
      cacheStoredAt: new Date(cached.storedAtMs).toISOString(),
    }, {
      headers: { 'Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=43200' },
    });
  }

  const fetched = await Promise.all((Object.keys(DATA_CENTER_SOURCE_FILES) as DataCenterFileKey[]).map((key) => fetchDataCenterFile(key, collectedAt)));
  const byKey = Object.fromEntries(fetched.map((file) => [file.key, file.text])) as Record<DataCenterFileKey, string | null>;
  const fetchStatuses = fetched.map((file) => file.status);
  const usableSources = [byKey.json, byKey.geojson].filter((text) => text?.trim()).length;

  if (usableSources === 0) {
    updateSourceStatuses(fetchStatuses);
    return NextResponse.json({
      data_centers: [],
      summaries: [],
      total: 0,
      status: fetchStatuses,
      timestamp: collectedAt,
      source: 'Ringmast4r/Global-Data-Center-Map',
      source_url: GLOBAL_DATA_CENTER_MAP_REPO,
      alternate_source_url: GLOBAL_DATA_CENTER_MAP_REPO,
      error: 'No Global Data Center Map JSON or GeoJSON source files were available from GitHub raw.',
    }, { status: 503 });
  }

  const normalized = normalizeGlobalDataCenters({
    datacentersJson: byKey.json,
    datacentersGeoJson: byKey.geojson,
    statisticsMarkdown: byKey.statistics,
    readmeMarkdown: byKey.readme,
    collectedAt,
    maxLocations,
  });
  const statuses = [...fetchStatuses.filter((status) => status.availability !== 'ok'), ...normalized.statuses];
  updateSourceStatuses(statuses);

  const payload = {
    data_centers: normalized.dataCenters,
    summaries: normalized.summaries,
    total: normalized.counts.acceptedCoordinateFacilities,
    counts: normalized.counts,
    status: statuses,
    timestamp: collectedAt,
    source: 'Ringmast4r/Global-Data-Center-Map',
    source_url: GLOBAL_DATA_CENTER_MAP_REPO,
    alternate_source_url: GLOBAL_DATA_CENTER_MAP_REPO,
    attribution: 'Data centers (c) Ringmast4r - Global-Data-Center-Map',
    notes: [
      'Reference dataset, not live operational telemetry.',
      'Only source GeoJSON Point features are returned as plotted data_centers. Facilities without valid source coordinates are counted in summaries but not geocoded or inferred.',
      'Upstream license notes coordinate precision varies from building-level to city, state, or country centroid; Overseer marks precision as unknown rather than exact.',
      normalized.counts.acceptedCoordinateFacilities > normalized.counts.returnedDataCenters
        ? `Returned ${normalized.counts.returnedDataCenters} of ${normalized.counts.acceptedCoordinateFacilities} coordinate-bearing records due to maxLocations=${maxLocations}.`
        : null,
    ].filter(Boolean),
  };

  cache.set(cacheKey, { storedAtMs: Date.now(), cacheKey, payload, statuses });
  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=43200' },
  });
}
