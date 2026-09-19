export type PatternFormat =
  | 'webmap-ping'
  | 'timing-advance'
  | 'cdr'
  | 'data-session'
  | 'cdr-vce'
  | 'cdr-mx'
  | 'precision-location'
  | 'tower-survey'
  | 'cell-reference-dataset'
  | 'adtech'
  | 'generic'
  | 'unknown'
  | 'empty';

export type PatternEventKind = 'timing_advance' | 'cdr' | 'data_session' | 'precision_location' | 'generic';

export type PatternPeriod = 'day' | 'night' | 'unknown';

export type CellReferenceSource = 'carrier' | 'survey' | 'open-dataset' | 'unmapped';

export interface PatternSubject {
  name?: string;
  phone?: string;
  device?: string;
  imsi?: string;
  caseNumber?: string;
}

export interface PatternInputFile {
  name: string;
  ext?: string;
  text?: string;
  rows?: unknown[][];
}

export interface PatternSheetRows {
  headers: string[];
  rows: Array<Record<string, string>>;
}

export interface PatternIssue {
  file?: string;
  format?: PatternFormat;
  severity: 'info' | 'warning' | 'error';
  message: string;
}

export interface PatternFileSummary {
  name: string;
  format: PatternFormat;
  rowsSeen: number;
  recordsAccepted: number;
  recordsOmitted: number;
}

export interface PatternEvent {
  id: string;
  kind: PatternEventKind;
  lat: number | null;
  lon: number | null;
  dt: string;
  timestampMs: number | null;
  hour: number | null;
  period: PatternPeriod;
  azimuth: number | null;
  direction?: string;
  type?: string;
  dialed?: string;
  durationSec?: number | null;
  address?: string;
  city?: string;
  lac?: string;
  cid?: string;
  site?: string;
  sector?: string;
  mcc?: string;
  mnc?: string;
  geoSource?: CellReferenceSource | 'none';
  sourceFile: string;
  sourceIndex: number;
}

export interface SurveyObservation {
  id: string;
  mcc: string;
  mnc: string;
  lac: string;
  cid: string;
  radio: string;
  lat: number;
  lon: number;
  signal: number | null;
  bearing: number | null;
  time: string;
  sourceFile: string;
  sourceIndex: number;
}

export interface CellReference {
  id: string;
  key: string;
  mcc: string;
  mnc: string;
  lac: string;
  cid: string;
  radio: string;
  lat: number | null;
  lon: number | null;
  azimuth: number | null;
  rangeM: number | null;
  observationCount: number;
  confidence: number;
  source: CellReferenceSource;
  hits: number;
  address?: string;
}

export interface LocationCluster {
  id: string;
  lat: number;
  lon: number;
  count: number;
  day: number;
  night: number;
  addresses: string[];
  primaryPeriod: PatternPeriod;
}

export interface TimelineBucket {
  date: string;
  hour: number;
  count: number;
}

export interface ContactSummary {
  number: string;
  total: number;
  outgoing: number;
  incoming: number;
  totalDurationSec: number;
  byHour: number[];
  firstSeen: string | null;
  lastSeen: string | null;
}

export interface AdtechPing {
  id: string;
  deviceId: string;
  lat: number;
  lon: number;
  timestampMs: number;
  accuracyM: number | null;
  make?: string;
  model?: string;
  os?: string;
  ip?: string;
  idType?: string;
  sourceFile: string;
  sourceIndex: number;
}

export interface AdtechOverlap {
  id: string;
  deviceId: string;
  adTimestampMs: number;
  adLat: number;
  adLon: number;
  eventId: string;
  eventKind: PatternEventKind;
  eventDt: string;
  eventLat: number;
  eventLon: number;
  distanceM: number;
  deltaSec: number;
}

export interface AdtechCandidate {
  deviceId: string;
  hits: number;
  firstSeenMs: number;
  lastSeenMs: number;
  avgDistanceM: number;
  centroidLat: number;
  centroidLon: number;
  confidence: number;
  make?: string;
  model?: string;
  os?: string;
}

export interface PatternAnalysisOptions {
  timeZone?: string;
  overlapDistanceM?: number;
  overlapWindowSec?: number;
  overlapMinEvents?: number;
}

export interface PatternAnalysis {
  subject: PatternSubject;
  dateRange: string | null;
  files: PatternFileSummary[];
  issues: PatternIssue[];
  events: PatternEvent[];
  timingAdvance: PatternEvent[];
  cdr: PatternEvent[];
  sessions: PatternEvent[];
  survey: SurveyObservation[];
  cellReferences: CellReference[];
  locations: LocationCluster[];
  dayLocations: LocationCluster[];
  nightLocations: LocationCluster[];
  contacts: ContactSummary[];
  timeline: TimelineBucket[];
  adtech: {
    pings: AdtechPing[];
    overlaps: AdtechOverlap[];
    candidates: AdtechCandidate[];
  };
  stats: {
    totalFiles: number;
    acceptedFiles: number;
    totalRowsSeen: number;
    recordsAccepted: number;
    recordsOmitted: number;
    totalEvents: number;
    geocodedEvents: number;
    timingAdvanceHits: number;
    cdrEvents: number;
    dataSessions: number;
    towerReferences: number;
    unmappedCells: number;
    surveyObservations: number;
    openDatasetCells: number;
    adtechPings: number;
    adtechOverlaps: number;
    candidateDevices: number;
    enrichedEvents: number;
  };
}

interface DateParts {
  dt: string;
  timestampMs: number | null;
  hour: number | null;
  period: PatternPeriod;
}

interface ParsedVce {
  calls: MutablePatternEvent[];
  sites: VceSite[];
}

interface VceSite {
  mcc: string;
  mnc: string;
  lac: string;
  cid: string;
  lat: number;
  lon: number;
  azimuth: number | null;
  address: string;
}

type MutablePatternEvent = Omit<PatternEvent, 'id' | 'sourceFile' | 'sourceIndex'>;
type MutableSurveyObservation = Omit<SurveyObservation, 'id' | 'sourceFile' | 'sourceIndex'>;
type MutableAdtechPing = Omit<AdtechPing, 'id' | 'sourceFile' | 'sourceIndex'>;

const DEFAULT_TIME_ZONE = 'UTC';
const DEFAULT_OVERLAP_DISTANCE_M = 300;
const DEFAULT_OVERLAP_WINDOW_SEC = 30 * 60;
const DEFAULT_OVERLAP_MIN_EVENTS = 3;

