import {
  buildMetadata,
  clampText,
  collectionStatus,
  parseDateOrNull,
  sourceIdentity,
  stableId,
} from './helpers';
import type { IntegrityMetadata, SourceCollectionStatus } from './types';

export const OUI_MASTER_REPO = 'https://github.com/Ringmast4r/OUI-Master-Database';
export const OUI_MASTER_CSV_URL = 'https://raw.githubusercontent.com/Ringmast4r/OUI-Master-Database/master/LISTS/master_oui.csv';
export const OUI_MASTER_README_URL = `${OUI_MASTER_REPO}/blob/master/README.md`;
export const MACVENDORS_API_URL = 'https://macvendors.co/api';

export interface NormalizedMacInput {
  raw: string;
  hex: string;
  display: string;
  oui: string;
  prefixCandidates: string[];
}

export interface OuiRecord {
  oui: string;
  oui_hex: string;
  manufacturer: string;
  registry: string | null;
  short_name: string | null;
  device_type: string | null;
  registered_date: string | null;
  address: string | null;
  country: string | null;
  sources: string[];
}

export interface ParsedOuiDatabase {
  records: Map<string, OuiRecord>;
  receivedRecords: number;
  acceptedRecords: number;
  rejectedRecords: number;
}

export interface OuiLookupResult {
  mac: string;
  normalized_mac: string;
  oui: string;
  prefix: string;
  found: boolean;
  vendor: string;
  manufacturer: string | null;
  registry: string | null;
  short_name: string | null;
  device_type: string | null;
  registered_date: string | null;
  address: string | null;
  country: string | null;
  sources: string[];
  source_label: string | null;
  source_url: string | null;
  evidence_kind: 'reference';
  integrity: IntegrityMetadata | null;
}

type CsvRow = Record<string, string>;

export function normalizeMacInput(value: string): NormalizedMacInput | null {
  const hex = value.trim().toUpperCase().replace(/[^A-F0-9]/g, '');
  if (hex.length < 6) return null;
  const pairs = hex.match(/.{1,2}/g) ?? [];
  const prefixCandidates = [12, 10, 9, 7, 6]
    .filter((length) => hex.length >= length)
    .map((length) => hex.slice(0, length));
  return {
    raw: value,
    hex,
    display: pairs.join(':'),
    oui: formatOui(hex.slice(0, 6)),
    prefixCandidates,
  };
}

export function parseOuiCsv(csv: string): ParsedOuiDatabase {
  const rows = parseCsv(csv);
  const records = new Map<string, OuiRecord>();
  let acceptedRecords = 0;
  let rejectedRecords = 0;
  for (const row of rows) {
    const record = normalizeOuiRow(row);
    if (!record) {
      rejectedRecords++;
      continue;
    }
    acceptedRecords++;
    records.set(record.oui_hex, record);
  }
  return {
    records,
    receivedRecords: rows.length,
    acceptedRecords,
    rejectedRecords,
  };
}

export function lookupOuiRecord(records: Map<string, OuiRecord>, mac: NormalizedMacInput): OuiRecord | null {
  for (const prefix of mac.prefixCandidates) {
    const record = records.get(prefix);
    if (record) return record;
  }
  return null;
}

