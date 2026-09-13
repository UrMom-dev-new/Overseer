import {
  buildMetadata,
  clampText,
  parseDateOrNull,
  safeUrl,
  sourceIdentity,
  stableId,
  validateGeometry,
} from './helpers';
import type { IntegrityMetadata } from './types';

export interface NormalizedGdeltMention {
  id: string;
  lat: number;
  lng: number;
  name: string;
  url: string | null;
  html: string;
  type: 'geolocated_news_mentions';
  query: string;
  mention_count: number | null;
  count: number | null;
  shareimage: string | null;
  source: string;
  evidence_kind: 'report';
  location_relationship: 'mentioned_location';
  integrity: IntegrityMetadata;
}

export interface GdeltNormalizationResult {
  records: NormalizedGdeltMention[];
  received: number;
  rejected: number;
}

export function normalizeGdeltGeoJson(input: unknown, query: string, feedUrl: string, collectedAt: string): GdeltNormalizationResult | null {
  if (!input || typeof input !== 'object') return null;
  const features = (input as { features?: unknown }).features;
  if (!Array.isArray(features)) return null;

  const records: NormalizedGdeltMention[] = [];
  let rejected = 0;
  const seen = new Set<string>();
  const source = sourceIdentity('gdelt-geo', 'GDELT 2.0 GeoJSON API', feedUrl);

  for (const feature of features) {
    if (!feature || typeof feature !== 'object') {
      rejected++;
      continue;
    }
    const f = feature as { geometry?: unknown; properties?: Record<string, unknown> };
    const geometry = validateGeometry(f.geometry);
    if (!geometry || geometry.type !== 'Point') {
      rejected++;
      continue;
    }
    const [lng, lat] = geometry.coordinates;
    const props = f.properties || {};
    const itemUrl = safeUrl(props.url);
    const shareimage = safeUrl(props.shareimage);
    const name = clampText(props.name || props.html || 'GDELT geolocated news mention', 140);
    const publishedAt = parseDateOrNull(props.date || props.seendate);
    const count = typeof props.count === 'number' && Number.isFinite(props.count) ? props.count : null;
    const upstreamId = itemUrl || `${name}:${lat}:${lng}:${query}`;
    const recordId = stableId('gdelt', [source.providerId, query, upstreamId, lat, lng]);
    if (seen.has(recordId)) continue;
    seen.add(recordId);

    records.push({
      id: recordId,
      lat,
      lng,
      name,
      url: itemUrl,
      html: typeof props.html === 'string' ? props.html : '',
      type: 'geolocated_news_mentions',
      query,
      mention_count: count,
      count,
      shareimage,
      source: source.providerName,
      evidence_kind: 'report',
      location_relationship: 'mentioned_location',
      integrity: buildMetadata({
        recordId,
        upstreamId,
        source,
        itemUrl,
        evidenceKind: 'report',
        timing: {
          observedAt: null,
          publishedAt,
          sourceUpdatedAt: null,
          collectedAt,
        },
        location: {
          geometry,
          representativePoint: geometry.coordinates,
          precision: 'unknown',
          relationship: 'mentioned_location',
          resolutionMethod: 'gdelt_geo_api_coordinates',
          qualityFlags: ['geolocated_mention_not_verified_event_location'],
        },
        evidenceReferences: shareimage ? [{ label: 'GDELT share image', url: shareimage }] : [],
        methodology: 'GDELT GEO coordinates represent geolocated news mentions. They are not confirmed incident coordinates or assessed severity.',
      }),
    });
  }

  return { records, received: features.length, rejected };
}

