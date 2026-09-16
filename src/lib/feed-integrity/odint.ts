import {
  buildMetadata,
  clampText,
  collectionStatus,
  safeUrl,
  sourceIdentity,
  stableId,
} from './helpers';
import type { IntegrityMetadata, SourceCollectionStatus } from './types';

export const ODINT_REPO = 'https://github.com/Ringmast4r/ODINT';
export const ODINT_RAW_BASE = 'https://raw.githubusercontent.com/Ringmast4r/ODINT/main';
export const ODINT_TREE_API = 'https://api.github.com/repos/Ringmast4r/ODINT/git/trees/main?recursive=1';
export const ODINT_ROOT_PATH = 'CYBER RECON TOUR';

export type OdintTargetKind = 'domain' | 'url' | 'api_endpoint';
export type OdintFileKind = 'country_websites' | 'api_inventory' | 'country_index' | 'reference_list';

export interface OdintSourceTextFile {
  path: string;
  text: string | null | undefined;
}

export interface OdintTargetRecord {
  id: string;
  domain: string;
  url: string | null;
  path: string | null;
  target_kind: OdintTargetKind;
  region: string | null;
  country: string | null;
  category: string;
  section: string | null;
  source_file: string;
  source_url: string;
  raw_url: string;
  line_number: number;
  evidence_kind: 'reference';
  integrity: IntegrityMetadata;
}

export interface OdintInventorySummary {
  id: string;
  file_path: string;
  title: string;
  file_kind: OdintFileKind;
  region: string | null;
  country: string | null;
  category: string;
  target_count: number;
  section_count: number;
  metadata: Record<string, string>;
  source_url: string;
  raw_url: string;
  evidence_kind: 'reference';
}

export interface OdintNormalizeInput {
  files: OdintSourceTextFile[];
  collectedAt: string;
  maxTargets?: number;
  maxSummaries?: number;
}

export interface OdintNormalizeResult {
  targets: OdintTargetRecord[];
  summaries: OdintInventorySummary[];
  statuses: SourceCollectionStatus[];
  counts: {
    receivedFiles: number;
    acceptedFiles: number;
    rejectedFiles: number;
    receivedLines: number;
    acceptedTargets: number;
    rejectedTargetLines: number;
    returnedTargets: number;
    returnedSummaries: number;
  };
}

interface OdintFileContext {
  path: string;
  sourceUrl: string;
  rawUrl: string;
  fileKind: OdintFileKind;
  region: string | null;
  country: string | null;
  category: string;
  title: string;
}

interface ParsedOdintFile {
  targets: OdintTargetRecord[];
  summary: OdintInventorySummary;
  receivedLines: number;
  rejectedTargetLines: number;
}

interface TargetCandidate {
  domain: string;
  url: string | null;
  path: string | null;
  targetKind: OdintTargetKind;
}

const COUNTRY_OVERRIDES: Record<string, string> = {
  american: 'United States',
  us: 'United States',
  usa: 'United States',
  uk: 'United Kingdom',
  british: 'United Kingdom',
  uae: 'United Arab Emirates',
  saudi: 'Saudi Arabia',
  'saudi-arabian': 'Saudi Arabia',
  qatari: 'Qatar',
  kuwaiti: 'Kuwait',
  iraqi: 'Iraq',
  iranian: 'Iran',
  israeli: 'Israel',
  turkish: 'Turkey',
  canadian: 'Canada',
  mexican: 'Mexico',
  bermudian: 'Bermuda',
  panamanian: 'Panama',
  honduran: 'Honduras',
  nicaraguan: 'Nicaragua',
  guatemalan: 'Guatemala',
  salvadoran: 'El Salvador',
  'costa-rican': 'Costa Rica',
  belizean: 'Belize',
  cuban: 'Cuba',
  haitian: 'Haiti',
  jamaican: 'Jamaica',
  barbadian: 'Barbados',
  trinidadian: 'Trinidad and Tobago',
  australian: 'Australia',
  chinese: 'China',
  japanese: 'Japan',
  'south-korean': 'South Korea',
  'north-korean': 'North Korea',
  indian: 'India',
  russian: 'Russia',
  german: 'Germany',
  french: 'France',
  brazilian: 'Brazil',
  argentine: 'Argentina',
  chilean: 'Chile',
  colombian: 'Colombia',
  ecuadorian: 'Ecuador',
  peruvian: 'Peru',
  venezuelan: 'Venezuela',
  bolivian: 'Bolivia',
  uruguayan: 'Uruguay',
  paraguayan: 'Paraguay',
  guyanese: 'Guyana',
  surinamese: 'Suriname',
};

