import { NextResponse } from 'next/server';
import { createLiveNewsResolver } from '@/lib/feed-integrity/live-news';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const resolver = createLiveNewsResolver();

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const result = await resolver.resolve((await context.params).id, new URL(request.url).searchParams.get('refresh') === '1');
  if (!result) return NextResponse.json({ error: 'Unknown broadcast.' }, { status: 404 });
  return NextResponse.json(result, { status: result.state === 'unavailable' ? 503 : 200,
    headers: { 'Cache-Control': 'no-store' } });
}
