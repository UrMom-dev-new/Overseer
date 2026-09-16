import {
  buildMetadata,
  clampText,
  collectionStatus,
  finiteNumber,
  isValidLngLat,
  parseDateOrNull,
  pointGeometry,
  safeUrl,
  sourceIdentity,
  stableId,
} from './helpers';
import type { IntegrityMetadata, LocationPrecision, SourceCollectionStatus } from './types';

export type SurveillanceSourceCategory = 'eff_atlas' | 'federal_contract' | 'federal_grant' | 'dod_1033';

export interface SurveillanceCapabilityRecord {
  id: string;
  city: string | null;
  state: string;
  agency: string;
  technology: string;
  vendor: string | null;
  description: string;
  amount: number | null;
  source_category: SurveillanceSourceCategory;
  source_label: string;
  source_url: string;
  record_url: string | null;
  published_at: string | null;
  lat: number | null;
  lng: number | null;
  location_precision: LocationPrecision;
  evidence_kind: 'reference';
  integrity: IntegrityMetadata;
}

export interface SurveillanceCapabilityLocation {
  id: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  location_precision: LocationPrecision;
  location_note: string;
  total_records: number;
  total_amount: number;
  dominant_technology: string;
  technology_counts: Record<string, number>;
  source_counts: Record<string, number>;
  agencies: string[];
  evidence_kind: 'reference';
}

export interface SurveillanceFlightPath {
  id: string;
  agency: string;
  name: string;
  n_number: string | null;
  path: [number, number][];
  point_count: number;
  avg_altitude: number | null;
  avg_speed: number | null;
  start_time: string | null;
  end_time: string | null;
  source_label: string;
  evidence_kind: 'reference';
  integrity: IntegrityMetadata;
}

export interface SurveillanceNormalizeInput {
  atlasCsv?: string | null;
  contractsCsv?: string | null;
  grantsCsv?: string | null;
  transfersCsv?: string | null;
  cityCoordsJson?: string | null;
  flightPathsJson?: string | null;
  collectedAt: string;
  maxRecords?: number;
  maxLocations?: number;
  maxFlights?: number;
}

export interface SurveillanceNormalizeResult {
  records: SurveillanceCapabilityRecord[];
  locations: SurveillanceCapabilityLocation[];
  flightPaths: SurveillanceFlightPath[];
  statuses: SourceCollectionStatus[];
  counts: {
    receivedRecords: number;
    acceptedRecords: number;
    rejectedRecords: number;
    returnedRecords: number;
    returnedLocations: number;
    returnedFlightPaths: number;
  };
}

const SOURCE_REPO = 'https://github.com/Ringmast4r/surveillance-capabilities-map';
const EFF_SOURCE_URL = `${SOURCE_REPO}/blob/main/atlas-of-surveillance.csv`;
const CONTRACTS_SOURCE_URL = `${SOURCE_REPO}/blob/main/surveillance-contracts.csv`;
const GRANTS_SOURCE_URL = `${SOURCE_REPO}/blob/main/surveillance-grants.csv`;
const TRANSFERS_SOURCE_URL = `${SOURCE_REPO}/blob/main/wapo-1033-data.csv`;
const FLIGHTS_SOURCE_URL = `${SOURCE_REPO}/blob/main/flight_paths.json`;
const CITY_COORDS_SOURCE_URL = `${SOURCE_REPO}/blob/main/city_coords.json`;

const EFF_TECH_MAP: Record<string, string> = {
  'Body-worn Cameras': 'Body Cameras',
  'Automated License Plate Readers': 'License Plate Readers',
  'Face Recognition': 'Facial Recognition',
  Drones: 'Drones/UAV',
  'Gunshot Detection': 'Gunshot Detection',
  'Cell-site Simulator': 'Cell Site Simulators',
  'Predictive Policing': 'Predictive Policing',
  'Real-Time Crime Center': 'Real-Time Crime Centers',
  'Third-party Investigative Platforms': 'Third-party Investigative Platforms',
  'Camera Registry': 'Camera Registry',
  'Video Analytics': 'Video Analytics',
  'Fusion Center': 'Fusion Center',
};

