import { INFRASTRUCTURE_SOURCES, type InfrastructureSector } from './infrastructure-catalog';
import type { InfrastructureAsset } from './feed-integrity/infrastructure';
import { isValidLngLat, parseDateOrNull, stableId } from './feed-integrity/helpers';

export const IMPORTABLE_INFRASTRUCTURE_SOURCES = new Set(['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S08', 'S09', 'S10', 'S11', 'S12', 'S13', 'S19', 'S20', 'S21', 'S24', 'S25', 'S26']);
export const MAX_INFRASTRUCTURE_IMPORT_BYTES = 10 * 1024 * 1024;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
const point = (value: unknown): value is number[] => Array.isArray(value) && value.length >= 2 && isValidLngLat(value[0], value[1]);
const line = (value: unknown): value is number[][] => Array.isArray(value) && value.length >= 2 && value.every(point) && new Set(value.map((value) => value.slice(0, 2).join(','))).size >= 2;
function ring(value: unknown): value is number[][] {
  return line(value) && value.length >= 4 && value[0][0] === value[value.length - 1][0] && value[0][1] === value[value.length - 1][1] &&
    new Set(value.map((value) => value.slice(0, 2).join(','))).size >= 3;
}

export function importInfrastructureGeoJson(text: string, sourceId: string, sector: InfrastructureSector, importedAt: string, license: string): InfrastructureAsset[] {
  if (new TextEncoder().encode(text).byteLength > MAX_INFRASTRUCTURE_IMPORT_BYTES) throw new Error('GeoJSON exceeds 10 MiB.');
  const source = INFRASTRUCTURE_SOURCES.find((value) => value.id === sourceId);
  if (!source || !IMPORTABLE_INFRASTRUCTURE_SOURCES.has(sourceId) || !source.sectors.includes(sector)) throw new Error('Source or sector is not eligible for open-data import.');
  if (!license.trim() || license.length > 500 || !parseDateOrNull(importedAt)) throw new Error('Dataset license and a valid import time are required.');
  const payload: unknown = JSON.parse(text.replace(/^\uFEFF/, ''));
  if (!record(payload) || payload.type !== 'FeatureCollection' || !Array.isArray(payload.features) || payload.crs) throw new Error('Expected a WGS84 GeoJSON FeatureCollection without a custom CRS.');
  if (!payload.features.length || payload.features.length > 10_000) throw new Error('Import must contain 1 to 10,000 source features.');
  const assets: InfrastructureAsset[] = [];
  const seen = new Set<string>();
  for (const feature of payload.features) {
    if (!record(feature) || feature.type !== 'Feature' || !record(feature.geometry) || (feature.properties != null && !record(feature.properties))) throw new Error('Malformed GeoJSON feature; import omitted.');
    const geometry = feature.geometry;
    const coordinates = geometry.coordinates;
    if (!((geometry.type === 'Point' && point(coordinates)) || (geometry.type === 'LineString' && line(coordinates)) ||
      (geometry.type === 'Polygon' && Array.isArray(coordinates) && coordinates.length > 0 && coordinates.every(ring)))) throw new Error('Only valid source Point, LineString, or Polygon geometries are accepted. No coordinates are inferred.');
    const properties = feature.properties ?? {};
    const sourceFeatureId = typeof feature.id === 'string' || typeof feature.id === 'number' ? String(feature.id) :
      typeof properties.id === 'string' || typeof properties.id === 'number' ? String(properties.id) : null;
    const id = sourceFeatureId ? `import:${sourceId}:${sourceFeatureId}` : stableId(`import:${sourceId}`, [geometry, properties]);
    if (seen.has(id)) {
      const previous = assets.find((asset) => asset.id === id)!;
      if (JSON.stringify(previous.geometry) !== JSON.stringify(geometry)) throw new Error('Conflicting geometry for the same source feature ID.');
      continue;
    }
    seen.add(id);
    const tags = Object.fromEntries(Object.entries(properties).slice(0, 100).filter(([, value]) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean').map(([key, value]) => [key.slice(0, 128), String(value).slice(0, 2000)]));
    assets.push({ id, name: String(properties.name ?? properties.NAME ?? sourceFeatureId ?? source.name).slice(0, 500), sectors: [sector],
      geometry: geometry as unknown as InfrastructureAsset['geometry'], source_id: sourceId, source_url: source.url,
      sourceUpdatedAt: parseDateOrNull(properties.sourceUpdatedAt ?? properties.updated_at), collectedAt: importedAt,
      evidence_kind: 'reference', coordinate_precision: 'unknown',
      tags: { ...tags, catalog_source: `${source.id}: ${source.name}`, dataset_license: license.trim(), catalog_vintage: source.vintage,
        coordinate_precision: 'Source supplied; accuracy unverified', source_limitations: source.limitation, imported_at: importedAt },
    });
  }
  return assets;
}
