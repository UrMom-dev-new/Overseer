import { NextRequest, NextResponse } from 'next/server';
import { collectionStatus, nowIso, sourceIdentity, updateSourceStatuses } from '@/lib/feed-integrity';
import {
  FED_FILES,
  FED_REPO,
  fedBlobUrl,
  fedRawUrl,
  normalizeFedRolodex,
  type FedFileKey,
} from '@/lib/feed-integrity/fed';
import type { SourceCollectionStatus } from '@/lib/feed-integrity';

const FETCH_TIMEOUT_MS = 20_000;
const MEMORY_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTITIES = 2000;
const MAX_ENTITIES_LIMIT = 10_000;
const DEFAULT_MAX_CENTERS = 3000;
const MAX_CENTERS_LIMIT = 10_000;

interface FetchedFedFile {
  key: FedFileKey;
  text: string | null;
  status: SourceCollectionStatus;
}

interface CachedPayload {
  storedAtMs: number;
  cacheKey: string;
  payload: Record<string, unknown>;
  statuses: SourceCollectionStatus[];
}

const globalForFed = globalThis as unknown as {
  overseerFedRolodexCache?: Map<string, CachedPayload>;
};

if (!globalForFed.overseerFedRolodexCache) {
  globalForFed.overseerFedRolodexCache = new Map();
}

function parsePositiveParam(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

async function fetchFedFile(key: FedFileKey, collectedAt: string): Promise<FetchedFedFile> {
  const file = FED_FILES[key];
  const rawUrl = fedRawUrl(file.path);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(rawUrl, {
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Accept: 'text/markdown, text/plain;q=0.9, */*;q=0.5',
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
          message: `GitHub raw returned HTTP ${response.status}; the GitHub blob page is the alternate source view: ${fedBlobUrl(file.path)}`,
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
  const searchParams = request.nextUrl.searchParams;
  const maxEntities = parsePositiveParam(searchParams.get('maxEntities'), DEFAULT_MAX_ENTITIES, MAX_ENTITIES_LIMIT);
  const maxCenters = parsePositiveParam(searchParams.get('maxCenters'), DEFAULT_MAX_CENTERS, MAX_CENTERS_LIMIT);
  const cacheKey = `${maxEntities}:${maxCenters}`;
  const cache = globalForFed.overseerFedRolodexCache!;
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

  const fetched = await Promise.all((Object.keys(FED_FILES) as FedFileKey[]).map((key) => fetchFedFile(key, collectedAt)));
  const byKey = Object.fromEntries(fetched.map((file) => [file.key, file.text])) as Record<FedFileKey, string | null>;
  const fetchStatuses = fetched.map((file) => file.status);
  const usableDatabaseFiles = [byKey.spy, byKey.cultural].filter((text) => text?.trim()).length;

  if (usableDatabaseFiles === 0) {
    updateSourceStatuses(fetchStatuses);
    return NextResponse.json({
      intelligence_entities: [],
      cultural_centers: [],
      summaries: [],
      total: 0,
      status: fetchStatuses,
      timestamp: collectedAt,
      source: 'Ringmast4r/FED',
      source_url: FED_REPO,
      alternate_source_url: FED_REPO,
      error: 'No FED database Markdown files were available from GitHub raw.',
    }, { status: 503 });
  }

  const normalized = normalizeFedRolodex({
    readmeMarkdown: byKey.readme,
    spyMarkdown: byKey.spy,
    culturalMarkdown: byKey.cultural,
    collectedAt,
    maxEntities,
    maxCenters,
  });
  const statuses = [...fetchStatuses.filter((status) => status.availability !== 'ok'), ...normalized.statuses];
  updateSourceStatuses(statuses);

  const payload = {
    intelligence_entities: normalized.intelligenceEntities,
    cultural_centers: normalized.culturalCenters,
    summaries: normalized.summaries,
    total: normalized.counts.acceptedIntelligenceEntities + normalized.counts.acceptedCulturalCenters,
    counts: normalized.counts,
    status: statuses,
    timestamp: collectedAt,
    source: 'Ringmast4r/FED',
    source_url: FED_REPO,
    alternate_source_url: FED_REPO,
    notes: [
      'FED records are public Markdown reference entries, not live observations, official confirmations, or vulnerability findings.',
      'Unavailable Markdown files are omitted and reported in provider status rather than replaced with synthetic agencies or centers.',
      'Descriptions and intelligence-connection notes remain source text from FED and are not independently verified by Overseer.',
    ],
  };

  cache.set(cacheKey, { storedAtMs: Date.now(), cacheKey, payload, statuses });
  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=43200' },
  });
}
