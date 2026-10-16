'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, ExternalLink, MapPin, Maximize2, RefreshCw, Video, X } from 'lucide-react';
import { cameraMedia, type CameraMedia } from '@/lib/camera-media';
import CameraVideoPlayer from './CameraVideoPlayer';
import CameraYouTubePlayer from './CameraYouTubePlayer';
import CameraSnapshot from './CameraSnapshot';

interface CameraRecord {
  id?: string;
  name: string;
  lat?: number;
  lng?: number;
  city?: string;
  country?: string;
  source?: string;
  feed_url?: string;
  stream_url?: string;
  stream_type?: string;
  external_url?: string;
  snapshot_interval_ms?: number;
  attribution?: string;
  observed_at?: string;
}

interface CameraViewerProps { camera: CameraRecord | null; onClose: () => void; onLocate?: (lat: number, lng: number) => void }

export default function CameraViewer({ camera, ...props }: CameraViewerProps) {
  return camera ? <CameraDialog key={`${camera.id}:${camera.stream_url}:${camera.feed_url}`} camera={camera} {...props} /> : null;
}

function CameraDialog({ camera, onClose, onLocate }: CameraViewerProps & { camera: CameraRecord }) {
  const [snapshot, setSnapshot] = useState(false);
  const [retry, setRetry] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [status, setStatus] = useState('Checking camera');
  const [detail, setDetail] = useState<string | null>(null);
  const onStatus = useCallback((label: string, message?: string) => { setStatus(label); setDetail(message ?? null); }, []);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const media = cameraMedia(camera);
  const selected: CameraMedia = snapshot && media.snapshotUrl ? { ...media, kind: 'snapshot', url: media.snapshotUrl } : media;
  const hasCoordinates = typeof camera.lat === 'number' && Number.isFinite(camera.lat) && typeof camera.lng === 'number' && Number.isFinite(camera.lng);
  const isLive = status === 'Live video';
  const failed = /unavailable|expired|stalled|not a live/i.test(status);
  const modes = media.snapshotUrl && media.kind !== 'snapshot';

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); onCloseRef.current(); }
      if (event.key !== 'Tab') return;
      const items = dialogRef.current?.querySelectorAll<HTMLElement>('button,a[href],video,iframe');
      if (!items?.length) return;
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items[items.length - 1].focus(); }
      if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0].focus(); }
    };
    document.addEventListener('keydown', keydown, true);
    return () => { document.removeEventListener('keydown', keydown, true); previous?.focus(); };
  }, []);

  useEffect(() => {
    if (selected.kind === 'external') onStatus('External player', 'Playback must be opened on the provider site. Live status is unverified.');
    if (selected.kind === 'embed') onStatus('Loading provider player', 'Provider-controlled player. Live playback is unverified.');
    if (selected.kind === 'unavailable') onStatus('Video unavailable', 'This catalog record has no usable media access URL.');
  }, [selected.kind, onStatus, retry]);

  return <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="camera-viewer-title" data-testid="camera-viewer"
    className={`fixed z-[600] flex flex-col max-h-[92svh] overflow-auto rounded-md border border-white/25 bg-[#0b0b0b] text-white shadow-2xl ${fullscreen ? 'inset-3' : 'left-2 right-2 bottom-[76px] md:left-auto md:right-5 md:bottom-6 md:w-[620px]'}`}>
    <header className="border-b border-white/15 p-3">
      <div className="flex items-start gap-2">
        <Camera className="mt-1 h-4 w-4 shrink-0 text-[#80CBC4]" />
        <div className="min-w-0 flex-1">
          <h2 id="camera-viewer-title" className="font-mono text-sm break-words">{camera.name}</h2>
          <p className="text-xs text-white/60 break-words">{[camera.city, camera.country, camera.source].filter(Boolean).join(' · ')}</p>
        </div>
        <button type="button" title="Retry camera" aria-label="Retry camera" onClick={() => setRetry((value) => value + 1)} className="p-2 shrink-0 hover:bg-white/10 rounded"><RefreshCw size={16} /></button>
        {hasCoordinates && onLocate && <button type="button" title="Locate camera" aria-label="Locate camera" onClick={() => onLocate(camera.lat!, camera.lng!)} className="p-2 shrink-0 hover:bg-white/10 rounded"><MapPin size={16} /></button>}
        <button type="button" title="Toggle camera fullscreen" aria-label="Toggle camera fullscreen" aria-pressed={fullscreen} onClick={() => setFullscreen((value) => !value)} className="hidden sm:block p-2 shrink-0 hover:bg-white/10 rounded"><Maximize2 size={16} /></button>
        <button ref={closeRef} type="button" title="Close camera" aria-label="Close camera" onClick={onClose} className="p-2 shrink-0 hover:bg-white/10 rounded"><X size={16} /></button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
        <span role="status" data-testid="camera-playback-status" className={`text-xs font-mono ${isLive ? 'text-[#69F0AE]' : failed ? 'text-[#FF8A80]' : 'text-white/70'}`}>{status}</span>
        {modes && <div className="flex border border-white/20 rounded" aria-label="Camera media mode">
          <button type="button" title="Video" aria-label="Show camera video" aria-pressed={!snapshot} onClick={() => setSnapshot(false)} className={`p-2 ${!snapshot ? 'bg-white/20' : ''}`}><Video size={15} /></button>
          <button type="button" title="Snapshot, not live video" aria-label="Show camera snapshot" aria-pressed={snapshot} onClick={() => setSnapshot(true)} className={`p-2 ${snapshot ? 'bg-white/20' : ''}`}><Camera size={15} /></button>
        </div>}
      </div>
    </header>
    <div className={`relative bg-black w-full ${fullscreen ? 'flex-1 min-h-[200px]' : 'aspect-video min-h-[200px]'}`}>
      {selected.url && <div key={`${selected.kind}:${retry}`} className="absolute inset-0">
        {selected.kind === 'hls' || selected.kind === 'clip' ? <CameraVideoPlayer url={selected.url} live={selected.kind === 'hls'} onStatus={onStatus} /> :
          selected.kind === 'youtube' && selected.videoId ? <CameraYouTubePlayer url={selected.url} videoId={selected.videoId} onStatus={onStatus} /> :
          selected.kind === 'snapshot' ? <CameraSnapshot url={selected.url} name={camera.name} intervalMs={Math.max(5000, Math.min(86_400_000, camera.snapshot_interval_ms || 5000))} onStatus={onStatus} /> :
          selected.kind === 'embed' ? <iframe title={`${camera.name} provider player`} src={selected.url} className="w-full h-full border-0" allow="autoplay; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"
            onLoad={() => onStatus('Provider player unverified', 'The provider player loaded. This does not verify that the camera is live.')}
            onError={() => onStatus('Provider player unavailable', 'Open the provider directly.')} /> : null}
      </div>}
      {(selected.kind === 'external' || selected.kind === 'unavailable' || (failed && selected.kind === 'youtube')) && <div className="absolute inset-0 flex flex-col items-center justify-center p-5 gap-3 text-center text-sm bg-black/90">
        <Camera size={24} className="text-white/50" /><p>{detail || 'Camera unavailable.'}</p>
        {media.providerUrl && <a href={media.providerUrl} target="_blank" rel="noopener noreferrer" className="text-[#81D4FA] inline-flex gap-2 items-center"><ExternalLink size={14} />Open provider</a>}
      </div>}
    </div>
    <footer className="p-3 border-t border-white/15 text-xs text-white/65 space-y-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1 justify-between">
        <span>{selected.kind === 'snapshot' ? 'Still image · not live video' : selected.kind === 'clip' ? 'Recorded clip · not a live stream' : selected.kind === 'hls' ? 'HLS video · checked during playback' : selected.kind === 'youtube' ? 'YouTube · current live video check' : 'Provider playback · unverified'}</span>
        {media.providerUrl && <a href={media.providerUrl} target="_blank" rel="noopener noreferrer" title="Open camera provider" aria-label="Open camera provider" className="inline-flex gap-1 items-center text-[#81D4FA]"><ExternalLink size={13} />Provider</a>}
      </div>
      {detail && <p className="break-words" data-testid="camera-playback-detail">{detail}</p>}
      {camera.attribution && <p className="break-words">{camera.attribution}</p>}
      {camera.observed_at && <p className="break-words">Catalog image observation: {camera.observed_at}</p>}
      {hasCoordinates && <p className="font-mono text-[10px] text-white/45">{camera.id} · {camera.lat!.toFixed(4)}, {camera.lng!.toFixed(4)}</p>}
    </footer>
  </div>;
}
