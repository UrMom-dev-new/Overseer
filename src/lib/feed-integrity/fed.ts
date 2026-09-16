import {
  buildMetadata,
  clampText,
  collectionStatus,
  safeUrl,
  sourceIdentity,
  stableId,
} from './helpers';
import type { IntegrityMetadata, SourceCollectionStatus } from './types';

export const FED_REPO = 'https://github.com/Ringmast4r/FED';
export const FED_RAW_BASE = 'https://raw.githubusercontent.com/Ringmast4r/FED/master';

export const FED_FILES = {
  readme: {
    path: 'README.md',
    providerId: 'fed:readme',
    providerName: 'FED README database index',
  },
  spy: {
    path: 'spy-vs-spy.md',
    providerId: 'fed:spy-vs-spy',
    providerName: 'FED SPY vs SPY intelligence agency rolodex',
  },
  cultural: {
    path: 'cultural-centers.md',
    providerId: 'fed:cultural-centers',
    providerName: 'FED Culture as Cover cultural centers rolodex',
  },
} as const;

export type FedFileKey = keyof typeof FED_FILES;
export type FedDatabase = 'spy_vs_spy' | 'cultural_centers';

export interface FedIntelligenceEntity {
  id: string;
  name: string;
  alternate_name: string | null;
  country: string | null;
  topic: string;
  category: string;
  website: string | null;
  description: string[];
  source_file: string;
  source_url: string;
  raw_url: string;
  line_number: number;
  evidence_kind: 'reference';
  integrity: IntegrityMetadata;
}

export interface FedCulturalCenter {
  id: string;
  name: string;
  country: string | null;
  location_context: string | null;
  network: string | null;
  category: string;
  website: string | null;
  description: string[];
  source_file: string;
  source_url: string;
  raw_url: string;
  line_number: number;
  evidence_kind: 'reference';
  integrity: IntegrityMetadata;
}

export interface FedSummary {
  id: string;
  database: FedDatabase | 'readme';
  title: string;
  source_file: string;
  source_url: string;
  raw_url: string;
  record_count: number;
  country_count: number;
  section_count: number;
  metadata: Record<string, string>;
  evidence_kind: 'reference';
}

export interface FedNormalizeInput {
  readmeMarkdown?: string | null;
  spyMarkdown?: string | null;
  culturalMarkdown?: string | null;
  collectedAt: string;
  maxEntities?: number;
  maxCenters?: number;
}

export interface FedNormalizeResult {
  intelligenceEntities: FedIntelligenceEntity[];
  culturalCenters: FedCulturalCenter[];
  summaries: FedSummary[];
  statuses: SourceCollectionStatus[];
  counts: {
    receivedFiles: number;
    acceptedFiles: number;
    rejectedFiles: number;
    receivedLines: number;
    acceptedIntelligenceEntities: number;
    acceptedCulturalCenters: number;
    rejectedRecordLines: number;
    returnedIntelligenceEntities: number;
    returnedCulturalCenters: number;
    returnedSummaries: number;
  };
}

interface ParsedFedFile<T> {
  records: T[];
  summary: FedSummary;
  receivedLines: number;
  rejectedRecordLines: number;
}

interface PendingEntity {
  name: string;
  alternateName: string | null;
  country: string | null;
  topic: string;
  category: string;
  website: string | null;
  description: string[];
  sourceFile: string;
  sourceUrl: string;
  rawUrl: string;
  lineNumber: number;
}

interface PendingCenter {
  name: string;
  country: string | null;
  locationContext: string | null;
  network: string | null;
  category: string;
  website: string | null;
  description: string[];
  sourceFile: string;
  sourceUrl: string;
  rawUrl: string;
  lineNumber: number;
}

const INTRO_HEADINGS = new Set([
  'the ultimate global intelligence agency rolodex',
  'a global database of cultural centers and their intelligence connections',
  'introduction',
  'table of contents',
  'countries (a-z)',
  'quick stats',
]);

