# Windows Desktop Build

Overseer can run as a Windows desktop program through Electron. The desktop shell starts the existing Next.js app on `127.0.0.1` inside the Electron process, then opens the dashboard in a native window. API routes remain available, so live feeds, OSINT tools, and server-side source checks continue to work.

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

## Windows Installer

Run this on Windows or in a Windows CI runner:

```bash
pnpm install
pnpm run desktop:dist:win
```

Artifacts are written to `release/`:

- NSIS installer for normal installation.
- Portable `.exe` for no-install launches.

For a fast unpacked build during CI or troubleshooting:

```bash
pnpm run desktop:pack:win
```

## Notes

- The Windows app needs outbound network access for the same public data sources used by the web app.
- Code signing is not configured yet. Unsigned installers may trigger Windows SmartScreen warnings.
- The current build config keeps `asar` disabled so Next.js server assets and native packages remain easy to load in the desktop runtime.
