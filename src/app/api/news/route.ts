import { NextResponse } from 'next/server';
import {
  isSnapshotUsable,
  collectionStatus,
  nowIso,
  readSnapshot,
  sourceIdentity,
  updateSourceStatuses,
  writeSnapshot,
  type SourceCollectionStatus,
} from '@/lib/feed-integrity';
import {
  looksLikeRssOrAtom,
  normalizeNewsItem,
  parseRSSItems,
  parseTelegramHTML,
  type NormalizedNewsItem,
  type RawNewsItem,
} from '@/lib/feed-integrity/news';

/**
 * OVERSEER — OSINT source reports.
 * RSS/Atom is the dependable baseline. Optional Telegram public previews are
 * merged only when they complete within a small response budget.
 * Keyword relevance is not severity or AI analysis.
 */

const DEFAULT_TELEGRAM_CHANNELS = ['OSINTtechnical', 'Faytuks', 'Liveuamap', 'CyberKnow'];
const TELEGRAM_MERGE_BUDGET_MS = 750;
const NEWS_SNAPSHOT_KEY = 'news:combined:v1';
const NEWS_SNAPSHOT_MAX_AGE_MS = 2 * 60 * 60 * 1000;

const FALLBACK_FEEDS = {
  BBC: 'https://feeds.bbci.co.uk/news/world/rss.xml',
  AlJazeera: 'https://www.aljazeera.com/xml/rss/all.xml',
  GDACS: 'https://www.gdacs.org/xml/rss.xml',
};

function telegramChannels(): string[] {
  const configured = process.env.OVERSEER_TELEGRAM_CHANNELS?.split(',')
    .map((channel) => channel.trim().replace(/^@/, ''))
    .filter(Boolean);
  return configured && configured.length > 0 ? Array.from(new Set(configured)) : DEFAULT_TELEGRAM_CHANNELS;
}

function combineSignals(signals: AbortSignal[]): AbortSignal {
  if ('any' in AbortSignal && typeof AbortSignal.any === 'function') return AbortSignal.any(signals);
  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of signals) {
    if (signal.aborted) return signal;
    signal.addEventListener('abort', abort, { once: true });
  }
  return controller.signal;
}

function omittedTelegramStatus(channel: string, collectedAt: string): SourceCollectionStatus {
  return collectionStatus({
    source: sourceIdentity(`telegram-${channel.toLowerCase()}`, `t.me/${channel}`, `https://t.me/s/${channel}`),
    availability: 'partial',
    dataState: 'unavailable',
    lastAttemptAt: collectedAt,
    errorCode: 'OPTIONAL_SOURCE_TIMEOUT',
    message: 'Optional Telegram collection exceeded the RSS-first merge budget and was omitted from this response.',
  });
}

async function fetchTelegram(channel: string, collectedAt: string, signal: AbortSignal): Promise<{ items: RawNewsItem[]; status: SourceCollectionStatus }> {
  const source = sourceIdentity(`telegram-${channel.toLowerCase()}`, `t.me/${channel}`, `https://t.me/s/${channel}`);
  try {
    const res = await fetch(`https://t.me/s/${channel}`, {
      signal: combineSignals([signal, AbortSignal.timeout(3000)]),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OVERSEER/4.2; +https://github.com/UrMom-dev-new/Overseer)' },
      cache: 'no-store',
    });
    if (!res.ok) {
      return {
        items: [],
        status: collectionStatus({
          source,
          availability: res.status === 429 ? 'rate_limited' : 'error',
          dataState: 'unavailable',
          lastAttemptAt: collectedAt,
          errorCode: `HTTP_${res.status}`,
          message: `Telegram public preview returned HTTP ${res.status}.`,
        }),
      };
    }
    const html = await res.text();
    const items = parseTelegramHTML(html, channel).slice(-8);
    return {
      items,
      status: collectionStatus({
        source,
        availability: 'ok',
        dataState: items.length > 0 ? 'present' : 'empty',
        freshness: 'fresh',
        lastAttemptAt: collectedAt,
        lastSuccessfulFetchAt: collectedAt,
        receivedRecords: items.length,
        acceptedRecords: items.length,
        message: items.length > 0 ? 'Source reports returned.' : 'No matching records returned.',
      }),
    };
  } catch (error) {
    return {
      items: [],
      status: collectionStatus({
        source,
        availability: 'error',
        dataState: 'unavailable',
        lastAttemptAt: collectedAt,
        errorCode: error instanceof Error ? error.name : 'FETCH_ERROR',
        message: 'Telegram public preview unavailable.',
      }),
    };
  }
}

