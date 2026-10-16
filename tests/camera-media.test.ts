import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraMedia, cameraMediaGroup, cameraSnapshotUrl, cameraVideoStatus, cameraYouTubeId, type CameraVideoEvidence } from '../src/lib/camera-media';
import { caltransCatalogUrl, classifyCameraCatalog, normalizeCaltransCameras } from '../src/lib/feed-integrity/camera-catalog';
import { createCameraYouTubeResolver, resolveCameraYouTubePage } from '../src/lib/feed-integrity/live-news';
import { layerMenuGroupForKey } from '../src/lib/layer-menu';

const now = Date.parse('2026-10-16T00:00:00Z');
const checkedAt = new Date(now).toISOString();
const videoId = 'CameraLive1';
const current = { videoDetails: { videoId, channelId: 'camera-channel', isLive: true }, playabilityStatus: { status: 'OK', playableInEmbed: true } };
const page = (value: unknown = current) => `<script>var ytInitialPlayerResponse = ${JSON.stringify(value)};</script>`;
const response = () => new Response(page(), { headers: { 'Content-Type': 'text/html' } });

test('published HLS takes precedence over the snapshot of the same camera', () => {
  const camera = { stream_url: 'https://camera.example/live.m3u8?token=source', feed_url: 'https://camera.example/latest.jpg', stream_type: 'hls' };
  assert.equal(cameraMedia(camera).kind, 'hls');
  assert.equal(cameraMedia(camera).url, camera.stream_url);
  assert.equal(cameraMedia(camera).snapshotUrl, camera.feed_url);
  assert.equal(cameraMediaGroup(camera), 'live');
});

test('JPGs, legacy image-only URLs and MP4s cannot be classified as live video', () => {
  for (const camera of [{ feed_url: 'https://camera.example/latest.jpg' }, { stream_url: 'https://camera.example/axis-cgi/jpg/image.cgi', stream_type: 'jpg' },
    { stream_url: 'https://camera.example/still.jpg', stream_type: 'hls' }, { stream_url: 'https://camera.example/clip.mp4', stream_type: 'mp4' }]) {
    assert.equal(cameraMediaGroup(camera), 'snapshots');
  }
  assert.equal(cameraMedia({ stream_url: 'https://camera.example/latest.jpg', stream_type: 'jpg' }).snapshotUrl, 'https://camera.example/latest.jpg');
  assert.equal(cameraMedia({ stream_url: 'https://camera.example/clip.mp4' }).kind, 'clip');
});

test('provider iframes and external pages remain unverified player links, not live video', () => {
  const greek = { stream_url: 'https://ipcamlive.com/player/player.php?alias=cam128', feed_url: 'https://ipcamlive.com/player/player.php?alias=cam128', stream_type: 'iframe' };
  assert.equal(cameraMedia(greek).kind, 'embed');
  assert.equal(cameraMedia(greek).snapshotUrl, null);
  assert.equal(cameraMediaGroup(greek), 'external');
  assert.equal(cameraMedia({ stream_url: 'https://unknown.example/embed', stream_type: 'iframe' }).kind, 'external');
  assert.equal(cameraMedia({ external_url: 'https://camera.example/player' }).kind, 'external');
});

test('media URLs reject executable schemes and credentials; YouTube lookup pins host and concrete video ID', () => {
  for (const url of ['javascript:alert(1)', 'file:///private/data', 'data:text/html,anything', 'https://user:pass@camera.example/live.m3u8']) {
    assert.equal(cameraMedia({ stream_url: url, stream_type: 'hls' }).kind, 'unavailable');
  }
  for (const url of ['https://youtube.com.evil.example/embed/CameraLive1', 'https://camera.example/?youtube.com/embed/CameraLive1', 'https://www.youtube.com/embed/../private', 'https://www.youtube.com/@channel/live']) assert.equal(cameraYouTubeId(url), null);
  assert.equal(cameraYouTubeId('https://www.youtube.com/embed/CameraLive1?autoplay=1'), videoId);
  assert.equal(cameraMedia({ stream_url: 'https://www.youtube.com/embed/CameraLive1', stream_type: 'iframe' }).kind, 'youtube');
});