const TECH_KEYWORDS: Array<[string, RegExp]> = [
  ['License Plate Readers', /\b(alpr|lpr|license plate|automatic license|flock)\b/i],
  ['Facial Recognition', /\b(face recognition|facial recognition|clearview|nec)\b/i],
  ['Drones/UAV', /\b(drone|uav|unmanned aerial|quadcopters?)\b/i],
  ['Gunshot Detection', /\b(shotspotter|soundthinking|gunshot|acoustic sensor)\b/i],
  ['Cell Site Simulators', /\b(stingray|hailstorm|cell[- ]?site|imsi catcher)\b/i],
  ['Third-party Investigative Platforms', /\b(palantir|babel street|lexisnexis|thomson reuters|investigative platform)\b/i],
  ['Camera Registry', /\b(camera registry|fusus|ring)\b/i],
  ['Video Analytics', /\b(video analytic|briefcam|verkada|camera feed|security-camera)\b/i],
  ['Fusion Center', /\b(fusion center|information sharing)\b/i],
  ['Real-Time Crime Centers', /\b(real[- ]?time crime|rtcc|command center)\b/i],
  ['Predictive Policing', /\b(predictive policing|predpol|hunchlab)\b/i],
  ['Social Media Monitoring', /\b(social media|geofeedia|media sonar)\b/i],
  ['Phone Forensics', /\b(cellebrite|graykey|mobile forensics|phone forensic)\b/i],
  ['Night Vision/Thermal', /\b(night vision|thermal|flir|infrared)\b/i],
  ['Military Vehicles', /\b(mrap|armored|mine resistant|tactical vehicle)\b/i],
  ['Aircraft', /\b(aircraft|helicopter|fixed-wing|aviation)\b/i],
  ['Body Cameras', /\b(body camera|body-worn|axon|watchguard)\b/i],
];

const STATE_CENTROIDS: Record<string, [number, number]> = {
  AL: [32.806671, -86.79113], AK: [61.370716, -152.404419], AZ: [33.729759, -111.431221],
  AR: [34.969704, -92.373123], CA: [36.116203, -119.681564], CO: [39.059811, -105.311104],
  CT: [41.597782, -72.755371], DE: [39.318523, -75.507141], FL: [27.766279, -81.686783],
  GA: [33.040619, -83.643074], HI: [21.094318, -157.498337], ID: [44.240459, -114.478828],
  IL: [40.349457, -88.986137], IN: [39.849426, -86.258278], IA: [42.011539, -93.210526],
  KS: [38.5266, -96.726486], KY: [37.66814, -84.670067], LA: [31.169546, -91.867805],
  ME: [44.693947, -69.381927], MD: [39.063946, -76.802101], MA: [42.230171, -71.530106],
  MI: [43.326618, -84.536095], MN: [45.694454, -93.900192], MS: [32.741646, -89.678696],
  MO: [38.456085, -92.288368], MT: [46.921925, -110.454353], NE: [41.12537, -98.268082],
  NV: [38.313515, -117.055374], NH: [43.452492, -71.563896], NJ: [40.298904, -74.521011],
  NM: [34.840515, -106.248482], NY: [42.165726, -74.948051], NC: [35.630066, -79.806419],
  ND: [47.528912, -99.784012], OH: [40.388783, -82.764915], OK: [35.565342, -96.928917],
  OR: [44.572021, -122.070938], PA: [40.590752, -77.209755], RI: [41.680893, -71.51178],
  SC: [33.856892, -80.945007], SD: [44.299782, -99.438828], TN: [35.747845, -86.692345],
  TX: [31.054487, -97.563461], UT: [40.150032, -111.862434], VT: [44.045876, -72.710686],
  VA: [37.769337, -78.169968], WA: [47.400902, -121.490494], WV: [38.491226, -80.954453],
  WI: [44.268543, -89.616508], WY: [42.755966, -107.30249], DC: [38.897438, -77.026817],
  PR: [18.220833, -66.590149], GU: [13.444304, 144.793731], VI: [18.335765, -64.896335],
};

type CsvRow = Record<string, string>;
type CityCoords = Record<string, [number, number]>;

export function parseCsv(csv: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    const next = csv[i + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...body] = rows;
  if (!header) return [];
  return body
    .filter((values) => values.some((value) => value.trim() !== ''))
    .map((values) => Object.fromEntries(header.map((name, index) => [name, values[index] ?? ''])));
}

