import {
  buildMetadata,
  clampText,
  collectionStatus,
  isValidLngLat,
  pointGeometry,
  safeUrl,
  sourceIdentity,
} from './helpers';
import type { IntegrityMetadata, LocationPrecision, SourceCollectionStatus } from './types';

export const SURVEILLANCE_INDUSTRY_REPO = 'https://github.com/Ringmast4r/Surveillance-Industry';
export const SURVEILLANCE_INDUSTRY_RAW_BASE = 'https://raw.githubusercontent.com/Ringmast4r/Surveillance-Industry/main';

const README_SOURCE_URL = `${SURVEILLANCE_INDUSTRY_REPO}/blob/main/README.md`;
const ORIGINAL_PUBLISHER = 'Ringmast4r/Surveillance-Industry';

export interface SurveillanceIndustryIndexItem {
  id: string;
  label: string;
  region: string;
  pitch: string;
  filePath: string;
  sourceUrl: string;
  rawUrl: string;
  lat: number;
  lng: number;
  location_precision: LocationPrecision;
  location_note: string;
}

export interface SurveillanceIndustryMetric {
  metric: string;
  value: string;
}

export interface SurveillanceIndustrySourceLink {
  label: string;
  url: string;
}

export interface SurveillanceIndustryDossier {
  id: string;
  label: string;
  region: string;
  pitch: string;
  file_path: string;
  source_url: string;
  raw_url: string;
  lat: number;
  lng: number;
  location_precision: LocationPrecision;
  location_note: string;
  summary: string;
  categories: string[];
  featured_entities: string[];
  metrics: SurveillanceIndustryMetric[];
  source_links: SurveillanceIndustrySourceLink[];
  word_count: number;
  section_count: number;
  evidence_kind: 'reference';
  integrity: IntegrityMetadata;
}

export interface SurveillanceIndustryLocation {
  id: string;
  label: string;
  region: string;
  pitch: string;
  lat: number;
  lng: number;
  location_precision: LocationPrecision;
  location_note: string;
  dossier_count: number;
  section_count: number;
  entity_count: number;
  link_count: number;
  categories: string[];
  evidence_kind: 'reference';
  source_url: string;
}

export interface SurveillanceIndustryNormalizeInput {
  readmeMarkdown?: string | null;
  dossiers?: Record<string, string | null | undefined>;
  collectedAt: string;
  maxDossiers?: number;
  maxLinksPerDossier?: number;
  maxEntitiesPerDossier?: number;
}

export interface SurveillanceIndustryNormalizeResult {
  dossiers: SurveillanceIndustryDossier[];
  locations: SurveillanceIndustryLocation[];
  statuses: SourceCollectionStatus[];
  counts: {
    indexedDossiers: number;
    receivedDossiers: number;
    acceptedDossiers: number;
    rejectedDossiers: number;
    returnedDossiers: number;
    returnedLocations: number;
  };
}

const DOSSIER_LOCATIONS: Record<string, { lat: number; lng: number; precision: LocationPrecision; note: string }> = {
  'United States': { lat: 39.8283, lng: -98.5795, precision: 'country', note: 'Country centroid used for a country-level reference dossier.' },
  Canada: { lat: 56.1304, lng: -106.3468, precision: 'country', note: 'Country centroid used for a country-level reference dossier.' },
  Israel: { lat: 31.0461, lng: 34.8516, precision: 'country', note: 'Country centroid used for a country-level reference dossier.' },
  China: { lat: 35.8617, lng: 104.1954, precision: 'country', note: 'Country centroid used for a country-level reference dossier.' },
  Russia: { lat: 61.524, lng: 105.3188, precision: 'country', note: 'Country centroid used for a country-level reference dossier.' },
  'United Kingdom': { lat: 55.3781, lng: -3.436, precision: 'country', note: 'Country centroid used for a country-level reference dossier.' },
  France: { lat: 46.2276, lng: 2.2137, precision: 'country', note: 'Country centroid used for a country-level reference dossier.' },
  Germany: { lat: 51.1657, lng: 10.4515, precision: 'country', note: 'Country centroid used for a country-level reference dossier.' },
  Italy: { lat: 41.8719, lng: 12.5674, precision: 'country', note: 'Country centroid used for a country-level reference dossier.' },
  Spain: { lat: 40.4637, lng: -3.7492, precision: 'country', note: 'Country centroid used for a country-level reference dossier.' },
  Greece: { lat: 39.0742, lng: 21.8243, precision: 'country', note: 'Country centroid used for a country-level reference dossier.' },
  Netherlands: { lat: 52.1326, lng: 5.2913, precision: 'country', note: 'Country centroid used for a country-level reference dossier.' },
  Sweden: { lat: 60.1282, lng: 18.6435, precision: 'country', note: 'Country centroid used for a country-level reference dossier.' },
  Switzerland: { lat: 46.8182, lng: 8.2275, precision: 'country', note: 'Country centroid used for a country-level reference dossier.' },
  India: { lat: 20.5937, lng: 78.9629, precision: 'country', note: 'Country centroid used for a country-level reference dossier.' },
  Japan: { lat: 36.2048, lng: 138.2529, precision: 'country', note: 'Country centroid used for a country-level reference dossier.' },
  'South Korea': { lat: 35.9078, lng: 127.7669, precision: 'country', note: 'Country centroid used for a country-level reference dossier.' },
  Singapore: { lat: 1.3521, lng: 103.8198, precision: 'country', note: 'Country centroid used for a country-level reference dossier.' },
  Australia: { lat: -25.2744, lng: 133.7751, precision: 'country', note: 'Country centroid used for a country-level reference dossier.' },
  'Gulf States': { lat: 24, lng: 45, precision: 'region', note: 'Regional centroid used for the Gulf States reference dossier.' },
  Palantir: { lat: 39.7392, lng: -104.9903, precision: 'city', note: 'City point from the dossier metadata line identifying Denver, Colorado.' },
};

