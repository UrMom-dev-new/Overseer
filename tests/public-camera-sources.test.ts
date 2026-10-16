import test from 'node:test';
import assert from 'node:assert/strict';
import { PUBLIC_CAMERA_SOURCES, publicCameraSourcesForRegions } from '../src/lib/public-camera-sources';
import { layerMenuGroupForKey } from '../src/lib/layer-menu';
import { normalizeDigitraffic, normalizeHongKong, normalizeOntario, normalizeSanral, normalizeSingapore, normalizeTfl, normalizeWsdot } from '../src/lib/feed-integrity/public-cameras';
import { createPublicCameraCollector } from '../src/lib/feed-integrity/public-camera-collector';

const time = Date.parse('2026-10-16T00:00:00Z');
const imageTime = '2026-10-15T23:58:00.000Z';
const sg = { api_info: { status: 'healthy' }, items: [{ cameras: [{ camera_id: 'source-1', location: { latitude: 1.4, longitude: 103.8 }, image: 'https://images.data.gov.sg/source.jpg', timestamp: imageTime }] }] };
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const hk = 'key\tregion\tdistrict\tdescription\teasting\tnorthing\tlatitude\tlongitude\turl\r\nH207F\tHong Kong\tWan Chai\t"Published, camera"\t0\t0\t22.28\t114.17\thttps://tdcctv.data.one.gov.hk/H207F.JPG\r\n';

test('all 27 source references retain permissions, evidence, scope and non-geographic catalog semantics', () => {
  assert.equal(PUBLIC_CAMERA_SOURCES.length, 27);
  assert.equal(new Set(PUBLIC_CAMERA_SOURCES.map((s) => s.source_id)).size, 27);
  for (const source of PUBLIC_CAMERA_SOURCES) {
    assert.ok(source.public_viewer_or_catalog_url.startsWith('https://'));
    assert.ok(source.reuse_and_permission_notes && source.publication_evidence_url && source.verification_scope);
    assert.equal('lat' in source, false);
  }
  assert.equal(PUBLIC_CAMERA_SOURCES.filter((s) => s.connector === 'api').length, 8);
  assert.equal(PUBLIC_CAMERA_SOURCES.find((s) => s.source_id === 'CAM-025')?.connector, 'provider_link');
  assert.equal(PUBLIC_CAMERA_SOURCES.find((s) => s.source_id === 'CAM-009')?.connector, 'review_required');
  assert.equal(layerMenuGroupForKey('cctv_sources')?.label, 'SURVEIL');
});

test('overlapping region aliases select each imported provider once', () => {
  const sources = publicCameraSourcesForRegions(['asia', 'singapore', 'hong-kong']);
  assert.deepEqual(sources.map((s) => s.source_id), ['CAM-003', 'CAM-004']);
});

test('Digitraffic keeps only active published presets, station identity and image observation times', () => {
  const station = { id: 'C01503', geometry: { type: 'Point', coordinates: [23.99, 60.05] }, properties: { name: 'Published station', collectionStatus: 'GATHERING', state: null,
    presets: [{ id: 'C0150301', inCollection: true }, { id: 'C0150302', inCollection: false }] } };
  const data = { stations: [{ presets: [{ id: 'C0150301', measuredTime: imageTime }] }] };
  const cameras = normalizeDigitraffic({ features: [station, { ...station, properties: { ...station.properties, collectionStatus: 'REMOVED_TEMPORARILY' } }, { ...station, properties: { ...station.properties, state: 'REPAIR_REQUEST_POSTED' } }] }, data);
  assert.equal(cameras.length, 1); assert.equal(cameras[0].station_id, station.id);
  assert.equal(cameras[0].feed_url, 'https://weathercam.digitraffic.fi/C0150301.jpg');
  assert.equal(cameras[0].observed_at, imageTime); assert.equal(cameras[0].snapshot_interval_ms, 600_000);
  assert.throws(() => normalizeDigitraffic({}, data));
});

test('Singapore preserves provider image/time and rejects unhealthy or malformed collections', () => {
  const camera = normalizeSingapore(sg)[0];
  assert.equal(camera.observed_at, imageTime); assert.equal(camera.feed_url, sg.items[0].cameras[0].image);
  assert.equal(camera.stream_type, 'jpg');
  assert.throws(() => normalizeSingapore({ ...sg, api_info: { status: 'unhealthy' } }));
  assert.throws(() => normalizeSingapore({ items: [] }));
  assert.equal(normalizeSingapore({ ...sg, items: [{ cameras: [{ ...sg.items[0].cameras[0], location: { latitude: 100, longitude: 103 } }] }] }).length, 0);
});

test('Hong Kong parses the published tab schema without geocoding or inventing IDs and media', () => {
  const cameras = normalizeHongKong('\uFEFF' + hk);
  assert.equal(cameras.length, 1); assert.equal(cameras[0].name, 'Published, camera');
  assert.equal(cameras[0].lat, 22.28); assert.equal(cameras[0].observed_at, null);
  assert.equal(cameras[0].feed_url, 'https://tdcctv.data.one.gov.hk/H207F.JPG');
  assert.throws(() => normalizeHongKong('<html>blocked</html>'));
});

test('Ontario accepts enabled production Views with stable camera/view IDs, never staging examples', () => {
  const camera = { Id: 41, Location: 'Published location', Latitude: 43, Longitude: -79, Views: [{ Id: 80, Status: 'Enabled', Url: 'https://511on.ca/map/Cctv/80' }, { Id: 81, Status: 'Disabled', Url: 'https://511on.ca/map/Cctv/81' }, { Id: 82, Status: 'Enabled', Url: 'https://on.stage.traveliq.co/map/Cctv/82' }] };
  const cameras = normalizeOntario([camera]); assert.equal(cameras.length, 1);
  assert.equal(cameras[0].id, 'CAM-006-41-80'); assert.equal(cameras[0].station_id, '41');
  assert.throws(() => normalizeOntario({ error: 'unauthorized' }));
});

