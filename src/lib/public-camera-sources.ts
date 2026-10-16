import rows from '../data/public-camera-sources.json';

export const CAMERA_CONNECTORS: Record<string, { regions: string[]; env?: string; optionalKey?: boolean }> = {
  'CAM-001': { regions: ['finland', 'europe'] },
  'CAM-002': { regions: ['caltrans', 'us-west'] },
  'CAM-003': { regions: ['singapore', 'asia'], env: 'DATA_GOV_SG_API_KEY', optionalKey: true },
  'CAM-004': { regions: ['hong-kong', 'asia'] },
  'CAM-005': { regions: ['uk'], env: 'TFL_APP_KEY', optionalKey: true },
  'CAM-006': { regions: ['ontario', 'canada'], env: 'ONTARIO_511_API_KEY' },
  'CAM-007': { regions: ['wsdot', 'us-west'], env: 'WSDOT_ACCESS_CODE' },
  'CAM-008': { regions: ['south-africa'], env: 'SANRAL_API_KEY' },
};

export const PUBLIC_CAMERA_REGIONS = [...new Set(Object.values(CAMERA_CONNECTORS).flatMap((connector) => connector.regions))];

export const PUBLIC_CAMERA_SOURCES = rows.map((row) => ({ ...row,
  connector: CAMERA_CONNECTORS[row.source_id] ? 'api' as const : ['CAM-009', 'CAM-010'].includes(row.source_id) ? 'review_required' as const : 'provider_link' as const,
  credentialEnv: CAMERA_CONNECTORS[row.source_id]?.env ?? null,
  optionalKey: CAMERA_CONNECTORS[row.source_id]?.optionalKey ?? false,
}));

export function publicCameraSourcesForRegions(regions: string[]) {
  return PUBLIC_CAMERA_SOURCES.filter((source) => CAMERA_CONNECTORS[source.source_id]?.regions.some((region) => regions.includes(region)));
}
