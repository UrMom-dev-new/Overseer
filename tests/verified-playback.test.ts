import assert from 'node:assert/strict';
import { test } from 'node:test';
import { liveVerificationDeadline, verifiedYouTubeStatus } from '../src/lib/verified-playback';

const now = Date.parse('2026-11-27T12:00:00Z');
const result = { feedId: 'news', state: 'ready', videoId: 'CameraLive1', checkedAt: new Date(now).toISOString() };
test('provider evidence must match the feed and video and retain its original expiry', () => {
  assert.equal(liveVerificationDeadline(result, 'news', now), now + 90_000);
  assert.equal(liveVerificationDeadline(result, 'news', now + 30_000), now + 90_000);
  for (const value of [null, {}, { ...result, checkedAt: 'invalid' }, { ...result, checkedAt: new Date(now - 90_000).toISOString() },
    { ...result, checkedAt: new Date(now + 5001).toISOString() }, { ...result, state: 'external' }, { ...result, videoId: '../bad' }, { ...result, feedId: 'other' }]) {
    assert.equal(liveVerificationDeadline(value, 'news', now), null);
  }
  assert.equal(liveVerificationDeadline(result, 'news', now, 'OtherVideo1'), null);
});
test('playing events cannot replace advancement, freshness, pause, buffer, or end evidence', () => {
  const until = now + 90_000, start = now - 20_000;
  assert.equal(verifiedYouTubeStatus(1, now, until, start, now), 'Live video');
  assert.equal(verifiedYouTubeStatus(1, null, until, start, now), 'Video stalled');
  assert.equal(verifiedYouTubeStatus(1, now - 10_001, until, start, now), 'Video stalled');
  assert.equal(verifiedYouTubeStatus(1, now, now, start, now), 'Live verification expired');
  for (const [state, expected] of [[0, 'Stream ended'], [2, 'Paused'], [3, 'Buffering']] as const) {
    assert.equal(verifiedYouTubeStatus(state, now, until, start, now), expected);
  }
});

test('sharing the controller does not loosen the existing camera freshness limit', () => {
  assert.equal(liveVerificationDeadline(result, 'news', now + 44_999, undefined, 45_000), now + 45_000);
  assert.equal(liveVerificationDeadline(result, 'news', now + 45_000, undefined, 45_000), null);
  for (const age of [0, -1, NaN, Infinity, 90_001]) assert.equal(liveVerificationDeadline(result, 'news', now, undefined, age), null);
});