const SPECIAL_TOPIC_PATTERNS = [
  /\balliance\b/i,
  /\binternational organizations\b/i,
  /\bsurveillance programs\b/i,
  /\bexpansion\b/i,
  /\bprivate intelligence\b/i,
  /\btech companies\b/i,
  /\bcounter-terrorism\b/i,
];

export function normalizeFedRolodex(input: FedNormalizeInput): FedNormalizeResult {
  const maxEntities = positiveInt(input.maxEntities, 2000);
  const maxCenters = positiveInt(input.maxCenters, 3000);
  const summaries: FedSummary[] = [];
  const statuses: SourceCollectionStatus[] = [];
  let receivedFiles = 0;
  let acceptedFiles = 0;
  let rejectedFiles = 0;
  let receivedLines = 0;
  let rejectedRecordLines = 0;
  let allIntelligenceEntities: FedIntelligenceEntity[] = [];
  let allCulturalCenters: FedCulturalCenter[] = [];

  if (input.readmeMarkdown?.trim()) {
    receivedFiles++;
    acceptedFiles++;
    const summary = parseReadmeSummary(input.readmeMarkdown);
    summaries.push(summary);
    receivedLines += input.readmeMarkdown.split(/\r?\n/).length;
    statuses.push(statusForSummary(FED_FILES.readme.providerId, FED_FILES.readme.providerName, fedBlobUrl(FED_FILES.readme.path), input.collectedAt, summary.record_count));
  } else if (input.readmeMarkdown !== undefined) {
    receivedFiles++;
    rejectedFiles++;
  }

  if (input.spyMarkdown?.trim()) {
    receivedFiles++;
    acceptedFiles++;
    const parsed = parseSpyVsSpy(input.spyMarkdown, input.collectedAt);
    allIntelligenceEntities = parsed.records;
    summaries.push(parsed.summary);
    receivedLines += parsed.receivedLines;
    rejectedRecordLines += parsed.rejectedRecordLines;
    statuses.push(statusForSummary(FED_FILES.spy.providerId, FED_FILES.spy.providerName, parsed.summary.source_url, input.collectedAt, parsed.records.length));
  } else if (input.spyMarkdown !== undefined) {
    receivedFiles++;
    rejectedFiles++;
  }

  if (input.culturalMarkdown?.trim()) {
    receivedFiles++;
    acceptedFiles++;
    const parsed = parseCulturalCenters(input.culturalMarkdown, input.collectedAt);
    allCulturalCenters = parsed.records;
    summaries.push(parsed.summary);
    receivedLines += parsed.receivedLines;
    rejectedRecordLines += parsed.rejectedRecordLines;
    statuses.push(statusForSummary(FED_FILES.cultural.providerId, FED_FILES.cultural.providerName, parsed.summary.source_url, input.collectedAt, parsed.records.length));
  } else if (input.culturalMarkdown !== undefined) {
    receivedFiles++;
    rejectedFiles++;
  }

  const intelligenceEntities = allIntelligenceEntities.slice(0, maxEntities);
  const culturalCenters = allCulturalCenters.slice(0, maxCenters);
  return {
    intelligenceEntities,
    culturalCenters,
    summaries,
    statuses,
    counts: {
      receivedFiles,
      acceptedFiles,
      rejectedFiles,
      receivedLines,
      acceptedIntelligenceEntities: allIntelligenceEntities.length,
      acceptedCulturalCenters: allCulturalCenters.length,
      rejectedRecordLines,
      returnedIntelligenceEntities: intelligenceEntities.length,
      returnedCulturalCenters: culturalCenters.length,
      returnedSummaries: summaries.length,
    },
  };
}

export function fedBlobUrl(path: string): string {
  return `${FED_REPO}/blob/master/${encodeURIComponent(path)}`;
}

export function fedRawUrl(path: string): string {
  return `${FED_RAW_BASE}/${encodeURIComponent(path)}`;
}

