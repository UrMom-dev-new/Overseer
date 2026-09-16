import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canonicalClientFeedKey,
  parseRetryAfterMs,
  readClientFeedSnapshots,
  type StorageLike,
  writeClientFeedSnapshot,
} from '../src/lib/client-feed-store';

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

test('client feed keys include query identity while stripping secrets', () => {
  assert.equal(
    canonicalClientFeedKey('/api/cctv?v=2&region=all&token=secret'),
    'real:/api/cctv?region=all&v=2',
  );
  assert.notEqual(
    canonicalClientFeedKey('/api/cctv?region=all'),
    canonicalClientFeedKey('/api/cctv?region=europe'),
  );
});

test('client snapshots restore only unexpired matching namespace entries', () => {
  const storage = new MemoryStorage();
  writeClientFeedSnapshot({
    schemaVersion: 1,
    namespace: 'real',
    key: 'real:/api/news',
    feedKey: 'news',
    storedAtMs: 1000,
    patch: { news: [{ id: 'n1' }] },
    status: { availability: 'ok', freshness: 'fresh' },
  }, { storage });
  writeClientFeedSnapshot({
    schemaVersion: 1,
    namespace: 'demo',
    key: 'demo:/api/news',
    feedKey: 'news',
    storedAtMs: 1000,
    patch: { news: [{ id: 'demo' }] },
    status: { availability: 'ok', freshness: 'fresh' },
  }, { storage });

  const restored = readClientFeedSnapshots({ storage, namespace: 'real', maxAgeMs: 10_000, nowMs: 2000 });
  assert.equal(restored.length, 1);
  assert.deepEqual(restored[0].patch.news, [{ id: 'n1' }]);

  const expired = readClientFeedSnapshots({ storage, namespace: 'real', maxAgeMs: 10, nowMs: 2000 });
  assert.equal(expired.length, 0);
});

test('client snapshot writes are bounded and corrupt entries are dropped', () => {
  const storage = new MemoryStorage();
  for (let i = 0; i < 4; i++) {
    writeClientFeedSnapshot({
      schemaVersion: 1,
      namespace: 'real',
      key: `real:/api/feed-${i}`,
      feedKey: `feed-${i}`,
      storedAtMs: 1000 + i,
      patch: { [`feed_${i}`]: [] },
      status: { availability: 'ok' },
    }, { storage, maxEntries: 2 });
  }
  assert.equal(readClientFeedSnapshots({ storage, maxAgeMs: 10_000, nowMs: 2000 }).length, 2);

  storage.setItem('overseer.feed-snapshot.v1:real:/api/feed-3', '{broken');
  assert.equal(readClientFeedSnapshots({ storage, maxAgeMs: 10_000, nowMs: 2000 }).length, 1);
});

test('Retry-After parser accepts delta seconds and HTTP dates', () => {
  assert.equal(parseRetryAfterMs('3', 1000), 4000);
  assert.equal(parseRetryAfterMs('bad', 1000), null);
  assert.equal(parseRetryAfterMs(new Date(5000).toUTCString(), 1000), 5000);
});
