import { NextResponse } from 'next/server';

/**
 * OVERSEER — SCM Supplier Risk Overlay
 * Reports source-backed exposure indicators near static supplier reference points.
 * Missing streams are omitted and do not create NORMAL/CRITICAL defaults.
 */

const SUPPLIERS = [
  // Semiconductor & Electronics (Taiwan, Korea, Japan)
  { id: 'sup-tsmc-hsinchu', name: 'TSMC Fab 12 (Tier 1)', city: 'Hsinchu', country: 'Taiwan', lat: 24.774, lng: 120.992, category: 'Semiconductor' },
  { id: 'sup-tsmc-tainan', name: 'TSMC Fab 14 (Tier 1)', city: 'Tainan', country: 'Taiwan', lat: 23.111, lng: 120.273, category: 'Semiconductor' },
  { id: 'sup-sec-giheung', name: 'Samsung Electronics (Tier 1)', city: 'Giheung', country: 'South Korea', lat: 37.221, lng: 127.098, category: 'Semiconductor' },
  { id: 'sup-sk-icheon', name: 'SK Hynix (Tier 1)', city: 'Icheon', country: 'South Korea', lat: 37.256, lng: 127.483, category: 'Semiconductor' },
  { id: 'sup-sony-kumamoto', name: 'Sony Semiconductor (Tier 2)', city: 'Kikuyo', country: 'Japan', lat: 32.883, lng: 130.825, category: 'Electronics' },
  { id: 'sup-mlcc-murata', name: 'Murata MLCC (Tier 2)', city: 'Izumo', country: 'Japan', lat: 35.361, lng: 132.756, category: 'Electronics' },
  
  // Automotive & Machinery (Europe, Mexico)
  { id: 'sup-bosch-stuttgart', name: 'Bosch Auto Parts (Tier 1)', city: 'Stuttgart', country: 'Germany', lat: 48.815, lng: 9.176, category: 'Automotive' },
  { id: 'sup-zf-bavaria', name: 'ZF Friedrichshafen (Tier 1)', city: 'Friedrichshafen', country: 'Germany', lat: 47.662, lng: 9.489, category: 'Automotive' },
  { id: 'sup-valeo-paris', name: 'Valeo R&D (Tier 2)', city: 'Paris', country: 'France', lat: 48.878, lng: 2.308, category: 'Automotive' },
  { id: 'sup-magna-celaya', name: 'Magna Assembly (Tier 2)', city: 'Celaya', country: 'Mexico', lat: 20.525, lng: -100.814, category: 'Automotive' },
  { id: 'sup-denso-monterrey', name: 'Denso Corp (Tier 1)', city: 'Monterrey', country: 'Mexico', lat: 25.772, lng: -100.174, category: 'Automotive' },

  // Battery & Energy (China, US)
  { id: 'sup-catl-ningde', name: 'CATL Battery HQ (Tier 1)', city: 'Ningde', country: 'China', lat: 26.666, lng: 119.544, category: 'Battery' },
  { id: 'sup-byd-shenzhen', name: 'BYD Gigafactory (Tier 1)', city: 'Shenzhen', country: 'China', lat: 22.684, lng: 114.341, category: 'Battery' },
  { id: 'sup-panasonic-nevada', name: 'Panasonic Giga (Tier 1)', city: 'Sparks', country: 'US', lat: 39.539, lng: -119.439, category: 'Battery' },
];

