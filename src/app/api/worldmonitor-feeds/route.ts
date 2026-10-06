import { NextRequest, NextResponse } from 'next/server';
import { nowIso, updateSourceStatuses } from '@/lib/feed-integrity';
import {
  WORLD_MONITOR_REPO,
  WORLD_MONITOR_SOURCE_FILES,
  normalizeWorldMonitorFeedCatalog,
  type ExternalCatalogFile,
  worldMonitorRawUrl,
} from '@/lib/feed-integrity/external-feed-catalogs';

const FETCH_TIMEOUT_MS = 20_000;
const MEMORY_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MAX_FEEDS = 5000;
const MAX_FEEDS_LIMIT = 20_000;

interface CachedPayload {
  storedAtMs: number;
  payload: Record<string, unknown>;
  statuses: ReturnType<typeof normalizeWorldMonitorFeedCatalog>['statuses'];
}

const globalForWorldMonitorFeeds = globalThis as unknown as {
  overseerWorldMonitorFeedsCache?: Map<string, CachedPayload>;
};

if (!globalForWorldMonitorFeeds.overseerWorldMonitorFeedsCache) {
  globalForWorldMonitorFeeds.overseerWorldMonitorFeedsCache = new Map();
}

function parsePositiveParam(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

async function fetchText(path: string): Promise<ExternalCatalogFile> {
  try {
    const response = await fetch(worldMonitorRawUrl(path), {
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        Accept: 'application/json, text/typescript, text/plain;q=0.9, */*;q=0.5',
        'User-Agent': 'Overseer-Source-Verifier',
      },
    });
    if (!response.ok) return { path, text: null };
    return { path, text: await response.text() };
  } catch {
    return { path, text: null };
  }
}

export async function GET(request: NextRequest) {
  const collectedAt = nowIso();
  const maxFeeds = parsePositiveParam(request.nextUrl.searchParams.get('maxFeeds'), DEFAULT_MAX_FEEDS, MAX_FEEDS_LIMIT);
  const cacheKey = `${maxFeeds}`;
  const cache = globalForWorldMonitorFeeds.overseerWorldMonitorFeedsCache!;
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

  const files = await Promise.all(Object.values(WORLD_MONITOR_SOURCE_FILES).map((file) => fetchText(file.path)));
  const normalized = normalizeWorldMonitorFeedCatalog({ files, collectedAt, maxFeeds });
  updateSourceStatuses(normalized.statuses);

  const payload = {
    feeds: normalized.feeds,
    summaries: normalized.summaries,
    counts: normalized.counts,
    total: normalized.feeds.length,
    status: normalized.statuses,
    timestamp: collectedAt,
    source: 'koala73/worldmonitor',
    source_url: WORLD_MONITOR_REPO,
    alternate_source_url: WORLD_MONITOR_REPO,
    notes: [
      'Reference inventory of explicit endpoints, publisher hosts, RSS feeds, Telegram channels, and X accounts from World Monitor source catalogs; not live World Monitor observations.',
      'Unavailable or empty upstream source files are omitted and surfaced in provider status. Overseer does not infer missing feeds.',
      normalized.counts.acceptedFeeds >= maxFeeds ? `Returned first ${maxFeeds} feed records due to maxFeeds cap.` : null,
    ].filter(Boolean),
  };

  if (normalized.counts.acceptedFiles === 0) {
    return NextResponse.json({
      ...payload,
      error: 'No World Monitor source catalog files were available from GitHub raw.',
    }, { status: 503 });
  }

  cache.set(cacheKey, { storedAtMs: Date.now(), payload, statuses: normalized.statuses });
  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=43200' },
  });
}
