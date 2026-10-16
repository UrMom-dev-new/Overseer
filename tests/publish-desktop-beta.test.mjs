import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertLiveGate, assertMacReport, assertRun } from '../scripts/publish-desktop-beta.mjs';

test('publication rejects other commits, PR builds, failed runs, and wrong workflows', () => {
  const run = { head_sha: 'commit', head_branch: 'main', status: 'completed', conclusion: 'success', path: '.github/workflows/desktop-packages.yml', event: 'push' };
  assertRun(run, 'commit', 'desktop-packages.yml');
  for (const change of [{ head_sha: 'old' }, { head_branch: 'branch' }, { status: 'in_progress' }, { conclusion: 'failure' }, { event: 'pull_request' }, { path: '.github/workflows/other.yml' }]) {
    assert.throws(() => assertRun({ ...run, ...change }, 'commit', 'desktop-packages.yml'), /exact source commit/);
  }
});

test('publication requires all required live-source results, not report-only or a partial pass', () => {
  const report = { mode: 'release-gate', releaseGate: true, results: ['earthquakes', 'news', 'weather', 'fires', 'flights', 'satellites', 'markets', 'space-weather'].map((id) => ({ id, requirement: 'required', passed: true, okForReleaseGate: true })) };
  assertLiveGate(report);
  for (const change of [{ mode: 'report-only' }, { releaseGate: false }, { results: [] }, { results: report.results.slice(1) }, { results: report.results.map((item) => ({ ...item, okForReleaseGate: false })) }]) {
    assert.throws(() => assertLiveGate({ ...report, ...change }), /release gate/);
  }
});

test('publication requires consistent native macOS archive and runtime evidence', () => {
  const report = { commit: 'commit', version: '0.2.1', arch: 'x64', platform: 'darwin', signed: false, notarized: false, nativeRunner: true, archivesIdentical: true, bundleUnchangedAfterRuntime: true, rendererSmoke: 'passed', requiredLiveSourceGate: 'passed' };
  assertMacReport(report, 'commit', '0.2.1', 'x64');
  for (const change of [{ commit: 'old' }, { arch: 'arm64' }, { version: '0.2.0' }, { nativeRunner: false }, { archivesIdentical: false }, { signed: true }, { notarized: true }, { rendererSmoke: 'not_checked' }, { bundleUnchangedAfterRuntime: false }]) {
    assert.throws(() => assertMacReport({ ...report, ...change }, 'commit', '0.2.1', 'x64'), /verification/);
  }
});
