import { NextResponse } from 'next/server';
import { isRateLimited, getClientIp } from '@/lib/ssrf-guard';

export const dynamic = 'force-dynamic';

/**
 * Thin proxy to the OVERSEER Intelligence Layer (overseer-intel).
 *
 * Configure INTEL_URL to a reachable overseer-intel service. The desktop
 * package does not start this optional service.
 *
 * All intelligence logic lives in the intel container — this route
 * just validates the request and forwards it.
 */

const INTEL_URL = process.env.INTEL_URL?.trim() || null;

const ALLOWED_TYPES = new Set(['aircraft', 'vessel', 'company', 'person', 'ip', 'country']);

export async function GET(req: Request) {
  const clientIp = getClientIp(req);
  if (isRateLimited(clientIp, 30, 60_000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  const { searchParams } = new URL(req.url);
  const type = (searchParams.get('type') || '').toLowerCase().trim();
  const id = (searchParams.get('id') || '').trim();

  if (!type || !ALLOWED_TYPES.has(type)) {
    return NextResponse.json(
      { error: `Invalid type. Allowed: ${[...ALLOWED_TYPES].join(', ')}` },
      { status: 400 },
    );
  }
  if (!id || id.length < 2 || id.length > 200) {
    return NextResponse.json({ error: 'Invalid id (2-200 chars)' }, { status: 400 });
  }
  if (!INTEL_URL) {
    return NextResponse.json(
      {
        error: 'Entity expansion service is not configured',
        nodes: [],
        links: [],
        configuration: 'not_configured',
        message: 'Set INTEL_URL to enable the optional overseer-intel service. Desktop builds do not start it automatically.',
      },
      { status: 503 },
    );
  }

  try {
    const params = new URLSearchParams({ type, id });
    // Forward extra aircraft properties to the intel brain
    for (const key of ['registration', 'model', 'icao24']) {
      const val = searchParams.get(key);
      if (val) params.set(key, val);
    }
    const res = await fetch(`${INTEL_URL}/resolve?${params}`, {
      signal: AbortSignal.timeout(15000),
      headers: { 'X-Forwarded-For': clientIp },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return NextResponse.json(
        { error: body.error || `Intel layer returned ${res.status}`, nodes: [], links: [] },
        { status: res.status },
      );
    }

    const data = await res.json();
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' },
    });
  } catch (e) {
    console.error('[OVERSEER] Intel proxy error:', e instanceof Error ? e.message : e);
    return NextResponse.json(
      { error: 'Intelligence layer unavailable', nodes: [], links: [] },
      { status: 502 },
    );
  }
}
