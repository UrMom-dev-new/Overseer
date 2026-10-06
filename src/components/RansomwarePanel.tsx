'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, ExternalLink, RefreshCw, X } from 'lucide-react';
import {
  filterRansomwareReports, isRansomwareEnvelope, RANSOMLOOK_ATTRIBUTION,
  RANSOMWARE_CACHE_MAX_AGE_MS, RANSOMWARE_REFRESH_MS, type RansomwareEnvelope,
} from '@/lib/feed-integrity/ransomware-types';

interface FeedState {
  payload: RansomwareEnvelope | null;
  loading: boolean;
  error: string | null;
}

/** Fetch only while the panel is open. Manual refresh never bypasses the server's provider cooldown. */
export function useRansomwareFeed(enabled: boolean) {
  const [state, setState] = useState<FeedState>({ payload: null, loading: false, error: null });
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      await Promise.resolve();
      if (disposed) return;
      setState((previous) => ({ ...previous, loading: true }));
      controller = new AbortController();
      deadline = setTimeout(() => controller?.abort(), 15000);
      let delay = 60000;
      try {
        const response = await fetch('/api/ransomware', { cache: 'no-store', signal: controller.signal });
        if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) throw new Error('Invalid content type');
        const payload: unknown = await response.json();
        if (!isRansomwareEnvelope(payload) || (!response.ok && response.status !== 503)) throw new Error('Invalid feed response');
        if (disposed) return;
        // An expired snapshot must not become current merely because this request succeeded.
        if (payload.collectedAt && Date.now() - Date.parse(payload.collectedAt) > RANSOMWARE_CACHE_MAX_AGE_MS) throw new Error('Expired snapshot');
        setState({ payload, loading: false, error: null });
        delay = Math.min(RANSOMWARE_REFRESH_MS, Math.max(30000, Date.parse(payload.nextRefreshAt) - Date.now()));
      } catch {
        if (disposed) return;
        setState((previous) => ({
          payload: previous.payload?.collectedAt && Date.now() - Date.parse(previous.payload.collectedAt) <= RANSOMWARE_CACHE_MAX_AGE_MS ? previous.payload : null,
          loading: false,
          error: 'Overseer could not retrieve a valid feed response. Any retained reports are a stale snapshot, not current coverage.',
        }));
      } finally {
        clearTimeout(deadline);
        if (!disposed) timer = setTimeout(() => { void poll(); }, delay);
      }
    }
    void poll();
    return () => { disposed = true; controller?.abort(); clearTimeout(timer); clearTimeout(deadline); };
  }, [enabled, revision]);
  const status = state.payload?.status[0];
  const unavailable = !state.payload || status?.dataState === 'unavailable';
  return {
    ...state, refresh,
    count: unavailable ? null : state.payload!.ransomware_reports.length,
    healthLabel: state.error ? 'error/stale' : status ? `${status.availability}/${status.freshness}${status.servingLastKnownGood ? '/last good' : ''}` : enabled ? 'loading' : 'not loaded',
  };
}

type RansomwareFeed = ReturnType<typeof useRansomwareFeed>;

function formatTime(value: string | null): string {
  return value ? value.replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC') : 'Unknown';
}