export function parseSpyVsSpy(markdown: string, collectedAt: string): ParsedFedFile<FedIntelligenceEntity> {
  const sourceFile = FED_FILES.spy.path;
  const sourceUrl = fedBlobUrl(sourceFile);
  const rawUrl = fedRawUrl(sourceFile);
  const lines = markdown.split(/\r?\n/);
  const records: FedIntelligenceEntity[] = [];
  const countries = new Set<string>();
  const sections = new Set<string>();
  let currentH2: string | null = null;
  let currentH3: string | null = null;
  let startedRecords = false;
  let pending: PendingEntity | null = null;
  let rejectedRecordLines = 0;

  const flush = () => {
    if (!pending) return;
    const recordId = stableId('fed-intel', [pending.sourceFile, pending.lineNumber, pending.name, pending.country, pending.category]);
    records.push({
      id: recordId,
      name: pending.name,
      alternate_name: pending.alternateName,
      country: pending.country,
      topic: pending.topic,
      category: pending.category,
      website: pending.website,
      description: pending.description.slice(0, 12),
      source_file: pending.sourceFile,
      source_url: pending.sourceUrl,
      raw_url: pending.rawUrl,
      line_number: pending.lineNumber,
      evidence_kind: 'reference',
      integrity: buildMetadata({
        recordId,
        upstreamId: `${pending.sourceFile}:${pending.lineNumber}`,
        source: sourceIdentity(FED_FILES.spy.providerId, FED_FILES.spy.providerName, pending.sourceUrl),
        itemUrl: pending.website ?? pending.sourceUrl,
        originalPublisher: 'Ringmast4r/FED',
        evidenceKind: 'reference',
        verification: 'unassessed',
        methodology: 'Parsed explicit top-level Markdown bullet records from FED spy-vs-spy.md. Missing websites remain null; prose and table-of-contents bullets are omitted.',
        timing: { collectedAt },
        evidenceReferences: [
          { label: 'FED SPY vs SPY source file', url: pending.sourceUrl },
          { label: 'FED repository', url: FED_REPO },
        ],
      }),
    });
    pending = null;
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trimEnd();
    const h2 = heading(line, 2);
    if (h2) {
      flush();
      currentH2 = h2;
      currentH3 = null;
      if (h2 === 'Afghanistan') startedRecords = true;
      if (startedRecords && !isSpecialTopic(h2)) countries.add(h2);
      continue;
    }
    const h3 = heading(line, 3);
    if (h3) {
      flush();
      currentH3 = h3;
      if (startedRecords) sections.add(h3);
      continue;
    }
    if (!startedRecords || !currentH2) continue;

    const bullet = parseBoldBullet(line);
    if (bullet) {
      flush();
      const topic = currentH2;
      const country = isSpecialTopic(currentH2) ? specialTopicCountry(currentH3) : currentH2;
      const category = currentH3 ?? currentH2;
      const tailDescription = cleanTailDescription(bullet.tail);
      pending = {
        name: bullet.name,
        alternateName: bullet.alternateName,
        country,
        topic,
        category,
        website: safeUrlFromText(bullet.tail),
        description: tailDescription ? [tailDescription] : [],
        sourceFile,
        sourceUrl,
        rawUrl,
        lineNumber: index + 1,
      };
      continue;
    }

    const detail = parseIndentedDetail(line);
    if (detail && pending) {
      const url = safeUrl(detail);
      if (url && !pending.website) pending.website = url;
      if (!url || detail !== url) pending.description.push(clampText(detail, 220));
    } else if (/^- /.test(line)) {
      rejectedRecordLines++;
    }
  }
  flush();

  return {
    records,
    summary: buildSummary({
      database: 'spy_vs_spy',
      title: 'SPY vs SPY - Global Intelligence Agencies',
      sourceFile,
      sourceUrl,
      rawUrl,
      recordCount: records.length,
      countryCount: countries.size,
      sectionCount: sections.size,
      metadata: parseBadgeMetadata(markdown),
    }),
    receivedLines: lines.length,
    rejectedRecordLines,
  };
}

