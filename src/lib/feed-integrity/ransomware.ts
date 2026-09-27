import { createHash } from 'node:crypto';
import type { SourceCollectionStatus } from './types';
import {
  RANSOMLOOK_ATTRIBUTION, RANSOMLOOK_URL, RANSOMWARE_CACHE_MAX_AGE_MS, RANSOMWARE_REFRESH_MS,
  type RansomwareEnvelope, type RansomwareReport,
} from './ransomware-types';

const SOURCE = { providerId: 'ransomware:ransomlook', providerName: 'RansomLook', feedUrl: RANSOMLOOK_URL };
const MAX_BODY_BYTES = 1024 * 1024;
const SOURCE_AGE_WARNING_MS = 7 * 86400000;
const METHODOLOGY = 'RansomLook ransomware-related posts, not independently verified incidents or unique victims. Discovery time is not attack time. No location inferred. Original links, screenshots and stolen data are not ingested.';

function plainText(value: unknown, limit: number): string {
  if (typeof value !== 'string') return '';
  return value.slice(0, 16000).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

/** Legacy RansomLook timestamps can be timezone-less; explicitly interpret those as UTC. */
function discoveryTime(value: unknown): { date: string | null; flags: string[] } {
  if (typeof value !== 'string') return { date: null, flags: ['discovery_time_unknown'] };
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})?$/i);
  if (!match) return { date: null, flags: ['discovery_time_invalid'] };
  const [, year, month, day, hour, minute, second, fraction, zone] = match;
  const calendar = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== `${year}-${month}-${day}` ||
      Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) {
    return { date: null, flags: ['discovery_time_invalid'] };
  }
  const ms = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}.${(fraction ?? '').padEnd(3, '0').slice(0, 3)}${zone ?? 'Z'}`);
  if (!Number.isFinite(ms)) return { date: null, flags: ['discovery_time_invalid'] };
  return { date: new Date(ms).toISOString(), flags: zone ? [] : ['source_timezone_assumed_utc'] };
}

export interface NormalizedRansomwarePosts {
  records: RansomwareReport[];
  received: number;
  rejected: number;
  duplicates: number;
}

export function normalizeRansomLookPosts(input: unknown, collectedAt: string): NormalizedRansomwarePosts | null {
  if (!Array.isArray(input) || input.length > 100) return null;
  const records: RansomwareReport[] = [];
  const seen = new Set<string>();
  let rejected = 0;
  let duplicates = 0;
  for (const value of input) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) { rejected++; continue; }
    const raw = value as Record<string, unknown>;
    const title = plainText(raw.post_title, 500);
    const group = plainText(raw.group_name, 160);
    if (!title || !group) { rejected++; continue; }
    const discovered = discoveryTime(raw.discovered);
    const flags = ['unverified_operator_claim', 'post_not_confirmed_unique_victim', 'location_unknown', ...discovered.flags];
    if (discovered.date && Date.parse(discovered.date) > Date.parse(collectedAt)) flags.push('source_discovery_in_future');
    // Never include collection time or mutable description in identity. Hash the original title, not its shortened display form.
    const id = `ransomware-${createHash('sha256').update(JSON.stringify([
      raw.group_name, raw.post_title, discovered.date ?? raw.discovered ?? null,
    ])).digest('hex').slice(0, 24)}`;
    if (seen.has(id)) { duplicates++; continue; }
    seen.add(id);
    records.push({
      id, title, group, description: plainText(raw.description, 2000) || null,
      discoveredAt: discovered.date, publishedAt: null, attackAt: null, country: null, sector: null,
      source: 'RansomLook', sourceUrl: RANSOMLOOK_ATTRIBUTION.url,
      verification: 'unassessed', recordKind: 'ransomware_related_post',
      integrity: {
        provenance: {
          recordId: id, upstreamId: null, source: SOURCE, itemUrl: RANSOMLOOK_ATTRIBUTION.url,
          originalPublisher: group, dataMode: 'real', evidenceKind: 'report', verification: 'unassessed',
          evidenceReferences: [{ label: 'RansomLook recent posts (provider collection)', url: RANSOMLOOK_ATTRIBUTION.url }],
          methodology: METHODOLOGY,
        },
        timing: { observedAt: null, publishedAt: null, sourceUpdatedAt: null, collectedAt, expiresAt: null },
        location: { geometry: null, representativePoint: null, precision: 'unknown', relationship: 'unknown', resolutionMethod: null, qualityFlags: flags },
      },
    });
  }
  records.sort((a, b) => (b.discoveredAt ?? '').localeCompare(a.discoveredAt ?? '') || a.id.localeCompare(b.id));
  return { records, received: input.length, rejected, duplicates };
}

class ProviderFailure extends Error {
  constructor(readonly code: string, readonly rateLimited = false, readonly retryMs = 0) { super(code); }
}

function retryDelay(value: string | null, now: number): number {
  if (!value) return 0;
  const seconds = /^\d+$/.test(value.trim()) ? Number(value) : NaN;
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  // Avoid invalid Date values while honoring usable Retry-After values, including long cooldowns.
  return Number.isFinite(delay) && delay > 0 ? Math.min(delay, 8640000000000000 - now) : 0;
}

async function readJson(response: Response): Promise<unknown> {
  if (!/^application\/(?:[\w.+-]+\+)?json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) throw new ProviderFailure('INVALID_CONTENT_TYPE');
  if (Number(response.headers.get('content-length')) > MAX_BODY_BYTES) throw new ProviderFailure('RESPONSE_TOO_LARGE');
  if (!response.body) throw new ProviderFailure('EMPTY_BODY');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let body = '';
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_BODY_BYTES) throw new ProviderFailure('RESPONSE_TOO_LARGE');
      body += decoder.decode(part.value, { stream: true });
    }
    body += decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  try { return JSON.parse(body) as unknown; } catch { throw new ProviderFailure('INVALID_JSON'); }
}

export interface RansomwareCollectionResult { payload: RansomwareEnvelope; httpStatus: 200 | 503 }

/** Per-process cache and single-flight collector. Dependencies are injectable for deterministic tests. */
export function createRansomwareCollector(options: {
  fetcher?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
} = {}) {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  let good: { normalized: NormalizedRansomwarePosts; fetchedAt: number } | null = null;
  let lastAttempt: number | null = null;
  let failure: ProviderFailure | null = null;
  let failureCount = 0;
  let nextFetchAt = 0;
  let inFlight: Promise<RansomwareCollectionResult> | null = null;

  function result(): RansomwareCollectionResult {
    const time = now();
    const usable = good !== null && time - good.fetchedAt <= RANSOMWARE_CACHE_MAX_AGE_MS ? good : null;
    const records = usable?.normalized.records ?? [];
    const dates = records.map((record) => record.discoveredAt).filter((value): value is string => Boolean(value) && Date.parse(value!) <= time).sort();
    const latest = dates.at(-1) ?? null;
    const oldSource = records.length > 0 && latest !== null && time - Date.parse(latest) > SOURCE_AGE_WARNING_MS;
    const status: SourceCollectionStatus = {
      source: SOURCE,
      availability: failure ? failure.rateLimited ? 'rate_limited' : 'error' : usable?.normalized.rejected ? 'partial' : 'ok',
      dataState: usable ? records.length ? 'present' : 'empty' : 'unavailable',
      freshness: failure ? usable ? 'stale' : 'unknown' : oldSource ? 'stale' : records.length && latest === null ? 'unknown' : 'fresh',
      lastAttemptAt: lastAttempt === null ? null : new Date(lastAttempt).toISOString(),
      lastSuccessfulFetchAt: good ? new Date(good.fetchedAt).toISOString() : null,
      nextRetryAt: failure ? new Date(nextFetchAt).toISOString() : null,
      servingLastKnownGood: Boolean(failure && usable),
      errorCode: failure?.code ?? null,
      message: failure
        ? `RansomLook collection failed (${failure.code}). ${usable ? 'Showing the last successful snapshot, not current coverage.' : 'No usable cached snapshot. Coverage is unavailable, not zero incidents.'}`
        : `${usable?.normalized.rejected ? 'Some malformed posts were rejected. ' : ''}Latest-post sample retrieved; posts are unverified claims, not confirmed attacks or unique victims.${oldSource ? ' Latest known discovery is over seven days old; upstream currency is uncertain.' : ''}`,
      receivedRecords: usable?.normalized.received ?? 0,
      acceptedRecords: records.length,
      rejectedRecords: usable?.normalized.rejected ?? 0,
    };
    return {
      httpStatus: usable ? 200 : 503,
      payload: {
        ransomware_reports: records, dataMode: 'real', collectedAt: usable ? new Date(usable.fetchedAt).toISOString() : null,
        nextRefreshAt: new Date(nextFetchAt).toISOString(), status: [status],
        coverage: { kind: 'latest_posts', limit: 100, notExhaustive: true, duplicatesRemoved: usable?.normalized.duplicates ?? 0, newestDiscoveryAt: latest, oldestDiscoveryAt: dates[0] ?? null },
        attribution: RANSOMLOOK_ATTRIBUTION,
      },
    };
  }

  async function refresh(): Promise<RansomwareCollectionResult> {
    lastAttempt = now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10000);
    try {
      const response = await fetcher(RANSOMLOOK_URL, {
        signal: controller.signal, redirect: 'error', cache: 'no-store',
        headers: { Accept: 'application/json', 'User-Agent': 'Overseer/0.2 ransomware-metadata-feed' },
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new ProviderFailure(`HTTP_${response.status}`, response.status === 429, retryDelay(response.headers.get('retry-after'), now()));
      }
      const payload = await readJson(response);
      const fetchedAt = now();
      const normalized = normalizeRansomLookPosts(payload, new Date(fetchedAt).toISOString());
      if (!normalized || (normalized.received > 0 && normalized.records.length === 0)) throw new ProviderFailure('INVALID_SCHEMA');
      good = { normalized, fetchedAt };
      failure = null;
      failureCount = 0;
      nextFetchAt = fetchedAt + RANSOMWARE_REFRESH_MS;
    } catch (error) {
      failure = error instanceof ProviderFailure ? error : new ProviderFailure(controller.signal.aborted ? 'TIMEOUT' : 'FETCH_ERROR');
      failureCount = Math.min(failureCount + 1, 6);
      nextFetchAt = now() + Math.max(Math.min(60000 * 2 ** (failureCount - 1), RANSOMWARE_REFRESH_MS), failure.retryMs);
    } finally { clearTimeout(timer); controller.abort(); }
    return result();
  }

  return {
    get(): Promise<RansomwareCollectionResult> {
      if (inFlight) return inFlight;
      if (lastAttempt !== null && now() < nextFetchAt) return Promise.resolve(result());
      inFlight = refresh().finally(() => { inFlight = null; });
      return inFlight;
    },
  };
}
