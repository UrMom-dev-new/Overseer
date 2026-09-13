import type {
  EvidenceKind,
  GeoJsonGeometry,
  GeoJsonMultiPolygon,
  GeoJsonPoint,
  GeoJsonPolygon,
  IntegrityMetadata,
  RecordLocation,
  RecordTiming,
  SourceCollectionStatus,
  SourceIdentity,
  VerificationState,
} from './types';

export function nowIso(): string {
  return new Date().toISOString();
}

export function parseDateOrNull(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (value === '') return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

export function parseEpochMsOrNull(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

export function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function isValidLngLat(lng: unknown, lat: unknown): boolean {
  return (
    typeof lng === 'number' &&
    typeof lat === 'number' &&
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    lng >= -180 &&
    lng <= 180 &&
    lat >= -90 &&
    lat <= 90
  );
}

export function pointGeometry(lng: unknown, lat: unknown): GeoJsonPoint | null {
  if (!isValidLngLat(lng, lat)) return null;
  return { type: 'Point', coordinates: [lng as number, lat as number] };
}

export function validateGeometry(value: unknown): GeoJsonGeometry | null {
  if (!value || typeof value !== 'object') return null;
  const geometry = value as { type?: unknown; coordinates?: unknown };

  if (geometry.type === 'Point' && Array.isArray(geometry.coordinates)) {
    return pointGeometry(geometry.coordinates[0], geometry.coordinates[1]);
  }

  if (geometry.type === 'Polygon' && Array.isArray(geometry.coordinates)) {
    const polygon = geometry.coordinates;
    if (polygon.every((ring) => Array.isArray(ring) && ring.every((coord) => Array.isArray(coord) && isValidLngLat(coord[0], coord[1])))) {
      return { type: 'Polygon', coordinates: polygon as GeoJsonPolygon['coordinates'] };
    }
  }

  if (geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) {
    const multi = geometry.coordinates;
    if (
      multi.every((poly) =>
        Array.isArray(poly) &&
        poly.every((ring) =>
          Array.isArray(ring) && ring.every((coord) => Array.isArray(coord) && isValidLngLat(coord[0], coord[1]))
        )
      )
    ) {
      return { type: 'MultiPolygon', coordinates: multi as GeoJsonMultiPolygon['coordinates'] };
    }
  }

  return null;
}

export function representativePoint(geometry: GeoJsonGeometry | null): [number, number] | null {
  if (!geometry) return null;
  if (geometry.type === 'Point') return geometry.coordinates;
  if (geometry.type === 'Polygon') return averageCoordinates(geometry.coordinates[0]);
  return averageCoordinates(geometry.coordinates[0]?.[0]);
}

export function averageCoordinates(coords?: number[][]): [number, number] | null {
  if (!coords || coords.length === 0) return null;
  let lng = 0;
  let lat = 0;
  let count = 0;
  for (const coord of coords) {
    if (!isValidLngLat(coord[0], coord[1])) continue;
    lng += coord[0];
    lat += coord[1];
    count++;
  }
  if (count === 0) return null;
  return [lng / count, lat / count];
}

export function stableHash(parts: unknown[]): string {
  const input = parts
    .map((part) => {
      if (part == null) return '';
      if (typeof part === 'object') return JSON.stringify(part);
      return String(part);
    })
    .join('|');
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function stableId(prefix: string, parts: unknown[]): string {
  return `${prefix}-${stableHash(parts)}`;
}

export function sourceIdentity(providerId: string, providerName: string, feedUrl?: string | null): SourceIdentity {
  return { providerId, providerName, feedUrl: feedUrl ?? null };
}

export function blankLocation(overrides: Partial<RecordLocation> = {}): RecordLocation {
  return {
    geometry: null,
    representativePoint: null,
    precision: 'unknown',
    relationship: 'unknown',
    resolutionMethod: null,
    qualityFlags: [],
    ...overrides,
  };
}

export function buildMetadata(args: {
  recordId: string;
  upstreamId?: string | null;
  source: SourceIdentity;
  itemUrl?: string | null;
  originalPublisher?: string | null;
  evidenceKind: EvidenceKind;
  timing: Partial<RecordTiming> & { collectedAt: string };
  location?: Partial<RecordLocation>;
  verification?: VerificationState;
  methodology?: string | null;
  evidenceReferences?: { label: string; url?: string | null; note?: string | null }[];
}): IntegrityMetadata {
  return {
    provenance: {
      recordId: args.recordId,
      upstreamId: args.upstreamId ?? null,
      source: args.source,
      itemUrl: args.itemUrl ?? null,
      originalPublisher: args.originalPublisher ?? null,
      dataMode: 'real',
      evidenceKind: args.evidenceKind,
      verification: args.verification ?? 'unassessed',
      evidenceReferences: args.evidenceReferences ?? [],
      methodology: args.methodology ?? null,
    },
    timing: {
      observedAt: args.timing.observedAt ?? null,
      publishedAt: args.timing.publishedAt ?? null,
      sourceUpdatedAt: args.timing.sourceUpdatedAt ?? null,
      collectedAt: args.timing.collectedAt,
      expiresAt: args.timing.expiresAt ?? null,
    },
    location: blankLocation(args.location),
  };
}

export function collectionStatus(args: Partial<SourceCollectionStatus> & { source: SourceIdentity }): SourceCollectionStatus {
  return {
    availability: 'unknown',
    dataState: 'unavailable',
    freshness: 'unknown',
    lastAttemptAt: null,
    lastSuccessfulFetchAt: null,
    nextRetryAt: null,
    servingLastKnownGood: false,
    errorCode: null,
    message: null,
    receivedRecords: 0,
    acceptedRecords: 0,
    rejectedRecords: 0,
    ...args,
  };
}

export function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function stripHtml(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

export function clampText(value: unknown, maxLength: number): string {
  const text = stripHtml(value).replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}