function stableHash(parts: unknown[]): string {
  const input = parts.map((part) => {
    if (part == null) return '';
    if (typeof part === 'object') return JSON.stringify(part);
    return String(part);
  }).join('|');
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function stableId(prefix: string, parts: unknown[]): string {
  return `${prefix}-${stableHash(parts)}`;
}

function cleanCell(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function normaliseHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().replace(/,/g, '');
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCoordinate(value: unknown, kind: 'lat' | 'lon'): number | null {
  const parsed = finiteNumber(value);
  if (parsed == null) return null;
  if (kind === 'lat' && (parsed < -90 || parsed > 90)) return null;
  if (kind === 'lon' && (parsed < -180 || parsed > 180)) return null;
  return parsed;
}

function usableLatLon(lat: number | null, lon: number | null): boolean {
  return lat != null && lon != null && !(lat === 0 && lon === 0);
}

function safeTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

function dateParts(value: unknown, timeZone: string): DateParts {
  const raw = cleanCell(value);
  if (!raw) return { dt: '', timestampMs: null, hour: null, period: 'unknown' };
  const normalized = raw
    .replace(/\s+UTC\s*$/i, 'Z')
    .replace(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)$/, '$1T$2');
  const numeric = finiteNumber(raw);
  const date = numeric != null && /^\d+(\.\d+)?$/.test(raw)
    ? new Date(numeric > 1e12 ? numeric : numeric * 1000)
    : new Date(normalized);
  if (!Number.isFinite(date.getTime())) {
    return { dt: raw, timestampMs: null, hour: null, period: 'unknown' };
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).formatToParts(date).reduce<Record<string, string>>((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  const hour = Number(parts.hour === '24' ? '0' : parts.hour);
  const period: PatternPeriod = Number.isFinite(hour) ? (hour >= 6 && hour < 20 ? 'day' : 'night') : 'unknown';
  return {
    dt: `${parts.year}-${parts.month}-${parts.day} ${String(hour).padStart(2, '0')}:${parts.minute}`,
    timestampMs: date.getTime(),
    hour,
    period,
  };
}

function parseDurationSec(value: unknown): number | null {
  const raw = cleanCell(value);
  if (!raw) return null;
  const direct = finiteNumber(raw);
  if (direct != null) return Math.max(0, Math.round(direct));
  const parts = raw.split(':').map((part) => Number(part));
  if (parts.length === 3 && parts.every(Number.isFinite)) {
    return Math.max(0, Math.round(parts[0] * 3600 + parts[1] * 60 + parts[2]));
  }
  if (parts.length === 2 && parts.every(Number.isFinite)) {
    return Math.max(0, Math.round(parts[0] * 60 + parts[1]));
  }
  return null;
}

function getter(headers: string[]): (row: Record<string, string>, ...names: string[]) => string {
  const map = new Map<string, string>();
  headers.forEach((header) => map.set(normaliseHeader(header), header));
  return (row, ...names) => {
    for (const name of names) {
      const key = map.get(normaliseHeader(name));
      if (key && row[key] !== undefined && row[key] !== '') return row[key];
    }
    return '';
  };
}

function hasHeader(headers: string[], name: string): boolean {
  const needle = name.toLowerCase();
  return headers.some((header) => header.toLowerCase().includes(needle));
}

function exactHeader(headers: string[], name: string): boolean {
  const needle = name.toLowerCase();
  return headers.some((header) => header.toLowerCase() === needle);
}

function makeEvent(kind: PatternEventKind, date: DateParts, overrides: Partial<MutablePatternEvent>): MutablePatternEvent {
  return {
    kind,
    lat: null,
    lon: null,
    dt: date.dt,
    timestampMs: date.timestampMs,
    hour: date.hour,
    period: date.period,
    azimuth: null,
    ...overrides,
  };
}

function tagEvent(event: MutablePatternEvent, sourceFile: string, sourceIndex: number): PatternEvent {
  return {
    ...event,
    id: stableId('pol-event', [
      sourceFile,
      event.kind,
      event.dt,
      event.lat,
      event.lon,
      event.dialed,
      event.lac,
      event.cid,
      event.type,
    ]),
    sourceFile,
    sourceIndex,
  };
}

function tagSurvey(row: MutableSurveyObservation, sourceFile: string, sourceIndex: number): SurveyObservation {
  return {
    ...row,
    id: stableId('pol-survey', [sourceFile, row.mcc, row.mnc, row.lac, row.cid, row.lat, row.lon, row.signal, row.time]),
    sourceFile,
    sourceIndex,
  };
}

function tagAdtech(row: MutableAdtechPing, sourceFile: string, sourceIndex: number): AdtechPing {
  return {
    ...row,
    id: stableId('pol-adtech', [sourceFile, row.deviceId, row.timestampMs, row.lat, row.lon]),
    sourceFile,
    sourceIndex,
  };
}

export function parseDelimitedText(text: string, separator = ','): string[][] {
  let source = text;
  if (source.charCodeAt(0) === 0xfeff) source = source.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === separator) {
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
  return rows;
}

export function sheetRowsFromMatrix(rawRows: unknown[][]): PatternSheetRows {
  const cleaned = rawRows
    .map((row) => row.map(cleanCell))
    .filter((row) => row.some((cell) => cell !== ''));
  if (cleaned.length === 0) return { headers: [], rows: [] };

  let headerIndex = 0;
  let bestScore = -1;
  const knownHeader = /(lat|latitude|lon|lng|longitude|date|time|timestamp|cell|cid|eci|lac|mcc|mnc|dialed|called|duration|azimuth|signal|rsrp|rssi|radius|device|advertising|idfa|aaid|maid)/i;
  for (let index = 0; index < Math.min(cleaned.length, 25); index++) {
    const populated = cleaned[index].filter((cell) => cell.length > 0 && cell.length < 120);
    const known = populated.filter((cell) => knownHeader.test(cell)).length;
    const score = populated.length + known * 3;
    if (populated.length >= 2 && score > bestScore) {
      bestScore = score;
      headerIndex = index;
    }
  }

  const headers = cleaned[headerIndex].map((header, index) => header || `__col${index + 1}__`);
  const rows = cleaned.slice(headerIndex + 1).map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = cleanCell(row[index]);
    });
    return record;
  }).filter((row) => Object.values(row).some((value) => value !== ''));

  return { headers, rows };
}

