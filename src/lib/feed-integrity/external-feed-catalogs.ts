import {
  buildMetadata,
  clampText,
  collectionStatus,
  safeUrl,
  sourceIdentity,
  stableId,
} from './helpers';
import type { IntegrityMetadata, SourceCollectionStatus } from './types';

export type ExternalFeedCatalog = 'crucix' | 'worldmonitor';
export type ExternalFeedKind =
  | 'api'
  | 'rss'
  | 'telegram'
  | 'x_account'
  | 'provider_host'
  | 'catalog_endpoint'
  | 'documentation'
  | 'structured'
  | 'feed';

export interface ExternalCatalogFile {
  path: string;
  text: string | null;
}

export interface ExternalFeedRecord {
  id: string;
  catalog: ExternalFeedCatalog;
  name: string;
  feed_kind: ExternalFeedKind;
  category: string | null;
  url: string;
  host: string;
  credential_env: string[];
  source_file: string;
  source_url: string;
  raw_url: string;
  description: string | null;
  publisher: string | null;
  upstream_status: string | null;
  evidence_kind: 'reference';
  integrity: IntegrityMetadata;
}

export interface ExternalFeedSummary {
  id: string;
  catalog: ExternalFeedCatalog;
  source_file: string;
  source_url: string;
  raw_url: string;
  total_feeds: number;
  feed_kinds: Record<string, number>;
  credential_env: string[];
  evidence_kind: 'reference';
  integrity: IntegrityMetadata;
}

export interface ExternalFeedNormalizeResult {
  feeds: ExternalFeedRecord[];
  summaries: ExternalFeedSummary[];
  statuses: SourceCollectionStatus[];
  counts: {
    receivedFiles: number;
    acceptedFiles: number;
    rejectedFiles: number;
    receivedFeedCandidates: number;
    acceptedFeeds: number;
    rejectedFeedCandidates: number;
  };
}

export const CRUCIX_REPO = 'https://github.com/calesthio/Crucix';
export const CRUCIX_RAW_BASE = 'https://raw.githubusercontent.com/calesthio/Crucix/master';

export const CRUCIX_SOURCE_FILES = {
  briefing: { path: 'apis/briefing.mjs', providerName: 'Crucix source orchestrator' },
  acled: { path: 'apis/sources/acled.mjs', providerName: 'Crucix ACLED source module' },
  adsb: { path: 'apis/sources/adsb.mjs', providerName: 'Crucix ADS-B source module' },
  bls: { path: 'apis/sources/bls.mjs', providerName: 'Crucix BLS source module' },
  bluesky: { path: 'apis/sources/bluesky.mjs', providerName: 'Crucix Bluesky source module' },
  cisaKev: { path: 'apis/sources/cisa-kev.mjs', providerName: 'Crucix CISA KEV source module' },
  cloudflareRadar: { path: 'apis/sources/cloudflare-radar.mjs', providerName: 'Crucix Cloudflare Radar source module' },
  comtrade: { path: 'apis/sources/comtrade.mjs', providerName: 'Crucix Comtrade source module' },
  eia: { path: 'apis/sources/eia.mjs', providerName: 'Crucix EIA source module' },
  epa: { path: 'apis/sources/epa.mjs', providerName: 'Crucix EPA RadNet source module' },
  firms: { path: 'apis/sources/firms.mjs', providerName: 'Crucix NASA FIRMS source module' },
  fred: { path: 'apis/sources/fred.mjs', providerName: 'Crucix FRED source module' },
  gdelt: { path: 'apis/sources/gdelt.mjs', providerName: 'Crucix GDELT source module' },
  gscpi: { path: 'apis/sources/gscpi.mjs', providerName: 'Crucix GSCPI source module' },
  kiwisdr: { path: 'apis/sources/kiwisdr.mjs', providerName: 'Crucix KiwiSDR source module' },
  noaa: { path: 'apis/sources/noaa.mjs', providerName: 'Crucix NOAA source module' },
  ofac: { path: 'apis/sources/ofac.mjs', providerName: 'Crucix OFAC source module' },
  opensanctions: { path: 'apis/sources/opensanctions.mjs', providerName: 'Crucix OpenSanctions source module' },
  opensky: { path: 'apis/sources/opensky.mjs', providerName: 'Crucix OpenSky source module' },
  patents: { path: 'apis/sources/patents.mjs', providerName: 'Crucix PatentsView source module' },
  reddit: { path: 'apis/sources/reddit.mjs', providerName: 'Crucix Reddit source module' },
  reliefweb: { path: 'apis/sources/reliefweb.mjs', providerName: 'Crucix ReliefWeb source module' },
  safecast: { path: 'apis/sources/safecast.mjs', providerName: 'Crucix Safecast source module' },
  ships: { path: 'apis/sources/ships.mjs', providerName: 'Crucix maritime source module' },
  space: { path: 'apis/sources/space.mjs', providerName: 'Crucix CelesTrak source module' },
  telegram: { path: 'apis/sources/telegram.mjs', providerName: 'Crucix Telegram source module' },
  treasury: { path: 'apis/sources/treasury.mjs', providerName: 'Crucix Treasury source module' },
  usaspending: { path: 'apis/sources/usaspending.mjs', providerName: 'Crucix USAspending source module' },
  who: { path: 'apis/sources/who.mjs', providerName: 'Crucix WHO source module' },
  yfinance: { path: 'apis/sources/yfinance.mjs', providerName: 'Crucix Yahoo Finance source module' },
} as const;