test('snapshot refresh changes query identity without removing provider parameters', () => {
  const refreshed = new URL(cameraSnapshotUrl('https://camera.example/image.cgi?camera=3&token=source#view', now));
  assert.equal(refreshed.searchParams.get('camera'), '3');
  assert.equal(refreshed.searchParams.get('token'), 'source');
  assert.equal(refreshed.searchParams.get('_overseer'), String(now));
  assert.equal(refreshed.hash, '#view');
});

const evidence: CameraVideoEvidence = { startedAt: now - 20_000, hasFrames: true, paused: false, ended: false, livePlaylist: true,
  playlistAdvancedAt: now - 1000, frameAdvancedAt: now - 100, maxPlaylistSilenceMs: 30_000, programDateTime: null };

test('live label requires advancing frames and live playlist updates, not merely a manifest or image load', () => {
  assert.equal(cameraVideoStatus(evidence, now), 'Live video');
  assert.equal(cameraVideoStatus({ ...evidence, playlistAdvancedAt: null }, now), 'Checking live updates');
  assert.equal(cameraVideoStatus({ ...evidence, frameAdvancedAt: null }, now), 'Video stalled');
  assert.equal(cameraVideoStatus({ ...evidence, hasFrames: false }, now), 'Loading video');
  assert.equal(cameraVideoStatus({ ...evidence, livePlaylist: null }, now), 'Playback unverified');
});

test('stalls, pauses, ended streams and VOD playlists immediately lose live status', () => {
  assert.equal(cameraVideoStatus({ ...evidence, frameAdvancedAt: now - 11_000 }, now), 'Video stalled');
  assert.equal(cameraVideoStatus({ ...evidence, playlistAdvancedAt: now - 31_000 }, now), 'Live updates stalled');
  assert.equal(cameraVideoStatus({ ...evidence, playlistAdvancedAt: null, startedAt: now - 31_000 }, now), 'Live updates unavailable');
  assert.equal(cameraVideoStatus({ ...evidence, paused: true }, now), 'Paused');
  assert.equal(cameraVideoStatus({ ...evidence, ended: true }, now), 'Stream ended');
  assert.equal(cameraVideoStatus({ ...evidence, livePlaylist: false }, now), 'Not a live stream');
  assert.equal(cameraVideoStatus({ ...evidence, hasFrames: false, startedAt: now - 26_000 }, now), 'Video unavailable');
});

test('expired or implausibly future provider video time cannot pass as current live delivery', () => {
  assert.equal(cameraVideoStatus({ ...evidence, programDateTime: now - 121_000 }, now), 'Source video expired');
  assert.equal(cameraVideoStatus({ ...evidence, programDateTime: now + 31_000 }, now), 'Source video expired');
  assert.equal(cameraVideoStatus({ ...evidence, programDateTime: now - 20_000 }, now), 'Live video');
});

test('Caltrans URLs follow the documented district path, not nonexistent zero-padded directories', () => {
  assert.equal(caltransCatalogUrl(3), 'https://cwwp2.dot.ca.gov/data/d3/cctv/cctvStatusD03.json');
  assert.equal(caltransCatalogUrl(12), 'https://cwwp2.dot.ca.gov/data/d12/cctv/cctvStatusD12.json');
  for (const value of [0, 13, NaN, 3.5]) assert.throws(() => caltransCatalogUrl(value));
});

