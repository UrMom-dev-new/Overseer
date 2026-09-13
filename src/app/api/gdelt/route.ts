import { NextResponse } from 'next/server';
import { stealthFetch } from '@/lib/stealthFetch';
import {
  coalesce,
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
const QUERIES = [
  'protest OR riot OR unrest',
  'conflict OR military OR attack OR strike',
  'coup OR revolution OR emergency',
];
const TIMESPAN = '24h';
const MAXPOINTS = 100;
const STALE_AFTER_MS = 15 * 60 * 1000;
const MAX_LAST_KNOWN_GOOD_MS = 6 * 60 * 60 * 1000;

interface QueryOutcome {
  records: NormalizedGdeltMention[];
  status: SourceCollectionStatus;
  fromCache: boolean;
}

function cacheKey(query: string): string {
  return `real:gdelt-geo:${TIMESPAN}:${MAXPOINTS}:${query}`;
}

function freshness(lastSuccessfulFetchAt: string | null, nowMs: number): 'fresh' | 'stale' | 'unknown' {
  if (!lastSuccessfulFetchAt) return 'unknown';
  return nowMs - new Date(lastSuccessfulFetchAt).getTime() > STALE_AFTER_MS ? 'stale' : 'fresh';
}

function gdeltUrl(query: string): string {
  return `https://api.gdeltproject.org/api/v2/geo/geo?query=${encodeURIComponent(query)}&format=GeoJSON&timespan=${TIMESPAN}&maxpoints=${MAXPOINTS}`;
}

function retryAfterIso(response: Response, nowMs: number): string | null {
  const retryAfter = response.headers.get('Retry-After');
  if (!retryAfter) return null;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds)) return new Date(nowMs + seconds * 1000).toISOString();
  const date = new Date(retryAfter);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

async function collectQuery(query: string): Promise<QueryOutcome> {
  return coalesce(cacheKey(query), async () => {
    const attemptAt = nowIso();
    const nowMs = Date.now();
    const url = gdeltUrl(query);

    try {
      const res = await stealthFetch(url, {
        signal: AbortSignal.timeout(8000),
        cache: 'no-store',
      });

      if (!res.ok) {
        const cached = readSnapshot<NormalizedGdeltMention>(cacheKey(query));
        if (isSnapshotUsable(cached, MAX_LAST_KNOWN_GOOD_MS, nowMs)) {
          return {
            records: cached.records,
            fromCache: true,
            status: collectionStatus({
              source: { ...GDELT_SOURCE, providerId: `${GDELT_SOURCE.providerId}:${query}` },
              availability: res.status === 429 ? 'rate_limited' : 'error',
              dataState: cached.records.length > 0 ? 'present' : 'empty',
              freshness: freshness(cached.status.lastSuccessfulFetchAt, nowMs),
              lastAttemptAt: attemptAt,
              lastSuccessfulFetchAt: cached.status.lastSuccessfulFetchAt,
              nextRetryAt: retryAfterIso(res, nowMs),
              servingLastKnownGood: true,
              errorCode: `HTTP_${res.status}`,
              message: `Refresh failed for GDELT query; showing last successful data from ${cached.status.lastSuccessfulFetchAt ?? 'unknown time'}.`,
              receivedRecords: cached.status.receivedRecords,
              acceptedRecords: cached.status.acceptedRecords,
              rejectedRecords: cached.status.rejectedRecords,
            }),
          };
        }

        return {
          records: [],
          fromCache: false,
          status: collectionStatus({
            source: { ...GDELT_SOURCE, providerId: `${GDELT_SOURCE.providerId}:${query}` },
            availability: res.status === 429 ? 'rate_limited' : 'error',
            dataState: 'unavailable',
            freshness: 'unknown',
            lastAttemptAt: attemptAt,
            nextRetryAt: retryAfterIso(res, nowMs),
            errorCode: `HTTP_${res.status}`,
            message: `GDELT query refresh failed with HTTP ${res.status}.`,
          }),
        };
      }

      let payload: unknown;
      try {
        payload = await res.json();
      } catch {
        throw new Error('INVALID_JSON');
      }

      const normalized = normalizeGdeltGeoJson(payload, query, url, attemptAt);
      if (!normalized) throw new Error('INVALID_SCHEMA');

      const status = collectionStatus({
        source: { ...GDELT_SOURCE, providerId: `${GDELT_SOURCE.providerId}:${query}` },
        availability: 'ok',
        dataState: normalized.records.length > 0 ? 'present' : 'empty',
        freshness: 'fresh',
        lastAttemptAt: attemptAt,
        lastSuccessfulFetchAt: attemptAt,
        receivedRecords: normalized.received,
        acceptedRecords: normalized.records.length,
        rejectedRecords: normalized.rejected,
        message: normalized.records.length > 0 ? 'GDELT query returned geolocated news mentions.' : 'No matching records returned.',
      });

      writeSnapshot({
        key: cacheKey(query),
        records: normalized.records,
        status,
        storedAtMs: nowMs,
      });

      return { records: normalized.records, status, fromCache: false };
    } catch (error) {
      const errorCode = error instanceof DOMException && error.name === 'TimeoutError'
        ? 'TIMEOUT'
        : error instanceof Error
          ? error.message
          : 'FETCH_ERROR';
      const cached = readSnapshot<NormalizedGdeltMention>(cacheKey(query));
      if (isSnapshotUsable(cached, MAX_LAST_KNOWN_GOOD_MS, nowMs)) {
        return {
          records: cached.records,
          fromCache: true,
          status: collectionStatus({
            source: { ...GDELT_SOURCE, providerId: `${GDELT_SOURCE.providerId}:${query}` },
            availability: 'error',
            dataState: cached.records.length > 0 ? 'present' : 'empty',
            freshness: freshness(cached.status.lastSuccessfulFetchAt, nowMs),
            lastAttemptAt: attemptAt,
            lastSuccessfulFetchAt: cached.status.lastSuccessfulFetchAt,
            servingLastKnownGood: true,
            errorCode,
            message: `Refresh failed for GDELT query; showing last successful data from ${cached.status.lastSuccessfulFetchAt ?? 'unknown time'}.`,
            receivedRecords: cached.status.receivedRecords,
            acceptedRecords: cached.status.acceptedRecords,
            rejectedRecords: cached.status.rejectedRecords,
          }),
        };
      }

      return {
        records: [],
        fromCache: false,
        status: collectionStatus({
          source: { ...GDELT_SOURCE, providerId: `${GDELT_SOURCE.providerId}:${query}` },
          availability: 'error',
          dataState: 'unavailable',
          freshness: 'unknown',
          lastAttemptAt: attemptAt,
          errorCode,
          message: 'GDELT source unavailable; no last successful data is eligible.',
        }),
      };
    }
  });
}

