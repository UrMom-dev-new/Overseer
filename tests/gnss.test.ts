import test from 'node:test';
import assert from 'node:assert/strict';
import { createGnssCollector, GNSS_PROVIDERS, GNSS_MAX_ELEMENT_AGE_MS, parseGnssCatalog, projectGnss } from '../src/lib/feed-integrity/gnss';
import { getCapability, statusesForCapability } from '../src/lib/source-manifest';
import { evaluateCapabilityPayload, getSourceContract } from '../src/lib/source-contracts';
import { layerMenuGroupForKey } from '../src/lib/layer-menu';

// Real public GPS element sets, fixed in time for deterministic propagation checks.
const nowMs = Date.parse('2026-10-15T12:00:00Z');
const tle = [
  'GPS BIIR-2  (PRN 13)',
  '1 24876U 97035A   25316.81786533  .00000057  00000+0  00000+0 0  9999',
  '2 24876  55.8805 107.0391 0096491  56.9975 303.9217  2.00563366207613',
].join('\n');
const omm = {
  OBJECT_NAME: 'GPS BIIR-5  (PRN 22)', OBJECT_ID: '2000-040A', EPOCH: '2026-10-15T03:48:57.791808',
  MEAN_MOTION: 2.00558685, ECCENTRICITY: 0.01166018, INCLINATION: 54.8316,
  RA_OF_ASC_NODE: 210.4019, ARG_OF_PERICENTER: 304.4951, MEAN_ANOMALY: 203.0007,
  EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: 'U', NORAD_CAT_ID: 26407, ELEMENT_SET_NO: 999,
  REV_AT_EPOCH: 19235, BSTAR: 0, MEAN_MOTION_DOT: 0, MEAN_MOTION_DDOT: 0,
};
const currentCatalog = JSON.stringify([omm]);

test('GPS catalog validation rejects malformed records and unrelated satellites', () => {
  for (const value of ['{}', 'not json', JSON.stringify([null, {}, { ...omm, MEAN_MOTION: '2.0' }, { ...omm, EPOCH: 'invalid' },
    { ...omm, ECCENTRICITY: 1 }, { ...omm, INCLINATION: -1 }, { ...omm, OBJECT_NAME: 'STARLINK-1' }])]) {
    assert.equal(parseGnssCatalog(value, 'omm').orbits.length, 0);
  }
  assert.equal(parseGnssCatalog(tle.replace('9999', '9990'), 'tle').orbits.length, 0);
  assert.equal(parseGnssCatalog(tle.split('\n').slice(0, 2).join('\n'), 'tle').orbits.length, 0);
});

test('TLE epoch preserves UTC fractional day and stale snapshots produce no current points', () => {
  const parsed = parseGnssCatalog(tle, 'tle');
  assert.equal(parsed.orbits.length, 1);
  assert.equal(parsed.orbits[0].epoch, '2025-11-12T19:37:43.564Z');
  assert.equal(projectGnss(parsed.orbits, GNSS_PROVIDERS[0], nowMs).length, 0);
  assert.equal(projectGnss(parsed.orbits, GNSS_PROVIDERS[0], Date.parse('2025-11-13T00:00:00Z')).length, 1);
});

test('SGP4 predictions have valid GPS altitude, PRN, provenance and moving positions', () => {
  const parsed = parseGnssCatalog(JSON.stringify([omm, omm]), 'omm');
  const points = projectGnss(parsed.orbits, GNSS_PROVIDERS[1], nowMs);
  assert.equal(points.length, 1);
  const point = points[0];
  assert.equal(point.noradId, '26407');
  assert.equal(point.prn, 22);
  assert.equal(point.elementEpoch, '2026-10-15T03:48:57.791Z');
  assert.ok(point.lat >= -90 && point.lat <= 90 && point.lng >= -180 && point.lng <= 180);
  assert.ok(point.alt > 19000 && point.alt < 22000);
  assert.equal(point.source_url, GNSS_PROVIDERS[1].url);
  assert.equal(point.evidence_kind, 'reference');
  assert.equal(Date.parse(point.expiresAt) - nowMs, 120000);
  const later = projectGnss(parsed.orbits, GNSS_PROVIDERS[1], nowMs + 60000)[0];
  assert.notEqual(later.lng, point.lng);
  assert.equal(projectGnss(parsed.orbits, GNSS_PROVIDERS[1], Date.parse(omm.EPOCH + 'Z') - 600000).length, 0);
  assert.equal(projectGnss(parsed.orbits, GNSS_PROVIDERS[1], nowMs + GNSS_MAX_ELEMENT_AGE_MS).length, 0);
});

