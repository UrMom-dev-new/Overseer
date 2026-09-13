import {
  buildMetadata,
  parseDateOrNull,
  safeUrl,
  sourceIdentity,
  stableId,
  validateGeometry,
  representativePoint,
} from './helpers';
import type { GeoJsonGeometry, IntegrityMetadata } from './types';

export interface NormalizedWeatherEvent {
  id: string;
  title: string;
  category: string;
  type: string;
  icon: string;
  severity: string | null;
  severity_source: string | null;
  lat: number | null;
  lng: number | null;
  date: string | null;
  expires: string | null;
  area?: string | null;
  source: string;
  provider: 'NASA EONET' | 'NOAA/NWS';
  geometry: GeoJsonGeometry | null;
  geometry_label: string;
  evidence_kind: 'observation' | 'report';
  integrity: IntegrityMetadata;
}

export function normalizeNwsAlerts(input: unknown, feedUrl: string, collectedAt: string): {
  records: NormalizedWeatherEvent[];
  received: number;
  rejected: number;
} | null {
  if (!input || typeof input !== 'object') return null;
  const features = (input as { features?: unknown }).features;
  if (!Array.isArray(features)) return null;
  const source = sourceIdentity('noaa-nws-alerts', 'NOAA/NWS Active Alerts', feedUrl);
  const records: NormalizedWeatherEvent[] = [];
  let rejected = 0;

  for (const feature of features) {
    if (!feature || typeof feature !== 'object') {
      rejected++;
      continue;
    }
    const f = feature as { geometry?: unknown; properties?: Record<string, unknown> };
    const props = f.properties || {};
    const geometry = validateGeometry(f.geometry);
    const point = representativePoint(geometry);
    const sourceUrl = safeUrl(props['@id']) || feedUrl;
    const id = typeof props.id === 'string' ? props.id : typeof props['@id'] === 'string' ? props['@id'] : null;
    const recordId = stableId('nws-alert', [id, props.event, props.effective, props.sent, props.areaDesc]);

    records.push({
      id: recordId,
      title: typeof props.headline === 'string' ? props.headline : typeof props.event === 'string' ? props.event : 'NWS Weather Alert',
      category: 'weatherAlerts',
      type: typeof props.event === 'string' ? props.event : 'Weather Alert',
      icon: 'weather',
      severity: typeof props.severity === 'string' ? props.severity : null,
      severity_source: typeof props.severity === 'string' ? 'NWS severity' : null,
      lat: point ? point[1] : null,
      lng: point ? point[0] : null,
      date: parseDateOrNull(props.effective) || parseDateOrNull(props.sent),
      expires: parseDateOrNull(props.expires),
      area: typeof props.areaDesc === 'string' ? props.areaDesc : null,
      source: sourceUrl,
      provider: 'NOAA/NWS',
      geometry,
      geometry_label: geometry ? (geometry.type === 'Point' ? 'Source point geometry' : 'Source warning area; representative point is approximate') : 'Area specified; geometry unavailable',
      evidence_kind: 'report',
      integrity: buildMetadata({
        recordId,
        upstreamId: id,
        source,
        itemUrl: sourceUrl,
        evidenceKind: 'report',
        timing: {
          publishedAt: parseDateOrNull(props.sent),
          observedAt: parseDateOrNull(props.effective),
          sourceUpdatedAt: parseDateOrNull(props.effective),
          expiresAt: parseDateOrNull(props.expires),
          collectedAt,
        },
        location: {
          geometry,
          representativePoint: point,
          precision: geometry?.type === 'Point' ? 'exact' : geometry ? 'region' : 'unknown',
          relationship: geometry ? 'event_location' : 'unknown',
          resolutionMethod: geometry ? 'source_geojson_geometry' : null,
          qualityFlags: geometry && geometry.type !== 'Point' ? ['representative_point_is_approximate'] : geometry ? [] : ['geometry_unavailable'],
        },
        methodology: 'NWS source alert. Polygon/MultiPolygon geometries are preserved; representative points are approximate navigation aids.',
      }),
    });
  }

  return { records, received: features.length, rejected };
}

export function normalizeEonetWeather(input: unknown, feedUrl: string, collectedAt: string): {
  records: NormalizedWeatherEvent[];
  received: number;
  rejected: number;
} | null {
  if (!input || typeof input !== 'object') return null;
  const events = (input as { events?: unknown }).events;
  if (!Array.isArray(events)) return null;
  const source = sourceIdentity('nasa-eonet', 'NASA EONET', feedUrl);
  const records: NormalizedWeatherEvent[] = [];
  let rejected = 0;

  for (const event of events) {
    if (!event || typeof event !== 'object') {
      rejected++;
      continue;
    }
    const e = event as { id?: unknown; title?: unknown; categories?: { id?: string; title?: string }[]; geometry?: unknown[]; sources?: { url?: string }[] };
    const category = e.categories?.[0]?.id || 'unknown';
    if (category === 'wildfires' || category === 'earthquakes') continue;
    const geomInput = Array.isArray(e.geometry) && e.geometry.length > 0 ? e.geometry[e.geometry.length - 1] : null;
    const geometry = validateGeometry(geomInput);
    const point = representativePoint(geometry);
    if (!geometry || !point) {
      rejected++;
      continue;
    }
    const itemUrl = safeUrl(e.sources?.[0]?.url);
    const observedAt = parseDateOrNull((geomInput as { date?: unknown } | null)?.date);
    const recordId = stableId('eonet-weather', [e.id, e.title, observedAt, point]);
    const typeLabel = category === 'severeStorms'
      ? 'Severe Storm'
      : category === 'volcanoes'
        ? 'Volcano Report'
        : category === 'seaIce'
          ? 'Iceberg / Sea Ice'
          : e.categories?.[0]?.title || 'Anomaly';

    records.push({
      id: recordId,
      title: typeof e.title === 'string' ? e.title : 'NASA EONET Event',
      category,
      type: typeLabel,
      icon: category === 'severeStorms' ? 'cyclone' : category === 'volcanoes' ? 'volcano' : category === 'seaIce' ? 'ice' : 'alert',
      severity: null,
      severity_source: null,
      lat: point[1],
      lng: point[0],
      date: observedAt,
      expires: null,
      area: null,
      source: itemUrl || source.providerName,
      provider: 'NASA EONET',
      geometry,
      geometry_label: 'Source event geometry',
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
          representativePoint: point,
          precision: geometry.type === 'Point' ? 'exact' : 'region',
          relationship: 'event_location',
          resolutionMethod: 'source_geometry',
          qualityFlags: [],
        },
        methodology: 'NASA EONET event report. OVERSEER does not infer severity when source severity is absent.',
      }),
    });
  }

  return { records, received: events.length, rejected };
}
