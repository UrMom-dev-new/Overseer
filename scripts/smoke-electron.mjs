import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import WebSocket from 'ws';

const require = createRequire(import.meta.url);
const timeoutMs = Number(process.env.OVERSEER_DESKTOP_SMOKE_TIMEOUT_MS || 120_000);
const reportDir = process.env.OVERSEER_DESKTOP_SMOKE_REPORT_DIR;
const rendererCheckEnabled = process.env.OVERSEER_DESKTOP_RENDERER_CHECK !== '0';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function reservePort() {
  const server = createNetServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : null;
  await new Promise(resolve => server.close(resolve));
  if (!port) throw new Error('Unable to reserve a local debugging port.');
  return port;
}

async function fetchText(url) {
  // Keep the timeout active through body consumption, not just headers.
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return { response, text };
}

async function fetchJson(url) {
  const { text } = await fetchText(url);
  return JSON.parse(text);
}

function createCdpClient(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  socket.on('message', (buffer) => {
    let message;
    try { message = JSON.parse(String(buffer)); } catch { return; }
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message || JSON.stringify(message.error)));
    else resolve(message.result);
  });
  socket.on('close', () => {
    for (const { reject } of pending.values()) reject(new Error('Chrome DevTools Protocol socket closed.'));
    pending.clear();
  });
  socket.on('error', (error) => {
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  });

  return new Promise((resolve, reject) => {
    socket.once('open', () => {
      resolve({
        send(method, params = {}) {
          const messageId = ++id;
          socket.send(JSON.stringify({ id: messageId, method, params }));
          return new Promise((messageResolve, messageReject) => {
            pending.set(messageId, { resolve: messageResolve, reject: messageReject });
          });
        },
        close() {
          socket.close();
        },
      });
    });
    socket.once('error', reject);
  });
}

async function waitForRendererTarget(debugPort, appUrl, deadlineMs) {
  let lastError = null;
  while (Date.now() < deadlineMs) {
    try {
      const targets = await fetchJson(`http://127.0.0.1:${debugPort}/json/list`);
      const pages = Array.isArray(targets) ? targets.filter(target => target.type === 'page') : [];
      const target = pages.find(page => typeof page.url === 'string' && page.url.startsWith(appUrl)) || pages[0];
      if (target?.webSocketDebuggerUrl) return target;
      lastError = new Error('No page target with a debugger URL is available yet.');
    } catch (error) {
      lastError = error;
    }
    await pause(250);
  }
  throw lastError || new Error('Timed out waiting for renderer debugger target.');
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    const description = result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Renderer evaluation failed.';
    throw new Error(description);
  }
  return result.result?.value;
}

async function waitForEvaluation(client, expression, isReady, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  let lastValue = null;
  while (Date.now() < deadline) {
    lastValue = await evaluate(client, expression);
    if (isReady(lastValue)) return lastValue;
    await pause(300);
  }
  throw new Error(`Timed out waiting for renderer state: ${JSON.stringify(lastValue)}`);
}

const dashboardProbe = `(() => {
  const text = document.body?.innerText || '';
  return {
    readyState: document.readyState,
    hasDashboard: Boolean(document.querySelector('[data-testid="overseer-dashboard"]')),
    hasLayerPanel: Boolean(document.querySelector('[data-testid="layer-panel"]')),
    hasSourcesButton: Boolean(document.querySelector('[data-testid="data-sources-button"]')),
    title: document.title,
    includesBrand: text.includes('OVERSEER'),
  };
})()`;

const mapProbe = `(() => {
  const canvas = document.querySelector('canvas.maplibregl-canvas');
  const rect = canvas?.getBoundingClientRect();
  const issue = document.querySelector('[data-testid="map-issue"]')?.textContent?.trim() || '';
  return {
    mapVisible: Boolean(rect && rect.width >= 320 && rect.height >= 240),
    canvasWidth: rect ? Math.round(rect.width) : 0,
    canvasHeight: rect ? Math.round(rect.height) : 0,
    actionableMapIssue: issue,
  };
})()`;

const layerControlProbe = `(async () => {
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const panel = document.querySelector('[data-testid="layer-panel"]');
  const group = document.querySelector('[data-testid="layer-group-hazard"]') || document.querySelector('[data-testid^="layer-group-"]');
  if (group) {
    const rect = group.getBoundingClientRect();
    group.focus?.();
    for (const type of ['mouseover', 'mouseenter']) {
      group.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: rect.left + 2, clientY: rect.top + 2 }));
    }
    await sleep(500);
  }
  const toggles = Array.from(document.querySelectorAll('[data-testid^="layer-toggle-"]'));
  return {
    panelPresent: Boolean(panel),
    groupCount: document.querySelectorAll('[data-testid^="layer-group-"]').length,
    openedControl: toggles.length > 0,
    toggleCount: toggles.length,
    sampleToggle: toggles[0]?.textContent?.replace(/\\s+/g, ' ').trim() || null,
  };
})()`;

