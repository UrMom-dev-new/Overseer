import type { SourceCollectionStatus } from './feed-integrity';

export type RuntimeMode = 'web' | 'docker' | 'desktop';
export type ConfigurationState = 'keyless' | 'configured' | 'not_configured' | 'optional';

export interface SourceCapability {
  id: string;
  label: string;
  uiSurface: string;
  layerId: string | null;
  apiRoute: string;
  provider: string;
  providerDocs: string;
  credentialEnv: string[];
  runtimeModes: RuntimeMode[];
  expectedResponse: string;
  normalizedContract: string;
  coverage: string;
  refreshPolicy: string;
  timeoutPolicy: string;
  fallback: string | null;
  notes: string;
}

export interface SourceCapabilityStatus extends SourceCapability {
  configuration: ConfigurationState;
  cachedStatus: SourceCollectionStatus | null;
  cachedStatuses: SourceCollectionStatus[];
  configuredFallback: string | null;
  lastAttemptAt: string | null;
  lastSuccessfulFetchAt: string | null;
  acceptedRecords: number;
  rejectedRecords: number;
  activeFallback: string | null;
}

export const SOURCE_CAPABILITIES: SourceCapability[] = [
  {
    id: 'earthquakes',
    label: 'USGS earthquakes',
    uiSurface: 'Map hazard layer, Intel feed, SDK mesh',
    layerId: 'earthquakes',
    apiRoute: '/api/earthquakes',
    provider: 'USGS Earthquake Hazards Program',
    providerDocs: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php',
    credentialEnv: [],
    runtimeModes: ['web', 'docker', 'desktop'],
    expectedResponse: 'GeoJSON FeatureCollection from USGS 2.5_day feed',
    normalizedContract: 'earthquakes[] with lat/lng, magnitude, timing, URL, and integrity metadata',
    coverage: 'Global earthquakes, M2.5+, previous 24 hours',
    refreshPolicy: '15 minutes',
    timeoutPolicy: '10 second upstream timeout',
    fallback: null,
    notes: 'Core keyless first-load source.',
  },
  {
    id: 'news',
    label: 'RSS source reports',
    uiSurface: 'Intel feed and SDK mesh',
    layerId: 'news_intel',
    apiRoute: '/api/news',
    provider: 'Curated RSS/Atom feeds and optional Telegram public previews',
    providerDocs: 'https://www.rssboard.org/rss-specification',
    credentialEnv: ['OVERSEER_TELEGRAM_CHANNELS'],
    runtimeModes: ['web', 'docker', 'desktop'],
    expectedResponse: 'RSS/Atom XML parsed into source reports; Telegram HTML is optional',
    normalizedContract: 'news[] reports with stable IDs, publication time, source, link, and integrity metadata',
    coverage: 'Curated global public-source reporting',
    refreshPolicy: '30 minutes',
    timeoutPolicy: 'Independent bounded provider fetches',
    fallback: 'Last-known-good cache for eligible real records',
    notes: 'Telegram must not block RSS delivery.',
  },
  {
    id: 'weather',
    label: 'NOAA/NWS and NASA EONET events',
    uiSurface: 'Weather map layer and alerts panel',
    layerId: 'weather',
    apiRoute: '/api/weather',
    provider: 'NOAA/NWS Active Alerts, NASA EONET',
    providerDocs: 'https://www.weather.gov/documentation/services-web-api',
    credentialEnv: [],
    runtimeModes: ['web', 'docker', 'desktop'],
    expectedResponse: 'GeoJSON/JSON event payloads',
    normalizedContract: 'weather_events[] with geometry where present, event timing, source status, and integrity metadata',
    coverage: 'US alerts from NWS plus global EONET natural events',
    refreshPolicy: '15 minutes',
    timeoutPolicy: 'Independent provider timeouts',
    fallback: 'Per-provider partial status; successful providers remain visible',
    notes: 'Geometry-free alerts remain list-visible.',
  },
  {
    id: 'fires',
    label: 'NASA FIRMS active fires',
    uiSurface: 'Active fires map layer',
    layerId: 'fires',
    apiRoute: '/api/fires',
    provider: 'NASA FIRMS VIIRS/MODIS and NASA EONET volcanoes',
    providerDocs: 'https://firms.modaps.eosdis.nasa.gov/api/',
    credentialEnv: ['FIRMS_API_KEY'],
    runtimeModes: ['web', 'docker', 'desktop'],
    expectedResponse: 'CSV active-fire detections and EONET JSON events',
    normalizedContract: 'fires[] with exact source coordinates for detections and null unsupported measurements',
    coverage: 'Global active-fire detections where provider access permits',
    refreshPolicy: '15 minutes',
    timeoutPolicy: '12 second upstream timeout per feed',
    fallback: 'MODIS/VIIRS alternate plus EONET volcano reports',
    notes: 'Counts may be sampled for browser performance and are labeled accordingly.',
  },
  {
    id: 'gdelt',
    label: 'GDELT mentions',
    uiSurface: 'GDELT mentions layer and SDK mesh',
    layerId: 'global_incidents',
    apiRoute: '/api/gdelt',
    provider: 'GDELT 2.0 GeoJSON API',
    providerDocs: 'https://blog.gdeltproject.org/gdelt-geo-2-0-api-debuts/',
    credentialEnv: [],
    runtimeModes: ['web', 'docker', 'desktop'],
    expectedResponse: 'GDELT GeoJSON mentions',
    normalizedContract: 'events[] as reports with mentioned-location semantics and stable IDs',
    coverage: 'Global media mentions matching configured queries',
    refreshPolicy: '5 minutes',
    timeoutPolicy: 'Bounded query timeout and last-known-good cache',
    fallback: 'Eligible last-known-good data only; no disaster relabeling',
    notes: 'Provider timeout is degraded, not healthy-empty.',
  },
  {
    id: 'flights',
    label: 'Aircraft tracking',
    uiSurface: 'Aviation map layers and SDK mesh',
    layerId: 'flights',
    apiRoute: '/api/flights',
    provider: 'OpenSky Network, ADSB.lol alternates',
    providerDocs: 'https://openskynetwork.github.io/opensky-api/rest.html',
    credentialEnv: ['OPENSKY_CLIENT_ID', 'OPENSKY_CLIENT_SECRET'],
    runtimeModes: ['web', 'docker', 'desktop'],
    expectedResponse: 'OpenSky state vectors plus ADSB.lol JSON alternates',
    normalizedContract: 'commercial_flights[], private_flights[], private_jets[], military_flights[]',
    coverage: 'Global ADS-B observations subject to provider access and sampling',
    refreshPolicy: '5 minutes when aviation layers are active',
    timeoutPolicy: 'Per-provider bounded timeout',
    fallback: 'ADSB.lol military and LADD feeds for unavailable airplanes.live paths',
    notes: 'Credentials are optional but improve OpenSky access.',
  },
  {
    id: 'satellites',
    label: 'Satellite catalog and propagation',
    uiSurface: 'Satellite map layer',
    layerId: 'satellites',
    apiRoute: '/api/satellites',
    provider: 'SatNOGS DB, CelesTrak',
    providerDocs: 'https://db.satnogs.org/api/',
    credentialEnv: [],
    runtimeModes: ['web', 'docker', 'desktop'],
    expectedResponse: 'TLE records from real catalogs',
    normalizedContract: 'satellites[] with propagated lat/lng, NORAD IDs, source status, and no demo satellite fallback',
    coverage: 'Active catalog objects with valid TLEs',
    refreshPolicy: 'Loaded when satellite layer is active',
    timeoutPolicy: 'Bounded catalog fetch and propagation window',
    fallback: 'CelesTrak active TLE catalog',
    notes: 'Unavailable catalogs produce omitted records, not an ISS substitute.',
  },
  {
    id: 'maritime',
    label: 'Maritime observations and references',
    uiSurface: 'Maritime map layer and SCM panel',
    layerId: 'maritime',
    apiRoute: '/api/maritime',
    provider: 'AIS Stream plus reference port/chokepoint data',
    providerDocs: 'https://aisstream.io/documentation',
    credentialEnv: ['AIS_API_KEY'],
    runtimeModes: ['web', 'docker', 'desktop'],
    expectedResponse: 'AIS WebSocket observations when configured plus reference records',
    normalizedContract: 'maritime_ships[], maritime_ports[], maritime_chokepoints[]',
    coverage: 'Live vessel positions only with AIS_API_KEY; reference port/chokepoint context otherwise',
    refreshPolicy: '60 seconds when maritime layer is active',
    timeoutPolicy: 'Bounded WebSocket sample window',
    fallback: null,
    notes: 'Missing AIS credentials are not an app failure and do not create fake vessel positions.',
  },
  {
    id: 'cctv',
    label: 'Traffic and public camera catalogs',
    uiSurface: 'CCTV map layer and camera viewer',
    layerId: 'cctv',
    apiRoute: '/api/cctv?region=all&v=2',
    provider: 'Regional traffic camera APIs',
    providerDocs: 'https://api.tfl.gov.uk/',
    credentialEnv: [],
    runtimeModes: ['web', 'docker', 'desktop'],
    expectedResponse: 'Provider camera catalog JSON/XML transformed into camera records',
    normalizedContract: 'cameras[] with source, coordinates, image/stream/external URL classification',
    coverage: 'Supported transport agencies and curated real external camera links',
    refreshPolicy: 'Loaded on layer activation',
    timeoutPolicy: 'Per-region bounded timeout',
    fallback: 'Independent regional providers',
    notes: 'Catalog availability is separate from image playback availability.',
  },
  {
    id: 'live-news',
    label: 'Live broadcast links',
    uiSurface: 'Live news map layer and video overlay',
    layerId: 'live_news',
    apiRoute: '/api/live-news',
    provider: 'Curated broadcaster live links',
    providerDocs: 'https://developers.google.com/youtube/player_parameters',
    credentialEnv: [],
    runtimeModes: ['web', 'docker', 'desktop'],
    expectedResponse: 'Curated feed records with embed/external classification',
    normalizedContract: 'feeds[] with source name, coordinates, URL, and embed_allowed flag',
    coverage: 'Selected global broadcasters',
    refreshPolicy: '30 minutes',
    timeoutPolicy: 'Local static/reference response',
    fallback: 'External-open action for embed-restricted broadcasts',
    notes: 'Video is lazy-loaded only after user action.',
  },
  {
    id: 'markets',
    label: 'Markets and crypto',
    uiSurface: 'Markets panel',
    layerId: null,
    apiRoute: '/api/markets',
    provider: 'Yahoo Finance, CoinGecko',
    providerDocs: 'https://www.coingecko.com/en/api/documentation',
    credentialEnv: [],
    runtimeModes: ['web', 'docker', 'desktop'],
    expectedResponse: 'Quote/chart JSON and crypto simple price JSON',
    normalizedContract: 'markets payload with missing quotes omitted and null unknown values',
    coverage: 'Configured symbols and crypto assets',
    refreshPolicy: '15 minutes',
    timeoutPolicy: 'Per-provider bounded timeout',
    fallback: 'CoinGecko fills crypto gaps only',
    notes: 'Missing prices are omitted or null, not estimated.',
  },
  {
    id: 'space-weather',
    label: 'NOAA space weather',
    uiSurface: 'Markets panel solar status',
    layerId: null,
    apiRoute: '/api/space-weather',
    provider: 'NOAA SWPC',
    providerDocs: 'https://www.swpc.noaa.gov/products-and-data',
    credentialEnv: [],
    runtimeModes: ['web', 'docker', 'desktop'],
    expectedResponse: 'SWPC JSON products',
    normalizedContract: 'Kp index, storm level, and alerts with unknowns preserved as null',
    coverage: 'Current NOAA space-weather products',
    refreshPolicy: 'Loaded after first paint and on market panel refresh',
    timeoutPolicy: 'Bounded SWPC fetches',
    fallback: null,
    notes: 'Missing Kp is Unknown, not Quiet.',
  },
  {
    id: 'cyber-threats',
    label: 'Cyber threat intelligence',
    uiSurface: 'Global status and cyber panels',
    layerId: null,
    apiRoute: '/api/cyber-threats',
    provider: 'CISA KEV and vulnerability sources',
    providerDocs: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog',
    credentialEnv: [],
    runtimeModes: ['web', 'docker', 'desktop'],
    expectedResponse: 'CISA KEV JSON plus vulnerability metadata',
    normalizedContract: 'cyber threat payload with source-backed severity only',
    coverage: 'Known exploited vulnerabilities and selected cyber intelligence',
    refreshPolicy: '30 minutes in global status',
    timeoutPolicy: 'Bounded provider timeout',
    fallback: null,
    notes: 'Technical severity remains null unless supplied by a source.',
  },
  {
    id: 'scanner',
    label: 'Optional RECON scanner backend',
    uiSurface: 'RECON toolkit',
    layerId: null,
    apiRoute: '/api/scanner',
    provider: 'Configured scanner backend',
    providerDocs: 'docs and deployment-specific scanner service',
    credentialEnv: ['SCANNER_URL', 'SCANNER_KEY'],
    runtimeModes: ['web', 'docker', 'desktop'],
    expectedResponse: 'Scanner backend JSON for selected scan type',
    normalizedContract: 'Tool-specific scan response or 503 not-configured guidance',
    coverage: 'User-configured targets and backend capabilities',
    refreshPolicy: 'On demand',
    timeoutPolicy: 'Scanner route bounded request timeout',
    fallback: null,
    notes: 'Absent scanner config must not prevent core dashboard launch.',
  },
];

