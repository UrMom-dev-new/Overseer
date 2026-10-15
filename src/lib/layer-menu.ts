export type OverseerTheme = 'core' | 'ghost';

const defaultActiveLayers = {
  flights: false,
  private: false,
  jets: false,
  military: false,
  maritime: true,
  satellites: false,
  gnss: false,
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
  infra_power: false,
  infra_water: false,
  infra_wastewater: false,
  infra_medical: false,
  infra_telecom: false,
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

export type ActiveLayerKey = keyof typeof defaultActiveLayers;
export const DEFAULT_ACTIVE_LAYERS: Record<ActiveLayerKey, boolean> = defaultActiveLayers;

export type LayerIconId =
  | 'activity'
  | 'alert-triangle'
  | 'anchor'
  | 'camera'
  | 'cloud-lightning'
  | 'database'
  | 'flame'
  | 'mountain'
  | 'network'
  | 'newspaper'
  | 'plane'
  | 'radiation'
  | 'radio'
  | 'satellite'
  | 'shield'
  | 'ship'
  | 'sun'
  | 'tv';

export type LayerMenuKey = ActiveLayerKey | 'sdk_ransomware' | 'infra_sources';

export interface LayerMenuLayer {
  key: LayerMenuKey;
  label: string;
  icon: LayerIconId;
  color: string;
  dataKey: string;
}

export interface LayerMenuGroup {
  label: string;
  fullLabel: string;
  color: string;
  layers: LayerMenuLayer[];
}

export function getLayerGroups(theme: OverseerTheme): LayerMenuGroup[] {
  const isGhost = theme === 'ghost';
  const flightCom = isGhost ? '#B388FF' : '#00E5FF';
  const flightPriv = isGhost ? '#CE93D8' : '#FFD700';
  const flightGov = isGhost ? '#D500F9' : '#FF9500';

  return [
    { label: 'SDK', fullLabel: 'OVERSEER SDK', color: '#1565C0', layers: [
      { key: 'sdk_sea', label: 'Sea Mesh', icon: 'anchor', color: '#4FC3F7', dataKey: 'sdk_entities' },
      { key: 'sdk_air', label: 'Air Mesh', icon: 'plane', color: flightCom, dataKey: 'sdk_entities' },
      { key: 'sdk_naval', label: 'Intel Mesh', icon: 'network', color: '#B388FF', dataKey: 'sdk_entities' },
    ] },
    { label: 'AIR', fullLabel: 'AVIATION', color: flightCom, layers: [
      { key: 'flights', label: 'Commercial', icon: 'plane', color: flightCom, dataKey: 'commercial_flights' },
      { key: 'private', label: 'Private', icon: 'plane', color: flightPriv, dataKey: 'private_flights' },
      { key: 'jets', label: 'Private Jets', icon: 'plane', color: flightGov, dataKey: 'private_jets' },
      { key: 'military', label: 'Military', icon: 'shield', color: '#FF0000', dataKey: 'military_flights' },
    ] },
    { label: 'SPACE', fullLabel: 'SPACE & ORBITAL', color: '#D4AF37', layers: [
      { key: 'satellites', label: 'Satellite Tracking', icon: 'satellite', color: '#D4AF37', dataKey: 'satellites' },
      { key: 'gnss', label: 'GPS / GNSS', icon: 'satellite', color: '#448AFF', dataKey: 'gnss_satellites' },
    ] },
    { label: 'SEA', fullLabel: 'MARITIME', color: '#26C6DA', layers: [
      { key: 'maritime', label: 'Maritime / Naval', icon: 'ship', color: '#26C6DA', dataKey: 'maritime_ships,maritime_ports,maritime_chokepoints' },
    ] },
    { label: 'SURVEIL', fullLabel: 'SURVEILLANCE', color: '#7E57C2', layers: [
      { key: 'cctv', label: 'CCTV Cameras', icon: 'camera', color: '#7E57C2', dataKey: 'cameras' },
      { key: 'surveillance_capabilities', label: 'Police Capabilities', icon: 'shield', color: '#B388FF', dataKey: 'surveillance_locations,surveillance_flight_paths' },
      { key: 'surveillance_industry', label: 'Industry Dossiers', icon: 'network', color: '#FF80AB', dataKey: 'surveillance_industry_locations' },
    ] },
    { label: 'INTEL', fullLabel: 'MEDIA & INTEL REPORTS', color: '#EC407A', layers: [
      { key: 'live_news', label: 'Live News Feeds', icon: 'tv', color: '#EC407A', dataKey: 'live_feeds' },
      { key: 'news_intel', label: 'Source Reports', icon: 'newspaper', color: '#00E5FF', dataKey: 'news' },
      { key: 'global_incidents', label: 'GDELT Mentions', icon: 'alert-triangle', color: '#D32F2F', dataKey: 'gdelt' },
    ] },
    { label: 'HAZARD', fullLabel: 'NATURAL HAZARDS', color: '#F9A825', layers: [
      { key: 'earthquakes', label: 'Earthquakes (24h)', icon: 'activity', color: '#F9A825', dataKey: 'earthquakes' },
      { key: 'fires', label: 'Active Fires', icon: 'flame', color: '#E65100', dataKey: 'fires' },
      { key: 'weather', label: 'Severe Weather', icon: 'cloud-lightning', color: '#7E57C2', dataKey: 'weather_events' },
    ] },
    { label: 'INFRA', fullLabel: 'INFRASTRUCTURE', color: '#42A5F5', layers: [
      { key: 'infrastructure', label: 'Nuclear Facilities', icon: 'radiation', color: '#26A69A', dataKey: 'infrastructure' },
      { key: 'data_centers', label: 'Data Centers', icon: 'database', color: '#42A5F5', dataKey: 'data_centers' },
      { key: 'infra_power', label: 'Power Networks', icon: 'activity', color: '#FFD54F', dataKey: 'infra_power' },
      { key: 'infra_water', label: 'Water Systems', icon: 'activity', color: '#29B6F6', dataKey: 'infra_water' },
      { key: 'infra_wastewater', label: 'Wastewater', icon: 'activity', color: '#66BB6A', dataKey: 'infra_wastewater' },
      { key: 'infra_medical', label: 'Health Facilities', icon: 'activity', color: '#EF5350', dataKey: 'infra_medical' },
      { key: 'infra_telecom', label: 'Telecommunications', icon: 'radio', color: '#AB47BC', dataKey: 'infra_telecom' },
      { key: 'infra_sources', label: 'Source Catalog', icon: 'database', color: '#90A4AE', dataKey: '' },
      { key: 'gps_jamming', label: 'GPS Jamming', icon: 'radio', color: '#D32F2F', dataKey: 'gps_jamming' },
    ] },
    { label: 'CYBER', fullLabel: 'CYBER THREATS', color: '#D32F2F', layers: [
      { key: 'malware', label: 'Live Malware', icon: 'alert-triangle', color: '#D32F2F', dataKey: 'malware_threats' },
      { key: 'sdk_ransomware', label: 'Ransomware Feed', icon: 'alert-triangle', color: '#D32F2F', dataKey: 'ransomware_reports' },
    ] },
    { label: 'DISPLAY', fullLabel: 'DISPLAY', color: '#448AFF', layers: [
      { key: 'day_night', label: 'Day / Night Cycle', icon: 'sun', color: '#448AFF', dataKey: '' },
      { key: 'terrain_3d', label: '3D Terrain & Buildings', icon: 'mountain', color: '#8D6E63', dataKey: '' },
    ] },
  ];
}

export function layerMenuEntries(theme: OverseerTheme = 'core'): LayerMenuLayer[] {
  return getLayerGroups(theme).flatMap((group) => group.layers);
}

export function layerMenuGroupForKey(key: LayerMenuKey, theme: OverseerTheme = 'core'): LayerMenuGroup | null {
  return getLayerGroups(theme).find((group) => group.layers.some((layer) => layer.key === key)) ?? null;
}
