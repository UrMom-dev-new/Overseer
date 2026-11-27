'use client';

import VerifiedYouTubePlayer from './VerifiedYouTubePlayer';
import type { CameraStatusHandler } from './CameraVideoPlayer';

export default function CameraYouTubePlayer({ url, videoId, onStatus }: { url: string; videoId: string; onStatus: CameraStatusHandler }) {
  return <VerifiedYouTubePlayer endpoint={`/api/cctv/stream-status?url=${encodeURIComponent(url)}`}
    feedId={videoId} expectedVideoId={videoId} maxAgeMs={45_000} title="Camera live video" onStatus={onStatus} />;
}
