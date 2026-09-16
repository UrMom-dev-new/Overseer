export interface ScmSupplier {
  id: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
  category: string;
}

export interface ScmSupplierResult extends ScmSupplier {
  risk_level: string | null;
  active_threats: string[];
  exposure_indicators: Array<{
    source: string;
    evidence_kind: string;
    label: string;
    count: number;
    methodology: string;
  }>;
}

export interface ScmSourceStatus {
  source: string;
  availability: 'ok' | 'error';
  dataState: 'present' | 'empty' | 'unavailable';
  message: string;
}

export interface ScmSourceCollection {
  source: string;
  availability: 'ok' | 'error';
  dataState: 'present' | 'empty' | 'unavailable';
  message: string;
  records: unknown[];
}

export interface ScmCollectors {
  earthquakes: () => Promise<ScmSourceCollection>;
  fires: () => Promise<ScmSourceCollection>;
  gdelt: () => Promise<ScmSourceCollection>;
}

export const SCM_SUPPLIERS: ScmSupplier[] = [
  { id: 'sup-tsmc-hsinchu', name: 'TSMC Fab 12 (Tier 1)', city: 'Hsinchu', country: 'Taiwan', lat: 24.774, lng: 120.992, category: 'Semiconductor' },
  { id: 'sup-tsmc-tainan', name: 'TSMC Fab 14 (Tier 1)', city: 'Tainan', country: 'Taiwan', lat: 23.111, lng: 120.273, category: 'Semiconductor' },
  { id: 'sup-sec-giheung', name: 'Samsung Electronics (Tier 1)', city: 'Giheung', country: 'South Korea', lat: 37.221, lng: 127.098, category: 'Semiconductor' },
  { id: 'sup-sk-icheon', name: 'SK Hynix (Tier 1)', city: 'Icheon', country: 'South Korea', lat: 37.256, lng: 127.483, category: 'Semiconductor' },
  { id: 'sup-sony-kumamoto', name: 'Sony Semiconductor (Tier 2)', city: 'Kikuyo', country: 'Japan', lat: 32.883, lng: 130.825, category: 'Electronics' },
  { id: 'sup-mlcc-murata', name: 'Murata MLCC (Tier 2)', city: 'Izumo', country: 'Japan', lat: 35.361, lng: 132.756, category: 'Electronics' },
  { id: 'sup-bosch-stuttgart', name: 'Bosch Auto Parts (Tier 1)', city: 'Stuttgart', country: 'Germany', lat: 48.815, lng: 9.176, category: 'Automotive' },
  { id: 'sup-zf-bavaria', name: 'ZF Friedrichshafen (Tier 1)', city: 'Friedrichshafen', country: 'Germany', lat: 47.662, lng: 9.489, category: 'Automotive' },
  { id: 'sup-valeo-paris', name: 'Valeo R&D (Tier 2)', city: 'Paris', country: 'France', lat: 48.878, lng: 2.308, category: 'Automotive' },
  { id: 'sup-magna-celaya', name: 'Magna Assembly (Tier 2)', city: 'Celaya', country: 'Mexico', lat: 20.525, lng: -100.814, category: 'Automotive' },
  { id: 'sup-denso-monterrey', name: 'Denso Corp (Tier 1)', city: 'Monterrey', country: 'Mexico', lat: 25.772, lng: -100.174, category: 'Automotive' },
  { id: 'sup-catl-ningde', name: 'CATL Battery HQ (Tier 1)', city: 'Ningde', country: 'China', lat: 26.666, lng: 119.544, category: 'Battery' },
  { id: 'sup-byd-shenzhen', name: 'BYD Gigafactory (Tier 1)', city: 'Shenzhen', country: 'China', lat: 22.684, lng: 114.341, category: 'Battery' },
  { id: 'sup-panasonic-nevada', name: 'Panasonic Giga (Tier 1)', city: 'Sparks', country: 'US', lat: 39.539, lng: -119.439, category: 'Battery' },
];

