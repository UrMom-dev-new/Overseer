'use client';

import { ChangeEvent, DragEvent, Fragment, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Clock3,
  Database,
  Download,
  FileText,
  Loader2,
  MapPin,
  Phone,
  Radio,
  RefreshCw,
  Upload,
  Wifi,
  X,
} from 'lucide-react';
import {
  processPatternOfLifeFiles,
  type CellReference,
  type PatternAnalysis,
  type PatternInputFile,
  type PatternSubject,
} from '@/lib/pattern-of-life';

type ViewId = 'overview' | 'timeline' | 'locations' | 'contacts' | 'towers' | 'adtech' | 'files';

interface PatternOfLifePanelProps {
  expanded?: boolean;
}

const ACCEPTED_EXTENSIONS = new Set(['csv', 'tsv', 'txt', 'xlsx', 'xls', 'zip']);

function extensionFor(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

function timeZoneDefault(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function cleanSubject(subject: PatternSubject): PatternSubject {
  return Object.fromEntries(Object.entries(subject).filter(([, value]) => typeof value === 'string' && value.trim())) as PatternSubject;
}

async function decodeSpreadsheet(name: string, buffer: ArrayBuffer): Promise<PatternInputFile[]> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  return workbook.SheetNames.flatMap((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return [];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false }) as unknown[][];
    return [{ name: `${name}:${sheetName}`, ext: 'xlsx', rows }];
  });
}

async function decodeNamedBlob(name: string, blob: Blob): Promise<{ inputs: PatternInputFile[]; issues: string[] }> {
  const ext = extensionFor(name);
  if (!ACCEPTED_EXTENSIONS.has(ext)) {
    return { inputs: [], issues: [`${name}: unsupported file type`] };
  }
  if (ext === 'zip') {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const inputs: PatternInputFile[] = [];
    const issues: string[] = [];
    const entries = Object.values(zip.files).filter((entry) => !entry.dir);
    for (const entry of entries) {
      const innerName = entry.name.split('/').pop() ?? entry.name;
      const innerExt = extensionFor(innerName);
      if (!ACCEPTED_EXTENSIONS.has(innerExt) || innerExt === 'zip') {
        if (innerExt !== 'zip') issues.push(`${innerName}: unsupported file type in archive`);
        continue;
      }
      const innerBlob = new Blob([
        await entry.async(innerExt === 'xlsx' || innerExt === 'xls' ? 'arraybuffer' : 'string'),
      ]);
      const decoded = await decodeNamedBlob(innerName, innerBlob);
      inputs.push(...decoded.inputs.map((input) => ({ ...input, name: `${name}/${input.name}` })));
      issues.push(...decoded.issues);
    }
    return { inputs, issues };
  }
  if (ext === 'xlsx' || ext === 'xls') {
    return { inputs: await decodeSpreadsheet(name, await blob.arrayBuffer()), issues: [] };
  }
  return { inputs: [{ name, ext, text: await blob.text() }], issues: [] };
}

function formatNumber(value: number): string {
  return value.toLocaleString();
}

function formatDuration(seconds: number): string {
  if (!seconds) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function shortCoord(lat: number | null, lon: number | null): string {
  if (lat == null || lon == null) return '-';
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

function sourceBadgeColor(source: CellReference['source']): string {
  if (source === 'carrier') return '#00E676';
  if (source === 'survey') return '#D4AF37';
  if (source === 'open-dataset') return '#00E5FF';
  return '#FF9500';
}

function StatTile({ label, value, tone = '#D4AF37' }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)]/45 px-3 py-2">
      <div className="text-[17px] font-mono font-bold tabular-nums" style={{ color: tone }}>{value}</div>
      <div className="text-[8px] font-mono tracking-widest text-[var(--text-muted)] uppercase">{label}</div>
    </div>
  );
}

