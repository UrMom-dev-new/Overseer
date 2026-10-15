import rows from '../data/infrastructure-sources.json';

export const INFRASTRUCTURE_SECTORS = [
  { id: 'power', layerKey: 'infra_power', label: 'Power Networks', color: '#FFD54F' },
  { id: 'water', layerKey: 'infra_water', label: 'Water Systems', color: '#29B6F6' },
  { id: 'wastewater', layerKey: 'infra_wastewater', label: 'Wastewater', color: '#66BB6A' },
  { id: 'medical', layerKey: 'infra_medical', label: 'Health Facilities', color: '#EF5350' },
  { id: 'telecom', layerKey: 'infra_telecom', label: 'Telecommunications', color: '#AB47BC' },
] as const;
export type InfrastructureSector = typeof INFRASTRUCTURE_SECTORS[number]['id'];
export type InfrastructureBounds = [west: number, south: number, east: number, north: number];
export const INFRASTRUCTURE_TTL_MS = 15 * 60 * 1000;
export const INFRASTRUCTURE_MAX_SPAN = 1;

export type InfrastructureAccess = 'Mapped via OSM' | 'Download required' | 'Resource review required' |
  'Credentials required' | 'Permission required' | 'Commercial license' | 'Not available' |
  'Modeled reference' | 'Historical reference' | 'Visual reference';

const policies: Record<string, { sectors: InfrastructureSector[]; access: InfrastructureAccess; alternatives: string[] }> = {
  S01: { sectors: ['power', 'water', 'wastewater', 'medical', 'telecom'], access: 'Mapped via OSM', alternatives: ['S02', 'S03', 'S08'] },
  S02: { sectors: ['power', 'telecom'], access: 'Download required', alternatives: ['S01'] },
  S03: { sectors: ['medical'], access: 'Download required', alternatives: ['S01', 'S11', 'S13'] },
  S04: { sectors: ['power'], access: 'Download required', alternatives: ['S01', 'S25', 'S05'] },
  S05: { sectors: ['power'], access: 'Historical reference', alternatives: ['S04', 'S25', 'S01'] },
  S06: { sectors: ['power'], access: 'Resource review required', alternatives: ['S01', 'S02'] },
  S07: { sectors: ['power'], access: 'Modeled reference', alternatives: ['S01', 'S06'] },
  S08: { sectors: ['wastewater'], access: 'Download required', alternatives: ['S01', 'S20', 'S21'] },
  S09: { sectors: ['water', 'power'], access: 'Download required', alternatives: ['S01'] },
  S10: { sectors: ['water'], access: 'Download required', alternatives: ['S01', 'S12'] },
  S11: { sectors: ['medical'], access: 'Resource review required', alternatives: ['S01', 'S03', 'S13'] },
  S12: { sectors: ['power', 'water', 'wastewater', 'medical', 'telecom'], access: 'Resource review required', alternatives: ['S01', 'S13'] },
  S13: { sectors: ['medical'], access: 'Resource review required', alternatives: ['S01', 'S03', 'S11'] },
  S14: { sectors: ['medical'], access: 'Not available', alternatives: ['S01', 'S03', 'S11', 'S13'] },
  S15: { sectors: ['telecom'], access: 'Credentials required', alternatives: ['S01', 'S24'] },
  S16: { sectors: ['telecom'], access: 'Permission required', alternatives: ['S01', 'S02'] },
  S17: { sectors: ['telecom'], access: 'Commercial license', alternatives: ['S01'] },
  S18: { sectors: ['telecom'], access: 'Permission required', alternatives: ['S01', 'S02'] },
  S19: { sectors: ['water', 'wastewater'], access: 'Resource review required', alternatives: ['S01', 'S08', 'S20'] },
  S20: { sectors: ['wastewater'], access: 'Download required', alternatives: ['S01', 'S08', 'S19'] },
  S21: { sectors: ['wastewater'], access: 'Resource review required', alternatives: ['S01', 'S08'] },
  S22: { sectors: ['water'], access: 'Download required', alternatives: ['S01', 'S19'] },
  S23: { sectors: ['water'], access: 'Commercial license', alternatives: ['S01', 'S22'] },
  S24: { sectors: ['telecom'], access: 'Download required', alternatives: ['S01', 'S02'] },
  S25: { sectors: ['power'], access: 'Download required', alternatives: ['S04', 'S01'] },
  S26: { sectors: ['medical'], access: 'Download required', alternatives: ['S01', 'S03', 'S11'] },
  S27: { sectors: ['power', 'water', 'telecom'], access: 'Visual reference', alternatives: ['S01'] },
  S28: { sectors: ['power', 'water', 'wastewater', 'medical', 'telecom'], access: 'Historical reference', alternatives: ['S19', 'S20', 'S24', 'S25', 'S26'] },
};

export const INFRASTRUCTURE_SOURCES = rows.map((row) => ({
  id: row.ID,
  name: row['Source / product'],
  role: row['Priority / role'],
  sectors: policies[row.ID].sectors,
  sectorDescription: row.Sector,
  coverage: row.Coverage,
  content: row['Location / asset content'],
  format: row['Access / format'],
  license: row['License / permission'],
  vintage: row['Vintage / update notes'],
  limitation: row['Main limitation'],
  url: row['Source URL'],
  termsUrl: row['Evidence / terms URL'],
  reviewDate: row['Review date'],
  access: policies[row.ID].access,
  alternatives: policies[row.ID].alternatives,
  evidence_kind: 'reference' as const,
}));

export function isInfrastructureSector(value: string): value is InfrastructureSector {
  return INFRASTRUCTURE_SECTORS.some((sector) => sector.id === value);
}

export function parseInfrastructureBounds(value: string | null): InfrastructureBounds | null {
  if (!value || value.split(',').length !== 4) return null;
  const parts = value.split(',');
  if (parts.some((part) => !part.trim())) return null;
  const [west, south, east, north] = parts.map(Number);
  if (![west, south, east, north].every(Number.isFinite) || west < -180 || east > 180 || south < -90 || north > 90 ||
    west >= east || south >= north || east - west > INFRASTRUCTURE_MAX_SPAN || north - south > INFRASTRUCTURE_MAX_SPAN) return null;
  return [west, south, east, north];
}
