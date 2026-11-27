'use client';

import { useEffect, useRef } from 'react';
import { loadYouTubePlayerApi, type YouTubePlayer } from '@/lib/youtube-player';
import { liveNewsEmbedUrl, liveNewsPlayerError } from '@/lib/live-news-player';
import { liveVerificationDeadline, verifiedYouTubeStatus } from '@/lib/verified-playback';
import type { CameraStatusHandler } from './CameraVideoPlayer';

export default function VerifiedYouTubePlayer({ endpoint, feedId, expectedVideoId, title, onStatus }: {
  endpoint: string; feedId: string; expectedVideoId?: string; title: string; onStatus: CameraStatusHandler;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false, failed = false, checking = false, generation = 0;
    let player: YouTubePlayer | null = null;
    let controller: AbortController | null = null;
    let readyTimer: ReturnType<typeof setTimeout> | null = null;
    let validUntil = 0, previousTime: number | null = null, advancedAt: number | null = null;
    let currentVideoId: string | null = null;
    const startedAt = Date.now();
    const stop = () => {
      generation++;
      if (readyTimer) clearTimeout(readyTimer);
      const previous = player;
      player = null; validUntil = 0;
      previousTime = null; advancedAt = null;
      try { previous?.destroy(); } catch { /* The iframe must still be removed if the SDK fails. */ }
      host.replaceChildren();
    };
    const fail = (status: string, detail: string) => {
      if (disposed) return;
      failed = true; controller?.abort(); stop(); onStatus(status, detail);
    };
    const check = async () => {
      if (checking || disposed || failed) return;
      checking = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 15_000);
      try {
        const response = await fetch(endpoint, { cache: 'no-store', signal: controller.signal });
        const result = await response.json();
        if (disposed || failed) return;
        const deadline = liveVerificationDeadline(result, feedId, Date.now(), expectedVideoId);
        if (!response.ok || deadline === null) {
          fail(result?.state === 'external' ? 'External player' : 'Video unavailable', 'A current, matching live broadcast could not be verified. Retry or open the provider.');
          return;
        }
        if (currentVideoId !== result.videoId) stop();
        validUntil = deadline;
        if (player) return;
        currentVideoId = result.videoId;
        const serial = generation;
        onStatus('Loading player');
        const api = await loadYouTubePlayerApi();
        if (disposed || failed || serial !== generation) return;
        const frame = document.createElement('iframe');
        frame.src = liveNewsEmbedUrl(result.videoId, window.location.origin);
        frame.title = title; frame.referrerPolicy = 'strict-origin-when-cross-origin';
        frame.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture'; frame.allowFullscreen = true;
        frame.className = 'w-full h-full border-0'; host.replaceChildren(frame);
        readyTimer = setTimeout(() => fail('Video unavailable', 'The provider player did not respond. Retry or open the provider.'), 20_000);
        const created = new api.Player(frame, { events: {
          onReady: ({ target }) => {
            if (disposed || failed || serial !== generation) return;
            if (readyTimer) clearTimeout(readyTimer);
            target.mute(); target.playVideo(); onStatus('Checking playback');
          },
          onStateChange: ({ data }) => {
            if (disposed || failed || serial !== generation) return;
            if (data === 0) fail('Stream ended', 'This broadcast has ended.');
            else if (data === 2 || data === 3) { advancedAt = null; onStatus(data === 2 ? 'Paused' : 'Buffering'); }
            // A "playing" event alone is not proof of advancing video.
          },
          onError: ({ data }) => { if (serial === generation) fail('Video unavailable', liveNewsPlayerError(data)); },
          onAutoplayBlocked: () => { if (!disposed && !failed && serial === generation) onStatus('Ready to play', 'Select play in the provider player.'); },
        } });
        if (disposed || failed || serial !== generation) { try { created.destroy(); } catch {} return; }
        player = created;
      } catch {
        if (!disposed && !failed) fail('Video unavailable', 'The broadcast check or player failed. Retry or open the provider.');
      } finally { clearTimeout(timeout); checking = false; }
    };
    onStatus('Checking live broadcast');
    void check();
    const refresh = setInterval(() => void check(), 30_000);
    const watchdog = setInterval(() => {
      if (disposed || failed || !validUntil) return;
      if (Date.now() >= validUntil) { fail('Live verification expired', 'The provider live check expired. Retry or open the provider.'); return; }
      if (!player) return;
      try {
        const state = player.getPlayerState();
        const time = player.getCurrentTime();
        if (state !== 1 || !Number.isFinite(time) || (previousTime !== null && time < previousTime)) advancedAt = null;
        if (state === 1 && Number.isFinite(time) && previousTime !== null && time > previousTime + 0.01) advancedAt = Date.now();
        previousTime = Number.isFinite(time) ? time : null;
        onStatus(verifiedYouTubeStatus(state, advancedAt, validUntil, startedAt, Date.now()));
      } catch { fail('Video unavailable', 'The provider player stopped responding.'); }
    }, 1000);
    return () => { disposed = true; controller?.abort(); clearInterval(refresh); clearInterval(watchdog); stop(); };
  }, [endpoint, feedId, expectedVideoId, title, onStatus]);
  return <div ref={hostRef} data-testid="verified-youtube-player" className="w-full h-full" />;
}