export function detectPatternFormat(sheet: PatternSheetRows): PatternFormat {
  const headers = sheet.headers.map((header) => header.toLowerCase());
  if (headers.length === 0 || sheet.rows.length === 0) return 'empty';
  if (hasHeader(headers, 'end_latitude') && hasHeader(headers, 'start_datetime')) return 'timing-advance';
  if (hasHeader(headers, 'subsession_timestamp') || (hasHeader(headers, 'downlink_size') && hasHeader(headers, 'latitude'))) return 'data-session';
  if (hasHeader(headers, 'msisdn') && hasHeader(headers, 'calling party') && hasHeader(headers, 'called prty')) return 'cdr-vce';
  if (hasHeader(headers, '1st tower lat') || hasHeader(headers, 'last tower lat') || (hasHeader(headers, 'dialed number') && hasHeader(headers, 'call type'))) return 'cdr';
  if (hasHeader(headers, 'num_a') && hasHeader(headers, 'fecha') && (hasHeader(headers, 'latitud') || hasHeader(headers, 'longitud'))) return 'cdr-mx';
  if (hasHeader(headers, 'mdn') && hasHeader(headers, 'time stamp') && hasHeader(headers, 'latitude') && hasHeader(headers, 'radius')) return 'precision-location';
  if ((hasHeader(headers, 'id_type') || exactHeader(headers, 'advertising_id') || exactHeader(headers, 'idfa') || exactHeader(headers, 'aaid') || exactHeader(headers, 'maid')) &&
      (exactHeader(headers, 'latitude') || exactHeader(headers, 'lat')) &&
      (exactHeader(headers, 'longitude') || exactHeader(headers, 'lon')) &&
      (hasHeader(headers, 'timestamp') || hasHeader(headers, 'time'))) return 'adtech';

  const hasCellId = exactHeader(headers, 'cellid') || exactHeader(headers, 'cid') || exactHeader(headers, 'eci') || hasHeader(headers, 'cell_id');
  const hasCell = hasCellId || exactHeader(headers, 'cell') || exactHeader(headers, 'cellid') || exactHeader(headers, 'cell_id');
  const hasLat = exactHeader(headers, 'lat') || hasHeader(headers, 'latitude');
  const hasLon = exactHeader(headers, 'lon') || exactHeader(headers, 'lng') || hasHeader(headers, 'longitude');
  const hasSignal = exactHeader(headers, 'signal') || exactHeader(headers, 'rsrp') || exactHeader(headers, 'rssi') || exactHeader(headers, 'rscp');
  const hasCellReferenceIdentity = exactHeader(headers, 'mcc') || exactHeader(headers, 'mnc') || exactHeader(headers, 'area') || exactHeader(headers, 'lac') || exactHeader(headers, 'tac');
  const hasOpenDatasetMetadata = exactHeader(headers, 'range') || exactHeader(headers, 'samples') || exactHeader(headers, 'created') || exactHeader(headers, 'updated') || exactHeader(headers, 'averageSignal'.toLowerCase());
  if (hasCell && hasLat && hasLon && hasSignal) return 'tower-survey';
  if (hasCell && hasLat && hasLon && (hasCellReferenceIdentity || hasOpenDatasetMetadata)) return 'cell-reference-dataset';
  if (hasLat && hasLon) return 'generic';
  return 'unknown';
}

export function parseWebMapPing(text: string, timeZone = DEFAULT_TIME_ZONE): MutablePatternEvent[] {
  const events: MutablePatternEvent[] = [];
  for (const line of text.split('\n')) {
    const latMatch = line.match(/Latitude:\s*([-\d.]+)/i);
    const lonMatch = line.match(/Longitude:\s*([-\d.]+)/i);
    if (!latMatch || !lonMatch) continue;
    const lat = parseCoordinate(latMatch[1], 'lat');
    const lon = parseCoordinate(lonMatch[1], 'lon');
    if (lat == null || lon == null || !usableLatLon(lat, lon)) continue;
    const timestampMatch = line.match(/Local Time Stamp:\s*([^,\n]+)/i);
    const date = dateParts(timestampMatch?.[1] ?? '', timeZone);
    events.push(makeEvent('precision_location', date, { lat, lon, type: 'WebMap Ping' }));
  }
  return events;
}

function isWebMapPing(text: string): boolean {
  return /WebMap Ping:/i.test(text) || /WebMapPing/i.test(text);
}

function parseTimingAdvance(sheet: PatternSheetRows, timeZone: string): MutablePatternEvent[] {
  const get = getter(sheet.headers);
  return sheet.rows.flatMap((row) => {
    const lat = parseCoordinate(get(row, 'End_Latitude', 'end_latitude'), 'lat');
    const lon = parseCoordinate(get(row, 'End_Longitude', 'end_longitude'), 'lon');
    if (lat == null || lon == null || !usableLatLon(lat, lon)) return [];
    const date = dateParts(get(row, 'Start_DateTime', 'start_datetime', 'End_DateTime'), timeZone);
    return [makeEvent('timing_advance', date, { lat, lon })];
  });
}

function parseCdr(sheet: PatternSheetRows, timeZone: string): MutablePatternEvent[] {
  const get = getter(sheet.headers);
  return sheet.rows.flatMap((row) => {
    const lat = parseCoordinate(get(row, '1st Tower LAT', '1st Tower Lat', 'First Tower LAT', 'Tower LAT', 'LAT', 'Latitude'), 'lat');
    const lon = parseCoordinate(get(row, '1st Tower LONG', '1st Tower Long', 'First Tower LONG', 'Tower LONG', 'LONG', 'Longitude'), 'lon');
    const hasGeo = usableLatLon(lat, lon);
    const cid = get(row, '1st Cell ID', 'Cell ID', 'CellID', 'CID', 'ECI');
    if (!hasGeo && !cid) return [];

    const combined = get(row, 'DateTime', 'Start Time', 'Call Date');
    const dateOnly = get(row, 'Date');
    const timeOnly = get(row, 'Time');
    const dtRaw = combined || (dateOnly && /\d+:\d+/.test(dateOnly) ? dateOnly : dateOnly && timeOnly ? `${dateOnly} ${timeOnly}` : dateOnly || timeOnly);
    const azimuth = finiteNumber(get(row, '1st Tower Azimuth', 'Tower Azimuth', 'Azimuth'));
    return [makeEvent('cdr', dateParts(dtRaw, timeZone), {
      lat: hasGeo ? lat : null,
      lon: hasGeo ? lon : null,
      azimuth,
      direction: get(row, 'Direction'),
      type: get(row, 'Call Type'),
      dialed: get(row, 'Dialed Number', 'Called Number', 'Destination Number'),
      durationSec: parseDurationSec(get(row, 'Duration')),
      address: get(row, '1st Tower Address', 'Tower Address', 'Address'),
      city: get(row, '1st Tower City', 'Tower City', 'City'),
      lac: get(row, '1st LAC', 'LAC', '1st LAC ID', 'LAC ID', 'TAC'),
      cid,
      site: get(row, '1st Site ID', 'Site ID', 'SiteID', 'NEID'),
      sector: get(row, '1st Sector ID', 'Sector ID', 'Sector'),
      mcc: get(row, 'MCC'),
      mnc: get(row, 'MNC'),
      geoSource: hasGeo ? 'carrier' : 'none',
    })];
  });
}

function parseDataSessions(sheet: PatternSheetRows, timeZone: string): MutablePatternEvent[] {
  const get = getter(sheet.headers);
  return sheet.rows.flatMap((row) => {
    const lat = parseCoordinate(get(row, 'Latitude', 'lat'), 'lat');
    const lon = parseCoordinate(get(row, 'Longitude', 'lon', 'lng'), 'lon');
    const hasGeo = usableLatLon(lat, lon);
    const cid = get(row, 'Cell ID', 'CellID', 'CID', 'ECI');
    if (!hasGeo && !cid) return [];
    const date = dateParts(get(row, 'Subsession_TimeStamp', 'subsession_timestamp', 'Start_Time', 'Timestamp', 'DateTime'), timeZone);
    return [makeEvent('data_session', date, {
      lat: hasGeo ? lat : null,
      lon: hasGeo ? lon : null,
      azimuth: finiteNumber(get(row, 'Azimuth', 'Bearing')),
      address: get(row, 'Address'),
      city: get(row, 'City'),
      lac: get(row, 'LAC', 'TAC', 'Area'),
      cid,
      mcc: get(row, 'MCC'),
      mnc: get(row, 'MNC'),
      type: 'Data Session',
      geoSource: hasGeo ? 'carrier' : 'none',
    })];
  });
}

