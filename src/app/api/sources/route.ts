import { NextResponse } from 'next/server';
import { readSourceStatuses } from '@/lib/feed-integrity';
import { SOURCE_CAPABILITIES, sourceConfigurationState, statusForCapability, statusesForCapability } from '@/lib/source-manifest';

export async function GET() {
  const statuses = readSourceStatuses();
  const capabilities = SOURCE_CAPABILITIES.map((capability) => {
    const cachedStatuses = statusesForCapability(capability, statuses);
    const cachedStatus = statusForCapability(capability, statuses);
    return {
      ...capability,
      configuration: sourceConfigurationState(capability),
      cachedStatus,
      cachedStatuses,
      lastAttemptAt: cachedStatus?.lastAttemptAt ?? null,
      lastSuccessfulFetchAt: cachedStatus?.lastSuccessfulFetchAt ?? null,
      acceptedRecords: cachedStatuses.reduce((sum, status) => sum + status.acceptedRecords, 0),
      rejectedRecords: cachedStatuses.reduce((sum, status) => sum + status.rejectedRecords, 0),
      activeFallback: cachedStatuses.some((status) => status.servingLastKnownGood) ? 'last-known-good' : capability.fallback,
    };
  });

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    note: 'Source diagnostics use the same API routes as the production dashboard. Cached status is populated after routes collect data.',
    capabilities,
  }, {
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}