export async function buildScmSupplierOverlay(collectors: ScmCollectors, collectedAt = new Date().toISOString()) {
  const suppliers = SCM_SUPPLIERS.map((supplier) => ({
    ...supplier,
    risk_level: null,
    active_threats: [],
    exposure_indicators: [],
  })) as ScmSupplierResult[];

  const [earthquakes, fires, gdelt] = await Promise.all([
    collectSafely('USGS earthquakes', collectors.earthquakes),
    collectSafely('Fire/thermal detections', collectors.fires),
    collectSafely('GDELT geolocated news mentions', collectors.gdelt),
  ]);
  const source_status = [earthquakes, fires, gdelt].map((result) => ({
    source: result.source,
    availability: result.availability,
    dataState: result.dataState,
    message: result.message,
  }));

  applyEarthquakes(suppliers, earthquakes.records);
  applyFires(suppliers, fires.records);
  applyGdelt(suppliers, gdelt.records);

  const suppliersWithIndicators = suppliers.filter((supplier) => supplier.exposure_indicators.length > 0);
  return {
    suppliers,
    total: suppliers.length,
    suppliers_with_indicators: suppliersWithIndicators.length,
    critical_count: null,
    risk_assessment_state: 'not_assessed',
    source_status,
    message: 'SCM route emits source-backed proximity indicators only. Missing incident streams are unavailable, not zero risk.',
    timestamp: collectedAt,
  };
}

async function collectSafely(source: string, collect: () => Promise<ScmSourceCollection>): Promise<ScmSourceCollection> {
  try {
    return await collect();
  } catch (error) {
    return {
      source,
      availability: 'error',
      dataState: 'unavailable',
      message: error instanceof Error ? error.message : 'Collection error; stream omitted.',
      records: [],
    };
  }
}

function applyEarthquakes(suppliers: ScmSupplierResult[], records: unknown[]): void {
  for (const supplier of suppliers) {
    const nearby = records.filter((record) => {
      const lat = numberField(record, 'lat');
      const lng = numberField(record, 'lng');
      return lat !== null && lng !== null && getDistanceKm(supplier.lat, supplier.lng, lat, lng) < 150;
    });
    if (nearby.length === 0) continue;
    const magnitudes = nearby
      .map((record) => numberField(record, 'magnitude'))
      .filter((value): value is number => value !== null);
    const maxMagnitude = magnitudes.length > 0 ? Math.max(...magnitudes) : null;
    supplier.active_threats.push(maxMagnitude === null
      ? `USGS earthquake proximity (${nearby.length} records)`
      : `USGS earthquake proximity (M${maxMagnitude.toFixed(1)} max)`);
    supplier.exposure_indicators.push({
      source: 'USGS',
      evidence_kind: 'observation',
      label: 'earthquake_proximity',
      count: nearby.length,
      methodology: 'Observed USGS earthquake within 150 km of supplier reference point.',
    });
  }
}

function applyFires(suppliers: ScmSupplierResult[], records: unknown[]): void {
  for (const supplier of suppliers) {
    const nearby = records.filter((record) => {
      const lat = numberField(record, 'lat');
      const lng = numberField(record, 'lng');
      return lat !== null && lng !== null && getDistanceKm(supplier.lat, supplier.lng, lat, lng) < 50;
    });
    if (nearby.length === 0) continue;
    supplier.active_threats.push(`Thermal detection proximity (${nearby.length} records)`);
    supplier.exposure_indicators.push({
      source: 'FIRMS/EONET via local fires route',
      evidence_kind: 'observation',
      label: 'thermal_detection_proximity',
      count: nearby.length,
      methodology: 'Fire/thermal-detection record within 50 km of supplier reference point. This is not a verified facility impact assessment.',
    });
  }
}

function applyGdelt(suppliers: ScmSupplierResult[], records: unknown[]): void {
  for (const supplier of suppliers) {
    const nearby = records.filter((record) => {
      const lat = numberField(record, 'lat');
      const lng = numberField(record, 'lng');
      return lat !== null && lng !== null && getDistanceKm(supplier.lat, supplier.lng, lat, lng) < 100;
    });
    if (nearby.length === 0) continue;
    supplier.active_threats.push(`GDELT news mention proximity (${nearby.length} mentions)`);
    supplier.exposure_indicators.push({
      source: 'GDELT GEO',
      evidence_kind: 'report',
      label: 'news_mention_proximity',
      count: nearby.length,
      methodology: 'GDELT geolocated news mention within 100 km of supplier reference point. Mention coordinates are not verified event or facility-impact coordinates.',
    });
  }
}

function getDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dx = (lng1 - lng2) * Math.cos((lat1 + lat2) / 2 * Math.PI / 180);
  const dy = lat1 - lat2;
  return Math.sqrt(dx * dx + dy * dy) * 111.32;
}

function numberField(value: unknown, key: string): number | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  return typeof record[key] === 'number' && Number.isFinite(record[key]) ? record[key] : null;
}
