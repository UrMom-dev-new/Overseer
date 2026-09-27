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
  usabilityFields: string[];
  minUsableRecords: number;
  allowEmpty: boolean;
  maxRecordAgeMs: number | null;
  timestampFields: string[];
}

export interface SourceContract {
  id: string;
  label: string;
  apiRoute: string;
  requirement: RequirementLevel;
  recordSets: RecordSetContract[];
  requireProviderStatus: boolean;
  allowSchemaValidEmpty: boolean;
  minUsableRecords: number;
  maxFreshnessMs: number;
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
  lastAttemptAt: string | null;
  lastSuccessfulFetchAt: string | null;
  nextRetryAt: string | null;
  message: string | null;
  servingLastKnownGood: boolean;
}

export interface RecordSetResult extends RecordSetContract {
  present: boolean;
  returnedRecords: number;
  usableRecords: number;
  unusableRecords: number;
  staleRecords: number;
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
    usableRecords: number;
    unusableRecords: number;
    staleRecords: number;
  };
  providerStatuses: NormalizedProviderStatus[];
  activeFallback: string | null;
  configuredFallback: string | null;
  messages: string[];
}

const capabilityById = new Map(SOURCE_CAPABILITIES.map((capability) => [capability.id, capability]));

const DEFAULT_MAX_FRESHNESS_MS = 2 * 60 * 60 * 1000;

const MAX_FRESHNESS_MS_BY_ID: Record<string, number> = {
  earthquakes: 30 * 60 * 1000,
  news: 2 * 60 * 60 * 1000,
  weather: 30 * 60 * 1000,
  fires: 30 * 60 * 1000,
  flights: 10 * 60 * 1000,
  satellites: 2 * 60 * 60 * 1000,
  markets: 30 * 60 * 1000,
  'space-weather': 30 * 60 * 1000,
};

const EARTHQUAKE_OBSERVATION_MAX_AGE_MS = 30 * 60 * 60 * 1000;

