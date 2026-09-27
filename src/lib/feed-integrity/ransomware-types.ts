import type { IntegrityMetadata, SourceCollectionStatus } from './types';

export const RANSOMWARE_REFRESH_MS = 30 * 60 * 1000;
export const RANSOMWARE_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const RANSOMLOOK_URL = 'https://www.ransomlook.io/api/recent/100';
export const RANSOMLOOK_ATTRIBUTION = {
  provider: 'RansomLook',
  url: 'https://www.ransomlook.io/recent',
  license: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  changes: 'Normalized, deduplicated and shortened to plain-text metadata by Overseer.',
} as const;

export interface RansomwareReport {
  id: string;
  title: string;
  group: string;
  description: string | null;
  discoveredAt: string | null;
  publishedAt: null;
  attackAt: null;
  country: null;
  sector: null;
  source: 'RansomLook';
  sourceUrl: string;
  verification: 'unassessed';
  recordKind: 'ransomware_related_post';
  integrity: IntegrityMetadata;
}

export interface RansomwareEnvelope {
  ransomware_reports: RansomwareReport[];
  dataMode: 'real';
  collectedAt: string | null;
  nextRefreshAt: string;
  status: [SourceCollectionStatus];
  coverage: {
    kind: 'latest_posts';
    limit: 100;
    notExhaustive: true;
    duplicatesRemoved: number;
    newestDiscoveryAt: string | null;
    oldestDiscoveryAt: string | null;
  };
  attribution: typeof RANSOMLOOK_ATTRIBUTION;
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function dateOrNull(value: unknown): boolean {
  return value === null || (typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value)));
}
function count(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Check the wire contract before the UI accepts a response, including error envelopes. */
export function isRansomwareEnvelope(value: unknown): value is RansomwareEnvelope {
  if (!object(value) || value.dataMode !== 'real' || !dateOrNull(value.collectedAt) ||
      typeof value.nextRefreshAt !== 'string' || !dateOrNull(value.nextRefreshAt) ||
      !Array.isArray(value.ransomware_reports) || value.ransomware_reports.length > 100 ||
      !Array.isArray(value.status) || value.status.length !== 1) return false;
  const status = value.status[0];
  if (!object(status) || !object(status.source) || status.source.providerId !== 'ransomware:ransomlook' ||
      !['ok', 'partial', 'error', 'rate_limited'].includes(String(status.availability)) ||
      !['present', 'empty', 'unavailable'].includes(String(status.dataState)) ||
      !['fresh', 'stale', 'unknown'].includes(String(status.freshness)) ||
      typeof status.servingLastKnownGood !== 'boolean' ||
      !dateOrNull(status.lastAttemptAt) || !dateOrNull(status.lastSuccessfulFetchAt) || !dateOrNull(status.nextRetryAt) ||
      !count(status.acceptedRecords) || !count(status.receivedRecords) || !count(status.rejectedRecords) ||
      !(status.message === null || typeof status.message === 'string') ||
      !(status.errorCode === null || typeof status.errorCode === 'string')) return false;
  if (status.acceptedRecords !== value.ransomware_reports.length ||
      (status.dataState === 'present' && value.ransomware_reports.length === 0) ||
      (status.dataState !== 'present' && value.ransomware_reports.length > 0) ||
      (status.dataState !== 'unavailable' && value.collectedAt === null)) return false;
  const coverage = value.coverage;
  if (!object(coverage) || coverage.kind !== 'latest_posts' || coverage.limit !== 100 || coverage.notExhaustive !== true ||
      !count(coverage.duplicatesRemoved) || !dateOrNull(coverage.newestDiscoveryAt) || !dateOrNull(coverage.oldestDiscoveryAt)) return false;
  if (!object(value.attribution) || value.attribution.provider !== RANSOMLOOK_ATTRIBUTION.provider ||
      value.attribution.url !== RANSOMLOOK_ATTRIBUTION.url || value.attribution.license !== RANSOMLOOK_ATTRIBUTION.license ||
      value.attribution.licenseUrl !== RANSOMLOOK_ATTRIBUTION.licenseUrl || typeof value.attribution.changes !== 'string') return false;
  return value.ransomware_reports.every((report) => {
    if (!object(report) || typeof report.id !== 'string' || !/^ransomware-[a-f0-9]{24}$/.test(report.id) ||
        typeof report.title !== 'string' || !report.title.trim() || report.title.length > 500 ||
        typeof report.group !== 'string' || !report.group.trim() || report.group.length > 160 ||
        !(report.description === null || (typeof report.description === 'string' && report.description.length <= 2000)) ||
        !dateOrNull(report.discoveredAt) || report.publishedAt !== null || report.attackAt !== null ||
        report.country !== null || report.sector !== null || report.source !== 'RansomLook' ||
        report.sourceUrl !== RANSOMLOOK_ATTRIBUTION.url || report.verification !== 'unassessed' ||
        report.recordKind !== 'ransomware_related_post' || !object(report.integrity)) return false;
    const { provenance, timing, location } = report.integrity;
    return object(provenance) && provenance.evidenceKind === 'report' && provenance.verification === 'unassessed' &&
      object(timing) && typeof timing.collectedAt === 'string' && dateOrNull(timing.collectedAt) &&
      object(location) && location.geometry === null && location.precision === 'unknown' &&
      Array.isArray(location.qualityFlags) && location.qualityFlags.every((flag) => typeof flag === 'string');
  });
}

export function filterRansomwareReports(
  reports: RansomwareReport[],
  options: { query: string; group: string; days: number | null; nowMs: number },
): RansomwareReport[] {
  const query = options.query.trim().toLocaleLowerCase();
  return reports.filter((report) => {
    if (options.group && report.group !== options.group) return false;
    if (query && !`${report.title} ${report.group} ${report.description ?? ''}`.toLocaleLowerCase().includes(query)) return false;
    if (options.days !== null) {
      const discovered = report.discoveredAt === null ? NaN : Date.parse(report.discoveredAt);
      if (!Number.isFinite(discovered) || discovered > options.nowMs || discovered < options.nowMs - options.days * 86400000) return false;
    }
    return true;
  });
}
