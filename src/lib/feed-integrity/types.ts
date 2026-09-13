export type DataMode = 'real' | 'demo';
export type EvidenceKind = 'observation' | 'report' | 'assessment' | 'reference';
export type VerificationState = 'unassessed' | 'verified' | 'disputed' | 'false' | 'unknown';
export type LocationPrecision = 'exact' | 'city' | 'region' | 'country' | 'unknown';
export type LocationRelationship = 'event_location' | 'mentioned_location' | 'source_location' | 'unknown';

export type Availability = 'unknown' | 'ok' | 'partial' | 'rate_limited' | 'error' | 'not_configured';
export type DataState = 'present' | 'empty' | 'unavailable';
export type Freshness = 'fresh' | 'stale' | 'unknown';

export interface SourceIdentity {
  providerId: string;
  providerName: string;
  feedUrl?: string | null;
}

export interface EvidenceReference {
  label: string;
  url?: string | null;
  note?: string | null;
}

export interface RecordProvenance {
  recordId: string;
  upstreamId: string | null;
  source: SourceIdentity;
  itemUrl: string | null;
  originalPublisher: string | null;
  dataMode: DataMode;
  evidenceKind: EvidenceKind;
  verification: VerificationState;
  evidenceReferences: EvidenceReference[];
  methodology: string | null;
}

export interface RecordTiming {
  observedAt: string | null;
  publishedAt: string | null;
  sourceUpdatedAt: string | null;
  collectedAt: string;
  expiresAt: string | null;
}

export interface RecordLocation {
  geometry: GeoJsonGeometry | null;
  representativePoint: [number, number] | null;
  precision: LocationPrecision;
  relationship: LocationRelationship;
  resolutionMethod: string | null;
  qualityFlags: string[];
}

export interface GeoJsonPoint {
  type: 'Point';
  coordinates: [number, number];
}

export interface GeoJsonPolygon {
  type: 'Polygon';
  coordinates: number[][][];
}

export interface GeoJsonMultiPolygon {
  type: 'MultiPolygon';
  coordinates: number[][][][];
}

export type GeoJsonGeometry = GeoJsonPoint | GeoJsonPolygon | GeoJsonMultiPolygon;

export interface IntegrityMetadata {
  provenance: RecordProvenance;
  timing: RecordTiming;
  location: RecordLocation;
}

export interface SourceCollectionStatus {
  source: SourceIdentity;
  availability: Availability;
  dataState: DataState;
  freshness: Freshness;
  lastAttemptAt: string | null;
  lastSuccessfulFetchAt: string | null;
  nextRetryAt: string | null;
  servingLastKnownGood: boolean;
  errorCode: string | null;
  message: string | null;
  receivedRecords: number;
  acceptedRecords: number;
  rejectedRecords: number;
}

export interface FeedEnvelope<T> {
  dataMode: DataMode;
  collectedAt: string;
  records: T[];
  total: number;
  status: SourceCollectionStatus[];
}

