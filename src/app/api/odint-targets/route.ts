import { NextRequest, NextResponse } from 'next/server';
import { collectionStatus, nowIso, sourceIdentity, updateSourceStatuses } from '@/lib/feed-integrity';
import {
  ODINT_REPO,
  ODINT_ROOT_PATH,
  ODINT_TREE_API,
  describeOdintPath,
  normalizeOdintCyberRecon,
  odintBlobUrl,
  odintRawUrl,
} from '@/lib/feed-integrity/odint';
import type { SourceCollectionStatus } from '@/lib/feed-integrity';

const FETCH_TIMEOUT_MS = 20_000;
const MEMORY_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MAX_FILES = 750;
const MAX_FILES_LIMIT = 1000;
const DEFAULT_MAX_TARGETS = 5000;
const MAX_TARGETS_LIMIT = 50_000;
const DEFAULT_MAX_SUMMARIES = 1000;
const MAX_SUMMARIES_LIMIT = 2000;
const RAW_FETCH_CONCURRENCY = 16;

interface GitTreeEntry {
  path?: string;
  type?: string;
  size?: number;
}

interface GitTreeResponse {
  tree?: GitTreeEntry[];
  truncated?: boolean;
}

interface FetchedTextFile {
  path: string;
  text: string | null;
  status: SourceCollectionStatus;
}

interface CachedPayload {
  storedAtMs: number;
  cacheKey: string;
  payload: Record<string, unknown>;
  statuses: SourceCollectionStatus[];
}

const globalForOdint = globalThis as unknown as {
  overseerOdintTargetsCache?: Map<string, CachedPayload>;
};

if (!globalForOdint.overseerOdintTargetsCache) {
  globalForOdint.overseerOdintTargetsCache = new Map();
}

