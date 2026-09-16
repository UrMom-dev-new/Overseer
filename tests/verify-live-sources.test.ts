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

test('schema-valid empty payload is classified without invented records', () => {
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
  assert.equal(evaluation.passed, true);
  assert.equal(evaluation.counts.liveObservations, 0);
  assert.equal(evaluation.activeFallback, null);
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
      ports: [{ id: 'port-1' }],
      chokepoints: [{ id: 'choke-1' }],
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