export const WORLD_MONITOR_REPO = 'https://github.com/koala73/worldmonitor';
export const WORLD_MONITOR_RAW_BASE = 'https://raw.githubusercontent.com/koala73/worldmonitor/main';

export const WORLD_MONITOR_SOURCE_FILES = {
  agentView: { path: 'public/agent-view.json', providerName: 'World Monitor agent-view catalog' },
  sourceAttribution: { path: 'shared/source-attribution-manifest.json', providerName: 'World Monitor source attribution manifest' },
  serverFeeds: { path: 'server/worldmonitor/news/v1/_feeds.ts', providerName: 'World Monitor server feed registry' },
  telegramChannels: { path: 'data/telegram-channels.json', providerName: 'World Monitor Telegram channel registry' },
  xAccounts: { path: 'data/x-accounts.json', providerName: 'World Monitor X account registry' },
} as const;

interface CandidateFeed {
  name: string;
  url: string;
  feedKind?: ExternalFeedKind;
  category?: string | null;
  credentialEnv?: string[];
  description?: string | null;
  publisher?: string | null;
  upstreamStatus?: string | null;
}

export function normalizeCrucixFeedCatalog(input: {
  files: ExternalCatalogFile[];
  collectedAt: string;
  maxFeeds?: number;
}): ExternalFeedNormalizeResult {
  return normalizeCatalogFiles({
    catalog: 'crucix',
    repo: CRUCIX_REPO,
    rawBase: CRUCIX_RAW_BASE,
    files: input.files,
    collectedAt: input.collectedAt,
    maxFeeds: input.maxFeeds,
    extractCandidates: (file) => extractCrucixCandidates(file.path, file.text ?? ''),
  });
}

export function normalizeWorldMonitorFeedCatalog(input: {
  files: ExternalCatalogFile[];
  collectedAt: string;
  maxFeeds?: number;
}): ExternalFeedNormalizeResult {
  return normalizeCatalogFiles({
    catalog: 'worldmonitor',
    repo: WORLD_MONITOR_REPO,
    rawBase: WORLD_MONITOR_RAW_BASE,
    files: input.files,
    collectedAt: input.collectedAt,
    maxFeeds: input.maxFeeds,
    extractCandidates: (file) => extractWorldMonitorCandidates(file.path, file.text ?? ''),
  });
}