export function normalizeOdintCyberRecon(input: OdintNormalizeInput): OdintNormalizeResult {
  const maxTargets = positiveInt(input.maxTargets, 5000);
  const maxSummaries = positiveInt(input.maxSummaries, 1000);
  const targets: OdintTargetRecord[] = [];
  const summaries: OdintInventorySummary[] = [];
  let acceptedTargets = 0;
  let acceptedFiles = 0;
  let rejectedFiles = 0;
  let receivedLines = 0;
  let rejectedTargetLines = 0;

  for (const sourceFile of input.files) {
    const text = sourceFile.text;
    if (!text || !text.trim()) {
      rejectedFiles++;
      continue;
    }

    const context = describeOdintPath(sourceFile.path);
    const parsed = parseOdintFile(context, text, input.collectedAt);
    acceptedFiles++;
    receivedLines += parsed.receivedLines;
    rejectedTargetLines += parsed.rejectedTargetLines;
    acceptedTargets += parsed.targets.length;

    if (summaries.length < maxSummaries) summaries.push(parsed.summary);
    for (const target of parsed.targets) {
      if (targets.length >= maxTargets) break;
      targets.push(target);
    }
  }

  const present = acceptedFiles > 0 && (acceptedTargets > 0 || summaries.length > 0);
  const cappedTargets = acceptedTargets > targets.length;
  const cappedSummaries = acceptedFiles > summaries.length;
  const messages = [
    cappedTargets ? `Returned ${targets.length} of ${acceptedTargets} parsed ODINT targets due to the maxTargets cap.` : null,
    cappedSummaries ? `Returned ${summaries.length} of ${acceptedFiles} parsed ODINT file summaries due to the maxSummaries cap.` : null,
    present ? null : 'No usable ODINT CYBER RECON TOUR files were available to normalize.',
  ].filter(Boolean) as string[];

  const statuses = [collectionStatus({
    source: sourceIdentity('odint:cyber-recon-tour', 'ODINT CYBER RECON TOUR public reference files', ODINT_REPO),
    availability: present ? 'ok' : 'error',
    dataState: present ? 'present' : 'unavailable',
    freshness: present ? 'fresh' : 'unknown',
    lastAttemptAt: input.collectedAt,
    lastSuccessfulFetchAt: present ? input.collectedAt : null,
    receivedRecords: receivedLines,
    acceptedRecords: acceptedTargets + summaries.length,
    rejectedRecords: rejectedFiles + rejectedTargetLines,
    errorCode: present ? null : 'ODINT_PARSE_EMPTY',
    message: messages.length > 0 ? messages.join(' ') : null,
  })];

  return {
    targets,
    summaries,
    statuses,
    counts: {
      receivedFiles: input.files.length,
      acceptedFiles,
      rejectedFiles,
      receivedLines,
      acceptedTargets,
      rejectedTargetLines,
      returnedTargets: targets.length,
      returnedSummaries: summaries.length,
    },
  };
}

export function describeOdintPath(path: string): OdintFileContext {
  const normalizedPath = cleanPath(path);
  const parts = normalizedPath.split('/').filter(Boolean);
  const rootIndex = parts.findIndex((part) => part === ODINT_ROOT_PATH);
  const afterRoot = rootIndex >= 0 ? parts.slice(rootIndex + 1) : parts;
  const region = afterRoot.length > 1 ? afterRoot[0] : null;
  const basename = afterRoot[afterRoot.length - 1] ?? normalizedPath;
  const stem = basename.replace(/\.txt$/i, '');
  const loweredPath = normalizedPath.toLowerCase();
  const sourceUrl = odintBlobUrl(normalizedPath);
  const rawUrl = odintRawUrl(normalizedPath);
  const fileKind: OdintFileKind = loweredPath.includes('/mexico/api/')
    ? 'api_inventory'
    : basename.toLowerCase() === 'countries list.txt'
      ? 'country_index'
      : /-websites\.txt$/i.test(basename)
        ? 'country_websites'
        : 'reference_list';
  const country = inferCountry(afterRoot, basename, fileKind);
  return {
    path: normalizedPath,
    sourceUrl,
    rawUrl,
    fileKind,
    region,
    country,
    category: categoryForKind(fileKind),
    title: titleFromStem(stem),
  };
}

