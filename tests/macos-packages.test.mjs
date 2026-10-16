import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmod, mkdir, mkdtemp, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertBuildIdentity, bundleHash } from '../scripts/verify-macos-packages.mjs';

test('archive promotion requires the exact clean unsigned build identity', () => {
  const info = { commit: 'release-commit', version: '0.2.0', dirty: false, signed: false, notarized: false };
  assertBuildIdentity(info, 'release-commit', '0.2.0');
  for (const invalid of [{ commit: 'older' }, { version: '0.1.0' }, { dirty: true }, { signed: true }, { notarized: null }]) {
    assert.throws(() => assertBuildIdentity({ ...info, ...invalid }, 'release-commit', '0.2.0'), /clean unsigned/);
  }
  assert.throws(() => assertBuildIdentity(info, '', '0.2.0'), /clean unsigned/);
});

test('bundle comparison detects changed, added, and removed files but ignores timestamps', async () => {
  const root = await mkdtemp(join(tmpdir(), 'overseer-bundle-hash-'));
  try {
    const file = join(root, 'file');
    await writeFile(file, 'original');
    const original = await bundleHash(root);
    await utimes(file, new Date(0), new Date(0));
    assert.equal(await bundleHash(root), original);
    await writeFile(file, 'changed');
    assert.notEqual(await bundleHash(root), original);
    await writeFile(file, 'original');
    assert.equal(await bundleHash(root), original);
    await writeFile(join(root, 'extra'), 'extra');
    assert.notEqual(await bundleHash(root), original);
    await rm(join(root, 'extra'));
    await rm(file);
    assert.notEqual(await bundleHash(root), original);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('bundle comparison preserves executable permissions and symlink targets', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'overseer-bundle-modes-'));
  try {
    await mkdir(join(root, 'Contents'));
    const file = join(root, 'Contents', 'executable');
    await writeFile(file, 'binary', { mode: 0o644 });
    const original = await bundleHash(root);
    await chmod(file, 0o755);
    assert.notEqual(await bundleHash(root), original);
    await symlink('Contents/executable', join(root, 'link'));
    const linked = await bundleHash(root);
    await rm(join(root, 'link'));
    await symlink('missing-target', join(root, 'link'));
    assert.notEqual(await bundleHash(root), linked);
  } finally { await rm(root, { recursive: true, force: true }); }
});
