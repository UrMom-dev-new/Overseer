import { NextResponse } from 'next/server';
import { collectionStatus, nowIso, sourceIdentity, updateSourceStatuses } from '@/lib/feed-integrity';
import {
  MACVENDORS_API_URL,
  OUI_MASTER_CSV_URL,
  buildOuiLookupResult,
  lookupOuiRecord,
  normalizeMacInput,
  ouiCollectionStatus,
  parseOuiCsv,
  unavailableOuiStatus,
  type OuiRecord,
} from '@/lib/feed-integrity/oui';
import type { SourceCollectionStatus } from '@/lib/feed-integrity';

const FETCH_TIMEOUT_MS = 25_000;
const MEMORY_TTL_MS = 24 * 60 * 60 * 1000;

interface CachedOuiDatabase {
  storedAtMs: number;
  records: Map<string, OuiRecord>;
  status: SourceCollectionStatus;
}

interface AlternateLookup {
  payload: Record<string, unknown> | null;
  status: SourceCollectionStatus;
}

const globalForOui = globalThis as unknown as {
  overseerOuiMasterCache?: CachedOuiDatabase;
  overseerOuiMasterInFlight?: Promise<CachedOuiDatabase | null>;
};

async function fetchText(url: string, collectedAt: string): Promise<{ text: string | null; status: SourceCollectionStatus }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'text/csv, text/plain;q=0.9, */*;q=0.5' },
    });
    if (!response.ok) {
      return {
        text: null,
        status: unavailableOuiStatus({
          collectedAt,
          availability: response.status === 403 || response.status === 429 ? 'rate_limited' : 'error',
          errorCode: `HTTP_${response.status}`,
          message: `GitHub raw OUI source returned HTTP ${response.status}`,
        }),
      };
    }
    return {
      text: await response.text(),
      status: collectionStatus({
        source: sourceIdentity('oui-master-database:master-csv', 'Ringmast4r OUI Master Database CSV', OUI_MASTER_CSV_URL),
        availability: 'ok',
        dataState: 'present',
        freshness: 'fresh',
        lastAttemptAt: collectedAt,
        lastSuccessfulFetchAt: collectedAt,
      }),
    };
  } catch (error) {
    return {
      text: null,
      status: unavailableOuiStatus({
        collectedAt,
        errorCode: error instanceof Error && error.name === 'AbortError' ? 'TIMEOUT' : 'FETCH_ERROR',
        message: error instanceof Error ? error.message : String(error),
      }),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function loadOuiDatabase(collectedAt: string): Promise<CachedOuiDatabase | null> {
  const cached = globalForOui.overseerOuiMasterCache;
  if (cached && Date.now() - cached.storedAtMs <= MEMORY_TTL_MS) return cached;
  if (globalForOui.overseerOuiMasterInFlight) return globalForOui.overseerOuiMasterInFlight;

  globalForOui.overseerOuiMasterInFlight = (async () => {
    const fetched = await fetchText(OUI_MASTER_CSV_URL, collectedAt);
    if (!fetched.text?.trim()) {
      const failed = { storedAtMs: Date.now(), records: new Map<string, OuiRecord>(), status: fetched.status };
      globalForOui.overseerOuiMasterCache = failed;
      return null;
    }
    const parsed = parseOuiCsv(fetched.text);
    const status = ouiCollectionStatus(parsed, collectedAt);
    const next = { storedAtMs: Date.now(), records: parsed.records, status };
    globalForOui.overseerOuiMasterCache = next;
    return parsed.acceptedRecords > 0 ? next : null;
  })();

  try {
    return await globalForOui.overseerOuiMasterInFlight;
  } finally {
    globalForOui.overseerOuiMasterInFlight = undefined;
  }
}

async function fetchMacVendors(mac: string, collectedAt: string): Promise<AlternateLookup> {
  const url = `${MACVENDORS_API_URL}/${encodeURIComponent(mac)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      return {
        payload: null,
        status: collectionStatus({
          source: sourceIdentity('macvendors-co', 'macvendors.co API', MACVENDORS_API_URL),
          availability: response.status === 403 || response.status === 429 ? 'rate_limited' : 'error',
          dataState: 'unavailable',
          freshness: 'unknown',
          lastAttemptAt: collectedAt,
          errorCode: `HTTP_${response.status}`,
          message: `macvendors.co returned HTTP ${response.status}`,
        }),
      };
    }
    const data = await response.json();
    const result = data?.result && typeof data.result === 'object' ? data.result as Record<string, unknown> : null;
    const company = typeof result?.company === 'string' && result.company.trim() ? result.company.trim() : null;
    return {
      payload: company ? {
        vendor: company,
        manufacturer: company,
        address: typeof result?.address === 'string' && result.address.trim() ? result.address.trim() : null,
        prefix: typeof result?.mac_prefix === 'string' && result.mac_prefix.trim() ? result.mac_prefix.trim() : null,
        source_label: 'macvendors.co',
        source_url: MACVENDORS_API_URL,
        found: true,
      } : null,
      status: collectionStatus({
        source: sourceIdentity('macvendors-co', 'macvendors.co API', MACVENDORS_API_URL),
        availability: 'ok',
        dataState: company ? 'present' : 'empty',
        freshness: 'fresh',
        lastAttemptAt: collectedAt,
        lastSuccessfulFetchAt: collectedAt,
        receivedRecords: 1,
        acceptedRecords: company ? 1 : 0,
        message: company ? null : 'macvendors.co returned no vendor for this prefix.',
      }),
    };
  } catch (error) {
    return {
      payload: null,
      status: collectionStatus({
        source: sourceIdentity('macvendors-co', 'macvendors.co API', MACVENDORS_API_URL),
        availability: 'error',
        dataState: 'unavailable',
        freshness: 'unknown',
        lastAttemptAt: collectedAt,
        errorCode: error instanceof Error && error.name === 'AbortError' ? 'TIMEOUT' : 'FETCH_ERROR',
        message: error instanceof Error ? error.message : String(error),
      }),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(req: Request) {
  const collectedAt = nowIso();
  const { searchParams } = new URL(req.url);
  const rawMac = searchParams.get('mac');

  if (!rawMac) {
    return NextResponse.json({ error: 'Missing MAC parameter' }, { status: 400 });
  }

  const mac = normalizeMacInput(rawMac);
  if (!mac) {
    return NextResponse.json({ error: 'Invalid MAC/OUI parameter', mac: rawMac }, { status: 400 });
  }

  const statuses: SourceCollectionStatus[] = [];
  const database = await loadOuiDatabase(collectedAt);
  if (database) {
    statuses.push(database.status);
    const record = lookupOuiRecord(database.records, mac);
    if (record) {
      const payload = {
        ...buildOuiLookupResult(mac, record, collectedAt),
        status: statuses,
        timestamp: collectedAt,
        source: 'Ringmast4r/OUI-Master-Database',
        source_url: OUI_MASTER_CSV_URL,
        cached: Date.now() - database.storedAtMs > 1000,
      };
      updateSourceStatuses(statuses);
      return NextResponse.json(payload, {
        headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=172800' },
      });
    }
  } else if (globalForOui.overseerOuiMasterCache?.status) {
    statuses.push(globalForOui.overseerOuiMasterCache.status);
  }

  const alternate = await fetchMacVendors(mac.display, collectedAt);
  statuses.push(alternate.status);
  updateSourceStatuses(statuses);

  if (alternate.payload) {
    return NextResponse.json({
      mac: mac.display,
      normalized_mac: mac.hex,
      oui: mac.oui,
      prefix: alternate.payload.prefix ?? mac.oui,
      registry: null,
      short_name: null,
      device_type: null,
      registered_date: null,
      country: null,
      sources: [],
      evidence_kind: 'reference',
      integrity: null,
      ...alternate.payload,
      status: statuses,
      timestamp: collectedAt,
      alternate_source_used: true,
    }, {
      headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=172800' },
    });
  }

  const allUnavailable = statuses.every((status) => status.availability === 'error' || status.availability === 'rate_limited');
  if (allUnavailable) {
    return NextResponse.json({
      error: 'MAC lookup failed because no OUI source was available.',
      mac: mac.display,
      oui: mac.oui,
      status: statuses,
      timestamp: collectedAt,
    }, { status: 502 });
  }

  return NextResponse.json({
    ...buildOuiLookupResult(mac, null, collectedAt),
    status: statuses,
    timestamp: collectedAt,
    source: 'Ringmast4r/OUI-Master-Database',
    source_url: OUI_MASTER_CSV_URL,
  }, {
    headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=172800' },
  });
}