const GENERIC_ENTITY_HEADINGS = new Set([
  'Company Overview',
  'What Palantir Does',
  'Origin Story',
  'Key People',
  'PayPal Mafia Context',
  'The Network Behind Palantir',
  'Timeline',
  'Core Products',
  'Commercial Clients',
  'Corporate Normalization',
  'Major Government Contracts',
  'Government Users',
  'Intelligence Community',
  'Military',
  'Immigration Enforcement',
  'Other',
  'Known Police Departments',
  'Predictive Policing Concerns',
  'International Government Clients',
  'Allied Nations',
  'Ukraine Operations',
  'Stock & Valuation',
  'Trump Administration Effect',
  'Controversies & Criticism',
  'Company Statements',
  'Key Observations',
  'Legal Framework',
]);

export function parseSurveillanceIndustryIndex(readmeMarkdown: string | null | undefined): SurveillanceIndustryIndexItem[] {
  if (!readmeMarkdown) return [];
  const items: SurveillanceIndustryIndexItem[] = [];
  const seen = new Set<string>();
  const rowPattern = /^\|\s*\*\*\[([^\]]+)\]\(\.\/([^)]+\.md)\)\*\*\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/gm;
  let match: RegExpExecArray | null;
  while ((match = rowPattern.exec(readmeMarkdown))) {
    const label = cleanCell(match[1]);
    const filePath = cleanFilePath(match[2]);
    const region = cleanCell(match[3]);
    const pitch = cleanCell(match[4]);
    if (!label || !filePath || seen.has(filePath)) continue;
    const location = DOSSIER_LOCATIONS[label];
    if (!location || !isValidLngLat(location.lng, location.lat)) continue;
    seen.add(filePath);
    items.push({
      id: dossierId(filePath),
      label,
      region,
      pitch,
      filePath,
      sourceUrl: `${SURVEILLANCE_INDUSTRY_REPO}/blob/main/${filePath}`,
      rawUrl: `${SURVEILLANCE_INDUSTRY_RAW_BASE}/${filePath}`,
      lat: location.lat,
      lng: location.lng,
      location_precision: location.precision,
      location_note: location.note,
    });
  }
  return items;
}

