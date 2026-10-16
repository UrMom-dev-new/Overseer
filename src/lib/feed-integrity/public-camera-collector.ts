import { CAMERA_CONNECTORS, publicCameraSourcesForRegions } from '../public-camera-sources';
import { caltransCatalogUrl, classifyCameraCatalog, normalizeCaltransCameras } from './camera-catalog';
import { collectionStatus, sourceIdentity } from './helpers';
import type { SourceCollectionStatus } from './types';
import { normalizeDigitraffic, normalizeHongKong, normalizeOntario, normalizeSanral, normalizeSingapore, normalizeTfl, normalizeWsdot, type PublicCamera } from './public-cameras';

export interface CameraCollection { cameras: PublicCamera[]; status: SourceCollectionStatus[] }
const ENDPOINTS: Record<string, string> = {
  'CAM-001': 'https://tie.digitraffic.fi/api/weathercam/v1/stations',
  'CAM-003': 'https://api.data.gov.sg/v1/transport/traffic-images',
  'CAM-004': 'https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_En.csv',
  'CAM-005': 'https://api.tfl.gov.uk/Place/Type/JamCam',
  'CAM-006': 'https://511on.ca/api/v2/get/cameras',
  'CAM-007': 'https://wsdot.wa.gov/traffic/api/HighwayCameras/HighwayCamerasREST.svc/GetCamerasAsJson',
  'CAM-008': 'https://www.i-traffic.co.za/api/getcameras',
};