export function buildOuiLookupResult(mac: NormalizedMacInput, record: OuiRecord | null, collectedAt: string): OuiLookupResult {
  if (!record) {
    return {
      mac: mac.display,
      normalized_mac: mac.hex,
      oui: mac.oui,
      prefix: mac.oui,
      found: false,
      vendor: 'Not Found',
      manufacturer: null,
      registry: null,
      short_name: null,
      device_type: null,
      registered_date: null,
      address: null,
      country: null,
      sources: [],
      source_label: null,
      source_url: null,
      evidence_kind: 'reference',
      integrity: null,
    };
  }
  const recordId = stableId('oui-lookup', [record.oui_hex, record.manufacturer]);
  return {
    mac: mac.display,
    normalized_mac: mac.hex,
    oui: record.oui,
    prefix: record.oui,
    found: true,
    vendor: record.manufacturer,
    manufacturer: record.manufacturer,
    registry: record.registry,
    short_name: record.short_name,
    device_type: record.device_type,
    registered_date: record.registered_date,
    address: record.address,
    country: record.country,
    sources: record.sources,
    source_label: 'Ringmast4r/OUI-Master-Database',
    source_url: OUI_MASTER_REPO,
    evidence_kind: 'reference',
    integrity: buildMetadata({
      recordId,
      upstreamId: record.oui,
      source: sourceIdentity('oui-master-database:master-csv', 'Ringmast4r OUI Master Database CSV', OUI_MASTER_CSV_URL),
      itemUrl: OUI_MASTER_REPO,
      originalPublisher: 'Ringmast4r/OUI-Master-Database',
      evidenceKind: 'reference',
      verification: record.sources.length > 1 ? 'verified' : 'unassessed',
      methodology: 'Matched the submitted MAC address against the most specific prefix available in the source OUI master CSV. Missing country/device fields remain null.',
      timing: {
        publishedAt: parseDateOrNull(record.registered_date),
        collectedAt,
      },
      evidenceReferences: [
        { label: 'OUI Master CSV', url: OUI_MASTER_CSV_URL },
        { label: 'Source repository', url: OUI_MASTER_REPO },
      ],
    }),
  };
}

export function ouiCollectionStatus(parsed: ParsedOuiDatabase, collectedAt: string): SourceCollectionStatus {
  return collectionStatus({
    source: sourceIdentity('oui-master-database:master-csv', 'Ringmast4r OUI Master Database CSV', OUI_MASTER_CSV_URL),
    availability: parsed.acceptedRecords > 0 ? 'ok' : 'error',
    dataState: parsed.acceptedRecords > 0 ? 'present' : 'unavailable',
    freshness: parsed.acceptedRecords > 0 ? 'fresh' : 'unknown',
    lastAttemptAt: collectedAt,
    lastSuccessfulFetchAt: parsed.acceptedRecords > 0 ? collectedAt : null,
    receivedRecords: parsed.receivedRecords,
    acceptedRecords: parsed.acceptedRecords,
    rejectedRecords: parsed.rejectedRecords,
    errorCode: parsed.acceptedRecords > 0 ? null : 'OUI_PARSE_EMPTY',
    message: parsed.acceptedRecords > 0 ? null : 'OUI master CSV was fetched but no usable records were parsed.',
  });
}

export function unavailableOuiStatus(args: {
  collectedAt: string;
  availability?: 'error' | 'rate_limited';
  errorCode: string;
  message: string;
}): SourceCollectionStatus {
  return collectionStatus({
    source: sourceIdentity('oui-master-database:master-csv', 'Ringmast4r OUI Master Database CSV', OUI_MASTER_CSV_URL),
    availability: args.availability ?? 'error',
    dataState: 'unavailable',
    freshness: 'unknown',
    lastAttemptAt: args.collectedAt,
    errorCode: args.errorCode,
    message: args.message,
  });
}

function normalizeOuiRow(row: CsvRow): OuiRecord | null {
  const oui = normalizeOui(row.oui);
  const manufacturer = clean(row.manufacturer);
  if (!oui || !manufacturer) return null;
  return {
    oui,
    oui_hex: oui.replace(/:/g, ''),
    manufacturer,
    registry: clean(row.registry),
    short_name: clean(row.short_name),
    device_type: clean(row.device_type),
    registered_date: clean(row.registered_date),
    address: clean(row.address),
    country: clean(row.country),
    sources: parseSources(row.sources),
  };
}

function normalizeOui(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.toUpperCase().trim();
  const mask = raw.match(/\/(\d+)$/);
  let hex = raw.replace(/\/\d+$/, '').replace(/[^A-F0-9]/g, '');
  if (mask) {
    const bits = Number(mask[1]);
    if (Number.isFinite(bits) && bits > 0) hex = hex.slice(0, Math.ceil(bits / 4));
  }
  if (![6, 7, 9, 10, 12].includes(hex.length)) return null;
  return formatOui(hex);
}

function formatOui(hex: string): string {
  return hex.match(/.{1,2}/g)?.join(':') ?? hex;
}

function parseSources(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(/[+;,]/)
    .map((source) => clampText(source, 40))
    .filter(Boolean);
}

function clean(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text || null;
}

function parseCsv(csv: string): CsvRow[] {
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
