import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { credentialNames, validateNotarization, validateReleaseEnvironment, verifySignedArtifact } from './macos-release-policy.mjs';

const arch = process.argv.find((arg) => arg.startsWith('--arch='))?.slice(7) || process.arch;
const output = resolve('release');
const evidence = join(output, `macos-${arch}-verification.json`);
let temporary;
let mounted = false;
let mount;
let started = false;

const runtimeEnv = { ...process.env };
for (const name of [...credentialNames, 'APPLE_API_KEY', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'GH_TOKEN', 'GITHUB_TOKEN']) {
  delete runtimeEnv[name];
}

function run(command, args, env = runtimeEnv, stream = false) {
  const result = spawnSync(command, args, { env, encoding: 'utf8', stdio: stream ? 'inherit' : 'pipe', timeout: 45 * 60 * 1000 });
  // Do not echo credential-bearing environment values or subprocess errors.
  if (result.error || result.status !== 0) throw new Error(`${command} ${args[0]} failed (${result.status ?? 'execution error'}).`);
  return result.stdout?.trim() ? result.stdout : (result.stderr || '');
}

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function main() {
  // Fail before building or writing a key if credentials/native validation are unavailable.
  validateReleaseEnvironment(process.env, process.platform, process.arch, arch);
  if (process.argv.includes('--check-credentials')) {
    console.log(`macOS ${arch} credential inputs and native runner validated (Apple authentication occurs during signing/notarization).`);
    return;
  }
  started = true;
  await rm(evidence, { force: true });
  temporary = await mkdtemp(join(tmpdir(), 'overseer-macos-release-'));
  const key = join(temporary, 'notary.p8');
  await writeFile(key, process.env.MACOS_NOTARY_KEY_P8, { mode: 0o600 });
  const signingEnv = {
    ...runtimeEnv,
    CSC_LINK: process.env.CSC_LINK,
    CSC_KEY_PASSWORD: process.env.CSC_KEY_PASSWORD,
    APPLE_TEAM_ID: process.env.APPLE_TEAM_ID,
    APPLE_API_KEY_ID: process.env.APPLE_API_KEY_ID,
    APPLE_API_ISSUER: process.env.APPLE_API_ISSUER,
    APPLE_API_KEY: key,
    CSC_IDENTITY_AUTO_DISCOVERY: 'true',
  };
  run('pnpm', ['run', 'build'], runtimeEnv, true);
  run('pnpm', ['run', 'desktop:write-build-info'], { ...runtimeEnv, OVERSEER_SIGNING_REQUESTED: '1' }, true);
  run('pnpm', ['exec', 'electron-builder', '--config', 'electron-builder.signed.cjs', '--mac', `--${arch}`, '--publish', 'never'], signingEnv, true);
  const { version } = JSON.parse(await readFile('package.json', 'utf8'));
  const dmg = join(output, `Overseer-${version}-${arch}.dmg`);
  const zip = join(output, `Overseer-${version}-${arch}.zip`);
  const team = process.env.APPLE_TEAM_ID;

  // electron-builder notarizes/staples the app before archiving. The signed DMG
  // gets its own submission and offline ticket as the outer distribution container.
  const submission = validateNotarization(JSON.parse(run('/usr/bin/xcrun', [
    'notarytool', 'submit', dmg, '--key', key, '--key-id', process.env.APPLE_API_KEY_ID,
    '--issuer', process.env.APPLE_API_ISSUER, '--wait', '--timeout', '30m', '--output-format', 'json',
  ])));
  run('/usr/bin/xcrun', ['stapler', 'staple', dmg]);
  verifySignedArtifact(run, dmg, team, arch, { app: false });

  const extracted = join(temporary, 'zip');
  await mkdir(extracted);
  run('/usr/bin/ditto', ['-x', '-k', zip, extracted]);
  const zipApp = join(extracted, 'Overseer.app');
  const zipHash = verifySignedArtifact(run, zipApp, team, arch);
  mount = join(temporary, 'dmg');
  await mkdir(mount);
  run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, dmg]);
  mounted = true;
  const dmgHash = verifySignedArtifact(run, join(mount, 'Overseer.app'), team, arch);
  if (zipHash !== dmgHash) throw new Error('DMG and ZIP contain different signed applications.');

  const smokeEnv = {
    ...runtimeEnv,
    OVERSEER_DESKTOP_BINARY: join(zipApp, 'Contents/MacOS/Overseer'),
    OVERSEER_DESKTOP_SMOKE_REPORT_DIR: resolve('desktop-smoke-results', `macos-${arch}`),
    OVERSEER_DESKTOP_RENDERER_CHECK: '1',
  };
  run('pnpm', ['run', 'smoke:desktop'], smokeEnv, true);
  const liveReport = join(output, `macos-${arch}-live-sources.json`);
  run('pnpm', ['run', 'verify:packaged-live-sources', '--', `--output=${liveReport}`, '--mode=release-gate', '--verify-timeout-ms=35000'], smokeEnv, true);
  if (verifySignedArtifact(run, zipApp, team, arch) !== zipHash) throw new Error('App signature changed during runtime checks.');

  const artifacts = [];
  for (const path of [dmg, zip]) artifacts.push({ name: path.slice(output.length + 1), sha256: await sha256(path) });
  await writeFile(join(output, `macos-${arch}-SHA256SUMS.txt`), artifacts.map((item) => `${item.sha256}  ${item.name}\n`).join(''));
  const buildInfo = JSON.parse(await readFile('electron/build-info.generated.json', 'utf8'));
  await writeFile(evidence, `${JSON.stringify({
    schemaVersion: 1, version, commit: buildInfo.commit, arch, team, signed: true, notarized: true,
    hardenedRuntime: true, gatekeeper: 'accepted', stapled: true, appCodeDirectoryHash: zipHash,
    dmgNotarization: submission, rendererSmoke: 'passed', requiredLiveSourceGate: 'passed', artifacts,
  }, null, 2)}\n`);
  console.log(`Verified signed and notarized macOS ${arch} artifacts: ${evidence}`);
}

try {
  await main();
} catch (error) {
  if (started) await rm(evidence, { force: true });
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (temporary) await rm(join(temporary, 'notary.p8'), { force: true });
  try {
    if (mounted) {
      run('/usr/bin/hdiutil', ['detach', mount]);
      mounted = false;
    }
  } finally {
    if (temporary && !mounted) await rm(temporary, { recursive: true, force: true });
  }
}
