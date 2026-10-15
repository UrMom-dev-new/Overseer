import test from 'node:test';
import assert from 'node:assert/strict';
import { getLiveNewsFeed, LIVE_NEWS_FEEDS } from '../src/lib/live-news-catalog';
import { createLiveNewsResolver, resolveLiveNewsPage } from '../src/lib/feed-integrity/live-news';
import { liveNewsEmbedUrl, liveNewsPlayerError } from '../src/lib/live-news-player';

const nowMs = Date.parse('2026-10-15T12:00:00Z');
const checkedAt = new Date(nowMs).toISOString();
const feed = getLiveNewsFeed('france24en')!;
const player = {
  videoDetails: { videoId: 'LiveNews001', channelId: feed.channel_id, isLive: true, isLiveContent: true,
    title: 'A title with } braces, "quotes" and \\ escapes' },
  playabilityStatus: { status: 'OK', playableInEmbed: true },
};
const page = (value: unknown = player) => `<html><script>var ytInitialPlayerResponse = ${JSON.stringify(value)}; window.untrustedCode = true;</script></html>`;
const htmlResponse = (body = page()) => new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });

test('a current embeddable live video resolves to a concrete video ID and watch URL', () => {
  const result = resolveLiveNewsPage(feed, page(), checkedAt);
  assert.equal(result.state, 'ready');
  assert.equal(result.videoId, player.videoDetails.videoId);
  assert.equal(result.watchUrl, 'https://www.youtube.com/watch?v=LiveNews001');
  assert.equal(result.checkedAt, checkedAt);
  assert.equal(result.reason, null);
});

test('archived or scheduled streams cannot be presented as current live video', () => {
  for (const videoDetails of [
    { ...player.videoDetails, isLive: false, isLiveContent: true },
    { ...player.videoDetails, isUpcoming: true },
  ]) {
    const result = resolveLiveNewsPage(feed, page({ ...player, videoDetails }), checkedAt);
    assert.equal(result.state, 'unavailable');
    assert.equal(result.videoId, null);
  }
});

test('live-broadcast metadata can establish current live state when isLive is absent', () => {
  const result = resolveLiveNewsPage(feed, page({ ...player, videoDetails: { ...player.videoDetails, isLive: undefined },
    microformat: { playerMicroformatRenderer: { liveBroadcastDetails: { isLiveNow: true } } } }), checkedAt);
  assert.equal(result.state, 'ready');
});

test('malformed pages, unrelated channels, and invalid video IDs never become embeds', () => {
  for (const html of [
    '<html>Consent or login required</html>', 'ytInitialPlayerResponse = {broken};',
    page(null), page({}), page({ ...player, videoDetails: { ...player.videoDetails, channelId: 'other-channel' } }),
    page({ ...player, videoDetails: { ...player.videoDetails, videoId: '../invalid' } }),
  ]) {
    const result = resolveLiveNewsPage(feed, html, checkedAt);
    assert.equal(result.state, 'unavailable');
    assert.equal(result.videoId, null);
  }
});

test('restricted and unconfirmed embedding permissions preserve the external source without a player', () => {
  for (const playableInEmbed of [false, undefined]) {
    const result = resolveLiveNewsPage(feed, page({ ...player, playabilityStatus: { status: 'OK', playableInEmbed } }), checkedAt);
    assert.equal(result.state, 'external');
    assert.equal(result.videoId, null);
    assert.equal(result.watchUrl, feed.url);
  }
  assert.equal(resolveLiveNewsPage(feed, page({ ...player, playabilityStatus: { status: 'LOGIN_REQUIRED', playableInEmbed: true } }), checkedAt).state, 'unavailable');
});

test('unknown feed IDs and arbitrary URLs cannot trigger server-side requests', async () => {
  let calls = 0;
  const resolver = createLiveNewsResolver({ fetcher: async () => { calls++; return htmlResponse(); } });
  assert.equal(await resolver.resolve('http://127.0.0.1/private'), null);
  assert.equal(await resolver.resolve('unknown'), null);
  const external = await resolver.resolve('rt');
  assert.equal(external?.state, 'external');
  assert.equal(calls, 0);
});

test('shared requests, bounded caching and manual retry preserve collection timing', async () => {
  let clock = nowMs;
  let calls = 0;
  const resolver = createLiveNewsResolver({ now: () => clock, fetcher: async (url) => {
    assert.equal(String(url), feed.url);
    calls++;
    return htmlResponse();
  } });
  const [first, concurrent] = await Promise.all([resolver.resolve(feed.id), resolver.resolve(feed.id)]);
  assert.equal(calls, 1);
  assert.deepEqual(first, concurrent);
  clock += 1000;
  assert.equal((await resolver.resolve(feed.id, true))?.checkedAt, checkedAt);
  assert.equal(calls, 1);
  clock += 5000;
  assert.notEqual((await resolver.resolve(feed.id, true))?.checkedAt, checkedAt);
  assert.equal(calls, 2);
  clock += 60001;
  await resolver.resolve(feed.id);
  assert.equal(calls, 3);
});

test('fetch failures and oversized responses return unavailable without inventing a video', async () => {
  for (const response of [new Response(null, { status: 429 }), Response.json(player),
    htmlResponse('x'.repeat(3 * 1024 * 1024 + 1)),
    new Response('small', { headers: { 'Content-Type': 'text/html', 'Content-Length': String(4 * 1024 * 1024) } }),
  ]) {
    const resolver = createLiveNewsResolver({ fetcher: async () => response, now: () => nowMs });
    const result = await resolver.resolve(feed.id);
    assert.equal(result?.state, 'unavailable');
    assert.equal(result?.videoId, null);
    assert.equal(result?.watchUrl, feed.url);
  }
});

test('timed-out broadcaster checks produce explicit unavailable status', async () => {
  const resolver = createLiveNewsResolver({ timeoutMs: 5, fetcher: async (_url, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }) });
  const result = await resolver.resolve(feed.id);
  assert.equal(result?.state, 'unavailable');
  assert.match(result?.reason || '', /timed out/);
});

test('video embeds use an identified origin and concrete video URL rather than channel aliases', () => {
  const url = new URL(liveNewsEmbedUrl('LiveNews001', 'http://127.0.0.1:3017/private-path'));
  assert.equal(url.pathname, '/embed/LiveNews001');
  assert.equal(url.searchParams.get('origin'), 'http://127.0.0.1:3017');
  assert.equal(url.searchParams.get('enablejsapi'), '1');
  assert.equal(url.searchParams.get('mute'), '1');
  assert.throws(() => liveNewsEmbedUrl('../invalid', 'https://example.com'));
  assert.throws(() => liveNewsEmbedUrl('LiveNews001', 'file:///tmp/test.html'));
  assert.match(liveNewsPlayerError(153), /identify/);
  assert.match(liveNewsPlayerError(150), /does not allow/);
});

test('the shared catalog has unique IDs and canonical broadcaster links', () => {
  assert.equal(new Set(LIVE_NEWS_FEEDS.map((item) => item.id)).size, LIVE_NEWS_FEEDS.length);
  for (const item of LIVE_NEWS_FEEDS) {
    const url = new URL(item.url);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.pathname.includes('/embed/'), false);
    if (item.channel_id) assert.equal(url.pathname, `/channel/${item.channel_id}/live`);
  }
});
