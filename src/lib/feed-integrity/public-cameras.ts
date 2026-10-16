import { cameraUrl } from '../camera-media';
import { finiteNumber, isValidLngLat, parseDateOrNull } from './helpers';
import { parseCsv } from './surveillance-capabilities';

export type PublicCamera = Record<string, unknown>;
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const id = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : null;
const name = (value: unknown, fallback: string) => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const imageUrl = (value: unknown) => {
  const url = cameraUrl(value);
  return url && !/(?:^|[.-])(?:stage|staging|example|localhost)(?:[.:/-]|$)/i.test(new URL(url).hostname) ? url : null;
};

function snapshot(sourceId: string, upstreamId: string, title: string, latValue: unknown, lngValue: unknown, urlValue: unknown, interval: number, observedAt: unknown = null): PublicCamera | null {
  const lat = finiteNumber(latValue); const lng = finiteNumber(lngValue); const url = imageUrl(urlValue);
  if (!isValidLngLat(lng, lat) || !url) return null;
  return { id: `${sourceId}-${upstreamId}`, upstream_id: upstreamId, catalog_source_id: sourceId, name: title, lat, lng,
    feed_url: url, stream_type: 'jpg', snapshot_interval_ms: interval, observed_at: parseDateOrNull(observedAt) };
}

export function normalizeDigitraffic(metadata: unknown, observations: unknown): PublicCamera[] {
  const features = record(metadata).features;
  const stations = record(observations).stations;
  if (!Array.isArray(features) || !Array.isArray(stations)) throw new Error('Invalid Digitraffic camera response');
  const times = new Map<string, unknown>();
  for (const raw of stations) for (const preset of Array.isArray(record(raw).presets) ? record(raw).presets as unknown[] : []) {
    const p = record(preset); if (id(p.id)) times.set(id(p.id)!, p.measuredTime);
  }
  return features.flatMap((raw) => {
    const f = record(raw); const p = record(f.properties); const g = record(f.geometry);
    if (g.type !== 'Point' || !Array.isArray(g.coordinates) || p.collectionStatus !== 'GATHERING' ||
      (p.state !== null && p.state !== undefined && !['OK', 'OK_FAULT_DOUBT_CANCELLED', 'REPAIR_MAINTENANCE_DONE'].includes(String(p.state)))) return [];
    const coordinates = g.coordinates;
    return (Array.isArray(p.presets) ? p.presets : []).flatMap((rawPreset) => {
      const preset = record(rawPreset); const presetId = id(preset.id);
      if (preset.inCollection !== true || !presetId || !/^C\d{7}$/.test(presetId)) return [];
      // Digitraffic documents this image template for catalog-published preset IDs.
      const camera = snapshot('CAM-001', presetId, `${name(p.name, String(f.id))} / ${presetId}`, coordinates[1], coordinates[0],
        `https://weathercam.digitraffic.fi/${presetId}.jpg`, 600_000, times.get(presetId));
      return camera ? [{ ...camera, station_id: f.id, preset_id: presetId, country: 'Finland', city: '', source: 'Fintraffic Digitraffic',
        attribution: 'Fintraffic / Digitraffic, CC BY 4.0', external_url: 'https://liikennetilanne.fintraffic.fi/' }] : [];
    });
  });
}

export function normalizeSingapore(payload: unknown): PublicCamera[] {
  const root = record(payload);
  if (record(root.api_info).status !== 'healthy' || !Array.isArray(root.items) || !root.items.length || !Array.isArray(record(root.items[0]).cameras)) throw new Error('Invalid or unhealthy Singapore camera response');
  return (record(root.items[0]).cameras as unknown[]).flatMap((raw) => {
    const c = record(raw); const key = id(c.camera_id); const l = record(c.location);
    const camera = key ? snapshot('CAM-003', key, `LTA camera ${key}`, l.latitude, l.longitude, c.image, 60_000, c.timestamp) : null;
    return camera ? [{ ...camera, country: 'Singapore', city: 'Singapore', source: 'LTA / data.gov.sg', attribution: 'Land Transport Authority / data.gov.sg, Singapore Open Data Licence' }] : [];
  });
}