export function crucixBlobUrl(path: string): string {
  return `${CRUCIX_REPO}/blob/master/${encodePath(path)}`;
}

export function crucixRawUrl(path: string): string {
  return `${CRUCIX_RAW_BASE}/${encodePath(path)}`;
}

export function worldMonitorBlobUrl(path: string): string {
  return `${WORLD_MONITOR_REPO}/blob/main/${encodePath(path)}`;
}

export function worldMonitorRawUrl(path: string): string {
  return `${WORLD_MONITOR_RAW_BASE}/${encodePath(path)}`;
}

function normalizeCatalogFiles(args: {
  catalog: ExternalFeedCatalog;
  repo: string;
  rawBase: string;
  files: ExternalCatalogFile[];
  collectedAt: string;
  maxFeeds?: number;
  extractCandidates: (file: ExternalCatalogFile) => CandidateFeed[];
}): ExternalFeedNormalizeResult {
  const maxFeeds = positiveInt(args.maxFeeds, 5000);
  const feeds: ExternalFeedRecord[] = [];
  const summaries: ExternalFeedSummary[] = [];
  const statuses: SourceCollectionStatus[] = [];
  let acceptedFiles = 0;
  let rejectedFiles = 0;
  let receivedFeedCandidates = 0;
  let rejectedFeedCandidates = 0;
  const seen = new Set<string>();

  for (const file of args.files) {
    const sourceUrl = blobUrlFor(args.catalog, file.path);
    const rawUrl = rawUrlFor(args.catalog, file.path);
    const providerId = `${args.catalog}:${slugify(file.path)}`;
    const providerName = `${catalogLabel(args.catalog)} ${file.path}`;

    if (!file.text?.trim()) {
      rejectedFiles++;
      statuses.push(collectionStatus({
        source: sourceIdentity(providerId, providerName, sourceUrl),
        availability: 'error',
        dataState: 'unavailable',
        freshness: 'unknown',
        lastAttemptAt: args.collectedAt,
        errorCode: 'SOURCE_FILE_UNAVAILABLE',
        message: `${file.path} was unavailable or empty; no feed records were inferred.`,
      }));
      continue;
    }

    acceptedFiles++;
    const candidates = args.extractCandidates(file);
    receivedFeedCandidates += candidates.length;
    const acceptedFromFile: ExternalFeedRecord[] = [];

    for (const candidate of candidates) {
      const url = safeUrl(candidate.url);
      if (!url) {
        rejectedFeedCandidates++;
        continue;
      }
      const dedupeKey = `${file.path}|${candidate.name}|${url}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const record = buildFeedRecord({
        catalog: args.catalog,
        candidate: { ...candidate, url },
        sourceFile: file.path,
        sourceUrl,
        rawUrl,
        collectedAt: args.collectedAt,
      });
      acceptedFromFile.push(record);
      if (feeds.length < maxFeeds) feeds.push(record);
    }

    summaries.push(buildSummary({
      catalog: args.catalog,
      sourceFile: file.path,
      sourceUrl,
      rawUrl,
      feeds: acceptedFromFile,
      collectedAt: args.collectedAt,
    }));
    statuses.push(collectionStatus({
      source: sourceIdentity(providerId, providerName, sourceUrl),
      availability: 'ok',
      dataState: acceptedFromFile.length > 0 ? 'present' : 'empty',
      freshness: 'fresh',
      lastAttemptAt: args.collectedAt,
      lastSuccessfulFetchAt: args.collectedAt,
      receivedRecords: candidates.length,
      acceptedRecords: acceptedFromFile.length,
      rejectedRecords: Math.max(0, candidates.length - acceptedFromFile.length),
      message: acceptedFromFile.length > 0
        ? `Parsed ${acceptedFromFile.length} explicit feed endpoint(s) from ${file.path}.`
        : `${file.path} was available but contained no explicit feed endpoint records.`,
    }));
  }

  return {
    feeds,
    summaries,
    statuses,
    counts: {
      receivedFiles: args.files.length,
      acceptedFiles,
      rejectedFiles,
      receivedFeedCandidates,
      acceptedFeeds: feeds.length,
      rejectedFeedCandidates,
    },
  };
}

function extractCrucixCandidates(path: string, text: string): CandidateFeed[] {
  const env = extractEnvVars(text);
  const sourceName = sourceNameFromCrucixModule(path, text);
  const category = crucixCategory(path, text);
  return extractUrls(text).map((url) => ({
    name: sourceName,
    url,
    feedKind: kindFromUrl(url),
    category,
    credentialEnv: env,
    description: firstCommentDescription(text),
    publisher: 'calesthio/Crucix',
  }));
}

function extractWorldMonitorCandidates(path: string, text: string): CandidateFeed[] {
  if (path.endsWith('source-attribution-manifest.json')) return extractWorldMonitorAttribution(text);
  if (path.endsWith('telegram-channels.json')) return extractWorldMonitorTelegram(text);
  if (path.endsWith('x-accounts.json')) return extractWorldMonitorXAccounts(text);
  if (path.endsWith('agent-view.json')) return extractWorldMonitorAgentView(text);
  if (path.endsWith('_feeds.ts') || path.endsWith('feeds.ts')) return extractWorldMonitorServerFeeds(text);
  return extractUrls(text).map((url) => ({
    name: hostLabel(url),
    url,
    feedKind: kindFromUrl(url),
    category: 'source-file',
    publisher: 'koala73/worldmonitor',
  }));
}

function extractWorldMonitorAttribution(text: string): CandidateFeed[] {
  const payload = parseJson(text);
  const entries = Array.isArray(payload?.entries) ? payload.entries : [];
  const candidates: CandidateFeed[] = [];
  for (const entry of entries) {
    if (!isObject(entry)) continue;
    if (entry.observed !== true || entry.catalogActive === false) continue;
    const status = stringValue(entry.status);
    if (status !== 'reviewed' && status !== 'terms-review') continue;
    const host = stringValue(entry.host);
    if (!host || host === '127.0.0.1' || host === 'localhost') continue;
    const url = safeUrl(`https://${host}`);
    if (!url) continue;
    const provider = stringValue(entry.provider) ?? host;
    candidates.push({
      name: provider,
      url,
      feedKind: entry.kind === 'feed' ? 'feed' : entry.kind === 'structured' ? 'structured' : 'provider_host',
      category: stringValue(entry.kind) ?? 'provider',
      publisher: provider,
      upstreamStatus: status,
      description: clampText(entry.license, 240) || null,
    });
  }
  return candidates;
}

function extractWorldMonitorTelegram(text: string): CandidateFeed[] {
  const payload = parseJson(text);
  const channels = isObject(payload?.channels) ? payload.channels : {};
  const candidates: CandidateFeed[] = [];
  for (const [bucket, entries] of Object.entries(channels)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!isObject(entry) || entry.enabled === false) continue;
      const handle = stringValue(entry.handle)?.replace(/^@/, '');
      if (!handle) continue;
      candidates.push({
        name: stringValue(entry.label) ?? handle,
        url: `https://t.me/s/${handle}`,
        feedKind: 'telegram',
        category: stringValue(entry.topic) ?? bucket,
        publisher: stringValue(entry.label) ?? handle,
        upstreamStatus: stringValue(entry.tier) ? `tier ${entry.tier}` : null,
      });
    }
  }
  return candidates;
}

