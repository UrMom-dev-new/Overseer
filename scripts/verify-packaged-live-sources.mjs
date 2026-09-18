import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';

const cliArgs = process.argv.slice(2);
const getArg = (name, fallback = null) => {
  const prefix = `${name}=`;
  const value = cliArgs.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
};

const binary = process.env.OVERSEER_DESKTOP_BINARY ? resolve(process.env.OVERSEER_DESKTOP_BINARY) : null;
const outputPath = getArg('--output', process.env.OVERSEER_PACKAGED_LIVE_REPORT || 'desktop-smoke-results/live-sources.json');
const mode = getArg('--mode', process.env.OVERSEER_PACKAGED_LIVE_MODE || 'release-gate');
const timeoutMs = Number(getArg('--startup-timeout-ms', process.env.OVERSEER_DESKTOP_SMOKE_TIMEOUT_MS || '120000'));
const verifyTimeoutMs = Number(getArg('--verify-timeout-ms', process.env.OVERSEER_VERIFY_TIMEOUT_MS || '35000'));
const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function reservePort() {
  const server = createNetServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : null;
  await new Promise(resolve => server.close(resolve));
  if (!port) throw new Error('Unable to reserve a local packaged-app port.');
  return port;
}

async function probeHealth(url) {
  try {
    const response = await fetch(`${url}/api/health`, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    const body = await response.json();
    return response.ok && body?.appId === 'overseer' && body.processStatus === 'alive';
  } catch {
    return false;
  }
}

async function waitForAppUrl(userData, child, appUrlCandidates) {
  const deadline = Date.now() + timeoutMs;
  let runtimeLog = '';
  let sawInteractiveLog = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Packaged app exited before live verification (code ${child.exitCode}, signal ${child.signalCode}).`);
    }
    try { runtimeLog = await readFile(join(userData, 'logs', 'overseer-desktop.log'), 'utf8'); } catch { /* log may not exist yet */ }
    const entries = runtimeLog.trim().split('\n').filter(Boolean).flatMap(line => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
    const failed = entries.find(entry => entry.message.startsWith('failed:') || entry.message.startsWith('error:'));
    if (failed) throw new Error(`${failed.message}: ${JSON.stringify(failed.detail)}`);
    const ready = entries.find(entry => entry.message.includes('Local server listening on'));
    const match = ready?.message.match(/http:\/\/127\.0\.0\.1:\d+/);
    sawInteractiveLog = sawInteractiveLog || entries.some(entry => entry.message.startsWith('dashboard interactive:'));
    if (match && sawInteractiveLog) {
      return { appUrl: match[0], runtimeLog };
    }
    for (const candidate of appUrlCandidates) {
      if (await probeHealth(candidate)) return { appUrl: candidate, runtimeLog };
    }
    await pause(250);
  }
  throw new Error('Timed out waiting for packaged app local server URL.');
}

function run(command, args, env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; process.stdout.write(chunk); });
    child.stderr.on('data', chunk => { stderr += chunk; process.stderr.write(chunk); });
    child.once('exit', code => resolve({ code, stdout, stderr }));
    child.once('error', error => resolve({ code: 1, stdout, stderr: `${stderr}${error.message}` }));
  });
}

async function stopProcess(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    const kill = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', timeout: 5000 });
    await new Promise(resolve => { kill.once('exit', resolve); kill.once('error', resolve); });
    return;
  }
  child.kill();
  const deadline = Date.now() + 5000;
  while (child.exitCode === null && Date.now() < deadline) await pause(100);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function main() {
  if (!binary) throw new Error('Set OVERSEER_DESKTOP_BINARY to the packaged app executable to verify.');
  const testDir = await mkdtemp(join(tmpdir(), 'overseer-packaged-live-'));
  const userData = join(testDir, 'profile');
  const outputAbsolute = resolve(outputPath);
  const outputDirectory = dirname(outputAbsolute);
  await mkdir(userData, { recursive: true });
  await mkdir(outputDirectory, { recursive: true });
  const configuredAppPort = Number.parseInt(String(process.env.OVERSEER_DESKTOP_PORT || process.env.PORT || ''), 10);
  const appPort = Number.isInteger(configuredAppPort) && configuredAppPort > 0 && configuredAppPort < 65536
    ? configuredAppPort
    : await reservePort();
  const appUrlCandidates = [`http://127.0.0.1:${appPort}`];
  if (appPort !== 45454) appUrlCandidates.push('http://127.0.0.1:45454');

  const env = {
    ...process.env,
    ELECTRON_ENABLE_LOGGING: '1',
    OVERSEER_DESKTOP_PORT: String(appPort),
    OVERSEER_DESKTOP_USER_DATA: userData,
  };
  delete env.OVERSEER_ELECTRON_URL;
  delete env.OVERSEER_DATA_DIR;
  delete env.ELECTRON_RUN_AS_NODE;

  const child = spawn(binary, [], { cwd: testDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let processLog = '';
  child.stdout.on('data', chunk => { processLog += chunk; });
  child.stderr.on('data', chunk => { processLog += chunk; });

  try {
    const { appUrl, runtimeLog } = await waitForAppUrl(userData, child, appUrlCandidates);
    const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
    const result = await run(pnpm, [
      'run',
      'verify:live-sources',
      '--',
      `--base-url=${appUrl}`,
      `--timeout-ms=${verifyTimeoutMs}`,
      `--output=${outputAbsolute}`,
      `--mode=${mode}`,
      '--summary-only',
    ], { ...process.env, OVERSEER_BASE_URL: appUrl });
    await writeFile(join(outputDirectory, 'packaged-live-runtime.log'), runtimeLog);
    await writeFile(join(outputDirectory, 'packaged-live-process.log'), processLog);
    if (result.code !== 0) {
      throw new Error(`Live-source verification failed with exit code ${result.code}.`);
    }
  } finally {
    await stopProcess(child);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
