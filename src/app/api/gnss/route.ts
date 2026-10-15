import { NextResponse } from 'next/server';
import { createGnssCollector } from '@/lib/feed-integrity/gnss';
import { updateSourceStatuses } from '@/lib/feed-integrity';

export const runtime = 'nodejs';

const collector = createGnssCollector();

export async function GET() {
  const { payload, httpStatus } = await collector.get();
  updateSourceStatuses(payload.status);
  return NextResponse.json(payload, { status: httpStatus, headers: { 'Cache-Control': 'no-store' } });
}
