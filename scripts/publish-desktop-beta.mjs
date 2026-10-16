import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileHash } from './verify-macos-packages.mjs';

const repo = 'UrMom-dev-new/Overseer';
const requiredSources = ['earthquakes', 'news', 'weather', 'fires', 'flights', 'satellites', 'markets', 'space-weather'];

export function assertRun(run, commit, workflow) {
  if (run.head_sha !== commit || run.head_branch !== 'main' || run.status !== 'completed'
    || run.conclusion !== 'success' || run.path !== `.github/workflows/${workflow}`
    || !['push', 'workflow_dispatch'].includes(run.event)) {
    throw new Error(`Release requires a successful ${workflow} main run for the exact source commit.`);
  }
}

export function assertLiveGate(report) {
  if (report.mode !== 'release-gate' || report.releaseGate !== true || !Array.isArray(report.results)
    || !requiredSources.every((id) => report.results.some((item) => item.id === id && item.requirement === 'required' && item.passed === true && item.okForReleaseGate === true))
    || report.results.some((item) => item.requirement === 'required' && item.okForReleaseGate !== true)) {
    throw new Error('Required live-source release gate did not pass.');
  }
}

export function assertMacReport(report, commit, version, arch) {
  if (report.commit !== commit || report.version !== version || report.arch !== arch || report.platform !== 'darwin'
    || report.signed !== false || report.notarized !== false || report.nativeRunner !== true
    || report.archivesIdentical !== true || report.bundleUnchangedAfterRuntime !== true
    || report.rendererSmoke !== 'passed' || report.requiredLiveSourceGate !== 'passed') {
    throw new Error(`Missing or inconsistent native unsigned macOS ${arch} verification.`);
  }
}

function gh(args) {
  const result = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 20 * 60 * 1000 });
  if (result.error || result.status !== 0) throw new Error(`GitHub operation failed: ${args.slice(0, 2).join(' ')}. ${result.stderr || ''}`);
  return result.stdout;
}
const api = (path) => JSON.parse(gh(['api', `repos/${repo}/${path}`]));
const json = async (path) => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));