function parseSurvey(sheet: PatternSheetRows): MutableSurveyObservation[] {
  const get = getter(sheet.headers);
  return sheet.rows.flatMap((row) => {
    const lat = parseCoordinate(get(row, 'lat', 'latitude'), 'lat');
    const lon = parseCoordinate(get(row, 'lon', 'lng', 'longitude'), 'lon');
    const cid = get(row, 'cellid', 'cell_id', 'cid', 'eci');
    if (lat == null || lon == null || !usableLatLon(lat, lon) || !cid) return [];
    return [{
      mcc: get(row, 'mcc'),
      mnc: get(row, 'mnc'),
      lac: get(row, 'area', 'lac', 'tac'),
      cid,
      radio: get(row, 'radio', 'radiotype', 'rat').toUpperCase(),
      lat,
      lon,
      signal: finiteNumber(get(row, 'signal', 'rsrp', 'rssi', 'rscp')),
      bearing: finiteNumber(get(row, 'bearing', 'heading')),
      time: get(row, 'time', 'timestamp', 'ts'),
    }];
  });
}

function parseOpenCellReferenceDataset(sheet: PatternSheetRows, sourceFile: string): CellReference[] {
  const get = getter(sheet.headers);
  return sheet.rows.flatMap((row) => {
    const lat = parseCoordinate(get(row, 'lat', 'latitude'), 'lat');
    const lon = parseCoordinate(get(row, 'lon', 'lng', 'longitude'), 'lon');
    const cid = get(row, 'cellid', 'cell_id', 'cell', 'cid', 'eci');
    if (lat == null || lon == null || !usableLatLon(lat, lon) || !cid) return [];
    const mcc = get(row, 'mcc');
    const mnc = get(row, 'mnc');
    const lac = get(row, 'area', 'lac', 'tac');
    const key = cellKey(mcc, mnc, lac, cid);
    const samples = finiteNumber(get(row, 'samples', 'sample_count', 'observations'));
    const rangeM = finiteNumber(get(row, 'range', 'range_m', 'accuracy', 'radius'));
    return [{
      id: stableId('pol-cell-open', [sourceFile, key, lat, lon]),
      key,
      mcc,
      mnc,
      lac,
      cid,
      radio: get(row, 'radio', 'radiotype', 'rat').toUpperCase(),
      lat,
      lon,
      azimuth: finiteNumber(get(row, 'azimuth', 'bearing')),
      rangeM,
      observationCount: samples == null ? 0 : Math.max(0, Math.round(samples)),
      confidence: samples == null ? 0.45 : Math.min(0.75, Math.max(0.2, samples / 40)),
      source: 'open-dataset',
      hits: 0,
      address: get(row, 'address', 'site', 'name', 'location'),
    }];
  });
}

function parseAdtech(sheet: PatternSheetRows): MutableAdtechPing[] {
  const get = getter(sheet.headers);
  return sheet.rows.flatMap((row) => {
    const lat = parseCoordinate(get(row, 'latitude', 'lat'), 'lat');
    const lon = parseCoordinate(get(row, 'longitude', 'lon', 'lng'), 'lon');
    const timestamp = dateParts(get(row, 'timestamp', 'time', 'datetime', 'event_time', 'location_at'), DEFAULT_TIME_ZONE).timestampMs;
    const deviceId = get(row, 'id', 'device_id', 'advertising_id', 'idfa', 'aaid', 'maid', 'ad_id');
    if (lat == null || lon == null || !usableLatLon(lat, lon) || timestamp == null || !deviceId) return [];
    return [{
      deviceId,
      lat,
      lon,
      timestampMs: timestamp,
      accuracyM: finiteNumber(get(row, 'horizontal_accuracy', 'accuracy', 'radius')),
      make: get(row, 'device_make', 'make'),
      model: get(row, 'device_model', 'model'),
      os: get(row, 'device_os', 'os'),
      ip: get(row, 'ip_address', 'ip'),
      idType: get(row, 'id_type', 'id type'),
    }];
  });
}

function parseMxCdr(sheet: PatternSheetRows, timeZone: string): MutablePatternEvent[] {
  const get = getter(sheet.headers);
  return sheet.rows.flatMap((row) => {
    const fecha = get(row, 'FECHA', 'Fecha', 'Date');
    const hora = get(row, 'HORA', 'Hora', 'Time');
    const dtRaw = fecha && /\d+:\d+/.test(fecha) ? fecha : fecha && hora ? `${fecha} ${hora}` : fecha || hora;
    if (!dtRaw) return [];
    const lat = parseCoordinate(get(row, 'LATITUD', 'Latitud', 'Latitude', 'Lat'), 'lat');
    const lon = parseCoordinate(get(row, 'LONGITUD', 'Longitud', 'Longitude', 'Lon'), 'lon');
    const hasGeo = usableLatLon(lat, lon);
    const cid = get(row, 'ID_CELDA', 'Id_Celda', 'Cell Id', 'CellId');
    if (!hasGeo && !cid) return [];
    const service = get(row, 'SERV', 'Serv', 'Service').toUpperCase();
    const directionCode = get(row, 'T_REG', 'TReg', 'Tipo Reg').toUpperCase();
    const kind: PatternEventKind = service === 'DATA' ? 'data_session' : 'cdr';
    return [makeEvent(kind, dateParts(dtRaw, timeZone), {
      lat: hasGeo ? lat : null,
      lon: hasGeo ? lon : null,
      azimuth: finiteNumber(get(row, 'AZIMUTH', 'Azimut', 'Azimuth')),
      direction: directionCode === 'ENT' ? 'Incoming' : directionCode === 'SAL' ? 'Outgoing' : get(row, 'Direction'),
      type: service === 'VOZ' ? 'Voice' : service === 'SMS' ? 'SMS' : service === 'DATA' ? 'Data' : service,
      dialed: get(row, 'DEST', 'Dest', 'Called Number', 'Destination'),
      durationSec: parseDurationSec(get(row, 'DUR', 'Dur', 'Duration')),
      cid,
      mcc: '334',
      geoSource: hasGeo ? 'carrier' : 'none',
    })];
  });
}

function parsePrecisionLocation(sheet: PatternSheetRows, timeZone: string): MutablePatternEvent[] {
  const get = getter(sheet.headers);
  return sheet.rows.flatMap((row) => {
    const lat = parseCoordinate(get(row, 'Latitude', 'Lat'), 'lat');
    const lon = parseCoordinate(get(row, 'Longitude', 'Lon', 'Lng'), 'lon');
    if (lat == null || lon == null || !usableLatLon(lat, lon)) return [];
    const date = dateParts(get(row, 'Time Stamp', 'Timestamp', 'Time', 'DateTime'), timeZone);
    return [makeEvent('precision_location', date, {
      lat,
      lon,
      type: get(row, 'Message', 'Msg') || 'Precision Location',
    })];
  });
}

