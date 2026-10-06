import test from 'node:test';
import assert from 'node:assert/strict';
import { createRansomwareCollector, normalizeRansomLookPosts } from '../src/lib/feed-integrity/ransomware';
import {
  filterRansomwareReports, isRansomwareEnvelope, RANSOMLOOK_URL,
  RANSOMWARE_CACHE_MAX_AGE_MS, RANSOMWARE_REFRESH_MS,
} from '../src/lib/feed-integrity/ransomware-types';

// Deliberately fictional fixture metadata; these records are never used by the runtime.
const NOW = Date.parse('2026-09-27T12:00:00Z');
const DATE = new Date(NOW).toISOString();
const POST = { post_title: 'Fictional test organization', group_name: 'fixture-group', discovered: '2026-09-27 10:00:00.123456', description: 'Test-only claim' };
const json = (data: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(data), { ...init, headers: { 'content-type': 'application/json', ...init.headers } });
function fixture() {
  let time = NOW;
  let calls = 0;
  let respond: () => Response | Promise<Response> = () => json([POST]);
  const collector = createRansomwareCollector({ now: () => time, fetcher: async (url, init) => {
    calls++;
    assert.equal(url, RANSOMLOOK_URL);
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.cache, 'no-store');
    return respond();
  } });
  return { collector, advance: (ms: number) => { time += ms; }, setResponse: (fn: typeof respond) => { respond = fn; }, calls: () => calls };
}

test('normalizes public posts without claiming an attack date or geographic precision', () => {
  const normalized = normalizeRansomLookPosts([POST], DATE)!;
  const record = normalized.records[0];
  assert.equal(record.discoveredAt, '2026-09-27T10:00:00.123Z');
  assert.equal(record.attackAt, null);
  assert.equal(record.publishedAt, null);
  assert.equal(record.country, null);
  assert.equal(record.sector, null);
  assert.equal(record.verification, 'unassessed');
  assert.equal(record.recordKind, 'ransomware_related_post');
  assert.equal(record.integrity.location.geometry, null);
  assert.equal(record.integrity.timing.observedAt, null);
  assert.ok(record.integrity.location.qualityFlags.includes('source_timezone_assumed_utc'));
});

test('IDs are stable across refresh and description changes; duplicates are removed', () => {
  const first = normalizeRansomLookPosts([POST, POST], DATE)!;
  const next = normalizeRansomLookPosts([{ ...POST, description: 'Changed' }], new Date(NOW + 60000).toISOString())!;
  assert.equal(first.records.length, 1);
  assert.equal(first.duplicates, 1);
  assert.equal(first.records[0].id, next.records[0].id);
  assert.equal(first.received, first.records.length + first.duplicates + first.rejected);
});

test('different original titles do not collide after display truncation', () => {
  const first = { ...POST, post_title: 'A'.repeat(600) };
  const second = { ...POST, post_title: `${'A'.repeat(600)}B` };
  const normalized = normalizeRansomLookPosts([first, second], DATE)!;
  assert.equal(normalized.records.length, 2);
  assert.equal(normalized.records[0].title.length, 500);
});

test('missing and invalid dates remain unknown rather than receiving collection time', () => {
  for (const discovered of [undefined, '', 'not-a-date', '2026-02-30T10:00:00Z', '2026-09-27T25:00:00Z', '2026-09-27']) {
    assert.equal(normalizeRansomLookPosts([{ ...POST, discovered }], DATE)!.records[0].discoveredAt, null);
  }
});

test('explicit offsets normalize to UTC and future source dates are flagged', () => {
  const record = normalizeRansomLookPosts([{ ...POST, discovered: '2026-09-28T10:00:00+02:00' }], DATE)!.records[0];
  assert.equal(record.discoveredAt, '2026-09-28T08:00:00.000Z');
  assert.ok(record.integrity.location.qualityFlags.includes('source_discovery_in_future'));
  assert.ok(!record.integrity.location.qualityFlags.includes('source_timezone_assumed_utc'));
});

test('renders metadata only, strips markup, and never returns original leak links or evidence', () => {
  const record = normalizeRansomLookPosts([{
    ...POST, post_title: '<script>alert(1)</script><b>Fixture</b>',
    description: '<img src=x onerror=alert(1)>Plain &amp; safe',
    link: 'http://fixture.onion/stolen', website: 'https://victim.invalid', screen: 'private-evidence', source: 'raw-html',
  }], DATE)!.records[0];
  assert.equal(record.title, 'Fixture');
  assert.equal(record.description, 'Plain & safe');
  assert.ok(!JSON.stringify(record).includes('fixture.onion'));
  assert.ok(!JSON.stringify(record).includes('private-evidence'));
  assert.equal(record.sourceUrl, 'https://www.ransomlook.io/recent');
});

