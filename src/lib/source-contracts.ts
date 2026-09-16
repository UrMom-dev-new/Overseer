import { SOURCE_CAPABILITIES, sourceConfigurationState, type ConfigurationState } from './source-manifest';

export type RequirementLevel = 'required' | 'optional' | 'report';
export type EvidenceKind = 'observation' | 'report' | 'reference' | 'mixed';
export type StageOutcome = 'passed' | 'failed' | 'warning' | 'not_configured' | 'not_checked';

export interface RecordSetContract {
  id: string;
  paths: string[];
  evidenceKind: EvidenceKind;
  liveObservation: boolean;
  required: boolean;
  description: string;
}

export interface SourceContract {
  id: string;
  label: string;
  apiRoute: string;
  requirement: RequirementLevel;
  recordSets: RecordSetContract[];
  requireProviderStatus: boolean;
  allowSchemaValidEmpty: boolean;
  safeToProbe: boolean;
}

export interface NormalizedProviderStatus {
  providerId: string;
  providerName: string | null;
  availability: string | null;
  dataState: string | null;
  freshness: string | null;
  acceptedRecords: number;
  rejectedRecords: number;
  receivedRecords: number;
  message: string | null;
  servingLastKnownGood: boolean;
}

export interface RecordSetResult extends RecordSetContract {
  present: boolean;
  returnedRecords: number;
}

export interface CapabilityEvaluation {
  id: string;
  label: string;
  path: string;
  requirement: RequirementLevel;
  configuration: ConfigurationState;
  stages: {
    applicationRoute: StageOutcome;
    payloadContract: StageOutcome;
    providerCollection: StageOutcome;
    configuration: StageOutcome;
    dataState: StageOutcome;
    freshness: StageOutcome;
    rendering: StageOutcome;
  };
  passed: boolean;
  okForReleaseGate: boolean;
  httpStatus: number | null;
  contentType: string | null;
  recordSets: RecordSetResult[];
  counts: {
    returnedRecords: number;
    liveObservations: number;
    reports: number;
    references: number;
    providerAcceptedRecords: number;
    providerRejectedRecords: number;
    providerReceivedRecords: number;
  };
  providerStatuses: NormalizedProviderStatus[];
  activeFallback: string | null;
  configuredFallback: string | null;
  messages: string[];
}

const capabilityById = new Map(SOURCE_CAPABILITIES.map((capability) => [capability.id, capability]));

