export type CameraMediaKind = 'hls' | 'youtube' | 'snapshot' | 'clip' | 'embed' | 'external' | 'unavailable';
export interface CameraMedia {
  kind: CameraMediaKind;
  url: string | null;
  snapshotUrl: string | null;
  providerUrl: string | null;
  videoId: string | null;
}

export function cameraUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.toString() : null;
  } catch { return null; }
}

export function cameraYouTubeId(value: unknown): string | null {
  const text = cameraUrl(value);
  if (!text) return null;
  const url = new URL(text);
  if (!['www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com', 'youtube-nocookie.com'].includes(url.hostname)) return null;
  const id = url.pathname.startsWith('/embed/') ? url.pathname.split('/')[2] : url.pathname === '/watch' ? url.searchParams.get('v') : null;
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

export function cameraMedia(camera: unknown): CameraMedia {
  const empty: CameraMedia = { kind: 'unavailable', url: null, snapshotUrl: null, providerUrl: null, videoId: null };
  if (!camera || typeof camera !== 'object') return empty;
  const record = camera as Record<string, unknown>;
  const stream = cameraUrl(record.stream_url);
  const image = cameraUrl(record.feed_url);
  const external = cameraUrl(record.external_url);
  const isImage = (url: string) => /\.(?:jpe?g|png|webp)(?:$|\?)/i.test(url) || /\/axis-cgi\/jpg\//i.test(url);
  const snapshotUrl = image && !cameraYouTubeId(image) && !/\.(?:m3u8|mp4)(?:$|\?)/i.test(image) && record.stream_type !== 'iframe' ? image :
    stream && (record.stream_type === 'jpg' || isImage(stream)) ? stream : null;
  const base = { snapshotUrl, providerUrl: external || stream || image, videoId: null };
  for (const url of [stream, image]) {
    if (!url) continue;
    if (/\.m3u8(?:$|\?)/i.test(url) || (url === stream && record.stream_type === 'hls' && !isImage(url))) return { ...base, kind: 'hls', url };
    const videoId = cameraYouTubeId(url);
    if (videoId) return { ...base, kind: 'youtube', url, videoId };
    if (/\.mp4(?:$|\?)/i.test(url) || (url === stream && record.stream_type === 'mp4')) return { ...base, kind: 'clip', url };
  }
  if (record.stream_type === 'iframe' && stream) {
    const host = new URL(stream).hostname;
    return { ...base, kind: ['ipcamlive.com', 'www.ipcamlive.com', 'rtsp.me', 'www.rtsp.me'].includes(host) ? 'embed' : 'external', url: stream, snapshotUrl: null };
  }
  if (snapshotUrl) return { ...base, kind: 'snapshot', url: snapshotUrl };
  return external ? { ...base, kind: 'external', url: external } : empty;
}

export function cameraMediaGroup(camera: unknown): 'live' | 'snapshots' | 'external' | 'unavailable' {
  const { kind } = cameraMedia(camera);
  return kind === 'hls' || kind === 'youtube' ? 'live' : kind === 'snapshot' || kind === 'clip' ? 'snapshots' :
    kind === 'embed' || kind === 'external' ? 'external' : 'unavailable';
}

export function cameraSnapshotUrl(url: string, nowMs: number): string {
  const result = new URL(url);
  result.searchParams.set('_overseer', String(nowMs));
  return result.toString();
}

export interface CameraVideoEvidence {
  startedAt: number;
  hasFrames: boolean;
  paused: boolean;
  ended: boolean;
  livePlaylist: boolean | null;
  playlistAdvancedAt: number | null;
  frameAdvancedAt: number | null;
  maxPlaylistSilenceMs: number;
  programDateTime: number | null;
}

export function cameraVideoStatus(evidence: CameraVideoEvidence, nowMs: number): string {
  if (evidence.ended) return 'Stream ended';
  if (evidence.livePlaylist === false) return 'Not a live stream';
  if (!evidence.hasFrames) return nowMs - evidence.startedAt > 25_000 ? 'Video unavailable' : 'Loading video';
  if (evidence.paused) return 'Paused';
  if (evidence.frameAdvancedAt === null || nowMs - evidence.frameAdvancedAt > 10_000) return 'Video stalled';
  if (evidence.programDateTime !== null && (nowMs - evidence.programDateTime > 120_000 || evidence.programDateTime - nowMs > 30_000)) return 'Source video expired';
  if (evidence.playlistAdvancedAt === null) return nowMs - evidence.startedAt > evidence.maxPlaylistSilenceMs ? 'Live updates unavailable' : 'Checking live updates';
  if (nowMs - evidence.playlistAdvancedAt > evidence.maxPlaylistSilenceMs) return 'Live updates stalled';
  return evidence.livePlaylist === true ? 'Live video' : 'Playback unverified';
}
