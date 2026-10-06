'use client';

import { memo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plane, Satellite, Activity, Sun, AlertTriangle, Camera, Flame,
  CloudLightning, Radiation, Tv, Anchor, Ship, Network, Radio, Mountain, Shield,
} from 'lucide-react';
import RansomwarePanel, { useRansomwareFeed } from './RansomwarePanel';

interface LayerPanelProps {
  data: any;
  activeLayers: any;
  setActiveLayers: React.Dispatch<React.SetStateAction<any>>;
  isMobile?: boolean;
  theme?: 'core' | 'ghost';
  setTheme?: (theme: 'core' | 'ghost') => void;
}

const getLayerGroups = (theme: 'core' | 'ghost') => {
  const isGhost = theme === 'ghost';
  const flightCom = isGhost ? '#B388FF' : '#00E5FF';
  const flightPriv = isGhost ? '#CE93D8' : '#FFD700';
  const flightGov = isGhost ? '#D500F9' : '#FF9500';
  return [
    { label: 'SDK', fullLabel: 'OVERSEER SDK', color: '#1565C0', layers: [
      { key: 'sdk_sea', label: 'Maritime Lines', icon: Anchor, color: '#4FC3F7', dataKey: 'sdk_entities' },
      { key: 'sdk_ransomware', label: 'Ransomware Feed', icon: AlertTriangle, color: '#D32F2F', dataKey: 'ransomware_reports' },
    ] },
    { label: 'AVIATION', fullLabel: 'AVIATION', color: flightCom, layers: [
      { key: 'flights', label: 'Commercial', icon: Plane, color: flightCom, dataKey: 'commercial_flights' },
      { key: 'private', label: 'Private', icon: Plane, color: flightPriv, dataKey: 'private_flights' },
      { key: 'jets', label: 'Private Jets', icon: Plane, color: flightGov, dataKey: 'private_jets' },
      { key: 'military', label: 'Military', icon: Shield, color: '#FF0000', dataKey: 'military_flights' },
    ] },
    { label: 'MARITIME', fullLabel: 'MARITIME & SPACE', color: '#26C6DA', layers: [
      { key: 'maritime', label: 'Maritime / Naval', icon: Ship, color: '#26C6DA', dataKey: 'maritime_ships,maritime_ports,maritime_chokepoints' },
      { key: 'satellites', label: 'Satellites', icon: Satellite, color: '#D4AF37', dataKey: 'satellites' },
    ] },
    { label: 'SURVEIL', fullLabel: 'SURVEILLANCE', color: '#7E57C2', layers: [
      { key: 'cctv', label: 'CCTV Cameras', icon: Camera, color: '#7E57C2', dataKey: 'cameras' },
      { key: 'surveillance_capabilities', label: 'Police Capabilities', icon: Shield, color: '#B388FF', dataKey: 'surveillance_locations,surveillance_flight_paths' },
      { key: 'surveillance_industry', label: 'Industry Dossiers', icon: Network, color: '#FF80AB', dataKey: 'surveillance_industry_locations' },
      { key: 'live_news', label: 'Live News Feeds', icon: Tv, color: '#EC407A', dataKey: 'live_feeds' },
    ] },
    { label: 'HAZARD', fullLabel: 'NATURAL HAZARDS', color: '#F9A825', layers: [
      { key: 'earthquakes', label: 'Earthquakes (24h)', icon: Activity, color: '#F9A825', dataKey: 'earthquakes' },
      { key: 'fires', label: 'Active Fires', icon: Flame, color: '#E65100', dataKey: 'fires' },
      { key: 'weather', label: 'Severe Weather', icon: CloudLightning, color: '#7E57C2', dataKey: 'weather_events' },
    ] },
    { label: 'THREAT', fullLabel: 'THREATS & INFRA', color: '#D32F2F', layers: [
      { key: 'infrastructure', label: 'Nuclear Facilities', icon: Radiation, color: '#26A69A', dataKey: 'infrastructure' },
      { key: 'data_centers', label: 'Data Centers', icon: Network, color: '#42A5F5', dataKey: 'data_centers' },
      { key: 'global_incidents', label: 'GDELT Mentions', icon: AlertTriangle, color: '#D32F2F', dataKey: 'gdelt' },
      { key: 'gps_jamming', label: 'GPS Jamming', icon: Radio, color: '#D32F2F', dataKey: 'gps_jamming' },
    ] },
    { label: 'NETWORK', fullLabel: 'NETWORK INTEL', color: '#D32F2F', layers: [
      { key: 'malware', label: 'Live Malware', icon: AlertTriangle, color: '#D32F2F', dataKey: 'malware_threats' },
    ] },
    { label: 'DISPLAY', fullLabel: 'DISPLAY', color: '#448AFF', layers: [
      { key: 'day_night', label: 'Day / Night Cycle', icon: Sun, color: '#448AFF', dataKey: '' },
      { key: 'terrain_3d', label: '3D Terrain & Buildings', icon: Mountain, color: '#8D6E63', dataKey: '' },
    ] },
  ];
};