export async function GET() {
  const dynamicSuppliers = [...SUPPLIERS].map(s => ({
    ...s,
    risk_level: null as string | null,
    active_threats: [] as string[],
    exposure_indicators: [] as Array<{ source: string; evidence_kind: string; label: string; count: number; methodology: string }>,
  }));
  const source_status: Array<{ source: string; availability: 'ok' | 'error'; dataState: 'present' | 'empty' | 'unavailable'; message: string }> = [];

  // Fast distance approximation (km)
  const getDistanceKm = (lat1: number, lng1: number, lat2: number, lng2: number) => {
    const dx = (lng1 - lng2) * Math.cos((lat1 + lat2) / 2 * Math.PI / 180);
    const dy = lat1 - lat2;
    return Math.sqrt(dx * dx + dy * dy) * 111.32;
  };

  try {
    // 1. Fetch Earthquakes
    const eqRes = await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson', { signal: AbortSignal.timeout(5000) });
    if (eqRes.ok) {
      const eqData = await eqRes.json();
      const earthquakes = eqData.features || [];
      source_status.push({ source: 'USGS M4.5+ day GeoJSON', availability: 'ok', dataState: earthquakes.length > 0 ? 'present' : 'empty', message: 'USGS earthquake observations returned.' });
      dynamicSuppliers.forEach(sup => {
        const nearbyEq = earthquakes.filter((eq: any) => {
          const [lng, lat] = eq.geometry.coordinates;
          return getDistanceKm(sup.lat, sup.lng, lat, lng) < 150; // 150km impact zone
        });
        if (nearbyEq.length > 0) {
          const maxMag = Math.max(...nearbyEq.map((eq: any) => eq.properties.mag));
          sup.active_threats.push(`USGS earthquake proximity (M${maxMag.toFixed(1)} max)`);
          sup.exposure_indicators.push({
            source: 'USGS',
            evidence_kind: 'observation',
            label: 'earthquake_proximity',
            count: nearbyEq.length,
            methodology: 'Observed USGS M4.5+ earthquake within 150 km of supplier reference point.',
          });
        }
      });
    } else {
      source_status.push({ source: 'USGS M4.5+ day GeoJSON', availability: 'error', dataState: 'unavailable', message: `HTTP ${eqRes.status}; earthquake stream omitted.` });
    }

    // 2. Fetch Active Fires from local route only if that route has real provider data.
    const fireRes = await fetch('http://127.0.0.1:3000/api/fires', { signal: AbortSignal.timeout(5000) });
    if (fireRes.ok) {
      const fireData = await fireRes.json();
      const fires = fireData.data || [];
      source_status.push({ source: 'Local /api/fires real provider output', availability: 'ok', dataState: fires.length > 0 ? 'present' : 'empty', message: 'Fire/thermal-detection records returned from local route.' });
      dynamicSuppliers.forEach(sup => {
        const nearbyFires = fires.filter((f: any) => getDistanceKm(sup.lat, sup.lng, f.lat, f.lng) < 50); // 50km fire zone
        if (nearbyFires.length > 0) {
          sup.active_threats.push(`Thermal detection proximity (${nearbyFires.length} records)`);
          sup.exposure_indicators.push({
            source: 'FIRMS/EONET via local fires route',
            evidence_kind: 'observation',
            label: 'thermal_detection_proximity',
            count: nearbyFires.length,
            methodology: 'Fire/thermal-detection record within 50 km of supplier reference point. This is not a verified facility impact assessment.',
          });
        }
      });
    } else {
      source_status.push({ source: 'Local /api/fires real provider output', availability: 'error', dataState: 'unavailable', message: `HTTP ${fireRes.status}; fire stream omitted.` });
    }

    // 3. Fetch GDELT geolocated news mentions. These are reports, not confirmed conflict events.
    const gdeltRes = await fetch('http://127.0.0.1:3000/api/gdelt', { signal: AbortSignal.timeout(5000) });
    if (gdeltRes.ok) {
      const gdeltData = await gdeltRes.json();
      const conflicts = gdeltData.events || [];
      source_status.push({ source: 'Local /api/gdelt geolocated news mentions', availability: 'ok', dataState: conflicts.length > 0 ? 'present' : 'empty', message: 'GDELT mention records returned from local route.' });
      dynamicSuppliers.forEach(sup => {
        const nearbyConflicts = conflicts.filter((c: any) => getDistanceKm(sup.lat, sup.lng, c.lat, c.lng) < 100);
        if (nearbyConflicts.length > 0) {
          sup.active_threats.push(`GDELT news mention proximity (${nearbyConflicts.length} mentions)`);
          sup.exposure_indicators.push({
            source: 'GDELT GEO',
            evidence_kind: 'report',
            label: 'news_mention_proximity',
            count: nearbyConflicts.length,
            methodology: 'GDELT geolocated news mention within 100 km of supplier reference point. Mention coordinates are not verified event or facility-impact coordinates.',
          });
        }
      });
    } else {
      source_status.push({ source: 'Local /api/gdelt geolocated news mentions', availability: 'error', dataState: 'unavailable', message: `HTTP ${gdeltRes.status}; GDELT mention stream omitted.` });
    }

  } catch (e) {
    console.error("SCM Risk overlay error:", e);
    source_status.push({ source: 'SCM exposure collection', availability: 'error', dataState: 'unavailable', message: e instanceof Error ? e.message : 'Collection error; affected stream omitted.' });
  }

  const suppliersWithIndicators = dynamicSuppliers.filter(s => s.exposure_indicators.length > 0);

  return NextResponse.json({
    suppliers: dynamicSuppliers,
    total: dynamicSuppliers.length,
    suppliers_with_indicators: suppliersWithIndicators.length,
    critical_count: 0,
    source_status,
    message: 'SCM route emits source-backed proximity indicators only. It does not infer facility status or risk level.',
    timestamp: new Date().toISOString(),
  }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