async function fetchRss(sourceName: string, url: string, collectedAt: string): Promise<{ items: RawNewsItem[]; status: SourceCollectionStatus }> {
  const source = sourceIdentity(`rss-${sourceName.toLowerCase()}`, sourceName, url);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000), cache: 'no-store' });
    if (!res.ok) {
      return {
        items: [],
        status: collectionStatus({
          source,
          availability: res.status === 429 ? 'rate_limited' : 'error',
          dataState: 'unavailable',
          lastAttemptAt: collectedAt,
          errorCode: `HTTP_${res.status}`,
          message: `RSS source returned HTTP ${res.status}.`,
        }),
      };
    }
    const xml = await res.text();
    if (!looksLikeRssOrAtom(xml)) {
      return {
        items: [],
        status: collectionStatus({
          source,
          availability: 'error',
          dataState: 'unavailable',
          lastAttemptAt: collectedAt,
          errorCode: 'UNEXPECTED_CONTENT',
          message: 'RSS source returned non-feed content; stream omitted.',
        }),
      };
    }
    const items = (await parseRSSItems(xml, sourceName)).slice(0, 8);
    return {
      items,
      status: collectionStatus({
        source,
        availability: 'ok',
        dataState: items.length > 0 ? 'present' : 'empty',
        freshness: 'fresh',
        lastAttemptAt: collectedAt,
        lastSuccessfulFetchAt: collectedAt,
        receivedRecords: items.length,
        acceptedRecords: items.length,
        message: items.length > 0 ? 'Source reports returned.' : 'No matching records returned.',
      }),
    };
  } catch (error) {
    return {
      items: [],
      status: collectionStatus({
        source,
        availability: 'error',
        dataState: 'unavailable',
        lastAttemptAt: collectedAt,
        errorCode: error instanceof Error ? error.name : 'FETCH_ERROR',
        message: error instanceof Error && error.name === 'Error' ? 'RSS source returned malformed feed content.' : 'RSS source unavailable.',
      }),
    };
  }
}

function sortNews(a: NormalizedNewsItem, b: NormalizedNewsItem): number {
  const aTime = a.published ? new Date(a.published).getTime() : Number.NEGATIVE_INFINITY;
  const bTime = b.published ? new Date(b.published).getTime() : Number.NEGATIVE_INFINITY;
  return bTime - aTime;
}

export async function GET() {
  const collectedAt = nowIso();
  const channels = telegramChannels();
  const telegramAbort = new AbortController();
  const telegramPromise = Promise.all(channels.map((channel) => fetchTelegram(channel, collectedAt, telegramAbort.signal)));
  const rssResults = await Promise.all(Object.entries(FALLBACK_FEEDS).map(([source, url]) => fetchRss(source, url, collectedAt)));
  let telegramResults: Awaited<ReturnType<typeof fetchTelegram>>[] | null = null;
  const budgetExpired = Symbol('telegram-budget-expired');
  const optionalResult = await Promise.race([
    telegramPromise,
    new Promise<typeof budgetExpired>((resolve) => setTimeout(() => resolve(budgetExpired), TELEGRAM_MERGE_BUDGET_MS)),
  ]);
  if (optionalResult === budgetExpired) {
    telegramAbort.abort();
  } else {
    telegramResults = optionalResult;
  }

  const statuses: SourceCollectionStatus[] = [
    ...rssResults.map((result) => result.status),
    ...(telegramResults ? telegramResults.map((result) => result.status) : channels.map((channel) => omittedTelegramStatus(channel, collectedAt))),
  ];
  const allArticles = [
    ...rssResults.flatMap((result) => result.items),
    ...(telegramResults ? telegramResults.flatMap((result) => result.items) : []),
  ];

  const seen = new Set<string>();
  const newsItems = allArticles
    .map((article) => normalizeNewsItem(article, collectedAt))
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .sort(sortNews);

  updateSourceStatuses(statuses);

  const anyOk = statuses.some((status) => status.availability === 'ok');
  const unavailable = !anyOk && newsItems.length === 0;
  if (anyOk) {
    const snapshotStatus = collectionStatus({
      source: sourceIdentity('news-combined', 'OVERSEER news source reports', null),
      availability: 'ok',
      dataState: newsItems.length > 0 ? 'present' : 'empty',
      freshness: 'fresh',
      lastAttemptAt: collectedAt,
      lastSuccessfulFetchAt: collectedAt,
      acceptedRecords: newsItems.length,
      message: newsItems.length > 0 ? 'Combined source reports returned.' : 'Combined source reports returned no records.',
    });
    writeSnapshot<NormalizedNewsItem>({
      key: NEWS_SNAPSHOT_KEY,
      records: newsItems,
      status: snapshotStatus,
      storedAtMs: Date.now(),
    });
  }

  const cached = unavailable ? readSnapshot<NormalizedNewsItem>(NEWS_SNAPSHOT_KEY) : null;
  const servingCache = isSnapshotUsable(cached, NEWS_SNAPSHOT_MAX_AGE_MS);
  const returnedNews = servingCache ? cached.records : newsItems;
  const returnedStatuses = servingCache
    ? [
      ...statuses,
      {
        ...cached.status,
        lastAttemptAt: collectedAt,
        servingLastKnownGood: true,
        freshness: 'stale' as const,
        message: 'Serving eligible last-known-good source reports while live sources are unavailable.',
      },
    ]
    : statuses;

  return NextResponse.json(
    {
      news: returnedNews,
      total: returnedNews.length,
      timestamp: collectedAt,
      collectedAt,
      dataMode: 'real',
      evidenceKind: 'report',
      status: returnedStatuses,
      servingLastKnownGood: servingCache,
      message: unavailable && !servingCache ? 'Source unavailable.' : returnedNews.length === 0 ? 'No matching records returned.' : servingCache ? 'Serving last-known-good source reports.' : 'Source reports returned.',
    },
    {
      status: unavailable && !servingCache ? 503 : 200,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    }
  );
}
