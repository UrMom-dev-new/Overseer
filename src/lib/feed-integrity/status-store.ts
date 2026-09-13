import type { SourceCollectionStatus } from './types';

const globalForStatus = globalThis as unknown as {
  overseerFeedStatuses?: Map<string, SourceCollectionStatus>;
};

if (!globalForStatus.overseerFeedStatuses) {
  globalForStatus.overseerFeedStatuses = new Map();
}

export function updateSourceStatus(key: string, status: SourceCollectionStatus): void {
  globalForStatus.overseerFeedStatuses!.set(key, status);
}

export function updateSourceStatuses(statuses: SourceCollectionStatus[]): void {
  for (const status of statuses) {
    updateSourceStatus(status.source.providerId, status);
  }
}

export function readSourceStatuses(): SourceCollectionStatus[] {
  return Array.from(globalForStatus.overseerFeedStatuses!.values());
}

