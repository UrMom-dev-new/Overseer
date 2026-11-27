import { test, expect, type Page } from '@playwright/test';

async function offline(page: Page) {
  await page.route('https://**/*', route => route.abort());
}

async function hls(page: Page, mode = 'live') {
  let loads = 0;
  await page.route('**/live.m3u8', route => {
    loads++;
    if (mode === 'http-error') return route.fulfill({ status: 403, body: 'Denied' });
    if (mode === 'malformed') return route.fulfill({ contentType: 'application/vnd.apple.mpegurl', body: 'not an HLS manifest' });
    const end = Math.min(7, 2 + loads);
    const date = mode === 'expired' ? '#EXT-X-PROGRAM-DATE-TIME:2020-01-01T00:00:00Z\n' : '';
    const body = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:0\n' + date
      + Array.from({ length: end + 1 }, (_, i) => `#EXTINF:1.000000,\n/segment${i}.mpegts\n`).join('')
      + (mode === 'vod' ? '#EXT-X-ENDLIST\n' : '');
    return route.fulfill({ contentType: 'application/vnd.apple.mpegurl', body });
  });
  await page.goto('/?mode=hls');
  return () => loads;
}

async function youtube(page: Page, options: { mode?: 'news' | 'youtube'; advance?: boolean; blocked?: boolean; response?: unknown } = {}) {
  await offline(page);
  await page.clock.install();
  await page.addInitScript(({ advance, blocked }) => {
    const state = { advance, blocked, value: 1, destroyed: 0, events: null as any, started: Date.now() };
    (window as any).__player = state;
    (window as any).YT = { Player: class {
      constructor(_frame: HTMLIFrameElement, options: any) {
        state.events = options.events;
        setTimeout(() => options.events.onReady({ target: this }), 0);
      }
      mute() {}
      playVideo() { if (state.blocked) { state.value = -1; state.events.onAutoplayBlocked(); } else state.events.onStateChange({ data: state.value }); }
      getPlayerState() { return state.value; }
      getCurrentTime() { return state.advance ? (Date.now() - state.started) / 1000 : 0; }
      destroy() { state.destroyed++; }
    } };
  }, { advance: options.advance ?? true, blocked: options.blocked ?? false });
  const mode = options.mode || 'news';
  let requests = 0;
  await page.route('**/api/**', async route => {
    requests++;
    const checkedAt = new Date().toISOString();
    await route.fulfill({ json: options.response ?? {
      feedId: mode === 'news' ? 'france24en' : 'CameraLive1', state: 'ready', videoId: 'CameraLive1', checkedAt,
      watchUrl: 'https://www.youtube.com/watch?v=CameraLive1', reason: null,
    } });
  });
  await page.goto(`/?mode=${mode}`);
  return () => requests;
}

test('HLS preview decodes advancing frames and never substitutes its snapshot', async ({ page }) => {
  await offline(page);
  const requests = await hls(page);
  const video = page.getByTestId('camera-video');
  await expect(page.getByTestId('camera-playback-status')).toHaveText('Live video');
  const evidence = await video.evaluate((element: HTMLVideoElement) => {
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(element, 0, 0);
    return { width: element.videoWidth, frames: element.getVideoPlaybackQuality().totalVideoFrames,
      nonblank: [...ctx.getImageData(0, 0, 160, 90).data].some((v, i) => i % 4 !== 3 && v > 30) };
  });
  expect(evidence.width).toBe(160); expect(evidence.frames).toBeGreaterThan(2); expect(evidence.nonblank).toBe(true);
  await video.evaluate((element: HTMLVideoElement) => element.pause());
  await expect(page.getByTestId('camera-playback-status')).toHaveText('Paused');
  await expect(page.getByTestId('camera-viewer').locator('img')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close camera', exact: true }).click();
  await expect(page.getByTestId('closed')).toBeVisible();
  const stopped = requests(); await page.waitForTimeout(1500); expect(requests()).toBe(stopped);
});

for (const mode of ['vod', 'expired', 'http-error', 'malformed']) {
  test(`HLS ${mode} cannot retain a live label`, async ({ page }) => {
    await offline(page); await hls(page, mode);
    await expect(page.getByTestId('camera-playback-status')).toHaveText(mode === 'expired' ? 'Source video expired' : 'Video unavailable');
    await expect(page.getByTestId('camera-viewer').locator('img')).toHaveCount(0);
  });
}

test('an HLS stream with exhausted frames loses its live label', async ({ page }) => {
  await offline(page); await hls(page);
  await expect(page.getByTestId('camera-playback-status')).toHaveText('Live video');
  // The fixture has eight seconds of actual video and never adds new frames.
  await expect(page.getByTestId('camera-playback-status')).toHaveText(/stalled|unavailable/i, { timeout: 30_000 });
});

test('blocked HLS autoplay stays ready-to-play, not live or endlessly loading', async ({ page }) => {
  await page.addInitScript(() => { HTMLMediaElement.prototype.play = function () {
    this.autoplay = false; this.removeAttribute('autoplay'); this.pause();
    return Promise.reject(new DOMException('Blocked', 'NotAllowedError'));
  }; });
  await offline(page); await hls(page);
  await expect(page.getByTestId('camera-playback-status')).toHaveText('Ready to play');
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('camera-playback-status')).toHaveText('Ready to play');
});