function parseVce(sheet: PatternSheetRows, timeZone: string): ParsedVce {
  const get = getter(sheet.headers);
  const calls: MutablePatternEvent[] = [];
  const sites: VceSite[] = [];
  const dateLike = (value: string): boolean => /^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(value.trim());
  const stripPhone = (value: string): string => value.replace(/^(sip|tel):\+?1?/i, '').replace(/@.*$/i, '').trim();

  for (const row of sheet.rows) {
    const dtRaw = get(row, 'Record Open Date/Time(Local)', 'Record Open Date/Time', 'Record Open Local');
    if (!dtRaw) continue;
    if (dateLike(dtRaw)) {
      const directionCode = get(row, 'CallDirection', 'Call Direction');
      const direction = directionCode === '1' ? 'Incoming' : 'Outgoing';
      const other = direction === 'Outgoing'
        ? stripPhone(get(row, 'Called Prty Addr', 'Called Party Address', 'Called Number', 'Called Prty'))
        : stripPhone(get(row, 'Calling Party No', 'Calling Number', 'Calling Party'));
      const enodeb = get(row, 'Mkt Enodeb Id', 'Enodeb Id', 'ENodeB Id', 'eNodeB', 'eNB Id');
      calls.push(makeEvent('cdr', dateParts(dtRaw, timeZone), {
        lat: null,
        lon: null,
        direction,
        type: 'Voice',
        dialed: other,
        durationSec: parseDurationSec(get(row, 'TIMEUsage', 'Duration', 'Time Usage', 'Call Duration')),
        lac: enodeb,
        cid: get(row, 'ANI Cell Id', 'Cell Id', 'CellID', 'CID', 'ECI'),
        site: enodeb,
        mcc: '311',
        geoSource: 'none',
      }));
    } else {
      const lat = parseCoordinate(get(row, 'Calling Party No', 'Calling Number', 'Calling Party'), 'lat');
      const lon = parseCoordinate(get(row, 'Called Prty Addr', 'Called Party Address', 'Called Number', 'Called Prty'), 'lon');
      if (lat == null || lon == null || !usableLatLon(lat, lon)) continue;
      sites.push({
        lat,
        lon,
        azimuth: finiteNumber(get(row, 'Mkt Enodeb Id', 'Enodeb Id', 'ENodeB Id', 'eNodeB', 'eNB Id')),
        address: [
          dtRaw,
          get(row, 'Record Open Date/Time(GMT)', 'Record Open GMT'),
          get(row, 'Record Close Date/Time(Local)', 'Record Close Local'),
          get(row, 'Record Close Date/Time(GMT)', 'Record Close GMT'),
        ].filter(Boolean).join(', '),
        lac: row.__col17__ ?? '',
        cid: row.__col22__ ?? '',
        mcc: '311',
        mnc: '',
      });
    }
  }
  return { calls, sites };
}

function parseGeneric(sheet: PatternSheetRows, timeZone: string): MutablePatternEvent[] {
  const findHeader = (...needles: string[]): string => {
    return sheet.headers.find((header) => needles.some((needle) => header.toLowerCase().includes(needle))) ?? '';
  };
  const latHeader = findHeader('lat', 'latitude');
  const lonHeader = findHeader('lon', 'lng', 'longitude');
  if (!latHeader || !lonHeader) return [];
  const dateHeader = findHeader('date', 'time', 'datetime', 'timestamp');
  const typeHeader = findHeader('type', 'event');
  const directionHeader = findHeader('dir', 'direction');
  const dialedHeader = findHeader('dialed', 'called', 'number', 'dest');
  const durationHeader = findHeader('dur', 'duration');
  const azimuthHeader = findHeader('az', 'azimuth', 'bearing');
  const addressHeader = findHeader('addr', 'address', 'street');
  const cityHeader = findHeader('city', 'municipality');

  return sheet.rows.flatMap((row) => {
    const lat = parseCoordinate(row[latHeader], 'lat');
    const lon = parseCoordinate(row[lonHeader], 'lon');
    if (lat == null || lon == null || !usableLatLon(lat, lon)) return [];
    const rawType = row[typeHeader] ?? '';
    const lowerType = rawType.toLowerCase();
    const kind: PatternEventKind = /ta|timing|ping|location/.test(lowerType)
      ? 'timing_advance'
      : /data|session|gprs|lte/.test(lowerType)
        ? 'data_session'
        : 'cdr';
    return [makeEvent(kind, dateParts(row[dateHeader], timeZone), {
      lat,
      lon,
      azimuth: finiteNumber(row[azimuthHeader]),
      direction: row[directionHeader] ?? '',
      type: rawType,
      dialed: row[dialedHeader] ?? '',
      durationSec: parseDurationSec(row[durationHeader]),
      address: row[addressHeader] ?? '',
      city: row[cityHeader] ?? '',
      geoSource: 'carrier',
    })];
  });
}