test('Caltrans preserves only source-published streams and skips out-of-service cameras', () => {
  const cctv = { index: '31', inService: 'true', location: { latitude: '38.48', longitude: '-121.51', locationName: 'Source intersection' }, imageData: {
    streamingVideoURL: 'https://media.example/camera.stream/playlist.m3u8', static: { currentImageURL: 'https://source.example/still.jpg', currentImageUpdateFrequency: '1' } } };
  const cameras = normalizeCaltransCameras({ data: [{ cctv }, { cctv: { ...cctv, index: '32', inService: 'false' } }] }, 3);
  assert.equal(cameras.length, 1);
  assert.equal(cameras[0].id, 'cal-d3-31');
  assert.equal(cameras[0].stream_url, cctv.imageData.streamingVideoURL);
  assert.equal(cameras[0].snapshot_interval_ms, 60_000);
  assert.equal(cameraMediaGroup(cameras[0]), 'live');
  const snapshot = normalizeCaltransCameras({ data: [{ cctv: { ...cctv, imageData: { ...cctv.imageData, streamingVideoURL: 'Not Reported' } } }] }, 3);
  assert.equal(cameraMediaGroup(snapshot[0]), 'snapshots');
  assert.equal(snapshot[0].stream_url, null);
});

test('catalog classification handles old snapshots, rejects malformed coordinates and distinguishes catalog availability from playback', () => {
  const camera = { id: 'camera1', name: 'Source camera', lat: 0, lng: 0, feed_url: 'https://camera.example/image.jpg' };
  const cameras = classifyCameraCatalog([camera, camera, { ...camera, id: 'invalid', lat: 200 }, { ...camera, id: 'empty', feed_url: null }]);
  assert.equal(cameras.length, 1);
  assert.equal(cameras[0].media_group, 'snapshots');
  assert.equal(cameras[0].playback_verification, 'not_checked');
  assert.equal(layerMenuGroupForKey('cctv')?.label, 'SURVEIL');
  assert.equal(layerMenuGroupForKey('cctv_snapshots')?.label, 'SURVEIL');
  assert.equal(layerMenuGroupForKey('cctv_external')?.label, 'SURVEIL');
});

test('YouTube camera checks reject recorded, scheduled, unrelated and restricted videos', () => {
  assert.equal(resolveCameraYouTubePage(videoId, page(), checkedAt).state, 'ready');
  for (const details of [{ ...current.videoDetails, isLive: false, isLiveContent: true }, { ...current.videoDetails, isUpcoming: true }, { ...current.videoDetails, videoId: 'OtherVideo1' }]) {
    assert.equal(resolveCameraYouTubePage(videoId, page({ ...current, videoDetails: details }), checkedAt).state, 'unavailable');
  }
  assert.equal(resolveCameraYouTubePage(videoId, page({ ...current, playabilityStatus: { status: 'OK', playableInEmbed: false } }), checkedAt).state, 'external');
  assert.equal(resolveCameraYouTubePage(videoId, '<html>blocked</html>', checkedAt).state, 'unavailable');
});

test('camera YouTube requests are bounded, coalesced and cached without renewing verification time', async () => {
  let time = now;
  let calls = 0;
  const resolver = createCameraYouTubeResolver({ now: () => time, fetcher: async (url, options) => {
    calls++;
    assert.equal(url, `https://www.youtube.com/watch?v=${videoId}`);
    assert.equal(options?.redirect, 'error');
    return response();
  } });
  assert.equal(await resolver('https://127.0.0.1'), null);
  const results = await Promise.all([resolver(videoId), resolver(videoId)]);
  assert.equal(calls, 1);
  time += 1000;
  assert.equal((await resolver(videoId))?.checkedAt, checkedAt);
  assert.equal(results[0]?.state, 'ready');
  time += 30_000;
  await resolver(videoId);
  assert.equal(calls, 2);
});

test('failed, oversized and timed-out YouTube camera checks remain unavailable', async () => {
  for (const fetcher of [async () => new Response('No', { status: 503 }), async () => new Response('{}', { headers: { 'Content-Type': 'text/html', 'Content-Length': String(4 * 1024 * 1024) } }),
    async (_url: unknown, options?: RequestInit) => new Promise<Response>((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new Error('timeout'))))]) {
    const resolver = createCameraYouTubeResolver({ fetcher, now: () => now, timeoutMs: 5 });
    assert.equal((await resolver(videoId))?.state, 'unavailable');
  }
});
