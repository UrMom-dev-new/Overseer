import { NextResponse } from 'next/server';
import {
  collectionStatus,
  isSnapshotUsable,
  nowIso,
  readSnapshot,
  sourceIdentity,
  updateSourceStatuses,
  writeSnapshot,
  type SourceCollectionStatus,
} from '@/lib/feed-integrity';
import { normalizeGdeltGeoJson, type NormalizedGdeltMention } from '@/lib/feed-integrity/gdelt';

export const dynamic = 'force-dynamic';

const GDELT_SOURCE = sourceIdentity('gdelt-geo', 'GDELT 2.0 GeoJSON API', 'https://api.gdeltproject.org/api/v2/geo/geo');
const QUERY = '(protest OR riot OR unrest OR conflict OR military OR attack OR strike OR coup OR revolution OR emergency)';
const TIMESPAN = '24h';
const MAXPOINTS = 250;
const REFRESH_MS = 15 * 60 * 1000;
const MAX_LAST_KNOWN_GOOD_MS = 6 * 60 * 60 * 1000;
const DEFAULT_RETRY_MS = 15 * 60 * 1000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const CACHE_KEY = `real:gdelt-geo:${TIMESPAN}:${MAXPOINTS}:${QUERY}`;

let inFlight: Promise<QueryOutcome> | null = null;
let retryNotBeforeMs = 0;

interface QueryOutcome {
  records: NormalizedGdeltMention[];
  status: SourceCollectionStatus;
}

function gdeltUrl(): string {
  const params = new URLSearchParams({
    query: QUERY,
    format: 'GeoJSON',
    timespan: TIMESPAN,
    maxpoints: String(MAXPOINTS),
  });
  return `https://api.gdeltproject.org/api/v2/geo/geo?${params.toString()}`;
}

function cacheAgeMs(nowMs: number): number | null {
  const cached = readSnapshot<NormalizedGdeltMention>(CACHE_KEY);
  if (!cached) return null;
  return Math.max(0, nowMs - cached.storedAtMs);
}

function retryAfterMs(response: Response, nowMs: number): number {
  const value = response.headers.get('Retry-After');
  if (!value) return DEFAULT_RETRY_MS;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(DEFAULT_RETRY_MS, seconds * 1000);
  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(DEFAULT_RETRY_MS, dateMs - nowMs) : DEFAULT_RETRY_MS;
}

function cachedOutcome(nowMs: number, attemptAt: string, message: string, availability: 'partial' | 'rate_limited' | 'error', errorCode: string, nextRetryAt: string | null = null): QueryOutcome | null {
  const cached = readSnapshot<NormalizedGdeltMention>(CACHE_KEY);
  if (!isSnapshotUsable(cached, MAX_LAST_KNOWN_GOOD_MS, nowMs)) return null;
  return {
    records: cached.records,
    status: collectionStatus({
      source: GDELT_SOURCE,
      availability,
      dataState: cached.records.length ? 'present' : 'empty',
      freshness: 'stale',
      lastAttemptAt: attemptAt,
      lastSuccessfulFetchAt: cached.status.lastSuccessfulFetchAt,
      nextRetryAt,
      servingLastKnownGood: true,
      errorCode,
      message,
      receivedRecords: cached.status.receivedRecords,
      acceptedRecords: cached.status.acceptedRecords,
      rejectedRecords: cached.status.rejectedRecords,
    }),
  };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new Error('RESPONSE_TOO_LARGE');
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) throw new Error('RESPONSE_TOO_LARGE');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('INVALID_JSON');
  }
}