const CONTRACTS: SourceContract[] = [
  required('earthquakes', [
    records('earthquakes', ['earthquakes'], 'observation', true, 'USGS earthquake observations', true, ['lat', 'lng'], {
      allowEmpty: true,
      timestampFields: ['observedAt', 'time', 'integrity.timing.observedAt'],
      maxRecordAgeMs: EARTHQUAKE_OBSERVATION_MAX_AGE_MS,
    }),
  ], { allowSchemaValidEmpty: true }),
  required('news', [
    records('news', ['news'], 'report', true, 'RSS/Telegram source reports', true, ['title', 'source']),
  ]),
  required('weather', [
    records('weather_events', ['events', 'weather_events'], 'observation', true, 'NWS/EONET weather events', true, ['id', 'title']),
  ]),
  required('fires', [
    records('fires', ['fires'], 'observation', true, 'FIRMS/EONET fire and volcano observations', true, ['id', 'lat', 'lng', 'type']),
    records('events', ['events'], 'report', false, 'Supplemental event reports', false, ['id']),
  ]),
  report('gdelt', [
    records('events', ['events'], 'report', true, 'GDELT geolocated media mentions', true, ['lat', 'lng']),
  ]),
  required('flights', [
    records('commercial_flights', ['commercial_flights'], 'observation', true, 'Commercial aircraft observations', false, ['callsign', 'lat', 'lng']),
    records('military_flights', ['military_flights'], 'observation', true, 'Military aircraft observations', false, ['callsign', 'lat', 'lng']),
    records('private_flights', ['private_flights'], 'observation', true, 'Private aircraft observations', false, ['callsign', 'lat', 'lng']),
    records('private_jets', ['private_jets'], 'observation', true, 'Private jet observations', false, ['callsign', 'lat', 'lng']),
  ], { minUsableRecords: 1 }),
  required('satellites', [
    records('satellites', ['satellites'], 'observation', true, 'Propagated real TLE satellite positions', true, ['name', 'lat', 'lng', 'noradId']),
  ]),
  optional('maritime', [
    records('ships', ['ships'], 'observation', true, 'Live vessel observations', false, ['lat', 'lng']),
    records('ports', ['ports'], 'reference', false, 'Reference port records', true, ['name']),
    records('chokepoints', ['chokepoints'], 'reference', false, 'Reference chokepoint records', true, ['name']),
  ]),
  report('cctv', [
    records('cameras', ['cameras'], 'reference', false, 'Public traffic camera catalog records', true, ['name', 'lat', 'lng']),
  ]),
  report('live-news', [
    records('feeds', ['feeds'], 'reference', false, 'Curated live broadcast links', true, ['name', 'url']),
  ]),
  report('surveillance-capabilities', [
    records('locations', ['locations'], 'reference', false, 'Aggregated surveillance capability location references', true, ['lat', 'lng']),
    records('records', ['records'], 'reference', false, 'Source-derived surveillance capability records', false, ['id']),
    records('flight_paths', ['flight_paths'], 'reference', false, 'Historical surveillance flight path references', false, ['id']),
  ]),
  report('surveillance-industry', [
    records('locations', ['locations'], 'reference', false, 'Representative surveillance industry dossier locations', true, ['lat', 'lng']),
    records('dossiers', ['dossiers'], 'reference', false, 'Parsed Surveillance-Industry Markdown dossiers', false, ['id']),
  ]),
  report('odint-targets', [
    records('targets', ['targets'], 'reference', false, 'Parsed ODINT public domains, URLs, and API endpoint references', true, ['target']),
    records('summaries', ['summaries'], 'reference', false, 'ODINT source file inventory summaries', false, ['source_file']),
  ]),
  report('fed-rolodex', [
    records('intelligence_entities', ['intelligence_entities'], 'reference', false, 'Parsed FED intelligence agency and topic reference records', true, ['name', 'country']),
    records('cultural_centers', ['cultural_centers'], 'reference', false, 'Parsed FED cultural center reference records', true, ['name', 'country']),
    records('summaries', ['summaries'], 'reference', false, 'FED database source summaries', false, ['source_file']),
  ]),
  report('data-centers', [
    records('data_centers', ['data_centers'], 'reference', false, 'Coordinate-bearing Global Data Center Map records', false, ['lat', 'lng']),
    records('summaries', ['summaries'], 'reference', false, 'Global Data Center Map dataset summaries', true, ['source_file']),
  ]),
  required('markets', [
    objectRecords('stocks', ['stocks'], 'observation', true, 'Equity quote records', true, ['price'], { minUsableRecords: 1 }),
    objectRecords('oil', ['oil'], 'observation', true, 'Oil quote records', true, ['price'], { minUsableRecords: 1 }),
    objectRecords('commodities', ['commodities'], 'observation', true, 'Commodity quote records', true, ['price'], { minUsableRecords: 1 }),
    objectRecords('crypto', ['crypto'], 'observation', true, 'Crypto quote records', true, ['price'], { minUsableRecords: 1 }),
    objectRecords('indices', ['indices'], 'observation', true, 'Index quote records', true, ['price'], { minUsableRecords: 1 }),
  ]),
  required('space-weather', [
    scalarRecord('kp_index', ['kp_index'], 'observation', true, 'NOAA SWPC Kp index', true, { minUsableRecords: 1 }),
    records('alerts', ['alerts'], 'report', true, 'NOAA SWPC alerts', false, ['id']),
    records('solar_flares', ['solar_flares'], 'observation', true, 'NOAA SWPC flare records', false, ['class']),
  ]),
  report('cyber-threats', [
    records('threats', ['threats', 'vulnerabilities'], 'report', true, 'Cyber threat/vulnerability records', false, ['id']),
  ]),
  report('mac-vendor-lookup', [
    scalarRecord('vendor', ['vendor'], 'reference', false, 'MAC OUI vendor lookup result'),
    scalarRecord('oui', ['oui'], 'reference', false, 'Resolved OUI prefix'),
  ]),
];

