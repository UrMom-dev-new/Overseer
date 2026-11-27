import { NextRequest } from 'next/server';
import { proxyTile } from '@/lib/tile-proxy';

export async function GET(request: NextRequest) {
  return proxyTile(request.nextUrl.searchParams.get('url'));
}