const CONTRACTS: SourceContract[] = [
  required('earthquakes', [
    records('earthquakes', ['earthquakes'], 'observation', true, 'USGS earthquake observations'),
  ]),
  required('news', [
    records('news', ['news'], 'report', true, 'RSS/Telegram source reports'),
  ]),
  required('weather', [
    records('weather_events', ['events', 'weather_events'], 'observation', true, 'NWS/EONET weather events'),
  ]),
  required('fires', [
    records('fires', ['fires'], 'observation', true, 'FIRMS/EONET fire and volcano observations'),
    records('events', ['events'], 'report', false, 'Supplemental event reports', false),
  ]),
  report('gdelt', [
    records('events', ['events'], 'report', true, 'GDELT geolocated media mentions'),
  ]),
  required('flights', [
    records('commercial_flights', ['commercial_flights'], 'observation', true, 'Commercial aircraft observations', false),
    records('military_flights', ['military_flights'], 'observation', true, 'Military aircraft observations', false),
    records('private_flights', ['private_flights'], 'observation', true, 'Private aircraft observations', false),
    records('private_jets', ['private_jets'], 'observation', true, 'Private jet observations', false),
  ]),
  required('satellites', [
    records('satellites', ['satellites'], 'observation', true, 'Propagated real TLE satellite positions'),
  ]),
  optional('maritime', [
    records('ships', ['ships'], 'observation', true, 'Live vessel observations', false),
    records('ports', ['ports'], 'reference', false, 'Reference port records'),
    records('chokepoints', ['chokepoints'], 'reference', false, 'Reference chokepoint records'),
  ]),
  report('cctv', [
    records('cameras', ['cameras'], 'reference', false, 'Public traffic camera catalog records'),
  ]),
  report('live-news', [
    records('feeds', ['feeds'], 'reference', false, 'Curated live broadcast links'),
  ]),
  report('surveillance-capabilities', [
    records('locations', ['locations'], 'reference', false, 'Aggregated surveillance capability location references'),
    records('records', ['records'], 'reference', false, 'Source-derived surveillance capability records', false),
    records('flight_paths', ['flight_paths'], 'reference', false, 'Historical surveillance flight path references', false),
  ]),
  report('surveillance-industry', [
    records('locations', ['locations'], 'reference', false, 'Representative surveillance industry dossier locations'),
    records('dossiers', ['dossiers'], 'reference', false, 'Parsed Surveillance-Industry Markdown dossiers', false),
  ]),
  report('odint-targets', [
    records('targets', ['targets'], 'reference', false, 'Parsed ODINT public domains, URLs, and API endpoint references'),
    records('summaries', ['summaries'], 'reference', false, 'ODINT source file inventory summaries', false),
  ]),
  report('fed-rolodex', [
    records('intelligence_entities', ['intelligence_entities'], 'reference', false, 'Parsed FED intelligence agency and topic reference records'),
    records('cultural_centers', ['cultural_centers'], 'reference', false, 'Parsed FED cultural center reference records'),
    records('summaries', ['summaries'], 'reference', false, 'FED database source summaries', false),
  ]),
  report('data-centers', [
    records('data_centers', ['data_centers'], 'reference', false, 'Coordinate-bearing Global Data Center Map records', false),
    records('summaries', ['summaries'], 'reference', false, 'Global Data Center Map dataset summaries'),
  ]),
  required('markets', [
    objectRecords('stocks', ['stocks'], 'observation', true, 'Equity quote records', false),
    objectRecords('oil', ['oil'], 'observation', true, 'Oil quote records', false),
    objectRecords('commodities', ['commodities'], 'observation', true, 'Commodity quote records', false),
    objectRecords('crypto', ['crypto'], 'observation', true, 'Crypto quote records', false),
    objectRecords('indices', ['indices'], 'observation', true, 'Index quote records', false),
  ]),
  required('space-weather', [
    scalarRecord('kp_index', ['kp_index'], 'observation', true, 'NOAA SWPC Kp index', false),
    records('alerts', ['alerts'], 'report', true, 'NOAA SWPC alerts', false),
    records('solar_flares', ['solar_flares'], 'observation', true, 'NOAA SWPC flare records', false),
  ]),
  report('cyber-threats', [
    records('threats', ['threats', 'vulnerabilities'], 'report', true, 'Cyber threat/vulnerability records', false),
  ]),
  report('mac-vendor-lookup', [
    scalarRecord('vendor', ['vendor'], 'reference', false, 'MAC OUI vendor lookup result'),
    scalarRecord('oui', ['oui'], 'reference', false, 'Resolved OUI prefix'),
  ]),
];

export const SOURCE_CONTRACTS = CONTRACTS;
export const VERIFY_ROUTE_CONTRACTS = CONTRACTS.filter((contract) => contract.safeToProbe);
export const REQUIRED_CAPABILITY_IDS = CONTRACTS.filter((contract) => contract.requirement === 'required').map((contract) => contract.id);

function required(id: string, recordSets: RecordSetContract[]): SourceContract {
  return buildContract(id, 'required', recordSets);
}

function optional(id: string, recordSets: RecordSetContract[]): SourceContract {
  return buildContract(id, 'optional', recordSets);
}

function report(id: string, recordSets: RecordSetContract[]): SourceContract {
  return buildContract(id, 'report', recordSets);
}

function buildContract(id: string, requirement: RequirementLevel, recordSets: RecordSetContract[]): SourceContract {
  const capability = capabilityById.get(id);
  if (!capability) throw new Error(`Missing source capability metadata for ${id}`);
  return {
    id,
    label: capability.label,
    apiRoute: capability.apiRoute,
    requirement,
    recordSets,
    requireProviderStatus: true,
    allowSchemaValidEmpty: true,
    safeToProbe: id !== 'scanner' && id !== 'mac-vendor-lookup' && id !== 'odint-targets' && id !== 'data-centers',
  };
}

function records(id: string, paths: string[], evidenceKind: EvidenceKind, liveObservation: boolean, description: string, requiredSet = true): RecordSetContract {
  return { id, paths, evidenceKind, liveObservation, required: requiredSet, description };
}