export function classifySurveillanceTechnology(value: unknown, fallback?: unknown): string {
  const primary = typeof value === 'string' ? value.trim() : '';
  if (primary && EFF_TECH_MAP[primary]) return EFF_TECH_MAP[primary];
  const combined = `${primary} ${typeof fallback === 'string' ? fallback : ''}`;
  for (const [label, pattern] of TECH_KEYWORDS) {
    if (pattern.test(combined)) return label;
  }
  return primary || 'Other Surveillance Technology';
}

export function normalizeSurveillanceCapabilities(input: SurveillanceNormalizeInput): SurveillanceNormalizeResult {
  const maxRecords = positiveInt(input.maxRecords, 5000);
  const maxLocations = positiveInt(input.maxLocations, 2500);
  const maxFlights = positiveInt(input.maxFlights, 250);
  const cityCoords = parseCityCoords(input.cityCoordsJson);
  const records: SurveillanceCapabilityRecord[] = [];
  const statuses: SourceCollectionStatus[] = [];
  let receivedRecords = 0;
  let rejectedRecords = 0;

  const addRows = (rows: CsvRow[], sourceStatus: SourceCollectionStatus, normalize: (row: CsvRow) => SurveillanceCapabilityRecord | null) => {
    receivedRecords += rows.length;
    let accepted = 0;
    let rejected = 0;
    for (const row of rows) {
      const record = normalize(row);
      if (record) {
        records.push(record);
        accepted++;
      } else {
        rejected++;
      }
    }
    rejectedRecords += rejected;
    statuses.push({
      ...sourceStatus,
      receivedRecords: rows.length,
      acceptedRecords: accepted,
      rejectedRecords: rejected,
      dataState: accepted > 0 ? 'present' : 'empty',
    });
  };

  if (input.atlasCsv) {
    addRows(parseCsv(input.atlasCsv), baseStatus('surveillance-capabilities-map:atlas', 'EFF Atlas via Surveillance Capabilities Map', EFF_SOURCE_URL, input.collectedAt), (row) =>
      normalizeAtlasRecord(row, cityCoords, input.collectedAt)
    );
  }
  if (input.contractsCsv) {
    addRows(parseCsv(input.contractsCsv), baseStatus('surveillance-capabilities-map:contracts', 'USASpending contracts via Surveillance Capabilities Map', CONTRACTS_SOURCE_URL, input.collectedAt), (row) =>
      normalizeAwardRecord(row, cityCoords, input.collectedAt, 'federal_contract')
    );
  }
  if (input.grantsCsv) {
    addRows(parseCsv(input.grantsCsv), baseStatus('surveillance-capabilities-map:grants', 'USASpending grants via Surveillance Capabilities Map', GRANTS_SOURCE_URL, input.collectedAt), (row) =>
      normalizeAwardRecord(row, cityCoords, input.collectedAt, 'federal_grant')
    );
  }
  if (input.transfersCsv) {
    addRows(parseCsv(input.transfersCsv), baseStatus('surveillance-capabilities-map:1033', 'Washington Post 1033 data via Surveillance Capabilities Map', TRANSFERS_SOURCE_URL, input.collectedAt), (row) =>
      normalizeTransferRecord(row, input.collectedAt)
    );
  }

  const flightPaths = normalizeFlightPaths(input.flightPathsJson, input.collectedAt)
    .slice(0, maxFlights);
  if (input.flightPathsJson) {
    statuses.push({
      ...baseStatus('surveillance-capabilities-map:flight-paths', 'BuzzFeed surveillance flight paths via Surveillance Capabilities Map', FLIGHTS_SOURCE_URL, input.collectedAt),
      receivedRecords: countFlightPayload(input.flightPathsJson),
      acceptedRecords: flightPaths.length,
      rejectedRecords: 0,
      dataState: flightPaths.length > 0 ? 'present' : 'empty',
    });
  }
  if (input.cityCoordsJson) {
    statuses.push({
      ...baseStatus('surveillance-capabilities-map:city-coords', 'City coordinates via Surveillance Capabilities Map', CITY_COORDS_SOURCE_URL, input.collectedAt),
      receivedRecords: Object.keys(cityCoords).length,
      acceptedRecords: Object.keys(cityCoords).length,
      rejectedRecords: 0,
      dataState: Object.keys(cityCoords).length > 0 ? 'present' : 'empty',
    });
  }

  const locations = aggregateLocations(records)
    .sort((a, b) => b.total_records - a.total_records)
    .slice(0, maxLocations);

  return {
    records: records.slice(0, maxRecords),
    locations,
    flightPaths,
    statuses,
    counts: {
      receivedRecords,
      acceptedRecords: records.length,
      rejectedRecords,
      returnedRecords: Math.min(records.length, maxRecords),
      returnedLocations: locations.length,
      returnedFlightPaths: flightPaths.length,
    },
  };
}

