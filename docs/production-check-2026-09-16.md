# Production check — 2026-09-16

Branch: `codex/production-windows-check`

Starting commit: `f7706bcecf8f559b742359a6a4f7449f313a359c`

Local environment: macOS/darwin-arm64, Node.js 24.19.0, pnpm 11.19.0. Repository
CI targets Node 22.

**Verdict: required source reliability is now passing locally; Windows
production sign-off remains blocked until the GitHub Windows packaging workflow
successfully produces and validates the setup and portable artifacts.**

## Changes completed

- Required source usability is evaluated by one shared contract:
  provider freshness requires valid fetch timestamps, live observations can have
  source-age limits, required streams can define per-stream minimum coverage, and
  valid-empty responses are explicit.
- Earthquake empty responses can now clear previous records when the provider
  reports a legitimate fresh empty result. Malformed or expired earthquake
  records fail instead of preserving a false-healthy feed.
- Markets require usable stocks, oil, commodities, crypto, and indices streams;
  one crypto quote can no longer hide an unavailable Yahoo stream.
- Space weather treats quiet `kp_index: 0` as usable data and no longer drops it
  through a falsy parse.
- Live-news and CCTV reference catalogs now return provider status metadata and
  explicitly identify themselves as catalogs, not verified playable media.
- SCM supplier overlay no longer calls `127.0.0.1:3000`, reads the fires
  payload from `fires`, and isolates each source failure. Missing incident data
  is reported unavailable and never converted into zero risk.
- Optional entity expansion now returns `503 not_configured` unless `INTEL_URL`
  is set. The desktop package does not start the separate `intel/` service.

## Deterministic checks

| Check | Result |
| --- | --- |
| Frozen dependency install | `pnpm install --frozen-lockfile` passed |
| TypeScript | `pnpm run typecheck` passed |
| Integrity/source-contract tests | `pnpm run test:integrity` passed, 65 tests |
| Lint | `pnpm run lint` passed; 64 existing warnings, 0 errors |
| Desktop smoke harness tests | `pnpm run test:desktop-smoke` passed, 5 tests |
| Production build | `pnpm run build` passed |
| Production startup smoke | `pnpm run smoke:prod` passed on `127.0.0.1:3100` |

Notes:

- Localhost-binding tests required elevated local bind permission in the managed
  Codex sandbox. No test logic was skipped.
- `next build` still reports the existing Next.js middleware deprecation
  warning.

## Live-source verification

Command:

```bash
pnpm run verify:live-sources -- --base-url=http://127.0.0.1:3101 --timeout-ms=35000 --output=docs/live-source-verification-2026-09-16.json --summary-only
```

Result:

- `/api/sources` reachable.
- Required passed: **8/8**.
- Warnings: **4**.
- Optional/report not configured: **1**.
- Full machine-readable report:
  `docs/live-source-verification-2026-09-16.json`.

Required capability summary from the passing run at
`2026-09-16T20:52:36.823Z`:

| Capability | Result | Usable records | Notes |
| --- | --- | ---: | --- |
| Earthquakes | Passed | 31 | Fresh USGS observations. |
| News | Passed | 54 | RSS and Telegram previews returned source reports. |
| Weather | Passed | 248 | NOAA/NWS and NASA EONET succeeded. |
| Fires | Passed | 2,018 | FIRMS sampled response plus EONET volcanoes. |
| Flights | Passed with warning | 12,015 | airplanes.live military/LADD returned 403; ADSB.lol alternates returned usable data. |
| Satellites | Passed | 1,224 | SatNOGS TLE-backed observations. |
| Markets | Passed | 18 | Yahoo Finance and CoinGecko returned all required quote streams. |
| Space weather | Passed | 12 | NOAA SWPC Kp, alerts, and X-ray flares returned usable data. |

Non-gating provider/report observations:

- GDELT returned HTTP 503 from this host with no eligible cache. It remains
  report-only and did not block the required release gate.
- Surveillance capabilities passed with a freshness warning for static/reference
  source semantics.
- FED and cyber-threat report routes returned warnings for provider-status/data
  consistency; they are not required release-gate sources.

## Browser source-to-screen check

The production server was opened in the in-app browser at
`http://127.0.0.1:3101/`.

Observed:

- Dashboard document loaded with title
  `OVERSEER — Open Source Intelligence Platform | Live Flight Tracking, CCTV, OSINT Tools & More`.
- MapLibre canvas rendered at `1280x720` CSS pixels (`2560x1440` backing
  canvas).
- Global status reached `SYS: CONNECTED`, displayed `11 FEEDS`, and showed
  `SOLAR: Kp1`.
- Layer category interactions for `AVIATION`, `HAZARD`, and `DISPLAY` responded;
  the Display panel showed day/night and 3D terrain controls.
- RECON panel opened and displayed 17 tools.
- Optional entity expansion returned HTTP `503` with
  `configuration: "not_configured"` and the message that `INTEL_URL` is required.

Residual UI observations:

- During initial feed loading the banner can temporarily show `SYS: ERROR`
  while non-required/report providers fail or lag. It returned to connected
  after required feeds refreshed.
- The Markets footer still displayed `MKT 0/12` even after `/api/markets` passed
  the backend contract; this appears to be a separate market-hours display
  indicator rather than a source-contract failure.
- Stopping the local production server printed Next.js data-cache warnings for
  large flights/CCTV route responses over 2 MB.

## Route/deployment checks

- `pnpm run smoke:prod` verified the production app on port `3100`.
- Live-source verification and browser checks used port `3101`.
- `/api/scm-suppliers` on port `3101` returned source-backed supplier indicators
  and reported GDELT as unavailable without implying zero risk.
- `/api/entity/expand?type=aircraft&id=N12345` returned `503 not_configured`
  without attempting to contact a bundled intel service.

## Windows installer status

Prepared Windows path retained:

- `electron-builder.yml` produces distinct
  `Overseer-Setup-<version>-x64.exe` and
  `Overseer-Portable-<version>-x64.exe` artifacts.
- `.github/workflows/desktop-packages.yml` builds on `windows-2025`, installs
  into a path containing spaces, launches from an unrelated working directory,
  reinstalls, checks the portable executable, uninstalls, writes SHA256 sums and
  build identity, and uploads artifacts for 30 days.
- `scripts/test-windows-installer.ps1` performs the installer lifecycle checks.

Blocked until CI runs:

- Native Windows install, launch, reinstall, portable launch, process cleanup,
  and uninstall were **not** executed locally because this host is macOS.
- No successful Windows installer/portable artifact link exists yet for this
  branch. The Desktop Packages workflow must run through a pull request or
  manual dispatch after this branch is pushed.
- Code signing, permanent release hosting, automatic updates, cross-version
  migrations, and Windows ARM64 remain outside this check.

## Remaining blockers

- Successful GitHub CI and Desktop Packages workflow runs are required before
  distributing a Windows installer.
- Browser checks here were manual/in-app and did not constitute a full automated
  renderer-hydration suite.
- External provider availability is time- and host-dependent. The saved verifier
  report records this host's provider results at the timestamp above.
