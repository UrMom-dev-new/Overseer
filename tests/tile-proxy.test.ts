import assert from 'node:assert/strict';
import { test } from 'node:test';
import { proxyTile } from '../src/lib/tile-proxy';

const url = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const json = () => Response.json({ version: 8 });

test('tile proxy rejects unsafe URLs before contacting any upstream', async () => {
  let calls = 0;
  for (const value of [null, '', 'invalid', 'http://cartocdn.com/tile', 'https://cartocdn.com.evil.example/tile',
    'https://127.0.0.1/tile', 'https://cartocdn.com:8443/tile', 'https://u:p@cartocdn.com/tile', 'file:///tmp/data',
    'https://evil.example@cartocdn.com/tile', 'https://cartocdn.com/tile#secret']) {
    const response = await proxyTile(value, { fetcher: async () => { calls++; return json(); } });
    assert.ok([400, 403].includes(response.status), String(value));
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(calls, 0);
});

test('tile requests disable redirects and preserve only safe content headers', async () => {
  const response = await proxyTile(url, { fetcher: async (target, options) => {
    assert.equal(String(target), url);
    assert.equal(options?.redirect, 'error');
    assert.equal(options?.cache, 'no-store');
    assert.ok(options?.signal);
    return new Response('{"version":8}', { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': 'secret=value' } });
  } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { version: 8 });
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('redirects, errors, HTML, SVG, and missing content types fail closed', async () => {
  for (const response of [new Response(null, { status: 302, headers: { Location: 'http://localhost/private' } }),
    new Response('no', { status: 503 }), new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } }),
    new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml' } }), new Response(new Uint8Array([1]))]) {
    assert.equal((await proxyTile(url, { fetcher: async () => response })).status, 502);
  }
});

test('tile size limits apply to content-length and chunked bodies', async () => {
  for (const contentLength of ['100', '-1', 'nonsense', '1', null]) {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(11)); }, cancel() { cancelled = true; } });
    const headers: Record<string, string> = { 'Content-Type': 'image/png' };
    if (contentLength !== null) headers['Content-Length'] = contentLength;
    const result = await proxyTile(url, { maxBytes: 10, fetcher: async () => new Response(body, { headers }) });
    assert.equal(result.status, 502);
    if (contentLength === null) assert.equal(cancelled, true);
  }
});

test('the deadline covers fetch and stalled response bodies, including noncooperating upstreams', async () => {
  const fetchers: typeof fetch[] = [async () => new Promise(() => {}),
    async (_url, options) => new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new Error('aborted')))),
    async () => new Response(new ReadableStream(), { headers: { 'Content-Type': 'image/png' } })];
  for (const fetcher of fetchers) {
    assert.equal((await proxyTile(url, { fetcher, timeoutMs: 10 })).status, 504);
  }
});