async function refresh(): Promise<QueryOutcome> {
  const attemptAt = nowIso();
  const nowMs = Date.now();
  const url = gdeltUrl();

  if (nowMs < retryNotBeforeMs) {
    const nextRetryAt = new Date(retryNotBeforeMs).toISOString();
    const cached = cachedOutcome(nowMs, attemptAt, 'GDELT refresh is cooling down after an upstream failure; serving last successful data.', 'partial', 'COOLDOWN', nextRetryAt);
    if (cached) return cached;
  }

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/geo+json, application/json;q=0.9',
        'User-Agent': 'Overseer/0.2 (+https://github.com/UrMom-dev-new/Overseer)',
      },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(12_000),
    });

    if (!response.ok) {
      const retryMs = retryAfterMs(response, nowMs);
      retryNotBeforeMs = nowMs + retryMs;
      const nextRetryAt = new Date(retryNotBeforeMs).toISOString();
      const availability = response.status === 429 ? 'rate_limited' as const : 'error' as const;
      const cached = cachedOutcome(nowMs, attemptAt, `GDELT refresh returned HTTP ${response.status}; serving last successful data.`, availability, `HTTP_${response.status}`, nextRetryAt);
      if (cached) return cached;
      return {
        records: [],
        status: collectionStatus({
          source: GDELT_SOURCE,
          availability,
          dataState: 'unavailable',
          freshness: 'unknown',
          lastAttemptAt: attemptAt,
          nextRetryAt,
          errorCode: `HTTP_${response.status}`,
          message: `GDELT refresh failed with HTTP ${response.status}.`,
        }),
      };
    }

    const payload = await readBoundedJson(response);
    const normalized = normalizeGdeltGeoJson(payload, QUERY, url, attemptAt);
    if (!normalized) throw new Error('INVALID_SCHEMA');

    retryNotBeforeMs = 0;
    const status = collectionStatus({
      source: GDELT_SOURCE,
      availability: 'ok',
      dataState: normalized.records.length ? 'present' : 'empty',
      freshness: 'fresh',
      lastAttemptAt: attemptAt,
      lastSuccessfulFetchAt: attemptAt,
      receivedRecords: normalized.received,
      acceptedRecords: normalized.records.length,
      rejectedRecords: normalized.rejected,
      message: normalized.records.length ? 'GDELT returned geolocated news mentions.' : 'GDELT returned no matching geolocated mentions.',
    });
    writeSnapshot({ key: CACHE_KEY, records: normalized.records, status, storedAtMs: nowMs });
    return { records: normalized.records, status };
  } catch (error) {
    retryNotBeforeMs = Math.max(retryNotBeforeMs, nowMs + DEFAULT_RETRY_MS);
    const errorCode = error instanceof Error ? error.message : 'FETCH_ERROR';
    const cached = cachedOutcome(nowMs, attemptAt, 'GDELT refresh failed; serving last successful data.', 'error', errorCode, new Date(retryNotBeforeMs).toISOString());
    if (cached) return cached;
    return {
      records: [],
      status: collectionStatus({
        source: GDELT_SOURCE,
        availability: 'error',
        dataState: 'unavailable',
        freshness: 'unknown',
        lastAttemptAt: attemptAt,
        nextRetryAt: new Date(retryNotBeforeMs).toISOString(),
        errorCode,
        message: 'GDELT source unavailable; no eligible last-successful data exists.',
      }),
    };
  }
}

async function collect(): Promise<QueryOutcome> {
  const nowMs = Date.now();
  const cached = readSnapshot<NormalizedGdeltMention>(CACHE_KEY);
  const age = cacheAgeMs(nowMs);
  if (cached && age !== null && age < REFRESH_MS) {
    return {
      records: cached.records,
      status: collectionStatus({
        ...cached.status,
        source: GDELT_SOURCE,
        availability: 'ok',
        dataState: cached.records.length ? 'present' : 'empty',
        freshness: 'fresh',
        lastAttemptAt: cached.status.lastAttemptAt,
        lastSuccessfulFetchAt: cached.status.lastSuccessfulFetchAt,
        servingLastKnownGood: false,
        message: 'Serving recent GDELT snapshot; refresh not yet due.',
      }),
    };
  }
  if (!inFlight) inFlight = refresh().finally(() => { inFlight = null; });
  return inFlight;
}

export async function GET() {
  const outcome = await collect();
  updateSourceStatuses([outcome.status]);
  const unavailable = outcome.status.dataState === 'unavailable';
  const collectedAt = nowIso();
  return NextResponse.json({
    events: outcome.records,
    total: outcome.records.length,
    timestamp: collectedAt,
    collectedAt,
    dataMode: 'real',
    evidenceKind: 'report',
    label: 'Geolocated news mentions',
    source: GDELT_SOURCE.providerName,
    status: [outcome.status],
    availability: outcome.status.availability,
    servingLastKnownGood: outcome.status.servingLastKnownGood,
    message: outcome.status.message,
  }, {
    status: unavailable ? 503 : 200,
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}
