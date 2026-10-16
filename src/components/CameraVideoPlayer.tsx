'use client';

import { useEffect, useRef } from 'react';
import Hls from 'hls.js';
import { cameraVideoStatus, type CameraVideoEvidence } from '@/lib/camera-media';

export type CameraStatusHandler = (status: string, detail?: string) => void;

export default function CameraVideoPlayer({ url, live, onStatus }: { url: string; live: boolean; onStatus: CameraStatusHandler }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let disposed = false;
    let failed = false;
    let hls: Hls | null = null;
    let previousTime = 0;
    let previousSequence: number | null = null;
    let previousRangeEnd: number | null = null;
    const evidence: CameraVideoEvidence = { startedAt: Date.now(), hasFrames: false, paused: false, ended: false,
      livePlaylist: null, playlistAdvancedAt: null, frameAdvancedAt: null, maxPlaylistSilenceMs: 45_000, programDateTime: null };
    const frameCallbacks = typeof video.requestVideoFrameCallback === 'function';
    let frameId: number | null = null;
    const frame = () => {
      if (disposed) return;
      evidence.frameAdvancedAt = Date.now();
      frameId = video.requestVideoFrameCallback(frame);
    };
    if (frameCallbacks) frameId = video.requestVideoFrameCallback(frame);
    onStatus(live ? 'Loading video' : 'Loading recorded clip');
    const fail = (message: string) => {
      if (disposed) return;
      failed = true; video.pause(); hls?.stopLoad(); onStatus('Video unavailable', message);
    };
    const play = () => { void video.play().catch(() => { if (!disposed && !failed) onStatus('Ready to play'); }); };
    const onError = () => fail('The camera video could not be played. Retry or open the provider. No still image was substituted.');
    video.addEventListener('error', onError);
    video.addEventListener('loadedmetadata', play);
    if (live && Hls.isSupported()) {
      hls = new Hls({ enableWorker: false, liveSyncDurationCount: 2, maxBufferLength: 20 });
      hls.on(Hls.Events.LEVEL_LOADED, (_event, { details }) => {
        if (disposed || failed) return;
        evidence.livePlaylist = details.live;
        evidence.maxPlaylistSilenceMs = Math.max(15_000, Math.min(60_000, details.targetduration * 3500));
        const timestamp = details.fragments[details.fragments.length - 1]?.endProgramDateTime;
        evidence.programDateTime = typeof timestamp === 'number' && Number.isFinite(timestamp) ? timestamp : null;
        if (previousSequence !== null && details.endSN > previousSequence) evidence.playlistAdvancedAt = Date.now();
        previousSequence = details.endSN;
        if (!details.live) fail('The provider returned a recording, not a live HLS stream.');
      });
      hls.on(Hls.Events.MANIFEST_PARSED, play);
      hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) fail(`The live stream failed (${data.type}). Retry or open the provider.`); });
      hls.attachMedia(video);
      hls.loadSource(url);
    } else if (!live || video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
    } else fail('This browser cannot play the provider HLS stream. Open the provider directly.');

    const timer = setInterval(() => {
      if (disposed || failed) return;
      const now = Date.now();
      evidence.hasFrames = video.readyState >= 2 && video.videoWidth > 0;
      evidence.paused = video.paused;
      evidence.ended = video.ended;
      if (!frameCallbacks && evidence.hasFrames && !video.paused && video.currentTime > previousTime + 0.01) evidence.frameAdvancedAt = now;
      previousTime = video.currentTime;
      if (!live) {
        onStatus(video.ended ? 'Recorded clip ended' : evidence.hasFrames ? video.paused ? 'Recorded clip paused' : 'Recorded clip' : now - evidence.startedAt > 25_000 ? 'Video unavailable' : 'Loading recorded clip');
        return;
      }
      if (!hls) {
        evidence.livePlaylist = video.duration === Infinity ? true : null;
        if (video.seekable.length) {
          const end = video.seekable.end(video.seekable.length - 1);
          if (previousRangeEnd !== null && end > previousRangeEnd) evidence.playlistAdvancedAt = now;
          previousRangeEnd = end;
        }
      }
      const status = cameraVideoStatus(evidence, now);
      onStatus(status, evidence.programDateTime === null ? 'Source capture time is unknown. Live status requires advancing video and live playlist updates.' : `Provider video time: ${new Date(evidence.programDateTime).toISOString()}`);
      if (status === 'Source video expired' || status === 'Video unavailable') { failed = true; video.pause(); hls?.stopLoad(); }
    }, 1000);
    return () => {
      disposed = true; clearInterval(timer); hls?.destroy();
      if (frameId !== null) video.cancelVideoFrameCallback(frameId);
      video.removeEventListener('error', onError); video.removeEventListener('loadedmetadata', play);
      video.pause(); video.removeAttribute('src'); video.load();
    };
  }, [url, live, onStatus]);
  return <video ref={videoRef} data-testid="camera-video" autoPlay muted playsInline controls className="w-full h-full object-contain" />;
}
