import { NextResponse } from 'next/server';
import { cameraYouTubeId } from '@/lib/camera-media';
import { createCameraYouTubeResolver } from '@/lib/feed-integrity/live-news';
import { getClientIp, isRateLimited } from '@/lib/ssrf-guard';

export const dynamic = 'force-dynamic';
const resolve = createCameraYouTubeResolver();

export async function GET(request: Request) {
  const videoId = cameraYouTubeId(new URL(request.url).searchParams.get('url'));
  if (!videoId) return NextResponse.json({ available: false, reason: 'Only a concrete YouTube camera video can be checked. Other provider players cannot prove live playback from HTML.' }, { status: 400 });
  if (isRateLimited(`cctv:${getClientIp(request)}`, 30)) return NextResponse.json({ available: false, reason: 'Camera check limit reached.' }, { status: 429, headers: { 'Retry-After': '60' } });
  try {
    const result = await resolve(videoId);
    return NextResponse.json(result, { status: result?.state === 'unavailable' ? 503 : 200, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ available: false, reason: 'Camera checks busy.' }, { status: 503, headers: { 'Retry-After': '5' } });
  }
}
