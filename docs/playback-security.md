# Playback Verification And Desktop Security

## Playback Evidence

HLS cameras require decoded frames, advancing frame callbacks (or playback time
where callbacks are unsupported), and advancing live-playlist updates. VOD
playlists, expired provider capture times, stalled frames, failed requests, and
blocked autoplay cannot keep a live label. A failure never substitutes a snapshot.

Camera and news YouTube viewers use the same lifecycle controller. A matching
provider check retains the existing 45-second camera limit; news checks have a
90-second limit because the news resolver caches for 60 seconds. Rechecking an
old response does not renew its original expiry.
The controller polls every 30 seconds and stops playback on expiry, provider
failure, terminal player error, or end. Retry creates a new controller. A player
"playing" callback alone is insufficient; playback time must advance. Pause and
buffer events invalidate previous advancement evidence.

YouTube playback time is provider SDK evidence, not independently inspected
decoded frames inside a cross-origin iframe. Provider embedding restrictions
are respected, not bypassed.

Run `pnpm exec playwright install chromium`, then `pnpm run test:playback`.
The offline suite mounts the production viewer components with generated HLS
test patterns and a controlled YouTube SDK double. It verifies actual HLS frames
and pixels but does not claim real broadcaster availability. See
[the fixture documentation](../playback-tests/README.md). No fixture route,
camera, stream, or footage is installed in the application. CI runs playback
tests separately from real-source and native installed-app checks.

## Desktop Boundary

- The production HTTP listener binds only to `127.0.0.1`. It rejects nonlocal
  peers, unexpected Host/port values, cross-origin or opaque browser origins,
  cross-site/same-site fetch contexts, and absolute/protocol-relative targets.
  Originless local CLI checks and internal server fetches remain supported.
- This is a browser-origin/DNS-rebinding boundary, not authentication against
  another process or user already able to access loopback on the same machine.
- Production packages cannot load `OVERSEER_ELECTRON_URL`. Unpackaged development
  accepts only credential-free HTTP `127.0.0.1` URLs.
- Renderer sandboxing, context isolation, web security, and disabled Node
  integration are explicit. Webviews and new child windows are denied. External
  links allow only HTTP, HTTPS, or mailto without credentials/control characters.
- Main-frame redirects cannot leave the app origin. Provider iframe redirects
  remain separate so legitimate video embeds are not broken by this boundary.
- Device and remote-content permissions are denied. Only sanitized clipboard
  writes by the owning top-level application document are allowed; clipboard
  reads, device capture, location, notifications, and iframe requests are denied.
- Startup IPC requires the owning webContents and its main frame, plus the exact
  packaged startup file URL or current app origin. A file merely named
  `startup.html` is not trusted.
- Native desktop smoke checks verify renderer isolation/preload availability
  and reject untrusted browser-origin requests through the real listener.

## Tile Proxy

Only credential-free HTTPS CARTO CDN URLs on the standard port are accepted.
Redirect following is disabled. The complete fetch/body has a ten-second
deadline and an eight-MiB limit, including responses without Content-Length.
Only known tile/style/font content types are returned, with `nosniff`; cookies,
upstream headers, HTML, SVG, and permissive CORS headers are not forwarded.
Failed responses are not cached. Browser caching for successful assets is kept.

## Dependency Review

The November 27, 2026 production audit identified vulnerable Next.js, MapLibre,
Sharp, SheetJS, PostCSS, and source-map-js dependencies. The upgrade retains
Next.js 16 and Electron 44 major lines, migrates MapLibre to its patched ESM v6
worker setup, and uses the vendor's integrity-locked SheetJS 0.20.3 tarball.
Next's Webpack mode is explicit in build/development commands because the
patched MapLibre ESM bundle's dynamic worker URL fails Turbopack resolution in
the maintained Next 16 line. The worker itself uses the vendor-documented
literal asset URL and remains part of the locally built application.
PostCSS/source-map overrides keep vulnerable transitives out of the dependency
graph. CI blocks high/critical production advisories; registry/network failures
do not count as a successful audit. Audit results are point-in-time evidence,
not a claim of complete vulnerability coverage or a full penetration test.

References: [Electron security](https://www.electronjs.org/docs/latest/tutorial/security),
[Next.js Windows advisory](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36),
[SheetJS distribution](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/),
[MapLibre bundler setup](https://maplibre.org/maplibre-gl-js/docs/).