function dedupeSurvey(rows: SurveyObservation[]): SurveyObservation[] {
  const seen = new Set<string>();
  const out: SurveyObservation[] = [];
  for (const row of rows) {
    const key = [
      row.mcc,
      row.mnc,
      row.lac,
      row.cid,
      row.lat.toFixed(5),
      row.lon.toFixed(5),
      row.signal == null ? '' : Math.round(row.signal),
      row.time,
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function cellKey(mcc?: string, mnc?: string, lac?: string, cid?: string): string {
  return [mcc ?? '', mnc ?? '', lac ?? '', cid ?? ''].join('|');
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const radiusKm = 6371;
  const deltaLat = (lat2 - lat1) * Math.PI / 180;
  const deltaLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(deltaLon / 2) ** 2;
  return radiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const deltaLon = (lon2 - lon1) * Math.PI / 180;
  const y = Math.sin(deltaLon) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function buildCellReferences(surveyRows: SurveyObservation[]): Map<string, CellReference> {
  const byCell = new Map<string, SurveyObservation[]>();
  for (const row of surveyRows) {
    const key = cellKey(row.mcc, row.mnc, row.lac, row.cid);
    const bucket = byCell.get(key) ?? [];
    bucket.push(row);
    byCell.set(key, bucket);
  }

  const refs = new Map<string, CellReference>();
  for (const [key, observations] of byCell) {
    const weights = observations.map((obs) => obs.signal == null ? 1 : Math.max(1e-9, 10 ** (obs.signal / 10)));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || observations.length;
    const lat = observations.reduce((sum, obs, index) => sum + obs.lat * weights[index], 0) / totalWeight;
    const lon = observations.reduce((sum, obs, index) => sum + obs.lon * weights[index], 0) / totalWeight;
    const sorted = observations.filter((obs) => obs.signal != null).sort((a, b) => (b.signal ?? -Infinity) - (a.signal ?? -Infinity));
    const strongest = sorted.length > 0 ? sorted.slice(0, Math.max(3, Math.ceil(sorted.length * 0.3))) : observations;
    let sumX = 0;
    let sumY = 0;
    for (const obs of strongest) {
      const bearing = bearingDeg(lat, lon, obs.lat, obs.lon);
      sumX += Math.cos(bearing * Math.PI / 180);
      sumY += Math.sin(bearing * Math.PI / 180);
    }
    const hasAzimuth = strongest.length >= 2 && (sumX * sumX + sumY * sumY) > 0.05;
    const distances = observations.map((obs) => haversineKm(lat, lon, obs.lat, obs.lon) * 1000).sort((a, b) => a - b);
    const rangeM = distances.length > 0 ? distances[Math.floor(distances.length * 0.9)] : 300;
    const observationScore = Math.min(1, observations.length / 15);
    const spreadScore = strongest.length >= 2 ? Math.sqrt(sumX * sumX + sumY * sumY) / strongest.length : 0;
    const confidence = Math.min(1, observationScore * 0.6 + spreadScore * 0.4);
    const first = observations[0];
    refs.set(key, {
      id: stableId('pol-cell', [key]),
      key,
      mcc: first.mcc,
      mnc: first.mnc,
      lac: first.lac,
      cid: first.cid,
      radio: first.radio,
      lat: Math.round(lat * 1e6) / 1e6,
      lon: Math.round(lon * 1e6) / 1e6,
      azimuth: hasAzimuth ? Math.round((Math.atan2(sumY / strongest.length, sumX / strongest.length) * 180 / Math.PI + 360) % 360) : null,
      rangeM: Math.round(rangeM),
      observationCount: observations.length,
      confidence: Math.round(confidence * 100) / 100,
      source: 'survey',
      hits: 0,
    });
  }
  return refs;
}

function mergeCellReference(refs: Map<string, CellReference>, next: CellReference): void {
  const existing = refs.get(next.key);
  if (!existing) {
    refs.set(next.key, next);
    return;
  }
  if (existing.source === 'survey' || existing.source === 'carrier') return;
  if (existing.source === 'unmapped' || next.confidence > existing.confidence) {
    refs.set(next.key, { ...next, hits: existing.hits });
  }
}

function enrichEvents(events: PatternEvent[], refs: Map<string, CellReference>): number {
  let filled = 0;
  for (const event of events) {
    if (event.lat != null && event.lon != null) continue;
    if (!event.cid) continue;
    const ref = refs.get(cellKey(event.mcc, event.mnc, event.lac, event.cid));
    if (!ref || ref.lat == null || ref.lon == null) continue;
    event.lat = ref.lat;
    event.lon = ref.lon;
    event.azimuth = event.azimuth ?? ref.azimuth;
    event.geoSource = ref.source;
    filled++;
  }
  return filled;
}

function clusterEvents(events: PatternEvent[], radiusKm: number): LocationCluster[] {
  const geocoded = events.filter((event) => event.lat != null && event.lon != null) as Array<PatternEvent & { lat: number; lon: number }>;
  const used = new Set<number>();
  const clusters: LocationCluster[] = [];
  geocoded.forEach((event, index) => {
    if (used.has(index)) return;
    const points = [event];
    used.add(index);
    geocoded.forEach((other, otherIndex) => {
      if (used.has(otherIndex)) return;
      if (haversineKm(event.lat, event.lon, other.lat, other.lon) <= radiusKm) {
        points.push(other);
        used.add(otherIndex);
      }
    });
    const lat = points.reduce((sum, point) => sum + point.lat, 0) / points.length;
    const lon = points.reduce((sum, point) => sum + point.lon, 0) / points.length;
    const day = points.filter((point) => point.period === 'day').length;
    const night = points.filter((point) => point.period === 'night').length;
    const addresses = Array.from(new Set(points.map((point) => [point.address, point.city].filter(Boolean).join(', ')).filter(Boolean))).slice(0, 3);
    clusters.push({
      id: stableId('pol-location', [lat.toFixed(5), lon.toFixed(5), points.length]),
      lat: Math.round(lat * 1e5) / 1e5,
      lon: Math.round(lon * 1e5) / 1e5,
      count: points.length,
      day,
      night,
      addresses,
      primaryPeriod: day === 0 && night === 0 ? 'unknown' : day >= night ? 'day' : 'night',
    });
  });
  return clusters.sort((a, b) => b.count - a.count);
}

function buildTimeline(events: PatternEvent[]): TimelineBucket[] {
  const buckets = new Map<string, TimelineBucket>();
  for (const event of events) {
    if (event.hour == null || !/^\d{4}-\d{2}-\d{2}/.test(event.dt)) continue;
    const date = event.dt.slice(0, 10);
    const key = `${date}:${event.hour}`;
    const bucket = buckets.get(key) ?? { date, hour: event.hour, count: 0 };
    bucket.count++;
    buckets.set(key, bucket);
  }
  return Array.from(buckets.values()).sort((a, b) => `${a.date}:${String(a.hour).padStart(2, '0')}`.localeCompare(`${b.date}:${String(b.hour).padStart(2, '0')}`));
}

function buildContacts(cdr: PatternEvent[]): ContactSummary[] {
  const contacts = new Map<string, ContactSummary>();
  for (const event of cdr) {
    const number = event.dialed?.trim() || '';
    if (!number) continue;
    const entry = contacts.get(number) ?? {
      number,
      total: 0,
      outgoing: 0,
      incoming: 0,
      totalDurationSec: 0,
      byHour: new Array(24).fill(0) as number[],
      firstSeen: null,
      lastSeen: null,
    };
    const outgoing = /out|mo|originating/i.test(event.direction ?? '');
    entry.total++;
    if (outgoing) entry.outgoing++;
    else entry.incoming++;
    entry.totalDurationSec += event.durationSec ?? 0;
    if (event.hour != null) entry.byHour[event.hour]++;
    if (event.dt) {
      entry.firstSeen = entry.firstSeen == null || event.dt < entry.firstSeen ? event.dt : entry.firstSeen;
      entry.lastSeen = entry.lastSeen == null || event.dt > entry.lastSeen ? event.dt : entry.lastSeen;
    }
    contacts.set(number, entry);
  }
  return Array.from(contacts.values()).sort((a, b) => b.total - a.total || b.totalDurationSec - a.totalDurationSec);
}

function dedupeAdtech(pings: AdtechPing[]): AdtechPing[] {
  const seen = new Set<string>();
  const out: AdtechPing[] = [];
  for (const ping of pings) {
    const key = `${ping.deviceId}|${ping.timestampMs}|${ping.lat.toFixed(5)}|${ping.lon.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ping);
  }
  return out;
}

function computeAdtechOverlaps(events: PatternEvent[], pings: AdtechPing[], distanceM: number, windowSec: number, minEvents: number): { overlaps: AdtechOverlap[]; candidates: AdtechCandidate[] } {
  const sortedPings = pings.slice().sort((a, b) => a.timestampMs - b.timestampMs);
  const timestamps = sortedPings.map((ping) => ping.timestampMs);
  const bsearch = (target: number): number => {
    let low = 0;
    let high = timestamps.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (timestamps[mid] < target) low = mid + 1;
      else high = mid;
    }
    return low;
  };

  const overlaps: AdtechOverlap[] = [];
  const maxDistanceKm = distanceM / 1000;
  const windowMs = windowSec * 1000;
  for (const event of events) {
    if (event.lat == null || event.lon == null || event.timestampMs == null) continue;
    const low = bsearch(event.timestampMs - windowMs);
    const high = bsearch(event.timestampMs + windowMs);
    for (let index = low; index < high; index++) {
      const ping = sortedPings[index];
      const distanceKm = haversineKm(event.lat, event.lon, ping.lat, ping.lon);
      if (distanceKm > maxDistanceKm) continue;
      overlaps.push({
        id: stableId('pol-overlap', [event.id, ping.id]),
        deviceId: ping.deviceId,
        adTimestampMs: ping.timestampMs,
        adLat: ping.lat,
        adLon: ping.lon,
        eventId: event.id,
        eventKind: event.kind,
        eventDt: event.dt,
        eventLat: event.lat,
        eventLon: event.lon,
        distanceM: Math.round(distanceKm * 1000),
        deltaSec: Math.round((ping.timestampMs - event.timestampMs) / 1000),
      });
    }
  }

  const byDevice = new Map<string, { pings: AdtechPing[]; overlaps: AdtechOverlap[]; dist: number }>();
  for (const overlap of overlaps) {
    const ping = sortedPings.find((candidate) => candidate.deviceId === overlap.deviceId && candidate.timestampMs === overlap.adTimestampMs && candidate.lat === overlap.adLat && candidate.lon === overlap.adLon);
    const entry = byDevice.get(overlap.deviceId) ?? { pings: [], overlaps: [], dist: 0 };
    if (ping) entry.pings.push(ping);
    entry.overlaps.push(overlap);
    entry.dist += overlap.distanceM;
    byDevice.set(overlap.deviceId, entry);
  }

  const candidates = Array.from(byDevice.entries()).filter(([, entry]) => entry.overlaps.length >= minEvents).map(([deviceId, entry]) => {
    const lat = entry.overlaps.reduce((sum, overlap) => sum + overlap.adLat, 0) / entry.overlaps.length;
    const lon = entry.overlaps.reduce((sum, overlap) => sum + overlap.adLon, 0) / entry.overlaps.length;
    const firstPing = entry.pings[0];
    return {
      deviceId,
      hits: entry.overlaps.length,
      firstSeenMs: Math.min(...entry.overlaps.map((overlap) => overlap.adTimestampMs)),
      lastSeenMs: Math.max(...entry.overlaps.map((overlap) => overlap.adTimestampMs)),
      avgDistanceM: Math.round(entry.dist / entry.overlaps.length),
      centroidLat: Math.round(lat * 1e6) / 1e6,
      centroidLon: Math.round(lon * 1e6) / 1e6,
      confidence: Math.max(0, Math.min(1, Math.log10(entry.overlaps.length + 1) / 2 * (1 - (entry.dist / entry.overlaps.length) / Math.max(distanceM, 1)))),
      make: firstPing?.make,
      model: firstPing?.model,
      os: firstPing?.os,
    };
  }).sort((a, b) => b.confidence - a.confidence || b.hits - a.hits);

  return { overlaps, candidates };
}

export function processPatternOfLifeFiles(files: PatternInputFile[], subject: PatternSubject = {}, options: PatternAnalysisOptions = {}): PatternAnalysis {
  const timeZone = safeTimeZone(options.timeZone ?? DEFAULT_TIME_ZONE);
  const issues: PatternIssue[] = [];
  const summaries: PatternFileSummary[] = [];
  const timingAdvance: PatternEvent[] = [];
  const cdr: PatternEvent[] = [];
  const sessions: PatternEvent[] = [];
  const survey: SurveyObservation[] = [];
  const vceSites: VceSite[] = [];
  const openDatasetRefs: CellReference[] = [];
  const adtech: AdtechPing[] = [];

  files.forEach((file, sourceIndex) => {
    const ext = (file.ext ?? file.name.split('.').pop() ?? '').toLowerCase();
    let format: PatternFormat = 'unknown';
    let rowsSeen = 0;
    let accepted = 0;

    if (typeof file.text === 'string' && isWebMapPing(file.text)) {
      format = 'webmap-ping';
      const events = parseWebMapPing(file.text, timeZone).map((event) => tagEvent(event, file.name, sourceIndex));
      timingAdvance.push(...events);
      accepted = events.length;
      rowsSeen = file.text.split('\n').filter((line) => line.trim()).length;
    } else if (typeof file.text === 'string' && /no records were found/i.test(file.text)) {
      format = 'empty';
      rowsSeen = 0;
      issues.push({ file: file.name, format, severity: 'info', message: 'File reports no records; no pattern-of-life rows were imported.' });
    } else {
      const matrix = file.rows ?? (typeof file.text === 'string' ? parseDelimitedText(file.text, ext === 'tsv' ? '\t' : file.text.includes('\t') && !file.text.includes(',') ? '\t' : ',') : []);
      const sheet = sheetRowsFromMatrix(matrix);
      rowsSeen = sheet.rows.length;
      format = detectPatternFormat(sheet);
      if (format === 'empty') {
        issues.push({ file: file.name, format, severity: 'info', message: 'File had no usable tabular rows.' });
      } else if (format === 'unknown') {
        issues.push({ file: file.name, format, severity: 'warning', message: 'File headers did not match a supported pattern-of-life source format.' });
      } else if (format === 'timing-advance') {
        const parsed = parseTimingAdvance(sheet, timeZone).map((event) => tagEvent(event, file.name, sourceIndex));
        timingAdvance.push(...parsed);
        accepted = parsed.length;
      } else if (format === 'cdr') {
        const parsed = parseCdr(sheet, timeZone).map((event) => tagEvent(event, file.name, sourceIndex));
        cdr.push(...parsed);
        accepted = parsed.length;
      } else if (format === 'data-session') {
        const parsed = parseDataSessions(sheet, timeZone).map((event) => tagEvent(event, file.name, sourceIndex));
        sessions.push(...parsed);
        accepted = parsed.length;
      } else if (format === 'tower-survey') {
        const parsed = parseSurvey(sheet).map((row) => tagSurvey(row, file.name, sourceIndex));
        survey.push(...parsed);
        accepted = parsed.length;
      } else if (format === 'cell-reference-dataset') {
        const parsed = parseOpenCellReferenceDataset(sheet, file.name);
        openDatasetRefs.push(...parsed);
        accepted = parsed.length;
      } else if (format === 'adtech') {
        const parsed = parseAdtech(sheet).map((row) => tagAdtech(row, file.name, sourceIndex));
        adtech.push(...parsed);
        accepted = parsed.length;
      } else if (format === 'cdr-mx') {
        const parsed = parseMxCdr(sheet, timeZone).map((event) => tagEvent(event, file.name, sourceIndex));
        cdr.push(...parsed.filter((event) => event.kind === 'cdr'));
        sessions.push(...parsed.filter((event) => event.kind === 'data_session'));
        accepted = parsed.length;
      } else if (format === 'precision-location') {
        const parsed = parsePrecisionLocation(sheet, timeZone).map((event) => tagEvent(event, file.name, sourceIndex));
        timingAdvance.push(...parsed);
        accepted = parsed.length;
      } else if (format === 'cdr-vce') {
        const parsed = parseVce(sheet, timeZone);
        const events = parsed.calls.map((event) => tagEvent(event, file.name, sourceIndex));
        cdr.push(...events);
        vceSites.push(...parsed.sites);
        accepted = events.length + parsed.sites.length;
      } else if (format === 'generic') {
        const parsed = parseGeneric(sheet, timeZone).map((event) => tagEvent(event, file.name, sourceIndex));
        timingAdvance.push(...parsed.filter((event) => event.kind === 'timing_advance' || event.kind === 'precision_location'));
        cdr.push(...parsed.filter((event) => event.kind === 'cdr' || event.kind === 'generic'));
        sessions.push(...parsed.filter((event) => event.kind === 'data_session'));
        accepted = parsed.length;
      }

      if (rowsSeen > 0 && accepted === 0 && format !== 'unknown' && format !== 'empty') {
        issues.push({ file: file.name, format, severity: 'warning', message: 'Recognized source format, but every row was malformed or missing usable coordinates/cell identifiers.' });
      }
    }

    summaries.push({
      name: file.name,
      format,
      rowsSeen,
      recordsAccepted: accepted,
      recordsOmitted: Math.max(0, rowsSeen - accepted),
    });
  });

  const surveyDeduped = dedupeSurvey(survey);
  const cellRefs = buildCellReferences(surveyDeduped);

  for (const site of vceSites) {
    const key = cellKey(site.mcc, site.mnc, site.lac, site.cid);
    if (cellRefs.get(key)?.source === 'survey') continue;
    cellRefs.set(key, {
      id: stableId('pol-cell', [key]),
      key,
      mcc: site.mcc,
      mnc: site.mnc,
      lac: site.lac,
      cid: site.cid,
      radio: '',
      lat: site.lat,
      lon: site.lon,
      azimuth: site.azimuth,
      rangeM: 1000,
      observationCount: 0,
      confidence: 0.85,
      source: 'carrier',
      hits: 0,
      address: site.address,
    });
  }

  for (const ref of openDatasetRefs) {
    mergeCellReference(cellRefs, ref);
  }

  for (const event of [...cdr, ...sessions]) {
    if (!event.cid) continue;
    const key = cellKey(event.mcc, event.mnc, event.lac, event.cid);
    const existing = cellRefs.get(key);
    if (existing) {
      existing.hits++;
      continue;
    }
    if (event.lat != null && event.lon != null) {
      cellRefs.set(key, {
        id: stableId('pol-cell', [key]),
        key,
        mcc: event.mcc ?? '',
        mnc: event.mnc ?? '',
        lac: event.lac ?? '',
        cid: event.cid,
        radio: '',
        lat: event.lat,
        lon: event.lon,
        azimuth: event.azimuth,
        rangeM: 1000,
        observationCount: 0,
        confidence: 0.85,
        source: 'carrier',
        hits: 1,
        address: [event.address, event.city].filter(Boolean).join(', '),
      });
    } else {
      cellRefs.set(key, {
        id: stableId('pol-cell', [key]),
        key,
        mcc: event.mcc ?? '',
        mnc: event.mnc ?? '',
        lac: event.lac ?? '',
        cid: event.cid,
        radio: '',
        lat: null,
        lon: null,
        azimuth: null,
        rangeM: null,
        observationCount: 0,
        confidence: 0,
        source: 'unmapped',
        hits: 1,
      });
    }
  }

  const enrichedEvents = enrichEvents(cdr, cellRefs) + enrichEvents(sessions, cellRefs);
  const events = [...timingAdvance, ...cdr, ...sessions].sort((a, b) => (a.timestampMs ?? Number.MAX_SAFE_INTEGER) - (b.timestampMs ?? Number.MAX_SAFE_INTEGER));
  const geocodedEvents = events.filter((event) => event.lat != null && event.lon != null);
  const locations = clusterEvents(events, 0.15).slice(0, 80);
  const dayLocations = locations.filter((location) => location.day > 0).sort((a, b) => b.day - a.day).slice(0, 15);
  const nightLocations = locations.filter((location) => location.night > 0).sort((a, b) => b.night - a.night).slice(0, 15);
  const timeline = buildTimeline(events);
  const contacts = buildContacts(cdr);
  const pings = dedupeAdtech(adtech);
  const overlapResult = computeAdtechOverlaps(
    geocodedEvents,
    pings,
    options.overlapDistanceM ?? DEFAULT_OVERLAP_DISTANCE_M,
    options.overlapWindowSec ?? DEFAULT_OVERLAP_WINDOW_SEC,
    options.overlapMinEvents ?? DEFAULT_OVERLAP_MIN_EVENTS,
  );
  const dated = events.filter((event) => event.dt && /^\d{4}-\d{2}-\d{2}/.test(event.dt)).map((event) => event.dt).sort();
  const dateRange = dated.length > 0 ? `${dated[0].slice(0, 10)} - ${dated[dated.length - 1].slice(0, 10)}` : null;
  const cellReferences = Array.from(cellRefs.values()).sort((a, b) => b.hits - a.hits || a.key.localeCompare(b.key));

  if (events.length === 0 && cellReferences.length === 0 && pings.length === 0) {
    issues.push({ severity: 'error', message: 'No usable pattern-of-life data was found in the selected files.' });
  }

  const totalRowsSeen = summaries.reduce((sum, summary) => sum + summary.rowsSeen, 0);
  const recordsAccepted = summaries.reduce((sum, summary) => sum + summary.recordsAccepted, 0);
  const recordsOmitted = summaries.reduce((sum, summary) => sum + summary.recordsOmitted, 0);

  return {
    subject,
    dateRange,
    files: summaries,
    issues,
    events,
    timingAdvance,
    cdr,
    sessions,
    survey: surveyDeduped,
    cellReferences,
    locations,
    dayLocations,
    nightLocations,
    contacts,
    timeline,
    adtech: {
      pings,
      overlaps: overlapResult.overlaps,
      candidates: overlapResult.candidates,
    },
    stats: {
      totalFiles: files.length,
      acceptedFiles: summaries.filter((summary) => summary.recordsAccepted > 0).length,
      totalRowsSeen,
      recordsAccepted,
      recordsOmitted,
      totalEvents: events.length,
      geocodedEvents: geocodedEvents.length,
      timingAdvanceHits: timingAdvance.length,
      cdrEvents: cdr.length,
      dataSessions: sessions.length,
      towerReferences: cellReferences.length,
      unmappedCells: cellReferences.filter((ref) => ref.source === 'unmapped').length,
      surveyObservations: surveyDeduped.length,
      openDatasetCells: openDatasetRefs.length,
      adtechPings: pings.length,
      adtechOverlaps: overlapResult.overlaps.length,
      candidateDevices: overlapResult.candidates.length,
      enrichedEvents,
    },
  };
}
