import { INFRASTRUCTURE_SECTORS, INFRASTRUCTURE_TTL_MS } from './infrastructure-catalog';
import type { SourceCapability } from './source-manifest-base';
import type { SourceContract } from './source-contracts-base';
import type { SourceCollectionStatus } from './feed-integrity/types';

export function infrastructureStatusAt(status: SourceCollectionStatus, nowMs = Date.now()): SourceCollectionStatus {
  if (!status.source.providerId.startsWith('infrastructure-') || (status.availability !== 'ok' && status.availability !== 'partial')) return status;
  const age = nowMs - Date.parse(status.lastSuccessfulFetchAt ?? '');
  if (Number.isFinite(age) && age >= -5 * 60 * 1000 && age < INFRASTRUCTURE_TTL_MS) return status;
  return { ...status, availability: 'error', dataState: 'unavailable', freshness: Number.isFinite(age) && age >= INFRASTRUCTURE_TTL_MS ? 'stale' : 'unknown',
    acceptedRecords: 0, message: 'Infrastructure collection expired or has invalid timing; recollection required. No cached assets are considered current.' };
}

export const INFRASTRUCTURE_CAPABILITIES: SourceCapability[] = INFRASTRUCTURE_SECTORS.map((sector) => ({
  id: `infrastructure-${sector.id}`, label: `Infrastructure: ${sector.label}`,
  uiSurface: 'Infrastructure map layers and source catalog (desktop and mobile)', layerId: sector.layerKey,
  apiRoute: `/api/infrastructure-assets?sectors=${sector.id}&bbox=25.45,42.68,25.50,42.72`,
  provider: 'OpenStreetMap contributors via Overpass', providerDocs: 'https://wiki.openstreetmap.org/wiki/Overpass_API',
  credentialEnv: [], runtimeModes: ['web', 'docker', 'desktop'],
  expectedResponse: 'Bounded Overpass nodes and ways with source geometry, tags, and replica timestamp',
  normalizedContract: 'assets[] reference geometries, original OSM identifiers, source timestamps and per-sector provider status',
  coverage: 'Mapped features in current viewport, at most one degree per side; nodes and ways only, not a complete global inventory',
  refreshPolicy: 'On enabled-layer or viewport change; 15-minute cache and expiry; failed data omitted',
  timeoutPolicy: '12 seconds per provider including body, two providers, 8 MiB and 5,000 objects maximum',
  fallback: 'Alternate Overpass instance; Geofabrik extracts listed for manual bulk access',
  notes: 'ODbL 1.0. Reference map, not live operations or independent corroboration of OSM-derived sources. No guessed centroids or synthetic records.',
}));

export const INFRASTRUCTURE_CONTRACTS: SourceContract[] = INFRASTRUCTURE_CAPABILITIES.map((capability) => ({
  id: capability.id, label: capability.label, apiRoute: capability.apiRoute, requirement: 'optional',
  requireProviderStatus: true, allowSchemaValidEmpty: true, minUsableRecords: 0,
  maxFreshnessMs: INFRASTRUCTURE_TTL_MS, safeToProbe: false,
  recordSets: [{ id: 'assets', paths: ['assets'], evidenceKind: 'reference', liveObservation: false,
    required: true, description: 'OSM reference geometry in the selected area', usabilityFields: ['id', 'name', 'source_url'],
    minUsableRecords: 0, allowEmpty: true, maxRecordAgeMs: INFRASTRUCTURE_TTL_MS, timestampFields: ['collectedAt'] }],
}));
