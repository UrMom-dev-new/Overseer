import { buildMetadata, parseDateOrNull, sourceIdentity, stableId } from './helpers';
import type { IntegrityMetadata } from './types';

export interface NormalizedKevEntry {
  id: string;
  name: string;
  vendor: string | null;
  product: string | null;
  severity: null;
  technical_severity: null;
  user_relevance: null;
  known_exploited: true;
  date: string | null;
  due: string | null;
  source: 'CISA KEV';
  evidence_kind: 'reference';
  integrity: IntegrityMetadata;
}

export function normalizeKevCatalog(input: unknown, feedUrl: string, collectedAt: string, maxDays = 30): {
  records: NormalizedKevEntry[];
  totalCatalogRecords: number;
  received: number;
  rejected: number;
} | null {
  if (!input || typeof input !== 'object') return null;
  const vulnerabilities = (input as { vulnerabilities?: unknown }).vulnerabilities;
  if (!Array.isArray(vulnerabilities)) return null;

  const source = sourceIdentity('cisa-kev', 'CISA Known Exploited Vulnerabilities Catalog', feedUrl);
  const cutoffMs = Date.now() - maxDays * 24 * 60 * 60 * 1000;
  const records: NormalizedKevEntry[] = [];
  let rejected = 0;

  for (const item of vulnerabilities) {
    if (!item || typeof item !== 'object') {
      rejected++;
      continue;
    }
    const v = item as Record<string, unknown>;
    const cveID = typeof v.cveID === 'string' ? v.cveID : null;
    if (!cveID) {
      rejected++;
      continue;
    }
    const added = parseDateOrNull(v.dateAdded);
    if (added && new Date(added).getTime() < cutoffMs) continue;
    const due = parseDateOrNull(v.dueDate);
    const recordId = stableId('kev', [cveID, added]);

    records.push({
      id: cveID,
      name: typeof v.vulnerabilityName === 'string' ? v.vulnerabilityName : cveID,
      vendor: typeof v.vendorProject === 'string' ? v.vendorProject : null,
      product: typeof v.product === 'string' ? v.product : null,
      severity: null,
      technical_severity: null,
      user_relevance: null,
      known_exploited: true,
      date: added,
      due,
      source: 'CISA KEV',
      evidence_kind: 'reference',
      integrity: buildMetadata({
        recordId,
        upstreamId: cveID,
        source,
        itemUrl: null,
        evidenceKind: 'reference',
        timing: { publishedAt: added, sourceUpdatedAt: added, collectedAt },
        location: {
          precision: 'unknown',
          relationship: 'unknown',
          qualityFlags: ['non_geographic_reference_record'],
        },
        methodology: 'CISA KEV indicates known exploitation. It does not provide CVSS/technical severity or asset-specific relevance.',
      }),
    });
  }

  return {
    records: records.slice(0, 10),
    totalCatalogRecords: vulnerabilities.length,
    received: vulnerabilities.length,
    rejected,
  };
}

