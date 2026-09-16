import { spawn } from 'node:child_process';

const binary = process.env.OVERSEER_DESKTOP_BINARY || './node_modules/.bin/electron';
const args = process.env.OVERSEER_DESKTOP_BINARY ? [] : ['.'];
const timeoutMs = Number(process.env.OVERSEER_DESKTOP_SMOKE_TIMEOUT_MS || 30_000);
const requestTimeoutMs = 10_000;

function finish(child, code, timer) {
  clearTimeout(timer);
  if (!child.killed) child.kill();
  process.exit(code);
}

const child = spawn(binary, args, {
  cwd: process.cwd(),
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
const timer = setTimeout(() => {
  console.error('Timed out waiting for Electron desktop startup.');
  finish(child, 1, timer);
}, timeoutMs);

async function handle(buffer) {
  const text = buffer.toString();
  output += text;
  process.stdout.write(text);
  const match = output.match(/Local server listening on (http:\/\/127\.0\.0\.1:\d+)/) || output.match(/Next server listening on (http:\/\/127\.0\.0\.1:\d+)/);
  if (!match) return;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    const [root, health] = await Promise.all([
      fetch(match[1], { cache: 'no-store', signal: controller.signal }),
      fetch(`${match[1]}/api/health`, { cache: 'no-store', signal: controller.signal }),
    ]).finally(() => clearTimeout(timer));
    const rootHtml = await root.text();
    const healthBody = await health.json();
    if (!rootHtml.includes('OVERSEER') || !rootHtml.includes('/_next/static/')) {
      throw new Error('Electron dashboard HTML did not include the expected app shell and Next.js assets.');
    }
    if (healthBody.appId !== 'overseer' || healthBody.processStatus !== 'alive') {
      throw new Error('Electron health check did not identify a live Overseer app instance.');
    }
    console.log(JSON.stringify({
      appUrl: match[1],
      rootStatus: root.status,
      healthStatus: health.status,
      appId: healthBody.appId,
    }, null, 2));
    finish(child, root.ok && health.ok ? 0 : 1, timer);
  } catch (error) {
    console.error(error);
    finish(child, 1, timer);
  }
}

child.stdout.on('data', handle);
child.stderr.on('data', handle);
child.on('exit', (code) => {
  if (!output.includes('Local server listening') && !output.includes('Next server listening')) {
    finish(child, code || 1, timer);
  }
});
