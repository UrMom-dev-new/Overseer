'use client';

import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { createDeadline } from '@/lib/client-feed-store';

interface CachedSourceStatus {
  source: {
    providerId: string;
    providerName: string;
    feedUrl?: string | null;
  };
  availability: string;
  dataState: string;
  freshness: string;
  message: string | null;
  receivedRecords: number;
  acceptedRecords: number;
  rejectedRecords: number;
  lastAttemptAt: string | null;
  lastSuccessfulFetchAt: string | null;
  nextRetryAt: string | null;
}

interface VerificationRecordSet {
  id: string;
  paths: string[];
  required: boolean;
  liveObservation: boolean;
  evidenceKind: string;
  description: string;
}

interface VerificationContract {
  requirement: 'required' | 'optional' | 'report';
  recordSets: VerificationRecordSet[];
  requireProviderStatus: boolean;
  allowSchemaValidEmpty: boolean;
}

interface CapabilityStatus {
  id: string;
  label: string;
  uiSurface: string;
  layerId: string | null;
  apiRoute: string;
  provider: string;
  providerDocs: string;
  credentialEnv: string[];
  expectedResponse: string;
  normalizedContract: string;
  coverage: string;
  refreshPolicy: string;
  timeoutPolicy: string;
  fallback: string | null;
  notes: string;
  configuration: 'keyless' | 'configured' | 'not_configured' | 'optional';
  verificationContract: VerificationContract | null;
  cachedStatus: CachedSourceStatus | null;
  cachedStatuses: CachedSourceStatus[];
  lastAttemptAt: string | null;
  lastSuccessfulFetchAt: string | null;
  acceptedRecords: number;
  rejectedRecords: number;
  configuredFallback: string | null;
  activeFallback: string | null;
}

interface TestResult {
  state: 'idle' | 'testing' | 'ok' | 'failed';
  message: string;
  httpStatus?: number;
  acceptedRecords?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getPath(object: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!isRecord(current)) return undefined;
    return current[segment];
  }, object);
}

function countContractPath(payload: unknown, path: string): { present: boolean; count: number } {
  if (!isRecord(payload)) return { present: false, count: 0 };
  if (path.endsWith('.*')) {
    const value = getPath(payload, path.slice(0, -2));
    return isRecord(value) ? { present: true, count: Object.keys(value).length } : { present: false, count: 0 };
  }
  if (path.endsWith('#scalar')) {
    const value = getPath(payload, path.slice(0, -7));
    return value === undefined || value === null ? { present: true, count: 0 } : { present: true, count: 1 };
  }
  const value = getPath(payload, path);
  return Array.isArray(value) ? { present: true, count: value.length } : { present: false, count: 0 };
}

function contractStatus(payload: unknown, capability: CapabilityStatus): { issues: string[]; returnedRecords: number } {
  const contract = capability.verificationContract;
  if (!contract) return { issues: ['No verification contract is registered for this route.'], returnedRecords: 0 };
  if (!isRecord(payload)) return { issues: ['Route returned a non-object payload.'], returnedRecords: 0 };

  const issues: string[] = [];
  let returnedRecords = 0;
  for (const recordSet of contract.recordSets) {
    const counts = recordSet.paths.map((path) => countContractPath(payload, path));
    const present = counts.some((count) => count.present);
    returnedRecords += counts.reduce((sum, count) => sum + count.count, 0);
    if (recordSet.required && !present) issues.push(`Missing required record set: ${recordSet.id}`);
  }
  const statuses = Array.isArray(payload.status)
    ? payload.status
    : Array.isArray(payload.source_status)
      ? payload.source_status
      : [];
  if (contract.requireProviderStatus && statuses.length === 0) {
    issues.push('Provider status was not reported.');
  }
  return { issues, returnedRecords };
}

function statusColor(availability: string | undefined) {
  if (availability === 'ok') return '#00E676';
  if (availability === 'partial' || availability === 'rate_limited') return '#FFD700';
  if (availability === 'not_configured') return '#8A877D';
  if (availability === 'error') return '#FF3D3D';
  return '#8A877D';
}

function formatTime(value: string | null) {
  if (!value) return 'never';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value;
}

