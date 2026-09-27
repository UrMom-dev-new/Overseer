'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import { Layers, BarChart3, Newspaper, Search, X, Globe, MapPinned, Radar, Satellite, Moon, ExternalLink, AlertTriangle, Activity, Database, Wifi, Play, Network, Crosshair } from 'lucide-react';
import IntelFeed from '@/components/IntelFeed';
import MarketsPanel from '@/components/MarketsPanel';
import ScmPanel from '@/components/ScmPanel';
import SearchBar from '@/components/SearchBar';
import ScaleBar from '@/components/ScaleBar';
import ErrorBoundary from '@/components/ErrorBoundary';
import SharePanel from '@/components/SharePanel';
import ViewPresets from '@/components/ViewPresets';
import KeyboardShortcuts from '@/components/KeyboardShortcuts';
import GlobalStatusBar from '@/components/GlobalStatusBar';
import LiveAlerts from '@/components/LiveAlerts';
import DataSourcesPanel from '@/components/DataSourcesPanel';
import {
  canonicalClientFeedKey,
  createDeadline,
  parseRetryAfterMs,
  readClientFeedSnapshots,
  writeClientFeedSnapshot,
} from '@/lib/client-feed-store';
import { evaluateCapabilityPayload, getSourceContract } from '@/lib/source-contracts';

const OverseerMap = dynamic(() => import('@/components/OverseerMap'), { ssr: false });
const LayerPanel = dynamic(() => import('@/components/LayerPanel'));
const CameraViewer = dynamic(() => import('@/components/CameraViewer'));
const OsintPanel = dynamic(() => import('@/components/OsintPanel'));
const EntityGraphPanel = dynamic(() => import('@/components/EntityGraphPanel'));
const TokenPanel = dynamic(() => import('@/components/TokenPanel'));

const FEED_REFRESH_MS: Record<string, number> = {
  earthquakes: 15 * 60 * 1000,
  news: 30 * 60 * 1000,
  markets: 15 * 60 * 1000,
  flights: 5 * 60 * 1000,
  maritime: 60 * 1000,
  fires: 15 * 60 * 1000,
  weather: 15 * 60 * 1000,
  gdelt: 15 * 60 * 1000,
  live_news: 30 * 60 * 1000,
  surveillance_capabilities: 6 * 60 * 60 * 1000,
  surveillance_industry: 6 * 60 * 60 * 1000,
  'data-centers': 6 * 60 * 60 * 1000,
};

const CLIENT_SNAPSHOT_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const FEED_ATTEMPT_TIMEOUT_MS = 20_000;

function feedKeyFromUrl(url: string): string {
  if (url.includes('/api/gdelt')) return 'gdelt';
  if (url.includes('/api/news')) return 'news';
  if (url.includes('/api/earthquakes')) return 'earthquakes';
  if (url.includes('/api/flights')) return 'flights';
  if (url.includes('/api/maritime')) return 'maritime';
  if (url.includes('/api/fires')) return 'fires';
  if (url.includes('/api/weather')) return 'weather';
  if (url.includes('/api/live-news')) return 'live_news';
  if (url.includes('/api/surveillance-capabilities')) return 'surveillance_capabilities';
  if (url.includes('/api/surveillance-industry')) return 'surveillance_industry';
  if (url.includes('/api/data-centers')) return 'data-centers';
  if (url.includes('/api/markets')) return 'markets';
  return url.replace(/^\/api\//, '').split(/[/?#]/)[0] || url;
}

function capabilityIdFromUrl(url: string): string {
  if (url.includes('/api/live-news')) return 'live-news';
  if (url.includes('/api/surveillance-capabilities')) return 'surveillance-capabilities';
  if (url.includes('/api/surveillance-industry')) return 'surveillance-industry';
  if (url.includes('/api/data-centers')) return 'data-centers';
  if (url.includes('/api/space-weather')) return 'space-weather';
  if (url.includes('/api/cyber-threats')) return 'cyber-threats';
  if (url.includes('/api/osint/mac')) return 'mac-vendor-lookup';
  return feedKeyFromUrl(url).replace(/_/g, '-');
}

function dashboardPatchForCapability(capabilityId: string, payload: any): Record<string, unknown> {
  switch (capabilityId) {
    case 'markets':
      return { markets: payload };
    case 'space-weather':
      return { spaceWeather: payload };
    case 'maritime':
      return {
        maritime_ports: payload.ports,
        maritime_chokepoints: payload.chokepoints,
        maritime_ships: payload.ships,
      };
    case 'weather':
      return { weather_events: payload.events };
    case 'gdelt':
      return { gdelt: payload.events };
    case 'live-news':
      return { live_feeds: payload.feeds };
    case 'surveillance-capabilities':
      return {
        surveillance_locations: payload.locations,
        surveillance_records: payload.records,
        surveillance_flight_paths: payload.flight_paths,
      };
    case 'surveillance-industry':
      return {
        surveillance_industry_locations: payload.locations,
        surveillance_industry_dossiers: payload.dossiers,
      };
    case 'data-centers':
      return {
        data_centers: payload.data_centers,
        data_center_summaries: payload.summaries,
      };
    case 'cctv':
      return { cameras: payload.cameras };
    case 'cyber-threats':
      return { cyber_threats: payload.threats || payload.vulnerabilities || [] };
    default:
      return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  }
}
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      // Mobile if narrow, OR landscape phone (short height + moderate width)
      setIsMobile(w < 768 || (h < 500 && w < 1024));
    };
    check();
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    return () => {
      window.removeEventListener('resize', check);
      window.removeEventListener('orientationchange', check);
    };
  }, []);
  return isMobile;
}
const UptimeClock = () => {
  const [uptime, setUptime] = useState('00:00:00');
  const startTime = useRef(0);
  if (startTime.current === 0) startTime.current = Date.now();
  useEffect(() => {
    const iv = setInterval(() => {
      const e = Math.floor((Date.now() - startTime.current) / 1000);
      setUptime(`${String(Math.floor(e/3600)).padStart(2,'0')}:${String(Math.floor((e%3600)/60)).padStart(2,'0')}:${String(e%60).padStart(2,'0')}`);
    }, 1000);
    return () => clearInterval(iv);
  }, []);
  return <span className="hidden lg:inline">UPTIME: <span className="text-[var(--gold-primary)]">{uptime}</span></span>;
};