export function odintBlobUrl(path: string): string {
  return `${ODINT_REPO}/blob/main/${encodeGitHubPath(cleanPath(path))}`;
}

export function odintRawUrl(path: string): string {
  return `${ODINT_RAW_BASE}/${encodeGitHubPath(cleanPath(path))}`;
}

function parseOdintFile(context: OdintFileContext, text: string, collectedAt: string): ParsedOdintFile {
  const metadata: Record<string, string> = {};
  const sections = new Set<string>();
  const targets: OdintTargetRecord[] = [];
  const seenTargets = new Set<string>();
  const lines = text.split(/\r?\n/);
  let currentSection: string | null = null;
  let title = context.title;
  let rejectedTargetLines = 0;

  for (let index = 0; index < lines.length; index++) {
    const rawLine = lines[index];
    const line = rawLine.trim();
    if (!line || isSeparator(line)) continue;

    if (line.startsWith('#')) {
      const comment = cleanComment(line);
      if (!comment || isSeparator(comment)) continue;
      const metadataEntry = parseMetadataLine(comment);
      if (metadataEntry) {
        metadata[metadataEntry.key] = metadataEntry.value;
      } else {
        currentSection = comment;
        sections.add(comment);
        if (title === context.title && /websites/i.test(comment)) title = comment.replace(/\s+-\s+.*$/, '');
      }
      continue;
    }

    const metadataEntry = parseMetadataLine(line);
    if (metadataEntry) metadata[metadataEntry.key] = metadataEntry.value;

    const candidate = extractTargetCandidate(line, context);
    if (!candidate) {
      if (looksLikeFailedTargetCandidate(line)) rejectedTargetLines++;
      continue;
    }

    const targetKey = `${candidate.url ?? candidate.domain}|${currentSection ?? ''}`;
    if (seenTargets.has(targetKey)) continue;
    seenTargets.add(targetKey);
    targets.push(buildTargetRecord({
      context,
      target: candidate,
      lineNumber: index + 1,
      section: currentSection,
      collectedAt,
    }));
  }

  return {
    targets,
    summary: {
      id: stableId('odint-summary', [context.path]),
      file_path: context.path,
      title: clampText(title, 120) || context.title,
      file_kind: context.fileKind,
      region: context.region,
      country: context.country,
      category: context.category,
      target_count: targets.length,
      section_count: sections.size,
      metadata,
      source_url: context.sourceUrl,
      raw_url: context.rawUrl,
      evidence_kind: 'reference',
    },
    receivedLines: lines.length,
    rejectedTargetLines,
  };
}

function buildTargetRecord(args: {
  context: OdintFileContext;
  target: TargetCandidate;
  lineNumber: number;
  section: string | null;
  collectedAt: string;
}): OdintTargetRecord {
  const { context, target, lineNumber, section, collectedAt } = args;
  const recordId = stableId('odint-target', [context.path, lineNumber, target.url ?? target.domain, section]);
  const itemUrl = target.url ?? context.sourceUrl;
  return {
    id: recordId,
    domain: target.domain,
    url: target.url,
    path: target.path,
    target_kind: target.targetKind,
    region: context.region,
    country: context.country,
    category: context.category,
    section: section ? clampText(section, 100) : null,
    source_file: context.path,
    source_url: context.sourceUrl,
    raw_url: context.rawUrl,
    line_number: lineNumber,
    evidence_kind: 'reference',
    integrity: buildMetadata({
      recordId,
      upstreamId: `${context.path}:${lineNumber}`,
      source: sourceIdentity('odint:cyber-recon-tour', 'ODINT CYBER RECON TOUR public reference files', context.sourceUrl),
      itemUrl,
      originalPublisher: 'Ringmast4r/ODINT',
      evidenceKind: 'reference',
      verification: 'unassessed',
      methodology: 'Parsed public ODINT CYBER RECON TOUR text files and emitted only explicit domains or URLs. Comments, prose, relative paths, and unavailable files are omitted rather than filled with synthetic targets.',
      timing: { collectedAt },
      evidenceReferences: [
        { label: 'ODINT source file', url: context.sourceUrl },
        { label: 'ODINT repository', url: ODINT_REPO },
      ],
    }),
  };
}