type Layer = ReturnType<typeof getLayerGroups>[number]['layers'][number];

function LayerPanel({ data, activeLayers, setActiveLayers, isMobile, theme = 'core', setTheme }: LayerPanelProps) {
  const [hoveredGroup, setHoveredGroup] = useState<string | null>(null);
  // This opens a non-geographic report view; it deliberately does not enable the SDK's generic CYBER map layer.
  const [ransomwareOpen, setRansomwareOpen] = useState(false);
  const ransomware = useRansomwareFeed(ransomwareOpen);
  const groups = getLayerGroups(theme);
  const isActive = (key: string) => key === 'sdk_ransomware' ? ransomwareOpen : Boolean(activeLayers[key]);
  const toggle = (key: string) => {
    if (key === 'sdk_ransomware') setRansomwareOpen((previous) => !previous);
    else setActiveLayers((previous: any) => ({ ...previous, [key]: !previous[key] }));
  };
  const getCount = (key: string): number | null => {
    if (key === 'ransomware_reports') return ransomware.count;
    if (!key) return null;
    const arrays = key.split(',').map((name) => data[name]).filter(Array.isArray);
    return arrays.length ? arrays.reduce((total: number, records: unknown[]) => total + records.length, 0) : null;
  };
  const statusForLayer = (key: string) => {
    if (key === 'sdk_ransomware') return ransomware.healthLabel;
    const map: Record<string, string> = { global_incidents: 'gdelt', news_intel: 'news', live_news: 'live_news' };
    const status = data.feedStatus?.[map[key] || key];
    if (!status) return null;
    const freshness = status.freshness && status.freshness !== 'unknown' ? `/${status.freshness}` : '';
    return `${status.availability || 'unknown'}${freshness}${status.servingLastKnownGood ? '/last good' : ''}`;
  };

  // One handler for both layouts prevents the desktop/mobile behavior from drifting apart.
  const layerButton = (layer: Layer) => {
    const active = isActive(layer.key);
    const count = getCount(layer.dataKey);
    const status = statusForLayer(layer.key);
    return (
      <button type="button" data-testid={`layer-toggle-${layer.key}`} key={layer.key}
        aria-pressed={active} aria-haspopup={layer.key === 'sdk_ransomware' ? 'dialog' : undefined}
        onClick={() => toggle(layer.key)}
        className={`w-full flex flex-wrap items-center gap-2 px-2 py-2 rounded transition-colors group ${isMobile ? 'border border-white/10' : ''} ${active ? 'bg-white/10' : 'bg-transparent hover:bg-white/5'}`}>
        <span className={`w-2 h-2 rounded-full border shrink-0 transition-all ${active ? 'bg-current border-current' : 'bg-transparent border-white/30'}`}
          style={{ color: active ? layer.color : 'inherit', boxShadow: active ? `0 0 8px ${layer.color}` : 'none' }} />
        <span className={`font-mono uppercase tracking-wider flex-1 text-left ${isMobile ? 'text-[9px]' : 'text-[11px]'} ${active ? 'text-white' : 'text-white/60'}`}>{layer.label}</span>
        {count !== null && <span className="text-[9px] font-mono tabular-nums opacity-60">{count.toLocaleString()}</span>}
        {(active || layer.key === 'sdk_ransomware') && status && <span className="w-full text-left text-[8px] font-mono uppercase opacity-60 break-words">{status}</span>}
      </button>
    );
  };

  const themeToggle = setTheme && (
    <div className={`${isMobile ? 'flex justify-between px-2' : 'flex flex-col items-center gap-3 px-2'} mt-auto pt-6 pb-2 border-t border-[var(--border-primary)]`}>
      <span className="text-[9px] font-mono tracking-widest text-[var(--text-secondary)]">{isMobile ? 'GHOST MODE' : 'GHOST PROTOCOL'}</span>
      <button type="button" onClick={() => setTheme(theme === 'core' ? 'ghost' : 'core')} aria-label="Toggle ghost theme" aria-pressed={theme === 'ghost'}
        className="relative w-14 h-7 rounded-full border border-white/20 flex items-center px-1"
        style={{ backgroundColor: theme === 'ghost' ? 'rgba(179,136,255,0.15)' : 'rgba(0,0,0,0.4)' }}>
        <motion.span layout className="w-5 h-5 rounded-full" style={{ backgroundColor: theme === 'ghost' ? '#B388FF' : 'rgba(255,255,255,0.4)' }}
          animate={{ x: theme === 'ghost' ? 28 : 0 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }} />
      </button>
    </div>
  );

  return <>
    <RansomwarePanel open={ransomwareOpen} onClose={() => setRansomwareOpen(false)} feed={ransomware} />
    {isMobile ? <div className="flex flex-col gap-4 py-2">{groups.map((group) => <div key={group.label} className="flex flex-col gap-2">
      <div className="text-[10px] font-bold font-mono tracking-widest border-b border-white/10 pb-1" style={{ color: group.color }}>{group.fullLabel}</div>
      <div className="grid grid-cols-2 gap-2">{group.layers.map(layerButton)}</div>
    </div>)}{themeToggle}</div> :
      <motion.div data-testid="layer-panel" initial={{ x: -100, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="absolute top-0 left-0 h-full w-[80px] border-r border-[var(--border-primary)] flex flex-col pt-32 pb-8 z-50 pointer-events-auto bg-[var(--bg-panel)] backdrop-blur-[24px] saturate-150"
        style={{ boxShadow: '4px 0 24px rgba(0,0,0,0.5)' }}>
        <div className="flex-1 flex flex-col gap-8 px-2">{groups.map((group) => {
          const active = group.layers.some((layer) => isActive(layer.key));
          const hovered = hoveredGroup === group.label;
          return <div data-testid={`layer-group-${group.label.toLowerCase()}`} key={group.label} tabIndex={0}
            className="relative flex justify-center items-center" onMouseEnter={() => setHoveredGroup(group.label)} onMouseLeave={() => setHoveredGroup(null)}
            onFocus={() => setHoveredGroup(group.label)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHoveredGroup(null); }}>
            <div className="text-[10px] font-mono font-bold cursor-pointer select-none transition-all duration-300 flex items-center justify-center"
              style={{ color: active ? group.color : 'rgba(255,255,255,0.4)', textShadow: active ? `0 0 10px ${group.color}80` : 'none', letterSpacing: '0.1em', opacity: active || hovered ? 1 : 0.5 }}>
              {active && <span className="absolute -left-1 w-1 h-1 rounded-full animate-pulse" style={{ backgroundColor: group.color }} />}{group.label}
            </div>
            <AnimatePresence>{hovered && <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -5 }} transition={{ duration: 0.2 }}
              className="absolute left-[70px] top-1/2 -translate-y-1/2 min-w-[260px] bg-black/90 backdrop-blur-md border border-white/10 rounded-lg p-3 shadow-2xl z-50 pointer-events-auto">
              <div className="text-[11px] font-bold font-mono mb-3 tracking-widest border-b border-white/10 pb-2" style={{ color: group.color }}>{group.fullLabel}</div>
              <div className="flex flex-col gap-1">{group.layers.map(layerButton)}</div>
            </motion.div>}</AnimatePresence>
          </div>;
        })}</div>{themeToggle}
      </motion.div>}
  </>;
}

export default memo(LayerPanel);
