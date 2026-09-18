import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

function gitValue(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

async function main() {
  const pkg = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
  const output = resolve('electron/build-info.generated.json');
  const info = {
    schemaVersion: 1,
    productName: 'Overseer',
    version: pkg.version || null,
    commit: process.env.GITHUB_SHA || gitValue(['rev-parse', 'HEAD']),
    branch: process.env.GITHUB_REF_NAME || gitValue(['branch', '--show-current']),
    dirty: gitValue(['status', '--short']) ? true : false,
    generatedAt: new Date().toISOString(),
    signed: false,
  };
  await mkdir(resolve('electron'), { recursive: true });
  await writeFile(output, `${JSON.stringify(info, null, 2)}\n`);
  console.log(`Wrote ${output}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