export function normalizeSurveillanceIndustry(input: SurveillanceIndustryNormalizeInput): SurveillanceIndustryNormalizeResult {
  const maxDossiers = positiveInt(input.maxDossiers, 50);
  const maxLinksPerDossier = positiveInt(input.maxLinksPerDossier, 20);
  const maxEntitiesPerDossier = positiveInt(input.maxEntitiesPerDossier, 24);
  const index = parseSurveillanceIndustryIndex(input.readmeMarkdown);
  const statuses: SourceCollectionStatus[] = [{
    ...baseStatus('surveillance-industry:readme', 'Surveillance Industry README dossier index', README_SOURCE_URL, input.collectedAt),
    receivedRecords: index.length,
    acceptedRecords: index.length,
    dataState: index.length > 0 ? 'present' : 'empty',
    message: index.length > 0 ? null : 'README fetched but no dossier rows matched the expected source table.',
  }];

  const dossiers: SurveillanceIndustryDossier[] = [];
  let receivedDossiers = 0;
  let rejectedDossiers = 0;
  for (const item of index) {
    const markdown = input.dossiers?.[item.filePath];
    if (!markdown || !markdown.trim()) {
      rejectedDossiers++;
      continue;
    }
    receivedDossiers++;
    const dossier = normalizeDossier(item, markdown, input.collectedAt, maxLinksPerDossier, maxEntitiesPerDossier);
    if (!dossier) {
      rejectedDossiers++;
      continue;
    }
    dossiers.push(dossier);
    statuses.push({
      ...baseStatus(`surveillance-industry:dossier:${item.id}`, `${item.label} surveillance industry dossier`, item.sourceUrl, input.collectedAt),
      receivedRecords: 1,
      acceptedRecords: 1,
      rejectedRecords: 0,
      dataState: 'present',
    });
  }

  const returnedDossiers = dossiers.slice(0, maxDossiers);
  const locations = returnedDossiers.map(dossierToLocation);
  return {
    dossiers: returnedDossiers,
    locations,
    statuses,
    counts: {
      indexedDossiers: index.length,
      receivedDossiers,
      acceptedDossiers: dossiers.length,
      rejectedDossiers,
      returnedDossiers: returnedDossiers.length,
      returnedLocations: locations.length,
    },
  };
}

function normalizeDossier(
  item: SurveillanceIndustryIndexItem,
  markdown: string,
  collectedAt: string,
  maxLinksPerDossier: number,
  maxEntitiesPerDossier: number
): SurveillanceIndustryDossier | null {
  const words = markdown.match(/\b[\w'-]+\b/g) ?? [];
  const categories = extractHeadings(markdown, 2).slice(0, 16);
  const sourceLinks = extractLinks(markdown).slice(0, maxLinksPerDossier);
  const companies = extractCompanies(markdown);
  const entityHeadings = extractHeadings(markdown, 3).filter((heading) => !GENERIC_ENTITY_HEADINGS.has(heading));
  const featuredEntities = unique([...companies, ...entityHeadings]).slice(0, maxEntitiesPerDossier);
  const metrics = extractMetricRows(markdown).slice(0, 10);
  const summary = extractSummary(markdown, item.pitch);
  if (!summary && categories.length === 0 && featuredEntities.length === 0) return null;
  const evidenceReferences = [
    { label: 'Source dossier', url: item.sourceUrl },
    ...sourceLinks.slice(0, 8).map((link) => ({ label: link.label, url: link.url })),
  ];
  return {
    id: item.id,
    label: item.label,
    region: item.region,
    pitch: item.pitch,
    file_path: item.filePath,
    source_url: item.sourceUrl,
    raw_url: item.rawUrl,
    lat: item.lat,
    lng: item.lng,
    location_precision: item.location_precision,
    location_note: item.location_note,
    summary,
    categories,
    featured_entities: featuredEntities,
    metrics,
    source_links: sourceLinks,
    word_count: words.length,
    section_count: categories.length + entityHeadings.length,
    evidence_kind: 'reference',
    integrity: buildMetadata({
      recordId: item.id,
      upstreamId: item.filePath,
      source: sourceIdentity(`surveillance-industry:dossier:${item.id}`, `${item.label} surveillance industry dossier`, item.sourceUrl),
      itemUrl: item.sourceUrl,
      originalPublisher: ORIGINAL_PUBLISHER,
      evidenceKind: 'reference',
      verification: 'unassessed',
      methodology: 'Parsed from a Markdown reference dossier in Ringmast4r/Surveillance-Industry. It is not a live observation feed.',
      timing: { collectedAt },
      location: {
        geometry: pointGeometry(item.lng, item.lat),
        representativePoint: [item.lng, item.lat],
        precision: item.location_precision,
        relationship: item.location_precision === 'city' ? 'source_location' : 'mentioned_location',
        resolutionMethod: item.location_note,
        qualityFlags: item.location_precision === 'country' || item.location_precision === 'region' ? ['representative_centroid'] : [],
      },
      evidenceReferences,
    }),
  };
}

function dossierToLocation(dossier: SurveillanceIndustryDossier): SurveillanceIndustryLocation {
  return {
    id: `industry-location-${dossier.id}`,
    label: dossier.label,
    region: dossier.region,
    pitch: dossier.pitch,
    lat: dossier.lat,
    lng: dossier.lng,
    location_precision: dossier.location_precision,
    location_note: dossier.location_note,
    dossier_count: 1,
    section_count: dossier.section_count,
    entity_count: dossier.featured_entities.length,
    link_count: dossier.source_links.length,
    categories: dossier.categories.slice(0, 6),
    evidence_kind: 'reference',
    source_url: dossier.source_url,
  };
}

function extractHeadings(markdown: string, level: 2 | 3): string[] {
  const prefix = '#'.repeat(level);
  const pattern = new RegExp(`^${prefix}\\s+(.+)$`, 'gm');
  const headings: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown))) {
    const heading = stripMarkdown(match[1]);
    if (heading) headings.push(heading);
  }
  return unique(headings);
}