export const SOURCE_CONTRACTS = CONTRACTS;
export const VERIFY_ROUTE_CONTRACTS = CONTRACTS.filter((contract) => contract.safeToProbe);
export const REQUIRED_CAPABILITY_IDS = CONTRACTS.filter((contract) => contract.requirement === 'required').map((contract) => contract.id);

interface ContractOptions {
  allowSchemaValidEmpty?: boolean;
  minUsableRecords?: number;
  maxFreshnessMs?: number;
}

interface RecordSetOptions {
  minUsableRecords?: number;
  allowEmpty?: boolean;
  maxRecordAgeMs?: number | null;
  timestampFields?: string[];
}

function required(id: string, recordSets: RecordSetContract[], options: ContractOptions = {}): SourceContract {
  return buildContract(id, 'required', recordSets, options);
}

function optional(id: string, recordSets: RecordSetContract[], options: ContractOptions = {}): SourceContract {
  return buildContract(id, 'optional', recordSets, options);
}

function report(id: string, recordSets: RecordSetContract[], options: ContractOptions = {}): SourceContract {
  return buildContract(id, 'report', recordSets, options);
}

function buildContract(id: string, requirement: RequirementLevel, recordSets: RecordSetContract[], options: ContractOptions = {}): SourceContract {
  const capability = capabilityById.get(id);
  if (!capability) throw new Error(`Missing source capability metadata for ${id}`);
  const requiredRecordSets = recordSets.filter((set) => set.required).length;
  return {
    id,
    label: capability.label,
    apiRoute: capability.apiRoute,
    requirement,
    recordSets,
    requireProviderStatus: true,
    allowSchemaValidEmpty: options.allowSchemaValidEmpty ?? requirement !== 'required',
    minUsableRecords: options.minUsableRecords ?? (requirement === 'required' && requiredRecordSets === 0 ? 1 : 0),
    maxFreshnessMs: options.maxFreshnessMs ?? MAX_FRESHNESS_MS_BY_ID[id] ?? DEFAULT_MAX_FRESHNESS_MS,
    safeToProbe: id !== 'scanner' && id !== 'mac-vendor-lookup' && id !== 'odint-targets' && id !== 'data-centers',
  };
}

function records(
  id: string,
  paths: string[],
  evidenceKind: EvidenceKind,
  liveObservation: boolean,
  description: string,
  requiredSet = true,
  usabilityFields: string[] = [],
  options: RecordSetOptions = {},
): RecordSetContract {
  return {
    id,
    paths,
    evidenceKind,
    liveObservation,
    required: requiredSet,
    description,
    usabilityFields,
    minUsableRecords: options.minUsableRecords ?? 0,
    allowEmpty: options.allowEmpty ?? true,
    maxRecordAgeMs: options.maxRecordAgeMs ?? null,
    timestampFields: options.timestampFields ?? [],
  };
}

function objectRecords(
  id: string,
  paths: string[],
  evidenceKind: EvidenceKind,
  liveObservation: boolean,
  description: string,
  requiredSet = true,
  usabilityFields: string[] = [],
  options: RecordSetOptions = {},
): RecordSetContract {
  return records(id, paths.map((path) => `${path}.*`), evidenceKind, liveObservation, description, requiredSet, usabilityFields, options);
}

function scalarRecord(
  id: string,
  paths: string[],
  evidenceKind: EvidenceKind,
  liveObservation: boolean,
  description: string,
  requiredSet = true,
  options: RecordSetOptions = {},
): RecordSetContract {
  return records(id, paths.map((path) => `${path}#scalar`), evidenceKind, liveObservation, description, requiredSet, [], options);
}

export function getSourceContract(id: string): SourceContract | undefined {
  return SOURCE_CONTRACTS.find((contract) => contract.id === id);
}

