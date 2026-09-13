/**
 * Balkans-focused data sources for OVERSEER.
 * NIGGG-BAS (seismic), GDACS (EU civil protection), BG news feeds.
 */

export const BALKANS_BBOX = {
  minLat: 39.5,
  maxLat: 46.5,
  minLng: 19.5,
  maxLng: 30.5,
};

export const BULGARIA_BBOX = {
  minLat: 41.2,
  maxLat: 44.5,
  minLng: 22.0,
  maxLng: 29.0,
};

export const DEFAULT_MAP_CENTER: [number, number] = [25.484, 42.698]; // Sofia - Balkans startup view
export const DEFAULT_MAP_ZOOM = 6.5;

export function inBbox(
  lat: number,
  lng: number,
  bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number } = BALKANS_BBOX,
): boolean {
  return lat >= bbox.minLat && lat <= bbox.maxLat && lng >= bbox.minLng && lng <= bbox.maxLng;
}

export interface NigggEarthquake {
  id: string;
  lat: number;
  lng: number;
  depth: number | null;
  magnitude: number | null;
  place: string | null;
  time: number | null;
  url: string;
  source: 'NIGGG-BAS';
}

export function parseNigggXml(xml: string): NigggEarthquake[] {
  const events: NigggEarthquake[] = [];
  const markerRegex = /<marker\b([^>]*)\/>/gi;
  let match: RegExpExecArray | null;

  while ((match = markerRegex.exec(xml)) !== null) {
    const attrs = match[1];
    const get = (name: string) => {
      const m = attrs.match(new RegExp(`${name}="([^"]*)"`));
      return m?.[1] ?? '';
    };

    const lat = parseFloat(get('lat'));
    const lng = parseFloat(get('lng'));
    const mag = parseFloat(get('mag') || get('magnitude'));
    const depth = parseFloat(get('depth'));
    const time = get('time') || get('date') || '';
    const place = get('title') || get('place') || null;
    const parsedTime = time ? new Date(time).getTime() : null;
    const observedAt = parsedTime !== null && Number.isFinite(parsedTime) ? parsedTime : null;

    if (isNaN(lat) || isNaN(lng)) continue;

    const id = get('id') || [
      'niggg-bas',
      lat.toFixed(4),
      lng.toFixed(4),
      Number.isFinite(mag) ? mag.toFixed(1) : 'mag-unknown',
      observedAt ?? 'time-unknown',
    ].join('-');

    events.push({
      id,
      lat,
      lng,
      depth: Number.isFinite(depth) ? depth : null,
      magnitude: Number.isFinite(mag) ? mag : null,
      place,
      time: observedAt,
      url: 'https://ndc.niggg.bas.bg/',
      source: 'NIGGG-BAS',
    });
  }

  return events;
}

export const BG_NEWS_FEEDS = [
  { name: 'Dnevnik', url: 'https://www.dnevnik.bg/rss/' },
  { name: 'Actualno', url: 'https://www.actualno.com/rss/actualno.xml' },
  { name: 'Mediapool', url: 'https://www.mediapool.bg/rss/' },
  { name: 'BBCEurope', url: 'https://feeds.bbci.co.uk/news/world/europe/rss.xml' },
];
