import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { credentialNames, validateArchitecture, validateNotarization, validateReleaseEnvironment, validateSignature, verifySignedArtifact } from '../scripts/macos-release-policy.mjs';

const team = 'ABCDE12345';
const credentials = {
  CSC_LINK: 'dGVzdA==', CSC_KEY_PASSWORD: 'test-only',
  MACOS_NOTARY_KEY_P8: '-----BEGIN PRIVATE KEY-----\ntest-only\n-----END PRIVATE KEY-----',
  APPLE_API_KEY_ID: '12345ABCDE', APPLE_API_ISSUER: '12345678-abcd-abcd-abcd-123456789abc', APPLE_TEAM_ID: team,
};
const signature = `Identifier=dev.urmom.overseer\nCodeDirectory v=20500 size=100 flags=0x10000(runtime) hashes=1+1 location=embedded\nCDHash=abcdef123456\nAuthority=Developer ID Application: Test Company (${team})\nAuthority=Developer ID Certification Authority\nTimestamp=Oct 16, 2026 at 12:00:00\nTeamIdentifier=${team}\n`;

test('every Apple credential is required before packaging', () => {
  for (const name of credentialNames) {
    assert.throws(() => validateReleaseEnvironment({ ...credentials, [name]: '' }, 'darwin', 'arm64', 'arm64'), new RegExp(name));
  }
  validateReleaseEnvironment(credentials, 'darwin', 'arm64', 'arm64');
  validateReleaseEnvironment(credentials, 'darwin', 'x64', 'x64');
});

test('signed releases require native matching macOS architectures', () => {
  assert.throws(() => validateReleaseEnvironment(credentials, 'linux', 'x64', 'x64'), /macOS/);
  for (const arch of ['x64', 'universal', 'bogus']) {
    assert.throws(() => validateReleaseEnvironment(credentials, 'darwin', 'arm64', arch), /native/);
  }
  validateArchitecture('x86_64\n', 'x64');
  validateArchitecture('arm64\n', 'arm64');
  assert.throws(() => validateArchitecture('arm64', 'x64'), /native x86_64/);
  assert.throws(() => validateArchitecture('x86_64 arm64', 'arm64'), /native arm64/);
});

test('credential validation rejects URLs and malformed team/key identifiers without echoing secrets', () => {
  for (const [name, value] of [
    ['CSC_LINK', 'https://secret.example/cert'], ['APPLE_TEAM_ID', 'wrong-team'],
    ['APPLE_API_KEY_ID', 'bad-key'], ['APPLE_API_ISSUER', 'not-an-issuer'], ['MACOS_NOTARY_KEY_P8', 'not-a-key'],
  ]) {
    assert.throws(() => validateReleaseEnvironment({ ...credentials, [name]: value }, 'darwin', 'arm64', 'arm64'), (error) => !error.message.includes(value));
  }
});

test('only timestamped Developer ID signatures from the configured team pass', () => {
  assert.equal(validateSignature(signature, team), 'abcdef123456');
  for (const invalid of [
    signature.replace('Developer ID Application:', 'Apple Development:'),
    signature.replaceAll(team, 'OTHER12345'),
    signature.replace(/^Timestamp=.*\n/m, ''),
    signature.replace('0x10000(runtime)', '0x0(none)'),
    signature.replace('dev.urmom.overseer', 'com.example.other'),
    signature.replace(/^CDHash=.*\n/m, ''),
    'Signature=adhoc\nTeamIdentifier=not set\n',
  ]) assert.throws(() => validateSignature(invalid, team));
});

test('notarization must be Accepted, not pending, rejected, or missing an ID', () => {
  assert.deepEqual(validateNotarization({ status: 'Accepted', id: 'submission-id' }), { status: 'Accepted', id: 'submission-id' });
  for (const result of [{ status: 'In Progress', id: 'id' }, { status: 'Invalid', id: 'id' }, { status: 'Accepted' }, {}]) {
    assert.throws(() => validateNotarization(result), /did not accept/);
  }
});

function fakeRun(failAt, arch = 'arm64') {
  return (command, args) => {
    if (`${command} ${args[0]}` === failAt) throw new Error('verification failed');
    if (args[0] === '--display') return signature;
    if (command.endsWith('/lipo')) return arch;
    if (command.endsWith('/spctl')) return '/artifact: accepted\nsource=Notarized Developer ID\n';
    return '';
  };
}

