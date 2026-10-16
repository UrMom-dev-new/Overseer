export type YouTubePlayer = { destroy(): void; mute(): void; playVideo(): void; getPlayerState(): number; getCurrentTime(): number };
export type YouTubePlayerEvent = { target: YouTubePlayer; data: number };
export type YouTubeApi = { Player: new (element: HTMLIFrameElement, options: { events: {
  onReady(event: YouTubePlayerEvent): void; onStateChange(event: YouTubePlayerEvent): void;
  onError(event: YouTubePlayerEvent): void; onAutoplayBlocked(): void;
} }) => YouTubePlayer };
type PlayerWindow = Window & { YT?: YouTubeApi; onYouTubeIframeAPIReady?: () => void };
let apiPromise: Promise<YouTubeApi> | null = null;

export function loadYouTubePlayerApi(): Promise<YouTubeApi> {
  const host = window as PlayerWindow;
  if (host.YT?.Player) return Promise.resolve(host.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<YouTubeApi>((resolve, reject) => {
    const script = document.createElement('script');
    const previous = host.onYouTubeIframeAPIReady;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      host.onYouTubeIframeAPIReady = previous;
      if (error) { script.remove(); reject(error); }
      else if (host.YT?.Player) resolve(host.YT);
      else reject(new Error('The provider player could not initialize.'));
    };
    const timer = setTimeout(() => finish(new Error('The provider player did not respond.')), 12000);
    host.onYouTubeIframeAPIReady = () => { finish(); previous?.(); };
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => finish(new Error('The provider player could not be loaded.'));
    document.head.appendChild(script);
  }).catch((error) => { apiPromise = null; throw error; });
  return apiPromise;
}
