class ProxyFailure extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const TYPES = new Set(['application/json', 'application/octet-stream', 'application/x-protobuf',
  'application/vnd.mapbox-vector-tile', 'image/png', 'image/jpeg', 'image/webp']);

export async function proxyTile(value: string | null, options: { fetcher?: typeof fetch; timeoutMs?: number; maxBytes?: number } = {}): Promise<Response> {
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  let target: URL;
  try {
    if (!value || value.length > 4096) throw new Error();
    target = new URL(value);
  } catch { return Response.json({ error: 'Invalid tile URL' }, { status: 400, headers }); }
  if (target.protocol !== 'https:' || target.username || target.password || target.hash
    || (target.port && target.port !== '443')
    || !(target.hostname === 'cartocdn.com' || target.hostname.endsWith('.cartocdn.com'))) {
    return Response.json({ error: 'Forbidden tile URL' }, { status: 403, headers });
  }

  const controller = new AbortController();
  const maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new ProxyFailure(504, 'Tile provider timed out'));
    }, options.timeoutMs ?? 10_000);
  });
  try {
    return await Promise.race([deadline, (async () => {
      const upstream = await (options.fetcher ?? fetch)(target, {
        redirect: 'error', cache: 'no-store', signal: controller.signal,
        headers: { Accept: 'application/json, image/png, image/jpeg, image/webp, application/x-protobuf, application/octet-stream', 'User-Agent': 'Overseer-Tile-Proxy/1.0' },
      });
      if (!upstream.ok || upstream.redirected) throw new ProxyFailure(502, 'Tile provider failed');
      const type = upstream.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
      if (!type || !TYPES.has(type)) throw new ProxyFailure(502, 'Invalid tile content type');
      const length = upstream.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
        throw new ProxyFailure(502, 'Tile response exceeds the size limit');
      }
      if (!upstream.body) throw new ProxyFailure(502, 'Empty tile response');
      reader = upstream.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > maxBytes) throw new ProxyFailure(502, 'Tile response exceeds the size limit');
        chunks.push(chunk.value);
      }
      if (!size) throw new ProxyFailure(502, 'Empty tile response');
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return new Response(bytes, { headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' } });
    })()]);
  } catch (error) {
    const failure = timedOut ? new ProxyFailure(504, 'Tile provider timed out')
      : error instanceof ProxyFailure ? error : new ProxyFailure(502, 'Tile provider failed');
    return Response.json({ error: failure.message }, { status: failure.status, headers });
  } finally {
    clearTimeout(timer!);
    controller.abort();
    void reader?.cancel().catch(() => {});
  }
}
