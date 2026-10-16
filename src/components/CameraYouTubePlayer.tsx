'use client';

import { useEffect, useRef } from 'react';
import { loadYouTubePlayerApi, type YouTubePlayer } from '@/lib/youtube-player';
import { liveNewsEmbedUrl, liveNewsPlayerError } from '@/lib/live-news-player';
import type { LiveNewsPlayback } from '@/lib/feed-integrity/live-news';
import type { CameraStatusHandler } from './CameraVideoPlayer';

export default function CameraYouTubePlayer({ url, videoId, onStatus }: { url: string; videoId: string; onStatus: CameraStatusHandler }) {
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let checking = false;
    let player: YouTubePlayer | null = null;
    let controller: AbortController | null = null;
    let liveUntil = 0;
    let previousTime = 0;
    let advancedAt = 0;
    const startedAt = Date.now();
    const stop = () => { player?.destroy(); player = null; host.replaceChildren(); liveUntil = 0; advancedAt = 0; };
    const check = async () => {
      if (checking || disposed) return;
      checking = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 15_000);
      try {
        const response = await fetch(`/api/cctv/stream-status?url=${encodeURIComponent(url)}`, { cache: 'no-store', signal: controller.signal });
        const result: LiveNewsPlayback = await response.json();
        if (disposed) return;
        const age = Date.now() - Date.parse(result.checkedAt);
        if (!response.ok || result.feedId !== videoId || result.videoId !== videoId || result.state !== 'ready' || !Number.isFinite(age) || age < -5000 || age > 45_000) {
          stop(); onStatus(result.state === 'external' ? 'External player' : 'Video unavailable', result.reason || 'A current live camera broadcast could not be verified.'); return;
        }
        liveUntil = Date.parse(result.checkedAt) + 45_000;
        if (player) return;
        onStatus('Loading player');
        const api = await loadYouTubePlayerApi();
        if (disposed) return;
        const frame = document.createElement('iframe');
        frame.src = liveNewsEmbedUrl(videoId, window.location.origin);
        frame.title = 'Camera live video'; frame.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture'; frame.allowFullscreen = true;
        frame.referrerPolicy = 'strict-origin-when-cross-origin'; frame.className = 'w-full h-full border-0';
        host.replaceChildren(frame);
        player = new api.Player(frame, { events: {
          onReady: ({ target }) => { if (!disposed) { target.mute(); target.playVideo(); onStatus('Checking playback'); } },
          onStateChange: ({ data }) => {
            if (disposed) return;
            if (data === 0) { liveUntil = 0; onStatus('Stream ended'); }
            else if (data === 2) onStatus('Paused');
            else if (data === 3) onStatus('Buffering');
          },
          onError: ({ data }) => { if (!disposed) { stop(); onStatus('Video unavailable', liveNewsPlayerError(data)); } },
          onAutoplayBlocked: () => { if (!disposed) onStatus('Ready to play'); },
        } });
      } catch (error) {
        if (!disposed) { stop(); onStatus('Video unavailable', error instanceof Error ? error.message : 'The camera check failed.'); }
      } finally { clearTimeout(timeout); checking = false; }
    };
    onStatus('Checking live broadcast');
    void check();
    const recheck = setInterval(() => void check(), 30_000);
    const watchdog = setInterval(() => {
      if (disposed) return;
      if (liveUntil && Date.now() > liveUntil) { stop(); onStatus('Live verification expired'); return; }
      if (!player) return;
      const state = player.getPlayerState();
      const currentTime = player.getCurrentTime();
      if (state === 1 && currentTime > previousTime + 0.01) advancedAt = Date.now();
      previousTime = currentTime;
      if (state === 1 && liveUntil > Date.now()) onStatus(advancedAt && Date.now() - advancedAt <= 10_000 ? 'Live video' : 'Video stalled');
      else if (state === 2) onStatus('Paused');
      else if (state === 3) onStatus('Buffering');
      else if (Date.now() - startedAt > 25_000 && state !== 0) onStatus('Video unavailable');
    }, 1000);
    return () => { disposed = true; controller?.abort(); clearInterval(recheck); clearInterval(watchdog); stop(); };
  }, [url, videoId, onStatus]);
  return <div ref={hostRef} className="w-full h-full" data-testid="camera-youtube" />;
}
