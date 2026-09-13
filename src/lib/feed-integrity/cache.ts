import type { SourceCollectionStatus } from './types';

export interface CachedSnapshot<T> {
  key: string;
  records: T[];
  status: SourceCollectionStatus;
  storedAtMs: number;
}

const globalForCache = globalThis as unknown as {
  overseerSnapshotCache?: Map<string, CachedSnapshot<unknown>>;
  overseerInflight?: Map<string, Promise<unknown>>;
};

if (!globalForCache.overseerSnapshotCache) {
  globalForCache.overseerSnapshotCache = new Map();
}
if (!globalForCache.overseerInflight) {
  globalForCache.overseerInflight = new Map();
}

const MAX_CACHE_ENTRIES = 80;

export function readSnapshot<T>(key: string): CachedSnapshot<T> | null {
  return (globalForCache.overseerSnapshotCache!.get(key) as CachedSnapshot<T> | undefined) ?? null;
}

export function writeSnapshot<T>(snapshot: CachedSnapshot<T>): void {
  const cache = globalForCache.overseerSnapshotCache!;
  cache.set(snapshot.key, snapshot as CachedSnapshot<unknown>);
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
}

export function isSnapshotUsable<T>(snapshot: CachedSnapshot<T> | null, maxAgeMs: number, nowMs = Date.now()): snapshot is CachedSnapshot<T> {
  return Boolean(snapshot && nowMs - snapshot.storedAtMs <= maxAgeMs);
}

export function coalesce<T>(key: string, run: () => Promise<T>): Promise<T> {
  const inflight = globalForCache.overseerInflight!;
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const promise = run().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, promise as Promise<unknown>);
  return promise;
}

