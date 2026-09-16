import { NextRequest, NextResponse } from 'next/server';
import { collectionStatus, nowIso, sourceIdentity, updateSourceStatuses } from '@/lib/feed-integrity';
import { normalizeSurveillanceCapabilities } from '@/lib/feed-integrity/surveillance-capabilities';
import type { SourceCollectionStatus } from '@/lib/feed-integrity';

const RAW_BASE = 'https://raw.githubusercontent.com/Ringmast4r/surveillance-capabilities-map/main';
const FETCH_TIMEOUT_MS = 25_000;
const MEMORY_TTL_MS = 6 * 60 * 60 * 1000;

const SOURCE_FILES = {
  atlasCsv: {
    providerId: 'surveillance-capabilities-map:atlas',
    providerName: 'EFF Atlas via Surveillance Capabilities Map',
    path: 'atlas-of-surveillance.csv',
  },
  contractsCsv: {
    providerId: 'surveillance-capabilities-map:contracts',
    providerName: 'USASpending contracts via Surveillance Capabilities Map',
    path: 'surveillance-contracts.csv',
  },
  grantsCsv: {
    providerId: 'surveillance-capabilities-map:grants',
    providerName: 'USASpending grants via Surveillance Capabilities Map',
    path: 'surveillance-grants.csv',
  },
  transfersCsv: {
    providerId: 'surveillance-capabilities-map:1033',
    providerName: 'Washington Post 1033 data via Surveillance Capabilities Map',
    path: 'wapo-1033-data.csv',
  },
  cityCoordsJson: {
    providerId: 'surveillance-capabilities-map:city-coords',
    providerName: 'City coordinates via Surveillance Capabilities Map',
    path: 'city_coords.json',
  },
  flightPathsJson: {
    providerId: 'surveillance-capabilities-map:flight-paths',
    providerName: 'BuzzFeed surveillance flight paths via Surveillance Capabilities Map',
    path: 'flight_paths.json',
  },
} as const;

type SourceKey = keyof typeof SOURCE_FILES;

interface CachedPayload {
  storedAtMs: number;
  cacheKey: string;
  payload: Record<string, unknown>;
  statuses: SourceCollectionStatus[];
}

const globalForSurveillance = globalThis as unknown as {
  overseerSurveillanceCapabilitiesCache?: Map<string, CachedPayload>;
};

if (!globalForSurveillance.overseerSurveillanceCapabilitiesCache) {
  globalForSurveillance.overseerSurveillanceCapabilitiesCache = new Map();
}

function parsePositiveParam(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

async function fetchText(key: SourceKey, collectedAt: string): Promise<{ key: SourceKey; text: string | null; status: SourceCollectionStatus }> {
  const source = SOURCE_FILES[key];
  const url = `${RAW_BASE}/${source.path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'text/csv, application/json, text/plain;q=0.9, */*;q=0.5' },
    });
    if (!response.ok) {
      return {
        key,
        text: null,
        status: collectionStatus({
          source: sourceIdentity(source.providerId, source.providerName, url),
          availability: response.status === 403 || response.status === 429 ? 'rate_limited' : 'error',
          dataState: 'unavailable',
          freshness: 'unknown',
          lastAttemptAt: collectedAt,
          errorCode: `HTTP_${response.status}`,
          message: `GitHub raw source returned HTTP ${response.status}`,
        }),
      };
    }
    const text = await response.text();
    return {
      key,
      text,
      status: collectionStatus({
        source: sourceIdentity(source.providerId, source.providerName, url),
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
        source: sourceIdentity(source.providerId, source.providerName, url),
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
  const searchParams = request.nextUrl.searchParams;
  const maxRecords = parsePositiveParam(searchParams.get('maxRecords'), 5000, 20000);
  const maxLocations = parsePositiveParam(searchParams.get('maxLocations'), 2500, 10000);
  const maxFlights = parsePositiveParam(searchParams.get('maxFlights'), 250, 1500);
  const cacheKey = `${maxRecords}:${maxLocations}:${maxFlights}`;
  const cache = globalForSurveillance.overseerSurveillanceCapabilitiesCache!;
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

  const fetched = await Promise.all((Object.keys(SOURCE_FILES) as SourceKey[]).map((key) => fetchText(key, collectedAt)));
  const texts = Object.fromEntries(fetched.map((result) => [result.key, result.text])) as Record<SourceKey, string | null>;
  const fetchStatuses = fetched.map((result) => result.status);
  const usableSources = fetched.filter((result) => result.text && result.text.trim()).length;

  if (usableSources === 0) {
    updateSourceStatuses(fetchStatuses);
    return NextResponse.json({
      records: [],
      locations: [],
      flight_paths: [],
      total: 0,
      status: fetchStatuses,
      timestamp: collectedAt,
      source: 'Ringmast4r/surveillance-capabilities-map',
      source_url: 'https://github.com/Ringmast4r/surveillance-capabilities-map',
      error: 'No surveillance capability source files were available from GitHub raw.',
    }, { status: 503 });
  }

  const normalized = normalizeSurveillanceCapabilities({
    atlasCsv: texts.atlasCsv,
    contractsCsv: texts.contractsCsv,
    grantsCsv: texts.grantsCsv,
    transfersCsv: texts.transfersCsv,
    cityCoordsJson: texts.cityCoordsJson,
    flightPathsJson: texts.flightPathsJson,
    collectedAt,
    maxRecords,
    maxLocations,
    maxFlights,
  });
  const statuses = [...fetchStatuses.filter((status) => status.availability !== 'ok'), ...normalized.statuses];
  updateSourceStatuses(statuses);

  const payload = {
    records: normalized.records,
    locations: normalized.locations,
    flight_paths: normalized.flightPaths,
    total: normalized.counts.acceptedRecords,
    counts: normalized.counts,
    status: statuses,
    timestamp: collectedAt,
    source: 'Ringmast4r/surveillance-capabilities-map',
    source_url: 'https://github.com/Ringmast4r/surveillance-capabilities-map',
    notes: [
      'Reference/report dataset, not live surveillance observations.',
      'State centroid points are labeled region precision when a source row lacks usable city coordinates.',
      'Returned records, locations, and flight paths may be capped for dashboard performance; counts report accepted upstream records separately.',
    ],
  };

  cache.set(cacheKey, { storedAtMs: Date.now(), cacheKey, payload, statuses });
  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=43200' },
  });
}