type FetchState = {
  promise: Promise<boolean>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function numberField(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function inferPatchRecordCount(patch: Record<string, unknown>): number {
  return Object.values(patch).reduce<number>((sum, value) => {
    if (Array.isArray(value)) return sum + value.length;
    if (isRecord(value)) return sum + Object.keys(value).length;
    return sum;
  }, 0);
}

function latestTimestamp(values: Array<string | null | undefined>): string | null {
  const latest = values
    .map((value) => typeof value === 'string' ? Date.parse(value) : Number.NaN)
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];
  return typeof latest === 'number' && Number.isFinite(latest) ? new Date(latest).toISOString() : null;
}

function summarizeClientFeedStatus(feedKey: string, url: string, response: Response, payload: unknown, patch: Record<string, unknown>) {
  const contract = getSourceContract(capabilityIdFromUrl(url));
  if (contract) {
    const evaluation = evaluateCapabilityPayload({
      contract,
      httpStatus: response.status,
      contentType: response.headers.get('content-type'),
      payload,
      env: {},
      renderingChecked: false,
    });
    const providerMessage = evaluation.providerStatuses
      .map((status) => status.message)
      .find(Boolean);
    const availability = !response.ok || !evaluation.passed
      ? evaluation.stages.configuration === 'not_configured' || evaluation.stages.providerCollection === 'not_configured'
        ? 'not_configured'
        : 'error'
      : Object.values(evaluation.stages).includes('warning')
        ? 'partial'
        : 'ok';
    const dataState = evaluation.counts.usableRecords > 0
      ? 'present'
      : evaluation.stages.dataState === 'not_configured'
        ? 'unavailable'
        : contract.allowSchemaValidEmpty && evaluation.stages.dataState === 'passed'
          ? 'empty'
          : 'unavailable';
    const freshness = evaluation.stages.freshness === 'passed'
      ? 'fresh'
      : evaluation.stages.freshness === 'failed' || evaluation.stages.freshness === 'warning'
        ? 'stale'
        : 'unknown';
    return {
      availability,
      dataState,
      freshness,
      httpStatus: response.status,
      message: isRecord(payload) && typeof payload.message === 'string' ? payload.message : evaluation.messages[0] || providerMessage || `${feedKey} ${availability}`,
      sources: evaluation.providerStatuses,
      acceptedRecords: evaluation.counts.providerAcceptedRecords || evaluation.counts.usableRecords,
      rejectedRecords: evaluation.counts.providerRejectedRecords + evaluation.counts.unusableRecords,
      receivedRecords: evaluation.counts.providerReceivedRecords || evaluation.counts.returnedRecords,
      usableRecords: evaluation.counts.usableRecords,
      unusableRecords: evaluation.counts.unusableRecords,
      updatedAt: new Date().toISOString(),
      lastSuccessfulFetchAt: latestTimestamp(evaluation.providerStatuses.map((status) => status.lastSuccessfulFetchAt)),
      servingLastKnownGood: evaluation.providerStatuses.some((status) => Boolean(status.servingLastKnownGood)),
      contractId: contract.id,
      contractPassed: evaluation.passed,
      okToApply: response.ok && evaluation.passed,
    };
  }

  const statuses = isRecord(payload) && Array.isArray(payload.status)
    ? payload.status.filter(isRecord)
    : [];
  const acceptedRecords = statuses.reduce((sum, status) => sum + numberField(status.acceptedRecords), 0);
  const rejectedRecords = statuses.reduce((sum, status) => sum + numberField(status.rejectedRecords), 0);
  const receivedRecords = statuses.reduce((sum, status) => sum + numberField(status.receivedRecords), 0);
  const returnedRecords = inferPatchRecordCount(patch);
  const providerAvailabilities = statuses.map((status) => String(status.availability || 'unknown'));
  const anyOk = providerAvailabilities.some((availability) => availability === 'ok' || availability === 'partial');
  const anyBad = providerAvailabilities.some((availability) => availability === 'error' || availability === 'rate_limited');
  const allNotConfigured = statuses.length > 0 && providerAvailabilities.every((availability) => availability === 'not_configured');
  const dataStates = statuses.map((status) => String(status.dataState || 'unknown'));
  const freshness = statuses.some((status) => status.freshness === 'fresh')
    ? 'fresh'
    : statuses.some((status) => status.freshness === 'stale' || status.servingLastKnownGood)
      ? 'stale'
      : response.ok
        ? 'unknown'
        : 'unknown';
  const dataState = dataStates.some((state) => state === 'present')
    ? 'present'
    : dataStates.some((state) => state === 'empty')
      ? 'empty'
      : returnedRecords > 0
        ? 'present'
        : response.ok
          ? 'empty'
          : 'unavailable';
  const availability = !response.ok
    ? 'error'
    : allNotConfigured
      ? 'not_configured'
      : anyOk && anyBad
        ? 'partial'
        : anyOk
          ? 'ok'
          : anyBad
            ? 'error'
            : 'ok';
  const providerMessage = statuses
    .map((status) => typeof status.message === 'string' ? status.message : null)
    .find(Boolean);
  return {
    availability,
    dataState,
    freshness,
    httpStatus: response.status,
    message: isRecord(payload) && typeof payload.message === 'string' ? payload.message : providerMessage || `${feedKey} ${availability}`,
    sources: statuses,
    acceptedRecords: acceptedRecords || returnedRecords,
    rejectedRecords,
    receivedRecords: receivedRecords || returnedRecords,
    updatedAt: new Date().toISOString(),
    lastSuccessfulFetchAt: latestTimestamp(statuses.map((status) => typeof status.lastSuccessfulFetchAt === 'string' ? status.lastSuccessfulFetchAt : null)),
    servingLastKnownGood: statuses.some((status) => Boolean(status.servingLastKnownGood)),
    okToApply: response.ok && (availability === 'ok' || availability === 'partial' || dataState === 'empty'),
  };
}

const ZuluClock = () => {
  const [time, setTime] = useState('');
  useEffect(() => {
    const iv = setInterval(() => {
      const now = new Date();
      setTime(`ZULU ${String(now.getUTCHours()).padStart(2,'0')}:${String(now.getUTCMinutes()).padStart(2,'0')}:${String(now.getUTCSeconds()).padStart(2,'0')}Z`);
    }, 1000);
    return () => clearInterval(iv);
  }, []);
  return <span className="text-[var(--cyan-primary)] font-bold tabular-nums">{time || 'ZULU --:--:--Z'}</span>;
};

/** Real entity count — no fake throughput metrics */
const ActiveEntityCount = ({ data }: { data: Record<string, unknown[]> }) => {
  const count = useMemo(() => {
    if (!data) return 0;
    return Object.values(data).reduce((sum, v) => sum + (Array.isArray(v) ? v.length : 0), 0);
  }, [data]);
  return <span className="text-[var(--alert-green)] font-bold tabular-nums">{count.toLocaleString()}</span>;
};

/** Extracts a watchable YouTube URL from embed/channel URLs */
function getYouTubeWatchUrl(url: string): string {
  if (url.includes('channel=')) return `https://www.youtube.com/channel/${url.split('channel=')[1].split('&')[0]}/live`;
  if (url.includes('/embed/')) return `https://www.youtube.com/watch?v=${url.split('/embed/')[1].split('?')[0]}`;
  return url;
}

const WORKSPACE_STORAGE_KEY = 'overseer.workspace.v1';

const DEFAULT_ACTIVE_LAYERS = {
  flights: false,
  private: false,
  jets: false,
  military: false,
  maritime: true,
  satellites: false,
  balloons: false,
  cctv: true,
  surveillance_capabilities: false,
  surveillance_industry: false,
  live_news: true,
  news_intel: true,
  earthquakes: true,
  fires: false,
  weather: false,
  radiation: false,
  infrastructure: false,
  data_centers: false,
  global_incidents: true,
  war_alerts: false,
  gps_jamming: false,
  day_night: true,
  cables: true,
  sdk_sea: true,
  sdk_air: true,
  sdk_naval: true,
  terrain_3d: false,
  malware: false,
};

function readSavedWorkspace(): {
  activeLayers?: Partial<typeof DEFAULT_ACTIVE_LAYERS>;
  mapView?: { zoom: number; latitude: number; longitude: number };
  mapProjection?: 'globe' | 'mercator';
  mapStyle?: 'dark' | 'satellite';
  theme?: 'core' | 'ghost';
} | null {
  if (typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(WORKSPACE_STORAGE_KEY) || 'null');
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

export default function Dashboard() {
  const dataRef = useRef<any>({});
  const [dataVersion, setDataVersion] = useState(0);
  const data = dataRef.current;

  const [backendStatus, setBackendStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const feedStatusRef = useRef<Record<string, any>>({});
  const lastFetchRef = useRef<Record<string, number>>({});
  const inFlightFetchRef = useRef<Map<string, FetchState>>(new Map());
  const retryAfterRef = useRef<Record<string, number>>({});
  const [mapView, setMapView] = useState(() => readSavedWorkspace()?.mapView ?? { zoom: 6.5, latitude: 42.70, longitude: 25.48 });
  const [flyToLocation, setFlyToLocation] = useState<{ lat: number; lng: number; ts: number } | null>(null);
  const [globalStats, setGlobalStats] = useState<any>(null);
  const mouseCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
  const coordsDisplayRef = useRef<HTMLDivElement>(null);
  const [locationLabel, setLocationLabel] = useState('');
  const [regionDossier, setRegionDossier] = useState<any>(null);
  const [dossierLoading, setDossierLoading] = useState(false);
  const [showSplash, setShowSplash] = useState(false);
  const [activeCamera, setActiveCamera] = useState<any>(null);
  const [spaceWeather, setSpaceWeather] = useState<any>(null);
  const [showLayers, setShowLayers] = useState(true);
  const [showMarkets, setShowMarkets] = useState(false);
  const [showAlerts, setShowAlerts] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [showScmPanel, setShowScmPanel] = useState(true);
  const [showIntel, setShowIntel] = useState(false);
  const [showEntityGraph, setShowEntityGraph] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<'layers'|'markets'|'intel'|'search'|'recon'|null>(null);
  const [mapProjection, setMapProjection] = useState<'globe'|'mercator'>(() => readSavedWorkspace()?.mapProjection ?? 'globe');
  const [mapStyle, setMapStyle] = useState<'dark'|'satellite'>(() => readSavedWorkspace()?.mapStyle ?? 'dark');
  const [sweepData, setSweepData] = useState<any>(null);
  const [scanTargets, setScanTargets] = useState<any[]>([]);
  const [entityGraphTarget, setEntityGraphTarget] = useState<{ type: string; id: string; label?: string; properties?: Record<string, any> } | null>(null);
  const [overseerTheme, setOverseerTheme] = useState<'core'|'ghost'>(() => readSavedWorkspace()?.theme ?? 'ghost');

  useEffect(() => {
    document.body.className = overseerTheme === 'core' ? '' : `theme-${overseerTheme}`;
  }, [overseerTheme]);

  const isMobile = useIsMobile();
  const startTime = useRef(Date.now());
  const geocodeCache = useRef<Map<string, string>>(new Map());
  const geocodeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastGeocodedPos = useRef<{ lat: number; lng: number } | null>(null);

  // ── DEFAULT: Most expensive layers OFF — fast initial load ──
  const [activeLayers, setActiveLayers] = useState(() => ({
    ...DEFAULT_ACTIVE_LAYERS,
    ...(readSavedWorkspace()?.activeLayers || {}),
  }));
  const [liveFeedUrl, setLiveFeedUrl] = useState<string | null>(null);
  const [liveFeedName, setLiveFeedName] = useState('');
  const [liveFeedEmbedAllowed, setLiveFeedEmbedAllowed] = useState(true);

  // The shell renders immediately; remote feeds load independently after first paint.

  useEffect(() => {
    const restored = readClientFeedSnapshots({ maxAgeMs: CLIENT_SNAPSHOT_MAX_AGE_MS });
    if (restored.length === 0) return;
    const restoredStatus: Record<string, any> = {};
    const restoredPatch: Record<string, unknown> = {};
    for (const snapshot of restored) {
      Object.assign(restoredPatch, snapshot.patch);
      restoredStatus[snapshot.feedKey] = {
        ...snapshot.status,
        freshness: 'stale',
        servingLastKnownGood: true,
        message: snapshot.status.message || 'Restored cached data while refreshing live sources.',
        restoredFromClientCache: true,
        restoredAt: new Date().toISOString(),
      };
      lastFetchRef.current[snapshot.feedKey] = snapshot.storedAtMs;
    }
    feedStatusRef.current = { ...feedStatusRef.current, ...restoredStatus };
    dataRef.current = { ...dataRef.current, ...restoredPatch, feedStatus: feedStatusRef.current };
    setDataVersion(v => v + 1);
  }, []);

  // On mount: restore URL layer overrides without changing saved map position.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Restore active layers from URL if present
    const p = new URLSearchParams(window.location.search);
    const layers = p.get('layers');
    if (layers) {
      const active = layers.split(',');
      setActiveLayers(prev => {
        const next = { ...prev };
        Object.keys(next).forEach(k => { (next as any)[k] = active.includes(k); });
        return next;
      });
    }
  }, []);

  const handleLocateMe = useCallback(async () => {
    try {
      const response = await fetch('/api/geo', { cache: 'no-store' });
      const geo = await response.json();
      if (geo.status === 'success' && typeof geo.lat === 'number' && typeof geo.lon === 'number') {
        setFlyToLocation({ lat: geo.lat, lng: geo.lon, ts: Date.now() });
        setMapView({ latitude: geo.lat, longitude: geo.lon, zoom: 12 });
      }
    } catch (e) {
      console.warn('[OVERSEER] Locate me failed:', e instanceof Error ? e.message : e);
    }
  }, []);

  // URL state: persist active layers only for shareability; full workspace is stored locally.
  const urlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (urlTimer.current) clearTimeout(urlTimer.current);
    urlTimer.current = setTimeout(() => {
      const active = Object.entries(activeLayers).filter(([,v]) => v).map(([k]) => k).join(',');
      const url = `${window.location.pathname}?layers=${active}`;
      window.history.replaceState(null, '', url);
    }, 1500);
  }, [activeLayers]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const timer = setTimeout(() => {
      try {
        window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify({
          activeLayers,
          mapView,
          mapProjection,
          mapStyle,
          theme: overseerTheme,
          savedAt: new Date().toISOString(),
        }));
      } catch {
        // Workspace persistence is best-effort and must not block dashboard use.
      }
    }, 750);
    return () => clearTimeout(timer);
  }, [activeLayers, mapView, mapProjection, mapStyle, overseerTheme]);

  // Global Stats Fetch
  useEffect(() => {
    fetch('/api/stats')
      .then(res => res.json())
      .then(d => {
        if (d.stats) setGlobalStats(d.stats);
      })
      .catch(console.error);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as Element)?.tagName)) return;
      if (e.key === 'f' && !e.ctrlKey) {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen();
      }
      if (e.key === 'l') setShowLayers(p => !p);
      if (e.key === 'm') setShowMarkets(p => !p);
      if (e.key === 'c') setShowScmPanel(p => !p);
      if (e.key === 'i') setShowIntel(p => !p);
      if (e.key === 'r') setFlyToLocation({ lat: 20, lng: 0, ts: Date.now() });
      if (e.key === 'g') setMapProjection(p => p === 'globe' ? 'mercator' : 'globe');
    };
    const fsHandler = () => setIsFullscreen(!!document.fullscreenElement);
    window.addEventListener('keydown', handler);
    document.addEventListener('fullscreenchange', fsHandler);
    return () => { window.removeEventListener('keydown', handler); document.removeEventListener('fullscreenchange', fsHandler); };
  }, []);

  // Mouse coords + reverse geocode (Zero-Render)
  const handleMouseCoords = useCallback((coords: { lat: number; lng: number }) => {
    mouseCoordsRef.current = coords;
    if (coordsDisplayRef.current) {
      coordsDisplayRef.current.innerText = `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`;
    }
    if (geocodeTimer.current) clearTimeout(geocodeTimer.current);
    geocodeTimer.current = setTimeout(async () => {
      if (lastGeocodedPos.current) {
        const d = Math.abs(coords.lat - lastGeocodedPos.current.lat) + Math.abs(coords.lng - lastGeocodedPos.current.lng);
        if (d < 0.5) return; // increased threshold — fewer geocode calls
      }
      const gk = `${coords.lat.toFixed(1)},${coords.lng.toFixed(1)}`; // coarser grid = more cache hits
      if (geocodeCache.current.has(gk)) { setLocationLabel(geocodeCache.current.get(gk)!); lastGeocodedPos.current = coords; return; }
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${coords.lat}&lon=${coords.lng}&format=json&zoom=10&addressdetails=1`, { headers: { 'Accept-Language': 'en' } });
        if (res.ok) {
          const d = await res.json();
          const a = d.address || {};
          const label = [a.city||a.town||a.village||a.county, a.state||a.region, a.country].filter(Boolean).join(', ') || 'Unknown';
          if (geocodeCache.current.size > 500) { const it = geocodeCache.current.keys(); for (let i=0;i<100;i++) { const k = it.next().value; if(k) geocodeCache.current.delete(k); }}
          geocodeCache.current.set(gk, label);
          setLocationLabel(label);
          lastGeocodedPos.current = coords;
        }
      } catch (e) { console.warn('[OVERSEER] Suppressed error:', e instanceof Error ? e.message : e); }
    }, 3000); // 3s debounce (was 1.5s)
  }, []);

  // Region dossier (right-click)
  const handleRightClick = useCallback(async (coords: { lat: number; lng: number }) => {
    setDossierLoading(true); setRegionDossier(null);
    try {
      const res = await fetch(`/api/region-dossier?lat=${coords.lat}&lng=${coords.lng}`);
      if (res.ok) setRegionDossier(await res.json());
    } catch (e) { console.warn('[OVERSEER] Suppressed error:', e instanceof Error ? e.message : e); } finally { setDossierLoading(false); }
  }, []);
  // Entity click handler (hoisted from JSX to comply with Rules of Hooks - Fixes #113)
  const handleEntityClick = useCallback((entity: any) => {
    if (entity?.type === 'cctv') setActiveCamera(entity);
    if (entity?.type === 'live_news' && entity.url) {
      setLiveFeedUrl(entity.url);
      setLiveFeedName(entity.name);
      setLiveFeedEmbedAllowed(entity.embed_allowed !== false);
    }
  }, []);

  // Global handler for map popups to manually open the Intel Graph
  useEffect(() => {
    (window as any).openOverseerIntel = (entity: any) => {
      if (entity?.callsign || entity?.icao24) {
        setEntityGraphTarget({ type: 'aircraft', id: entity.callsign?.trim() || entity.icao24, label: entity.callsign?.trim() || entity.icao24, properties: { model: entity.model, registration: entity.registration, icao24: entity.icao24 } });
        setShowEntityGraph(true);
      } else if (entity?.type === 'vessel' || entity?.mmsi || entity?.imo) {
        setEntityGraphTarget({ type: 'vessel', id: entity.imo || entity.mmsi || entity.name, label: entity.name || entity.imo, properties: { flag: entity.flag, speed: entity.speed, destination: entity.destination } });
        setShowEntityGraph(true);
      } else if (entity?.type === 'ip' && entity?.ip) {
        setEntityGraphTarget({ type: 'ip', id: entity.ip, label: entity.ip, properties: { threat_type: entity.threat_type, status: entity.status } });
        setShowEntityGraph(true);
      } else if (entity?.type === 'country' && entity?.country) {
        setEntityGraphTarget({ type: 'country', id: entity.country, label: entity.country, properties: {} });
        setShowEntityGraph(true);
      }
    };
    return () => { delete (window as any).openOverseerIntel; };
  }, []);

  // ── SHARED FETCH UTILITY (Fixes #107 — single definition, not 3 copies) ──
  const fetchEndpoint = useCallback(async (url: string, transform?: (d: any) => any, options?: RequestInit) => {
    if (typeof document !== 'undefined' && document.hidden) return false;
    const feedKey = feedKeyFromUrl(url);
    const requestKey = canonicalClientFeedKey(url);
    const retryAfter = retryAfterRef.current[requestKey];
    if (retryAfter && Date.now() < retryAfter) {
      feedStatusRef.current = {
        ...feedStatusRef.current,
        [feedKey]: {
          ...(feedStatusRef.current[feedKey] || {}),
          availability: 'rate_limited',
          dataState: 'unavailable',
          freshness: 'unknown',
          nextRetryAt: new Date(retryAfter).toISOString(),
          message: 'Provider requested a retry delay; refresh is paused for this route.',
          updatedAt: new Date().toISOString(),
        },
      };
      dataRef.current = { ...dataRef.current, feedStatus: feedStatusRef.current };
      setDataVersion(v => v + 1);
      return false;
    }

    const priorFetch = inFlightFetchRef.current.get(requestKey);
    if (priorFetch) return priorFetch.promise.catch(() => false);

    const deadline = createDeadline(FEED_ATTEMPT_TIMEOUT_MS);
    const promise = (async () => {
      // Force the browser to bypass its local disk cache for real-time data
      const res = await fetch(url, { ...options, cache: 'no-store', signal: deadline.signal });
      const text = await res.text();
      let json: any;
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        throw new Error(`Invalid JSON from ${feedKey} (HTTP ${res.status})`);
      }
      const patch = transform ? transform(json) : json;
      const status = summarizeClientFeedStatus(feedKey, url, res, json, isRecord(patch) ? patch : {});
      feedStatusRef.current = {
        ...feedStatusRef.current,
        [feedKey]: status,
      };
      dataRef.current = { ...dataRef.current, feedStatus: feedStatusRef.current };
      const retryAt = parseRetryAfterMs(res.headers.get('Retry-After'));
      if (retryAt) retryAfterRef.current[requestKey] = retryAt;
      else delete retryAfterRef.current[requestKey];

      if (status.okToApply) {
        dataRef.current = { ...dataRef.current, ...patch, feedStatus: feedStatusRef.current };
        lastFetchRef.current[feedKey] = Date.now();
        if (isRecord(patch)) {
          writeClientFeedSnapshot({
            schemaVersion: 1,
            namespace: 'real',
            key: requestKey,
            feedKey,
            storedAtMs: Date.now(),
            patch,
            status,
          });
        }
        setDataVersion(v => v + 1);
        setBackendStatus('connected');
        return true;
      }
      setDataVersion(v => v + 1);
      setBackendStatus('error');
      return false;
    })();
    inFlightFetchRef.current.set(requestKey, { promise });
    try {
      return await promise;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return false;
      console.warn('[OVERSEER] Suppressed error:', e instanceof Error ? e.message : e);
      feedStatusRef.current = {
        ...feedStatusRef.current,
        [feedKey]: {
          availability: 'error',
          dataState: 'unavailable',
          freshness: 'unknown',
          message: e instanceof Error ? e.message : 'Fetch failed',
          updatedAt: new Date().toISOString(),
        },
      };
      dataRef.current = { ...dataRef.current, feedStatus: feedStatusRef.current };
      setDataVersion(v => v + 1);
      setBackendStatus('error');
      return false;
    } finally {
      deadline.cancel();
      inFlightFetchRef.current.delete(requestKey);
    }
  }, []);

  // ── PROGRESSIVE DATA LOADING (request-optimized) ──
  useEffect(() => {
    // Priority 1: Core feeds (always needed for panels)
    fetchEndpoint('/api/earthquakes');
    fetchEndpoint('/api/news');
    const marketTimer = setTimeout(() => fetchEndpoint('/api/markets', d => ({ markets: d })), 800);

    // Priority 2: Space Weather (needed for MarketsPanel)
    const spaceTimer = setTimeout(async () => {
      try {
        const r = await fetch('/api/space-weather');
        if (r.ok) setSpaceWeather(await r.json());
      } catch (e) { console.warn('[OVERSEER] Suppressed error:', e instanceof Error ? e.message : e); }
    }, 5000);

    // Polling — OPTIMIZED intervals to minimize edge requests
    const intervals = [
      setInterval(() => fetchEndpoint('/api/earthquakes'), 900000),  // 15 min (was 5)
      setInterval(() => fetchEndpoint('/api/news'), 1800000),        // 30 min (was 10)
      setInterval(() => fetchEndpoint('/api/markets', d => ({ markets: d })), 900000), // 15 min (was 5)
    ];
    return () => {
      clearTimeout(marketTimer);
      clearTimeout(spaceTimer);
      intervals.forEach(clearInterval);
    };
  }, [fetchEndpoint]);

  // ── LAYER-AWARE DATA LOADING — only fetch when layer is toggled ON ──
  const layerFetchedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const fetchLayerOnce = (key: string, run: () => Promise<boolean>) => {
      if (layerFetchedRef.current.has(key) || inFlightFetchRef.current.has(key)) return;
      run().then((ok) => {
        if (ok) layerFetchedRef.current.add(key);
      });
    };

    // Flights
    if (activeLayers.flights || activeLayers.military || activeLayers.jets || activeLayers.private) {
      fetchLayerOnce('flights', () => fetchEndpoint('/api/flights'));
    }
    // Satellites
    if (activeLayers.satellites) {
      fetchLayerOnce('satellites', () => fetchEndpoint('/api/satellites'));
    }
    // Fires
    if (activeLayers.fires) {
      fetchLayerOnce('fires', () => fetchEndpoint('/api/fires'));
    }
    // CCTV
    if (activeLayers.cctv) {
      fetchLayerOnce('cctv', () => fetchEndpoint('/api/cctv?region=all&v=2'));
    }
    // Surveillance capabilities reference layer
    if (activeLayers.surveillance_capabilities) {
      fetchLayerOnce('surveillance_capabilities', () => fetchEndpoint(
        '/api/surveillance-capabilities',
        d => ({
          surveillance_locations: d.locations,
          surveillance_records: d.records,
          surveillance_flight_paths: d.flight_paths,
        })
      ));
    }
    // Surveillance industry reference dossiers
    if (activeLayers.surveillance_industry) {
      fetchLayerOnce('surveillance_industry', () => fetchEndpoint(
        '/api/surveillance-industry',
        d => ({
          surveillance_industry_locations: d.locations,
          surveillance_industry_dossiers: d.dossiers,
        })
      ));
    }
    // Maritime
    if (activeLayers.maritime) {
      fetchLayerOnce('maritime', () => fetchEndpoint('/api/maritime', d => ({ maritime_ports: d.ports, maritime_chokepoints: d.chokepoints, maritime_ships: d.ships })));
    }
    // Balloons
    if (activeLayers.balloons) {
      fetchLayerOnce('balloons', () => fetchEndpoint('/api/balloons', d => ({ balloons: d.balloons })));
    }
    // Radiation
    if (activeLayers.radiation) {
      fetchLayerOnce('radiation', () => fetchEndpoint('/api/radiation', d => ({ radiation: d.stations })));
    }
    // Live News
    if (activeLayers.live_news) {
      fetchLayerOnce('live_news', () => fetchEndpoint('/api/live-news', d => ({ live_feeds: d.feeds })));
    }
    // Weather
    if (activeLayers.weather) {
      fetchLayerOnce('weather', () => fetchEndpoint('/api/weather', d => ({ weather_events: d.events })));
    }
    // Infrastructure
    if (activeLayers.infrastructure) {
      fetchLayerOnce('infrastructure', () => fetchEndpoint('/api/infrastructure', d => ({ infrastructure: d.infrastructure })));
    }
    // Data centers
    if (activeLayers.data_centers) {
      fetchLayerOnce('data_centers', () => fetchEndpoint(
        '/api/data-centers?maxLocations=6000',
        d => ({ data_centers: d.data_centers, data_center_summaries: d.summaries })
      ));
    }
    // Global Incidents (GDELT)
    if (activeLayers.global_incidents) {
      fetchLayerOnce('gdelt', () => fetchEndpoint('/api/gdelt', d => ({ gdelt: d.events })));
    }

    // Submarine Cables
    if (activeLayers.cables && !layerFetchedRef.current.has('cables')) {
      (async () => {
        try {
          const ts = Date.now();
      const res = await fetch(`/data/submarine-cables.json?v=${ts}`);
          if (res.ok) {
             const cablesData = await res.json();
             dataRef.current = { ...dataRef.current, submarine_cables: cablesData.features };
             setDataVersion(v => v + 1);
          }
        } catch (e) { console.warn('Cables fetch failed'); }
      })();
      layerFetchedRef.current.add('cables');
    }


    // Live Malware (abuse.ch)
    if (activeLayers.malware && !layerFetchedRef.current.has('malware')) {
      fetchEndpoint('/api/malware', d => ({ malware_threats: d.threats }));
      layerFetchedRef.current.add('malware');
    }


  }, [activeLayers, fetchEndpoint]);

  // ── LAYER-AWARE POLLING — only poll data for active layers ──
  useEffect(() => {
    const intervals: ReturnType<typeof setInterval>[] = [];
    if (activeLayers.flights || activeLayers.military || activeLayers.jets || activeLayers.private) {
      intervals.push(setInterval(() => fetchEndpoint('/api/flights'), 300000)); // 5 min (was 2 min)
    }

    if (activeLayers.balloons) {
      intervals.push(setInterval(() => fetchEndpoint('/api/balloons', d => ({ balloons: d.balloons })), 300000)); // 5m
    }
    if (activeLayers.radiation) {
      intervals.push(setInterval(() => fetchEndpoint('/api/radiation', d => ({ radiation: d.stations })), 300000)); // 5m
    }
    if (activeLayers.maritime) {
      intervals.push(setInterval(() => fetchEndpoint('/api/maritime', d => ({ maritime_ports: d.ports, maritime_chokepoints: d.chokepoints, maritime_ships: d.ships })), FEED_REFRESH_MS.maritime));
    }
    if (activeLayers.fires) {
      intervals.push(setInterval(() => fetchEndpoint('/api/fires'), FEED_REFRESH_MS.fires));
    }
    if (activeLayers.weather) {
      intervals.push(setInterval(() => fetchEndpoint('/api/weather', d => ({ weather_events: d.events })), FEED_REFRESH_MS.weather));
    }
    if (activeLayers.global_incidents) {
      intervals.push(setInterval(() => fetchEndpoint('/api/gdelt', d => ({ gdelt: d.events })), FEED_REFRESH_MS.gdelt));
    }
    return () => intervals.forEach(clearInterval);
  }, [activeLayers, fetchEndpoint]);

  useEffect(() => {
    const refreshIfStale = () => {
      if (document.hidden) return;
      const now = Date.now();
      const stale = (key: string) => now - (lastFetchRef.current[key] || 0) >= (FEED_REFRESH_MS[key] || 15 * 60 * 1000);
      if (stale('earthquakes')) fetchEndpoint('/api/earthquakes');
      if (stale('news')) fetchEndpoint('/api/news');
      if ((activeLayers.fires && stale('fires'))) fetchEndpoint('/api/fires');
      if ((activeLayers.weather && stale('weather'))) fetchEndpoint('/api/weather', d => ({ weather_events: d.events }));
      if ((activeLayers.global_incidents && stale('gdelt'))) fetchEndpoint('/api/gdelt', d => ({ gdelt: d.events }));
      if ((activeLayers.maritime && stale('maritime'))) fetchEndpoint('/api/maritime', d => ({ maritime_ports: d.ports, maritime_chokepoints: d.chokepoints, maritime_ships: d.ships }));
      if ((activeLayers.surveillance_capabilities && stale('surveillance_capabilities'))) fetchEndpoint('/api/surveillance-capabilities', d => ({ surveillance_locations: d.locations, surveillance_records: d.records, surveillance_flight_paths: d.flight_paths }));
      if ((activeLayers.surveillance_industry && stale('surveillance_industry'))) fetchEndpoint('/api/surveillance-industry', d => ({ surveillance_industry_locations: d.locations, surveillance_industry_dossiers: d.dossiers }));
      if ((activeLayers.data_centers && stale('data-centers'))) fetchEndpoint('/api/data-centers?maxLocations=6000', d => ({ data_centers: d.data_centers, data_center_summaries: d.summaries }));
    };
    document.addEventListener('visibilitychange', refreshIfStale);
    window.addEventListener('online', refreshIfStale);
    window.addEventListener('focus', refreshIfStale);
    return () => {
      document.removeEventListener('visibilitychange', refreshIfStale);
      window.removeEventListener('online', refreshIfStale);
      window.removeEventListener('focus', refreshIfStale);
    };
  }, [activeLayers.fires, activeLayers.weather, activeLayers.global_incidents, activeLayers.maritime, activeLayers.surveillance_capabilities, activeLayers.surveillance_industry, activeLayers.data_centers, fetchEndpoint]);

  // CCTV: loaded once on layer toggle via layerFetchedRef (no viewport polling)

  // Reactive layer fetch: handled by layerFetchedRef above (no duplicate)

  // ── OVERSEER SDK — Intelligence Fusion Layer ──
  // Produces node coordinates for the SDK network mesh visualization.
  // Does NOT duplicate existing layer visuals — SDK layer is LINES ONLY.
  // Cameras are excluded — they have their own dedicated layer.
  useEffect(() => {
    const anyActive = activeLayers.sdk_sea || activeLayers.sdk_air || activeLayers.sdk_naval;
    if (!anyActive) {
      dataRef.current = { ...dataRef.current, sdk_entities: [] };
      return;
    }

    const sdkEntities: any[] = [];

    // Air domain (nodes only — no visual duplication)
    const allFlights = [
      ...(data.commercial_flights || []),
      ...(data.private_flights || []),
      ...(data.private_jets || []),
      ...(data.military_flights || []),
    ];
    // Sample flights to keep it clean (every Nth)
    const flightStep = Math.max(1, Math.floor(allFlights.length / 60));
    for (let i = 0; i < allFlights.length; i += flightStep) {
      const f = allFlights[i];
      if (!f.lat || !f.lng) continue;
      sdkEntities.push({
        type: 'Feature', geometry: { type: 'Point', coordinates: [f.lng, f.lat] },
        properties: { domain: 'AIR', name: f.callsign?.trim() || 'TRACK', source: 'ADS-B / OpenSky' },
      });
    }

    // Sea domain
    const ships = data.maritime_ships || [];
    const shipStep = Math.max(1, Math.floor(ships.length / 60));
    for (let i = 0; i < ships.length; i += shipStep) {
      const s = ships[i];
      if (!s.lat || !s.lng) continue;
      sdkEntities.push({
        type: 'Feature', geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
        properties: { domain: 'SEA', name: s.name || `MMSI-${s.mmsi}`, source: 'AIS Stream' },
      });
    }

    // Events — Earthquakes
    if (data.earthquakes?.length) {
      for (const eq of data.earthquakes) {
        if (!eq.lat || !eq.lng) continue;
        sdkEntities.push({
          type: 'Feature', geometry: { type: 'Point', coordinates: [eq.lng, eq.lat] },
          properties: { domain: 'LAND', name: `M${eq.magnitude} ${eq.place || ''}`, source: 'USGS' },
        });
      }
    }

    // GDELT events
    if (data.gdelt?.length) {
      for (const g of data.gdelt) {
        if (typeof g.lat !== 'number' || typeof g.lng !== 'number') continue;
        sdkEntities.push({
          type: 'Feature', geometry: { type: 'Point', coordinates: [g.lng, g.lat] },
          properties: {
            domain: 'INTEL',
            name: g.name || 'GDELT mention',
            source: g.source || g.integrity?.provenance?.source?.providerName || 'GDELT 2.0 GeoJSON API',
            evidenceKind: g.evidence_kind || g.integrity?.provenance?.evidenceKind || 'report',
            locationRelationship: g.location_relationship || g.integrity?.location?.relationship || 'mentioned_location',
            dataMode: g.integrity?.provenance?.dataMode || 'real',
            url: g.url || g.integrity?.provenance?.itemUrl || '',
          },
        });
      }
    }

    // News intel
    if (data.news?.length) {
      for (const n of data.news) {
        if (!n.coords || n.coords.length < 2) continue;
        sdkEntities.push({
          type: 'Feature', geometry: { type: 'Point', coordinates: [n.coords[1], n.coords[0]] },
          properties: {
            domain: 'INTEL',
            name: n.title || 'Source report',
            source: n.source || n.integrity?.provenance?.source?.providerName || 'RSS Feed',
            evidenceKind: n.evidence_kind || 'report',
            locationRelationship: n.location_relationship || 'unknown',
            keywordRelevance: n.keyword_relevance_score ?? null,
            dataMode: n.integrity?.provenance?.dataMode || 'real',
            url: n.link || '',
          },
        });
      }
    }

    dataRef.current = { ...dataRef.current, sdk_entities: sdkEntities };
  }, [dataVersion, activeLayers.sdk_sea, activeLayers.sdk_air, activeLayers.sdk_naval]);

  const totalFlights = useMemo(() => (
    (data.commercial_flights?.length||0)+(data.private_flights?.length||0)+(data.private_jets?.length||0)+(data.military_flights?.length||0)
  ), [data.commercial_flights, data.private_flights, data.private_jets, data.military_flights]);


  return (
    <main data-testid="overseer-dashboard" className="fixed inset-0 w-full h-full bg-[var(--bg-void)] overflow-hidden">

      {/* ── SPLASH ── */}
      <AnimatePresence>
        {showSplash && (
          <motion.div
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8, ease: 'easeInOut' }}
            className="absolute inset-0 z-[999] flex flex-col items-center justify-center overflow-hidden"
            style={{ background: 'radial-gradient(ellipse at center, #0a0a14 0%, var(--bg-void) 70%)' }}
          >
            {/* ── Scanline CRT overlay ── */}
            <div className="absolute inset-0 pointer-events-none z-[1]" style={{
              backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(212,175,55,0.015) 2px, rgba(212,175,55,0.015) 4px)',
              animation: 'splashScanDrift 8s linear infinite',
            }} />

            {/* ── V4.2 badge — top-left ── */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.6 }}
              transition={{ delay: 0.8, duration: 0.5 }}
              className="absolute top-6 left-6 z-[2] font-mono text-[10px] tracking-[0.3em] text-[var(--gold-primary)]"
            >
              V4.2
            </motion.div>



            {/* ── Geometric tactical logo ── */}
            <div className="relative w-40 h-40 mb-8 flex items-center justify-center z-[2]">
              {/* Outer ring — slow clockwise */}
              <motion.div
                initial={{ opacity: 0, scale: 0.6, rotate: 0 }}
                animate={{ opacity: 1, scale: 1, rotate: 360 }}
                transition={{ opacity: { duration: 0.6 }, scale: { duration: 0.8, ease: 'easeOut' }, rotate: { duration: 20, repeat: Infinity, ease: 'linear' } }}
                className="absolute inset-0 rounded-full"
                style={{ border: '1px solid rgba(212,175,55,0.2)' }}
              >
                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full" style={{ background: 'var(--gold-primary)', boxShadow: '0 0 12px var(--gold-primary), 0 0 24px rgba(212,175,55,0.3)' }} />
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 w-1 h-1 rounded-full" style={{ background: 'rgba(212,175,55,0.5)', boxShadow: '0 0 6px rgba(212,175,55,0.3)' }} />
              </motion.div>

              {/* Middle ring — faster counter-clockwise */}
              <motion.div
                initial={{ opacity: 0, scale: 0.4, rotate: 0 }}
                animate={{ opacity: 1, scale: 1, rotate: -360 }}
                transition={{ opacity: { duration: 0.6, delay: 0.15 }, scale: { duration: 0.8, delay: 0.15, ease: 'easeOut' }, rotate: { duration: 12, repeat: Infinity, ease: 'linear' } }}
                className="absolute rounded-full"
                style={{ inset: '18px', border: '1px solid rgba(0,229,255,0.15)' }}
              >
                <div className="absolute top-1/2 right-0 translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full" style={{ background: 'var(--cyan-primary)', boxShadow: '0 0 10px var(--cyan-primary), 0 0 20px rgba(0,229,255,0.2)' }} />
                <div className="absolute bottom-0 left-1/4 translate-y-1/2 w-1 h-1 rounded-full" style={{ background: 'rgba(0,229,255,0.4)' }} />
              </motion.div>

              {/* Inner ring — fastest clockwise */}
              <motion.div
                initial={{ opacity: 0, scale: 0.2, rotate: 0 }}
                animate={{ opacity: 1, scale: 1, rotate: 360 }}
                transition={{ opacity: { duration: 0.6, delay: 0.3 }, scale: { duration: 0.8, delay: 0.3, ease: 'easeOut' }, rotate: { duration: 7, repeat: Infinity, ease: 'linear' } }}
                className="absolute rounded-full"
                style={{ inset: '40px', border: '1px solid rgba(212,175,55,0.25)' }}
              >
                <div className="absolute top-0 left-1/4 -translate-y-1/2 w-1.5 h-1.5 rounded-full" style={{ background: 'var(--gold-primary)', boxShadow: '0 0 8px var(--gold-primary)' }} />
              </motion.div>

              {/* Core circle + crosshair */}
              <motion.div
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.4, duration: 0.6, ease: [0.34, 1.56, 0.64, 1] }}
                className="relative w-12 h-12 rounded-full flex items-center justify-center"
                style={{ border: '2px solid var(--gold-primary)', boxShadow: '0 0 20px rgba(212,175,55,0.15), inset 0 0 20px rgba(212,175,55,0.05)' }}
              >
                <motion.div
                  animate={{ opacity: [0.3, 0.8, 0.3] }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                  className="w-5 h-5 rounded-full"
                  style={{ background: 'radial-gradient(circle, rgba(212,175,55,0.4) 0%, rgba(212,175,55,0.05) 70%)' }}
                />
                {/* Crosshair lines */}
                <div className="absolute w-[1px] h-full" style={{ background: 'linear-gradient(to bottom, transparent, rgba(212,175,55,0.3), transparent)' }} />
                <div className="absolute w-full h-[1px]" style={{ background: 'linear-gradient(to right, transparent, rgba(212,175,55,0.3), transparent)' }} />
              </motion.div>

              {/* Faint pulsing radar sweep */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 0.15, 0], rotate: [0, 360] }}
                transition={{ opacity: { duration: 3, repeat: Infinity }, rotate: { duration: 3, repeat: Infinity, ease: 'linear' }, delay: 0.6 }}
                className="absolute inset-[10px] rounded-full"
                style={{ background: 'conic-gradient(from 0deg, transparent 0deg, rgba(212,175,55,0.15) 40deg, transparent 80deg)' }}
              />
            </div>

            {/* ── OVERSEER title — letter-by-letter stagger ── */}
            <div className="flex items-center gap-[2px] mb-3 z-[2]">
              {'OVERSEER'.split('').map((letter, i) => (
                <motion.span
                  key={i}
                  initial={{ opacity: 0, y: 20, filter: 'blur(8px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  transition={{ delay: 0.5 + i * 0.08, duration: 0.5, ease: 'easeOut' }}
                  className="text-4xl md:text-5xl font-bold tracking-[0.5em] font-mono"
                  style={{ color: 'var(--text-heading)', textShadow: '0 0 30px rgba(212,175,55,0.2)' }}
                >
                  {letter}
                </motion.span>
              ))}
            </div>

            {/* ── Subtitle — typewriter reveal ── */}
            <div className="overflow-hidden mb-8 z-[2]">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: '100%' }}
                transition={{ delay: 1.2, duration: 0.8, ease: 'easeInOut' }}
                className="overflow-hidden whitespace-nowrap"
              >
                <p className="text-[10px] md:text-[11px] font-mono tracking-[0.5em] text-[var(--gold-primary)]" style={{ opacity: 0.8 }}>
                  GLOBAL INTELLIGENCE PLATFORM
                </p>
              </motion.div>
            </div>

            {/* ── Multi-stage progress bar ── */}
            <div className="w-64 md:w-80 z-[2]">
              {/* Thin progress track */}
              <div className="relative w-full h-[2px] rounded-full overflow-hidden" style={{ background: 'rgba(212,175,55,0.1)' }}>
                <motion.div
                  initial={{ width: '0%' }}
                  animate={{ width: ['0%', '25%', '50%', '78%', '100%'] }}
                  transition={{ duration: 2.2, delay: 0.5, times: [0, 0.25, 0.5, 0.75, 1], ease: 'easeInOut' }}
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{ background: 'linear-gradient(90deg, var(--gold-primary), var(--cyan-primary), var(--gold-primary))', boxShadow: '0 0 12px rgba(212,175,55,0.4)' }}
                />
              </div>

              {/* Status messages — cycling */}
              <div className="mt-3 h-4 flex items-center justify-center">
                {[
                  { text: 'ESTABLISHING SECURE CONNECTION...', delay: 0.5 },
                  { text: 'INITIALIZING FEEDS...', delay: 1.1 },
                  { text: 'CALIBRATING SENSORS...', delay: 1.7 },
                  { text: 'SYSTEM READY', delay: 2.2 },
                ].map((stage, i) => (
                  <motion.span
                    key={i}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: [0, 1, 1, 0] }}
                    transition={{ delay: stage.delay, duration: 0.6, times: [0, 0.1, 0.7, 1] }}
                    className="absolute text-[9px] font-mono tracking-[0.25em]"
                    style={{ color: i === 3 ? 'var(--cyan-primary)' : 'var(--text-muted)' }}
                  >
                    {stage.text}
                  </motion.span>
                ))}
              </div>
            </div>

            {/* ── Decorative grid lines ── */}
            <div className="absolute inset-0 pointer-events-none z-[0]" style={{ opacity: 0.03 }}>
              <div className="absolute inset-0" style={{
                backgroundImage: 'linear-gradient(rgba(212,175,55,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(212,175,55,0.5) 1px, transparent 1px)',
                backgroundSize: '60px 60px',
              }} />
            </div>

            {/* ── Corner frame accents ── */}
            {[
              { t: '10px', l: '10px', bw: '2px 0 0 2px' },
              { t: '10px', r: '10px', bw: '2px 2px 0 0' },
              { b: '10px', l: '10px', bw: '0 0 2px 2px' },
              { b: '10px', r: '10px', bw: '0 2px 2px 0' },
            ].map((pos, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.3 }}
                transition={{ delay: 0.8 + i * 0.1, duration: 0.5 }}
                className="absolute w-8 h-8 z-[2]"
                style={{ top: pos.t, bottom: pos.b, left: pos.l, right: pos.r, borderWidth: pos.bw, borderStyle: 'solid', borderColor: 'var(--gold-primary)' }}
              />
            ))}



            {/* ── Inline keyframe for scanline drift ── */}

          </motion.div>
        )}
      </AnimatePresence>



      {/* ── MAP ── */}
      <ErrorBoundary name="Map">
        <OverseerMap 
          key={overseerTheme}
          data={data} 
          activeLayers={activeLayers} 
          projection={mapProjection} 
          mapStyle={mapStyle === 'satellite' ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}' : 'dark'} 
          initialView={mapView}
          onEntityClick={handleEntityClick} 
          onMouseCoords={handleMouseCoords} 
          onRightClick={handleRightClick} 
          onViewStateChange={setMapView} 
          flyToLocation={flyToLocation}
          sweepData={sweepData}
          scanTargets={scanTargets}
          theme={overseerTheme}
        />
      </ErrorBoundary>


      {/* ── MAP VIEW CONTROLS (3D/2D + SATELLITE TOGGLE) ── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 3.5 }}
        className="absolute bottom-[75px] md:bottom-[100px] z-[200] flex items-center gap-2 pointer-events-none"
        style={{ left: isMobile ? '12px' : '120px' }}
      >
        {/* 3D/2D Toggle */}
        <button
          data-testid="projection-toggle"
          onClick={() => setMapProjection(p => p === 'globe' ? 'mercator' : 'globe')}
          className="glass-panel p-3.5 pointer-events-auto hover:border-[var(--gold-primary)]/40 transition-colors group relative"
          title={mapProjection === 'globe' ? 'Switch to 2D Map' : 'Switch to 3D Globe'}
        >
          {mapProjection === 'globe' ? (
            <MapPinned className="w-5 h-5 text-[var(--gold-primary)] group-hover:scale-110 transition-transform" />
          ) : (
            <Globe className="w-5 h-5 text-[var(--cyan-primary)] group-hover:scale-110 transition-transform" />
          )}
          <span className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 text-[9px] font-mono text-[var(--text-muted)] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity glass-panel px-2 py-1 z-[300]">
            {mapProjection === 'globe' ? '2D MAP' : '3D GLOBE'}
          </span>
        </button>

        {/* Map Style Toggle */}
        <button
          data-testid="map-style-toggle"
          onClick={() => setMapStyle(s => s === 'dark' ? 'satellite' : 'dark')}
          className="glass-panel p-3.5 pointer-events-auto hover:border-[var(--gold-primary)]/40 transition-colors group relative"
          title={mapStyle === 'dark' ? 'Satellite View' : 'Night View'}
        >
          {mapStyle === 'dark' ? (
            <Satellite className="w-5 h-5 text-[var(--alert-green)] group-hover:scale-110 transition-transform" />
          ) : (
            <Moon className="w-5 h-5 text-[var(--cyan-primary)] group-hover:scale-110 transition-transform" />
          )}
          <span className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 text-[9px] font-mono text-[var(--text-muted)] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity glass-panel px-2 py-1 z-[300]">
            {mapStyle === 'dark' ? 'SATELLITE' : 'NIGHT MODE'}
          </span>
        </button>

        {/* Locate Me */}
        <button
          data-testid="locate-me-button"
          onClick={() => void handleLocateMe()}
          className="glass-panel p-3.5 pointer-events-auto hover:border-[var(--gold-primary)]/40 transition-colors group relative"
          title="Locate me"
        >
          <Crosshair className="w-5 h-5 text-[var(--gold-primary)] group-hover:scale-110 transition-transform" />
          <span className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 text-[9px] font-mono text-[var(--text-muted)] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity glass-panel px-2 py-1 z-[300]">
            LOCATE ME
          </span>
        </button>

      </motion.div>

      {/* ── HEADER ── */}
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1, delay: 2.5 }} className={`absolute top-4 z-[200] pointer-events-none flex flex-col`} style={{ left: isMobile ? '24px' : '96px', right: '24px' }}>
        <div className="flex items-center gap-3 w-fit">
          <div className="flex flex-col items-start gap-0.5">
            <h1 className="text-lg md:text-xl font-bold tracking-[0.4em] text-[#D4AF37] font-mono">OVERSEER</h1>
            <span className="text-[8px] md:text-[9px] font-mono tracking-[0.2em] opacity-80 uppercase text-[#D4AF37]">GLOBAL INTELLIGENCE COMMAND</span>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-1.5 min-w-0 pr-4">
          <span className="text-[5px] md:text-[6px] text-[var(--text-muted)] font-mono tracking-[0.2em] md:tracking-[0.3em] uppercase opacity-40 truncate">
            POWERED BY OVERSEER OPEN SOURCE INTELLIGENCE <span className="hidden md:inline">· C2 ENGINE: PHYSICAL COMMAND CORE · SENSORS: ORBITAL LATTICE · NET: LYCAN NETWORK</span>
          </span>
        </div>
      </motion.div>

      {/* ── TOP-RIGHT STATUS (desktop) — C2 DISPLAY ── */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 3 }} className="status-bar-desktop absolute top-4 right-6 z-[200] pointer-events-none flex items-center gap-4 text-[9px] font-mono tracking-widest text-[var(--text-muted)]">

        <span className="hidden lg:inline-flex items-center gap-1.5">
          <ZuluClock />
        </span>

        <span className="flex items-center gap-1">SYS: <span className={backendStatus === 'connected' ? 'text-[var(--alert-green)]' : 'text-[var(--alert-red)]'}>{backendStatus.toUpperCase()}</span></span>

        {spaceWeather && <span className="hidden lg:inline">SOLAR: <span style={{ color: spaceWeather.storm_color, fontWeight: 700 }}>Kp{spaceWeather.kp_index}</span></span>}

        <span className="hidden lg:inline-flex items-center gap-1">
          <span className="text-[var(--cyan-primary)] font-bold">{Object.values(activeLayers).filter(Boolean).length}</span>
          <span className="text-[var(--text-muted)]/60">FEEDS</span>
        </span>

        <UptimeClock />
        <span className="text-[10px] font-bold tracking-[0.2em] text-[var(--text-muted)] opacity-50 ml-2">V.4.1</span>
        
        <TokenPanel />
      </motion.div>

      {/* ── MOBILE: Compact top status ── */}
      {isMobile && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.5 }} className="absolute top-3 right-3 z-[200] pointer-events-auto flex items-center gap-2">
          <TokenPanel />
        </motion.div>
      )}



      {/* ── NEW SIDEBAR (Root Level) ── */}
      {showLayers && !isMobile && <LayerPanel data={data} activeLayers={activeLayers} setActiveLayers={setActiveLayers} theme={overseerTheme} setTheme={setOverseerTheme} />}



      {/* ── RIGHT TOOL STRIP (desktop only — mobile uses bottom nav) ── */}
      {!isMobile && <div className="absolute right-2 top-1/2 -translate-y-1/2 flex flex-col gap-2 z-[250] pointer-events-auto bg-black/40 backdrop-blur-sm p-1 rounded-full border border-white/5">
        <div className="relative group">
          <button onClick={() => { setShowIntel(!showIntel); setShowMarkets(false); setShowAlerts(false); }} className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${showIntel ? 'bg-[var(--cyan-primary)]/20' : 'hover:bg-white/10'}`}>
            <Radar className={`w-4 h-4 ${showIntel ? 'text-[var(--cyan-primary)]' : 'text-white/60'}`} />
          </button>
          {/* OSINT / Recon Panel Slideout */}
          <AnimatePresence>
            {showIntel && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="absolute right-12 top-1/2 -translate-y-1/2 w-80">
                <OsintPanel theme={overseerTheme} setTheme={setOverseerTheme} onSweepVisualize={setSweepData} onScanGeolocate={(target, data) => {
                  setScanTargets(prev => {
                    const existing = prev.filter(t => t.id !== target);
                    return [{ id: target, timestamp: Date.now(), ...data }, ...existing].slice(0, 10);
                  });
                  setFlyToLocation({ lat: data.lat, lng: data.lng, ts: Date.now() });
                }} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="relative group">
          <button onClick={() => { setShowMarkets(!showMarkets); setShowIntel(false); setShowAlerts(false); }} className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${showMarkets ? 'bg-[var(--gold-primary)]/20' : 'hover:bg-white/10'}`}>
            <BarChart3 className={`w-4 h-4 ${showMarkets ? 'text-[var(--gold-primary)]' : 'text-white/60'}`} />
          </button>
          {/* Markets Panel Slideout */}
          <AnimatePresence>
            {showMarkets && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="absolute right-12 top-1/2 -translate-y-1/2 w-80">
                <MarketsPanel data={data} spaceWeather={spaceWeather} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="relative group">
          <button onClick={() => { setShowAlerts(!showAlerts); setShowIntel(false); setShowMarkets(false); setShowEntityGraph(false); }} className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${showAlerts ? 'bg-[#FF3D3D]/20' : 'hover:bg-white/10'}`}>
            <AlertTriangle className={`w-4 h-4 ${showAlerts ? 'text-[#FF3D3D]' : 'text-white/60'}`} />
          </button>
          {/* Alerts Panel Slideout */}
          <AnimatePresence>
            {showAlerts && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="absolute right-12 top-1/2 -translate-y-1/2 w-80">
                <LiveAlerts data={data} onLocate={(lat, lng) => setFlyToLocation({ lat, lng, ts: Date.now() })} onWatchFeed={(url, name) => { setLiveFeedUrl(url); setLiveFeedName(name); }} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="relative group">
          <button onClick={() => { setShowEntityGraph(!showEntityGraph); setShowIntel(false); setShowMarkets(false); setShowAlerts(false); }} className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${showEntityGraph ? 'bg-[#D4AF37]/20' : 'hover:bg-white/10'}`}>
            <Network className={`w-4 h-4 ${showEntityGraph ? 'text-[var(--gold-primary)]' : 'text-white/60'}`} />
          </button>
        </div>

        <div className="relative group">
          <button
            data-testid="data-sources-button"
            aria-label="Open data sources"
            title="Open data sources"
            onClick={() => { setShowSources(true); setShowEntityGraph(false); setShowIntel(false); setShowMarkets(false); setShowAlerts(false); }}
            className="w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-white/10"
          >
            <Database className="w-4 h-4 text-white/60" />
          </button>
        </div>


      </div>}

      {showSources && (
        <DataSourcesPanel
          onClose={() => setShowSources(false)}
          onRefreshFeed={async (capability: any) => {
            if (capability.id === 'space-weather') {
              try {
                const response = await fetch(capability.apiRoute, { cache: 'no-store' });
                if (!response.ok) return false;
                setSpaceWeather(await response.json());
                return true;
              } catch {
                return false;
              }
            }
            return fetchEndpoint(capability.apiRoute, (payload) => dashboardPatchForCapability(capability.id, payload));
          }}
        />
      )}

      {/* ── LIVE FEED VIEWER OVERLAY ── */}
      <AnimatePresence>
        {liveFeedUrl && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="fixed inset-0 z-[500] flex items-center justify-center bg-black/70 backdrop-blur-sm"
            onClick={() => setLiveFeedUrl(null)}
          >
            <motion.div
              initial={{ y: 20 }}
              animate={{ y: 0 }}
              className="w-[90vw] max-w-[900px] flex flex-col relative rounded-xl overflow-hidden border border-[var(--border-primary)] shadow-2xl bg-black"
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-2.5 bg-[#111] border-b border-[var(--border-primary)]">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[#FF4081] animate-overseer-pulse" />
                  <span className="text-[12px] font-mono font-bold text-white tracking-wider">{liveFeedName}</span>
                  <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 font-mono text-[9px] font-bold">LIVE STREAM</span>
                  {!liveFeedEmbedAllowed && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-mono text-[9px]">EXTERNAL ONLY</span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <a
                    href={getYouTubeWatchUrl(liveFeedUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[var(--border-primary)] hover:bg-[var(--gold-primary)] hover:text-black text-white transition-colors text-[11px] font-mono"
                  >
                    <span>Open in YouTube</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  <button onClick={() => setLiveFeedUrl(null)} className="text-white/70 hover:text-white transition-colors p-1">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Body — iframe or external card */}
              {liveFeedEmbedAllowed ? (
                <div className="w-full aspect-video relative bg-black">
                  <iframe
                    src={liveFeedUrl}
                    className="w-full h-full absolute inset-0"
                    allow="autoplay; encrypted-media"
                    allowFullScreen
                  />
                </div>
              ) : (
                <div className="w-full aspect-video flex items-center justify-center bg-black/95">
                  <div className="text-center px-8">
                    <div className="w-14 h-14 rounded-full bg-[#39FF14]/10 border border-[#39FF14]/20 flex items-center justify-center mx-auto mb-4">
                      <ExternalLink className="w-6 h-6 text-[#39FF14]" />
                    </div>
                    <p className="text-[13px] font-mono font-bold text-white tracking-widest mb-2">EMBED RESTRICTED</p>
                    <p className="text-[11px] font-mono text-white/50 mb-6 max-w-xs">
                      {liveFeedName} does not allow third-party embedding. Click below to open the live stream directly.
                    </p>
                    <a
                      href={getYouTubeWatchUrl(liveFeedUrl)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-6 py-2.5 rounded border border-[#39FF14]/40 text-[#39FF14] font-mono text-[12px] hover:bg-[#39FF14]/10 transition-colors tracking-wider"
                    >
                      <ExternalLink className="w-4 h-4" />
                      OPEN LIVE STREAM
                    </a>
                  </div>
                </div>
              )}

              {/* Footer — only show for embeddable feeds */}
              {liveFeedEmbedAllowed && (
                <div className="bg-[#111]/90 px-4 py-2.5 border-t border-[var(--border-primary)] flex items-center gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-[var(--gold-primary)] shrink-0" />
                  <span className="text-[11px] font-mono text-white/70 leading-relaxed">
                    If you see &ldquo;Video unavailable&rdquo;, use <strong className="text-[var(--gold-primary)]">Open in YouTube</strong> above.
                  </span>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══ MOBILE UI ═══ */}
      {isMobile && (
        <>
          {/* Mobile Bottom Navigation */}
          <div className="mobile-nav">
            <div className="glass-panel mobile-nav-inner">
              {[
                { id: 'layers' as const, icon: Layers, label: 'LAYERS' },
                { id: 'markets' as const, icon: BarChart3, label: 'MARKETS' },
                { id: 'intel' as const, icon: Newspaper, label: 'INTEL' },
                { id: 'recon' as const, icon: Radar, label: 'RECON' },
                { id: 'search' as const, icon: Search, label: 'SEARCH' },
              ].map(tab => (
                <button key={tab.id} onClick={() => setMobilePanel(mobilePanel === tab.id ? null : tab.id)}
                  className={`mobile-nav-btn ${mobilePanel === tab.id ? 'active' : ''}`}>
                  <tab.icon className={`w-4 h-4 ${tab.id === 'recon' ? 'text-[var(--cyan-primary)]' : ''}`} />
                  <span className={tab.id === 'recon' ? 'text-[var(--cyan-primary)]' : ''}>{tab.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Mobile Drawer */}
          <AnimatePresence>
            {mobilePanel && (
              <motion.div
                initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 30, stiffness: 300 }}
                className="fixed bottom-[52px] left-0 right-0 z-[400] glass-panel rounded-b-none overflow-y-auto styled-scrollbar"
                style={{ maxHeight: 'min(55vh, calc(100dvh - 100px))', paddingBottom: 'env(safe-area-inset-bottom, 4px)' }}
              >
                <div className="mobile-drawer-handle" />
                <div className="px-3 pb-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="hud-text text-[9px] text-[var(--text-primary)]">
                      {mobilePanel === 'layers' ? 'LAYERS & STATS' : mobilePanel === 'markets' ? 'MARKETS & INTEL' : mobilePanel === 'intel' ? 'INTEL FEED' : mobilePanel === 'recon' ? 'OVERSEER RECON' : 'SEARCH'}
                    </span>
                    <button onClick={() => setMobilePanel(null)} className="text-[var(--text-muted)] p-1"><X className="w-4 h-4" /></button>
                  </div>
                  {mobilePanel === 'layers' && (
                    <>
                      <div className="glass-panel-sm p-2 mb-2">
                        <div className="grid grid-cols-5 gap-1 text-center">
                          <div><div className="hud-label" style={{fontSize:'6px'}}>AIR</div><div className="hud-value text-[9px]">{totalFlights.toLocaleString()}</div></div>
                          <div><div className="hud-label" style={{fontSize:'6px'}}>SAT</div><div className="hud-value text-[9px]">{(data.satellites?.length||0)}</div></div>
                          <div><div className="hud-label" style={{fontSize:'6px'}}>CAM</div><div className="hud-value text-[9px]">{(data.cameras?.length||0)}</div></div>
                          <div><div className="hud-label" style={{fontSize:'6px'}}>WX</div><div className="hud-value text-[9px]" style={{color:'var(--accent-weather)'}}>{(data.weather_events?.length||0)}</div></div>
                          <div><div className="hud-label" style={{fontSize:'6px'}}>NUC</div><div className="hud-value text-[9px]" style={{color:'var(--accent-nuclear)'}}>{(data.infrastructure?.length||0)}</div></div>
                        </div>
                      </div>
                      <LayerPanel data={data} activeLayers={activeLayers} setActiveLayers={setActiveLayers} isMobile={true} theme={overseerTheme} setTheme={setOverseerTheme} />
                      <div className="mt-8">
                        <ViewPresets onNavigate={(lat, lng, zoom) => { setFlyToLocation({ lat, lng, ts: Date.now() }); setMapView(v => ({ ...v, zoom })); setMobilePanel(null); }} />
                      </div>
                    </>
                  )}
                  {mobilePanel === 'markets' && <MarketsPanel data={data} spaceWeather={spaceWeather} />}
                  {mobilePanel === 'intel' && <IntelFeed data={data} onLocate={(lat, lng) => { setFlyToLocation({ lat, lng, ts: Date.now() }); setMobilePanel(null); }} />}
                  {mobilePanel === 'search' && (
                    <div className="space-y-2">
                      <SearchBar onLocate={(lat, lng) => { setFlyToLocation({ lat, lng, ts: Date.now() }); setMobilePanel(null); }} />
                      <SharePanel mapView={mapView} activeLayers={activeLayers} mouseCoords={null} />
                    </div>
                  )}
                  {mobilePanel === 'recon' && (
                    <div className="space-y-2">
                      <OsintPanel isOpen={true} onClose={() => setMobilePanel(null)} isMobile={true} onSweepVisualize={setSweepData} />
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}

      {/* ── BOTTOM RAW METRICS (desktop) ── */}
      {!isMobile && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 3, duration: 0.8 }} className="desktop-only absolute bottom-8 z-[200] pointer-events-auto" style={{ left: '120px' }}>
          <div className="flex items-center gap-6 text-[8px] font-mono tracking-widest text-[var(--text-muted)] opacity-60">
            <div className="flex gap-2 items-center">
              <span>COORD</span>
              <span ref={coordsDisplayRef} className="text-[var(--gold-primary)] font-bold tabular-nums">—</span>
            </div>
            <div className="flex gap-2 items-center">
              <span>LOC</span>
              <span className="text-[var(--cyan-primary)] truncate max-w-[200px]">{locationLabel || 'HOVER MAP'}</span>
            </div>
            <div className="flex gap-2 items-center">
              <span>Z</span>
              <span className="text-[var(--gold-primary)] font-bold tabular-nums">{mapView.zoom.toFixed(1)}</span>
            </div>
          </div>
        </motion.div>
      )}

      {/* ── Scale Bar (desktop) ── */}
      <div className="desktop-only absolute bottom-[4.5rem] left-[20rem] z-[201] pointer-events-none">
        <ScaleBar zoom={mapView.zoom} latitude={mapView.latitude} />
      </div>

      {/* ── Region Dossier ── */}
      {(regionDossier || dossierLoading) && (
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="absolute top-16 md:top-20 left-2 right-2 md:left-1/2 md:right-auto md:-translate-x-1/2 z-[300] md:w-[480px] max-h-[65vh] overflow-y-auto styled-scrollbar">
          <div className="glass-panel p-5 overseer-glow">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-mono font-bold text-[var(--gold-primary)] tracking-wider">REGION DOSSIER</h2>
              <button onClick={() => { setRegionDossier(null); setDossierLoading(false); }} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xs">✕</button>
            </div>
            {dossierLoading ? (
              <div className="text-center py-8">
                <div className="w-5 h-5 border-2 border-[var(--gold-primary)] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                <span className="text-[8px] font-mono text-[var(--text-muted)] tracking-widest">COMPILING INTEL...</span>
              </div>
            ) : regionDossier && (
              <div className="space-y-3">
                <div><div className="hud-label mb-0.5">LOCATION</div><div className="text-xs text-[var(--text-primary)]">{regionDossier.location?.display_name}</div></div>
                {regionDossier.country && (
                  <div className="grid grid-cols-2 gap-2">
                    <div><div className="hud-label mb-0.5">COUNTRY</div><div className="text-xs text-[var(--text-primary)]">{regionDossier.country.flag} {regionDossier.country.name}</div></div>
                    <div><div className="hud-label mb-0.5">CAPITAL</div><div className="text-xs text-[var(--text-primary)]">{regionDossier.country.capital}</div></div>
                    <div><div className="hud-label mb-0.5">POPULATION</div><div className="text-xs text-[var(--text-primary)]">{regionDossier.country.population?.toLocaleString()}</div></div>
                    <div><div className="hud-label mb-0.5">REGION</div><div className="text-xs text-[var(--text-primary)]">{regionDossier.country.subregion || regionDossier.country.region}</div></div>
                    <div><div className="hud-label mb-0.5">LANGUAGES</div><div className="text-xs text-[var(--text-primary)]">{regionDossier.country.languages?.join(', ')}</div></div>
                    <div><div className="hud-label mb-0.5">AREA</div><div className="text-xs text-[var(--text-primary)]">{regionDossier.country.area?.toLocaleString()} km²</div></div>
                  </div>
                )}
                {regionDossier.head_of_state && (<div><div className="hud-label mb-0.5">HEAD OF STATE</div><div className="text-xs text-[var(--gold-primary)]">{regionDossier.head_of_state.name}</div><div className="text-[8px] text-[var(--text-muted)]">{regionDossier.head_of_state.position}</div></div>)}
                {regionDossier.wikipedia && (<div><div className="hud-label mb-1">INTELLIGENCE BRIEF</div><div className="flex gap-3">{regionDossier.wikipedia.thumbnail && <img src={regionDossier.wikipedia.thumbnail} alt="" className="w-14 h-14 rounded object-cover flex-shrink-0" />}<p className="text-[8px] text-[var(--text-secondary)] leading-relaxed">{regionDossier.wikipedia.extract}</p></div></div>)}
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* ── Camera Viewer ── */}
      <CameraViewer
        camera={activeCamera}
        onClose={() => setActiveCamera(null)}
        onLocate={(lat, lng) => setFlyToLocation({ lat, lng, ts: Date.now() })}
      />

      {/* ── Entity Graph Panel ── */}
      {showEntityGraph && (
        <EntityGraphPanel
          entity={entityGraphTarget}
          onClose={() => setShowEntityGraph(false)}
        />
      )}

      {/* ── OVERLAYS ── */}
      <div className="vignette absolute inset-0 pointer-events-none z-[2]" />
      <div className="crt-scanlines absolute inset-0 pointer-events-none z-[3] opacity-[0.02]" />
      {/* Corner frames — using explicit classes for Tailwind JIT compatibility */}
      {[
        { pos: 'top-0 left-0', vAnchor: 'top-0', hAnchor: 'left-0', hGrad: 'bg-gradient-to-r', vGrad: 'bg-gradient-to-b' },
        { pos: 'top-0 right-0', vAnchor: 'top-0', hAnchor: 'right-0', hGrad: 'bg-gradient-to-l', vGrad: 'bg-gradient-to-b' },
        { pos: 'bottom-0 left-0', vAnchor: 'bottom-0', hAnchor: 'left-0', hGrad: 'bg-gradient-to-r', vGrad: 'bg-gradient-to-t' },
        { pos: 'bottom-0 right-0', vAnchor: 'bottom-0', hAnchor: 'right-0', hGrad: 'bg-gradient-to-l', vGrad: 'bg-gradient-to-t' },
      ].map((c, i) => (
        <div key={i} className={`absolute ${c.pos} w-16 h-16 pointer-events-none z-[1]`}>
          <div className={`absolute ${c.vAnchor} ${c.hAnchor} w-full h-[1px] ${c.hGrad} from-[var(--gold-primary)]/30 to-transparent`} />
          <div className={`absolute ${c.vAnchor} ${c.hAnchor} w-[1px] h-full ${c.vGrad} from-[var(--gold-primary)]/30 to-transparent`} />
        </div>
      ))}

      {/* Keyboard Shortcuts Overlay */}
      <KeyboardShortcuts />

      {/* ── GLOBAL STATUS TICKER (bottom) ── */}
      <GlobalStatusBar />

      {/* Shortcut hint */}
      <div className="desktop-only absolute bottom-[26px] right-5 z-[200] pointer-events-none text-[6px] font-mono text-[var(--text-muted)]/40 tracking-widest">
        [?] SHORTCUTS · [F] FULLSCREEN · [S] SHARE · [R] RESET VIEW
      </div>


    </main>
  );
}