function extractWorldMonitorXAccounts(text: string): CandidateFeed[] {
  const payload = parseJson(text);
  const channels = isObject(payload?.channels) ? payload.channels : {};
  const candidates: CandidateFeed[] = [];
  for (const [bucket, entries] of Object.entries(channels)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!isObject(entry) || entry.enabled === false) continue;
      const handle = stringValue(entry.handle)?.replace(/^@/, '');
      if (!handle) continue;
      candidates.push({
        name: stringValue(entry.label) ?? stringValue(entry.sourceName) ?? handle,
        url: `https://x.com/${handle}`,
        feedKind: 'x_account',
        category: stringValue(entry.topic) ?? bucket,
        publisher: stringValue(entry.sourceName) ?? stringValue(entry.label) ?? handle,
        upstreamStatus: stringValue(entry.tier) ? `tier ${entry.tier}` : null,
      });
    }
  }
  return candidates;
}

function extractWorldMonitorAgentView(text: string): CandidateFeed[] {
  const payload = parseJson(text);
  const candidates: CandidateFeed[] = [];
  collectAgentUrls(payload?.endpoints, 'endpoint', candidates);
  collectAgentUrls(payload?.discovery, 'discovery', candidates);
  collectAgentUrls(payload?.instances, 'instance', candidates);
  return candidates;
}

