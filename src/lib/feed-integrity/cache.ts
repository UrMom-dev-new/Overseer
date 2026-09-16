import type { SourceCollectionStatus } from './types';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

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
const SNAPSHOT_SCHEMA_VERSION = 1;
const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1000;

interface PersistedSnapshot {
  schemaVersion: number;
  namespace: 'real' | 'demo';
  keyHash: string;
  storedAtMs: number;
  records: unknown[];
  status: SourceCollectionStatus;
}

export function readSnapshot<T>(key: string): CachedSnapshot<T> | null {
  const memory = globalForCache.overseerSnapshotCache!.get(key) as CachedSnapshot<T> | undefined;
  if (memory) return memory;

  const persisted = readPersistedSnapshot<T>(key);
  if (persisted) {
    globalForCache.overseerSnapshotCache!.set(key, persisted as CachedSnapshot<unknown>);
    pruneMemoryCache();
  }
  return persisted;
}

export function writeSnapshot<T>(snapshot: CachedSnapshot<T>): void {
  const cache = globalForCache.overseerSnapshotCache!;
  cache.set(snapshot.key, snapshot as CachedSnapshot<unknown>);
  pruneMemoryCache();
  writePersistedSnapshot(snapshot);
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

export function clearSnapshotCacheForTests(): void {
  globalForCache.overseerSnapshotCache!.clear();
}

function pruneMemoryCache(): void {
  const cache = globalForCache.overseerSnapshotCache!;
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
}

function persistenceConfig(): {
  enabled: boolean;
  dir: string | null;
  namespace: 'real' | 'demo';
  maxEntries: number;
  retentionMs: number;
} {
  const mode = (process.env.OVERSEER_SNAPSHOT_CACHE || '').toLowerCase();
  const disabled = mode === '0' || mode === 'false' || mode === 'off' || mode === 'disabled';
  const dataDir = process.env.OVERSEER_DATA_DIR;
  return {
    enabled: !disabled && Boolean(dataDir),
    dir: dataDir ? join(dataDir, 'snapshots') : null,
    namespace: process.env.OVERSEER_DATA_MODE === 'demo' ? 'demo' : 'real',
    maxEntries: parsePositiveInt(process.env.OVERSEER_SNAPSHOT_MAX_ENTRIES, MAX_CACHE_ENTRIES),
    retentionMs: parsePositiveInt(process.env.OVERSEER_SNAPSHOT_RETENTION_MS, DEFAULT_RETENTION_MS),
  };
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function keyHash(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function snapshotPath(dir: string, namespace: 'real' | 'demo', hash: string): string {
  return join(dir, `${namespace}-${hash}.json`);
}

function shouldPersistSnapshot(snapshot: CachedSnapshot<unknown>): boolean {
  const blocked = ['scanner', 'osint', 'sweep', 'user-query'];
  const key = snapshot.key.toLowerCase();
  if (blocked.some((part) => key.includes(part))) return false;
  if (!Array.isArray(snapshot.records)) return false;
  return snapshot.status.source.providerId !== 'scanner';
}

function readPersistedSnapshot<T>(key: string): CachedSnapshot<T> | null {
  const config = persistenceConfig();
  if (!config.enabled || !config.dir) return null;
  const hash = keyHash(key);
  const filePath = snapshotPath(config.dir, config.namespace, hash);
  if (!existsSync(filePath)) return null;

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as PersistedSnapshot;
    if (!isPersistedSnapshot(parsed, config.namespace, hash)) {
      unlinkSync(filePath);
      return null;
    }
    if (Date.now() - parsed.storedAtMs > config.retentionMs) {
      unlinkSync(filePath);
      return null;
    }
    return {
      key,
      records: parsed.records as T[],
      status: parsed.status,
      storedAtMs: parsed.storedAtMs,
    };
  } catch {
    try {
      unlinkSync(filePath);
    } catch {
      // Ignore cleanup failures; corrupt files are treated as cache misses.
    }
    return null;
  }
}

function writePersistedSnapshot<T>(snapshot: CachedSnapshot<T>): void {
  const config = persistenceConfig();
  if (!config.enabled || !config.dir || !shouldPersistSnapshot(snapshot as CachedSnapshot<unknown>)) return;

  try {
    mkdirSync(config.dir, { recursive: true });
    const hash = keyHash(snapshot.key);
    const target = snapshotPath(config.dir, config.namespace, hash);
    const temp = join(config.dir, `.${config.namespace}-${hash}.${process.pid}.${randomUUID()}.tmp`);
    const payload: PersistedSnapshot = {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      namespace: config.namespace,
      keyHash: hash,
      storedAtMs: snapshot.storedAtMs,
      records: snapshot.records as unknown[],
      status: snapshot.status,
    };
    writeFileSync(temp, `${JSON.stringify(payload)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(temp, target);
    prunePersistedSnapshots(config);
  } catch {
    // Snapshot persistence is a recovery aid; collection must not fail because
    // a local cache directory is unavailable or read-only.
  }
}

function prunePersistedSnapshots(config = persistenceConfig()): void {
  if (!config.enabled || !config.dir || !existsSync(config.dir)) return;
  const now = Date.now();
  try {
    const files = readdirSync(config.dir)
      .filter((file) => file.startsWith(`${config.namespace}-`) && file.endsWith('.json'))
      .map((file) => {
        const path = join(config.dir!, file);
        const stat = statSync(path);
        return { file, path, mtimeMs: stat.mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    for (const file of files) {
      if (now - file.mtimeMs > config.retentionMs) unlinkSync(file.path);
    }
    for (const file of files.slice(config.maxEntries)) {
      if (existsSync(file.path)) unlinkSync(file.path);
    }
  } catch {
    // Best-effort pruning only.
  }
}

function isPersistedSnapshot(value: unknown, namespace: 'real' | 'demo', hash: string): value is PersistedSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<PersistedSnapshot>;
  return (
    snapshot.schemaVersion === SNAPSHOT_SCHEMA_VERSION &&
    snapshot.namespace === namespace &&
    snapshot.keyHash === hash &&
    typeof snapshot.storedAtMs === 'number' &&
    Number.isFinite(snapshot.storedAtMs) &&
    Array.isArray(snapshot.records) &&
    Boolean(snapshot.status) &&
    typeof snapshot.status === 'object'
  );
}