export default function DataSourcesPanel({
  onClose,
  onRefreshFeed,
}: {
  onClose: () => void;
  onRefreshFeed?: (capability: CapabilityStatus) => Promise<boolean>;
}) {
  const [capabilities, setCapabilities] = useState<CapabilityStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [refreshResults, setRefreshResults] = useState<Record<string, TestResult>>({});

  const sortedCapabilities = useMemo(() => [...capabilities].sort((a, b) => a.label.localeCompare(b.label)), [capabilities]);

  const loadManifest = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/sources', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      setCapabilities(Array.isArray(payload.capabilities) ? payload.capabilities : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load source manifest');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadManifest();
  }, []);

  const testSource = async (capability: CapabilityStatus) => {
    setTestResults((prev) => ({
      ...prev,
      [capability.id]: { state: 'testing', message: 'Testing production route...' },
    }));
    const deadline = createDeadline(20_000);
    try {
      const response = await fetch(capability.apiRoute, { cache: 'no-store', signal: deadline.signal });
      const text = await response.text();
      let payload: unknown;
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        throw new Error(`HTTP ${response.status} returned non-JSON content`);
      }
      const { issues, returnedRecords } = contractStatus(payload, capability);
      if (!response.ok) {
        const message = typeof payload === 'object' && payload && 'error' in payload
          ? String((payload as { error?: unknown }).error)
          : `HTTP ${response.status}`;
        setTestResults((prev) => ({
          ...prev,
          [capability.id]: { state: 'failed', message, httpStatus: response.status, acceptedRecords: returnedRecords },
        }));
        return;
      }
      if (issues.length > 0) {
        setTestResults((prev) => ({
          ...prev,
          [capability.id]: {
            state: 'failed',
            message: issues.join(' '),
            httpStatus: response.status,
            acceptedRecords: returnedRecords,
          },
        }));
        return;
      }
      setTestResults((prev) => ({
        ...prev,
        [capability.id]: {
          state: 'ok',
          message: returnedRecords > 0 ? 'Route satisfied its source contract.' : 'Route returned contract-valid empty/degraded JSON.',
          httpStatus: response.status,
          acceptedRecords: returnedRecords,
        },
      }));
      await loadManifest();
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [capability.id]: {
          state: 'failed',
          message: err instanceof Error ? err.message : 'Source test failed',
        },
      }));
    } finally {
      deadline.cancel();
    }
  };

  const refreshFeed = async (capability: CapabilityStatus) => {
    if (!onRefreshFeed) return;
    setRefreshResults((prev) => ({
      ...prev,
      [capability.id]: { state: 'testing', message: 'Refreshing dashboard feed...' },
    }));
    const ok = await onRefreshFeed(capability);
    setRefreshResults((prev) => ({
      ...prev,
      [capability.id]: {
        state: ok ? 'ok' : 'failed',
        message: ok ? 'Dashboard feed accepted refreshed data.' : 'Refresh did not update the dashboard feed.',
      },
    }));
    await loadManifest();
  };

  return (
    <div className="fixed inset-0 z-[520] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="glass-panel w-full max-w-5xl max-h-[88vh] overflow-hidden flex flex-col border border-[var(--gold-primary)]/20">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-primary)]">
          <div>
            <div className="text-[12px] font-mono tracking-normal text-[var(--gold-primary)] font-bold">DATA SOURCES</div>
            <div className="text-[10px] font-mono text-[var(--text-muted)] mt-1">Production routes, cached collection state, and route-level source tests.</div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => void loadManifest()} className="px-3 py-1.5 text-[10px] font-mono border border-[var(--border-primary)] hover:border-[var(--gold-primary)]/50 flex items-center gap-2">
              <RefreshCw className="w-3 h-3" />
              REFRESH
            </button>
            <button onClick={onClose} className="p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="overflow-auto styled-scrollbar p-4">
          {loading && <div className="text-[11px] font-mono text-[var(--text-muted)]">Loading source manifest...</div>}
          {error && <div className="text-[11px] font-mono text-[#FF3D3D]">Source diagnostics unavailable: {error}</div>}
          {!loading && !error && (
            <div className="grid gap-3">
              {sortedCapabilities.map((capability) => {
                const status = capability.cachedStatus;
                const availability = status?.availability || (capability.configuration === 'not_configured' ? 'not_configured' : 'unknown');
                const result: TestResult = testResults[capability.id] ?? { state: 'idle', message: '' };
                const refreshResult: TestResult = refreshResults[capability.id] ?? { state: 'idle', message: '' };
                return (
                  <div key={capability.id} className="border border-[var(--border-primary)] bg-black/30 p-3">
                    <div className="flex flex-col lg:flex-row lg:items-start gap-3 justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="w-2 h-2 rounded-full" style={{ background: statusColor(availability), boxShadow: `0 0 8px ${statusColor(availability)}` }} />
                          <span className="text-[12px] font-mono font-bold text-[var(--text-primary)]">{capability.label}</span>
                          <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 border border-[var(--border-primary)] text-[var(--text-muted)]">{availability}</span>
                          <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 border border-[var(--border-primary)] text-[var(--text-muted)]">{capability.configuration}</span>
                          {capability.verificationContract && <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 border border-[var(--border-primary)] text-[var(--text-muted)]">{capability.verificationContract.requirement}</span>}
                        </div>
                        <div className="text-[10px] font-mono text-[var(--text-muted)] mt-1">{capability.provider}</div>
                        <div className="text-[10px] text-[var(--text-secondary)] mt-2 leading-relaxed">{capability.normalizedContract}</div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 text-[9px] font-mono">
                          <div><span className="text-[var(--text-muted)]">LAST TRY</span><br />{formatTime(capability.lastAttemptAt)}</div>
                          <div><span className="text-[var(--text-muted)]">LAST OK</span><br />{formatTime(capability.lastSuccessfulFetchAt)}</div>
                          <div><span className="text-[var(--text-muted)]">ACCEPTED</span><br />{capability.acceptedRecords}</div>
                          <div><span className="text-[var(--text-muted)]">REJECTED</span><br />{capability.rejectedRecords}</div>
                        </div>
                        {capability.cachedStatuses.length > 0 && (
                          <div className="mt-2 grid gap-1">
                            {capability.cachedStatuses.slice(0, 4).map((sourceStatus) => (
                              <div key={sourceStatus.source.providerId} className="text-[9px] font-mono text-[var(--text-muted)] flex flex-wrap gap-x-2">
                                <span>{sourceStatus.source.providerName}</span>
                                <span>{sourceStatus.availability}/{sourceStatus.dataState}</span>
                                <span>{sourceStatus.acceptedRecords} accepted</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {status?.message && <div className="text-[9px] font-mono text-[var(--text-muted)] mt-2">{status.message}</div>}
                        {capability.configuredFallback && <div className="text-[9px] font-mono text-[var(--text-muted)] mt-1">Configured fallback: {capability.configuredFallback}</div>}
                        {capability.activeFallback && <div className="text-[9px] font-mono text-[#FFD700] mt-1">Active fallback: {capability.activeFallback}</div>}
                        {result.state !== 'idle' && (
                          <div className={`text-[9px] font-mono mt-2 ${result.state === 'failed' ? 'text-[#FF3D3D]' : result.state === 'ok' ? 'text-[#00E676]' : 'text-[var(--text-muted)]'}`}>
                            Test: {result.message} {typeof result.acceptedRecords === 'number' ? `(${result.acceptedRecords} records)` : ''}
                          </div>
                        )}
                        {refreshResult.state !== 'idle' && (
                          <div className={`text-[9px] font-mono mt-2 ${refreshResult.state === 'failed' ? 'text-[#FF3D3D]' : refreshResult.state === 'ok' ? 'text-[#00E676]' : 'text-[var(--text-muted)]'}`}>
                            Refresh: {refreshResult.message}
                          </div>
                        )}
                      </div>
                      <div className="shrink-0 flex flex-col gap-2">
                        <button
                          disabled={result.state === 'testing'}
                          onClick={() => void testSource(capability)}
                          className="px-3 py-1.5 text-[10px] font-mono border border-[var(--border-primary)] hover:border-[var(--gold-primary)]/50 disabled:opacity-50"
                        >
                          {result.state === 'testing' ? 'TESTING...' : 'TEST SOURCE'}
                        </button>
                        {onRefreshFeed && capability.id !== 'scanner' && (
                          <button
                            disabled={refreshResult.state === 'testing'}
                            onClick={() => void refreshFeed(capability)}
                            className="px-3 py-1.5 text-[10px] font-mono border border-[var(--border-primary)] hover:border-[var(--gold-primary)]/50 disabled:opacity-50"
                          >
                            {refreshResult.state === 'testing' ? 'REFRESHING...' : 'REFRESH FEED'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
