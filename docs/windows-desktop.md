# Windows Desktop Installation

## Install Without Developer Tools

Use the `Overseer-Windows-x64-...` artifact from a successful
[Desktop Packages workflow run](https://github.com/UrMom-dev-new/Overseer/actions/workflows/desktop-packages.yml).
Extract the downloaded ZIP and double-click `Overseer-Setup-<version>-x64.exe`.
The installer includes the application runtime, installs for the current user,
and creates Start menu and desktop shortcuts. Git, Node.js, pnpm, and Docker
are not prerequisites on the destination PC. Internet access is needed for
live sources.

If no artifact exists, a maintainer must run the workflow after the installer
changes are merged or pushed to a branch. Downloads require GitHub sign-in;
workflow artifacts expire after 30 days. No public release is implied by a
successful build. Maintainers can later publish the verified EXEs, checksums,
and build identity as a GitHub Release.

`Overseer-Portable-<version>-x64.exe` is the no-install alternative. The
installer and portable application intentionally have different filenames.
The portable application still writes per-user settings and logs.

To update, close Overseer and run the newer setup executable. Settings and
source snapshots are stored outside the installation folder and are preserved
on uninstall. Automatic updates and code signing are not configured.

## What The Desktop Package Includes

The dashboard and its Next.js API routes run locally. Optional AI/scanner/AIS
features require their documented credentials or services. The separate
`intel/` service is not bundled: entity graph expansion requires a reachable
service configured with `INTEL_URL`. A working desktop window does not establish
that every external provider is available.

## Troubleshooting

- Startup errors: use **Retry**, **Open logs**, or **Copy diagnostics** in the
  startup window. Default logs are under `%APPDATA%\\overseer\\logs`.
- Missing feeds: inspect **Data Sources** and the individual provider errors.
- Port conflicts: startup tries available loopback ports starting at 45454.
- Unknown publisher: these are unsigned builds. Check the source commit and
  checksum; do not disable Windows security protections to install them.
- Use Windows **Settings → Apps** to uninstall Overseer.

## Build And Verify As A Maintainer

Overseer can run as a Windows desktop program through Electron. The desktop shell starts the existing Next.js app on `127.0.0.1` inside the Electron process, then opens the dashboard in a native window. API routes remain available, so live feeds, OSINT tools, and server-side source checks continue to work.

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

## Windows Installer

Run this on Windows or in a Windows CI runner:

```bash
pnpm install
pnpm run desktop:dist:win
```

Artifacts are written to `release/`:

- `Overseer-Setup-<version>-x64.exe` — per-user NSIS installer.
- `Overseer-Portable-<version>-x64.exe` — no-install launcher.

For a fast unpacked build during CI or troubleshooting:

```bash
pnpm run desktop:pack:win
```

The unpacked artifact is written to `release/win-unpacked/Overseer.exe`. Cross-packaging can be run from macOS, but the executable smoke test should run on a Windows host:

```powershell
$env:OVERSEER_DESKTOP_BINARY = "release\win-unpacked\Overseer.exe"
pnpm run smoke:desktop
```

The smoke test launches the selected binary from an unrelated temporary
directory with an isolated user profile. It verifies the app-owned
`/api/health` identity, dashboard HTML, referenced static assets, source manifest,
and main-frame startup log, then closes the process. Reports are retained in
the temporary directory or `OVERSEER_DESKTOP_SMOKE_REPORT_DIR`.
It does not prove renderer hydration, map interaction, or live provider health.
A macOS cross-package build does not prove launch on Windows.

The Windows CI job builds both EXEs, silently installs into a temporary path
containing spaces, checks the installed executable, repeats installation to
exercise the reinstall path, checks the portable EXE, and uninstalls. This is
not a cross-version migration test. Downloads are uploaded only after those
checks pass; diagnostic logs are retained on failure too.

## Notes

- The Windows app needs outbound network access for the same public data sources used by the web app.
- Runtime data, source snapshots, and rotated startup logs are stored below the
  per-user Electron `userData` directory, not inside the installed application
  directory.
- Code signing is not configured yet. Unsigned installers may trigger Windows SmartScreen warnings.
- A signed release should fail its protected release gate when credentials are unavailable instead of silently relabeling an unsigned build.
- The current build config keeps `asar` disabled so Next.js server assets and native packages remain easy to load in the desktop runtime.