export default function RansomwarePanel({ open, onClose, feed }: { open: boolean; onClose: () => void; feed: RansomwareFeed }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('');
  const [days, setDays] = useState('all');
  useEffect(() => {
    if (!open || !dialog.current) return;
    const element = dialog.current;
    const previousFocus = document.activeElement;
    if (!element.open) element.showModal();
    return () => {
      element.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [open]);
  const payload = feed.payload;
  const status = payload?.status[0];
  const reports = payload?.ransomware_reports ?? [];
  const groups = Array.from(new Set(reports.map((record) => record.group))).sort();
  const visible = filterRansomwareReports(reports, { query, group, days: days === 'all' ? null : Number(days), nowMs: Date.now() });
  const unavailable = !payload || status?.dataState === 'unavailable';
  const warning = Boolean(feed.error || status?.servingLastKnownGood || status?.freshness === 'stale' || (status && status.availability !== 'ok'));
  return (
    <dialog ref={dialog} aria-labelledby={headingId} data-testid="ransomware-panel"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onKeyDown={(event) => event.stopPropagation()}
      className="pointer-events-auto m-auto w-[94vw] max-w-5xl max-h-[90dvh] rounded-lg border border-white/20 bg-[#101011] p-0 text-white shadow-2xl backdrop:bg-black/70">
      <div className="flex max-h-[88dvh] flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <h2 id={headingId} className="flex items-center gap-2 text-base font-semibold"><AlertTriangle className="h-5 w-5 shrink-0 text-amber-400" /> Ransomware & extortion claims</h2>
          <button type="button" onClick={onClose} aria-label="Close ransomware feed" className="rounded p-2 hover:bg-white/10 focus-visible:outline"><X className="h-5 w-5" /></button>
        </header>
        <div className="min-h-0 overflow-y-auto px-4 py-3 space-y-4">
          <p className="text-sm text-white/75">Public posts collected by RansomLook. These are unverified claims and announcements, not independently confirmed attacks or unique victims. Discovery time is not attack time. Unknown locations are not mapped.</p>
          <div className={`rounded border p-3 text-sm ${warning ? 'border-amber-400/50 bg-amber-400/10' : 'border-white/15 bg-white/5'}`} role="status" aria-live="polite">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong>{feed.loading ? 'Checking feed…' : feed.error ? 'Connection error — coverage uncertain' : status ? `${status.availability.toUpperCase()} / ${status.freshness.toUpperCase()}` : 'Feed not loaded'}</strong>
              <button type="button" onClick={feed.refresh} disabled={feed.loading} className="flex items-center gap-2 rounded border border-white/20 px-3 py-1.5 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${feed.loading ? 'animate-spin' : ''}`} /> Refresh</button>
            </div>
            <p className="mt-2 break-words">{feed.error || status?.message || 'Loading public-source metadata.'}</p>
            <p className="mt-1 text-xs text-white/65">Snapshot collected: {formatTime(payload?.collectedAt ?? null)} · Last successful provider fetch: {formatTime(status?.lastSuccessfulFetchAt ?? null)}</p>
            {status?.nextRetryAt && <p className="mt-1 text-xs text-white/65">Provider retry no earlier than {formatTime(status.nextRetryAt)}. Refresh respects this cooldown.</p>}
            {status && <p className="mt-1 text-xs text-white/65">Snapshot: {status.receivedRecords} received · {status.acceptedRecords} accepted · {status.rejectedRecords} rejected · {payload?.coverage.duplicatesRemoved ?? 0} duplicates removed.</p>}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm">Search reports<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Title, group or description" className="mt-1 w-full rounded border border-white/20 bg-black/30 px-3 py-2 text-white" /></label>
            <label className="text-sm">Claiming group<select value={group} onChange={(event) => setGroup(event.target.value)} className="mt-1 w-full rounded border border-white/20 bg-[#181819] px-3 py-2 text-white"><option value="">All groups</option>{groups.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
            <label className="text-sm">Provider discovery window<select value={days} onChange={(event) => setDays(event.target.value)} className="mt-1 w-full rounded border border-white/20 bg-[#181819] px-3 py-2 text-white"><option value="all">All loaded posts</option><option value="1">Last 24 hours</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select></label>
          </div>
          <p className="text-xs text-white/65">{unavailable ? 'Report count unavailable.' : `${visible.length} matching / ${reports.length} loaded reports.`} Latest 100 provider posts at most; date filters only narrow this sample, not the full archive. Unknown and future discovery dates are excluded from date filters.</p>
          {visible.length === 0 ? <p className="rounded border border-white/10 p-5 text-sm" data-testid="ransomware-empty">{feed.loading && !payload ? 'Loading reports…' : unavailable ? 'Coverage unavailable. This does not mean zero ransomware activity.' : reports.length === 0 ? 'The last successful collection returned no posts. This is not a global incident count.' : 'No loaded reports match these filters.'}</p> :
            <ol className="space-y-3" data-testid="ransomware-reports">{visible.map((record) => <li key={record.id} className="rounded border border-white/15 p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs"><span className="rounded bg-amber-400/15 px-2 py-1 text-amber-200">UNVERIFIED POST</span><span className="break-all font-mono">{record.group}</span></div>
              <h3 className="mt-2 break-words text-base font-medium">{record.title}</h3>
              <p className="mt-1 text-xs text-white/65">Provider discovered: {formatTime(record.discoveredAt)} · Source: {record.source}</p>
              {record.integrity.location.qualityFlags.includes('source_timezone_assumed_utc') && <p className="mt-1 text-xs text-white/60">Source omitted timezone; displayed as UTC.</p>}
              {record.integrity.location.qualityFlags.includes('source_discovery_in_future') && <p className="mt-1 text-xs text-amber-200">Source supplied a future discovery timestamp.</p>}
              {record.description && <details className="mt-2 text-sm"><summary className="cursor-pointer text-white/80">Source description (unverified)</summary><p className="mt-2 whitespace-pre-wrap break-words text-white/75">{record.description}</p></details>}
            </li>)}</ol>}
        </div>
        <footer className="shrink-0 border-t border-white/10 px-4 py-3 text-xs text-white/65">
          <a href={RANSOMLOOK_ATTRIBUTION.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline">Data: RansomLook <ExternalLink className="h-3 w-3" /></a>{' · '}
          <a href={RANSOMLOOK_ATTRIBUTION.licenseUrl} target="_blank" rel="noopener noreferrer" className="underline">{RANSOMLOOK_ATTRIBUTION.license}</a>
          <p className="mt-1">{RANSOMLOOK_ATTRIBUTION.changes} No original leak-site links or stolen material are downloaded.</p>
        </footer>
      </div>
    </dialog>
  );
}
