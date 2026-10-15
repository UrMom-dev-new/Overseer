import { NextRequest, NextResponse } from 'next/server';
import { isInfrastructureSector, parseInfrastructureBounds } from '@/lib/infrastructure-catalog';
import { createInfrastructureCollector } from '@/lib/feed-integrity/infrastructure';
import { updateSourceStatuses } from '@/lib/feed-integrity';

export const runtime = 'nodejs';
const collect = createInfrastructureCollector();

export async function GET(request: NextRequest) {
  const bounds = parseInfrastructureBounds(request.nextUrl.searchParams.get('bbox'));
  const sectors = [...new Set((request.nextUrl.searchParams.get('sectors') ?? '').split(','))];
  if (!bounds || !sectors.length || !sectors.every(isInfrastructureSector)) {
    return NextResponse.json({ assets: [], error: 'Provide sectors and bbox=west,south,east,north, at most one degree per side. Antimeridian-crossing areas must be split.' }, { status: 400 });
  }
  try {
    const payload = await collect(bounds, sectors);
    updateSourceStatuses(payload.status);
    return NextResponse.json(payload, { status: payload.error ? 503 : 200, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ assets: [], error: 'Infrastructure queries busy. Retry shortly.' }, { status: 429, headers: { 'Retry-After': '5', 'Cache-Control': 'no-store' } });
  }
}