function objectRecords(id: string, paths: string[], evidenceKind: EvidenceKind, liveObservation: boolean, description: string, requiredSet = true): RecordSetContract {
  return records(id, paths.map((path) => `${path}.*`), evidenceKind, liveObservation, description, requiredSet);
}

function scalarRecord(id: string, paths: string[], evidenceKind: EvidenceKind, liveObservation: boolean, description: string, requiredSet = true): RecordSetContract {
  return records(id, paths.map((path) => `${path}#scalar`), evidenceKind, liveObservation, description, requiredSet);
}

export function getSourceContract(id: string): SourceContract | undefined {
  return SOURCE_CONTRACTS.find((contract) => contract.id === id);
}

export function normalizeProviderStatuses(payload: unknown): NormalizedProviderStatus[] {
  if (!isRecord(payload)) return [];
  const raw = Array.isArray(payload.status)
    ? payload.status
    : Array.isArray(payload.source_status)
      ? payload.source_status
      : [];
  return raw.filter(isRecord).map((status) => {
    const source = isRecord(status.source) ? status.source : null;
    const acceptedRecords = numberField(status.acceptedRecords) ?? numberField(status.accepted) ?? 0;
    return {
      providerId: stringField(source?.providerId) ?? stringField(status.providerId) ?? stringField(status.provider) ?? 'unknown-provider',
      providerName: stringField(source?.providerName) ?? stringField(status.provider) ?? null,
      availability: stringField(status.availability),
      dataState: stringField(status.dataState),
      freshness: stringField(status.freshness),
      acceptedRecords,
      rejectedRecords: numberField(status.rejectedRecords) ?? 0,
      receivedRecords: numberField(status.receivedRecords) ?? numberField(status.received) ?? acceptedRecords,
      message: stringField(status.message),
      servingLastKnownGood: Boolean(status.servingLastKnownGood),
    };
  });
}

export function evaluateCapabilityPayload(args: {
  contract: SourceContract;
  httpStatus: number | null;
  contentType: string | null;
  payload: unknown;
  parseError?: string | null;
  env?: Record<string, string | undefined>;
  renderingChecked?: boolean;
}): CapabilityEvaluation {
  const { contract, httpStatus, contentType, payload, parseError, env, renderingChecked = false } = args;
  const capability = capabilityById.get(contract.id);
  const configuration = capability ? sourceConfigurationState(capability, env) : 'not_configured';
  const messages: string[] = [];
  const httpOk = typeof httpStatus === 'number' && httpStatus >= 200 && httpStatus < 300;
  if (!httpOk) messages.push(`Route returned HTTP ${httpStatus ?? 'unreached'}.`);
  if (parseError) messages.push(`Response was not valid JSON: ${parseError}`);
  if (!isJsonContent(contentType)) messages.push(`Unexpected content type: ${contentType || 'missing'}.`);
  if (!isRecord(payload)) messages.push('Payload must be a JSON object.');

  const recordSets = contract.recordSets.map((recordSet) => {
    const counts = recordSet.paths.map((path) => countPath(payload, path));
    const present = counts.some((count) => count.present);
    return {
      ...recordSet,
      present,
      returnedRecords: counts.reduce((sum, count) => sum + count.count, 0),
    };
  });
  const missingRequiredSets = recordSets.filter((set) => set.required && !set.present);
  for (const set of missingRequiredSets) messages.push(`Missing required record set: ${set.id}.`);

  const providerStatuses = normalizeProviderStatuses(payload);
  if (contract.requireProviderStatus && providerStatuses.length === 0) {
    messages.push('No provider status array was reported.');
  }

  const counts = summarizeCounts(recordSets, providerStatuses);
  const activeFallback = providerStatuses.some((status) => status.servingLastKnownGood) ? 'last-known-good' : null;
  const configuredFallback = capability?.fallback ?? null;
  const providerAvailability = summarizeProviderAvailability(providerStatuses);
  const dataState = summarizeDataState(providerStatuses, counts.returnedRecords);
  const freshness = summarizeFreshness(providerStatuses);
  const configurationOutcome: StageOutcome = configuration === 'not_configured'
    ? contract.requirement === 'required' ? 'failed' : 'not_configured'
    : 'passed';
  const payloadContract: StageOutcome = httpOk && !parseError && isJsonContent(contentType) && isRecord(payload) && missingRequiredSets.length === 0
    ? 'passed'
    : 'failed';
  const providerCollection: StageOutcome = providerAvailability;
  const stages = {
    applicationRoute: httpOk ? 'passed' as const : 'failed' as const,
    payloadContract,
    providerCollection,
    configuration: configurationOutcome,
    dataState,
    freshness,
    rendering: renderingChecked ? 'passed' as const : 'not_checked' as const,
  };
  const hardFailure = stages.applicationRoute === 'failed' ||
    stages.payloadContract === 'failed' ||
    stages.providerCollection === 'failed' ||
    stages.configuration === 'failed' ||
    stages.dataState === 'failed';
  const passed = !hardFailure;
  return {
    id: contract.id,
    label: contract.label,
    path: contract.apiRoute,
    requirement: contract.requirement,
    configuration,
    stages,
    passed,
    okForReleaseGate: contract.requirement === 'required' ? passed : true,
    httpStatus,
    contentType,
    recordSets,
    counts,
    providerStatuses,
    activeFallback,
    configuredFallback,
    messages,
  };
}