function parsePositiveParam(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function cleanFilter(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return cleaned || null;
}

function matchesFilter(path: string, filter: string | null): boolean {
  if (!filter) return true;
  const context = describeOdintPath(path);
  const normalized = [
    path,
    context.region,
    context.country,
    context.title,
    context.category,
  ].filter(Boolean).join(' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  return normalized.includes(filter);
}

async function fetchOdintTree(collectedAt: string): Promise<{ paths: string[]; truncated: boolean; status: SourceCollectionStatus }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(ODINT_TREE_API, {
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Overseer-Source-Verifier',
      },
    });
    if (!response.ok) {
      return {
        paths: [],
        truncated: false,
        status: collectionStatus({
          source: sourceIdentity('odint:github-tree', 'ODINT GitHub tree API', ODINT_TREE_API),
          availability: response.status === 403 || response.status === 429 ? 'rate_limited' : 'error',
          dataState: 'unavailable',
          freshness: 'unknown',
          lastAttemptAt: collectedAt,
          errorCode: `HTTP_${response.status}`,
          message: `GitHub tree API returned HTTP ${response.status}; use the repository page as the alternate source view.`,
        }),
      };
    }

    const payload = await response.json() as GitTreeResponse;
    const entries = Array.isArray(payload.tree) ? payload.tree : [];
    const paths = entries
      .filter((entry) => entry.type === 'blob' && typeof entry.path === 'string')
      .map((entry) => entry.path as string)
      .filter((path) => path.startsWith(`${ODINT_ROOT_PATH}/`) && path.toLowerCase().endsWith('.txt'))
      .sort((a, b) => a.localeCompare(b));
    return {
      paths,
      truncated: Boolean(payload.truncated),
      status: collectionStatus({
        source: sourceIdentity('odint:github-tree', 'ODINT GitHub tree API', ODINT_TREE_API),
        availability: paths.length > 0 ? 'ok' : 'error',
        dataState: paths.length > 0 ? 'present' : 'unavailable',
        freshness: paths.length > 0 ? 'fresh' : 'unknown',
        lastAttemptAt: collectedAt,
        lastSuccessfulFetchAt: paths.length > 0 ? collectedAt : null,
        receivedRecords: entries.length,
        acceptedRecords: paths.length,
        rejectedRecords: Math.max(0, entries.length - paths.length),
        errorCode: paths.length > 0 ? null : 'ODINT_TREE_EMPTY',
        message: payload.truncated
          ? 'GitHub reported the recursive tree as truncated; returned ODINT files may be incomplete.'
          : null,
      }),
    };
  } catch (error) {
    return {
      paths: [],
      truncated: false,
      status: collectionStatus({
        source: sourceIdentity('odint:github-tree', 'ODINT GitHub tree API', ODINT_TREE_API),
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

async function fetchTextFile(path: string, collectedAt: string): Promise<FetchedTextFile> {
  const rawUrl = odintRawUrl(path);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(rawUrl, {
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Accept: 'text/plain, */*;q=0.5',
        'User-Agent': 'Overseer-Source-Verifier',
      },
    });
    if (!response.ok) {
      return {
        path,
        text: null,
        status: collectionStatus({
          source: sourceIdentity(providerIdForPath(path), providerNameForPath(path), rawUrl),
          availability: response.status === 403 || response.status === 429 ? 'rate_limited' : 'error',
          dataState: 'unavailable',
          freshness: 'unknown',
          lastAttemptAt: collectedAt,
          errorCode: `HTTP_${response.status}`,
          message: `GitHub raw returned HTTP ${response.status}; the GitHub blob page is the alternate source view: ${odintBlobUrl(path)}`,
        }),
      };
    }

    const text = await response.text();
    return {
      path,
      text,
      status: collectionStatus({
        source: sourceIdentity(providerIdForPath(path), providerNameForPath(path), rawUrl),
        availability: 'ok',
        dataState: text.trim() ? 'present' : 'empty',
        freshness: 'fresh',
        lastAttemptAt: collectedAt,
        lastSuccessfulFetchAt: collectedAt,
        receivedRecords: text.length,
        acceptedRecords: text.trim() ? 1 : 0,
      }),
    };
  } catch (error) {
    return {
      path,
      text: null,
      status: collectionStatus({
        source: sourceIdentity(providerIdForPath(path), providerNameForPath(path), rawUrl),
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

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function providerIdForPath(path: string): string {
  const slug = path.replace(/^CYBER RECON TOUR\//, '').replace(/\.txt$/i, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return `odint:file:${slug || 'source-file'}`;
}

function providerNameForPath(path: string): string {
  return `ODINT ${path.replace(/^CYBER RECON TOUR\//, '').replace(/\.txt$/i, '').replace(/[/-]+/g, ' ')} source file`;
}

export async function GET(request: NextRequest) {
  const collectedAt = nowIso();
  const searchParams = request.nextUrl.searchParams;
  const maxFiles = parsePositiveParam(searchParams.get('maxFiles'), DEFAULT_MAX_FILES, MAX_FILES_LIMIT);
  const maxTargets = parsePositiveParam(searchParams.get('maxTargets'), DEFAULT_MAX_TARGETS, MAX_TARGETS_LIMIT);
  const maxSummaries = parsePositiveParam(searchParams.get('maxSummaries'), DEFAULT_MAX_SUMMARIES, MAX_SUMMARIES_LIMIT);
  const regionFilter = cleanFilter(searchParams.get('region'));
  const countryFilter = cleanFilter(searchParams.get('country'));
  const cacheKey = `${maxFiles}:${maxTargets}:${maxSummaries}:${regionFilter ?? ''}:${countryFilter ?? ''}`;
  const cache = globalForOdint.overseerOdintTargetsCache!;
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

  const tree = await fetchOdintTree(collectedAt);
  if (tree.paths.length === 0) {
    updateSourceStatuses([tree.status]);
    return NextResponse.json({
      targets: [],
      summaries: [],
      total: 0,
      counts: {
        indexedFiles: 0,
        selectedFiles: 0,
        fetchedFiles: 0,
        failedFiles: 0,
        truncatedTree: tree.truncated,
      },
      status: [tree.status],
      timestamp: collectedAt,
      source: 'Ringmast4r/ODINT',
      source_url: ODINT_REPO,
      alternate_source_url: ODINT_REPO,
      error: 'ODINT GitHub tree was unavailable or contained no CYBER RECON TOUR text files.',
    }, { status: 503 });
  }

  const filteredPaths = tree.paths
    .filter((path) => matchesFilter(path, regionFilter))
    .filter((path) => matchesFilter(path, countryFilter));
  const selectedPaths = filteredPaths.slice(0, maxFiles);
  const cappedFiles = filteredPaths.length > selectedPaths.length;
  const fetched = await mapWithConcurrency(selectedPaths, RAW_FETCH_CONCURRENCY, (path) => fetchTextFile(path, collectedAt));
  const fetchedUsable = fetched.filter((file) => file.text?.trim()).length;
  const failedFetchStatuses = fetched.map((file) => file.status).filter((status) => status.availability !== 'ok');

  if (fetchedUsable === 0) {
    const statuses = [tree.status, ...failedFetchStatuses];
    updateSourceStatuses(statuses);
    return NextResponse.json({
      targets: [],
      summaries: [],
      total: 0,
      counts: {
        indexedFiles: tree.paths.length,
        matchingFiles: filteredPaths.length,
        selectedFiles: selectedPaths.length,
        fetchedFiles: 0,
        failedFiles: selectedPaths.length,
        truncatedTree: tree.truncated,
      },
      status: statuses,
      timestamp: collectedAt,
      source: 'Ringmast4r/ODINT',
      source_url: ODINT_REPO,
      alternate_source_url: ODINT_REPO,
      error: 'No selected ODINT raw text files were available from GitHub raw.',
    }, { status: 503 });
  }

  const normalized = normalizeOdintCyberRecon({
    files: fetched.map((file) => ({ path: file.path, text: file.text })),
    collectedAt,
    maxTargets,
    maxSummaries,
  });
  const statuses = [tree.status, ...failedFetchStatuses, ...normalized.statuses];
  updateSourceStatuses(statuses);

  const payload = {
    targets: normalized.targets,
    summaries: normalized.summaries,
    total: normalized.counts.acceptedTargets,
    counts: {
      ...normalized.counts,
      indexedFiles: tree.paths.length,
      matchingFiles: filteredPaths.length,
      selectedFiles: selectedPaths.length,
      fetchedFiles: fetchedUsable,
      failedFiles: selectedPaths.length - fetchedUsable,
      cappedFiles,
      truncatedTree: tree.truncated,
    },
    status: statuses,
    timestamp: collectedAt,
    source: 'Ringmast4r/ODINT',
    source_url: ODINT_REPO,
    alternate_source_url: ODINT_REPO,
    notes: [
      'Public ODINT CYBER RECON TOUR reference material only; records are not live observations, vulnerability findings, or authorization to scan targets.',
      'Only explicit domains and URLs are emitted. Comments, prose, relative paths, and unavailable files are omitted rather than replaced with synthetic targets.',
      cappedFiles ? `Fetched ${selectedPaths.length} of ${filteredPaths.length} matching ODINT files due to maxFiles=${maxFiles}. Increase maxFiles to expand coverage.` : null,
      tree.truncated ? 'GitHub marked the recursive tree response as truncated; file coverage may be incomplete.' : null,
    ].filter(Boolean),
  };

  cache.set(cacheKey, { storedAtMs: Date.now(), cacheKey, payload, statuses });
  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=43200' },
  });
}