async function main() {
  const commit = process.env.GITHUB_SHA;
  if (!/^[a-f0-9]{40}$/.test(commit || '') || process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('Run publication from an exact main commit.');
  const desktopId = process.env.DESKTOP_RUN_ID;
  const macId = process.env.MACOS_RUN_ID;
  if (![desktopId, macId].every((id) => /^[1-9][0-9]*$/.test(id || ''))) throw new Error('Provide numeric desktop and macOS workflow run IDs.');
  assertRun(api(`actions/runs/${desktopId}`), commit, 'desktop-packages.yml');
  assertRun(api(`actions/runs/${macId}`), commit, 'release-preflight.yml');
  if (api('branches/main').commit.sha !== commit) throw new Error('Main advanced; build and publish the newer commit instead.');
  const { version } = await json('package.json');
  const tag = `desktop-beta-v${version}-${commit.slice(0, 12)}`;
  const temporary = await mkdtemp(join(tmpdir(), 'overseer-beta-publish-'));
  try {
    const staged = join(temporary, 'publish');
    await mkdir(staged);
    const artifacts = [];
    async function stageBinary(source, name, expectedHash) {
      if (!/^[a-f0-9]{64}$/.test(expectedHash || '') || await fileHash(source) !== expectedHash) throw new Error(`Checksum mismatch: ${name}`);
      await copyFile(source, join(staged, name));
      artifacts.push({ name, sha256: expectedHash });
    }
    function download(run, name, destination) {
      gh(['run', 'download', run, '--repo', repo, '--name', name, '--dir', destination]);
    }
    const windows = join(temporary, 'windows');
    const diagnostics = join(temporary, 'windows-diagnostics');
    download(desktopId, `Overseer-Windows-x64-${commit}`, windows);
    download(desktopId, `Overseer-Windows-diagnostics-${commit}`, diagnostics);
    const winInfo = await json(join(windows, 'build-info.json'));
    if (winInfo.commit !== commit || winInfo.version !== version || winInfo.signed !== false) throw new Error('Windows build identity does not match the unsigned release.');
    const winChecksums = new Map((await readFile(join(windows, 'SHA256SUMS.txt'), 'utf8')).trim().split(/\r?\n/).map((line) => {
      const match = line.match(/^([a-f0-9]{64})\s+(.+)$/i);
      if (!match) throw new Error('Malformed Windows checksums.');
      return [match[2], match[1].toLowerCase()];
    }));
    for (const kind of ['Setup', 'Portable']) {
      const name = `Overseer-${kind}-${version}-x64.exe`;
      await stageBinary(join(windows, name), name, winChecksums.get(name));
    }
    assertLiveGate(await json(join(windows, 'live-source-verification.json')));
    await copyFile(join(windows, 'live-source-verification.json'), join(staged, 'windows-live-source-verification.json'));
    for (const phase of ['install', 'reinstall', 'portable']) {
      const path = join(diagnostics, phase, 'smoke.json');
      if ((await json(path)).passed !== true) throw new Error(`Windows ${phase} smoke did not pass.`);
      await copyFile(path, join(staged, `windows-${phase}-smoke.json`));
    }
    const macArtifacts = api(`actions/runs/${macId}/artifacts?per_page=100`).artifacts;
    const platforms = [{ platform: 'win32', arch: 'x64', signed: false, workflowRun: desktopId }];
    for (const arch of ['arm64', 'x64']) {
      const names = macArtifacts.filter((item) => !item.expired && item.name.endsWith(`-${arch}-unsigned-preflight`));
      if (names.length !== 1) throw new Error(`Expected exactly one macOS ${arch} artifact.`);
      const dir = join(temporary, `macos-${arch}`);
      download(macId, names[0].name, dir);
      const reportName = `macos-${arch}-verification.json`;
      const report = await json(join(dir, reportName));
      assertMacReport(report, commit, version, arch);
      for (const ext of ['dmg', 'zip']) {
        const name = `Overseer-${version}-${arch}.${ext}`;
        const matches = report.artifacts?.filter((item) => item.name === name) || [];
        if (matches.length !== 1) throw new Error(`Missing checksum for ${name}.`);
        await stageBinary(join(dir, name), name, matches[0].sha256);
      }
      const liveName = `macos-${arch}-live-sources.json`;
      assertLiveGate(await json(join(dir, liveName)));
      for (const name of [reportName, liveName]) await copyFile(join(dir, name), join(staged, name));
      platforms.push({ platform: 'darwin', arch, signed: false, notarized: false, workflowRun: macId });
    }
    await writeFile(join(staged, 'SHA256SUMS.txt'), artifacts.map((item) => `${item.sha256}  ${item.name}\n`).join(''));
    await writeFile(join(staged, 'build-info.json'), `${JSON.stringify({ schemaVersion: 1, version, commit, platforms, artifacts }, null, 2)}\n`);
    const notes = join(temporary, 'notes.md');
    await writeFile(notes, `# Overseer ${version} Desktop Beta\n\nAll six application downloads were built from source commit \`${commit}\`.\n\n## Downloads\n\n| Platform | Recommended | Alternative |\n| --- | --- | --- |\n| Windows x64 | \`Overseer-Setup-${version}-x64.exe\` | \`Overseer-Portable-${version}-x64.exe\` |\n| macOS Apple Silicon | \`Overseer-${version}-arm64.dmg\` | \`Overseer-${version}-arm64.zip\` |\n| macOS Intel | \`Overseer-${version}-x64.dmg\` | \`Overseer-${version}-x64.zip\` |\n\nNo Node.js, Git, pnpm, Docker, or terminal is needed. Close Overseer before updating. On Windows run the setup EXE and launch from the Start menu. On macOS open the matching DMG and drag Overseer to Applications, replacing the previous app. Updates are manual.\n\n## Signing And Limitations\n\nAll packages are unsigned. macOS packages are not notarized and Gatekeeper may block them. Windows may show unknown-publisher or SmartScreen warnings. Do not disable operating-system security protections. These are beta builds, not signed production releases or proof of acceptance on every non-developer computer.\n\n## Changes\n\n- Native Intel Mac support alongside Apple Silicon and Windows.\n- Desktop runtime keeps framework caches out of the installed app bundle.\n- Latest merged CCTV/live-news playback and source-catalog changes are included. A camera is labeled live only when advancing video and live-playlist checks succeed; snapshots are not live video. Not every camera provider offers continuous video.\n\n## Validation\n\n- [Desktop Packages run ${desktopId}](https://github.com/${repo}/actions/runs/${desktopId}): native ARM/Intel renderer smoke, Windows installer/reinstall/uninstall lifecycle, installed renderer and portable launch, and required Windows live-source gate.\n- [Release Preflight run ${macId}](https://github.com/${repo}/actions/runs/${macId}): native ARM/Intel DMG-versus-ZIP comparison, extracted ZIP app renderer smoke, required live-source gates, and unchanged app bundles after runtime.\n- SHA256SUMS.txt and build-info.json identify the exact tested artifacts. Attached reports preserve point-in-time provider results, not uptime guarantees. Optional or credential-gated feeds may remain unavailable; no synthetic data is substituted.\n`);
    if (api('branches/main').commit.sha !== commit) throw new Error('Main advanced during staging; do not publish an outdated beta.');
    // Start as a draft. A failed transfer or server-side digest check stays private.
    gh(['release', 'create', tag, '--repo', repo, '--draft', '--prerelease', '--target', commit, '--title', `Overseer ${version} beta - Windows, Apple Silicon and Intel`, '--notes-file', notes]);
    const files = (await readdir(staged)).sort().map((name) => join(staged, name));
    gh(['release', 'upload', tag, '--repo', repo, ...files]);
    const release = JSON.parse(gh(['release', 'view', tag, '--repo', repo, '--json', 'assets']));
    for (const path of files) {
      const name = path.slice(staged.length + 1);
      const asset = release.assets.find((item) => item.name === name);
      if (asset?.state !== 'uploaded' || asset.digest !== `sha256:${await fileHash(path)}`) throw new Error(`Uploaded asset was not verified: ${name}. Draft retained.`);
    }
    if (api('branches/main').commit.sha !== commit) throw new Error('Main advanced before publication. Draft retained.');
    gh(['release', 'edit', tag, '--repo', repo, '--draft=false', '--prerelease']);
    console.log(`Published https://github.com/${repo}/releases/tag/${tag}`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