function normalizeAtlasRecord(row: CsvRow, cityCoords: CityCoords, collectedAt: string): SurveillanceCapabilityRecord | null {
  const city = clean(row.City);
  const state = cleanState(row.State);
  const agency = clean(row.Agency);
  if (!city || !state || !agency) return null;
  const technology = classifySurveillanceTechnology(row.Technology, row.Summary);
  const link = firstSafeUrl(row['Link 1'], row['Link 2'], row['Link 3']);
  const date = parseDateOrNull(row['Link 1 Date']) ?? parseDateOrNull(row['Link 2 Date']) ?? parseDateOrNull(row['Link 3 Date']);
  return buildRecord({
    upstreamId: clean(row.AOSNUMBER) || clean(row['NEWAOSNUMBER (ORI9)']),
    city,
    state,
    agency,
    technology,
    vendor: clean(row.Vendor),
    description: clampText(row.Summary, 600),
    amount: null,
    sourceCategory: 'eff_atlas',
    sourceLabel: 'EFF Atlas of Surveillance',
    sourceUrl: EFF_SOURCE_URL,
    recordUrl: link,
    publishedAt: date,
    cityCoords,
    collectedAt,
  });
}

function normalizeAwardRecord(row: CsvRow, cityCoords: CityCoords, collectedAt: string, category: 'federal_contract' | 'federal_grant'): SurveillanceCapabilityRecord | null {
  const city = titleCase(clean(row.recipient_city_name));
  const state = cleanState(row.recipient_state_code);
  const agency = clean(row.recipient_name);
  const description = clampText(row.award_description || row.product_or_service_code_description || row.assistance_listing_title, 700);
  if (!city || !state || !agency || !description) return null;
  const amount = finiteNumber(row.federal_action_obligation);
  return buildRecord({
    upstreamId: stableId(category, [city, state, agency, description, amount, row.action_date]),
    city,
    state,
    agency,
    technology: classifySurveillanceTechnology(description),
    vendor: agency,
    description,
    amount,
    sourceCategory: category,
    sourceLabel: category === 'federal_contract' ? 'USASpending surveillance contract' : 'USASpending surveillance grant',
    sourceUrl: category === 'federal_contract' ? CONTRACTS_SOURCE_URL : GRANTS_SOURCE_URL,
    recordUrl: null,
    publishedAt: parseDateOrNull(row.action_date),
    cityCoords,
    collectedAt,
  });
}

function normalizeTransferRecord(row: CsvRow, collectedAt: string): SurveillanceCapabilityRecord | null {
  const state = cleanState(row.State);
  const agency = clean(row['Station Name (LEA)']);
  const item = clean(row['Item Name']);
  if (!state || !agency || !item) return null;
  const amount = finiteNumber(row.Cost) ?? finiteNumber(row['Acquisition Value']);
  const classifiedTechnology = classifySurveillanceTechnology(item);
  return buildRecord({
    upstreamId: stableId('dod-1033', [state, agency, row.NSN, item, row['Ship Date'], row.Quantity, amount]),
    city: null,
    state,
    agency,
    technology: classifiedTechnology === item ? 'Military Equipment Transfer' : classifiedTechnology,
    vendor: null,
    description: clampText(item, 500),
    amount,
    sourceCategory: 'dod_1033',
    sourceLabel: 'DoD 1033 military equipment transfer',
    sourceUrl: TRANSFERS_SOURCE_URL,
    recordUrl: null,
    publishedAt: parseDateOrNull(row['Ship Date']),
    cityCoords: {},
    collectedAt,
  });
}