function LocalPlot({ analysis }: { analysis: PatternAnalysis }) {
  const points = analysis.events
    .filter((event) => event.lat != null && event.lon != null)
    .map((event) => ({ lat: event.lat as number, lon: event.lon as number, color: event.kind === 'data_session' ? '#00E5FF' : event.kind === 'cdr' ? '#D4AF37' : '#FF9500' }));
  const towers = analysis.cellReferences
    .filter((tower) => tower.lat != null && tower.lon != null)
    .map((tower) => ({ lat: tower.lat as number, lon: tower.lon as number, color: sourceBadgeColor(tower.source) }));
  const all = [...points, ...towers];
  if (all.length === 0) {
    return (
      <div className="h-48 rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)]/45 flex items-center justify-center text-center px-6">
        <span className="text-[10px] font-mono text-[var(--text-muted)] leading-relaxed">
          No geocoded records are available. Rows with unusable coordinates were omitted; cell-only rows appear under Towers.
        </span>
      </div>
    );
  }
  const minLat = Math.min(...all.map((point) => point.lat));
  const maxLat = Math.max(...all.map((point) => point.lat));
  const minLon = Math.min(...all.map((point) => point.lon));
  const maxLon = Math.max(...all.map((point) => point.lon));
  const latSpan = Math.max(maxLat - minLat, 0.0001);
  const lonSpan = Math.max(maxLon - minLon, 0.0001);
  const project = (lat: number, lon: number) => ({
    x: 8 + ((lon - minLon) / lonSpan) * 84,
    y: 92 - ((lat - minLat) / latSpan) * 84,
  });

  return (
    <div className="rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)]/45 overflow-hidden">
      <svg viewBox="0 0 100 100" className="w-full h-48 block" role="img" aria-label="Local plot of geocoded pattern-of-life records">
        <defs>
          <pattern id="pol-grid" width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M 10 0 L 0 0 0 10" fill="none" stroke="rgba(212,175,55,0.08)" strokeWidth="0.4" />
          </pattern>
        </defs>
        <rect width="100" height="100" fill="rgba(6,6,12,0.88)" />
        <rect width="100" height="100" fill="url(#pol-grid)" />
        {points.map((point, index) => {
          const projected = project(point.lat, point.lon);
          return <circle key={`p-${index}`} cx={projected.x} cy={projected.y} r="1.8" fill={point.color} opacity="0.75" />;
        })}
        {towers.map((tower, index) => {
          const projected = project(tower.lat, tower.lon);
          return <rect key={`t-${index}`} x={projected.x - 1.6} y={projected.y - 1.6} width="3.2" height="3.2" fill={tower.color} opacity="0.85" />;
        })}
      </svg>
      <div className="flex items-center justify-between px-3 py-2 border-t border-[var(--border-secondary)] text-[8px] font-mono text-[var(--text-muted)]">
        <span>{formatNumber(points.length)} events</span>
        <span>{formatNumber(towers.length)} tower refs</span>
      </div>
    </div>
  );
}

