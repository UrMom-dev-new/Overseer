'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, RefreshCw, Search, X } from 'lucide-react';
import { PUBLIC_CAMERA_SOURCES } from '@/lib/public-camera-sources';
import type { SourceCollectionStatus } from '@/lib/feed-integrity';

type RuntimeSource = { source_id: string; configuration: string; status: SourceCollectionStatus[] };

export default function CameraSourcesPanel({ cameras, onClose }: { cameras: unknown[]; onClose: () => void }) {
  const [query, setQuery] = useState(''); const [region, setRegion] = useState('all'); const [access, setAccess] = useState('all');
  const [selected, setSelected] = useState('CAM-001'); const [runtime, setRuntime] = useState<RuntimeSource[]>([]);
  const [reload, setReload] = useState(0); const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  const panel = useRef<HTMLDivElement>(null); const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null; panel.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); close.current(); }
      if (event.key !== 'Tab') return;
      const items = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,a[href]');
      if (!items?.length) return;
      if (event.shiftKey && (document.activeElement === items[0] || document.activeElement === panel.current)) { event.preventDefault(); items[items.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0].focus(); }
    };
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('keydown', key, true); previous?.focus(); };
  }, []);
  useEffect(() => {
    let disposed = false;
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 10_000);
    setLoading(true); setError('');
    void fetch('/api/cctv/sources', { cache: 'no-store', signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error('Source status unavailable');
      const body = await response.json(); if (!Array.isArray(body.sources)) throw new Error('Invalid source status');
      if (!disposed) setRuntime(body.sources);
    }).catch(() => { if (!disposed) setError('Source status unavailable. Provider references remain available.'); })
      .finally(() => { clearTimeout(timer); if (!disposed) setLoading(false); });
    return () => { disposed = true; controller.abort(); clearTimeout(timer); };
  }, [reload]);
  const sources = PUBLIC_CAMERA_SOURCES.filter((s) => (region === 'all' || s.region === region) && (access === 'all' || s.connector === access) &&
    `${s.source_id} ${s.source_name} ${s.operator} ${s.country_or_territory} ${s.primary_use}`.toLowerCase().includes(query.toLowerCase()));
  const item = sources.find((s) => s.source_id === selected) ?? sources[0];
  const state = runtime.find((s) => s.source_id === item?.source_id);
  const count = cameras.filter((c) => c && typeof c === 'object' && (c as { catalog_source_id?: string }).catalog_source_id === item?.source_id).length;
  return createPortal(<div className="fixed inset-0 z-[550] bg-black/75 flex items-center justify-center p-2 sm:p-5" onClick={onClose}>
    <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="camera-sources-title" data-testid="camera-source-catalog"
      className="w-full max-w-5xl h-[88dvh] bg-[var(--bg-panel)] text-[var(--text-primary)] border border-white/20 rounded-md flex flex-col min-h-0 text-xs" onClick={(e) => e.stopPropagation()}>
      <header className="flex items-center gap-2 p-3 border-b border-white/15">
        <h2 id="camera-sources-title" className="text-sm font-mono flex-1">Camera Sources <span className="text-white/60">{sources.length} / {PUBLIC_CAMERA_SOURCES.length}</span></h2>
        <button type="button" title="Refresh source status" aria-label="Refresh source status" disabled={loading} onClick={() => setReload((n) => n + 1)} className="p-2 disabled:opacity-40"><RefreshCw size={16} /></button>
        <button type="button" title="Close camera sources" aria-label="Close camera sources" onClick={onClose} className="p-2"><X size={18} /></button>
      </header>
      <div className="flex flex-wrap gap-2 p-3 border-b border-white/15">
        <label className="flex gap-2 items-center flex-1 min-w-[130px] border border-white/20 px-2"><Search size={14} /><input aria-label="Search camera sources" placeholder="Search sources" value={query} onChange={(e) => setQuery(e.target.value)} className="w-full min-w-0 bg-transparent py-2 outline-none" /></label>
        <select aria-label="Camera source region" value={region} onChange={(e) => setRegion(e.target.value)} className="bg-[var(--bg-panel)] border border-white/20 p-2 max-w-full"><option value="all">All regions</option>{[...new Set(PUBLIC_CAMERA_SOURCES.map((s) => s.region))].map((r) => <option key={r}>{r}</option>)}</select>
        <select aria-label="Camera source access" value={access} onChange={(e) => setAccess(e.target.value)} className="bg-[var(--bg-panel)] border border-white/20 p-2 max-w-full"><option value="all">All access</option><option value="api">API connectors</option><option value="review_required">Resource review required</option><option value="provider_link">Provider links / approval</option></select>
      </div>
      <div className="flex-1 min-h-0 grid grid-cols-1 grid-rows-[minmax(0,26dvh)_minmax(0,1fr)] md:grid-cols-[minmax(220px,34%)_1fr] md:grid-rows-1">
        <nav aria-label="Camera source list" className="overflow-auto border-b md:border-b-0 md:border-r border-white/15">
          {sources.length ? sources.map((s) => <button type="button" key={s.source_id} aria-current={s.source_id === item?.source_id ? 'true' : undefined} onClick={() => setSelected(s.source_id)} className={`w-full text-left p-3 border-b border-white/10 break-words ${s.source_id === item?.source_id ? 'bg-white/10' : 'hover:bg-white/5'}`}>
            <span className="block font-medium">{s.source_id} {s.source_name}</span><span className="block mt-1 text-white/60">{s.country_or_territory}</span>
          </button>) : <p className="p-4">No matching sources.</p>}
        </nav>
        {item && <section className="overflow-auto p-4 min-w-0 break-words" aria-label="Camera source details">
          <h3 className="text-base font-semibold">{item.source_name}</h3><p className="mt-1 text-white/60">{item.operator}</p>
          <p className="mt-3" data-testid="camera-source-connection">{item.connector === 'api' ? state?.configuration === 'key_required' ? `API key required: ${item.credentialEnv}. No cameras from this connector are loaded.` : `${count.toLocaleString()} catalog views loaded in this dashboard. Playback unverified until opened.` : item.connector === 'review_required' ? 'Provider reference only. Current API setup requires review; no connector enabled.' : 'Public provider link. No new automated collection or map locations added from this entry.'}</p>
          {item.credentialEnv && <p className="mt-2 text-white/60">{item.optionalKey ? 'Optional server key' : 'Required server key'}: <code>{item.credentialEnv}</code></p>}
          {loading && <p role="status" className="mt-2">Checking source status...</p>}{error && <p role="alert" className="mt-2 text-[#FF8A80]">{error}</p>}
          {state?.status.map((status) => <p key={status.source.providerId} className="mt-2 text-white/60">{status.source.providerName}: {status.availability} / {status.acceptedRecords} accepted. Last attempt: {status.lastAttemptAt || 'not checked'}. {status.message}</p>)}
          <dl className="mt-4 space-y-3">{[
            ['Region', `${item.region} / ${item.country_or_territory}`], ['Use', item.primary_use], ['Coverage', item.coverage], ['Access', item.access_class], ['Media', item.delivery_type],
            ['Refresh / rate limits', item.refresh_or_rate_notes], ['Reuse and permissions', item.reuse_and_permission_notes], ['Limitations', item.limitations], ['Catalog review date', item.review_date], ['Verification scope', item.verification_scope],
          ].map(([label, value]) => <div key={label}><dt className="text-white/60 text-[11px] mb-1">{label}</dt><dd>{value}</dd></div>)}</dl>
          <div className="flex flex-wrap gap-4 mt-4">{[['Provider', item.public_viewer_or_catalog_url], ['Documentation', item.developer_or_data_documentation_url], ['Evidence / terms', item.publication_evidence_url]].filter(([,url]) => url).map(([label,url]) => <a key={label} href={url} target="_blank" rel="noopener noreferrer" className="text-[#64B5F6] inline-flex gap-1 items-center">{label}<ExternalLink size={12} /></a>)}</div>
        </section>}
      </div>
    </div>
  </div>, document.body);
}
