import { NextResponse } from 'next/server';
import {
  collectionStatus,
  nowIso,
  sourceIdentity,
  updateSourceStatuses,
  type SourceCollectionStatus,
} from '@/lib/feed-integrity';
import { normalizeEonetVolcanoes, parseFirmsCsv, type NormalizedFireRecord } from '@/lib/feed-integrity/fires';

export const dynamic = 'force-dynamic';

/**
 * OVERSEER — Active fire / thermal detections and EONET volcano reports.
 * FIRMS measurements are preserved as source measurements. EONET volcano records
 * do not include FIRMS brightness, FRP, or confidence, so those remain null.
 */

const FIRMS_SOURCES = [
  {
    name: 'NASA-FIRMS (VIIRS)',
    url: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv',
  },
  {
    name: 'NASA-FIRMS (MODIS)',
    url: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_Global_24h.csv',
  },
];
const EONET_VOLCANO_URL = 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&category=volcanoes&limit=50';

async function fetchFirms(collectedAt: string): Promise<{ records: NormalizedFireRecord[]; statuses: SourceCollectionStatus[]; sourceName: string | null }> {
  const statuses: SourceCollectionStatus[] = [];

  for (const feed of FIRMS_SOURCES) {
    const source = sourceIdentity(feed.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), feed.name, feed.url);
    try {
      const res = await fetch(feed.url, {
        signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': 'OVERSEER-Intelligence-Platform/4.2' },
        cache: 'no-store',
      });
      if (!res.ok) {
        statuses.push(collectionStatus({
          source,
          availability: res.status === 429 ? 'rate_limited' : 'error',
          dataState: 'unavailable',
          lastAttemptAt: collectedAt,
          errorCode: `HTTP_${res.status}`,
          message: `${feed.name} returned HTTP ${res.status}.`,
        }));
        continue;
      }
      const text = await res.text();
      if (!text.includes('latitude')) {
        statuses.push(collectionStatus({
          source,
          availability: 'error',
          dataState: 'unavailable',
          lastAttemptAt: collectedAt,
          errorCode: 'INVALID_CSV',
          message: `${feed.name} did not return a valid FIRMS CSV payload.`,
        }));
        continue;
      }
      const parsed = parseFirmsCsv(text, feed.name, feed.url, collectedAt);
      const status = collectionStatus({
        source,
        availability: 'ok',
        dataState: parsed.records.length > 0 ? 'present' : 'empty',
        freshness: 'fresh',
        lastAttemptAt: collectedAt,
        lastSuccessfulFetchAt: collectedAt,
        receivedRecords: parsed.received,
        acceptedRecords: parsed.records.length,
        rejectedRecords: parsed.rejected,
        message: parsed.sampled
          ? 'FIRMS active-fire detections returned; sampled for browser performance. Counts are returned sample counts, not full source counts.'
          : parsed.records.length > 0
            ? 'FIRMS active-fire detections returned.'
            : 'No matching records returned.',
      });
      statuses.push(status);
      return { records: parsed.records, statuses, sourceName: feed.name };
    } catch (error) {
      statuses.push(collectionStatus({
        source,
        availability: 'error',
        dataState: 'unavailable',
        lastAttemptAt: collectedAt,
        errorCode: error instanceof Error ? error.name : 'FETCH_ERROR',
        message: `${feed.name} unavailable.`,
      }));
    }
  }

  return { records: [], statuses, sourceName: null };
}

async function fetchVolcanoes(collectedAt: string): Promise<{ records: NormalizedFireRecord[]; status: SourceCollectionStatus }> {
  const source = sourceIdentity('nasa-eonet-volcanoes', 'NASA EONET Volcanoes', EONET_VOLCANO_URL);
  try {
    const res = await fetch(EONET_VOLCANO_URL, { signal: AbortSignal.timeout(10000), cache: 'no-store' });
    if (!res.ok) {
      return {
        records: [],
        status: collectionStatus({
          source,
          availability: res.status === 429 ? 'rate_limited' : 'error',
          dataState: 'unavailable',
          lastAttemptAt: collectedAt,
          errorCode: `HTTP_${res.status}`,
          message: `NASA EONET volcanoes returned HTTP ${res.status}.`,
        }),
      };
    }
    const payload = await res.json();
    const normalized = normalizeEonetVolcanoes(payload, EONET_VOLCANO_URL, collectedAt);
    if (!normalized) {
      return {
        records: [],
        status: collectionStatus({
          source,
          availability: 'error',
          dataState: 'unavailable',
          lastAttemptAt: collectedAt,
          errorCode: 'INVALID_SCHEMA',
          message: 'NASA EONET volcanoes returned an unexpected schema.',
        }),
      };
    }
    return {
      records: normalized.records,
      status: collectionStatus({
        source,
        availability: 'ok',
        dataState: normalized.records.length > 0 ? 'present' : 'empty',
        freshness: 'fresh',
        lastAttemptAt: collectedAt,
        lastSuccessfulFetchAt: collectedAt,
        receivedRecords: normalized.received,
        acceptedRecords: normalized.records.length,
        rejectedRecords: normalized.rejected,
        message: normalized.records.length > 0 ? 'NASA EONET volcano reports returned.' : 'No matching records returned.',
      }),
    };
  } catch (error) {
    return {
      records: [],
      status: collectionStatus({
        source,
        availability: 'error',
        dataState: 'unavailable',
        lastAttemptAt: collectedAt,
        errorCode: error instanceof Error ? error.name : 'FETCH_ERROR',
        message: 'NASA EONET volcanoes unavailable.',
      }),
    };
  }
}

export async function GET() {
  const collectedAt = nowIso();
  const [firms, volcanoes] = await Promise.all([fetchFirms(collectedAt), fetchVolcanoes(collectedAt)]);
  const fires = [...firms.records, ...volcanoes.records];
  const statuses = [...firms.statuses, volcanoes.status];
  updateSourceStatuses(statuses);

  const anyOk = statuses.some((status) => status.availability === 'ok');
  const unavailable = !anyOk && fires.length === 0;

  return NextResponse.json(
    {
      fires,
      total: fires.length,
      source: firms.sourceName || (volcanoes.records.length > 0 ? 'NASA-EONET' : 'Unavailable'),
      timestamp: collectedAt,
      collectedAt,
      dataMode: 'real',
      status: statuses,
      message: unavailable ? 'Source unavailable.' : fires.length === 0 ? 'No matching records returned.' : 'Fire/thermal detections and volcano reports returned.',
    },
    {
      status: unavailable ? 503 : 200,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    }
  );
}
