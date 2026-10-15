'use client';

import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Search, Trash2, Upload, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { INFRASTRUCTURE_SECTORS, INFRASTRUCTURE_SOURCES } from '@/lib/infrastructure-catalog';
import { IMPORTABLE_INFRASTRUCTURE_SOURCES, importInfrastructureGeoJson, MAX_INFRASTRUCTURE_IMPORT_BYTES } from '@/lib/infrastructure-import';
import type { InfrastructureAsset } from '@/lib/feed-integrity/infrastructure';

export default function InfrastructureSourcesPanel({ onClose, importedAssets, onImport, onClear }: {
  onClose: () => void; importedAssets: InfrastructureAsset[]; onImport: (assets: InfrastructureAsset[]) => void; onClear: (sourceId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [sector, setSector] = useState('all');
  const [selected, setSelected] = useState('S01');
  const [importSector, setImportSector] = useState('');
  const [license, setLicense] = useState('');
  const [notice, setNotice] = useState('');
  const [importing, setImporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); closeRef.current(); }
      if (event.key === 'Tab') {
        const items = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not([hidden]), select, a[href]');
        if (!items?.length) return;
        const first = items[0]; const last = items[items.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('keydown', key, true); previous?.focus(); };
  }, []);
  const sources = INFRASTRUCTURE_SOURCES.filter((source) => (sector === 'all' || source.sectors.some((value) => value === sector)) &&
    `${source.id} ${source.name} ${source.coverage} ${source.content} ${source.access}`.toLowerCase().includes(query.toLowerCase()));
  const item = sources.find((source) => source.id === selected) ?? sources[0];
  const selectSource = (id: string) => { setSelected(id); setLicense(''); setNotice(''); setImportSector(''); };
  const importedCount = importedAssets.filter((asset) => asset.source_id === item?.id).length;
  const chosenSector = item?.sectors.find((value) => value === importSector) ?? item?.sectors[0];
  const loadFile = async (file?: File) => {
    if (!file || !item || !chosenSector) return;
    setImporting(true); setNotice('');
    try {
      if (file.size > MAX_INFRASTRUCTURE_IMPORT_BYTES) throw new Error('GeoJSON exceeds 10 MiB.');
      const assets = importInfrastructureGeoJson(await file.text(), item.id, chosenSector, new Date().toISOString(), license);
      const ids = new Set(assets.map((asset) => asset.id));
      if (importedAssets.filter((asset) => !ids.has(asset.id)).length + assets.length > 25_000) throw new Error('Session limit is 25,000 imported features. Remove a source before importing more.');
      onImport(assets);
      setNotice(`Imported ${assets.length.toLocaleString()} reference features from ${item.name}. Session only.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Import failed.'); }
    finally { setImporting(false); if (fileInput.current) fileInput.current.value = ''; }
  };
  return createPortal(<div className="fixed inset-0 z-[550] bg-black/75 flex items-center justify-center p-2 sm:p-5" onClick={onClose}>
    <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="infra-catalog-title" tabIndex={-1} data-testid="infrastructure-source-catalog"
      className="w-full max-w-5xl h-[88dvh] bg-[var(--bg-panel)] border border-white/20 rounded-md flex flex-col min-h-0 text-[var(--text-primary)] text-xs" onClick={(event) => event.stopPropagation()}>
      <header className="flex items-center justify-between p-3 border-b border-white/15 gap-2">
        <h2 id="infra-catalog-title" className="font-mono text-sm">Infrastructure Sources <span className="text-white/60">{sources.length} / 28</span></h2>
        <button type="button" title="Close source catalog" aria-label="Close source catalog" onClick={onClose} className="p-2 shrink-0"><X size={18} /></button>
      </header>
      <div className="flex flex-wrap gap-2 p-3 border-b border-white/15">
        <label className="flex items-center gap-2 flex-1 min-w-0 border border-white/20 px-2"><Search size={14} className="shrink-0" /><input aria-label="Search infrastructure sources" className="bg-transparent py-2 w-full min-w-0 outline-none" value={query} onChange={(event) => { setQuery(event.target.value); setLicense(''); setNotice(''); }} placeholder="Search sources" /></label>
        <select aria-label="Infrastructure sector" value={sector} onChange={(event) => { setSector(event.target.value); setLicense(''); setNotice(''); }} className="bg-[var(--bg-panel)] border border-white/20 p-2 max-w-full">
          <option value="all">All sectors</option>{INFRASTRUCTURE_SECTORS.map((value) => <option key={value.id} value={value.id}>{value.label}</option>)}
        </select>
      </div>
      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[minmax(220px,34%)_1fr]">
        <nav aria-label="Infrastructure source list" className="overflow-auto border-b md:border-b-0 md:border-r border-white/15 max-h-[26dvh] md:max-h-none">
          {sources.length ? sources.map((source) => <button type="button" key={source.id} aria-current={source.id === item?.id ? 'true' : undefined} onClick={() => selectSource(source.id)}
            className={`w-full text-left p-3 border-b border-white/10 break-words ${source.id === item?.id ? 'bg-white/10' : 'hover:bg-white/5'}`}>
            <span className="block font-medium">{source.id} {source.name}</span><span className="block text-[11px] mt-1 text-white/60">{source.access}</span>
          </button>) : <p className="p-4">No matching sources.</p>}
        </nav>
        {item && <section className="overflow-auto p-4 break-words min-w-0" aria-label="Source details">
          <h3 className="text-base font-semibold">{item.name}</h3>
          <p className="mt-1 text-white/60">{item.role} · {item.access}</p>
          <dl className="mt-4 space-y-3">{[
            ['Sectors', item.sectorDescription], ['Coverage', item.coverage], ['Asset content', item.content], ['Access and format', item.format],
            ['License and permissions', item.license], ['Vintage', item.vintage], ['Limitations', item.limitation], ['Catalog review', item.reviewDate],
            ['Connection', importedCount ? `${importedCount.toLocaleString()} locally imported reference features. No live operating telemetry.` : item.id === 'S01' ? 'OSM nodes and ways queried through Overpass, not Geofabrik PBF ingestion. OSM-derived products are not independent confirmation.' : 'Catalog reference only. No asset records from this provider are connected.'],
          ].map(([label, value]) => <div key={label}><dt className="text-[11px] text-white/60 mb-1">{label}</dt><dd>{value}</dd></div>)}</dl>
          <div className="flex flex-wrap gap-4 mt-4">
            <a href={item.url} target="_blank" rel="noopener noreferrer" className="inline-flex gap-1 items-center text-[#64B5F6]">Provider<ExternalLink size={12} /></a>
            <a href={item.termsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex gap-1 items-center text-[#64B5F6]">Evidence and terms<ExternalLink size={12} /></a>
          </div>
          {IMPORTABLE_INFRASTRUCTURE_SOURCES.has(item.id) && <div className="mt-5 border-t border-white/15 pt-4 space-y-2">
            <h4 className="font-semibold">Local GeoJSON</h4>
            <label className="block text-white/60">Sector
              <select aria-label="Import sector" value={chosenSector} onChange={(event) => setImportSector(event.target.value)} className="block w-full bg-[var(--bg-panel)] border border-white/20 p-2 mt-1">
                {item.sectors.map((value) => <option key={value} value={value}>{INFRASTRUCTURE_SECTORS.find((sector) => sector.id === value)!.label}</option>)}
              </select>
            </label>
            <label className="block text-white/60">Dataset license / permission reference
              <input aria-label="Dataset license or permission reference" value={license} maxLength={500} onChange={(event) => setLicense(event.target.value)} className="block w-full bg-transparent border border-white/20 p-2 mt-1" />
            </label>
            <input ref={fileInput} hidden type="file" accept=".geojson,.json,application/geo+json,application/json" onChange={(event) => void loadFile(event.target.files?.[0])} />
            <div className="flex gap-2">
              <button type="button" title="Import source GeoJSON" aria-label="Import source GeoJSON" disabled={!license.trim() || importing} onClick={() => fileInput.current?.click()} className="p-2 border border-white/20 disabled:opacity-40"><Upload size={16} /></button>
              <button type="button" title="Remove this source's imported features" aria-label="Remove this source's imported features" disabled={!importedCount || importing} onClick={() => { onClear(item.id); setNotice('Imported features removed.'); }} className="p-2 border border-white/20 disabled:opacity-40"><Trash2 size={16} /></button>
              <span className="self-center text-white/60">{importing ? 'Importing...' : `${importedCount.toLocaleString()} local features`}</span>
            </div>
          </div>}
          {notice && <p role="status" className="mt-3">{notice}</p>}
          <h4 className="mt-5 mb-2 font-semibold">Alternative Sources</h4>
          <ul className="space-y-2">{item.alternatives.map((id) => {
            const alternate = INFRASTRUCTURE_SOURCES.find((source) => source.id === id)!;
            return <li key={id}><button type="button" className="text-left text-[#64B5F6] hover:underline" onClick={() => { setQuery(''); setSector('all'); selectSource(id); }}>{alternate.name}</button><span className="block text-white/60 text-[11px]">{alternate.coverage}. {alternate.access}.</span></li>;
          })}</ul>
        </section>}
      </div>
    </div>
  </div>, document.body);
}
