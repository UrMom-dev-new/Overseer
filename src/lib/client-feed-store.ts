export interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ClientFeedStatus {
  availability?: string;
  dataState?: string;
  freshness?: string;
  message?: string | null;
  sources?: unknown[];
  httpStatus?: number;
  updatedAt?: string;
  lastSuccessfulFetchAt?: string | null;
  servingLastKnownGood?: boolean;
}

export interface ClientFeedSnapshot {
  schemaVersion: 1;
  namespace: 'real' | 'demo';
  key: string;
  feedKey: string;
  storedAtMs: number;
  patch: Record<string, unknown>;
  status: ClientFeedStatus;
}

const SNAPSHOT_INDEX_KEY = 'overseer.feed-snapshots.v1';
const SNAPSHOT_PREFIX = 'overseer.feed-snapshot.v1:';
const DEFAULT_MAX_ENTRIES = 32;
const SENSITIVE_PARAMS = /^(api[-_]?key|key|token|secret|password|auth|authorization|signature)$/i;

export function canonicalClientFeedKey(url: string, namespace: 'real' | 'demo' = 'real'): string {
  const parsed = new URL(url, 'http://overseer.local');
  const params = new URLSearchParams();
  Array.from(parsed.searchParams.keys()).sort().forEach((name) => {
    if (SENSITIVE_PARAMS.test(name)) return;
    const values = parsed.searchParams.getAll(name).sort();
    for (const value of values) params.append(name, value);
  });
  const query = params.toString();
  return `${namespace}:${parsed.pathname}${query ? `?${query}` : ''}`;
}

export function readClientFeedSnapshots(options: {
  storage?: StorageLike | null;
  namespace?: 'real' | 'demo';
  maxAgeMs: number;
  nowMs?: number;
}): ClientFeedSnapshot[] {
  const storage = options.storage ?? safeLocalStorage();
  if (!storage) return [];
  const nowMs = options.nowMs ?? Date.now();
  const namespace = options.namespace ?? 'real';
  const index = readIndex(storage);
  const usable: ClientFeedSnapshot[] = [];
  const retained: string[] = [];

  for (const key of index) {
    const snapshot = readSnapshot(storage, key);
    if (!snapshot || snapshot.namespace !== namespace || nowMs - snapshot.storedAtMs > options.maxAgeMs) {
      storage.removeItem(snapshotStorageKey(key));
      continue;
    }
    retained.push(key);
    usable.push(snapshot);
  }

  writeIndex(storage, retained);
  return usable;
}

export function writeClientFeedSnapshot(snapshot: ClientFeedSnapshot, options: {
  storage?: StorageLike | null;
  maxEntries?: number;
} = {}): void {
  const storage = options.storage ?? safeLocalStorage();
  if (!storage) return;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const index = readIndex(storage).filter((key) => key !== snapshot.key);
  index.unshift(snapshot.key);

  try {
    storage.setItem(snapshotStorageKey(snapshot.key), JSON.stringify(snapshot));
    for (const expired of index.slice(maxEntries)) {
      storage.removeItem(snapshotStorageKey(expired));
    }
    writeIndex(storage, index.slice(0, maxEntries));
  } catch {
    // Browser storage is best-effort. A full or blocked storage area should not
    // turn a successful feed refresh into an application failure.
  }
}

export function parseRetryAfterMs(value: string | null, nowMs = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return nowMs + seconds * 1000;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.getTime() : null;
}

export function createDeadline(timeoutMs: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

function safeLocalStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function snapshotStorageKey(key: string): string {
  return `${SNAPSHOT_PREFIX}${key}`;
}

function readIndex(storage: StorageLike): string[] {
  try {
    const value = storage.getItem(SNAPSHOT_INDEX_KEY);
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function writeIndex(storage: StorageLike, index: string[]): void {
  try {
    storage.setItem(SNAPSHOT_INDEX_KEY, JSON.stringify(index));
  } catch {
    // Ignore storage quota/permission failures.
  }
}

function readSnapshot(storage: StorageLike, key: string): ClientFeedSnapshot | null {
  try {
    const raw = storage.getItem(snapshotStorageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ClientFeedSnapshot>;
    if (
      parsed.schemaVersion !== 1 ||
      (parsed.namespace !== 'real' && parsed.namespace !== 'demo') ||
      parsed.key !== key ||
      typeof parsed.feedKey !== 'string' ||
      typeof parsed.storedAtMs !== 'number' ||
      !Number.isFinite(parsed.storedAtMs) ||
      !parsed.patch ||
      typeof parsed.patch !== 'object' ||
      Array.isArray(parsed.patch) ||
      !parsed.status ||
      typeof parsed.status !== 'object'
    ) {
      storage.removeItem(snapshotStorageKey(key));
      return null;
    }
    return parsed as ClientFeedSnapshot;
  } catch {
    storage.removeItem(snapshotStorageKey(key));
    return null;
  }
}
