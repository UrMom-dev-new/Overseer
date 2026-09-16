import { NextResponse } from 'next/server';
import { collectionStatus, readSourceStatuses, sourceIdentity } from '@/lib/feed-integrity';
import packageJson from '../../../../package.json';

const EXPECTED_FEEDS = [
  sourceIdentity('gdelt-geo', 'GDELT 2.0 GeoJSON API', 'https://api.gdeltproject.org/api/v2/geo/geo'),
  sourceIdentity('telegram-osint', 'Telegram public previews', 'https://t.me/s/<channel>'),
  sourceIdentity('nasa-firms', 'NASA FIRMS active-fire feeds', 'https://firms.modaps.eosdis.nasa.gov/'),
  sourceIdentity('nasa-eonet', 'NASA EONET', 'https://eonet.gsfc.nasa.gov/api/v3/events'),
  sourceIdentity('noaa-nws-alerts', 'NOAA/NWS Active Alerts', 'https://api.weather.gov/alerts/active'),
  sourceIdentity('aisstream', 'AIS Stream', 'wss://stream.aisstream.io/v0/stream'),
  sourceIdentity('cisa-kev', 'CISA Known Exploited Vulnerabilities Catalog', 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog'),
];

export async function GET() {
  const statuses = readSourceStatuses();
  const byProvider = new Map(statuses.map((status) => [status.source.providerId, status]));
  const feedHealth = EXPECTED_FEEDS.map((source) => {
    const exact = byProvider.get(source.providerId);
    const prefixed = statuses.filter((status) => status.source.providerId.startsWith(`${source.providerId}:`));
    if (exact) return exact;
    if (prefixed.length > 0) {
      const anyError = prefixed.some((status) => status.availability !== 'ok');
      return collectionStatus({
        source,
        availability: anyError ? 'partial' : 'ok',
        dataState: prefixed.some((status) => status.dataState === 'present') ? 'present' : prefixed.every((status) => status.dataState === 'empty') ? 'empty' : 'unavailable',
        freshness: prefixed.every((status) => status.freshness === 'fresh') ? 'fresh' : prefixed.some((status) => status.freshness === 'stale') ? 'stale' : 'unknown',
        lastAttemptAt: prefixed.map((status) => status.lastAttemptAt).filter(Boolean).sort().at(-1) ?? null,
        lastSuccessfulFetchAt: prefixed.map((status) => status.lastSuccessfulFetchAt).filter(Boolean).sort().at(-1) ?? null,
        servingLastKnownGood: prefixed.some((status) => status.servingLastKnownGood),
        receivedRecords: prefixed.reduce((sum, status) => sum + status.receivedRecords, 0),
        acceptedRecords: prefixed.reduce((sum, status) => sum + status.acceptedRecords, 0),
        rejectedRecords: prefixed.reduce((sum, status) => sum + status.rejectedRecords, 0),
        message: 'Aggregated cached status from source/query collection states.',
      });
    }
    return collectionStatus({
      source,
      availability: 'unknown',
      dataState: 'unavailable',
      freshness: 'unknown',
      message: 'No cached collection state yet. Health checks do not contact upstream providers.',
    });
  });

  const degraded = feedHealth.some((status) => ['error', 'partial', 'rate_limited', 'not_configured'].includes(status.availability));

  return NextResponse.json({
    status: 'alive',
    appId: 'overseer',
    processStatus: 'alive',
    feedStatus: degraded ? 'degraded' : 'unknown_or_ok',
    platform: 'OVERSEER',
    version: packageJson.version,
    uptime: process.uptime ? Math.round(process.uptime()) : 0,
    timestamp: new Date().toISOString(),
    note: 'This endpoint reports process liveness and cached feed collection state only; it does not fan out to upstream providers.',
    feeds: feedHealth,
    endpoints: [
      '/api/flights',
      '/api/satellites',
      '/api/earthquakes',
      '/api/news',
      '/api/gdelt',
      '/api/markets',
      '/api/frontlines',
      '/api/region-dossier',
    ],
  });
}