export function getCapability(id: string): SourceCapability | undefined {
  return SOURCE_CAPABILITIES.find((capability) => capability.id === id);
}

export function sourceConfigurationState(capability: SourceCapability, env: Record<string, string | undefined> = process.env): ConfigurationState {
  if (capability.credentialEnv.length === 0) return 'keyless';
  const configured = capability.credentialEnv.every((name) => Boolean(env[name]));
  if (configured) return 'configured';
  if (capability.id === 'news' || capability.id === 'fires' || capability.id === 'flights') return 'optional';
  return 'not_configured';
}

function statusMatchesCapability(capability: SourceCapability, status: SourceCollectionStatus): boolean {
  const providerId = status.source.providerId;
  if (providerId === capability.id || providerId.startsWith(`${capability.id}:`)) return true;
  if (capability.id === 'earthquakes') return providerId === 'usgs-earthquakes';
  if (capability.id === 'weather') return providerId === 'noaa-nws-alerts' || providerId === 'nasa-eonet';
  if (capability.id === 'fires') return providerId.startsWith('nasa-firms') || providerId === 'nasa-eonet';
  if (capability.id === 'cyber-threats') return providerId === 'cisa-kev';
  if (capability.id === 'space-weather') return providerId.startsWith('noaa-swpc');
  if (capability.id === 'gdelt') return providerId.startsWith('gdelt');
  if (capability.id === 'flights') return providerId === 'air-traffic-combined' || providerId === 'opensky-network' || providerId.startsWith('airplanes-live-') || providerId.startsWith('adsb-lol-');
  if (capability.id === 'satellites') return providerId === 'satnogs-tle' || providerId === 'celestrak-active-tle';
  if (capability.id === 'maritime') return providerId === 'aisstream' || providerId === 'overseer-maritime-reference';
  if (capability.id === 'markets') return providerId === 'yahoo-finance' || providerId === 'coingecko';
  return false;
}

function availabilityRank(status: SourceCollectionStatus): number {
  if (status.availability === 'ok' && status.dataState === 'present') return 0;
  if (status.availability === 'ok') return 1;
  if (status.availability === 'partial') return 2;
  if (status.availability === 'rate_limited') return 3;
  if (status.availability === 'not_configured') return 4;
  if (status.servingLastKnownGood) return 5;
  return 6;
}

export function statusesForCapability(capability: SourceCapability, statuses: SourceCollectionStatus[]): SourceCollectionStatus[] {
  return statuses
    .filter((status) => statusMatchesCapability(capability, status))
    .sort((a, b) => availabilityRank(a) - availabilityRank(b));
}

export function statusForCapability(capability: SourceCapability, statuses: SourceCollectionStatus[]): SourceCollectionStatus | null {
  const matches = statusesForCapability(capability, statuses);
  if (matches.length > 0) return matches[0];
  const byRouteOrProvider = statuses.find((status) => {
    const providerId = status.source.providerId;
    return providerId === capability.id || providerId.startsWith(`${capability.id}:`);
  });
  return byRouteOrProvider ?? null;
}
