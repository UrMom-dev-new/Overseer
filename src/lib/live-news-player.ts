export function liveNewsEmbedUrl(videoId: string, origin: string): string {
  if (!/^[\w-]{11}$/.test(videoId)) throw new Error('Invalid live video ID.');
  const page = new URL(origin);
  if (!['http:', 'https:'].includes(page.protocol)) throw new Error('A web origin is required for playback.');
  const url = new URL(`https://www.youtube.com/embed/${videoId}`);
  url.search = new URLSearchParams({ autoplay: '1', mute: '1', playsinline: '1', enablejsapi: '1', origin: page.origin }).toString();
  return url.toString();
}

export function liveNewsPlayerError(code: number): string {
  switch (code) {
    case 100: return 'This broadcast has ended or is no longer available.';
    case 101:
    case 150: return 'The broadcaster does not allow this video to play inside other applications.';
    case 153: return 'YouTube could not identify this player. Open the broadcaster directly or retry.';
    default: return 'The provider could not play this broadcast. Retry or open the broadcaster directly.';
  }
}
