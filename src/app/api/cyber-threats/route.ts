import { NextResponse } from 'next/server';
import {
  collectionStatus,
  nowIso,
  sourceIdentity,
  updateSourceStatuses,
  type SourceCollectionStatus,
} from '@/lib/feed-integrity';
import { normalizeKevCatalog, type NormalizedKevEntry } from '@/lib/feed-integrity/cyber';

const CISA_KEV_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';
const SHADOWSERVER_URL = 'https://dashboard.shadowserver.org/statistics/combined/map/';

async function fetchKev(collectedAt: string): Promise<{
  threats: NormalizedKevEntry[];
  totalCatalogRecords: number | null;
  status: SourceCollectionStatus;
}> {
  const source = sourceIdentity('cisa-kev', 'CISA Known Exploited Vulnerabilities Catalog', CISA_KEV_URL);
  try {
    const res = await fetch(CISA_KEV_URL, { signal: AbortSignal.timeout(10000), cache: 'no-store' });
    if (!res.ok) {
      return {
        threats: [],
        totalCatalogRecords: null,
        status: collectionStatus({
          source,
          availability: res.status === 429 ? 'rate_limited' : 'error',
          dataState: 'unavailable',
          lastAttemptAt: collectedAt,
          errorCode: `HTTP_${res.status}`,
          message: `CISA KEV returned HTTP ${res.status}.`,
        }),
      };
    }
    const payload = await res.json();
    const normalized = normalizeKevCatalog(payload, CISA_KEV_URL, collectedAt);
    if (!normalized) {
      return {
        threats: [],
        totalCatalogRecords: null,
        status: collectionStatus({
          source,
          availability: 'error',
          dataState: 'unavailable',
          lastAttemptAt: collectedAt,
          errorCode: 'INVALID_SCHEMA',
          message: 'CISA KEV returned an unexpected schema.',
        }),
      };
    }
    return {
      threats: normalized.records,
      totalCatalogRecords: normalized.totalCatalogRecords,
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
        message: 'CISA KEV catalog retrieved. KEV inclusion is known-exploited status, not technical severity.',
      }),
    };
  } catch (error) {
    return {
      threats: [],
      totalCatalogRecords: null,
      status: collectionStatus({
        source,
        availability: 'error',
        dataState: 'unavailable',
        lastAttemptAt: collectedAt,
        errorCode: error instanceof Error ? error.name : 'FETCH_ERROR',
        message: 'CISA KEV unavailable.',
      }),
    };
  }
}

async function checkShadowserver(collectedAt: string): Promise<SourceCollectionStatus> {
  const source = sourceIdentity('shadowserver-reachability', 'Shadowserver Dashboard Reachability', SHADOWSERVER_URL);
  try {
    const res = await fetch(SHADOWSERVER_URL, {
      signal: AbortSignal.timeout(8000),
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    return collectionStatus({
      source,
      availability: res.ok ? 'ok' : res.status === 429 ? 'rate_limited' : 'error',
      dataState: 'unavailable',
      freshness: 'unknown',
      lastAttemptAt: collectedAt,
      lastSuccessfulFetchAt: res.ok ? collectedAt : null,
      errorCode: res.ok ? null : `HTTP_${res.status}`,
      message: res.ok
        ? 'Shadowserver dashboard was reachable. OVERSEER did not ingest threat telemetry from this check.'
        : `Shadowserver reachability check returned HTTP ${res.status}.`,
    });
  } catch (error) {
    return collectionStatus({
      source,
      availability: 'error',
      dataState: 'unavailable',
      lastAttemptAt: collectedAt,
      errorCode: error instanceof Error ? error.name : 'FETCH_ERROR',
      message: 'Shadowserver reachability check failed. No telemetry ingested.',
    });
  }
}

export async function GET() {
  const collectedAt = nowIso();
  const [kev, shadowserverStatus] = await Promise.all([fetchKev(collectedAt), checkShadowserver(collectedAt)]);
  const statuses = [kev.status, shadowserverStatus];
  updateSourceStatuses(statuses);
  const unavailable = kev.status.availability !== 'ok';

  return NextResponse.json(
    {
      threats: kev.threats,
      stats: {
        cisa_total: kev.totalCatalogRecords,
        recent_known_exploited_count: kev.threats.length,
        active_cves: kev.threats.length,
        threat_level: null,
        shadowserver_reachability: shadowserverStatus.availability,
        shadowserver_data_status: 'not_ingested',
        note: 'KEV inclusion indicates known exploitation. Technical severity and user/environment relevance are unknown unless supplied by another source.',
      },
      timestamp: collectedAt,
      collectedAt,
      dataMode: 'real',
      status: statuses,
    },
    {
      status: unavailable ? 503 : 200,
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    }
  );
}