for (const mode of ['news', 'youtube'] as const) {
  test(`${mode} requires advancing provider playback and cleans up on close`, async ({ page }) => {
    const requests = await youtube(page, { mode });
    const status = page.getByTestId(mode === 'news' ? 'live-news-playback-status' : 'camera-playback-status');
    await expect(page.getByTestId('verified-youtube-player').locator('iframe')).toHaveCount(1);
    await page.clock.runFor(2500); await expect(status).toHaveText('Live video');
    await page.evaluate(() => { (window as any).__player.value = 2; });
    await page.clock.runFor(1000); await expect(status).toHaveText('Paused');
    await page.getByRole('button', { name: mode === 'news' ? 'Close broadcast' : 'Close camera', exact: true }).click();
    const count = requests(); await page.clock.runFor(100_000);
    expect(requests()).toBe(count);
    expect(await page.evaluate(() => (window as any).__player.destroyed)).toBe(1);
  });
}

test('a playing event without advancing time becomes stalled, not live', async ({ page }) => {
  await youtube(page, { advance: false });
  await expect(page.locator('iframe')).toHaveCount(1);
  await page.clock.runFor(12_000);
  await expect(page.getByTestId('live-news-playback-status')).toHaveText('Video stalled');
});

test('provider errors, blocked autoplay, and ended broadcasts remain explicit', async ({ page }) => {
  await youtube(page, { blocked: true });
  await expect(page.locator('iframe')).toHaveCount(1);
  await page.clock.runFor(2000);
  await expect(page.getByTestId('live-news-playback-status')).toHaveText('Ready to play');
  await page.evaluate(() => { (window as any).__player.events.onError({ data: 150 }); });
  await expect(page.getByRole('alert')).toContainText('does not allow');
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry broadcast' }).click();
  await expect(page.locator('iframe')).toHaveCount(1);
  await page.evaluate(() => { (window as any).__player.events.onStateChange({ data: 0 }); });
  await expect(page.getByTestId('live-news-playback-status')).toHaveText('Stream ended');
});

for (const state of ['external', 'stale', 'malformed']) {
  test(`${state} broadcaster metadata never creates a player`, async ({ page }) => {
    await youtube(page, { response: state === 'malformed' ? {} : { feedId: 'france24en', videoId: 'CameraLive1',
      state: state === 'external' ? 'external' : 'ready', checkedAt: new Date(Date.now() - 120_000).toISOString() } });
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(page.getByTestId('live-news-playback-status')).not.toHaveText('Live video');
  });
}

test('old live verification cannot be renewed by cached responses or playing events', async ({ page }) => {
  await youtube(page);
  await expect(page.locator('iframe')).toHaveCount(1);
  await page.clock.runFor(2500);
  await expect(page.getByTestId('live-news-playback-status')).toHaveText('Live video');
  await page.clock.runFor(95_000);
  await expect(page.getByTestId('live-news-playback-status')).toHaveText(/expired|unavailable/i);
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('the news preview remains operable at a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await youtube(page);
  await expect(page.locator('iframe')).toHaveCount(1);
  await page.clock.runFor(2500);
  await expect(page.getByTestId('live-news-playback-status')).toHaveText('Live video');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile-news.png' });
  await page.getByRole('button', { name: 'Close broadcast', exact: true }).click();
  await expect(page.getByTestId('closed')).toBeVisible();
});