const sourceDetailsProbe = `(async () => {
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const waitFor = async (predicate, timeout = 20_000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const value = predicate();
      if (value) return value;
      await sleep(250);
    }
    return null;
  };
  const button = document.querySelector('[data-testid="data-sources-button"]');
  if (button) button.click();
  const panel = await waitFor(() => document.querySelector('[data-testid="data-sources-panel"]'));
  await waitFor(() => panel && !panel.textContent.includes('Loading source manifest'));
  const text = panel?.textContent || '';
  const cards = Array.from(document.querySelectorAll('[data-testid^="source-card-"]'));
  return {
    opened: Boolean(panel),
    cardCount: cards.length,
    hasTestAction: text.includes('TEST SOURCE'),
    hasRefreshAction: text.includes('REFRESH FEED'),
    hasStateLabel: /\\b(ok|partial|not_configured|unavailable|error|unknown)\\b/i.test(text),
    hasRecordDetail: text.includes('ACCEPTED') && text.includes('REJECTED'),
    sample: text.replace(/\\s+/g, ' ').trim().slice(0, 240),
  };
})()`;

async function inspectRenderer(debugPort, appUrl, deadlineMs) {
  const target = await waitForRendererTarget(debugPort, appUrl, deadlineMs);
  const client = await createCdpClient(target.webSocketDebuggerUrl);
  try {
    await client.send('Runtime.enable');
    await client.send('Page.enable');
    const dashboard = await waitForEvaluation(
      client,
      dashboardProbe,
      value => value?.readyState !== 'loading' && value.hasDashboard && value.includesBrand,
      45_000,
    );
    if (!dashboard.hasLayerPanel || !dashboard.hasSourcesButton) {
      throw new Error(`Dashboard controls were not initialized: ${JSON.stringify(dashboard)}`);
    }

    const map = await waitForEvaluation(
      client,
      mapProbe,
      value => value?.mapVisible || Boolean(value?.actionableMapIssue),
      45_000,
    );
    if (!map.mapVisible && !map.actionableMapIssue) {
      throw new Error(`No visible map canvas or actionable map error: ${JSON.stringify(map)}`);
    }

    const layerControl = await evaluate(client, layerControlProbe);
    if (!layerControl.panelPresent || !layerControl.openedControl) {
      throw new Error(`Layer control did not open: ${JSON.stringify(layerControl)}`);
    }

    const sourceDetails = await evaluate(client, sourceDetailsProbe);
    if (!sourceDetails.opened || sourceDetails.cardCount < 1 || !sourceDetails.hasStateLabel || !sourceDetails.hasRecordDetail) {
      throw new Error(`Source details panel was not usable: ${JSON.stringify(sourceDetails)}`);
    }

    return { targetUrl: target.url, dashboard, map, layerControl, sourceDetails };
  } finally {
    client.close();
  }
}

async function main() {
  const testDir = await mkdtemp(join(tmpdir(), 'overseer-desktop-smoke-'));
  const userData = process.env.OVERSEER_DESKTOP_SMOKE_USER_DATA
    ? resolve(process.env.OVERSEER_DESKTOP_SMOKE_USER_DATA)
    : join(testDir, 'profile');
  await mkdir(userData, { recursive: true });
  const packaged = Boolean(process.env.OVERSEER_DESKTOP_BINARY);
  const binary = packaged ? resolve(process.env.OVERSEER_DESKTOP_BINARY) : require('electron');
  const debugPort = rendererCheckEnabled ? await reservePort() : null;
  const env = { ...process.env, ELECTRON_ENABLE_LOGGING: '1', OVERSEER_DESKTOP_USER_DATA: userData };
  // This check must start its own production server and use its own cache.
  delete env.OVERSEER_ELECTRON_URL;
  delete env.OVERSEER_DATA_DIR;
  delete env.ELECTRON_RUN_AS_NODE;
  const spawnArgs = packaged ? [] : [process.cwd()];
  if (debugPort) spawnArgs.unshift(`--remote-debugging-port=${debugPort}`);
  const runtimeLogPath = join(userData, 'logs', 'overseer-desktop.log');
  let previousLogBytes = 0;
  try {
    previousLogBytes = (await stat(runtimeLogPath)).size;
  } catch {
    previousLogBytes = 0;
  }
  const child = spawn(binary, spawnArgs, {
    cwd: testDir, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '', launchError = null, exited = false;
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  child.on('error', error => { launchError = error; });
  child.on('exit', () => { exited = true; });
  let runtimeLog = '', appUrl = null;
  const report = {
    testedAt: new Date().toISOString(),
    packaged,
    binary,
    testDir,
    userData,
    debugPort,
    passed: false,
    scope: rendererCheckEnabled
      ? 'Installed runtime, main-frame load, static assets, source manifest, renderer hydration, map/actionable map error, layer controls, and source detail panel. Live providers are verified by the separate live-source gate.'
      : 'Installed runtime, main-frame load, static assets and source manifest; renderer hydration was explicitly disabled for this harness run.',
  };
  try {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (launchError) throw launchError;
      if (exited) throw new Error(`Desktop exited before readiness (code ${child.exitCode}, signal ${child.signalCode}).`);
      try { runtimeLog = await readFile(runtimeLogPath, 'utf8'); } catch { /* The app may still be creating its log. */ }
      const activeRuntimeLog = previousLogBytes > 0 && runtimeLog.length >= previousLogBytes
        ? runtimeLog.slice(previousLogBytes)
        : runtimeLog;
      const entries = activeRuntimeLog.trim().split('\n').filter(Boolean).flatMap(line => {
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
    let renderer = null;
    if (rendererCheckEnabled) {
      renderer = await inspectRenderer(debugPort, appUrl, deadline);
    }
    Object.assign(report, { passed: true, appUrl, assetsChecked: assets.length, capabilities: sources.capabilities.length, renderer });
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
