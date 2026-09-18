# Windows Desktop Installation

## For Beta Testers

Use the latest Windows beta prerelease on the
[Releases page](https://github.com/UrMom-dev-new/Overseer/releases) when one is
published. Download `Overseer-Setup-<version>-x64.exe`, open it, then launch
**Overseer** from the Start menu.

You do not need Git, Node.js, pnpm, Docker, or a terminal. The installer is
per-user and stores settings, source snapshots, and logs outside the
installation directory. To update, close Overseer and run the newer setup
executable. Automatic updates are not configured.

The optional `Overseer-Portable-<version>-x64.exe` is a no-install alternative
for maintainers and advanced testers. It still writes per-user settings and
logs.

Windows beta builds are unsigned unless a release explicitly says otherwise.
Windows may show an unknown-publisher or SmartScreen warning. Do not disable
Windows security protections. Check the release checksum if you need to verify
the file.

## Current Beta Limitations

- The app needs outbound internet access for live public data sources.
- Optional services that require credentials remain disabled until configured.
- The separate `intel/` service is not bundled. Entity graph expansion requires
  `INTEL_URL` to point at a reachable service.
- Live provider outages, stale data, legitimate empty results, and missing
  optional services should appear as labeled unavailable/degraded states, not as
  fabricated records.
- A hosted GitHub runner validates the Windows package automatically, but it is
  not the same as a clean non-developer PC. Record a clean-PC acceptance check
  before handing a build to nontechnical testers.

## Troubleshooting

- Startup errors: use **Retry**, **Open logs**, or **Copy diagnostics** in the
  startup window. Default logs are under `%APPDATA%\\overseer\\logs`.
- Missing feeds: open **Data Sources** and inspect provider availability,
  freshness, accepted/rejected record counts, and route test messages.
- Map warning: if a map resource cannot load, the app should show an actionable
  map issue while keeping panels and source diagnostics usable.
- Port conflicts: startup tries available loopback ports starting at `45454`.
- Unknown publisher: these are unsigned builds. Do not turn off Windows security
  protections to install them.
- Uninstall: use Windows **Settings -> Apps**. Per-user settings are intentionally
  preserved unless manually removed.

## Bug Report Template

```text
Windows version:
Overseer installer filename:
Overseer source commit or release tag:
Expected behavior:
Actual behavior:
Steps to reproduce:
Feed or panel affected:
Diagnostics copied from startup window or Data Sources:
Screenshots or screen recording:
```

## Maintainer Build And Verification

The **Desktop Packages** workflow runs on manual dispatch, qualifying pull
requests, and pushes to `main` that touch desktop/runtime files. Pull requests
run live-source checks in report-only mode so external provider outages do not
publish or block unrelated review. Manual and `main` runs use the live-source
release gate unless the manual dispatch input is intentionally set to
`report-only`.

The Windows job:

- Builds distinct `Overseer-Setup-<version>-x64.exe` and
  `Overseer-Portable-<version>-x64.exe` files.
- Installs silently into a temporary path containing spaces.
- Launches from an unrelated working directory with an isolated user profile.
- Verifies application/API identity, bundled assets, renderer hydration, a
  visible map or actionable map error, layer controls, source details,
  uninstall/reinstall, process cleanup, and documented user-data preservation.
- Verifies the portable EXE as a bounded no-install wrapper launch and cleanup
  path. Full renderer, local-server, and source-detail checks run against the
  installed app, because the portable wrapper does not expose the same
  diagnostics channel in CI.
- Runs the existing live-source verifier against the packaged Windows app's
  actual local server and records `release/live-source-verification.json`.
- Uploads EXEs, `SHA256SUMS.txt`, `build-info.json`, and live-source evidence as
  `Overseer-Windows-x64-<commit>`.

Workflow artifacts are maintainer-only unless promoted to a GitHub prerelease.
They expire after 30 days and require GitHub sign-in.

## Local Maintainer Commands

```powershell
pnpm install --frozen-lockfile
pnpm run lint
pnpm run typecheck
pnpm run test:integrity
pnpm run test:desktop-smoke
pnpm run build
pnpm run smoke:prod
pnpm run desktop:dist:win
.\scripts\test-windows-installer.ps1
```

To verify live sources through a packaged executable:

```powershell
$env:OVERSEER_DESKTOP_BINARY = "release\Overseer-Portable-<version>-x64.exe"
pnpm run verify:packaged-live-sources -- --output=desktop-smoke-results\live-sources.json --mode=release-gate
```

To prepare draft prerelease materials from the exact tested files, download or
copy the workflow artifact into `release/`, then run:

```powershell
pnpm run prepare:windows-beta-release -- --artifact-dir=release --commit=<commit> --workflow-run-url=<workflow-run-url>
```

Add `--create-draft` only when you are ready to create a GitHub draft
prerelease. This command does not rebuild binaries.

## Clean-PC Acceptance Checklist

Run this on a supported Windows x64 client using a normal user account and no
developer tools:

```text
[ ] Download the setup EXE from the draft/prerelease page, not Actions.
[ ] Confirm checksum matches the release notes.
[ ] Install without Git, Node.js, pnpm, Docker, or a terminal.
[ ] Launch from the Start menu.
[ ] Confirm the dashboard opens and the map is visible, or a clear map error is shown.
[ ] Open Data Sources and verify unavailable providers are labeled clearly.
[ ] Toggle a layer group and inspect at least one source or map record detail.
[ ] Refresh a feed and confirm the UI reports success, unavailable, stale, or empty honestly.
[ ] Close, reopen, uninstall/reinstall, and confirm settings/log access still work.
[ ] Uninstall from Windows Settings.
```

Mark this clean-PC check as unverified in release notes until it has been run
for the exact artifact being handed to a tester.