test('rejects malformed rows and wrong top-level shapes', () => {
  assert.equal(normalizeRansomLookPosts({ posts: [POST] }, DATE), null);
  assert.equal(normalizeRansomLookPosts(new Array(101).fill(POST), DATE), null);
  const mixed = normalizeRansomLookPosts([POST, null, {}, [], { post_title: 'no group' }], DATE)!;
  assert.equal(mixed.records.length, 1);
  assert.equal(mixed.rejected, 4);
});

test('search, group and discovery filters only narrow the loaded sample', () => {
  const records = normalizeRansomLookPosts([
    POST, { ...POST, post_title: 'Unknown date', discovered: null },
    { ...POST, post_title: 'Future date', discovered: '2026-09-28T10:00:00Z' },
    { ...POST, post_title: 'Older date', discovered: '2026-09-01T10:00:00Z', group_name: 'other-group' },
  ], DATE)!.records;
  assert.equal(filterRansomwareReports(records, { query: '', group: '', days: 1, nowMs: NOW }).length, 1);
  assert.equal(filterRansomwareReports(records, { query: 'unknown', group: '', days: null, nowMs: NOW }).length, 1);
  assert.equal(filterRansomwareReports(records, { query: '', group: 'other-group', days: null, nowMs: NOW }).length, 1);
  assert.equal(filterRansomwareReports(records, { query: '', group: '', days: null, nowMs: NOW }).length, 4);
});

test('single-flight requests and the 30-minute cache suppress repeated provider fetches', async () => {
  const f = fixture();
  const [first, second] = await Promise.all([f.collector.get(), f.collector.get()]);
  assert.equal(f.calls(), 1);
  assert.deepEqual(first, second);
  assert.equal(first.httpStatus, 200);
  assert.ok(isRansomwareEnvelope(first.payload));
  assert.equal(first.payload.coverage.notExhaustive, true);
  assert.equal(first.payload.status[0].acceptedRecords, 1);
  f.advance(RANSOMWARE_REFRESH_MS - 1);
  assert.equal((await f.collector.get()).payload.collectedAt, DATE);
  assert.equal(f.calls(), 1);
  f.advance(1);
  await f.collector.get();
  assert.equal(f.calls(), 2);
});

test('a genuine empty list is distinguished from collection failure', async () => {
  const f = fixture();
  f.setResponse(() => json([]));
  const result = await f.collector.get();
  assert.equal(result.httpStatus, 200);
  assert.equal(result.payload.status[0].dataState, 'empty');
  assert.equal(result.payload.status[0].availability, 'ok');
  assert.ok(isRansomwareEnvelope(result.payload));
});

test('all invalid records fail rather than reporting healthy empty data', async () => {
  const f = fixture();
  f.setResponse(() => json([{}]));
  const result = await f.collector.get();
  assert.equal(result.httpStatus, 503);
  assert.equal(result.payload.status[0].dataState, 'unavailable');
  assert.equal(result.payload.status[0].errorCode, 'INVALID_SCHEMA');
  assert.ok(isRansomwareEnvelope(result.payload));
});

test('partially invalid rows are visible as partial collection', async () => {
  const f = fixture();
  f.setResponse(() => json([POST, {}]));
  const result = await f.collector.get();
  assert.equal(result.payload.status[0].availability, 'partial');
  assert.equal(result.payload.status[0].rejectedRecords, 1);
});

test('HTTP 200 HTML and invalid JSON are errors, never healthy-empty', async () => {
  for (const [body, type, code] of [['<html>Challenge</html>', 'text/html', 'INVALID_CONTENT_TYPE'], ['{broken', 'application/json', 'INVALID_JSON']]) {
    const f = fixture();
    f.setResponse(() => new Response(body, { headers: { 'content-type': type } }));
    const result = await f.collector.get();
    assert.equal(result.httpStatus, 503);
    assert.equal(result.payload.status[0].errorCode, code);
  }
});

test('body-size limit is enforced with and without Content-Length', async () => {
  for (const lengthHeader of [false, true]) {
    const f = fixture();
    f.setResponse(() => new Response('x'.repeat(1024 * 1024 + 1), { headers: { 'content-type': 'application/json', ...(lengthHeader ? { 'content-length': '1048577' } : {}) } }));
    assert.equal((await f.collector.get()).payload.status[0].errorCode, 'RESPONSE_TOO_LARGE');
  }
});