export function normalizeProviderStatuses(payload: unknown, options: { nowMs?: number; maxFreshnessMs?: number } = {}): NormalizedProviderStatus[] {
  if (!isRecord(payload)) return [];
  const nowMs = options.nowMs ?? Date.now();
  const maxFreshnessMs = options.maxFreshnessMs ?? DEFAULT_MAX_FRESHNESS_MS;
  const raw = Array.isArray(payload.status)
    ? payload.status
    : Array.isArray(payload.source_status)
      ? payload.source_status
      : [];
  return raw.filter(isRecord).map((status) => {
    const source = isRecord(status.source) ? status.source : null;
    const acceptedRecords = numberField(status.acceptedRecords) ?? numberField(status.accepted) ?? 0;
    const lastAttemptAt = stringField(status.lastAttemptAt);
    const lastSuccessfulFetchAt = stringField(status.lastSuccessfulFetchAt);
    const nextRetryAt = stringField(status.nextRetryAt);
    const reportedFreshness = stringField(status.freshness);
    const successAgeMs = ageMs(lastSuccessfulFetchAt, nowMs);
    const attemptAgeMs = ageMs(lastAttemptAt, nowMs);
    const fetchAgeMs = successAgeMs ?? attemptAgeMs;
    const freshness = status.servingLastKnownGood
      ? 'stale'
      : reportedFreshness === 'fresh' && fetchAgeMs === null
        ? 'unknown'
        : reportedFreshness === 'fresh' && fetchAgeMs !== null && fetchAgeMs > maxFreshnessMs
          ? 'stale'
          : reportedFreshness;
    return {
      providerId: stringField(source?.providerId) ?? stringField(status.providerId) ?? stringField(status.provider) ?? 'unknown-provider',
      providerName: stringField(source?.providerName) ?? stringField(status.provider) ?? null,
      availability: stringField(status.availability),
      dataState: stringField(status.dataState),
      freshness,
      acceptedRecords,
      rejectedRecords: numberField(status.rejectedRecords) ?? 0,
      receivedRecords: numberField(status.receivedRecords) ?? numberField(status.received) ?? acceptedRecords,
      lastAttemptAt,
      lastSuccessfulFetchAt,
      nextRetryAt,
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
  nowMs?: number;
}): CapabilityEvaluation {
  const { contract, httpStatus, contentType, payload, parseError, env, renderingChecked = false, nowMs } = args;
  const capability = capabilityById.get(contract.id);
  const configuration = capability ? sourceConfigurationState(capability, env) : 'not_configured';
  const messages: string[] = [];
  const httpOk = typeof httpStatus === 'number' && httpStatus >= 200 && httpStatus < 300;
  if (!httpOk) messages.push(`Route returned HTTP ${httpStatus ?? 'unreached'}.`);
  if (parseError) messages.push(`Response was not valid JSON: ${parseError}`);
  if (!isJsonContent(contentType)) messages.push(`Unexpected content type: ${contentType || 'missing'}.`);
  if (!isRecord(payload)) messages.push('Payload must be a JSON object.');

  const recordSets = contract.recordSets.map((recordSet) => {
    const counts = recordSet.paths.map((path) => countPath(payload, path, recordSet, nowMs ?? Date.now()));
    const present = counts.some((count) => count.present);
    const returnedRecords = counts.reduce((sum, count) => sum + count.count, 0);
    const usableRecords = counts.reduce((sum, count) => sum + count.usable, 0);
    const unusableRecords = counts.reduce((sum, count) => sum + count.unusable, 0);
    const staleRecords = counts.reduce((sum, count) => sum + count.stale, 0);
    return {
      ...recordSet,
      present,
      returnedRecords,
      usableRecords,
      unusableRecords,
      staleRecords,
    };
  });
  const missingRequiredSets = recordSets.filter((set) => set.required && !set.present);
  for (const set of missingRequiredSets) messages.push(`Missing required record set: ${set.id}.`);
  const undercoveredRequiredSets = recordSets.filter((set) => set.required && set.minUsableRecords > 0 && set.usableRecords < set.minUsableRecords);
  for (const set of undercoveredRequiredSets) messages.push(`Required record set ${set.id} returned ${set.usableRecords} usable record(s), below the minimum of ${set.minUsableRecords}.`);
  const unusableRecordSets = recordSets.filter((set) => set.present && set.returnedRecords > 0 && set.usabilityFields.length > 0 && set.usableRecords === 0 && set.staleRecords === 0);
  for (const set of unusableRecordSets) messages.push(`Record set ${set.id} contained ${set.returnedRecords} record(s), but none satisfied usability fields: ${set.usabilityFields.join(', ')}.`);
  const partiallyUnusableRecordSets = recordSets.filter((set) => set.unusableRecords > 0 && set.usableRecords > 0);
  for (const set of partiallyUnusableRecordSets) messages.push(`Record set ${set.id} contained ${set.unusableRecords} unusable record(s).`);
  const staleRecordSets = recordSets.filter((set) => set.staleRecords > 0);
  for (const set of staleRecordSets) messages.push(`Record set ${set.id} contained ${set.staleRecords} expired record(s).`);

  const providerStatuses = normalizeProviderStatuses(payload, { nowMs, maxFreshnessMs: contract.maxFreshnessMs });
  if (contract.requireProviderStatus && providerStatuses.length === 0) {
    messages.push('No provider status array was reported.');
  }

  const counts = summarizeCounts(recordSets, providerStatuses);
  const statusProblems = providerStatusProblems(providerStatuses, counts, contract, nowMs ?? Date.now());
  messages.push(...statusProblems);
  if (!contract.allowSchemaValidEmpty && counts.usableRecords < Math.max(1, contract.minUsableRecords)) {
    messages.push(`Required capability returned ${counts.usableRecords} usable record(s), below the minimum of ${Math.max(1, contract.minUsableRecords)}.`);
  }
  const activeFallback = providerStatuses.some((status) => status.servingLastKnownGood) ? 'last-known-good' : null;
  const configuredFallback = capability?.fallback ?? null;
  const providerAvailability = summarizeProviderAvailability(providerStatuses);
  const dataState = summarizeDataState(providerStatuses, counts, contract, statusProblems.length > 0 || undercoveredRequiredSets.length > 0);
  const freshness = summarizeFreshness(providerStatuses, contract.requirement);
  const configurationOutcome: StageOutcome = configuration === 'not_configured'
    ? contract.requirement === 'required' ? 'failed' : 'not_configured'
    : 'passed';
  const payloadContract: StageOutcome = httpOk &&
    !parseError &&
    isJsonContent(contentType) &&
    isRecord(payload) &&
    missingRequiredSets.length === 0 &&
    undercoveredRequiredSets.length === 0 &&
    (contract.requirement !== 'required' || (unusableRecordSets.length === 0 && staleRecordSets.length === 0))
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
    stages.dataState === 'failed' ||
    stages.freshness === 'failed';
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
    .reduce((sum, set) => sum + set.usableRecords, 0);
  return {
    returnedRecords: recordSets.reduce((sum, set) => sum + set.returnedRecords, 0),
    liveObservations: recordSets.filter((set) => set.liveObservation).reduce((sum, set) => sum + set.usableRecords, 0),
    reports: byKind('report'),
    references: byKind('reference'),
    providerAcceptedRecords: statuses.reduce((sum, status) => sum + status.acceptedRecords, 0),
    providerRejectedRecords: statuses.reduce((sum, status) => sum + status.rejectedRecords, 0),
    providerReceivedRecords: statuses.reduce((sum, status) => sum + status.receivedRecords, 0),
    usableRecords: recordSets.reduce((sum, set) => sum + set.usableRecords, 0),
    unusableRecords: recordSets.reduce((sum, set) => sum + set.unusableRecords, 0),
    staleRecords: recordSets.reduce((sum, set) => sum + set.staleRecords, 0),
  };
}

function summarizeProviderAvailability(statuses: NormalizedProviderStatus[]): StageOutcome {
  if (statuses.length === 0) return 'failed';
  const configured = statuses.filter((status) => status.availability !== 'not_configured');
  if (configured.length === 0) return 'not_configured';
  const anyCollected = configured.some((status) => status.availability === 'ok' || status.availability === 'partial');
  const anyUnavailable = configured.some((status) => status.availability === 'error' || status.availability === 'rate_limited');
  if (anyCollected) {
    if (anyUnavailable) return 'warning';
    return 'passed';
  }
  return 'failed';
}

function summarizeDataState(statuses: NormalizedProviderStatus[], counts: CapabilityEvaluation['counts'], contract: SourceContract, hasStatusProblems: boolean): StageOutcome {
  if (statuses.length === 0) return 'failed';
  if (hasStatusProblems) return contract.requirement === 'required' ? 'failed' : 'warning';
  if (contract.requirement === 'required' && counts.unusableRecords > 0) return 'failed';
  if (!contract.allowSchemaValidEmpty && counts.usableRecords < Math.max(1, contract.minUsableRecords)) return 'failed';
  if (statuses.some((status) => status.dataState === 'present')) return counts.usableRecords > 0 ? 'passed' : 'failed';
  if (statuses.some((status) => status.dataState === 'empty')) return contract.allowSchemaValidEmpty ? 'passed' : 'failed';
  if (statuses.every((status) => status.availability === 'not_configured')) return 'not_configured';
  return 'failed';
}

function summarizeFreshness(statuses: NormalizedProviderStatus[], requirement: RequirementLevel): StageOutcome {
  if (statuses.length === 0) return requirement === 'required' ? 'failed' : 'not_checked';
  const relevant = statuses.filter((status) => status.availability !== 'not_configured');
  if (relevant.length === 0) return 'not_configured';
  if (relevant.some((status) => status.freshness === 'fresh')) {
    return relevant.some((status) => status.freshness === 'stale' || status.servingLastKnownGood) ? 'warning' : 'passed';
  }
  if (relevant.some((status) => status.servingLastKnownGood || status.freshness === 'stale')) {
    return requirement === 'required' ? 'failed' : 'warning';
  }
  return requirement === 'required' ? 'failed' : 'not_checked';
}

function providerStatusProblems(statuses: NormalizedProviderStatus[], counts: CapabilityEvaluation['counts'], contract: SourceContract, nowMs: number): string[] {
  const problems: string[] = [];
  for (const status of statuses) {
    const label = status.providerId;
    const needsSuccessTimestamp = contract.requirement === 'required' &&
      (status.availability === 'ok' || status.availability === 'partial') &&
      (status.dataState === 'present' || status.dataState === 'empty');
    if (needsSuccessTimestamp && ageMs(status.lastSuccessfulFetchAt, nowMs) === null) {
      problems.push(`Provider ${label} reported successful ${status.dataState} data without a valid lastSuccessfulFetchAt timestamp.`);
    }
    if (status.dataState === 'present' && status.acceptedRecords <= 0) {
      problems.push(`Provider ${label} reported present data with zero accepted records.`);
    }
    if ((status.availability === 'ok' || status.availability === 'partial') && status.dataState === 'unavailable') {
      problems.push(`Provider ${label} reported ${status.availability} availability with unavailable data.`);
    }
    if (status.dataState === 'empty' && status.acceptedRecords > 0) {
      problems.push(`Provider ${label} reported empty data with ${status.acceptedRecords} accepted records.`);
    }
    if (status.rejectedRecords > 0 && status.acceptedRecords === 0 && status.dataState === 'present') {
      problems.push(`Provider ${label} reported present data, but every received record was rejected.`);
    }
  }
  if (statuses.some((status) => status.dataState === 'present' || status.acceptedRecords > 0) && counts.usableRecords === 0) {
    problems.push('Provider status reported usable data, but the payload exposed no usable contract records.');
  }
  return problems;
}

function countPath(payload: unknown, path: string, contract: RecordSetContract, nowMs: number): { present: boolean; count: number; usable: number; unusable: number; stale: number } {
  if (!isRecord(payload)) return { present: false, count: 0, usable: 0, unusable: 0, stale: 0 };
  if (path.endsWith('.*')) {
    const value = getPath(payload, path.slice(0, -2));
    if (!isRecord(value)) return { present: false, count: 0, usable: 0, unusable: 0, stale: 0 };
    const entries = Object.values(value);
    return summarizeRecordUsability(entries.map((entry) => assessRecordUsability(entry, contract, nowMs)));
  }
  if (path.endsWith('#scalar')) {
    const value = getPath(payload, path.slice(0, -7));
    const present = value !== undefined;
    const usable = present && isUsableValue(value, path.slice(0, -7)) ? 1 : 0;
    return { present, count: usable, usable, unusable: present && usable === 0 ? 1 : 0, stale: 0 };
  }
  const value = getPath(payload, path);
  if (!Array.isArray(value)) return { present: false, count: 0, usable: 0, unusable: 0, stale: 0 };
  return summarizeRecordUsability(value.map((record) => assessRecordUsability(record, contract, nowMs)));
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

function summarizeRecordUsability(results: Array<'usable' | 'unusable' | 'stale'>): { present: boolean; count: number; usable: number; unusable: number; stale: number } {
  const usable = results.filter((result) => result === 'usable').length;
  const stale = results.filter((result) => result === 'stale').length;
  const unusable = results.length - usable;
  return { present: true, count: results.length, usable, unusable, stale };
}

function assessRecordUsability(value: unknown, contract: RecordSetContract, nowMs: number): 'usable' | 'unusable' | 'stale' {
  if (!hasUsableFields(value, contract.usabilityFields)) return 'unusable';
  if (isExpiredRecord(value, contract, nowMs)) return 'stale';
  return 'usable';
}

function hasUsableFields(value: unknown, fields: string[]): boolean {
  if (fields.length === 0) return value !== null && value !== undefined;
  if (!isRecord(value)) return false;
  return fields.every((field) => isUsableValue(getPath(value, field), field));
}

function isUsableValue(value: unknown, fieldHint: string): boolean {
  const field = fieldHint.split('.').pop()?.toLowerCase() ?? fieldHint.toLowerCase();
  if (field === 'lat' || field === 'latitude') return typeof value === 'number' && Number.isFinite(value) && value >= -90 && value <= 90;
  if (field === 'lng' || field === 'lon' || field === 'longitude') return typeof value === 'number' && Number.isFinite(value) && value >= -180 && value <= 180;
  if (field === 'price' || field === 'kp_index') return typeof value === 'number' && Number.isFinite(value);
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value) && typeof value === 'object';
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numberField(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function ageMs(value: string | null, nowMs: number): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed - nowMs > 5 * 60 * 1000) return null;
  return Math.max(0, nowMs - parsed);
}

function isExpiredRecord(value: unknown, contract: RecordSetContract, nowMs: number): boolean {
  if (contract.maxRecordAgeMs === null || contract.timestampFields.length === 0) return false;
  if (!isRecord(value)) return true;
  const ages = contract.timestampFields
    .map((field) => timestampAgeMs(getPath(value, field), nowMs))
    .filter((age): age is number => age !== null);
  if (ages.length === 0) return true;
  return Math.min(...ages) > contract.maxRecordAgeMs;
}

function timestampAgeMs(value: unknown, nowMs: number): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value - nowMs > 5 * 60 * 1000) return null;
    return Math.max(0, nowMs - value);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed) || parsed - nowMs > 5 * 60 * 1000) return null;
    return Math.max(0, nowMs - parsed);
  }
  return null;
}