test('expired repository snapshot triggers current CelesTrak alternate and honest provider status', async () => {
  const urls: string[] = [];
  const collector = createGnssCollector({ now: () => nowMs, fetcher: async (input) => {
    urls.push(String(input));
    return new Response(urls.length === 1 ? tle : currentCatalog);
  } });
  const { payload, httpStatus } = await collector.get();
  assert.deepEqual(urls, GNSS_PROVIDERS.map((provider) => provider.url));
  assert.equal(httpStatus, 200);
  assert.equal(payload.total, 1);
  assert.equal(payload.status[0].availability, 'error');
  assert.equal(payload.status[0].acceptedRecords, 0);
  assert.equal(payload.status[1].availability, 'ok');
  assert.equal(payload.status[1].acceptedRecords, payload.gnss_satellites.length);
  assert.equal(payload.attribution.license, 'CC BY 4.0');
});

test('a usable repository snapshot needs no alternate request', async () => {
  let calls = 0;
  const collector = createGnssCollector({ now: () => Date.parse('2025-11-13T00:00:00Z'), fetcher: async () => {
    calls++;
    return new Response(tle);
  } });
  assert.equal((await collector.get()).httpStatus, 200);
  assert.equal(calls, 1);
});

test('cached catalogs repropagate without inventing new successful collection timestamps', async () => {
  let clock = nowMs;
  let calls = 0;
  const collector = createGnssCollector({ now: () => clock, fetcher: async () => {
    calls++;
    return calls % 2 === 1 ? new Response(tle) : new Response(currentCatalog);
  } });
  const [first, concurrent] = await Promise.all([collector.get(), collector.get()]);
  assert.equal(calls, 2);
  assert.equal(concurrent.payload.total, first.payload.total);
  clock += 60000;
  const second = await collector.get();
  assert.equal(calls, 2);
  assert.equal(first.payload.collectedAt, second.payload.collectedAt);
  assert.equal(first.payload.status[1].lastSuccessfulFetchAt, second.payload.status[1].lastSuccessfulFetchAt);
  assert.notEqual(first.payload.gnss_satellites[0].lng, second.payload.gnss_satellites[0].lng);
  clock += 3600000;
  await collector.get();
  assert.equal(calls, 4);
});

test('total provider failure omits records, reports 503 and respects retry cooldown', async () => {
  let calls = 0;
  const collector = createGnssCollector({ now: () => nowMs, fetcher: async () => {
    calls++;
    return new Response(null, { status: 503 });
  } });
  const result = await collector.get();
  assert.equal(result.httpStatus, 503);
  assert.deepEqual(result.payload.gnss_satellites, []);
  assert.equal(result.payload.collectedAt, null);
  assert.ok(result.payload.status.every((status) => status.availability === 'error' && status.acceptedRecords === 0));
  await collector.get();
  assert.equal(calls, 2);
});

test('expired cached elements disappear before catalog TTL and failed refresh drops the catalog', async () => {
  let clock = Date.parse(omm.EPOCH + 'Z') + GNSS_MAX_ELEMENT_AGE_MS - 30000;
  let calls = 0;
  const collector = createGnssCollector({ now: () => clock, fetcher: async () => {
    calls++;
    return calls === 2 ? new Response(currentCatalog) : new Response(null, { status: 503 });
  } });
  const first = await collector.get();
  assert.equal(first.httpStatus, 200);
  assert.equal(Date.parse(first.payload.gnss_satellites[0].expiresAt) - clock, 30000);
  clock += 60000;
  const expired = await collector.get();
  assert.equal(expired.httpStatus, 503);
  assert.equal(expired.payload.status[1].dataState, 'unavailable');
  assert.equal(expired.payload.total, 0);
  clock += 3600000;
  assert.equal((await collector.get()).payload.total, 0);
});

test('oversized catalog responses are rejected', async () => {
  const collector = createGnssCollector({ now: () => nowMs, fetcher: async () => new Response('x'.repeat(1024 * 1024 + 1)) });
  const result = await collector.get();
  assert.equal(result.httpStatus, 503);
  assert.ok(result.payload.status.every((status) => status.message?.includes('size limit')));
});

test('GNSS is visible in Space and diagnostics evaluate predictions separately from observations', async () => {
  assert.equal(layerMenuGroupForKey('gnss')?.label, 'SPACE');
  assert.equal(layerMenuGroupForKey('data_centers')?.label, 'INFRA');
  const collector = createGnssCollector({ now: () => nowMs, fetcher: async (url) => new Response(String(url) === GNSS_PROVIDERS[0].url ? tle : currentCatalog) });
  const { payload, httpStatus } = await collector.get();
  assert.equal(statusesForCapability(getCapability('gnss')!, payload.status).length, 2);
  const args = { contract: getSourceContract('gnss')!, payload, httpStatus, contentType: 'application/json', nowMs };
  const evaluation = evaluateCapabilityPayload(args);
  assert.equal(evaluation.configuration, 'keyless');
  assert.equal(evaluation.passed, true);
  assert.equal(evaluation.counts.references, 1);
  assert.equal(evaluation.counts.liveObservations, 0);
  assert.equal(evaluateCapabilityPayload({ ...args, nowMs: nowMs + 180000 }).passed, false);
  assert.equal(evaluateCapabilityPayload({ ...args, payload: { ...payload, gnss_satellites: [] } }).passed, false);
});
