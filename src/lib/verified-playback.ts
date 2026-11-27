export const LIVE_VERIFICATION_MAX_AGE_MS = 90_000;

export function liveVerificationDeadline(value: unknown, feedId: string, now: number, expectedVideoId?: string, maxAgeMs = LIVE_VERIFICATION_MAX_AGE_MS): number | null {
  if (!Number.isFinite(now) || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0 || maxAgeMs > LIVE_VERIFICATION_MAX_AGE_MS) return null;
  if (!value || typeof value !== 'object') return null;
  const result = value as Record<string, unknown>;
  const checked = typeof result.checkedAt === 'string' ? Date.parse(result.checkedAt) : NaN;
  if (result.feedId !== feedId || result.state !== 'ready' || typeof result.videoId !== 'string'
    || !/^[\w-]{11}$/.test(result.videoId) || (expectedVideoId && result.videoId !== expectedVideoId)
    || !Number.isFinite(checked) || checked - now > 5000 || now - checked >= maxAgeMs) return null;
  return checked + maxAgeMs;
}

export function verifiedYouTubeStatus(state: number, advancedAt: number | null, validUntil: number, startedAt: number, now: number): string {
  if (now >= validUntil) return 'Live verification expired';
  if (state === 0) return 'Stream ended';
  if (state === 2) return 'Paused';
  if (state === 3) return 'Buffering';
  if (state === 1) return advancedAt !== null && now - advancedAt <= 10_000 ? 'Live video'
    : now - startedAt > 10_000 ? 'Video stalled' : 'Checking playback';
  return now - startedAt > 25_000 ? 'Video unavailable' : 'Ready to play';
}
