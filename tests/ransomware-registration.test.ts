import test from 'node:test';
import assert from 'node:assert/strict';
import { getCapability, SOURCE_CAPABILITIES, statusesForCapability } from '../src/lib/source-manifest';
import { getSourceContract, SOURCE_CONTRACTS, VERIFY_ROUTE_CONTRACTS, evaluateCapabilityPayload } from '../src/lib/source-contracts';
import { createRansomwareCollector } from '../src/lib/feed-integrity/ransomware';

const nowMs = Date.parse('2026-09-27T12:00:00Z');

test('ransomware is registered exactly once and does not displace existing capabilities', () => {
  assert.equal(SOURCE_CAPABILITIES.filter((source) => source.id === 'ransomware').length, 1);
  assert.equal(SOURCE_CONTRACTS.filter((source) => source.id === 'ransomware').length, 1);
  assert.ok(VERIFY_ROUTE_CONTRACTS.some((source) => source.id === 'ransomware'));
  const capability = getCapability('ransomware')!;
  assert.equal(capability.apiRoute, '/api/ransomware');
  assert.deepEqual(capability.credentialEnv, []);
  assert.deepEqual(capability.runtimeModes, ['web', 'docker', 'desktop']);
  assert.ok(getCapability('earthquakes'));
  assert.ok(getSourceContract('earthquakes'));
  assert.ok(getSourceContract('ransomware')!.recordSets.every((set) => !set.liveObservation));
});

test('shared diagnostics count claims as reports, not live observations', async () => {
  const collector = createRansomwareCollector({ now: () => nowMs, fetcher: async () => Response.json([
    { post_title: 'Fictional registration test', group_name: 'fixture-only', discovered: '2026-09-27T10:00:00Z' },
  ]) });
  const { payload, httpStatus } = await collector.get();
  assert.equal(statusesForCapability(getCapability('ransomware')!, payload.status).length, 1);
  const evaluation = evaluateCapabilityPayload({ contract: getSourceContract('ransomware')!, payload, httpStatus, contentType: 'application/json', nowMs });
  assert.equal(evaluation.configuration, 'keyless');
  assert.equal(evaluation.passed, true);
  assert.equal(evaluation.counts.reports, 1);
  assert.equal(evaluation.counts.liveObservations, 0);
});

test('shared diagnostics distinguish valid empty data from provider failure', async () => {
  for (const success of [true, false]) {
    const collector = createRansomwareCollector({ now: () => nowMs, fetcher: async () => success ? Response.json([]) : new Response(null, { status: 429 }) });
    const { payload, httpStatus } = await collector.get();
    const evaluation = evaluateCapabilityPayload({ contract: getSourceContract('ransomware')!, payload, httpStatus, contentType: 'application/json', nowMs });
    assert.equal(evaluation.passed, success);
    assert.equal(evaluation.counts.returnedRecords, 0);
  }
});
