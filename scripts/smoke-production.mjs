import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const host = '127.0.0.1';
const port = process.env.OVERSEER_SMOKE_PORT || '3100';
const baseUrl = `http://${host}:${port}`;
const startupTimeoutMs = 30_000;
const nodeBin = process.execPath;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`, { cache: 'no-store' });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${pathname} returned non-JSON HTTP ${response.status}`);
  }
  return { response, body };
}

async function waitForReady(child) {
  const deadline = Date.now() + startupTimeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Production server exited early with code ${child.exitCode}`);
    try {
      const { response, body } = await fetchJson('/api/health');
      if (response.ok && body?.processStatus === 'alive') return;
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
      const response = await fetch(`${baseUrl}${pathname}`, { cache: 'no-store' });
      results.push({ pathname, status: response.status, ok: response.ok, contentType: response.headers.get('content-type') });
      if (!response.ok) throw new Error(`${pathname} returned HTTP ${response.status}`);
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