export function parseCulturalCenters(markdown: string, collectedAt: string): ParsedFedFile<FedCulturalCenter> {
  const sourceFile = FED_FILES.cultural.path;
  const sourceUrl = fedBlobUrl(sourceFile);
  const rawUrl = fedRawUrl(sourceFile);
  const lines = markdown.split(/\r?\n/);
  const records: FedCulturalCenter[] = [];
  const countries = new Set<string>();
  const sections = new Set<string>();
  let currentCountry: string | null = null;
  let currentSection: string | null = null;
  let currentLocationContext: string | null = null;
  let startedRecords = false;
  let pending: PendingCenter | null = null;
  let rejectedRecordLines = 0;

  const flush = () => {
    if (!pending) return;
    const recordId = stableId('fed-cultural', [pending.sourceFile, pending.lineNumber, pending.name, pending.country, pending.category, pending.locationContext]);
    records.push({
      id: recordId,
      name: pending.name,
      country: pending.country,
      location_context: pending.locationContext,
      network: pending.network,
      category: pending.category,
      website: pending.website,
      description: pending.description.slice(0, 12),
      source_file: pending.sourceFile,
      source_url: pending.sourceUrl,
      raw_url: pending.rawUrl,
      line_number: pending.lineNumber,
      evidence_kind: 'reference',
      integrity: buildMetadata({
        recordId,
        upstreamId: `${pending.sourceFile}:${pending.lineNumber}`,
        source: sourceIdentity(FED_FILES.cultural.providerId, FED_FILES.cultural.providerName, pending.sourceUrl),
        itemUrl: pending.website ?? pending.sourceUrl,
        originalPublisher: 'Ringmast4r/FED',
        evidenceKind: 'reference',
        verification: 'unassessed',
        methodology: 'Parsed explicit Markdown bullet records from FED cultural-centers.md after country sections begin. Missing websites remain null; narrative bullets outside center/location sections are omitted.',
        timing: { collectedAt },
        evidenceReferences: [
          { label: 'FED cultural centers source file', url: pending.sourceUrl },
          { label: 'FED repository', url: FED_REPO },
        ],
      }),
    });
    pending = null;
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trimEnd();
    const h2 = heading(line, 2);
    if (h2) {
      flush();
      currentCountry = INTRO_HEADINGS.has(normalizeHeadingKey(h2)) ? null : h2;
      currentSection = null;
      currentLocationContext = null;
      if (h2 === 'Afghanistan') startedRecords = true;
      if (startedRecords && currentCountry) countries.add(currentCountry);
      continue;
    }
    const h3 = heading(line, 3) ?? heading(line, 4);
    if (h3) {
      flush();
      currentSection = h3;
      currentLocationContext = locationHeading(h3) ?? currentLocationContext;
      if (startedRecords) sections.add(h3);
      continue;
    }
    if (!startedRecords || !currentCountry) continue;

    const standalone = parseStandaloneBold(line);
    if (standalone) {
      flush();
      currentSection = standalone;
      currentLocationContext = locationHeading(standalone);
      sections.add(standalone);
      continue;
    }

    const bullet = parseBoldBullet(line);
    if (bullet && shouldParseCulturalBoldBullet(currentSection)) {
      flush();
      const tailDescription = cleanTailDescription(bullet.tail);
      pending = {
        name: bullet.name,
        country: currentCountry,
        locationContext: locationHeading(bullet.tail) ?? currentLocationContext,
        network: inferNetwork(bullet.name),
        category: currentSection ?? 'Cultural centers',
        website: safeUrlFromText(bullet.tail),
        description: tailDescription ? [tailDescription] : [],
        sourceFile,
        sourceUrl,
        rawUrl,
        lineNumber: index + 1,
      };
      continue;
    }

    const plainBullet = parsePlainBullet(line);
    if (plainBullet && shouldParsePlainCulturalBullet(currentSection, currentLocationContext)) {
      flush();
      pending = {
        name: plainBullet,
        country: currentCountry,
        locationContext: currentLocationContext,
        network: inferNetwork(plainBullet),
        category: currentSection ?? 'Cultural centers',
        website: safeUrlFromText(plainBullet),
        description: [],
        sourceFile,
        sourceUrl,
        rawUrl,
        lineNumber: index + 1,
      };
      continue;
    }

    const detail = parseIndentedDetail(line);
    if (detail && pending) {
      const url = safeUrl(detail);
      if (url && !pending.website) pending.website = url;
      if (!url || detail !== url) pending.description.push(clampText(detail, 220));
    } else if (/^- /.test(line)) {
      rejectedRecordLines++;
    }
  }
  flush();

  return {
    records,
    summary: buildSummary({
      database: 'cultural_centers',
      title: 'Culture as Cover - Global Cultural Centers',
      sourceFile,
      sourceUrl,
      rawUrl,
      recordCount: records.length,
      countryCount: countries.size,
      sectionCount: sections.size,
      metadata: parseBadgeMetadata(markdown),
    }),
    receivedLines: lines.length,
    rejectedRecordLines,
  };
}

