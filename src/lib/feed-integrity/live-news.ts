import { getLiveNewsFeed, type LiveNewsFeed } from '../live-news-catalog';

export interface LiveNewsPlayback {
  feedId: string;
  state: 'ready' | 'external' | 'unavailable';
  videoId: string | null;
  watchUrl: string;
  checkedAt: string;
  reason: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Read the provider's JSON object without executing its surrounding scripts.
function playerResponse(html: string): unknown {
  const marker = /(?:var\s+ytInitialPlayerResponse|(?:window\s*\[\s*["']ytInitialPlayerResponse["']\s*\])|ytInitialPlayerResponse)\s*=\s*(\{)/g;
  const match = marker.exec(html);
  if (!match) return null;
  const start = marker.lastIndex - 1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < html.length; index++) {
    const char = html[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) {
      try { return JSON.parse(html.slice(start, index + 1)); } catch { return null; }
    }
  }
  return null;
}

export function resolveLiveNewsPage(feed: LiveNewsFeed, html: string, checkedAt: string): LiveNewsPlayback {
  const result: LiveNewsPlayback = { feedId: feed.id, state: 'unavailable', videoId: null, watchUrl: feed.url,
    checkedAt, reason: 'The broadcaster did not provide a verifiable current live video.' };
  const player = playerResponse(html);
  if (!isRecord(player) || !isRecord(player.videoDetails) || !isRecord(player.playabilityStatus)) return result;
  const details = player.videoDetails;
  const status = player.playabilityStatus;
  if (details.channelId !== feed.channel_id || typeof details.videoId !== 'string' || !/^[\w-]{11}$/.test(details.videoId)) return result;
  // isLiveContent alone also labels archived broadcasts. It is not evidence
  // that this video is currently live.
  const microformat = isRecord(player.microformat) && isRecord(player.microformat.playerMicroformatRenderer)
    ? player.microformat.playerMicroformatRenderer : null;
  const live = details.isLive === true || (isRecord(microformat?.liveBroadcastDetails) && microformat.liveBroadcastDetails.isLiveNow === true);
  if (!live || details.isUpcoming === true) return { ...result, reason: 'This channel is not broadcasting live right now.' };
  if (status.status !== 'OK') return { ...result, reason: 'The provider currently restricts or cannot play this live broadcast.' };
  if (status.playableInEmbed !== true) return { ...result, state: 'external', reason: 'This broadcast is available on the provider site; embedding is restricted or unconfirmed.' };
  return { ...result, state: 'ready', videoId: details.videoId,
    watchUrl: `https://www.youtube.com/watch?v=${details.videoId}`, reason: null };
}

async function readPage(response: Response): Promise<string> {
  const limit = 3 * 1024 * 1024;
  if (!/text\/html/i.test(response.headers.get('content-type') || '')) throw new Error('Unexpected broadcaster response format.');
  if (!response.body || Number(response.headers.get('content-length')) > limit) throw new Error('Broadcaster response exceeds the size limit or is empty.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let html = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw new Error('Broadcaster response exceeds the size limit.');
      html += decoder.decode(value, { stream: true });
    }
    return html + decoder.decode();
  } finally { await reader.cancel().catch(() => {}); }
}

export function createLiveNewsResolver(options: { fetcher?: typeof fetch; now?: () => number; timeoutMs?: number } = {}) {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { result: LiveNewsPlayback; expiresAt: number; storedAt: number }>();
  const pending = new Map<string, Promise<LiveNewsPlayback>>();

  async function collect(feed: LiveNewsFeed): Promise<LiveNewsPlayback> {
    const checkedAt = new Date(now()).toISOString();
    if (!feed.channel_id) return { feedId: feed.id, state: 'external', videoId: null, watchUrl: feed.url, checkedAt,
      reason: 'This broadcaster provides an external player.' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10000);
    try {
      const response = await fetcher(feed.url, { cache: 'no-store', signal: controller.signal,
        headers: { Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' } });
      if (!response.ok) throw new Error(`Broadcaster returned HTTP ${response.status}.`);
      return resolveLiveNewsPage(feed, await readPage(response), checkedAt);
    } catch (error) {
      return { feedId: feed.id, state: 'unavailable', videoId: null, watchUrl: feed.url, checkedAt,
        reason: controller.signal.aborted ? 'The live broadcast check timed out.' : error instanceof Error ? error.message : 'The broadcaster could not be reached.' };
    } finally { clearTimeout(timer); }
  }

  return {
    async resolve(id: string, refresh = false): Promise<LiveNewsPlayback | null> {
      const feed = getLiveNewsFeed(id);
      if (!feed) return null;
      const cached = cache.get(id);
      if (cached && cached.expiresAt > now() && (!refresh || now() - cached.storedAt < 5000)) return cached.result;
      let work = pending.get(id);
      if (!work) {
        work = collect(feed).then((result) => {
          cache.set(id, { result, storedAt: now(), expiresAt: now() + (result.state === 'ready' ? 60000 : 15000) });
          return result;
        }).finally(() => { pending.delete(id); });
        pending.set(id, work);
      }
      return work;
    },
  };
}
