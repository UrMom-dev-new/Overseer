
import { NextResponse } from 'next/server';
import { collectionStatus, nowIso, sourceIdentity, updateSourceStatuses } from '@/lib/feed-integrity';

import { LIVE_NEWS_FEEDS as LIVE_FEEDS } from '@/lib/live-news-catalog';

export async function GET() {
  const collectedAt = nowIso();
  const status = collectionStatus({
    source: sourceIdentity('live-news-catalog', 'Curated live broadcast link catalog', null),
    availability: 'ok',
    dataState: LIVE_FEEDS.length > 0 ? 'present' : 'empty',
    freshness: 'unknown',
    lastAttemptAt: collectedAt,
    lastSuccessfulFetchAt: collectedAt,
    receivedRecords: LIVE_FEEDS.length,
    acceptedRecords: LIVE_FEEDS.length,
    message: 'Curated live-news catalog returned. Link playback is verified only when a user opens a feed.',
  });
  updateSourceStatuses([status]);

  return NextResponse.json({
    feeds: LIVE_FEEDS,
    total: LIVE_FEEDS.length,
    categories: ['mainstream', 'government', 'finance', 'conflict', 'state'],
    timestamp: collectedAt,
    collectedAt,
    dataMode: 'real',
    evidenceKind: 'reference',
    status: [status],
    mediaVerification: 'catalog_only',
    message: 'Curated live-news link catalog returned; playable media is validated on user launch.',
  }, {
    headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=172800' },
  });
}