test('429 honors Retry-After and preserves the original last-good collection timestamp', async () => {
  const f = fixture();
  await f.collector.get();
  f.advance(RANSOMWARE_REFRESH_MS);
  f.setResponse(() => new Response(null, { status: 429, headers: { 'retry-after': '3600' } }));
  const failed = await f.collector.get();
  assert.equal(failed.httpStatus, 200);
  assert.equal(failed.payload.collectedAt, DATE);
  assert.equal(failed.payload.ransomware_reports[0].integrity.timing.collectedAt, DATE);
  assert.equal(failed.payload.status[0].availability, 'rate_limited');
  assert.equal(failed.payload.status[0].freshness, 'stale');
  assert.equal(failed.payload.status[0].servingLastKnownGood, true);
  assert.equal(failed.payload.status[0].nextRetryAt, new Date(NOW + RANSOMWARE_REFRESH_MS + 3600000).toISOString());
  f.advance(3599999);
  await f.collector.get();
  assert.equal(f.calls(), 2);
});

test('HTTP-date Retry-After works and repeated errors back off', async () => {
  const f = fixture();
  f.setResponse(() => new Response(null, { status: 503, headers: { 'retry-after': new Date(NOW + 3600000).toUTCString() } }));
  assert.equal((await f.collector.get()).payload.status[0].nextRetryAt, new Date(NOW + 3600000).toISOString());
  f.advance(3600000);
  f.setResponse(() => new Response(null, { status: 503 }));
  assert.equal((await f.collector.get()).payload.status[0].nextRetryAt, new Date(NOW + 3600000 + 120000).toISOString());
});

test('last-good records expire even while the provider cooldown has not ended', async () => {
  const f = fixture();
  await f.collector.get();
  f.advance(RANSOMWARE_REFRESH_MS);
  f.setResponse(() => new Response(null, { status: 429, headers: { 'retry-after': '172800' } }));
  await f.collector.get();
  f.advance(RANSOMWARE_CACHE_MAX_AGE_MS);
  const expired = await f.collector.get();
  assert.equal(expired.httpStatus, 503);
  assert.deepEqual(expired.payload.ransomware_reports, []);
  assert.equal(expired.payload.collectedAt, null);
  assert.equal(expired.payload.status[0].lastSuccessfulFetchAt, DATE);
  assert.equal(expired.payload.status[0].servingLastKnownGood, false);
  assert.equal(f.calls(), 2);
});

test('recovery replaces the snapshot instead of accumulating old records', async () => {
  const f = fixture();
  await f.collector.get();
  f.advance(RANSOMWARE_REFRESH_MS);
  f.setResponse(() => new Response(null, { status: 500 }));
  await f.collector.get();
  f.advance(60000);
  f.setResponse(() => json([{ ...POST, post_title: 'New fictional report' }]));
  const result = await f.collector.get();
  assert.equal(result.payload.ransomware_reports.length, 1);
  assert.equal(result.payload.ransomware_reports[0].title, 'New fictional report');
  assert.equal(result.payload.status[0].availability, 'ok');
  assert.equal(result.payload.status[0].nextRetryAt, null);
});

test('successful transport does not relabel old or undated source content as current', async () => {
  for (const [discovered, freshness] of [['2026-09-01T00:00:00Z', 'stale'], [null, 'unknown']]) {
    const f = fixture();
    f.setResponse(() => json([{ ...POST, discovered }]));
    assert.equal((await f.collector.get()).payload.status[0].freshness, freshness);
  }
});

test('timeouts abort the fetch and produce explicit unavailable coverage', async () => {
  const collector = createRansomwareCollector({ now: () => NOW, timeoutMs: 5, fetcher: async (_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }) });
  const result = await collector.get();
  assert.equal(result.httpStatus, 503);
  assert.equal(result.payload.status[0].errorCode, 'TIMEOUT');
});

test('client wire guard rejects misleading or unsafe envelopes', async () => {
  const f = fixture();
  const original = (await f.collector.get()).payload;
  const unsafe = structuredClone(original);
  unsafe.ransomware_reports[0].sourceUrl = 'javascript:alert(1)';
  assert.ok(!isRansomwareEnvelope(unsafe));
  const wrongCount = structuredClone(original);
  wrongCount.status[0].acceptedRecords = 99;
  assert.ok(!isRansomwareEnvelope(wrongCount));
  assert.ok(!isRansomwareEnvelope({ ransomware_reports: [] }));
  assert.ok(!isRansomwareEnvelope({ ...original, dataMode: 'demo' }));
});
