import { NextRequest, NextResponse } from 'next/server';
import { collectionStatus, nowIso, sourceIdentity, updateSourceStatuses } from '@/lib/feed-integrity';
import {
  SURVEILLANCE_INDUSTRY_RAW_BASE,
  SURVEILLANCE_INDUSTRY_REPO,
  normalizeSurveillanceIndustry,
  parseSurveillanceIndustryIndex,
} from '@/lib/feed-integrity/surveillance-industry';
import type { SourceCollectionStatus } from '@/lib/feed-integrity';

const FETCH_TIMEOUT_MS = 20_000;
const MEMORY_TTL_MS = 6 * 60 * 60 * 1000;
const README_PATH = 'README.md';

interface CachedPayload {
  storedAtMs: number;
  cacheKey: string;
  payload: Record<string, unknown>;
  statuses: SourceCollectionStatus[];
}

const globalForIndustry = globalThis as unknown as {
  overseerSurveillanceIndustryCache?: Map<string, CachedPayload>;
};

if (!globalForIndustry.overseerSurveillanceIndustryCache) {
  globalForIndustry.overseerSurveillanceIndustryCache = new Map();
}

function parsePositiveParam(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function providerIdForPath(path: string): string {
  if (path === README_PATH) return 'surveillance-industry:readme';
  const slug = path.replace(/\.md$/i, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return `surveillance-industry:dossier:${slug}`;
}

function providerNameForPath(path: string): string {
  if (path === README_PATH) return 'Surveillance Industry README dossier index';
  return `${path.replace(/\.md$/i, '').replace(/-/g, ' ')} surveillance industry dossier`;
}

async function fetchMarkdown(path: string, collectedAt: string): Promise<{ path: string; text: string | null; status: SourceCollectionStatus }> {
  const rawUrl = `${SURVEILLANCE_INDUSTRY_RAW_BASE}/${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(rawUrl, {
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'text/markdown, text/plain;q=0.9, */*;q=0.5' },
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
          message: `GitHub raw source returned HTTP ${response.status}`,
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

export async function GET(request: NextRequest) {
  const collectedAt = nowIso();
  const searchParams = request.nextUrl.searchParams;
  const maxDossiers = parsePositiveParam(searchParams.get('maxDossiers'), 50, 100);
  const maxLinksPerDossier = parsePositiveParam(searchParams.get('maxLinksPerDossier'), 20, 60);
  const maxEntitiesPerDossier = parsePositiveParam(searchParams.get('maxEntitiesPerDossier'), 24, 80);
  const cacheKey = `${maxDossiers}:${maxLinksPerDossier}:${maxEntitiesPerDossier}`;
  const cache = globalForIndustry.overseerSurveillanceIndustryCache!;
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

  const readme = await fetchMarkdown(README_PATH, collectedAt);
  if (!readme.text?.trim()) {
    updateSourceStatuses([readme.status]);
    return NextResponse.json({
      dossiers: [],
      locations: [],
      total: 0,
      status: [readme.status],
      timestamp: collectedAt,
      source: 'Ringmast4r/Surveillance-Industry',
      source_url: SURVEILLANCE_INDUSTRY_REPO,
      alternate_source_url: `${SURVEILLANCE_INDUSTRY_REPO}/blob/main/README.md`,
      error: 'The Surveillance-Industry README dossier index was unavailable from GitHub raw.',
    }, { status: 503 });
  }

  const index = parseSurveillanceIndustryIndex(readme.text);
  if (index.length === 0) {
    const status = collectionStatus({
      source: sourceIdentity('surveillance-industry:readme', 'Surveillance Industry README dossier index', `${SURVEILLANCE_INDUSTRY_REPO}/blob/main/README.md`),
      availability: 'error',
      dataState: 'unavailable',
      freshness: 'unknown',
      lastAttemptAt: collectedAt,
      errorCode: 'DOSSIER_INDEX_EMPTY',
      message: 'README was available, but no dossier rows matched the expected source table.',
    });
    updateSourceStatuses([status]);
    return NextResponse.json({
      dossiers: [],
      locations: [],
      total: 0,
      status: [status],
      timestamp: collectedAt,
      source: 'Ringmast4r/Surveillance-Industry',
      source_url: SURVEILLANCE_INDUSTRY_REPO,
      error: 'No Surveillance-Industry dossier links could be parsed from README.md.',
    }, { status: 502 });
  }

  const fetchedDossiers = await Promise.all(index.map((item) => fetchMarkdown(item.filePath, collectedAt)));
  const dossierTexts = Object.fromEntries(fetchedDossiers.map((result) => [result.path, result.text]));
  const usableDossiers = fetchedDossiers.filter((result) => result.text?.trim()).length;
  const fetchStatuses = [readme.status, ...fetchedDossiers.map((result) => result.status)];

  if (usableDossiers === 0) {
    updateSourceStatuses(fetchStatuses);
    return NextResponse.json({
      dossiers: [],
      locations: [],
      total: 0,
      status: fetchStatuses,
      timestamp: collectedAt,
      source: 'Ringmast4r/Surveillance-Industry',
      source_url: SURVEILLANCE_INDUSTRY_REPO,
      alternate_source_url: SURVEILLANCE_INDUSTRY_REPO,
      error: 'No Surveillance-Industry dossier markdown files were available from GitHub raw.',
    }, { status: 503 });
  }

  const normalized = normalizeSurveillanceIndustry({
    readmeMarkdown: readme.text,
    dossiers: dossierTexts,
    collectedAt,
    maxDossiers,
    maxLinksPerDossier,
    maxEntitiesPerDossier,
  });
  const statuses = [...fetchStatuses.filter((status) => status.availability !== 'ok'), ...normalized.statuses];
  updateSourceStatuses(statuses);

  const payload = {
    dossiers: normalized.dossiers,
    locations: normalized.locations,
    total: normalized.counts.acceptedDossiers,
    counts: normalized.counts,
    status: statuses,
    timestamp: collectedAt,
    source: 'Ringmast4r/Surveillance-Industry',
    source_url: SURVEILLANCE_INDUSTRY_REPO,
    notes: [
      'Reference Markdown dossiers, not live surveillance observations.',
      'Country and regional dossier markers use representative centroids with explicit precision labels.',
      'Unavailable dossier files are omitted and reported in provider status instead of replaced with synthetic records.',
    ],
  };

  cache.set(cacheKey, { storedAtMs: Date.now(), cacheKey, payload, statuses });
  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=43200' },
  });
}