test('WSDOT and SANRAL honor source operational flags instead of assuming online', () => {
  const w = { CameraID: 7, IsActive: true, CameraLocation: { Latitude: 47, Longitude: -122 }, ImageURL: 'https://wsdot.com/camera.jpg' };
  assert.equal(normalizeWsdot([w, { ...w, IsActive: false }]).length, 1);
  const s = { ID: '7', Disabled: false, Blocked: false, Latitude: -26, Longitude: 28, Url: 'https://i-traffic.co.za/camera.jpg' };
  assert.equal(normalizeSanral([s, { ...s, Blocked: true }, { ...s, Disabled: true }]).length, 1);
});

test('TfL preserves branding URLs and separates recorded MP4 from snapshots', () => {
  const cameras = normalizeTfl([{ id: 'JamCams_1', lat: 51, lon: 0, additionalProperties: [{ key: 'imageUrl', value: 'https://tfl.gov.uk/full.jpg' }, { key: 'videoUrl', value: 'https://tfl.gov.uk/clip.mp4' }] }]);
  assert.equal(cameras[0].feed_url, 'https://tfl.gov.uk/full.jpg'); assert.equal(cameras[0].stream_type, 'mp4');
});

test('required camera keys omit providers before any request without exposing credentials', async () => {
  const collector = createPublicCameraCollector({ env: {}, fetcher: async () => { throw new Error('Must not request'); }, now: () => time });
  const result = await collector(['ontario', 'wsdot', 'south-africa']);
  assert.equal(result.cameras.length, 0); assert.equal(result.status.length, 3);
  assert.ok(result.status.every((s) => s.availability === 'not_configured' && s.lastSuccessfulFetchAt === null));
});

test('collector coalesces and caches requests without renewing timestamps, preserving source media type', async () => {
  let calls = 0; let clock = time;
  const collector = createPublicCameraCollector({ env: {}, now: () => clock, fetcher: async () => { calls++; return json(sg); } });
  const [first] = await Promise.all([collector(['singapore']), collector(['singapore'])]);
  assert.equal(calls, 1); assert.equal(first.cameras[0].media_group, 'snapshots');
  clock += 20_000; assert.equal((await collector(['singapore'])).status[0].lastSuccessfulFetchAt, new Date(time).toISOString());
  assert.equal(calls, 1); clock += 60_000; await collector(['singapore']); assert.equal(calls, 2);
});

test('Caltrans collects all 12 districts independently and keeps successful catalogs after one fails', async () => {
  const paths: string[] = [];
  const collector = createPublicCameraCollector({ env: {}, now: () => time, fetcher: async (url) => {
    paths.push(String(url));
    if (String(url).includes('/d2/')) return new Response('unavailable', { status: 503 });
    return json({ data: [{ cctv: { index: '1', inService: 'true', location: { latitude: '38', longitude: '-121' }, imageData: { static: { currentImageURL: 'https://dot.ca.gov/image.jpg' } } } }] });
  } });
  const result = await collector(['us-west', 'caltrans']);
  assert.equal(paths.length, 12); assert.ok(paths.some((p) => p.includes('/d1/')) && paths.some((p) => p.includes('/d9/')));
  assert.equal(result.cameras.length, 11); assert.equal(result.status.filter((s) => s.availability === 'error').length, 1);
});

test('HTTP 429 cooldowns and credential-bearing exceptions never become healthy or leak keys', async () => {
  let calls = 0; let clock = time;
  const collector = createPublicCameraCollector({ env: { SANRAL_API_KEY: 'PRIVATE_TEST_KEY' }, now: () => clock, fetcher: async (url) => {
    calls++; assert.equal(new URL(String(url)).searchParams.get('key'), 'PRIVATE_TEST_KEY');
    return new Response('rate limited', { status: 429, headers: { 'Retry-After': '300' } });
  } });
  const first = await collector(['south-africa']); clock += 120_000; const cached = await collector(['south-africa']);
  assert.equal(calls, 1); assert.equal(cached.status[0].availability, 'rate_limited'); assert.equal(first.cameras.length, 0);
  assert.ok(!JSON.stringify(first).includes('PRIVATE_TEST_KEY'));
  const failure = createPublicCameraCollector({ env: { SANRAL_API_KEY: 'PRIVATE_TEST_KEY' }, fetcher: async () => { throw new Error('https://provider/?key=PRIVATE_TEST_KEY'); } });
  assert.ok(!JSON.stringify(await failure(['south-africa'])).includes('PRIVATE_TEST_KEY'));
});

test('collector decodes UTF-16 Hong Kong resources and rejects HTML, oversized bodies and timeouts', async () => {
  const bytes = Buffer.from('\uFEFF' + hk, 'utf16le');
  const collector = createPublicCameraCollector({ env: {}, fetcher: async () => new Response(bytes) });
  assert.equal((await collector(['hong-kong'])).cameras.length, 1);
  for (const fetcher of [async () => new Response('<html>blocked</html>'), async () => new Response('{}', { headers: { 'Content-Length': String(9 * 1024 * 1024) } }),
    async (_url: unknown, options?: RequestInit) => new Promise<Response>((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new Error('timeout'))))]) {
    const failed = createPublicCameraCollector({ env: {}, fetcher, timeoutMs: 5 });
    const result = await failed(['singapore']); assert.equal(result.cameras.length, 0); assert.equal(result.status[0].availability, 'error');
  }
});
