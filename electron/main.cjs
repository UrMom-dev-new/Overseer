const { app, BrowserWindow, clipboard, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const HOST = '127.0.0.1';
const DEFAULT_PORT = 45454;
const PORT_SCAN_LIMIT = 30;
const READINESS_TIMEOUT_MS = 30_000;
const READINESS_INTERVAL_MS = 500;
const PREPARE_TIMEOUT_MS = 45_000;
const SHUTDOWN_TIMEOUT_MS = 8_000;
const MAX_LOG_BYTES = 2 * 1024 * 1024;

// Keep installed-app smoke checks isolated from an existing user's workspace.
if (process.env.OVERSEER_DESKTOP_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.OVERSEER_DESKTOP_USER_DATA));
}

let mainWindow = null;
let nextServer = null;
let ownedConnections = new Set();
let currentAppUrl = null;
let logDir = null;
let logFile = null;
let dataDir = null;
let bootPromise = null;
let bootGeneration = 0;
let lastDiagnostics = {
  phase: 'initializing',
  message: 'Overseer desktop runtime initializing.',
  detail: null,
  appUrl: null,
  logFile: null,
  timestamp: new Date().toISOString(),
};
let desktopBuildInfo = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

function parsePort(value, fallback) {
  const port = Number.parseInt(String(value || ''), 10);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : fallback;
}

function sanitizeError(error) {
  if (!error) return null;
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: error.code || null,
    };
  }
  return { message: String(error) };
}

function readDesktopBuildInfo() {
  const fallback = {
    productName: app.getName(),
    version: app.getVersion(),
    commit: process.env.OVERSEER_BUILD_COMMIT || null,
    branch: process.env.OVERSEER_BUILD_BRANCH || null,
    signed: null,
  };
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'electron', 'build-info.generated.json'), 'utf8'));
    return { ...fallback, ...parsed };
  } catch {
    return fallback;
  }
}

function writeLog(level, message, detail = null) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    detail,
  };
  const line = `${JSON.stringify(entry)}\n`;
  if (level === 'error') console.error(`[overseer-desktop] ${message}`, detail || '');
  else console.info(`[overseer-desktop] ${message}`);
  if (logFile) {
    try {
      fs.appendFileSync(logFile, line, 'utf8');
    } catch (error) {
      console.error('[overseer-desktop] Failed to write log file', error);
    }
  }
}

function updateStatus(phase, message, detail = null, appUrl = currentAppUrl) {
  lastDiagnostics = {
    phase,
    message,
    detail,
    appUrl,
    logFile,
    timestamp: new Date().toISOString(),
  };
  writeLog(phase === 'error' ? 'error' : 'info', `${phase}: ${message}`, detail);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('overseer:startup-status', lastDiagnostics);
  }
}

function withDeadline(promise, timeoutMs, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function assertCurrentGeneration(generation) {
  if (generation !== bootGeneration) {
    throw new Error('Startup attempt was superseded by a newer request.');
  }
}

function requiredAssetCheck(appDir) {
  const required = [
    '.next',
    path.join('.next', 'server'),
    path.join('.next', 'static'),
    'public',
    'package.json',
  ];
  const missing = required.filter((item) => !fs.existsSync(path.join(appDir, item)));
  if (missing.length > 0) {
    throw new Error(`Missing production assets: ${missing.join(', ')}`);
  }
}

function createServer(requestHandler) {
  const server = http.createServer((request, response) => requestHandler(request, response));
  server.on('connection', (socket) => {
    ownedConnections.add(socket);
    socket.on('close', () => ownedConnections.delete(socket));
  });
  return server;
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, HOST);
  });
}

