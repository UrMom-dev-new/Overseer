import { NextResponse } from 'next/server';
import { readSourceStatuses } from '@/lib/feed-integrity';
import { SOURCE_CAPABILITIES, sourceConfigurationState, statusForCapability, statusesForCapability } from '@/lib/source-manifest';
import { getSourceContract } from '@/lib/source-contracts';

export async function GET() {
  const statuses = readSourceStatuses();
  const capabilities = SOURCE_CAPABILITIES.map((capability) => {
    const cachedStatuses = statusesForCapability(capability, statuses);
    const cachedStatus = statusForCapability(capability, statuses);
    const contract = getSourceContract(capability.id);
    return {
      ...capability,
      configuration: sourceConfigurationState(capability),
      verificationContract: contract ? {
        requirement: contract.requirement,
        recordSets: contract.recordSets,
        requireProviderStatus: contract.requireProviderStatus,
        allowSchemaValidEmpty: contract.allowSchemaValidEmpty,
      } : null,
      cachedStatus,
      cachedStatuses,
      configuredFallback: capability.fallback,
      lastAttemptAt: cachedStatus?.lastAttemptAt ?? null,
      lastSuccessfulFetchAt: cachedStatus?.lastSuccessfulFetchAt ?? null,
      acceptedRecords: cachedStatuses.reduce((sum, status) => sum + status.acceptedRecords, 0),
      rejectedRecords: cachedStatuses.reduce((sum, status) => sum + status.rejectedRecords, 0),
      activeFallback: cachedStatuses.some((status) => status.servingLastKnownGood) ? 'last-known-good' : null,
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
