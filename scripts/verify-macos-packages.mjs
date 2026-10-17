import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function fileHash(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export async function bundleHash(root) {
  const hash = createHash('sha256');
  async function visit(relative) {
    const path = join(root, relative);
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) {
      hash.update(JSON.stringify([relative, 'link', await readlink(path)]));
    } else if (stat.isDirectory()) {
      hash.update(JSON.stringify([relative, 'directory']));
      for (const name of (await readdir(path)).sort()) await visit(join(relative, name));
    } else if (stat.isFile()) {
      hash.update(JSON.stringify([relative, 'file', stat.mode & 0o111, await fileHash(path)]));
    } else {
      throw new Error(`Unsupported app bundle entry: ${relative}`);
    }
  }
  await visit('');
  return hash.digest('hex');
}

export function assertBuildIdentity(info, commit, version) {
  if (!commit || info.commit !== commit || info.version !== version || info.dirty !== false
    || info.signed !== false || info.notarized !== false) {
    throw new Error('Expected a clean unsigned build matching the release commit and version.');
  }
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { env, encoding: 'utf8', stdio: 'inherit', timeout: 10 * 60 * 1000 });
  if (result.error || result.status !== 0) throw new Error(`${command} failed (${result.status ?? 'execution error'}).`);
}

async function main() {
  if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(process.arch)) {
    throw new Error('Validate macOS archives on a native supported Mac.');
  }
  const arch = process.arch;
  const { version } = JSON.parse(await readFile('package.json', 'utf8'));
  const output = resolve('release');
  const reportPath = join(output, `macos-${arch}-verification.json`);
  await rm(reportPath, { force: true });
  const temporary = await mkdtemp(join(tmpdir(), 'overseer-macos-archives-'));
  const extracted = join(temporary, 'zip');
  const mount = join(temporary, 'dmg');
  let mounted = false;
  try {
    await mkdir(extracted);
    await mkdir(mount);
    const dmg = join(output, `Overseer-${version}-${arch}.dmg`);
    const zip = join(output, `Overseer-${version}-${arch}.zip`);
    run('/usr/bin/ditto', ['-x', '-k', zip, extracted]);
    const app = join(extracted, 'Overseer.app');
    const info = JSON.parse(await readFile(join(app, 'Contents/Resources/app/electron/build-info.generated.json'), 'utf8'));
    assertBuildIdentity(info, process.env.GITHUB_SHA, version);
    run('/usr/bin/lipo', [join(app, 'Contents/MacOS/Overseer'), '-verify_arch', arch === 'x64' ? 'x86_64' : 'arm64']);
    const before = await bundleHash(app);
    run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, dmg]);
    mounted = true;
    if (await bundleHash(join(mount, 'Overseer.app')) !== before) {
      throw new Error('DMG and ZIP apps differ in content, symlinks, or executable permissions.');
    }
    run('/usr/bin/hdiutil', ['detach', mount]);
    mounted = false;
    const smokeDir = resolve('desktop-smoke-results', `macos-${arch}`);
    const env = {
      ...process.env,
      OVERSEER_DESKTOP_BINARY: join(app, 'Contents/MacOS/Overseer'),
      OVERSEER_DESKTOP_SMOKE_REPORT_DIR: smokeDir,
      OVERSEER_DESKTOP_RENDERER_CHECK: '1',
    };
    run('pnpm', ['run', 'smoke:desktop'], env);
    const liveReport = join(output, `macos-${arch}-live-sources.json`);
    run('pnpm', ['run', 'verify:packaged-live-sources', '--', `--output=${liveReport}`, '--mode=release-gate', '--verify-timeout-ms=35000'], env);
    if (await bundleHash(app) !== before) throw new Error('Runtime modified the packaged app bundle.');
    const smoke = JSON.parse(await readFile(join(smokeDir, 'smoke.json'), 'utf8'));
    const artifacts = [];
    for (const path of [dmg, zip]) artifacts.push({ name: basename(path), sha256: await fileHash(path) });
    await writeFile(join(output, `macos-${arch}-SHA256SUMS.txt`), artifacts.map((item) => `${item.sha256}  ${item.name}\n`).join(''));
    await writeFile(reportPath, `${JSON.stringify({
      schemaVersion: 1, version, commit: info.commit, platform: 'darwin', arch,
      signed: false, notarized: false, testedAt: new Date().toISOString(),
      nativeRunner: true, archivesIdentical: true, bundleUnchangedAfterRuntime: true,
      rendererSmoke: 'passed', requiredLiveSourceGate: 'passed', bundleSha256: before, artifacts,
      renderer: smoke.renderer,
    }, null, 2)}\n`);
    console.log(`Validated unsigned native macOS ${arch} DMG and ZIP.`);
  } finally {
    if (mounted) run('/usr/bin/hdiutil', ['detach', mount]);
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
