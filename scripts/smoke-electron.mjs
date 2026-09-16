import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const require = createRequire(import.meta.url);
const timeoutMs = Number(process.env.OVERSEER_DESKTOP_SMOKE_TIMEOUT_MS || 120_000);
const reportDir = process.env.OVERSEER_DESKTOP_SMOKE_REPORT_DIR;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchText(url) {
  // Keep the timeout active through body consumption, not just headers.
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return { response, text };
}

async function main() {
  const testDir = await mkdtemp(join(tmpdir(), 'overseer-desktop-smoke-'));
  const userData = join(testDir, 'profile');
  await mkdir(userData);
  const packaged = Boolean(process.env.OVERSEER_DESKTOP_BINARY);
  const binary = packaged ? resolve(process.env.OVERSEER_DESKTOP_BINARY) : require('electron');
  const env = { ...process.env, ELECTRON_ENABLE_LOGGING: '1', OVERSEER_DESKTOP_USER_DATA: userData };
  // This check must start its own production server and use its own cache.
  delete env.OVERSEER_ELECTRON_URL;
  delete env.OVERSEER_DATA_DIR;
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(binary, packaged ? [] : [process.cwd()], {
    cwd: testDir, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '', launchError = null, exited = false;
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  child.on('error', error => { launchError = error; });
  child.on('exit', () => { exited = true; });
  let runtimeLog = '', appUrl = null;
  const report = { testedAt: new Date().toISOString(), packaged, binary, testDir, passed: false, scope: 'Installed runtime, main-frame load, static assets and source manifest; live providers and renderer hydration are not verified.' };
  try {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (launchError) throw launchError;
      if (exited) throw new Error(`Desktop exited before readiness (code ${child.exitCode}, signal ${child.signalCode}).`);
      try { runtimeLog = await readFile(join(userData, 'logs', 'overseer-desktop.log'), 'utf8'); } catch { /* The app may still be creating its log. */ }
      const entries = runtimeLog.trim().split('\n').filter(Boolean).flatMap(line => {
        try { return [JSON.parse(line)]; } catch { return []; }
      });
      const failed = entries.find(entry => entry.message.startsWith('failed:') || entry.message.startsWith('error:'));
      if (failed) throw new Error(`${failed.message}: ${JSON.stringify(failed.detail)}`);
      const ready = entries.find(entry => entry.message.includes('Local server listening on'));
      const match = ready?.message.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) appUrl = match[0];
      if (appUrl && entries.some(entry => entry.message.startsWith('dashboard interactive:'))) break;
      await pause(250);
    }
    if (!appUrl || !runtimeLog.includes('dashboard interactive:')) throw new Error('Timed out waiting for desktop main-frame load.');
    const { text: healthText } = await fetchText(`${appUrl}/api/health`);
    const health = JSON.parse(healthText);
    if (health.appId !== 'overseer' || health.processStatus !== 'alive') throw new Error('Unexpected application identity.');
    const { text: html } = await fetchText(appUrl);
    if (!html.includes('OVERSEER')) throw new Error('Dashboard shell is missing.');
    const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"?]+)(?:[^" ]*)"/g)].map(match => match[1]))];
    if (!assets.length) throw new Error('Dashboard has no bundled static assets.');
    for (const asset of assets) {
      const { text, response } = await fetchText(`${appUrl}${asset}`);
      if (!text.length || response.headers.get('content-type')?.includes('text/html')) throw new Error(`Invalid static asset: ${asset}`);
    }
    const { text: sourcesText } = await fetchText(`${appUrl}/api/sources`);
    const sources = JSON.parse(sourcesText);
    if (!Array.isArray(sources.capabilities) || !sources.capabilities.length) throw new Error('Source manifest is missing.');
    Object.assign(report, { passed: true, appUrl, assetsChecked: assets.length, capabilities: sources.capabilities.length });
  } catch (error) {
    report.error = error.message;
    process.exitCode = 1;
  } finally {
    if (child.pid && !exited) {
      if (process.platform === 'win32') {
        // Kill the owned tree before a portable launcher can orphan its app.
        const kill = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', timeout: 5000 });
        await new Promise(resolve => { kill.once('exit', resolve); kill.once('error', resolve); });
      } else {
        child.kill();
      }
      const stopDeadline = Date.now() + 5000;
      while (!exited && Date.now() < stopDeadline) await pause(100);
      if (!exited) child.kill('SIGKILL');
    }
    const destination = reportDir ? resolve(reportDir) : testDir;
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, 'smoke.json'), `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(join(destination, 'runtime.log'), runtimeLog);
    await writeFile(join(destination, 'process.log'), output);
    console.log(JSON.stringify(report, null, 2));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
