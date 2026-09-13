import {
  buildMetadata,
  clampText,
  parseDateOrNull,
  safeUrl,
  sourceIdentity,
  stableId,
  stripHtml,
} from './helpers';
import { resolveTextLocation } from './location';
import type { IntegrityMetadata } from './types';

export interface RawNewsItem {
  title: string;
  description: string;
  link: string | null;
  pubDate: string | null;
  source: string;
}

export interface KeywordRelevance {
  score: number;
  matchedTerms: string[];
  method: 'word_aware_keyword_relevance';
  version: '1';
}

export interface NormalizedNewsItem {
  id: string;
  title: string;
  description: string;
  link: string | null;
  published: string | null;
  source: string;
  keyword_relevance: KeywordRelevance;
  keyword_relevance_score: number;
  matched_terms: string[];
  coords: [number, number] | null;
  coords_default: boolean;
  location_name: string | null;
  location_precision: string;
  location_relationship: string;
  publication_time_quality: 'known' | 'unknown' | 'invalid_or_missing';
  evidence_kind: 'report';
  machine_assessment: null;
  integrity: IntegrityMetadata;
}

export const RISK_KEYWORDS = [
  'war',
  'missile',
  'strike',
  'attack',
  'crisis',
  'tension',
  'military',
  'conflict',
  'defense',
  'clash',
  'nuclear',
  'invasion',
  'bomb',
  'drone',
  'weapon',
  'sanctions',
  'ceasefire',
  'escalation',
  'killed',
  'destroyed',
  'operation',
  'casualty',
  'frontline',
  'threat',
];

function keywordRegex(term: string): RegExp {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}\\p{N}]|$)`, 'iu');
}

export function keywordRelevance(text: string): KeywordRelevance {
  const matchedTerms = RISK_KEYWORDS.filter((kw) => keywordRegex(kw).test(text));
  return {
    score: Math.min(10, 1 + matchedTerms.length * 2),
    matchedTerms,
    method: 'word_aware_keyword_relevance',
    version: '1',
  };
}

export function parseTelegramHTML(html: string, channel: string): RawNewsItem[] {
  const items: RawNewsItem[] = [];
  const messageBlockRegex = /<div class="tgme_widget_message_wrap js-widget_message_wrap"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/gi;
  let blockMatch: RegExpExecArray | null;

  while ((blockMatch = messageBlockRegex.exec(html)) !== null) {
    const blockHtml = blockMatch[0];
    const textMatch = blockHtml.match(/<div class="tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/i);
    if (!textMatch) continue;

    const text = stripHtml(textMatch[1]);
    if (!text || text.length < 10) continue;

    const dateMatch = blockHtml.match(/<a class="tgme_widget_message_date" href="(https:\/\/t\.me\/[^"]+)".*?<time datetime="([^"]+)"/i);
    const link = safeUrl(dateMatch?.[1]) ?? `https://t.me/${channel}`;
    const pubDate = parseDateOrNull(dateMatch?.[2]);
    const title = text.split('\n')[0].substring(0, 100);

    items.push({ title, description: text, link, pubDate, source: `t.me/${channel}` });
  }

  return items;
}

export function parseRSSItems(xml: string, sourceName: string): RawNewsItem[] {
  const items: RawNewsItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    const getTag = (tag: string) => {
      const tagMatch = itemXml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      return stripHtml(tagMatch?.[1] || tagMatch?.[2] || '');
    };

    const title = clampText(getTag('title'), 100);
    if (!title) continue;

    items.push({
      title,
      description: getTag('description'),
      link: safeUrl(getTag('link')),
      pubDate: parseDateOrNull(getTag('pubDate')),
      source: sourceName,
    });
  }

  return items;
}

export function normalizeNewsItem(article: RawNewsItem, collectedAt: string): NormalizedNewsItem {
  const text = `${article.title} ${article.description}`;
  const relevance = keywordRelevance(text);
  const resolved = resolveTextLocation(text);
  const source = sourceIdentity(`news-${article.source.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, article.source, null);
  const recordId = stableId('news', [article.source, article.link, article.pubDate, article.title]);

  return {
    id: recordId,
    title: article.title,
    description: article.description,
    link: article.link,
    published: article.pubDate,
    source: article.source,
    keyword_relevance: relevance,
    keyword_relevance_score: relevance.score,
    matched_terms: relevance.matchedTerms,
    coords: resolved.coords,
    coords_default: false,
    location_name: resolved.placeName,
    location_precision: resolved.precision,
    location_relationship: resolved.relationship,
    publication_time_quality: article.pubDate ? 'known' : 'invalid_or_missing',
    evidence_kind: 'report',
    machine_assessment: null,
    integrity: buildMetadata({
      recordId,
      upstreamId: article.link,
      source,
      itemUrl: article.link,
      evidenceKind: 'report',
      timing: {
        observedAt: null,
        publishedAt: article.pubDate,
        collectedAt,
      },
      location: {
        geometry: resolved.coords ? { type: 'Point', coordinates: [resolved.coords[1], resolved.coords[0]] } : null,
        representativePoint: resolved.coords ? [resolved.coords[1], resolved.coords[0]] : null,
        precision: resolved.precision,
        relationship: resolved.relationship,
        resolutionMethod: resolved.method,
        qualityFlags: resolved.qualityFlags,
      },
      methodology: 'Source report normalized from Telegram public web preview or RSS. Keyword relevance is deterministic word-aware matching and is not a threat assessment.',
    }),
  };
}

