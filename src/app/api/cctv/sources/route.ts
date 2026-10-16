import { NextResponse } from 'next/server';
import { PUBLIC_CAMERA_SOURCES } from '@/lib/public-camera-sources';
import { readSourceStatuses } from '@/lib/feed-integrity';

export const dynamic = 'force-dynamic';

export function GET() {
  const statuses = readSourceStatuses();
  return NextResponse.json({ evidenceKind: 'reference', mediaVerification: 'not_checked', sources: PUBLIC_CAMERA_SOURCES.map((source) => ({ ...source,
    configuration: source.credentialEnv && !source.optionalKey && !process.env[source.credentialEnv]?.trim() ? 'key_required' : source.connector === 'api' ? 'enabled' : source.connector,
    status: statuses.filter((status) => status.source.providerId === `cctv:${source.source_id}` || status.source.providerId.startsWith(`cctv:${source.source_id}:`)),
  })) }, { headers: { 'Cache-Control': 'no-store' } });
}
