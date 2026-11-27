'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, RefreshCw, X } from 'lucide-react';
import type { LiveNewsFeed } from '@/lib/live-news-catalog';
import VerifiedYouTubePlayer from './VerifiedYouTubePlayer';

export default function LiveNewsViewer({ feed, onClose }: { feed: LiveNewsFeed; onClose: () => void }) {
  const [status, setStatus] = useState('Checking broadcast');
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onStatus = useCallback((label: string, detail?: string) => {
    setStatus(label);
    setError(/unavailable|expired|ended|external/i.test(label) ? detail || label : null);
  }, []);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
      if (event.key !== 'Tab') return;
      const controls = dialogRef.current?.querySelectorAll<HTMLElement>('a[href],button,iframe');
      if (!controls?.length) return;
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls[controls.length - 1].focus(); }
      if (!event.shiftKey && document.activeElement === controls[controls.length - 1]) { event.preventDefault(); controls[0].focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); previous?.focus(); };
  }, []);

  return <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/75 p-3" onClick={onClose}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="live-news-title" data-testid="live-news-viewer"
      className="w-full max-w-[900px] max-h-[90svh] overflow-y-auto rounded-lg border border-white/20 bg-black shadow-2xl" onClick={(event) => event.stopPropagation()}>
      <div className="flex flex-wrap items-center gap-3 border-b border-white/15 bg-[#111] p-3">
        <h2 id="live-news-title" className="min-w-0 flex-1 break-words text-sm font-mono text-white">{feed.name}</h2>
        <span role="status" data-testid="live-news-playback-status" className="text-xs text-white/70">{status}</span>
        <a href={feed.url} target="_blank" rel="noopener noreferrer" title="Open broadcaster" aria-label="Open broadcaster" className="p-2 text-white/80 hover:text-white"><ExternalLink className="h-4 w-4" /></a>
        <button type="button" title="Retry broadcast" aria-label="Retry broadcast" onClick={() => setRetry((value) => value + 1)} className="p-2 text-white/80 hover:text-white"><RefreshCw className="h-4 w-4" /></button>
        <button ref={closeRef} type="button" title="Close broadcast" aria-label="Close broadcast" onClick={onClose} className="p-2 text-white/80 hover:text-white"><X className="h-5 w-5" /></button>
      </div>
      <div className="relative aspect-video min-h-[200px] w-full bg-black">
        <div className="absolute inset-0" hidden={Boolean(error)}>
          <VerifiedYouTubePlayer key={`${feed.id}:${retry}`} endpoint={`/api/live-news/${encodeURIComponent(feed.id)}${retry ? '?refresh=1' : ''}`}
            feedId={feed.id} title={`${feed.name} live broadcast`} onStatus={onStatus} />
        </div>
        {error && <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
          <p role="alert" className="max-w-lg text-sm text-white/80">{error}</p>
          <a href={feed.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm text-sky-300 hover:underline"><ExternalLink className="h-4 w-4" />Open broadcaster</a>
        </div>}
      </div>
    </div>
  </div>;
}
