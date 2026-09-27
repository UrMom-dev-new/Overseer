import type { SourceCapability } from './source-manifest-base';
import type { SourceContract } from './source-contracts-base';
import { RANSOMWARE_REFRESH_MS } from './feed-integrity/ransomware-types';

export const RANSOMWARE_CAPABILITY: SourceCapability = {
  id: 'ransomware', label: 'Ransomware and extortion claims',
  uiSurface: 'SDK Ransomware Feed report panel (desktop and mobile); source diagnostics',
  layerId: 'sdk_ransomware', apiRoute: '/api/ransomware', provider: 'RansomLook',
  providerDocs: 'https://www.ransomlook.io/about', credentialEnv: [],
  runtimeModes: ['web', 'docker', 'desktop'],
  expectedResponse: 'JSON array from RansomLook /api/recent/100; public metadata only',
  normalizedContract: 'ransomware_reports[] with stable IDs, nullable discovery dates, unassessed verification, provenance and provider status',
  coverage: 'Latest 100 provider posts at most, including claims and announcements; not a global incident or unique-victim count',
  refreshPolicy: '30 minutes while open; server single-flight cache; manual refresh respects provider cooldown',
  timeoutPolicy: '10 seconds including body read; 1 MiB response limit; no redirects',
  fallback: 'Per-process last-known-good snapshot for at most 24 hours, explicitly stale during failure',
  notes: 'CC BY 4.0 attribution included. No API key, leak-site requests, downloaded evidence or fabricated geography. Discovery is not attack time.',
};

export const RANSOMWARE_CONTRACT: SourceContract = {
  id: 'ransomware', label: RANSOMWARE_CAPABILITY.label, apiRoute: '/api/ransomware', requirement: 'report',
  requireProviderStatus: true, allowSchemaValidEmpty: true, minUsableRecords: 0,
  maxFreshnessMs: RANSOMWARE_REFRESH_MS, safeToProbe: true,
  recordSets: [{
    id: 'ransomware_reports', paths: ['ransomware_reports'], evidenceKind: 'report', liveObservation: false,
    required: true, description: 'Unverified ransomware-related posts, not confirmed incidents or unique victims',
    usabilityFields: ['id', 'title', 'group', 'source', 'verification'], minUsableRecords: 0, allowEmpty: true,
    maxRecordAgeMs: null, timestampFields: ['discoveredAt'],
  }],
};
