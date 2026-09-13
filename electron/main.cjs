const { app, BrowserWindow, dialog, shell } = require('electron');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const HOST = '127.0.0.1';
const DEFAULT_PORT = 45454;
const PORT_SCAN_LIMIT = 30;

let mainWindow = null;
let nextServer = null;
let currentAppUrl = null;

function parsePort(value, fallback) {
  const port = Number.parseInt(String(value || ''), 10);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : fallback;
}

function canListen(port) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once('error', () => resolve(false));
    tester.once('listening', () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, HOST);
  });
}

async function findAvailablePort(preferredPort) {
  for (let offset = 0; offset < PORT_SCAN_LIMIT; offset += 1) {
    const port = preferredPort + offset;
    if (await canListen(port)) return port;
  }

  throw new Error(`No available local port found starting at ${preferredPort}.`);
}

async function startNextServer() {
  process.env.NODE_ENV = 'production';
  process.env.NEXT_TELEMETRY_DISABLED = process.env.NEXT_TELEMETRY_DISABLED || '1';

  const preferredPort = parsePort(process.env.OVERSEER_DESKTOP_PORT || process.env.PORT, DEFAULT_PORT);
  const port = await findAvailablePort(preferredPort);
  const appDir = app.getAppPath();
  const next = require('next');
  const nextApp = next({ dev: false, dir: appDir, hostname: HOST, port });

  await nextApp.prepare();

  const requestHandler = nextApp.getRequestHandler();
  nextServer = http.createServer((request, response) => requestHandler(request, response));

  await new Promise((resolve, reject) => {
    nextServer.once('error', reject);
    nextServer.listen(port, HOST, () => {
      nextServer.off('error', reject);
      resolve();
    });
  });

  const url = `http://${HOST}:${port}`;
  console.info(`[overseer-desktop] Next server listening on ${url}`);
  return url;
}

function isSameOrigin(appUrl, candidateUrl) {
  try {
    return new URL(appUrl).origin === new URL(candidateUrl).origin;
  } catch {
    return false;
  }
}

function createWindow(appUrl) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1120,
    minHeight: 720,
    show: false,
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

  mainWindow.once('ready-to-show', () => {
    if (mainWindow) mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!isSameOrigin(appUrl, url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isSameOrigin(appUrl, url)) return;
    event.preventDefault();
    shell.openExternal(url);
  });

  void mainWindow.loadURL(appUrl);
}

async function boot() {
  const appUrl = process.env.OVERSEER_ELECTRON_URL || await startNextServer();
  currentAppUrl = appUrl;
  createWindow(appUrl);
}

app.whenReady().then(() => {
  void boot().catch((error) => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    dialog.showErrorBox('Overseer failed to start', message);
    app.quit();
  });
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && currentAppUrl) {
    createWindow(currentAppUrl);
  }
});

app.on('before-quit', () => {
  if (nextServer) {
    nextServer.close();
    nextServer = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
