import { NextResponse } from 'next/server';
import {
  collectionStatus,
  nowIso,
  sourceIdentity,
  updateSourceStatuses,
  type SourceCollectionStatus,
} from '@/lib/feed-integrity';
import {
  normalizeNewsItem,
  parseRSSItems,
  parseTelegramHTML,
  type NormalizedNewsItem,
  type RawNewsItem,
} from '@/lib/feed-integrity/news';

/**
 * OVERSEER — OSINT source reports.
 * Telegram public previews are tried first, with RSS fallback only when Telegram
 * returns no usable source reports. Keyword relevance is not severity or AI analysis.
 */

const TELEGRAM_CHANNELS = ['OSINTtechnical', 'Faytuks', 'Liveuamap', 'CyberKnow'];

const FALLBACK_FEEDS = {
  BBC: 'https://feeds.bbci.co.uk/news/world/rss.xml',
  AlJazeera: 'https://www.aljazeera.com/xml/rss/all.xml',
  GDACS: 'https://www.gdacs.org/xml/rss.xml',
};

async function fetchTelegram(channel: string, collectedAt: string): Promise<{ items: RawNewsItem[]; status: SourceCollectionStatus }> {
  const source = sourceIdentity(`telegram-${channel.toLowerCase()}`, `t.me/${channel}`, `https://t.me/s/${channel}`);
  try {
    const res = await fetch(`https://t.me/s/${channel}`, {
      signal: AbortSignal.timeout(8000),
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
    const items = parseRSSItems(xml, sourceName).slice(0, 5);
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
        message: 'RSS source unavailable.',
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
  const telegramResults = await Promise.all(TELEGRAM_CHANNELS.map((channel) => fetchTelegram(channel, collectedAt)));
  let allArticles = telegramResults.flatMap((result) => result.items);
  const statuses: SourceCollectionStatus[] = telegramResults.map((result) => result.status);

  if (allArticles.length === 0) {
    const rssResults = await Promise.all(Object.entries(FALLBACK_FEEDS).map(([source, url]) => fetchRss(source, url, collectedAt)));
    allArticles = rssResults.flatMap((result) => result.items);
    statuses.push(...rssResults.map((result) => result.status));
  }

  const newsItems = allArticles.map((article) => normalizeNewsItem(article, collectedAt)).sort(sortNews);
  updateSourceStatuses(statuses);

  const anyOk = statuses.some((status) => status.availability === 'ok');
  const unavailable = !anyOk && newsItems.length === 0;

  return NextResponse.json(
    {
      news: newsItems,
      total: newsItems.length,
      timestamp: collectedAt,
      collectedAt,
      dataMode: 'real',
      evidenceKind: 'report',
      status: statuses,
      message: unavailable ? 'Source unavailable.' : newsItems.length === 0 ? 'No matching records returned.' : 'Source reports returned.',
    },
    {
      status: unavailable ? 503 : 200,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    }
  );
}
