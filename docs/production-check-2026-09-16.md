# Production check — 2026-09-16

Reviewed baseline: `d0ea75f3db2d5448e3d62cf72c3473540a4d628a`.
Environment: Linux, Node.js 24.19.0, pnpm 11.19.0. Repository CI targets Node 22;
the local run does not establish Windows or Node 22 runtime compatibility.

**Verdict: production sign-off is blocked.** Build/test gates pass locally, but
the live news route failed, several contract edge cases remain incorrect, and
the installed Windows application and browser interactions were not verified.

## Observed checks

| Check | Result |
| --- | --- |
| Frozen dependency install | Passed |
| TypeScript | Passed |
| Existing integrity/source-contract tests | 58 passed |
| Lint | Exit 0; 64 warnings, no errors |
| Production build | Passed |
| Production startup smoke | Server, root HTML, health and earthquake request succeeded; stopped on news HTTP 503 |
| Latest GitHub CI | Failed during Node setup, before install/tests/build |
| Published releases | None at review time |
| Browser rendering, WebGL and interaction | Not verified; remote browser could not reach the local test server |
| Native Windows installation | Not run; no Windows execution environment here |

GitHub run evidence:
https://github.com/UrMom-dev-new/Overseer/actions/runs/35122139544

The CI job attempted pnpm caching before pnpm existed. Its log reports
`Unable to locate executable file: pnpm`. The same ordering was present in the
desktop and release-preflight workflows. This patch removes that premature
cache request while retaining the pinned pnpm setup and frozen install.

## Live route observations

These are observations from this host, not universal provider availability
claims. The app was built from the baseline above and launched as a standalone
production server. Route payloads were evaluated with the repository's current
shared evaluator.

| Capability | HTTP | Result |
| --- | --- | --- |
| Earthquakes | 200 | 29 records; evaluator passed |
| News | 503 | No records; RSS and Telegram collection reported unavailable |
| Weather | 200 | 225 records; NWS and EONET succeeded |
| Fires | 200 | 2,026 returned records; FIRMS sample and EONET succeeded |
| GDELT | 503 | Three queries unavailable; no eligible cached snapshot |
| Flights | 200 | 1,095 returned records; ADSB.lol alternates worked; airplanes.live returned 403 and OpenSky was unavailable |
| Satellites | 200 | 1,778 returned records; CelesTrak alternate worked after SatNOGS timeout |
| Maritime | 200 | 62 static references, no live vessels; AIS_API_KEY unconfigured |
| CCTV | Timed out | No completed response within 35 seconds |
| Live news | 200 | 15 reference links; evaluator failed because provider status metadata was absent |
| Remaining routes, including markets and space weather | Not completed | Further live probing stopped when network approval was cancelled before a decision |

An earlier verifier invocation could not reach a server started in a separate
execution session. Its 0/8 result is **not** evidence of eight provider outages.
The table above comes from a subsequent audit that launched the server and
made requests within the same process environment. No complete successful
live-source release gate was obtained.

## Confirmed remaining functionality gaps

### Freshness and required coverage

Four offline reproductions against the compiled evaluator showed:

1. An earthquake payload with valid coordinates and a provider claiming
   `fresh`, but no success/attempt timestamps, passes.
2. An earthquake dated in 2000 with a current collection timestamp passes.
   Observation age is not enforced by the evaluator.
3. Empty stocks/oil/commodities/indices objects plus one valid crypto quote
   pass the required markets gate while Yahoo reports an error.
4. A legitimate schema-valid empty earthquake response fails because required
   capabilities default to disallowing empty responses. Since the browser uses
   this evaluator, a valid empty refresh can be rejected instead of clearing
   the previous snapshot.

Relevant code: `src/lib/source-contracts.ts` and `src/app/page.tsx`.
Fix these with per-stream provider coverage, timestamp validation, source-age
policy, and explicit legitimate-empty handling. Do not weaken the whole gate
to accommodate one provider's current outage.

### Supply-chain overlay is not desktop-port independent

`src/app/api/scm-suppliers/route.ts` calls `127.0.0.1:3000` for fires and GDELT.
Desktop startup binds from port 45454 and can select another available port.
The overlay also reads `fireData.data`, while the fires route returns `fires`.
Even on port 3000 this can report an empty fire stream despite returned data.
The sources share a surrounding try/catch, so an earlier exception can skip
later sources. These are source-confirmed defects; the route was not reached
in the interrupted live audit. They are not changed in the installer patch.

### Optional service is not included in the desktop package

Entity expansion defaults to `http://overseer-intel:4000` in production, but
the desktop bundle does not start the separate `intel/` service. This feature
requires a reachable service and `INTEL_URL`; it is now disclosed in the Windows
guide. A desktop installation cannot be described as providing every optional
feature without configuration.

## Prepared Windows installation changes

- Per-user one-click NSIS setup with desktop and Start menu shortcuts.
- Separate `Overseer-Setup-<version>-x64.exe` and
  `Overseer-Portable-<version>-x64.exe` names. Previously both targets inherited
  the same version/architecture `.exe` filename.
- A Windows CI job builds both executables, installs the setup into an isolated
  path containing spaces, launches it, reinstalls, launches again, checks the
  portable executable, and uninstalls.
- The smoke harness checks application identity, main-frame load, actual
  static asset responses, and the source manifest from an unrelated working
  directory with an isolated user profile. It explicitly does not claim
  renderer hydration or live provider validation.
- Successful jobs upload the EXEs, checksums and source revision. Failure logs
  are retained separately. No public GitHub Release is created automatically.
- User documentation explains download/extract/install without developer tools,
  artifact expiry, unsigned builds, configuration requirements, and logs.

Local verification of the patch: five smoke-harness tests passed (healthy
fixture, missing asset, wrong identity, early exit, readiness timeout);
JavaScript syntax checks, focused lint, YAML parsing and the installed
electron-builder configuration schema check passed. The fixtures exercise
the harness only; they do not establish that Electron or the installer works.

The Windows workflow must run successfully before distributing an installer.
Code signing, permanent release hosting, automatic updates, cross-version
migrations, and Windows ARM64 are outside this patch.
