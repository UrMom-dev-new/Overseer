'use client';

import { useEffect, useRef, useState } from 'react';
import { ExternalLink, LoaderCircle, RefreshCw, X } from 'lucide-react';
import type { LiveNewsFeed } from '@/lib/live-news-catalog';
import type { LiveNewsPlayback } from '@/lib/feed-integrity/live-news';
import { liveNewsEmbedUrl, liveNewsPlayerError } from '@/lib/live-news-player';
import { loadYouTubePlayerApi, type YouTubePlayer } from '@/lib/youtube-player';

export default function LiveNewsViewer({ feed, onClose }: { feed: LiveNewsFeed; onClose: () => void }) {
  const [playback, setPlayback] = useState<LiveNewsPlayback | null>(null);
  const [status, setStatus] = useState('Checking broadcast');
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const playerHostRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const controls = dialogRef.current?.querySelectorAll<HTMLElement>('a[href],button,iframe');
      if (!controls?.length) return;
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls[controls.length - 1].focus(); }
      if (!event.shiftKey && document.activeElement === controls[controls.length - 1]) { event.preventDefault(); controls[0].focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); previous?.focus(); };
  }, [onClose]);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    setPlayback(null); setEmbedUrl(null); setError(null); setStatus('Checking broadcast');
    const timer = setTimeout(() => controller.abort(), 15000);
    void (async () => {
      try {
        const response = await fetch(`/api/live-news/${encodeURIComponent(feed.id)}${retry ? '?refresh=1' : ''}`, { cache: 'no-store', signal: controller.signal });
        const result: LiveNewsPlayback = await response.json();
        if (disposed) return;
        if (result.feedId !== feed.id || !['ready', 'external', 'unavailable'].includes(result.state)) throw new Error('Invalid broadcast response.');
        setPlayback(result);
        if (response.ok && result.state === 'ready' && result.videoId) {
          setEmbedUrl(liveNewsEmbedUrl(result.videoId, window.location.origin));
          setStatus('Loading player');
        } else {
          setStatus(result.state === 'external' ? 'External player' : 'Unavailable');
          setError(result.reason || 'This broadcast is currently unavailable.');
        }
      } catch (reason) {
        if (!disposed) {
          setStatus('Unavailable');
          setError(controller.signal.aborted ? 'The broadcast check timed out.' : reason instanceof Error ? reason.message : 'The broadcast could not be opened.');
        }
      } finally { clearTimeout(timer); }
    })();
    return () => { disposed = true; controller.abort(); clearTimeout(timer); };
  }, [feed.id, retry]);

  useEffect(() => {
    if (!embedUrl || !playerHostRef.current) return;
    let disposed = false;
    let player: YouTubePlayer | null = null;
    // The provider owns this iframe and removes it on destroy. React owns only
    // the host so closing, retrying or switching feeds cannot double-remove it.
    const host = playerHostRef.current;
    const frame = document.createElement('iframe');
    frame.src = embedUrl;
    frame.title = `${feed.name} live broadcast`;
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture';
    frame.allowFullscreen = true;
    frame.className = 'h-full w-full border-0';
    host.replaceChildren(frame);
    const timer = setTimeout(() => { if (!disposed) { setStatus('Unavailable'); setError('The provider player did not respond.'); } }, 20000);
    void loadYouTubePlayerApi().then((api) => {
      if (disposed) return;
      player = new api.Player(frame, { events: {
        onReady: ({ target }) => {
          if (disposed) return;
          clearTimeout(timer);
          target.mute();
          if (target.getPlayerState() === 1) setStatus('Playing');
          else { setStatus('Ready to play'); target.playVideo(); }
        },
        onStateChange: ({ data }) => {
          if (disposed) return;
          if (data === 1) { clearTimeout(timer); setStatus('Playing'); setError(null); }
          else if (data === 2) setStatus('Paused');
          else if (data === 3) setStatus('Buffering');
          else if (data === 0) { setStatus('Ended'); setError('This live broadcast has ended.'); }
        },
        onError: ({ data }) => { if (!disposed) { clearTimeout(timer); setStatus('Unavailable'); setError(liveNewsPlayerError(data)); } },
        onAutoplayBlocked: () => { if (!disposed) { clearTimeout(timer); setStatus(player?.getPlayerState() === 1 ? 'Playing' : 'Ready to play'); } },
      } });
    }).catch((reason) => { if (!disposed) { clearTimeout(timer); setStatus('Unavailable'); setError(reason.message); } });
    return () => { disposed = true; clearTimeout(timer); player?.destroy(); host.replaceChildren(); };
  }, [embedUrl, feed.name]);

  return <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/75 p-3" onClick={onClose}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="live-news-title" data-testid="live-news-viewer"
      className="w-full max-w-[900px] max-h-[90svh] overflow-y-auto rounded-lg border border-white/20 bg-black shadow-2xl" onClick={(event) => event.stopPropagation()}>
      <div className="flex flex-wrap items-center gap-3 border-b border-white/15 bg-[#111] p-3">
        <h2 id="live-news-title" className="min-w-0 flex-1 break-words text-sm font-mono text-white">{feed.name}</h2>
        <span role="status" data-testid="live-news-playback-status" className="text-xs text-white/70">{status}</span>
        <a href={playback?.watchUrl || feed.url} target="_blank" rel="noopener noreferrer" title="Open broadcaster" aria-label="Open broadcaster" className="p-2 text-white/80 hover:text-white"><ExternalLink className="h-4 w-4" /></a>
        <button type="button" title="Retry broadcast" aria-label="Retry broadcast" onClick={() => setRetry((value) => value + 1)} className="p-2 text-white/80 hover:text-white"><RefreshCw className="h-4 w-4" /></button>
        <button ref={closeRef} type="button" title="Close broadcast" aria-label="Close broadcast" onClick={onClose} className="p-2 text-white/80 hover:text-white"><X className="h-5 w-5" /></button>
      </div>
      <div className="relative aspect-video min-h-[200px] w-full bg-black">
        {embedUrl && <div ref={playerHostRef} hidden={Boolean(error)} className="absolute inset-0" />}
        {!embedUrl && !error && <div className="absolute inset-0 flex items-center justify-center gap-3 text-sm text-white/70"><LoaderCircle className="h-5 w-5 animate-spin" />Checking broadcast</div>}
        {error && <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
          <p role="alert" className="max-w-lg text-sm text-white/80">{error}</p>
          <a href={playback?.watchUrl || feed.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm text-sky-300 hover:underline"><ExternalLink className="h-4 w-4" />Open broadcaster</a>
        </div>}
      </div>
    </div>
  </div>;
}
