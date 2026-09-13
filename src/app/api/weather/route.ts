import { NextResponse } from 'next/server';
import { stealthFetch } from '@/lib/stealthFetch';
import {
  collectionStatus,
  nowIso,
  sourceIdentity,
  updateSourceStatuses,
  type SourceCollectionStatus,
} from '@/lib/feed-integrity';
import { normalizeEonetWeather, normalizeNwsAlerts, type NormalizedWeatherEvent } from '@/lib/feed-integrity/weather';

/**
 * OVERSEER — Severe weather and natural event source reports.
 * NWS polygons/MultiPolygons are preserved. Representative points are approximate
 * navigation aids and never replace authoritative warning areas.
 */

const EONET_URL = 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=100';
const NWS_URL = 'https://api.weather.gov/alerts/active?status=actual&message_type=alert';

async function fetchEonet(collectedAt: string): Promise<{ records: NormalizedWeatherEvent[]; status: SourceCollectionStatus }> {
  const source = sourceIdentity('nasa-eonet', 'NASA EONET', EONET_URL);
  try {
    const res = await stealthFetch(EONET_URL, { signal: AbortSignal.timeout(10000), cache: 'no-store' });
    if (!res.ok) {
      return {
        records: [],
        status: collectionStatus({
          source,
          availability: res.status === 429 ? 'rate_limited' : 'error',
          dataState: 'unavailable',
          lastAttemptAt: collectedAt,
          errorCode: `HTTP_${res.status}`,
          message: `NASA EONET returned HTTP ${res.status}.`,
        }),
      };
    }
    const payload = await res.json();
    const normalized = normalizeEonetWeather(payload, EONET_URL, collectedAt);
    if (!normalized) {
      return {
        records: [],
        status: collectionStatus({
          source,
          availability: 'error',
          dataState: 'unavailable',
          lastAttemptAt: collectedAt,
          errorCode: 'INVALID_SCHEMA',
          message: 'NASA EONET returned an unexpected schema.',
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
        message: normalized.records.length > 0 ? 'NASA EONET event reports returned.' : 'No matching records returned.',
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
        message: 'NASA EONET unavailable.',
      }),
    };
  }
}

async function fetchNws(collectedAt: string): Promise<{ records: NormalizedWeatherEvent[]; status: SourceCollectionStatus }> {
  const source = sourceIdentity('noaa-nws-alerts', 'NOAA/NWS Active Alerts', NWS_URL);
  try {
    const res = await fetch(NWS_URL, {
      headers: {
        Accept: 'application/geo+json',
        'User-Agent': 'OVERSEER Severe Weather Layer (https://github.com/UrMom-dev-new/Overseer)',
      },
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
    });
    if (!res.ok) {
      return {
        records: [],
        status: collectionStatus({
          source,
          availability: res.status === 429 ? 'rate_limited' : 'error',
          dataState: 'unavailable',
          lastAttemptAt: collectedAt,
          errorCode: `HTTP_${res.status}`,
          message: `NOAA/NWS returned HTTP ${res.status}.`,
        }),
      };
    }
    const payload = await res.json();
    const normalized = normalizeNwsAlerts(payload, NWS_URL, collectedAt);
    if (!normalized) {
      return {
        records: [],
        status: collectionStatus({
          source,
          availability: 'error',
          dataState: 'unavailable',
          lastAttemptAt: collectedAt,
          errorCode: 'INVALID_SCHEMA',
          message: 'NOAA/NWS returned an unexpected schema.',
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
        message: normalized.records.length > 0 ? 'NOAA/NWS active alerts returned.' : 'No matching records returned.',
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
        message: 'NOAA/NWS unavailable.',
      }),
    };
  }
}

export async function GET() {
  const collectedAt = nowIso();
  const [eonet, nws] = await Promise.all([fetchEonet(collectedAt), fetchNws(collectedAt)]);
  const events = [...eonet.records, ...nws.records];
  const statuses = [eonet.status, nws.status];
  updateSourceStatuses(statuses);

  const anyOk = statuses.some((status) => status.availability === 'ok');
  const unavailable = !anyOk && events.length === 0;

  return NextResponse.json(
    {
      events,
      total: events.length,
      timestamp: collectedAt,
      collectedAt,
      dataMode: 'real',
      status: statuses,
      message: unavailable ? 'Source unavailable.' : events.length === 0 ? 'No matching records returned.' : 'Weather source reports returned.',
    },
    {
      status: unavailable ? 503 : 200,
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    }
  );
}