function summarizeCounts(recordSets: RecordSetResult[], statuses: NormalizedProviderStatus[]): CapabilityEvaluation['counts'] {
  const byKind = (kind: EvidenceKind) => recordSets
    .filter((set) => set.evidenceKind === kind)
    .reduce((sum, set) => sum + set.returnedRecords, 0);
  return {
    returnedRecords: recordSets.reduce((sum, set) => sum + set.returnedRecords, 0),
    liveObservations: recordSets.filter((set) => set.liveObservation).reduce((sum, set) => sum + set.returnedRecords, 0),
    reports: byKind('report'),
    references: byKind('reference'),
    providerAcceptedRecords: statuses.reduce((sum, status) => sum + status.acceptedRecords, 0),
    providerRejectedRecords: statuses.reduce((sum, status) => sum + status.rejectedRecords, 0),
    providerReceivedRecords: statuses.reduce((sum, status) => sum + status.receivedRecords, 0),
  };
}

function summarizeProviderAvailability(statuses: NormalizedProviderStatus[]): StageOutcome {
  if (statuses.length === 0) return 'failed';
  const configured = statuses.filter((status) => status.availability !== 'not_configured');
  if (configured.length === 0) return 'not_configured';
  if (configured.some((status) => status.availability === 'ok' || status.availability === 'partial')) {
    return configured.some((status) => status.availability === 'error' || status.availability === 'rate_limited') ? 'warning' : 'passed';
  }
  return 'failed';
}

function summarizeDataState(statuses: NormalizedProviderStatus[], returnedRecords: number): StageOutcome {
  if (statuses.length === 0) return 'failed';
  if (statuses.some((status) => status.dataState === 'present')) return returnedRecords > 0 ? 'passed' : 'warning';
  if (statuses.some((status) => status.dataState === 'empty')) return 'passed';
  if (statuses.every((status) => status.availability === 'not_configured')) return 'not_configured';
  return 'failed';
}

function summarizeFreshness(statuses: NormalizedProviderStatus[]): StageOutcome {
  if (statuses.length === 0) return 'not_checked';
  if (statuses.some((status) => status.freshness === 'fresh')) return 'passed';
  if (statuses.some((status) => status.servingLastKnownGood || status.freshness === 'stale')) return 'warning';
  return 'not_checked';
}

function countPath(payload: unknown, path: string): { present: boolean; count: number } {
  if (!isRecord(payload)) return { present: false, count: 0 };
  if (path.endsWith('.*')) {
    const value = getPath(payload, path.slice(0, -2));
    return isRecord(value) ? { present: true, count: Object.keys(value).length } : { present: false, count: 0 };
  }
  if (path.endsWith('#scalar')) {
    const value = getPath(payload, path.slice(0, -7));
    return value === null || value === undefined ? { present: true, count: 0 } : { present: true, count: 1 };
  }
  const value = getPath(payload, path);
  return Array.isArray(value) ? { present: true, count: value.length } : { present: false, count: 0 };
}

function getPath(object: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!isRecord(current)) return undefined;
    return current[segment];
  }, object);
}

function isJsonContent(contentType: string | null): boolean {
  if (!contentType) return false;
  return /\bapplication\/json\b|\+json\b/i.test(contentType);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numberField(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