test('signature, ticket, and Gatekeeper errors are fatal for both app and DMG', () => {
  assert.equal(verifySignedArtifact(fakeRun(), '/Test.app', team, 'arm64'), 'abcdef123456');
  for (const app of [true, false]) {
    for (const command of ['/usr/bin/codesign --verify', '/usr/bin/codesign --display', '/usr/bin/xcrun stapler', '/usr/sbin/spctl --assess']) {
      assert.throws(() => verifySignedArtifact(fakeRun(command), '/artifact', team, 'arm64', { app }), /verification failed/);
    }
  }
  assert.throws(() => verifySignedArtifact(fakeRun(undefined, 'x86_64'), '/Test.app', team, 'arm64'), /native/);
  for (const output of ['', 'assessments disabled', '/artifact: accepted\nsource=Developer ID\n']) {
    const run = (command, args) => command.endsWith('/spctl') ? output : fakeRun()(command, args);
    assert.throws(() => verifySignedArtifact(run, '/Test.app', team, 'arm64'), /Gatekeeper/);
  }
});

test('release config cannot silently inherit the unsigned identity or disable notarization', async () => {
  const configPath = new URL('../electron-builder.signed.cjs', import.meta.url);
  const configFile = fileURLToPath(configPath);
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const originalTeam = process.env.APPLE_TEAM_ID;
  try {
    process.env.APPLE_TEAM_ID = team;
    const config = require(configFile);
    assert.equal(config.forceCodeSigning, true);
    assert.equal(config.mac.identity, team);
    assert.equal(config.mac.notarize, true);
    assert.equal(config.mac.hardenedRuntime, true);
    assert.equal(config.dmg.sign, true);
    assert.equal(config.mac.entitlements, config.mac.entitlementsInherit);
    const entitlements = readFileSync(new URL('../electron/entitlements.mac.plist', import.meta.url), 'utf8');
    assert.match(entitlements, /com.apple.security.cs.allow-jit/);
    assert.doesNotMatch(entitlements, /disable-library-validation|device.camera|device.audio/);
    delete require.cache[require.resolve(configFile)];
    delete process.env.APPLE_TEAM_ID;
    assert.throws(() => require(configFile), /APPLE_TEAM_ID/);
  } finally {
    if (originalTeam === undefined) delete process.env.APPLE_TEAM_ID;
    else process.env.APPLE_TEAM_ID = originalTeam;
  }
});

test('the signed CLI refuses missing inputs without starting a build', () => {
  const env = { ...process.env };
  for (const name of credentialNames) delete env[name];
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/release-macos.mjs', import.meta.url)), '--check-credentials'], { env, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing macOS release credentials: CSC_LINK/);
  assert.equal(result.stdout, '');
});

test('pre-sign build metadata cannot assert unverified signing or notarization', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'overseer-build-metadata-'));
  try {
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ version: '0.2.0' }));
    for (const requested of ['0', '1']) {
      const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/write-desktop-build-info.mjs', import.meta.url))], {
        cwd, env: { ...process.env, OVERSEER_SIGNING_REQUESTED: requested }, encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stderr);
      const info = JSON.parse(await readFile(join(cwd, 'electron/build-info.generated.json'), 'utf8'));
      assert.equal(info.signed, requested === '1' ? null : false);
      assert.equal(info.notarized, requested === '1' ? null : false);
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('desktop standalone configuration preserves policy but cannot write caches into the signed bundle', async () => {
  const require = createRequire(import.meta.url);
  const { desktopNextConfig } = require('../electron/production-config.cjs');
  const cwd = await mkdtemp(join(tmpdir(), 'overseer-next-config-'));
  try {
    await mkdir(join(cwd, '.next'));
    const config = { distDir: '.next', output: 'standalone', images: { remotePatterns: [{ protocol: 'https' }] }, experimental: { isrFlushToDisk: true, otherSetting: true } };
    const manifest = join(cwd, '.next/required-server-files.json');
    await writeFile(manifest, JSON.stringify({ config }));
    const desktop = desktopNextConfig(cwd);
    assert.equal(desktop.experimental.isrFlushToDisk, false);
    assert.equal(desktop.experimental.otherSetting, true);
    assert.deepEqual(desktop.images, config.images);
    assert.equal(desktop.output, config.output);
    for (const invalid of [{}, { config: { distDir: '/somewhere-else' } }]) {
      await writeFile(manifest, JSON.stringify(invalid));
      assert.throws(() => desktopNextConfig(cwd), /configuration/);
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
