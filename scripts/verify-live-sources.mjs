import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const {
  VERIFY_ROUTE_CONTRACTS,
  evaluateCapabilityPayload,
  REQUIRED_CAPABILITY_IDS,
} = require('../.verify-build/src/lib/source-contracts.js');

const cliArgs = process.argv.slice(2);
const args = new Set(cliArgs);
const getArg = (name, fallback = null) => {
  const prefix = `${name}=`;
  const value = cliArgs.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
};

const baseUrl = (getArg('--base-url') || process.env.OVERSEER_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const timeoutMs = Number(getArg('--timeout-ms') || process.env.OVERSEER_VERIFY_TIMEOUT_MS || 20_000);
const mode = args.has('--report-only') || getArg('--mode') === 'report-only' ? 'report-only' : 'release-gate';
const outputPath = getArg('--output');
const summaryOnly = args.has('--summary-only');

function timeoutSignal() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

async function fetchJson(pathname) {
  const { signal, cancel } = timeoutSignal();
  const startedAt = Date.now();
  try {
    const response = await fetch(`${baseUrl}${pathname}`, { signal, cache: 'no-store' });
    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();
    let payload = null;
    let parseError = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch (error) {
      parseError = error instanceof Error ? error.message : String(error);
    }
    return {
      httpStatus: response.status,
      contentType,
      payload,
      parseError,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      httpStatus: null,
      contentType: null,
      payload: null,
      parseError: null,
      durationMs: Date.now() - startedAt,
      transportError: error instanceof Error ? error.message : String(error),
    };
  } finally {
    cancel();
  }
}

function gitValue(args) {
  try {
    return execFileSync('git', args, { cwd: resolve(__dirname, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function packageVersion() {
  try {
    return JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8')).version || null;
  } catch {
    return null;
  }
}

function summarize(results, sourcesDiagnostic) {
  const required = results.filter((result) => result.requirement === 'required');
  const failedRequired = required.filter((result) => !result.okForReleaseGate);
  const warnings = results.filter((result) => result.passed && Object.values(result.stages).includes('warning'));
  const optionalNotConfigured = results.filter((result) => result.stages.configuration === 'not_configured' || result.stages.providerCollection === 'not_configured');
  const lines = [
    `OVERSEER live-source verification (${mode})`,
    `Base URL: ${baseUrl}`,
    `Required capabilities: ${REQUIRED_CAPABILITY_IDS.join(', ')}`,
    `/api/sources: ${sourcesDiagnostic.ok ? 'reachable' : 'failed'}`,
    `Required passed: ${required.length - failedRequired.length}/${required.length}`,
    `Warnings: ${warnings.length}`,
    `Optional/report not configured: ${optionalNotConfigured.length}`,
  ];
  for (const failure of failedRequired) {
    lines.push(`FAIL ${failure.id}: ${failure.messages.join(' ') || JSON.stringify(failure.stages)}`);
  }
  if (mode === 'report-only') {
    lines.push('Report-only mode is informational and is not a release gate.');
  }
  return lines.join('\n');
}

async function main() {
  const sourcesResponse = await fetchJson('/api/sources');
  const sourcesDiagnostic = {
    ok: sourcesResponse.httpStatus !== null &&
      sourcesResponse.httpStatus >= 200 &&
      sourcesResponse.httpStatus < 300 &&
      !sourcesResponse.parseError &&
      sourcesResponse.payload &&
      typeof sourcesResponse.payload === 'object' &&
      Array.isArray(sourcesResponse.payload.capabilities),
    httpStatus: sourcesResponse.httpStatus,
    contentType: sourcesResponse.contentType,
    durationMs: sourcesResponse.durationMs,
    parseError: sourcesResponse.parseError,
    transportError: sourcesResponse.transportError || null,
  };

  const results = [];
  for (const contract of VERIFY_ROUTE_CONTRACTS) {
    const response = await fetchJson(contract.apiRoute);
    const evaluation = evaluateCapabilityPayload({
      contract,
      httpStatus: response.httpStatus,
      contentType: response.contentType,
      payload: response.payload,
      parseError: response.parseError,
      env: process.env,
      renderingChecked: false,
    });
    results.push({
      ...evaluation,
      durationMs: response.durationMs,
      transportError: response.transportError || null,
    });
  }

  const report = {
    schemaVersion: 1,
    mode,
    releaseGate: mode === 'release-gate',
    testedAt: new Date().toISOString(),
    baseUrl,
    platform: `${process.platform}-${process.arch}`,
    runtime: {
      node: process.version,
      packageVersion: packageVersion(),
      commit: gitValue(['rev-parse', 'HEAD']),
      branch: gitValue(['branch', '--show-current']),
    },
    requirements: {
      requiredCapabilityIds: REQUIRED_CAPABILITY_IDS,
      renderingChecked: false,
      note: 'CLI live verification validates backend route contracts. Browser source-to-screen rendering requires the deterministic integration suite.',
    },
    sourcesDiagnostic,
    results,
  };
  const failedRequired = results.filter((result) => result.requirement === 'required' && !result.okForReleaseGate);
  const appFailed = !sourcesDiagnostic.ok;
  const exitCode = mode === 'release-gate' && (appFailed || failedRequired.length > 0) ? 1 : 0;
  const humanSummary = summarize(results, sourcesDiagnostic);

  if (outputPath) {
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.error(humanSummary);
  if (!summaryOnly) {
    console.log(JSON.stringify(report, null, 2));
  }
  process.exit(exitCode);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