function extractTargetCandidate(line: string, context: OdintFileContext): TargetCandidate | null {
  const urlMatch = line.match(/\bhttps?:\/\/[^\s<>)\]"'`]+/i);
  if (urlMatch) {
    const url = cleanUrlCandidate(urlMatch[0]);
    const safe = safeUrl(url);
    if (!safe) return null;
    const parsed = new URL(safe);
    const domain = normalizeHostname(parsed.hostname);
    if (!domain) return null;
    return {
      domain,
      url: safe,
      path: parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : null,
      targetKind: context.fileKind === 'api_inventory' || /\/api[_/-]/i.test(parsed.pathname) ? 'api_endpoint' : 'url',
    };
  }

  const candidate = firstToken(line);
  if (!candidate) return null;
  const domain = normalizeHostname(candidate.replace(/^www\./i, 'www.'));
  if (!domain) return null;
  return {
    domain,
    url: null,
    path: null,
    targetKind: 'domain',
  };
}

function firstToken(line: string): string | null {
  const token = line
    .replace(/^[*\-\u2022>\s]+/, '')
    .split(/[\s,;|]+/)[0]
    ?.replace(/^[`"'(<[]+|[`"')>\].:]+$/g, '')
    .trim();
  if (!token || token.includes('@') || token.includes('/') || /\.txt$/i.test(token)) return null;
  return token;
}

function normalizeHostname(value: string): string | null {
  const hostname = value.trim().toLowerCase().replace(/\.$/, '');
  if (hostname.length > 253) return null;
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname)) return null;
  return hostname;
}

function parseMetadataLine(line: string): { key: string; value: string } | null {
  const match = line.match(/^([A-Za-z][A-Za-z0-9 /_-]{1,48}):\s*(.+)$/);
  if (!match) return null;
  const key = match[1].toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const value = clampText(match[2], 240);
  if (!key || !value) return null;
  return { key, value };
}

function cleanComment(line: string): string {
  return line
    .replace(/^#+\s*/, '')
    .replace(/={3,}/g, '')
    .replace(/-{3,}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanUrlCandidate(value: string): string {
  return value.replace(/[),.;\]]+$/g, '');
}

function looksLikeFailedTargetCandidate(line: string): boolean {
  if (/\.txt\b/i.test(line)) return false;
  return /\bhttps?:\/\/|\bwww\.|[a-z0-9-]+\.[a-z]{2,}/i.test(line);
}

function isSeparator(line: string): boolean {
  return /^[=\-_* ]{3,}$/.test(line);
}

function inferCountry(afterRoot: string[], basename: string, fileKind: OdintFileKind): string | null {
  if (fileKind === 'country_index') return null;
  const mexicoIndex = afterRoot.findIndex((part) => part.toLowerCase() === 'mexico');
  if (mexicoIndex >= 0) return 'Mexico';
  if ((afterRoot[0] ?? '').toLowerCase() === 'misc') return null;
  const rawStem = basename.replace(/\.txt$/i, '').replace(/-websites$/i, '');
  const normalized = rawStem.toLowerCase();
  return COUNTRY_OVERRIDES[normalized] ?? titleFromStem(rawStem);
}

function categoryForKind(kind: OdintFileKind): string {
  if (kind === 'api_inventory') return 'api_inventory';
  if (kind === 'country_index') return 'country_index';
  if (kind === 'country_websites') return 'country_websites';
  return 'reference_list';
}

function titleFromStem(stem: string): string {
  return stem
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

function cleanPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

function encodeGitHubPath(path: string): string {
  return path.split('/').map((part) => encodeURIComponent(part)).join('/');
}

function positiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}