function buildRecord(args: {
  upstreamId: string | null;
  city: string | null;
  state: string;
  agency: string;
  technology: string;
  vendor: string | null;
  description: string;
  amount: number | null;
  sourceCategory: SurveillanceSourceCategory;
  sourceLabel: string;
  sourceUrl: string;
  recordUrl: string | null;
  publishedAt: string | null;
  cityCoords: CityCoords;
  collectedAt: string;
}): SurveillanceCapabilityRecord {
  const location = resolveRecordLocation(args.city, args.state, args.cityCoords);
  const recordId = stableId('surv-cap', [
    args.sourceCategory,
    args.upstreamId,
    args.city,
    args.state,
    args.agency,
    args.technology,
    args.description,
  ]);
  return {
    id: recordId,
    city: args.city,
    state: args.state,
    agency: args.agency,
    technology: args.technology,
    vendor: args.vendor || null,
    description: args.description,
    amount: args.amount,
    source_category: args.sourceCategory,
    source_label: args.sourceLabel,
    source_url: args.sourceUrl,
    record_url: args.recordUrl,
    published_at: args.publishedAt,
    lat: location.lat,
    lng: location.lng,
    location_precision: location.precision,
    evidence_kind: 'reference',
    integrity: buildMetadata({
      recordId,
      upstreamId: args.upstreamId,
      source: sourceIdentity(`surveillance-capabilities-map:${args.sourceCategory}`, args.sourceLabel, args.sourceUrl),
      itemUrl: args.recordUrl ?? args.sourceUrl,
      originalPublisher: args.sourceLabel,
      evidenceKind: 'reference',
      verification: 'unassessed',
      methodology: location.note,
      timing: {
        publishedAt: args.publishedAt,
        collectedAt: args.collectedAt,
      },
      location: {
        geometry: location.lng !== null && location.lat !== null ? pointGeometry(location.lng, location.lat) : null,
        representativePoint: location.lng !== null && location.lat !== null ? [location.lng, location.lat] : null,
        precision: location.precision,
        relationship: args.city ? 'source_location' : 'mentioned_location',
        resolutionMethod: location.note,
        qualityFlags: location.precision === 'region' ? ['state_centroid'] : [],
      },
      evidenceReferences: [{ label: args.sourceLabel, url: args.sourceUrl }],
    }),
  };
}

function aggregateLocations(records: SurveillanceCapabilityRecord[]): SurveillanceCapabilityLocation[] {
  const groups = new Map<string, SurveillanceCapabilityLocation>();
  for (const record of records) {
    if (!isValidLngLat(record.lng, record.lat)) continue;
    const city = record.city || 'Statewide / unspecified city';
    const key = `${record.location_precision}:${city}:${record.state}`;
    const existing = groups.get(key) ?? {
      id: stableId('surv-loc', [key]),
      city,
      state: record.state,
      lat: record.lat!,
      lng: record.lng!,
      location_precision: record.location_precision,
      location_note: record.location_precision === 'city' ? 'City coordinate from source geocoder' : 'State centroid; source did not provide city coordinates',
      total_records: 0,
      total_amount: 0,
      dominant_technology: record.technology,
      technology_counts: {},
      source_counts: {},
      agencies: [],
      evidence_kind: 'reference',
    };
    existing.total_records++;
    existing.total_amount += record.amount ?? 0;
    existing.technology_counts[record.technology] = (existing.technology_counts[record.technology] ?? 0) + 1;
    existing.source_counts[record.source_label] = (existing.source_counts[record.source_label] ?? 0) + 1;
    if (record.agency && !existing.agencies.includes(record.agency) && existing.agencies.length < 8) existing.agencies.push(record.agency);
    existing.dominant_technology = Object.entries(existing.technology_counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? record.technology;
    groups.set(key, existing);
  }
  return Array.from(groups.values()).map((location) => ({
    ...location,
    technology_counts: topCounts(location.technology_counts, 12),
    source_counts: topCounts(location.source_counts, 6),
  }));
}

function topCounts(counts: Record<string, number>, limit: number): Record<string, number> {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, limit);
  const other = entries.slice(limit).reduce((sum, [, count]) => sum + count, 0);
  const result = Object.fromEntries(top);
  if (other > 0) result.Other = other;
  return result;
}