function TimelineGrid({ analysis }: { analysis: PatternAnalysis }) {
  const dates = Array.from(new Set(analysis.timeline.map((bucket) => bucket.date))).sort();
  const byKey = new Map(analysis.timeline.map((bucket) => [`${bucket.date}:${bucket.hour}`, bucket.count]));
  const max = Math.max(1, ...analysis.timeline.map((bucket) => bucket.count));
  if (dates.length === 0) {
    return <div className="text-[10px] font-mono text-[var(--text-muted)]">No dated events were available for the activity timeline.</div>;
  }
  return (
    <div className="overflow-x-auto styled-scrollbar">
      <div className="grid gap-1 min-w-[620px]" style={{ gridTemplateColumns: '86px repeat(24, minmax(14px, 1fr))' }}>
        <div />
        {Array.from({ length: 24 }, (_, hour) => (
          <div key={hour} className="text-center text-[7px] font-mono text-[var(--text-muted)]">{hour}</div>
        ))}
        {dates.map((date) => (
          <Fragment key={date}>
            <div key={`${date}-label`} className="text-[9px] font-mono text-[var(--text-secondary)] py-1">{date}</div>
            {Array.from({ length: 24 }, (_, hour) => {
              const count = byKey.get(`${date}:${hour}`) ?? 0;
              const opacity = count === 0 ? 0.08 : 0.18 + (count / max) * 0.72;
              const isDay = hour >= 6 && hour < 20;
              return (
                <div
                  key={`${date}-${hour}`}
                  title={`${date} ${hour}:00 - ${count} records`}
                  className="h-5 rounded-sm border border-white/5"
                  style={{ background: isDay ? `rgba(255,149,0,${opacity})` : `rgba(0,229,255,${opacity})` }}
                />
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function PatternOfLifePanel({ expanded = false }: PatternOfLifePanelProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [inputs, setInputs] = useState<PatternInputFile[]>([]);
  const [analysis, setAnalysis] = useState<PatternAnalysis | null>(null);
  const [decodeIssues, setDecodeIssues] = useState<string[]>([]);
  const [subject, setSubject] = useState<PatternSubject>({});
  const [timeZone, setTimeZone] = useState(timeZoneDefault);
  const [activeView, setActiveView] = useState<ViewId>('overview');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);

  const runAnalysis = (nextInputs: PatternInputFile[]) => {
    const nextAnalysis = processPatternOfLifeFiles(nextInputs, cleanSubject(subject), {
      timeZone,
    });
    setAnalysis(nextAnalysis);
    if (nextAnalysis.stats.totalEvents > 0 || nextAnalysis.stats.towerReferences > 0 || nextAnalysis.stats.adtechPings > 0) {
      setError('');
    }
  };

  const handleFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    setBusy(true);
    setError('');
    setDecodeIssues([]);
    try {
      const decodedInputs: PatternInputFile[] = [];
      const issues: string[] = [];
      for (const file of files) {
        const decoded = await decodeNamedBlob(file.name, file);
        decodedInputs.push(...decoded.inputs);
        issues.push(...decoded.issues);
      }
      if (decodedInputs.length === 0) {
        setError('No supported CDR, tower, location, or ad-tech files were selected.');
      }
      setInputs(decodedInputs);
      setDecodeIssues(issues);
      runAnalysis(decodedInputs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read selected files.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) void handleFiles(event.target.files);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void handleFiles(event.dataTransfer.files);
  };

  const reset = () => {
    setInputs([]);
    setAnalysis(null);
    setDecodeIssues([]);
    setError('');
  };

  const exportJson = () => {
    if (!analysis) return;
    const blob = new Blob([JSON.stringify(analysis, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `overseer-pattern-of-life-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const topLocations = useMemo(() => analysis?.locations.slice(0, expanded ? 12 : 5) ?? [], [analysis, expanded]);
  const unmappedCount = analysis?.stats.unmappedCells ?? 0;

  return (
    <div className="space-y-3">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`rounded-lg border border-dashed px-3 py-3 bg-[var(--bg-primary)]/45 transition-colors ${dragging ? 'border-[var(--cyan-primary)] bg-[var(--cyan-primary)]/10' : 'border-[var(--border-primary)]'}`}
      >
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg border border-[var(--cyan-primary)]/25 bg-[var(--cyan-primary)]/10 flex items-center justify-center shrink-0">
            <Upload className="w-4 h-4 text-[var(--cyan-primary)]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-mono font-bold tracking-widest text-[var(--text-primary)]">PATTERN OF LIFE</span>
              <span className="gotham-tag gotham-tag--info" style={{ fontSize: '7px', padding: '1px 5px' }}>LOCAL PARSE</span>
            </div>
            <p className="mt-1 text-[9px] font-mono text-[var(--text-muted)] leading-relaxed">
              CDR, timing advance, WebMap ping, tower survey, open cell-reference, generic location, and ad-tech files are processed inside Overseer from local files only.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                onClick={() => inputRef.current?.click()}
                disabled={busy}
                className="px-3 py-1.5 rounded border border-[var(--cyan-primary)]/35 bg-[var(--cyan-primary)]/10 text-[var(--cyan-primary)] text-[9px] font-mono font-bold tracking-wider flex items-center gap-1.5 disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                LOAD FILES
              </button>
              {analysis && (
                <button
                  onClick={() => runAnalysis(inputs)}
                  disabled={busy || inputs.length === 0}
                  className="px-3 py-1.5 rounded border border-[var(--border-primary)] text-[var(--text-secondary)] text-[9px] font-mono tracking-wider flex items-center gap-1.5 disabled:opacity-50"
                >
                  <RefreshCw className="w-3 h-3" />
                  REBUILD
                </button>
              )}
              {analysis && (
                <button
                  onClick={exportJson}
                  className="px-3 py-1.5 rounded border border-[var(--border-primary)] text-[var(--text-secondary)] text-[9px] font-mono tracking-wider flex items-center gap-1.5"
                >
                  <Download className="w-3 h-3" />
                  EXPORT JSON
                </button>
              )}
              {(analysis || inputs.length > 0) && (
                <button
                  onClick={reset}
                  className="px-2 py-1.5 rounded border border-red-500/25 text-red-300 text-[9px] font-mono tracking-wider flex items-center gap-1"
                  title="Clear loaded files"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            <input ref={inputRef} type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,.zip" multiple className="hidden" onChange={handleFileChange} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <input
          value={subject.name ?? ''}
          onChange={(event) => setSubject((prev) => ({ ...prev, name: event.target.value }))}
          placeholder="Subject name"
          className="bg-[var(--bg-primary)]/60 border border-[var(--border-primary)] rounded px-2 py-1.5 text-[9px] font-mono text-[var(--text-primary)] outline-none"
        />
        <input
          value={subject.phone ?? ''}
          onChange={(event) => setSubject((prev) => ({ ...prev, phone: event.target.value }))}
          placeholder="Phone / identifier"
          className="bg-[var(--bg-primary)]/60 border border-[var(--border-primary)] rounded px-2 py-1.5 text-[9px] font-mono text-[var(--text-primary)] outline-none"
        />
        <input
          value={subject.caseNumber ?? ''}
          onChange={(event) => setSubject((prev) => ({ ...prev, caseNumber: event.target.value }))}
          placeholder="Case reference"
          className="bg-[var(--bg-primary)]/60 border border-[var(--border-primary)] rounded px-2 py-1.5 text-[9px] font-mono text-[var(--text-primary)] outline-none"
        />
        <input
          value={timeZone}
          onChange={(event) => setTimeZone(event.target.value)}
          placeholder="Time zone"
          className="bg-[var(--bg-primary)]/60 border border-[var(--border-primary)] rounded px-2 py-1.5 text-[9px] font-mono text-[var(--text-primary)] outline-none"
        />
      </div>

      {error && (
        <div className="rounded border border-red-500/35 bg-red-500/10 px-3 py-2 text-[10px] font-mono text-red-300 flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </div>
      )}

      {decodeIssues.length > 0 && (
        <div className="rounded border border-amber-500/25 bg-amber-500/10 px-3 py-2 space-y-1">
          {decodeIssues.slice(0, 4).map((issue) => (
            <div key={issue} className="text-[9px] font-mono text-amber-200">{issue}</div>
          ))}
        </div>
      )}

      {!analysis && (
        <div className="rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)]/35 px-3 py-3">
          <div className="grid grid-cols-2 gap-2 text-[9px] font-mono text-[var(--text-muted)]">
            <div className="flex items-center gap-1.5"><FileText className="w-3 h-3 text-[var(--cyan-primary)]" /> CSV / TSV / TXT</div>
            <div className="flex items-center gap-1.5"><Database className="w-3 h-3 text-[var(--gold-primary)]" /> XLSX / XLS / ZIP</div>
            <div className="flex items-center gap-1.5"><MapPin className="w-3 h-3 text-[#FF9500]" /> tower / cell refs</div>
            <div className="flex items-center gap-1.5"><Wifi className="w-3 h-3 text-[#E040FB]" /> ad-tech pings</div>
          </div>
        </div>
      )}

      {analysis && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <StatTile label="events" value={formatNumber(analysis.stats.totalEvents)} tone="#D4AF37" />
            <StatTile label="geocoded" value={formatNumber(analysis.stats.geocodedEvents)} tone="#00E676" />
            <StatTile label="locations" value={formatNumber(analysis.locations.length)} tone="#FF9500" />
            <StatTile label="towers" value={formatNumber(analysis.stats.towerReferences)} tone="#00E5FF" />
            <StatTile label="unmapped" value={formatNumber(unmappedCount)} tone={unmappedCount ? '#FF9500' : '#00E676'} />
            <StatTile label="contacts" value={formatNumber(analysis.contacts.length)} tone="#E040FB" />
          </div>

          {analysis.issues.length > 0 && (
            <div className="rounded border border-amber-500/25 bg-amber-500/10 px-3 py-2 space-y-1">
              {analysis.issues.slice(0, expanded ? 8 : 3).map((issue, index) => (
                <div key={`${issue.file ?? 'analysis'}-${index}`} className="text-[9px] font-mono text-amber-200">
                  {issue.file ? `${issue.file}: ` : ''}{issue.message}
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-1 overflow-x-auto styled-scrollbar pb-1">
            {([
              ['overview', MapPin],
              ['timeline', Clock3],
              ['locations', MapPin],
              ['contacts', Phone],
              ['towers', Radio],
              ['adtech', Wifi],
              ['files', FileText],
            ] as Array<[ViewId, typeof MapPin]>).map(([view, Icon]) => (
              <button
                key={view}
                onClick={() => setActiveView(view)}
                className={`px-2 py-1.5 rounded border text-[8px] font-mono tracking-wider uppercase flex items-center gap-1 whitespace-nowrap ${activeView === view ? 'border-[var(--cyan-primary)]/45 bg-[var(--cyan-primary)]/10 text-[var(--cyan-primary)]' : 'border-[var(--border-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
              >
                <Icon className="w-3 h-3" />
                {view}
              </button>
            ))}
          </div>

          {activeView === 'overview' && (
            <div className="space-y-3">
              <LocalPlot analysis={analysis} />
              <div className="grid grid-cols-1 gap-2">
                {topLocations.map((location) => (
                  <div key={location.id} className="rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)]/40 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-mono font-bold text-[var(--text-primary)] truncate">
                        {location.addresses[0] || shortCoord(location.lat, location.lon)}
                      </span>
                      <span className="text-[10px] font-mono text-[var(--gold-primary)] tabular-nums">{location.count}</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full overflow-hidden bg-white/5 flex">
                      <div style={{ width: `${location.count ? (location.day / location.count) * 100 : 0}%` }} className="bg-[#FF9500]" />
                      <div style={{ width: `${location.count ? (location.night / location.count) * 100 : 0}%` }} className="bg-[#00E5FF]" />
                    </div>
                    <div className="mt-1 flex justify-between text-[8px] font-mono text-[var(--text-muted)]">
                      <span>{shortCoord(location.lat, location.lon)}</span>
                      <span>{location.primaryPeriod.toUpperCase()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeView === 'timeline' && <TimelineGrid analysis={analysis} />}

          {activeView === 'locations' && (
            <div className="max-h-[360px] overflow-y-auto styled-scrollbar rounded border border-[var(--border-secondary)]">
              {analysis.locations.map((location) => (
                <div key={location.id} className="grid grid-cols-[1fr_56px_70px] gap-2 px-3 py-2 border-b border-[var(--border-secondary)] last:border-0 text-[9px] font-mono">
                  <span className="text-[var(--text-primary)] truncate">{location.addresses[0] || shortCoord(location.lat, location.lon)}</span>
                  <span className="text-[var(--gold-primary)] tabular-nums">{location.count}</span>
                  <span className="text-[var(--text-muted)]">{location.primaryPeriod}</span>
                </div>
              ))}
            </div>
          )}

          {activeView === 'contacts' && (
            <div className="max-h-[360px] overflow-y-auto styled-scrollbar rounded border border-[var(--border-secondary)]">
              {analysis.contacts.length === 0 ? (
                <div className="px-3 py-3 text-[10px] font-mono text-[var(--text-muted)]">No dialed/called number fields were present in accepted CDR rows.</div>
              ) : analysis.contacts.map((contact) => (
                <div key={contact.number} className="px-3 py-2 border-b border-[var(--border-secondary)] last:border-0">
                  <div className="flex items-center justify-between gap-2 text-[10px] font-mono">
                    <span className="text-[var(--text-primary)] truncate">{contact.number}</span>
                    <span className="text-[var(--gold-primary)]">{contact.total} calls</span>
                  </div>
                  <div className="mt-1 flex justify-between text-[8px] font-mono text-[var(--text-muted)]">
                    <span>out {contact.outgoing} / in {contact.incoming}</span>
                    <span>{formatDuration(contact.totalDurationSec)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeView === 'towers' && (
            <div className="space-y-2">
              {unmappedCount > 0 && (
                <div className="rounded border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[9px] font-mono text-amber-200 leading-relaxed">
                  {unmappedCount} cell reference{unmappedCount === 1 ? '' : 's'} could not be mapped from the loaded files. Load a carrier site export, tower survey, or imported open cell-reference dataset with matching MCC/MNC/LAC/CID values to resolve them inside Overseer.
                </div>
              )}
              <div className="max-h-[360px] overflow-y-auto styled-scrollbar rounded border border-[var(--border-secondary)]">
                {analysis.cellReferences.map((tower) => (
                  <div key={tower.key} className="grid grid-cols-[1fr_56px_82px] gap-2 px-3 py-2 border-b border-[var(--border-secondary)] last:border-0 text-[9px] font-mono">
                    <span className="text-[var(--text-primary)] truncate">{[tower.mcc, tower.mnc, tower.lac, tower.cid].filter(Boolean).join('-') || tower.key}</span>
                    <span className="tabular-nums" style={{ color: sourceBadgeColor(tower.source) }}>{tower.hits}</span>
                    <span className="text-[var(--text-muted)] truncate">{tower.source}</span>
                    <span className="col-span-3 text-[8px] text-[var(--text-muted)]">{shortCoord(tower.lat, tower.lon)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeView === 'adtech' && (
            <div className="max-h-[360px] overflow-y-auto styled-scrollbar rounded border border-[var(--border-secondary)]">
              {analysis.adtech.candidates.length === 0 ? (
                <div className="px-3 py-3 text-[10px] font-mono text-[var(--text-muted)]">
                  {analysis.stats.adtechPings > 0 ? 'Ad-tech pings loaded, but no device met the overlap threshold.' : 'No ad-tech ping files were loaded.'}
                </div>
              ) : analysis.adtech.candidates.map((candidate) => (
                <div key={candidate.deviceId} className="px-3 py-2 border-b border-[var(--border-secondary)] last:border-0">
                  <div className="flex items-center justify-between gap-2 text-[10px] font-mono">
                    <span className="text-[var(--text-primary)] truncate">{candidate.deviceId}</span>
                    <span className="text-[var(--gold-primary)]">{Math.round(candidate.confidence * 100)}%</span>
                  </div>
                  <div className="mt-1 flex justify-between text-[8px] font-mono text-[var(--text-muted)]">
                    <span>{candidate.hits} overlaps</span>
                    <span>{candidate.avgDistanceM}m avg</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeView === 'files' && (
            <div className="max-h-[360px] overflow-y-auto styled-scrollbar rounded border border-[var(--border-secondary)]">
              {analysis.files.map((file) => (
                <div key={file.name} className="px-3 py-2 border-b border-[var(--border-secondary)] last:border-0">
                  <div className="flex items-center justify-between gap-2 text-[9px] font-mono">
                    <span className="text-[var(--text-primary)] truncate">{file.name}</span>
                    <span className="text-[var(--cyan-primary)]">{file.format}</span>
                  </div>
                  <div className="mt-1 flex justify-between text-[8px] font-mono text-[var(--text-muted)]">
                    <span>{file.recordsAccepted} accepted</span>
                    <span>{file.recordsOmitted} omitted</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default PatternOfLifePanel;
