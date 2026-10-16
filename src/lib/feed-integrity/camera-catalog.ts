import { cameraMedia, cameraMediaGroup, cameraUrl } from '../camera-media';
import { finiteNumber, isValidLngLat } from './helpers';

export function caltransCatalogUrl(district: number): string {
  if (!Number.isInteger(district) || district < 1 || district > 12) throw new Error('Invalid Caltrans district');
  return `https://cwwp2.dot.ca.gov/data/d${district}/cctv/cctvStatusD${String(district).padStart(2, '0')}.json`;
}

export function normalizeCaltransCameras(payload: unknown, district: number): Record<string, unknown>[] {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { data?: unknown }).data)) return [];
  const cameras: Record<string, unknown>[] = [];
  for (const row of (payload as { data: Array<{ cctv?: Record<string, unknown> }> }).data) {
    const camera = row?.cctv;
    if (!camera || String(camera.inService).toLowerCase() !== 'true') continue;
    const location = camera.location as Record<string, unknown> | undefined;
    const images = camera.imageData as { streamingVideoURL?: unknown; static?: { currentImageURL?: unknown; currentImageUpdateFrequency?: unknown } } | undefined;
    const lat = finiteNumber(location?.latitude); const lng = finiteNumber(location?.longitude);
    const stream = cameraUrl(images?.streamingVideoURL);
    const snapshot = cameraUrl(images?.static?.currentImageURL);
    if (!isValidLngLat(lng, lat) || (!stream && !snapshot) || typeof camera.index !== 'string') continue;
    const value = { id: `cal-d${district}-${camera.index}`, lat, lng, name: location?.locationName || 'Caltrans camera',
      city: location?.nearbyPlace || 'California', country: 'US', source: 'Caltrans',
      feed_url: snapshot, stream_url: stream, stream_type: stream && /\.m3u8(?:$|\?)/i.test(stream) ? 'hls' : undefined,
      external_url: stream, snapshot_interval_ms: Math.max(5000, (finiteNumber(images?.static?.currentImageUpdateFrequency) ?? 1) * 60_000) };
    if (cameraMediaGroup(value) !== 'unavailable') cameras.push(value);
  }
  return cameras;
}

export function classifyCameraCatalog(cameras: unknown[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  return cameras.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const camera = value as Record<string, unknown>;
    if (typeof camera.id !== 'string' || !camera.id || typeof camera.name !== 'string' || !isValidLngLat(camera.lng, camera.lat) || seen.has(camera.id)) return [];
    const media = cameraMedia(camera);
    if (media.kind === 'unavailable') return [];
    seen.add(camera.id);
    return [{ ...camera, media_kind: media.kind, media_group: cameraMediaGroup(camera), playback_verification: 'not_checked' }];
  });
}
