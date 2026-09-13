import {
  buildMetadata,
  finiteNumber,
  parseDateOrNull,
  pointGeometry,
  safeUrl,
  sourceIdentity,
  stableId,
  validateGeometry,
} from './helpers';
import type { IntegrityMetadata } from './types';

export interface NormalizedFireRecord {
  id: string;
  lat: number;
  lng: number;
  brightness: number | null;
  confidence: string | number | null;
  date: string | null;
  time: string | null;
  frp: number | null;
  title?: string;
  type: 'active_fire_thermal_detection' | 'volcano_report';
  sensor: string | null;
  product: string | null;
  source: string;
  evidence_kind: 'observation' | 'report';
  integrity: IntegrityMetadata;
}

function acquisitionIso(date: string | null, time: string | null): string | null {
  if (!date) return null;
  const paddedTime = time && /^\d{1,4}$/.test(time) ? time.padStart(4, '0') : null;
  return parseDateOrNull(`${date}T${paddedTime ? `${paddedTime.slice(0, 2)}:${paddedTime.slice(2, 4)}:00` : '00:00:00'}Z`);
}

export function parseFirmsCsv(csv: string, sourceName: string, feedUrl: string, collectedAt: string, maxPoints = 2000): {
  records: NormalizedFireRecord[];
  received: number;
  rejected: number;
  sampled: boolean;
} {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return { records: [], received: 0, rejected: 0, sampled: false };

  const header = lines[0].split(',').map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const latIdx = idx('latitude');
  const lngIdx = idx('longitude');
  const brightIdx = idx('bright_ti4') !== -1 ? idx('bright_ti4') : idx('brightness');
  const confIdx = idx('confidence');
  const dateIdx = idx('acq_date');
  const timeIdx = idx('acq_time');
  const frpIdx = idx('frp');
  const instrumentIdx = idx('instrument');
  const satelliteIdx = idx('satellite');

  const source = sourceIdentity(sourceName.toLowerCase().replace(/[^a-z0-9]+/g, '-'), sourceName, feedUrl);
  const records: NormalizedFireRecord[] = [];
  const dataRows = lines.length - 1;
  const step = dataRows > maxPoints ? Math.ceil(dataRows / maxPoints) : 1;
  let rejected = 0;

  for (let i = 1; i < lines.length; i += step) {
    const cols = lines[i].split(',');
    const lat = finiteNumber(cols[latIdx]);
    const lng = finiteNumber(cols[lngIdx]);
    const geometry = pointGeometry(lng, lat);
    if (!geometry) {
      rejected++;
      continue;
    }
    const date = dateIdx >= 0 ? cols[dateIdx] || null : null;
    const time = timeIdx >= 0 ? cols[timeIdx] || null : null;
    const observedAt = acquisitionIso(date, time);
    const recordId = stableId('fire', [source.providerId, lat, lng, observedAt, cols[satelliteIdx], cols[instrumentIdx]]);
    const brightness = finiteNumber(cols[brightIdx]);
    const frp = finiteNumber(cols[frpIdx]);
    const confidenceRaw = confIdx >= 0 ? cols[confIdx] : null;
    const confidenceNum = finiteNumber(confidenceRaw);

    records.push({
      id: recordId,
      lat: geometry.coordinates[1],
      lng: geometry.coordinates[0],
      brightness,
      confidence: confidenceNum ?? confidenceRaw ?? null,
      date,
      time,
      frp,
      type: 'active_fire_thermal_detection',
      sensor: instrumentIdx >= 0 ? cols[instrumentIdx] || null : null,
      product: satelliteIdx >= 0 ? cols[satelliteIdx] || sourceName : sourceName,
      source: source.providerName,
      evidence_kind: 'observation',
      integrity: buildMetadata({
        recordId,
        upstreamId: recordId,
        source,
        itemUrl: null,
        evidenceKind: 'observation',
        timing: { observedAt, collectedAt },
        location: {
          geometry,
          representativePoint: geometry.coordinates,
          precision: 'exact',
          relationship: 'event_location',
          resolutionMethod: 'source_coordinates',
          qualityFlags: dataRows > maxPoints ? ['sampled_from_source_file'] : [],
        },
        methodology: 'NASA FIRMS active-fire / thermal detection. Detection is not independently confirmed as a wildfire incident by OVERSEER.',
      }),
    });
  }

  return { records, received: dataRows, rejected, sampled: dataRows > maxPoints };
}

export function normalizeEonetVolcanoes(input: unknown, feedUrl: string, collectedAt: string): {
  records: NormalizedFireRecord[];
  received: number;
  rejected: number;
} | null {
  if (!input || typeof input !== 'object') return null;
  const events = (input as { events?: unknown }).events;
  if (!Array.isArray(events)) return null;
  const source = sourceIdentity('nasa-eonet-volcanoes', 'NASA EONET Volcanoes', feedUrl);
  const records: NormalizedFireRecord[] = [];
  let rejected = 0;

  for (const event of events) {
    if (!event || typeof event !== 'object') {
      rejected++;
      continue;
    }
    const e = event as { id?: unknown; title?: unknown; geometry?: unknown[]; sources?: { url?: string }[] };
    const geomInput = Array.isArray(e.geometry) && e.geometry.length > 0 ? e.geometry[e.geometry.length - 1] : null;
    const geometry = validateGeometry(geomInput);
    if (!geometry || geometry.type !== 'Point') {
      rejected++;
      continue;
    }
    const observedAt = parseDateOrNull((geomInput as { date?: unknown } | null)?.date);
    const itemUrl = safeUrl(e.sources?.[0]?.url);
    const recordId = stableId('eonet-volcano', [e.id, e.title, observedAt, geometry.coordinates]);

    records.push({
      id: recordId,
      lat: geometry.coordinates[1],
      lng: geometry.coordinates[0],
      brightness: null,
      confidence: null,
      date: observedAt,
      time: null,
      frp: null,
      title: typeof e.title === 'string' ? `[VOLCANO] ${e.title}` : '[VOLCANO] NASA EONET report',
      type: 'volcano_report',
      sensor: null,
      product: 'NASA EONET',
      source: source.providerName,
      evidence_kind: 'report',
      integrity: buildMetadata({
        recordId,
        upstreamId: typeof e.id === 'string' ? e.id : null,
        source,
        itemUrl,
        evidenceKind: 'report',
        timing: { observedAt, collectedAt },
        location: {
          geometry,
          representativePoint: geometry.coordinates,
          precision: 'unknown',
          relationship: 'event_location',
          resolutionMethod: 'source_coordinates',
          qualityFlags: ['source_does_not_provide_firms_measurements'],
        },
        methodology: 'NASA EONET volcano record. Brightness, FRP, and FIRMS confidence are unsupported and kept null.',
      }),
    });
  }

  return { records, received: events.length, rejected };
}