function collectAgentUrls(value: unknown, category: string, out: CandidateFeed[], prefix = ''): void {
  if (!isObject(value)) return;
  for (const [key, raw] of Object.entries(value)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (typeof raw === 'string') {
      const url = safeUrl(raw);
      if (url) {
        out.push({
          name,
          url,
          feedKind: 'catalog_endpoint',
          category,
          publisher: 'World Monitor',
        });
      }
      continue;
    }
    if (isObject(raw)) {
      const direct = stringValue(raw.url) ?? stringValue(raw.base) ?? stringValue(raw.openapi) ?? stringValue(raw.serverCard);
      const url = direct ? safeUrl(direct) : null;
      if (url) {
        out.push({
          name,
          url,
          feedKind: 'catalog_endpoint',
          category,
          publisher: 'World Monitor',
          description: clampText(raw.note, 240) || null,
        });
      }
      collectAgentUrls(raw, category, out, name);
    }
  }
}

function extractWorldMonitorServerFeeds(text: string): CandidateFeed[] {
  const candidates: CandidateFeed[] = [];
  for (const block of namedObjectBlocks(text)) {
    const category = categoryNear(text, block.startIndex);
    for (const url of extractFeedUrlsFromBlock(block.body)) {
      candidates.push({
        name: block.name,
        url,
        feedKind: kindFromUrl(url),
        category,
        publisher: block.name,
      });
    }
    for (const url of extractGoogleNewsUrls(block.body)) {
      candidates.push({
        name: block.name,
        url,
        feedKind: 'rss',
        category,
        publisher: block.name,
      });
    }
  }
  return candidates;
}