export function createPublicCameraCollector(options: { fetcher?: typeof fetch; now?: () => number; env?: Record<string, string | undefined>; timeoutMs?: number } = {}) {
  const fetcher = options.fetcher ?? fetch; const now = options.now ?? Date.now;
  const env = options.env ?? process.env;
  const cache = new Map<string, { until: number; value: CameraCollection }>();
  const pending = new Map<string, Promise<CameraCollection>>();
  async function collect(sourceId: string, title: string, district?: number): Promise<CameraCollection> {
    const key = `${sourceId}${district ? `:d${district}` : ''}`;
    const cached = cache.get(key);
    if (cached && cached.until > now()) return cached.value;
    const inflight = pending.get(key); if (inflight) return inflight;
    const work = (async () => {
      const policy = CAMERA_CONNECTORS[sourceId]; const secret = policy.env ? env[policy.env]?.trim() : undefined;
      const endpoint = district ? caltransCatalogUrl(district) : ENDPOINTS[sourceId];
      const source = sourceIdentity(`cctv:${key}`, title, endpoint);
      const collectedAt = new Date(now()).toISOString();
      if (policy.env && !policy.optionalKey && !secret) return { cameras: [], status: [collectionStatus({ source, availability: 'not_configured', dataState: 'unavailable', freshness: 'unknown', lastAttemptAt: collectedAt, message: `Set ${policy.env} to enable this official camera API. Public viewer remains available in Camera Sources.` })] };
      let retryMs = 60_000;
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
      try {
        const requestUrl = new URL(endpoint); const headers: Record<string, string> = { Accept: sourceId === 'CAM-004' ? 'text/csv,text/plain' : 'application/json' };
        if (sourceId === 'CAM-001') { headers['Digitraffic-User'] = 'Overseer/PublicCameraCatalog'; headers['Accept-Encoding'] = 'gzip'; }
        if (sourceId === 'CAM-003' && secret) headers['x-api-key'] = secret;
        if (secret && ['CAM-005', 'CAM-006', 'CAM-007', 'CAM-008'].includes(sourceId)) requestUrl.searchParams.set(sourceId === 'CAM-005' ? 'app_key' : sourceId === 'CAM-007' ? 'AccessCode' : 'key', secret);
        if (sourceId === 'CAM-006' || sourceId === 'CAM-008') requestUrl.searchParams.set('format', 'json');
        const read = async (url: string): Promise<Uint8Array> => {
          const response = await fetcher(url, { headers, signal: controller.signal, cache: 'no-store', redirect: 'error' });
          if (!response.ok) {
            const retry = response.headers.get('retry-after'); const seconds = Number(retry);
            if (retry) retryMs = Math.max(60_000, Math.min(86_400_000, Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retry) - now() || 60_000));
            throw new Error(`HTTP ${response.status}`);
          }
          if (Number(response.headers.get('content-length')) > 8 * 1024 * 1024) throw new Error('Response too large');
          const reader = response.body?.getReader(); if (!reader) throw new Error('Missing response body');
          const chunks: Uint8Array[] = []; let size = 0;
          try {
            for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 8 * 1024 * 1024) throw new Error('Response too large'); chunks.push(value); }
          } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
          const bytes = new Uint8Array(size); let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
          return bytes;
        };
        const bytes = await read(requestUrl.toString());
        const text = new TextDecoder(sourceId === 'CAM-004' && bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le' : 'utf-8').decode(bytes);
        let cameras: PublicCamera[];
        if (sourceId === 'CAM-004') cameras = normalizeHongKong(text);
        else {
          const data: unknown = JSON.parse(text);
          if (sourceId === 'CAM-001') cameras = normalizeDigitraffic(data, JSON.parse(new TextDecoder().decode(await read(`${endpoint}/data`))));
          else if (sourceId === 'CAM-002') {
            if (!data || typeof data !== 'object' || !Array.isArray((data as { data?: unknown }).data)) throw new Error('Invalid Caltrans response');
            cameras = normalizeCaltransCameras(data, district!).map((camera) => ({ ...camera, catalog_source_id: sourceId, district, attribution: 'California Department of Transportation' }));
          } else cameras = ({ 'CAM-003': normalizeSingapore, 'CAM-005': normalizeTfl, 'CAM-006': normalizeOntario, 'CAM-007': normalizeWsdot, 'CAM-008': normalizeSanral }[sourceId]!)(data);
        }
        cameras = classifyCameraCatalog(cameras);
        return { cameras, status: [collectionStatus({ source, availability: 'ok', dataState: cameras.length ? 'present' : 'empty', freshness: 'unknown', lastAttemptAt: collectedAt,
          lastSuccessfulFetchAt: collectedAt, receivedRecords: cameras.length, acceptedRecords: cameras.length, message: 'Camera access catalog collected. Media is checked on open, not prevalidated as live.' })] };
      } catch (error) {
        // Never return exception text that might include a credential-bearing request URL.
        const code = controller.signal.aborted ? 'TIMEOUT' : error instanceof Error && /^HTTP \d+$/.test(error.message) ? error.message : 'INVALID_OR_UNAVAILABLE';
        return { cameras: [], status: [collectionStatus({ source, availability: code === 'HTTP 429' ? 'rate_limited' : 'error', dataState: 'unavailable', freshness: 'unknown', lastAttemptAt: collectedAt,
          errorCode: code, nextRetryAt: new Date(now() + retryMs).toISOString(), message: 'Camera source unavailable; its records were omitted. Open the provider from Camera Sources.' })] };
      } finally { clearTimeout(timer); }
    })();
    pending.set(key, work);
    try { const value = await work; cache.set(key, { value, until: Math.max(now() + 60_000, ...value.status.map((s) => s.nextRetryAt ? Date.parse(s.nextRetryAt) : 0)) }); return value; }
    finally { pending.delete(key); }
  }
  return async (regions: string[]): Promise<CameraCollection> => {
    const jobs = publicCameraSourcesForRegions(regions).flatMap((source) => source.source_id === 'CAM-002' ?
      Array.from({ length: 12 }, (_, i) => collect(source.source_id, `${source.source_name} / District ${i + 1}`, i + 1)) : [collect(source.source_id, source.source_name)]);
    const results = await Promise.all(jobs);
    return { cameras: results.flatMap((result) => result.cameras), status: results.flatMap((result) => result.status) };
  };
}

export const collectPublicCameras = createPublicCameraCollector();