async function bindWithRetry(requestHandler, preferredPort) {
  for (let offset = 0; offset < PORT_SCAN_LIMIT; offset += 1) {
    const port = preferredPort + offset;
    const server = createServer(requestHandler);
    try {
      await listen(server, port);
      return { server, port };
    } catch (error) {
      server.close();
      if (error && (error.code === 'EADDRINUSE' || error.code === 'EACCES')) {
        writeLog('info', `Port ${port} unavailable; trying next port.`, sanitizeError(error));
        continue;
      }
      throw error;
    }
  }

  throw new Error(`No available local port found starting at ${preferredPort}.`);
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`Readiness returned non-JSON HTTP ${response.status}.`);
    }
    return { response, body };
  } finally {
    clearTimeout(timer);
  }
}

async function waitForReadiness(appUrl) {
  const deadline = Date.now() + READINESS_TIMEOUT_MS;
  const healthUrl = `${appUrl}/api/health`;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const { response, body } = await fetchJson(healthUrl, 5000);
      if (response.ok && body && body.processStatus === 'alive') {
        return body;
      }
      lastError = new Error(`Health returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, READINESS_INTERVAL_MS));
  }

  throw lastError || new Error('Timed out waiting for local application readiness.');
}

async function startNextServer(generation) {
  process.env.NODE_ENV = 'production';
  process.env.NEXT_TELEMETRY_DISABLED = process.env.NEXT_TELEMETRY_DISABLED || '1';

  const appDir = app.getAppPath();
  updateStatus('preparing runtime', 'Checking packaged production assets.', { appDir });
  requiredAssetCheck(appDir);

  const preferredPort = parsePort(process.env.OVERSEER_DESKTOP_PORT || process.env.PORT, DEFAULT_PORT);
  const next = require('next');
  const nextApp = next({ dev: false, dir: appDir, hostname: HOST, port: preferredPort });

  updateStatus('preparing runtime', 'Preparing local Next.js runtime.');
  await withDeadline(nextApp.prepare(), PREPARE_TIMEOUT_MS, 'Next.js runtime preparation');
  assertCurrentGeneration(generation);

  const requestHandler = nextApp.getRequestHandler();
  updateStatus('binding', `Binding local server on ${HOST}.`);
  const bound = await bindWithRetry(requestHandler, preferredPort);
  assertCurrentGeneration(generation);
  nextServer = bound.server;

  const url = `http://${HOST}:${bound.port}`;
  currentAppUrl = url;
  updateStatus('server ready', `Local server listening on ${url}.`, null, url);

  const health = await waitForReadiness(url);
  assertCurrentGeneration(generation);
  updateStatus('dashboard loading', 'Local application readiness verified.', { health }, url);
  return url;
}

function safeExternalUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' || parsed.protocol === 'mailto:';
  } catch {
    return false;
  }
}

function isSameOrigin(appUrl, candidateUrl) {
  try {
    return new URL(appUrl).origin === new URL(candidateUrl).origin;
  } catch {
    return false;
  }
}

function showStartupWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  void mainWindow.loadFile(path.join(__dirname, 'startup.html')).then(() => {
    updateStatus(lastDiagnostics.phase, lastDiagnostics.message, lastDiagnostics.detail, lastDiagnostics.appUrl);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1120,
    minHeight: 720,
    show: true,
    title: 'Overseer',
    backgroundColor: '#05070A',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (currentAppUrl && isSameOrigin(currentAppUrl, url)) return { action: 'allow' };
    if (safeExternalUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (currentAppUrl && isSameOrigin(currentAppUrl, url)) return;
    event.preventDefault();
    if (safeExternalUrl(url)) shell.openExternal(url);
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    updateStatus('error', 'The dashboard failed to load.', { errorCode, errorDescription, validatedURL });
    showStartupWindow();
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    updateStatus('error', 'The dashboard renderer stopped unexpectedly.', details);
    showStartupWindow();
  });

  showStartupWindow();
}

function closeServer() {
  return new Promise((resolve) => {
    if (!nextServer) {
      resolve();
      return;
    }
    const server = nextServer;
    nextServer = null;
    const deadline = setTimeout(() => {
      for (const socket of ownedConnections) socket.destroy();
      ownedConnections.clear();
      resolve();
    }, SHUTDOWN_TIMEOUT_MS);
    server.close(() => {
      clearTimeout(deadline);
      resolve();
    });
  });
}