function extractFeedUrlsFromBlock(block: string): string[] {
  const urls = new Set<string>();
  const direct = /(?:url|[a-z]{2,3}):\s*(?:rss\()?\s*(['"`])(https?:\/\/[^'"`]+)\1/g;
  let match: RegExpExecArray | null;
  while ((match = direct.exec(block))) urls.add(match[2]);
  return [...urls];
}

function extractGoogleNewsUrls(block: string): string[] {
  const urls = new Set<string>();
  const gn = /\bgn(Locale)?\(\s*(['"`])([^'"`]+)\2(?:\s*,\s*(['"`])([^'"`]+)\4\s*,\s*(['"`])([^'"`]+)\6\s*,\s*(['"`])([^'"`]+)\8)?/g;
  let match: RegExpExecArray | null;
  while ((match = gn.exec(block))) {
    const query = match[3];
    const hl = match[5] || 'en-US';
    const gl = match[7] || 'US';
    const ceid = match[9] || 'US:en';
    urls.add(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${encodeURIComponent(hl)}&gl=${encodeURIComponent(gl)}&ceid=${encodeURIComponent(ceid)}`);
  }
  return [...urls];
}

function namedObjectBlocks(text: string): Array<{ name: string; body: string; startIndex: number }> {
  const blocks: Array<{ name: string; body: string; startIndex: number }> = [];
  const startPattern = /\{\s*name:\s*(['"`])([^'"`]+)\1/g;
  let match: RegExpExecArray | null;
  while ((match = startPattern.exec(text))) {
    const start = match.index;
    const end = findMatchingBrace(text, start);
    if (end <= start) continue;
    blocks.push({ name: match[2], body: text.slice(start, end + 1), startIndex: start });
    startPattern.lastIndex = end + 1;
  }
  return blocks;
}

function findMatchingBrace(text: string, start: number): number {
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth++;
    if (char === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function categoryNear(text: string, startIndex: number): string | null {
  const before = text.slice(Math.max(0, startIndex - 600), startIndex);
  const matches = [...before.matchAll(/^\s*([A-Za-z0-9_-]+):\s*\[/gm)];
  const last = matches[matches.length - 1]?.[1];
  return last ?? null;
}

function buildFeedRecord(args: {
  catalog: ExternalFeedCatalog;
  candidate: CandidateFeed & { url: string };
  sourceFile: string;
  sourceUrl: string;
  rawUrl: string;
  collectedAt: string;
}): ExternalFeedRecord {
  const host = hostFromUrl(args.candidate.url) ?? 'unknown';
  const feedKind = args.candidate.feedKind ?? kindFromUrl(args.candidate.url);
  const recordId = stableId(`${args.catalog}-feed`, [args.sourceFile, args.candidate.name, args.candidate.url, args.candidate.category]);
  return {
    id: recordId,
    catalog: args.catalog,
    name: clampText(args.candidate.name, 160) || host,
    feed_kind: feedKind,
    category: cleanString(args.candidate.category),
    url: args.candidate.url,
    host,
    credential_env: uniqueStrings(args.candidate.credentialEnv ?? []),
    source_file: args.sourceFile,
    source_url: args.sourceUrl,
    raw_url: args.rawUrl,
    description: cleanString(args.candidate.description),
    publisher: cleanString(args.candidate.publisher),
    upstream_status: cleanString(args.candidate.upstreamStatus),
    evidence_kind: 'reference',
    integrity: buildMetadata({
      recordId,
      upstreamId: args.candidate.url,
      source: sourceIdentity(`${args.catalog}:${slugify(args.sourceFile)}`, `${catalogLabel(args.catalog)} source file`, args.sourceUrl),
      itemUrl: args.sourceUrl,
      originalPublisher: args.candidate.publisher ?? catalogLabel(args.catalog),
      evidenceKind: 'reference',
      timing: { collectedAt: args.collectedAt },
      methodology: 'Parsed explicit URLs, hosts, and platform handles from the upstream repository source files. No feed records are inferred when source fields are unavailable.',
      evidenceReferences: [{ label: 'Upstream source file', url: args.sourceUrl }],
    }),
  };
}

function buildSummary(args: {
  catalog: ExternalFeedCatalog;
  sourceFile: string;
  sourceUrl: string;
  rawUrl: string;
  feeds: ExternalFeedRecord[];
  collectedAt: string;
}): ExternalFeedSummary {
  const recordId = stableId(`${args.catalog}-feed-summary`, [args.sourceFile]);
  return {
    id: recordId,
    catalog: args.catalog,
    source_file: args.sourceFile,
    source_url: args.sourceUrl,
    raw_url: args.rawUrl,
    total_feeds: args.feeds.length,
    feed_kinds: tally(args.feeds.map((feed) => feed.feed_kind)),
    credential_env: uniqueStrings(args.feeds.flatMap((feed) => feed.credential_env)),
    evidence_kind: 'reference',
    integrity: buildMetadata({
      recordId,
      upstreamId: args.sourceFile,
      source: sourceIdentity(`${args.catalog}:${slugify(args.sourceFile)}`, `${catalogLabel(args.catalog)} source file`, args.sourceUrl),
      itemUrl: args.sourceUrl,
      originalPublisher: catalogLabel(args.catalog),
      evidenceKind: 'reference',
      timing: { collectedAt: args.collectedAt },
      methodology: 'Source-file summary of explicit feed endpoints parsed by Overseer.',
      evidenceReferences: [{ label: 'Upstream source file', url: args.sourceUrl }],
    }),
  };
}

function extractUrls(text: string): string[] {
  const urls = new Set<string>();
  const pattern = /https?:\/\/[^\s'"`<>)\]}]+/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const cleaned = match[0].replace(/[.,;:]+$/g, '');
    const url = safeUrl(cleaned);
    if (url) urls.add(url);
  }
  return [...urls];
}

function extractEnvVars(text: string): string[] {
  const vars = new Set<string>();
  const pattern = /process\.env\.([A-Z][A-Z0-9_]*)|\b([A-Z][A-Z0-9_]{2,})=/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const name = match[1] || match[2];
    if (name && /(?:KEY|TOKEN|SECRET|EMAIL|PASSWORD|APPNAME|ID)$/i.test(name)) vars.add(name);
  }
  return [...vars].sort();
}

function sourceNameFromCrucixModule(path: string, text: string): string {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim().startsWith('//'));
  const fromComment = firstLine?.replace(/^\/\/\s*/, '').split(/[—-]/)[0]?.trim();
  if (fromComment) return fromComment;
  return path.split('/').pop()?.replace(/\.mjs$/, '') ?? path;
}

function firstCommentDescription(text: string): string | null {
  const line = text.split(/\r?\n/).find((candidate) => candidate.trim().startsWith('//'));
  return line ? clampText(line.replace(/^\/\/\s*/, ''), 240) : null;
}

function crucixCategory(path: string, text: string): string | null {
  if (path.includes('/sources/')) return path.split('/').pop()?.replace(/\.mjs$/, '') ?? null;
  const tierMatch = text.match(/===\s*Tier\s+\d+:\s*([^=]+?)\s*===/);
  return tierMatch ? tierMatch[1].trim() : 'orchestrator';
}

function kindFromUrl(url: string): ExternalFeedKind {
  const parsed = safeUrl(url);
  if (!parsed) return 'feed';
  const u = new URL(parsed);
  const host = u.hostname.toLowerCase();
  const path = u.pathname.toLowerCase();
  if (host === 't.me' || host.endsWith('.t.me')) return 'telegram';
  if (host === 'x.com' || host === 'twitter.com' || host.endsWith('.twitter.com')) return 'x_account';
  if (host === 'news.google.com' || path.includes('/rss') || path.endsWith('.rss') || path.endsWith('.xml') || path.includes('/feed')) return 'rss';
  if (host.startsWith('api.') || host.includes('api') || path.includes('/api/')) return 'api';
  if (host === 'github.com' || host.endsWith('.github.com') || path.includes('/docs')) return 'documentation';
  return 'structured';
}

function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function hostLabel(url: string): string {
  return hostFromUrl(url) ?? url;
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function cleanString(value: unknown): string | null {
  const text = clampText(value, 500);
  return text || null;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function tally(values: string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return result;
}

function positiveInt(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'source';
}

function catalogLabel(catalog: ExternalFeedCatalog): string {
  return catalog === 'crucix' ? 'Crucix' : 'World Monitor';
}

function blobUrlFor(catalog: ExternalFeedCatalog, path: string): string {
  return catalog === 'crucix' ? crucixBlobUrl(path) : worldMonitorBlobUrl(path);
}

function rawUrlFor(catalog: ExternalFeedCatalog, path: string): string {
  return catalog === 'crucix' ? crucixRawUrl(path) : worldMonitorRawUrl(path);
}