function parseReadmeSummary(markdown: string): FedSummary {
  const metadata = parseBadgeMetadata(markdown);
  return buildSummary({
    database: 'readme',
    title: 'FED - Global Intelligence Rolodex',
    sourceFile: FED_FILES.readme.path,
    sourceUrl: fedBlobUrl(FED_FILES.readme.path),
    rawUrl: fedRawUrl(FED_FILES.readme.path),
    recordCount: 0,
    countryCount: numberFromMetadata(metadata.countries),
    sectionCount: 2,
    metadata,
  });
}

function buildSummary(args: {
  database: FedSummary['database'];
  title: string;
  sourceFile: string;
  sourceUrl: string;
  rawUrl: string;
  recordCount: number;
  countryCount: number;
  sectionCount: number;
  metadata: Record<string, string>;
}): FedSummary {
  return {
    id: stableId('fed-summary', [args.database, args.sourceFile]),
    database: args.database,
    title: args.title,
    source_file: args.sourceFile,
    source_url: args.sourceUrl,
    raw_url: args.rawUrl,
    record_count: args.recordCount,
    country_count: args.countryCount,
    section_count: args.sectionCount,
    metadata: args.metadata,
    evidence_kind: 'reference',
  };
}

function statusForSummary(providerId: string, providerName: string, sourceUrl: string, collectedAt: string, acceptedRecords: number): SourceCollectionStatus {
  return collectionStatus({
    source: sourceIdentity(providerId, providerName, sourceUrl),
    availability: acceptedRecords > 0 || providerId === FED_FILES.readme.providerId ? 'ok' : 'error',
    dataState: acceptedRecords > 0 || providerId === FED_FILES.readme.providerId ? 'present' : 'unavailable',
    freshness: acceptedRecords > 0 || providerId === FED_FILES.readme.providerId ? 'fresh' : 'unknown',
    lastAttemptAt: collectedAt,
    lastSuccessfulFetchAt: acceptedRecords > 0 || providerId === FED_FILES.readme.providerId ? collectedAt : null,
    acceptedRecords,
    errorCode: acceptedRecords > 0 || providerId === FED_FILES.readme.providerId ? null : 'FED_PARSE_EMPTY',
    message: acceptedRecords > 0 || providerId === FED_FILES.readme.providerId ? null : 'FED Markdown source was fetched but no usable records were parsed.',
  });
}

function parseBadgeMetadata(markdown: string): Record<string, string> {
  const metadata: Record<string, string> = {};
  const badgePattern = /badge\/([^-\]\n]+)-([^?\]\n]+)\?/g;
  let match: RegExpExecArray | null;
  while ((match = badgePattern.exec(markdown))) {
    const key = decodeURIComponent(match[1]).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const value = decodeURIComponent(match[2]).replace(/--/g, '-');
    if (key && value && key.length < 40 && value.length < 80) metadata[key] = value;
  }
  return metadata;
}

function parseBoldBullet(line: string): { name: string; alternateName: string | null; tail: string } | null {
  const match = line.match(/^- \*\*([^*]+)\*\*(.*)$/);
  if (!match) return null;
  const name = clampText(match[1], 120);
  if (!name) return null;
  const tail = match[2].trim();
  const alternate = tail.match(/^\(([^)]+)\)/);
  return {
    name,
    alternateName: alternate ? clampText(alternate[1], 160) : null,
    tail,
  };
}