function extractCompanies(markdown: string): string[] {
  const companies: string[] = [];
  const pattern = /^\*\*Company:\*\*\s*(.+?)\s*$/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown))) {
    const company = stripMarkdown(match[1]);
    if (company) companies.push(company);
  }
  return unique(companies);
}

function extractMetricRows(markdown: string): SurveillanceIndustryMetric[] {
  const lines = markdown.split(/\r?\n/);
  const metrics: SurveillanceIndustryMetric[] = [];
  for (let index = 0; index < lines.length; index++) {
    if (!/^\|\s*Metric\s*\|\s*Value\s*\|/i.test(lines[index])) continue;
    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex++) {
      const row = lines[rowIndex];
      if (!row.startsWith('|')) break;
      const cells = row.split('|').slice(1, -1).map(cleanCell);
      if (cells.length < 2 || !cells[0] || !cells[1]) continue;
      metrics.push({ metric: cells[0], value: cells[1] });
    }
  }
  return metrics;
}

function extractLinks(markdown: string): SurveillanceIndustrySourceLink[] {
  const links: SurveillanceIndustrySourceLink[] = [];
  const seen = new Set<string>();
  const markdownLinkPattern = /\[([^\]]{1,160})\]\((https?:\/\/[^)\s]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = markdownLinkPattern.exec(markdown))) {
    addLink(links, seen, stripMarkdown(match[1]) || hostLabel(match[2]), match[2]);
  }
  const autoLinkPattern = /<((?:https?:\/\/)[^>\s]+)>/g;
  while ((match = autoLinkPattern.exec(markdown))) {
    addLink(links, seen, hostLabel(match[1]), match[1]);
  }
  return links;
}

function addLink(links: SurveillanceIndustrySourceLink[], seen: Set<string>, label: string, rawUrl: string): void {
  const url = safeUrl(rawUrl);
  if (!url || seen.has(url)) return;
  seen.add(url);
  links.push({ label: clampText(label, 80), url });
}

function hostLabel(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '');
  } catch {
    return 'Source link';
  }
}

function extractSummary(markdown: string, fallback: string): string {
  const lines = markdown.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.length < 40 ||
      trimmed.startsWith('<') ||
      trimmed.startsWith('|') ||
      trimmed.startsWith('#') ||
      trimmed.startsWith('>') ||
      trimmed.startsWith('-') ||
      trimmed.startsWith('`') ||
      /^\*\*(Company|Origin|Website|Contracts|Users|Concerns):\*\*/.test(trimmed)
    ) {
      continue;
    }
    const text = stripMarkdown(trimmed);
    if (text.length >= 40) return clampText(text, 420);
  }
  return clampText(fallback, 420);
}

function stripMarkdown(value: string): string {
  return value
    .replace(/`+/g, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/<((?:https?:\/\/)[^>]+)>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanCell(value: string): string {
  return stripMarkdown(value.replace(/<br\s*\/?>/gi, ' '));
}

function cleanFilePath(value: string): string | null {
  const cleaned = value.trim().replace(/^\.?\//, '');
  if (!/^[a-z0-9][a-z0-9-]+\.md$/i.test(cleaned)) return null;
  return cleaned;
}

function dossierId(filePath: string): string {
  return filePath.replace(/\.md$/i, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const clean = clampText(value, 120);
    if (!clean || seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    result.push(clean);
  }
  return result;
}

function baseStatus(providerId: string, providerName: string, feedUrl: string, collectedAt: string): SourceCollectionStatus {
  return collectionStatus({
    source: sourceIdentity(providerId, providerName, feedUrl),
    availability: 'ok',
    dataState: 'empty',
    freshness: 'fresh',
    lastAttemptAt: collectedAt,
    lastSuccessfulFetchAt: collectedAt,
  });
}

function positiveInt(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value && value > 0 ? Math.floor(value) : fallback;
}
