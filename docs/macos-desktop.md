# macOS Desktop Build

Overseer can run as a macOS desktop app through Electron. The desktop shell starts the existing Next.js app on `127.0.0.1` inside the Electron process, then opens the dashboard in a native macOS window. API routes remain available, so live feeds, OSINT tools, and server-side source checks continue to work.

The startup window tracks separate lifecycle states: initializing, preparing
runtime, binding, server ready, dashboard loading, dashboard interactive,
retrying, stopping, and failed. Feed/provider health is independent from
dashboard interactivity; an optional provider outage should not prevent the app
shell from opening.

## Development

```bash
pnpm install
pnpm run desktop:dev
```

`desktop:dev` starts `next dev` on `127.0.0.1:3000` and launches Electron against that dev server. To use a different dev port:

```bash
OVERSEER_DESKTOP_DEV_PORT=3005 pnpm run desktop:dev
```

## Local Production Smoke Test

```bash
pnpm run desktop:start
```

This builds Next.js and launches Electron in production mode. The desktop process chooses an available local port starting at `45454`. Set `OVERSEER_DESKTOP_PORT` to prefer a different port.

To smoke-test the current packaged app bundle:

```bash
OVERSEER_DESKTOP_BINARY=release/mac-arm64/Overseer.app/Contents/MacOS/Overseer pnpm run smoke:desktop
```

The smoke test launches the selected binary, verifies the app-owned
`/api/health` identity, checks the dashboard app shell and static assets,
attaches to the Electron renderer, confirms dashboard hydration, verifies a
visible map or actionable map error, opens layer controls and source details,
then closes the process with bounded cleanup. Live provider verification remains
separate.

## macOS App Bundle

For a fast unpacked Apple Silicon build:

```bash
pnpm run desktop:pack:mac
```

The app bundle is written to `release/mac-arm64/Overseer.app`.

This command builds an unsigned developer directory package. On the local Codex
host, this artifact was launched and passed `pnpm run smoke:desktop` with
`OVERSEER_DESKTOP_BINARY` pointing at the packaged app binary.

For Intel Macs, build on an Intel Mac or the native Intel CI runner:

```bash
pnpm run desktop:pack:mac:intel
```

The Intel bundle is `release/mac/Overseer.app`. Both architectures have native
build/renderer-smoke CI jobs; a cross-build alone is not native runtime validation.

## macOS DMG And ZIP

```bash
pnpm run desktop:dist:mac
# On an Intel Mac:
pnpm run desktop:dist:mac:intel
```

Artifacts are written to `release/`:

- `.dmg` for drag-and-drop installation.
- `.zip` for direct archive distribution.

Filenames end in `-arm64` for Apple Silicon or `-x64` for Intel. The commands
above are explicitly unsigned developer builds. For real Developer ID signing,
notarization, protected credentials, and exact-artifact validation, follow
[macOS signing setup](macos-signing.md).

## Notes

- The macOS app needs outbound network access for the same public data sources used by the web app.
- Runtime data, source snapshots, and rotated startup logs are stored below the
  per-user Electron `userData` directory, not inside the installed application
  bundle.
- Existing unsigned releases remain unsigned. Do not disable Gatekeeper to work
  around installation failures; prefer a verified signed/notarized release.
- Intel support uses a separate `x64` build, not a universal binary. Actual Apple
  signing and notarization require the maintainer's Developer ID and API credentials.