function parsePlainBullet(line: string): string | null {
  const match = line.match(/^- (.+)$/);
  if (!match) return null;
  const value = clampText(match[1], 180);
  if (!value || /^\*\*/.test(value) || /^https?:\/\//i.test(value)) return null;
  return value;
}

function parseIndentedDetail(line: string): string | null {
  const match = line.match(/^\s{2,}- (.+)$/);
  if (!match) return null;
  return clampText(match[1], 240);
}

function parseStandaloneBold(line: string): string | null {
  const match = line.match(/^\*\*([^*]+)\*\*$/);
  if (!match) return null;
  const value = clampText(match[1].replace(/:$/, ''), 140);
  if (!value || /^https?:\/\//i.test(value)) return null;
  return value;
}

function heading(line: string, level: 2 | 3 | 4): string | null {
  const prefix = '#'.repeat(level);
  const match = line.match(new RegExp(`^${prefix}\\s+(.+)$`));
  if (!match) return null;
  return stripMarkdown(match[1]);
}

function stripMarkdown(value: string): string {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/[`*_#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanTailDescription(tail: string): string | null {
  const cleaned = stripMarkdown(tail)
    .replace(/^\([^)]+\)\s*/, '')
    .replace(/^[-:]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || /^https?:\/\//i.test(cleaned)) return null;
  return clampText(cleaned, 220);
}

function safeUrlFromText(value: string): string | null {
  const match = value.match(/\bhttps?:\/\/[^\s<>)\]"'`]+/i);
  if (!match) return null;
  return safeUrl(match[0].replace(/[),.;\]]+$/g, ''));
}

function normalizeHeadingKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function isSpecialTopic(value: string): boolean {
  return SPECIAL_TOPIC_PATTERNS.some((pattern) => pattern.test(value));
}

function specialTopicCountry(value: string | null): string | null {
  if (!value) return null;
  if (/^(historical|core|additional|nine eyes|five eyes|locations)$/i.test(value)) return null;
  return value;
}

function locationHeading(value: string): string | null {
  const cleaned = stripMarkdown(value).replace(/:$/, '');
  if (/\blocations?\b/i.test(cleaned)) return cleaned;
  const match = cleaned.match(/^(.+?)\s+\(\d+\+?\s+locations?.*\)$/i);
  return match ? clampText(match[1], 120) : null;
}

function shouldParseCulturalBoldBullet(section: string | null): boolean {
  if (!section) return true;
  if (/intelligence operations|coordination|historical context|intelligence-culture nexus/i.test(section)) return false;
  return true;
}

function shouldParsePlainCulturalBullet(section: string | null, locationContext: string | null): boolean {
  if (!section) return false;
  if (/intelligence operations|coordination|historical context|intelligence-culture nexus|focus|geographic/i.test(section)) return false;
  return Boolean(locationContext) || /\blocations?\b/i.test(section);
}

function inferNetwork(name: string): string | null {
  const patterns: Array<[string, RegExp]> = [
    ['Confucius Institute', /\bconfucius\b/i],
    ['Goethe-Institut', /\bgoethe\b/i],
    ['British Council', /\bbritish council\b/i],
    ['Alliance Francaise', /\balliance fran[cç]aise\b/i],
    ['Institut Francais', /\binstitut fran[cç]ais\b/i],
    ['Instituto Cervantes', /\bcervantes\b/i],
    ['Yunus Emre Institute', /\byunus emre\b/i],
    ['Russian Cultural Center', /\brussian cultural\b|\brossotrudnichestvo\b/i],
    ['American Spaces', /\bamerican (space|center|centre|embassy|consulate)\b/i],
  ];
  return patterns.find(([, pattern]) => pattern.test(name))?.[0] ?? null;
}

function numberFromMetadata(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number(value.replace(/[^0-9]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function positiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}
