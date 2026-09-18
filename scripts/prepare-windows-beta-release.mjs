import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const cliArgs = process.argv.slice(2);
const hasArg = (name) => cliArgs.includes(name);
const getArg = (name, fallback = null) => {
  const prefix = `${name}=`;
  const value = cliArgs.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
};

const artifactDir = resolve(getArg('--artifact-dir', 'release'));
const outputDir = resolve(getArg('--output-dir', 'release/windows-beta-draft'));
const commit = getArg('--commit');
const version = getArg('--version');
const workflowRunUrl = getArg('--workflow-run-url', 'maintainer-only workflow run URL pending');
const tag = getArg('--tag');
const createDraft = hasArg('--create-draft');

async function exactlyOne(pattern, label) {
  const names = await readdir(artifactDir);
  const matches = names.filter((name) => pattern.test(name));
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${label} in ${artifactDir}; found ${matches.length}.`);
  }
  return join(artifactDir, matches[0]);
}

async function sha256(path) {
  const buffer = await readFile(path);
  return createHash('sha256').update(buffer).digest('hex');
}

async function main() {
  const setup = await exactlyOne(/^Overseer-Setup-.+-x64\.exe$/, 'setup executable');
  const portable = await exactlyOne(/^Overseer-Portable-.+-x64\.exe$/, 'portable executable');
  const checksums = join(artifactDir, 'SHA256SUMS.txt');
  const buildInfo = join(artifactDir, 'build-info.json');
  const liveReport = join(artifactDir, 'live-source-verification.json');
  for (const required of [checksums, buildInfo, liveReport]) {
    if (!existsSync(required)) throw new Error(`Missing required release evidence file: ${required}`);
  }
  const build = JSON.parse(await readFile(buildInfo, 'utf8'));
  const releaseCommit = commit || build.commit;
  const releaseVersion = version || build.version;
  if (!releaseCommit) throw new Error('Provide --commit or include commit in build-info.json.');
  if (!releaseVersion) throw new Error('Provide --version or include version in build-info.json.');
  if (build.commit && build.commit !== releaseCommit) {
    throw new Error(`Build identity commit ${build.commit} does not match requested commit ${releaseCommit}.`);
  }

  await mkdir(outputDir, { recursive: true });
  const setupSha = await sha256(setup);
  const portableSha = await sha256(portable);
  const releaseTag = tag || `windows-beta-v${releaseVersion}-${releaseCommit.slice(0, 12)}`;
  const notesPath = join(outputDir, 'draft-prerelease-notes.md');
  const verifiedChecksumsPath = join(outputDir, 'SHA256SUMS.verified.txt');
  await writeFile(verifiedChecksumsPath, `${setupSha}  ${basename(setup)}\n${portableSha}  ${basename(portable)}\n`);
  await writeFile(notesPath, `# Overseer Windows beta ${releaseVersion}

This draft prerelease promotes the exact Windows artifacts produced and verified by the Desktop Packages workflow. Do not replace these files by rebuilding locally after validation.

## Recommended download

- Recommended: \`${basename(setup)}\`
- Optional portable alternative: \`${basename(portable)}\`

## Build identity

- Source commit: \`${releaseCommit}\`
- Package version: \`${releaseVersion}\`
- Workflow run: ${workflowRunUrl}
- Signing: unsigned beta build. Windows may show an unknown-publisher or SmartScreen warning.
- Updates: manual. Close Overseer, download the newer setup executable, and run it. Per-user settings are stored outside the installation directory.

## SHA-256

\`\`\`text
${setupSha}  ${basename(setup)}
${portableSha}  ${basename(portable)}
\`\`\`

## Install

1. Download \`${basename(setup)}\`.
2. Open the installer and follow Windows prompts.
3. Launch Overseer from the Start menu.
4. Use Data Sources inside the app to review provider status if a feed is unavailable.

## Known limitations

- This beta is unsigned and does not include automatic updates.
- Optional services that require credentials remain disabled until configured.
- Live providers can be temporarily unavailable; the app should label those states instead of fabricating data.
- A clean non-developer Windows PC acceptance check is still required unless recorded separately for this exact artifact.

## Feedback

Please include Windows version, installer filename, expected behavior, actual behavior, screenshots when useful, and diagnostics copied from the startup window or Data Sources panel.
`);

  const releaseFiles = [setup, portable, checksums, verifiedChecksumsPath, buildInfo, liveReport];
  if (createDraft) {
    const ghArgs = [
      'release',
      'create',
      releaseTag,
      ...releaseFiles,
      '--draft',
      '--prerelease',
      '--target',
      releaseCommit,
      '--title',
      `Overseer Windows beta ${releaseVersion}`,
      '--notes-file',
      notesPath,
    ];
    const result = spawnSync('gh', ghArgs, { stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`gh release create failed with exit code ${result.status}.`);
  }

  console.log(JSON.stringify({
    releaseTag,
    notesPath,
    verifiedChecksumsPath,
    setup: { path: setup, sha256: setupSha },
    portable: { path: portable, sha256: portableSha },
    createDraft,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