export function normalizeHongKong(text: string): PublicCamera[] {
  const clean = text.replace(/^\uFEFF/, '');
  if (!/^key\tregion\tdistrict\tdescription\teasting\tnorthing\tlatitude\tlongitude\turl\r?\n/i.test(clean)) throw new Error('Invalid Hong Kong camera locations schema');
  return parseCsv(clean, '\t').flatMap((c) => {
    const camera = id(c.key) ? snapshot('CAM-004', c.key, c.description, c.latitude, c.longitude, c.url, 120_000) : null;
    return camera ? [{ ...camera, country: 'Hong Kong', city: c.district, source: 'Hong Kong Transport Department', attribution: 'Hong Kong Transport Department / DATA.GOV.HK' }] : [];
  });
}

export function normalizeOntario(payload: unknown): PublicCamera[] {
  if (!Array.isArray(payload)) throw new Error('Invalid Ontario camera response');
  return payload.flatMap((raw) => {
    const c = record(raw); const key = id(c.Id);
    if (!key || !Array.isArray(c.Views)) return [];
    return c.Views.flatMap((rawView) => {
      const v = record(rawView); const viewId = id(v.Id);
      const camera = v.Status === 'Enabled' && viewId ? snapshot('CAM-006', `${key}-${viewId}`, [name(c.Location, `Ontario camera ${key}`), v.Description, c.Direction].filter(Boolean).join(' / '), c.Latitude, c.Longitude, v.Url, 60_000) : null;
      return camera ? [{ ...camera, station_id: key, view_id: viewId, city: 'Ontario', country: 'Canada', source: 'Ontario 511', attribution: 'Ontario Ministry of Transportation / Ontario 511' }] : [];
    });
  });
}

export function normalizeWsdot(payload: unknown): PublicCamera[] {
  if (!Array.isArray(payload)) throw new Error('Invalid WSDOT camera response');
  return payload.flatMap((raw) => {
    const c = record(raw); const key = id(c.CameraID); const l = record(c.CameraLocation);
    const camera = c.IsActive === true && key ? snapshot('CAM-007', key, name(c.Title, `WSDOT camera ${key}`), l.Latitude, l.Longitude, c.ImageURL, 60_000) : null;
    return camera ? [{ ...camera, city: 'Washington', country: 'US', source: 'WSDOT', attribution: 'Washington State Department of Transportation' }] : [];
  });
}

export function normalizeSanral(payload: unknown): PublicCamera[] {
  if (!Array.isArray(payload)) throw new Error('Invalid SANRAL camera response');
  return payload.flatMap((raw) => {
    const c = record(raw); const key = id(c.ID);
    const camera = c.Disabled === false && c.Blocked === false && key ? snapshot('CAM-008', key, name(c.Name, `SANRAL camera ${key}`), c.Latitude, c.Longitude, c.Url, 60_000) : null;
    return camera ? [{ ...camera, city: '', country: 'South Africa', source: 'SANRAL i-TRAFFIC', attribution: 'SANRAL / i-TRAFFIC' }] : [];
  });
}

export function normalizeTfl(payload: unknown): PublicCamera[] {
  if (!Array.isArray(payload)) throw new Error('Invalid TfL camera response');
  return payload.flatMap((raw) => {
    const c = record(raw); const key = id(c.id);
    const props = Array.isArray(c.additionalProperties) ? c.additionalProperties.map(record) : [];
    const prop = (key: string) => props.find((p) => p.key === key)?.value;
    if (!key || prop('available') === 'false') return [];
    const camera = snapshot('CAM-005', key, name(c.commonName, key), c.lat, c.lon, prop('imageUrl'), 180_000);
    const video = imageUrl(prop('videoUrl'));
    if (!camera) return [];
    return [{ ...camera, stream_url: video, stream_type: video ? 'mp4' : 'jpg', city: 'London', country: 'UK', source: 'TfL', attribution: 'Transport for London' }];
  });
}
