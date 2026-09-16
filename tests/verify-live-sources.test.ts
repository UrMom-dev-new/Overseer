import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

import {
  evaluateCapabilityPayload,
  getSourceContract,
} from '../src/lib/source-contracts';

function writeJson(res: ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

async function withMockServer(handler: (req: IncomingMessage, res: ServerResponse) => void, run: (baseUrl: string) => Promise<void>) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

async function runVerifier(baseUrl: string) {
  const child = spawn(process.execPath, ['scripts/verify-live-sources.mjs', `--base-url=${baseUrl}`, '--timeout-ms=1000'], {
    cwd: process.cwd(),
    env: { ...process.env, OVERSEER_VERIFY_TIMEOUT_MS: '1000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout.on('data', (chunk) => stdoutChunks.push(Buffer.from(chunk)));
  child.stderr.on('data', (chunk) => stderrChunks.push(Buffer.from(chunk)));
  const [code] = await once(child, 'exit') as [number | null, NodeJS.Signals | null];
  const stdout = Buffer.concat(stdoutChunks).toString('utf8');
  const stderr = Buffer.concat(stderrChunks).toString('utf8');
  return {
    code,
    stdout,
    stderr,
    report: JSON.parse(stdout),
  };
}

test('verification gate fails when /api/sources succeeds but every data route returns 503', async () => {
  await withMockServer((req, res) => {
    if (req.url === '/api/sources') {
      writeJson(res, 200, { capabilities: [{ id: 'earthquakes' }] });
      return;
    }
    writeJson(res, 503, { error: 'upstream unavailable' });
  }, async (baseUrl) => {
    const result = await runVerifier(baseUrl);
    assert.equal(result.code, 1);
    assert.equal(result.report.sourcesDiagnostic.ok, true);
    assert.ok(result.report.results.some((entry: { id: string; okForReleaseGate: boolean }) => entry.id === 'earthquakes' && !entry.okForReleaseGate));
    assert.match(result.stderr, /Required passed: \d+\/\d+/);
  });
});

test('verification gate fails when routes return HTTP 200 with empty objects instead of contract payloads', async () => {
  await withMockServer((_req, res) => {
    writeJson(res, 200, {});
  }, async (baseUrl) => {
    const result = await runVerifier(baseUrl);
    assert.equal(result.code, 1);
    assert.equal(result.report.sourcesDiagnostic.ok, false);
    const earthquake = result.report.results.find((entry: { id: string }) => entry.id === 'earthquakes');
    assert.equal(earthquake.stages.payloadContract, 'failed');
    assert.ok(earthquake.messages.some((message: string) => message.includes('Missing required record set')));
  });
});

test('schema-valid empty required payload does not invent records or pass release gate', () => {
  const contract = getSourceContract('earthquakes');
  assert.ok(contract);
  const evaluation = evaluateCapabilityPayload({
    contract,
    httpStatus: 200,
    contentType: 'application/json',
    payload: {
      earthquakes: [],
      status: [{
        source: { providerId: 'usgs-earthquakes', providerName: 'USGS earthquakes' },
        availability: 'ok',
        dataState: 'empty',
        freshness: 'fresh',
        acceptedRecords: 0,
        rejectedRecords: 0,
        receivedRecords: 0,
        servingLastKnownGood: false,
      }],
    },
    env: {},
  });
  assert.equal(evaluation.passed, false);
  assert.equal(evaluation.okForReleaseGate, false);
  assert.equal(evaluation.stages.dataState, 'failed');
  assert.equal(evaluation.counts.liveObservations, 0);
  assert.equal(evaluation.activeFallback, null);
  assert.ok(evaluation.messages.some((message) => message.includes('below the minimum')));
});

test('required payload with malformed records fails usability contract', () => {
  const contract = getSourceContract('earthquakes');
  assert.ok(contract);
  const evaluation = evaluateCapabilityPayload({
    contract,
    httpStatus: 200,
    contentType: 'application/json',
    payload: {
      earthquakes: [{ id: 'bad-earthquake', lat: 'not-a-number', lng: 30, magnitude: 4.2 }],
      status: [{
        source: { providerId: 'usgs-earthquakes', providerName: 'USGS earthquakes' },
        availability: 'ok',
        dataState: 'present',
        freshness: 'fresh',
        acceptedRecords: 1,
        rejectedRecords: 0,
        receivedRecords: 1,
        lastSuccessfulFetchAt: '2026-09-12T12:00:00.000Z',
      }],
    },
    env: {},
    nowMs: Date.parse('2026-09-12T12:01:00.000Z'),
  });
  assert.equal(evaluation.okForReleaseGate, false);
  assert.equal(evaluation.counts.returnedRecords, 1);
  assert.equal(evaluation.counts.usableRecords, 0);
  assert.equal(evaluation.recordSets[0].unusableRecords, 1);
  assert.equal(evaluation.stages.payloadContract, 'failed');
  assert.ok(evaluation.messages.some((message) => message.includes('usability fields')));
});

test('required payload with stale provider status fails freshness gate even when marked fresh', () => {
  const contract = getSourceContract('earthquakes');
  assert.ok(contract);
  const evaluation = evaluateCapabilityPayload({
    contract,
    httpStatus: 200,
    contentType: 'application/json',
    payload: {
      earthquakes: [{ id: 'eq-1', lat: 10, lng: 20 }],
      status: [{
        source: { providerId: 'usgs-earthquakes', providerName: 'USGS earthquakes' },
        availability: 'ok',
        dataState: 'present',
        freshness: 'fresh',
        acceptedRecords: 1,
        receivedRecords: 1,
        lastSuccessfulFetchAt: '2026-09-12T12:00:00.000Z',
      }],
    },
    env: {},
    nowMs: Date.parse('2026-09-12T13:00:00.000Z'),
  });
  assert.equal(evaluation.providerStatuses[0].freshness, 'stale');
  assert.equal(evaluation.stages.freshness, 'failed');
  assert.equal(evaluation.okForReleaseGate, false);
});

test('required provider status present with zero accepted records is inconsistent and fails', () => {
  const contract = getSourceContract('earthquakes');
  assert.ok(contract);
  const evaluation = evaluateCapabilityPayload({
    contract,
    httpStatus: 200,
    contentType: 'application/json',
    payload: {
      earthquakes: [{ id: 'eq-1', lat: 10, lng: 20 }],
      status: [{
        source: { providerId: 'usgs-earthquakes', providerName: 'USGS earthquakes' },
        availability: 'ok',
        dataState: 'present',
        freshness: 'fresh',
        acceptedRecords: 0,
        receivedRecords: 0,
        lastSuccessfulFetchAt: '2026-09-12T12:00:00.000Z',
      }],
    },
    env: {},
    nowMs: Date.parse('2026-09-12T12:01:00.000Z'),
  });
  assert.equal(evaluation.stages.dataState, 'failed');
  assert.equal(evaluation.okForReleaseGate, false);
  assert.ok(evaluation.messages.some((message) => message.includes('present data with zero accepted records')));
});

test('flights cannot pass with only empty optional flight containers', () => {
  const contract = getSourceContract('flights');
  assert.ok(contract);
  const evaluation = evaluateCapabilityPayload({
    contract,
    httpStatus: 200,
    contentType: 'application/json',
    payload: {
      commercial_flights: [],
      military_flights: [],
      private_flights: [],
      private_jets: [],
      status: [{
        source: { providerId: 'air-traffic-combined', providerName: 'OpenSky / airplanes.live' },
        availability: 'ok',
        dataState: 'empty',
        freshness: 'fresh',
        acceptedRecords: 0,
        receivedRecords: 0,
        lastSuccessfulFetchAt: '2026-09-12T12:00:00.000Z',
      }],
    },
    env: {},
    nowMs: Date.parse('2026-09-12T12:01:00.000Z'),
  });
  assert.equal(evaluation.okForReleaseGate, false);
  assert.equal(evaluation.counts.usableRecords, 0);
  assert.equal(evaluation.stages.dataState, 'failed');
});

test('markets cannot pass when required quote streams are missing', () => {
  const contract = getSourceContract('markets');
  assert.ok(contract);
  const evaluation = evaluateCapabilityPayload({
    contract,
    httpStatus: 200,
    contentType: 'application/json',
    payload: {
      crypto: { Bitcoin: { price: 65000, change_percent: 1.2 } },
      status: [{
        source: { providerId: 'coingecko', providerName: 'CoinGecko simple price API' },
        availability: 'ok',
        dataState: 'present',
        freshness: 'fresh',
        acceptedRecords: 1,
        receivedRecords: 1,
        lastSuccessfulFetchAt: '2026-09-12T12:00:00.000Z',
      }],
    },
    env: {},
    nowMs: Date.parse('2026-09-12T12:01:00.000Z'),
  });
  assert.equal(evaluation.okForReleaseGate, false);
  assert.equal(evaluation.stages.payloadContract, 'failed');
  assert.ok(evaluation.messages.some((message) => message.includes('Missing required record set: stocks')));
});

test('space weather requires a usable Kp index, not just optional alert arrays', () => {
  const contract = getSourceContract('space-weather');
  assert.ok(contract);
  const evaluation = evaluateCapabilityPayload({
    contract,
    httpStatus: 200,
    contentType: 'application/json',
    payload: {
      kp_index: null,
      alerts: [{ id: 'alert-1', message: 'Solar alert' }],
      solar_flares: [],
      status: [{
        source: { providerId: 'noaa-swpc-alerts', providerName: 'NOAA SWPC alerts' },
        availability: 'ok',
        dataState: 'present',
        freshness: 'fresh',
        acceptedRecords: 1,
        receivedRecords: 1,
        lastSuccessfulFetchAt: '2026-09-12T12:00:00.000Z',
      }],
    },
    env: {},
    nowMs: Date.parse('2026-09-12T12:01:00.000Z'),
  });
  assert.equal(evaluation.okForReleaseGate, false);
  assert.equal(evaluation.stages.dataState, 'failed');
  assert.equal(evaluation.recordSets.find((set) => set.id === 'kp_index')?.usableRecords, 0);
});

test('reference records do not count as live observations', () => {
  const contract = getSourceContract('maritime');
  assert.ok(contract);
  const evaluation = evaluateCapabilityPayload({
    contract,
    httpStatus: 200,
    contentType: 'application/json',
    payload: {
      ships: [],
      ports: [{ id: 'port-1', name: 'Reference Port' }],
      chokepoints: [{ id: 'choke-1', name: 'Reference Chokepoint' }],
      status: [
        {
          source: { providerId: 'aisstream', providerName: 'AIS Stream' },
          availability: 'not_configured',
          dataState: 'unavailable',
          freshness: 'unknown',
          acceptedRecords: 0,
          rejectedRecords: 0,
          receivedRecords: 0,
        },
        {
          source: { providerId: 'overseer-maritime-reference', providerName: 'Maritime reference' },
          availability: 'ok',
          dataState: 'present',
          freshness: 'unknown',
          acceptedRecords: 2,
          rejectedRecords: 0,
          receivedRecords: 2,
        },
      ],
    },
    env: {},
  });
  assert.equal(evaluation.counts.liveObservations, 0);
  assert.equal(evaluation.counts.references, 2);
  assert.equal(evaluation.okForReleaseGate, true);
});