async function boot({ restart = false } = {}) {
  if (bootPromise) return bootPromise;
  bootPromise = bootInner({ restart }).finally(() => {
    bootPromise = null;
  });
  return bootPromise;
}

async function bootInner({ restart = false } = {}) {
  const generation = ++bootGeneration;
  try {
    if (restart) {
      updateStatus('stopping', 'Restarting local application runtime.');
      await closeServer();
      currentAppUrl = null;
      showStartupWindow();
    }

    const appUrl = process.env.OVERSEER_ELECTRON_URL || await startNextServer(generation);
    assertCurrentGeneration(generation);
    currentAppUrl = appUrl;
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
    updateStatus('dashboard loading', 'Loading dashboard.', null, appUrl);
    await mainWindow.loadURL(appUrl);
    assertCurrentGeneration(generation);
    updateStatus('dashboard interactive', 'Dashboard main frame loaded.', null, appUrl);
  } catch (error) {
    updateStatus('failed', 'Overseer failed to start. Use Retry or open logs for diagnostics.', sanitizeError(error));
    showStartupWindow();
  }
}

function isTrustedIpcEvent(event) {
  const frameUrl = event.senderFrame?.url || event.sender.getURL();
  if (!frameUrl) return false;
  if (frameUrl.startsWith('file://') && frameUrl.endsWith('/startup.html')) return true;
  return currentAppUrl ? isSameOrigin(currentAppUrl, frameUrl) : false;
}

ipcMain.handle('overseer:retry-startup', async (event) => {
  if (!isTrustedIpcEvent(event)) return { ...lastDiagnostics, phase: 'failed', message: 'Untrusted startup retry request rejected.' };
  if (bootPromise) return { ...lastDiagnostics, message: 'Startup already in progress.' };
  await boot({ restart: true });
  return lastDiagnostics;
});

ipcMain.handle('overseer:open-logs', async (event) => {
  if (!isTrustedIpcEvent(event)) return { ok: false, message: 'Untrusted log request rejected.' };
  if (!logDir) return { ok: false, message: 'Log directory is not initialized.' };
  const result = await shell.openPath(logDir);
  return { ok: result === '', message: result || 'opened' };
});

ipcMain.handle('overseer:copy-diagnostics', async (event) => {
  if (!isTrustedIpcEvent(event)) return { ok: false, message: 'Untrusted diagnostics request rejected.' };
  const diagnostics = {
    ...lastDiagnostics,
    appName: app.getName(),
    appVersion: app.getVersion(),
    appId: 'dev.urmom.overseer',
    build: desktopBuildInfo || readDesktopBuildInfo(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    node: process.versions.node,
  };
  clipboard.writeText(JSON.stringify(diagnostics, null, 2));
  return { ok: true };
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  desktopBuildInfo = readDesktopBuildInfo();
  dataDir = path.join(app.getPath('userData'), 'data');
  logDir = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });
  process.env.OVERSEER_DATA_DIR = process.env.OVERSEER_DATA_DIR || dataDir;
  logFile = path.join(logDir, 'overseer-desktop.log');
  try {
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > MAX_LOG_BYTES) {
      fs.renameSync(logFile, path.join(logDir, 'overseer-desktop.log.1'));
    }
  } catch {
    // Log rotation must not block startup.
  }
  updateStatus('initializing', 'Creating desktop window.');
  createWindow();
  void boot();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
    if (currentAppUrl) {
      void mainWindow.loadURL(currentAppUrl);
    } else {
      void boot();
    }
  }
});

app.on('before-quit', () => {
  bootGeneration++;
  if (nextServer) {
    nextServer.close();
    nextServer = null;
  }
  for (const socket of ownedConnections) socket.destroy();
  ownedConnections.clear();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