function aggregateAvailability(statuses: SourceCollectionStatus[]): 'ok' | 'partial' | 'error' | 'rate_limited' {
  const healthy = statuses.filter((s) => s.availability === 'ok').length;
  if (healthy === statuses.length) return 'ok';
  if (healthy > 0 || statuses.some((s) => s.servingLastKnownGood)) return 'partial';
  if (statuses.some((s) => s.availability === 'rate_limited')) return 'rate_limited';
  return 'error';
}

export async function GET() {
  const outcomes = await Promise.all(QUERIES.map(collectQuery));
  const statuses = outcomes.map((outcome) => outcome.status);
  updateSourceStatuses(statuses);

  const events = outcomes.flatMap((outcome) => outcome.records);
  const availability = aggregateAvailability(statuses);
  const unavailableWithoutCache = statuses.every((status) => status.dataState === 'unavailable');
  const collectedAt = nowIso();

  return NextResponse.json(
    {
      events,
      total: events.length,
      timestamp: collectedAt,
      collectedAt,
      dataMode: 'real',
      evidenceKind: 'report',
      label: 'Geolocated news mentions',
      source: GDELT_SOURCE.providerName,
      status: statuses,
      alternate_sources: [
        { name: 'GDACS RSS', url: 'https://www.gdacs.org/xml/rss.xml', note: 'Disaster reports; not a direct replacement for GDELT news mentions.' },
        { name: 'ACLED', url: 'https://acleddata.com/data-export-tool/', note: 'Conflict-event data; may require credentials.' },
      ],
      availability,
      servingLastKnownGood: statuses.some((status) => status.servingLastKnownGood),
      message: unavailableWithoutCache ? 'Source unavailable.' : events.length === 0 ? 'No matching records returned.' : 'Geolocated news mentions returned.',
    },
    {
      status: unavailableWithoutCache ? 503 : 200,
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    }
  );
}