function normalizeFlightPaths(value: string | null | undefined, collectedAt: string): SurveillanceFlightPath[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const paths: SurveillanceFlightPath[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const raw = item as Record<string, unknown>;
      const rawPath = Array.isArray(raw.path) ? raw.path : [];
      const path = rawPath
        .filter((point): point is [number, number] => Array.isArray(point) && isValidLngLat(point[1], point[0]))
        .map((point) => [point[1], point[0]] as [number, number]);
      if (path.length < 2) continue;
      const id = stableId('surv-flight', [raw.id, raw.agency, raw.n_number, raw.start_time, raw.end_time]);
      paths.push({
        id,
        agency: clean(raw.agency) || 'Unknown',
        name: clean(raw.name) || 'Surveillance aircraft',
        n_number: clean(raw.n_number),
        path,
        point_count: finiteNumber(raw.point_count) ?? path.length,
        avg_altitude: finiteNumber(raw.avg_altitude),
        avg_speed: finiteNumber(raw.avg_speed),
        start_time: parseDateOrNull(raw.start_time),
        end_time: parseDateOrNull(raw.end_time),
        source_label: 'BuzzFeed surveillance flight paths',
        evidence_kind: 'reference',
        integrity: buildMetadata({
          recordId: id,
          upstreamId: clean(raw.id),
          source: sourceIdentity('surveillance-capabilities-map:flight-paths', 'BuzzFeed flight paths via Surveillance Capabilities Map', FLIGHTS_SOURCE_URL),
          itemUrl: FLIGHTS_SOURCE_URL,
          originalPublisher: 'BuzzFeed News',
          evidenceKind: 'reference',
          verification: 'unassessed',
          methodology: 'Historical flight-path dataset from the referenced source repository; not a current aircraft observation.',
          timing: {
            observedAt: parseDateOrNull(raw.start_time),
            publishedAt: parseDateOrNull(raw.end_time),
            collectedAt,
          },
          evidenceReferences: [{ label: 'Source repository flight_paths.json', url: FLIGHTS_SOURCE_URL }],
        }),
      });
    }
    return paths;
  } catch {
    return [];
  }
}

function parseCityCoords(value: string | null | undefined): CityCoords {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: CityCoords = {};
    for (const [key, coords] of Object.entries(parsed)) {
      if (!Array.isArray(coords) || coords.length < 2) continue;
      const lat = finiteNumber(coords[0]);
      const lng = finiteNumber(coords[1]);
      if (lat === null || lng === null || !isValidLngLat(lng, lat)) continue;
      result[normalizeLocationKey(key)] = [lat, lng];
    }
    return result;
  } catch {
    return {};
  }
}

function resolveRecordLocation(city: string | null, state: string, cityCoords: CityCoords): { lat: number | null; lng: number | null; precision: LocationPrecision; note: string | null } {
  if (city) {
    const cityHit = cityCoords[normalizeLocationKey(`${city},${state}`)];
    if (cityHit) return { lat: cityHit[0], lng: cityHit[1], precision: 'city', note: 'City coordinate from surveillance-capabilities-map city_coords.json' };
  }
  const stateHit = STATE_CENTROIDS[state];
  if (stateHit) return { lat: stateHit[0], lng: stateHit[1], precision: 'region', note: 'State centroid used because the source row did not include usable city coordinates' };
  return { lat: null, lng: null, precision: 'unknown', note: 'No usable source location' };
}

function baseStatus(providerId: string, providerName: string, feedUrl: string, collectedAt: string): SourceCollectionStatus {
  return collectionStatus({
    source: sourceIdentity(providerId, providerName, feedUrl),
    availability: 'ok',
    dataState: 'empty',
    freshness: 'fresh',
    lastAttemptAt: collectedAt,
    lastSuccessfulFetchAt: collectedAt,
  });
}

function firstSafeUrl(...values: unknown[]): string | null {
  for (const value of values) {
    const url = safeUrl(value);
    if (url) return url;
  }
  return null;
}

function countFlightPayload(value: string): number {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function clean(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text || null;
}

function cleanState(value: unknown): string {
  return (clean(value) || '').toUpperCase();
}

function normalizeLocationKey(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toUpperCase();
}

function titleCase(value: string | null): string | null {
  if (!value) return null;
  return value.toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function positiveInt(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value && value > 0 ? Math.floor(value) : fallback;
}
