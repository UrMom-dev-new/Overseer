import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const host = '127.0.0.1';
const port = process.env.OVERSEER_SMOKE_PORT || '3100';
const baseUrl = `http://${host}:${port}`;
const startupTimeoutMs = 30_000;
const requestTimeoutMs = 10_000;
const nodeBin = process.execPath;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(pathname) {
  const response = await fetchWithTimeout(`${baseUrl}${pathname}`);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${pathname} returned non-JSON HTTP ${response.status}`);
  }
  return { response, body };
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    return await fetch(url, { cache: 'no-store', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function waitForReady(child) {
  const deadline = Date.now() + startupTimeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Production server exited early with code ${child.exitCode}`);
    try {
      const { response, body } = await fetchJson('/api/health');
      if (response.ok && body?.appId === 'overseer' && body?.processStatus === 'alive') return;
      lastError = new Error(`Health HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await wait(500);
  }
  throw lastError || new Error('Timed out waiting for production server readiness');
}

async function main() {
  if (!existsSync('.next/standalone/server.js')) {
    throw new Error('Missing .next/standalone/server.js. Run `pnpm run build` before `pnpm run smoke:prod`.');
  }
  await mkdir('.next/standalone/.next', { recursive: true });
  if (existsSync('.next/static') && !existsSync('.next/standalone/.next/static')) {
    await cp('.next/static', '.next/standalone/.next/static', { recursive: true });
  }
  if (existsSync('public') && !existsSync('.next/standalone/public')) {
    await cp('public', '.next/standalone/public', { recursive: true });
  }

  const server = spawn(nodeBin, ['.next/standalone/server.js'], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: port,
      HOSTNAME: host,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  server.stdout.on('data', (buffer) => process.stdout.write(buffer));
  server.stderr.on('data', (buffer) => process.stderr.write(buffer));

  try {
    await waitForReady(server);
    const checks = ['/', '/api/health', '/api/earthquakes', '/api/news', '/api/sources'];
    const results = [];
    for (const pathname of checks) {
      const response = await fetchWithTimeout(`${baseUrl}${pathname}`);
      const text = await response.text();
      results.push({ pathname, status: response.status, ok: response.ok, contentType: response.headers.get('content-type'), bytes: text.length });
      if (!response.ok) throw new Error(`${pathname} returned HTTP ${response.status}`);
      if (pathname === '/' && (!text.includes('OVERSEER') || !text.includes('/_next/static/'))) {
        throw new Error('Dashboard HTML did not include the expected app shell and Next.js assets.');
      }
      if (pathname === '/api/health') {
        const health = JSON.parse(text);
        if (health.appId !== 'overseer') throw new Error('Health endpoint did not identify the Overseer app instance.');
      }
      if (pathname === '/api/sources') {
        const sources = JSON.parse(text);
        if (!Array.isArray(sources.capabilities) || sources.capabilities.length === 0) {
          throw new Error('/api/sources did not return source capabilities.');
        }
      }
    }
    console.log(JSON.stringify({ baseUrl, results }, null, 2));
  } finally {
    server.kill();
    await Promise.race([once(server, 'exit'), wait(2000)]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
