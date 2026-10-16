'use client';

import { useEffect, useRef } from 'react';
import { cameraSnapshotUrl } from '@/lib/camera-media';
import type { CameraStatusHandler } from './CameraVideoPlayer';

export default function CameraSnapshot({ url, name, intervalMs, onStatus }: { url: string; name: string; intervalMs: number; onStatus: CameraStatusHandler }) {
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let loading = false;
    let pending: HTMLImageElement | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    onStatus('Loading snapshot', 'This provider supplies still images, not live video.');
    const refresh = () => {
      if (disposed || loading || document.hidden) return;
      loading = true;
      const image = new Image(); pending = image;
      image.alt = `${name} snapshot`; image.className = 'w-full h-full object-contain';
      const finish = (ok: boolean) => {
        if (disposed || pending !== image) return;
        clearTimeout(deadline); image.onload = null; image.onerror = null; pending = null; loading = false;
        if (ok) { host.replaceChildren(image); onStatus('Snapshot', `Image received ${new Date().toLocaleTimeString()}. Source capture time is unknown.`); }
        else { host.replaceChildren(); image.src = ''; onStatus('Snapshot unavailable', 'No current image could be loaded. This is not a live video feed.'); }
        timer = setTimeout(refresh, Math.max(5000, intervalMs));
      };
      image.onload = () => finish(image.naturalWidth > 0);
      image.onerror = () => finish(false);
      deadline = setTimeout(() => finish(false), 12_000);
      image.src = cameraSnapshotUrl(url, Date.now());
    };
    const visible = () => { if (!document.hidden) { clearTimeout(timer); refresh(); } };
    document.addEventListener('visibilitychange', visible);
    refresh();
    return () => {
      disposed = true; clearTimeout(timer); clearTimeout(deadline); document.removeEventListener('visibilitychange', visible);
      if (pending) { pending.onload = null; pending.onerror = null; pending.src = ''; }
      host.replaceChildren();
    };
  }, [url, name, intervalMs, onStatus]);
  return <div ref={hostRef} className="w-full h-full" data-testid="camera-snapshot" />;
}
