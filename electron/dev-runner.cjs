const { spawn } = require('node:child_process');
const http = require('node:http');

const HOST = '127.0.0.1';
const PORT = process.env.OVERSEER_DESKTOP_DEV_PORT || '3000';
const START_URL = `http://${HOST}:${PORT}`;
const STARTUP_TIMEOUT_MS = 60_000;

function packageRunnerArgs() {
  if (process.env.npm_execpath) {
    return {
      command: process.execPath,
      args: [
        process.env.npm_execpath,
        'run',
        'dev',
        '--',
        '--hostname',
        HOST,
        '--port',
        PORT,
      ],
    };
  }

  return {
    command: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    args: ['run', 'dev', '--', '--hostname', HOST, '--port', PORT],
  };
}

function waitForServer(url) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const check = () => {
      const request = http.get(url, (response) => {
        response.resume();
        resolve();
      });

      request.on('error', () => {
        if (Date.now() > deadline) {
          reject(new Error(`Timed out waiting for ${url}`));
          return;
        }

        setTimeout(check, 500);
      });
    };

    check();
  });
}

function shutdown(processes, code = 0) {
  for (const child of processes) {
    if (!child.killed) child.kill();
  }
  process.exit(code);
}

async function main() {
  const runner = packageRunnerArgs();
  const children = [];

  const nextProcess = spawn(runner.command, runner.args, {
    env: { ...process.env, BROWSER: 'none' },
    stdio: 'inherit',
  });
  children.push(nextProcess);

  nextProcess.on('exit', (code) => {
    if (code !== null && code !== 0) shutdown(children, code);
  });

  await waitForServer(START_URL);

  const electronPath = require('electron');
  const electronProcess = spawn(electronPath, ['.'], {
    env: {
      ...process.env,
      OVERSEER_ELECTRON_URL: START_URL,
    },
    stdio: 'inherit',
  });
  children.push(electronProcess);

  electronProcess.on('exit', (code) => shutdown(children, code || 0));
  process.on('SIGINT', () => shutdown(children, 0));
  process.on('SIGTERM', () => shutdown(children, 0));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
