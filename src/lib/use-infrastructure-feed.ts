'use client';

import { useEffect, useState } from 'react';
import { INFRASTRUCTURE_SECTORS, parseInfrastructureBounds, type InfrastructureBounds } from './infrastructure-catalog';
import { evaluateCapabilityPayload, getSourceContract } from './source-contracts';
import type { InfrastructurePayload } from './feed-integrity/infrastructure';

export function useInfrastructureFeed(activeLayers: Record<string, boolean>, bounds: InfrastructureBounds | null) {
  const sectorsKey = INFRASTRUCTURE_SECTORS.filter((sector) => activeLayers[sector.layerKey]).map((sector) => sector.id).join(',');
  const boundsKey = bounds?.map((part) => part.toFixed(4)).join(',') ?? '';
  const validBounds = parseInfrastructureBounds(boundsKey);
  const requestKey = sectorsKey && validBounds ? `${sectorsKey}:${boundsKey}` : '';
  const [snapshot, setSnapshot] = useState<{ key: string; payload: InfrastructurePayload | null; error: string | null }>({ key: '', payload: null, error: null });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (snapshot.key !== requestKey || !snapshot.payload?.expiresAt) return;
    const timer = setTimeout(() => setRetry((value) => value + 1), Math.max(0, Date.parse(snapshot.payload.expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [snapshot, requestKey]);

  useEffect(() => {
    if (!requestKey) return;
    let active = true;
    const controller = new AbortController();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(async () => {
      deadline = setTimeout(() => controller.abort(), 28_000);
      try {
        const response = await fetch(`/api/infrastructure-assets?sectors=${sectorsKey}&bbox=${boundsKey}`, { cache: 'no-store', signal: controller.signal });
        const payload: InfrastructurePayload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? `Infrastructure HTTP ${response.status}`);
        const fetchAge = Date.now() - Date.parse(payload.fetchedAt ?? '');
        if (!Number.isFinite(fetchAge) || fetchAge < -5 * 60 * 1000 || !payload.expiresAt || Date.parse(payload.expiresAt) <= Date.now() ||
          !Number.isFinite(Date.parse(payload.expiresAt)) || JSON.stringify(payload.bounds) !== JSON.stringify(parseInfrastructureBounds(boundsKey)) ||
          payload.sectors?.slice().sort().join(',') !== sectorsKey.split(',').sort().join(',') || !Array.isArray(payload.assets)) throw new Error('Invalid or expired infrastructure metadata.');
        for (const sector of sectorsKey.split(',')) {
          const contract = getSourceContract(`infrastructure-${sector}`)!;
          const result = evaluateCapabilityPayload({ contract, httpStatus: response.status, contentType: response.headers.get('content-type'),
            payload: { ...payload, assets: payload.assets.filter((asset) => asset.sectors.includes(sector as typeof asset.sectors[number])),
              status: payload.status.filter((status) => status.source.providerId.startsWith(`infrastructure-${sector}:`)) },
            renderingChecked: false, env: {} });
          if (!result.passed) throw new Error('Infrastructure response failed its source contract.');
        }
        if (active) setSnapshot({ key: requestKey, payload, error: null });
      } catch (error) {
        if (active) setSnapshot({ key: requestKey, payload: null, error: error instanceof Error ? error.message : 'Infrastructure unavailable.' });
      } finally { clearTimeout(deadline); }
    }, 800);
    return () => { active = false; clearTimeout(timer); clearTimeout(deadline); controller.abort(); };
  }, [requestKey, sectorsKey, boundsKey, retry]);

  const current = snapshot.key === requestKey ? snapshot : null;
  const expired = Boolean(current?.payload && Date.parse(current.payload.expiresAt!) <= Date.now());
  const assets = current?.payload && !expired ? current.payload.assets : [];
  const message = !sectorsKey || !bounds ? '' : !requestKey ? 'Viewport exceeds one-degree query limit or crosses the antimeridian.' :
    current?.error ?? (expired ? 'Infrastructure snapshot expired.' : current?.payload ? '' : 'Loading infrastructure sources...');
  const feedStatus = Object.fromEntries(INFRASTRUCTURE_SECTORS.filter((sector) => activeLayers[sector.layerKey]).map((sector) => [sector.layerKey, {
    availability: !requestKey ? 'not_requested' : message ? current?.error || expired ? 'error' : 'pending' : current?.payload?.status.some((status) => status.availability === 'error' || status.availability === 'partial') ? 'partial' : 'ok',
    freshness: expired ? 'stale' : current?.payload ? 'fresh' : 'unknown', message,
  }]));
  return { assets, feedStatus, message, retry: () => setRetry((value) => value + 1) };
}
