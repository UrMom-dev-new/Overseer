# macOS Desktop Build

Overseer can run as a macOS desktop app through Electron. The desktop shell starts the existing Next.js app on `127.0.0.1` inside the Electron process, then opens the dashboard in a native macOS window. API routes remain available, so live feeds, OSINT tools, and server-side source checks continue to work.

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

## macOS App Bundle

For a fast unpacked Apple Silicon build:

```bash
pnpm run desktop:pack:mac
```

The app bundle is written to `release/mac-arm64/Overseer.app`.

## macOS DMG And ZIP

```bash
pnpm run desktop:dist:mac
```

Artifacts are written to `release/`:

- `.dmg` for drag-and-drop installation.
- `.zip` for direct archive distribution.

## Notes

- The macOS app needs outbound network access for the same public data sources used by the web app.
- Code signing and notarization are not configured yet. Unsigned builds may require right-click Open or a local Gatekeeper exception on other Macs.
- The current script targets Apple Silicon (`arm64`). Intel or universal builds can be added later once native dependency packaging is verified for those targets.
