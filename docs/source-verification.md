# Source Verification Matrix

Last checked: 2026-09-13 from the local Codex host against a production
standalone server on `127.0.0.1` with `pnpm run verify:live-sources`.

Policy: failed streams are omitted or served from an eligible
last-known-good snapshot. They must not emit synthetic records, reassuring
defaults, current timestamps for old observations, or invented risk/severity.

## Executable Contracts

Source verification is driven by `src/lib/source-contracts.ts`. The same
contract data is consumed by `/api/sources`, the Data Sources panel, the CLI
verifier, and deterministic tests.

Each capability contract defines:

- Stable capability ID, label, API route, and requirement level.
- Required record sets and whether each set is an observation, report, or static
  reference.
- Typed record selectors and count semantics. Status arrays and static
  reference records do not count as live observations.
- Provider status requirements, configuration state, payload validation,
  freshness outcome, and rendering verification status.
- Configured fallback options, kept separate from an active fallback.

`configuredFallback` describes available alternate behavior. `activeFallback`
remains `null` unless a fallback actually supplied the response, such as an
eligible last-known-good snapshot.

## Verification Modes And Exit Policy

Run the release gate against an already running application:

```bash
OVERSEER_BASE_URL=http://127.0.0.1:3000 pnpm run verify:live-sources -- --output=./overseer-live-report.json
```

Useful options:

| Option | Meaning |
| --- | --- |
| `--base-url=http://host:port` | Overrides `OVERSEER_BASE_URL`. |
| `--timeout-ms=20000` | Bounds each route fetch, including body consumption. |
| `--output=path.json` | Writes the machine-readable verification report. |
| `--summary-only` | Prints only the concise human summary. |
| `--report-only` or `--mode=report-only` | Produces an informational inventory and does not act as a release gate. |

Exit behavior:

- Release-gate mode exits `0` only when `/api/sources` is reachable and every
  required capability passes route reachability, payload contract validation,
  provider collection, configuration, and data-state policy.
- `/api/sources` being reachable never constitutes success by itself.
- HTTP `200 {}` fails when the contract requires named record sets.
- Schema-valid empty responses can pass only when the required record set is
  present and provider status reports a legitimate empty state.
- Optional missing credentials are reported as `not_configured`, not passed.
- Report-only providers are included in the JSON report but do not fail the
  release gate.
- Rendering is reported separately. The CLI backend verifier currently records
  `rendering: not_checked`; browser source-to-screen coverage must come from
  deterministic integration tests.

## Checked Sources

Representative live verification result from this host:

| Capability | Requirement | Active provider result | Records counted | Notes |
| --- | --- | --- | --- | --- |
| Earthquakes | Required | USGS returned valid GeoJSON | 37 live observations | Fresh during the run. |
| News | Required | RSS sources and configured Telegram public previews returned source reports | 54 reports | RSS is the baseline; Telegram is optional and bounded. |
| Weather | Required | NASA EONET and NOAA/NWS active alerts returned valid data | 193 live observations | NWS polygon/multipolygon geometry is preserved for area rendering. |
| Fires | Required | NASA FIRMS VIIRS and EONET volcanoes returned valid data | 2023 live observations/reports | FIRMS accepted a sampled subset from a much larger provider response. |
| Flights | Required | OpenSky and ADSB.lol alternates returned aircraft observations | 8862+ accepted provider records | airplanes.live military/LADD returned HTTP 403 and was omitted. |
| Satellites | Required | SatNOGS returned TLE-backed satellite data | 1220 returned observations | CelesTrak remains configured as a real alternate. |
| Markets | Required | Yahoo Finance and CoinGecko returned quotes | 20 live observations | Missing symbols are omitted, not estimated. |
| Space weather | Required | NOAA SWPC Kp, alerts, and X-ray flare products returned data | 12 observations/reports | Old SWPC alert URL was replaced with the current product endpoint. |
| Maritime | Optional | AIS Stream not configured | 62 reference records, 0 live observations | Ports/chokepoints are references and do not count as live vessel data. |
| GDELT | Report-only | Route/provider unavailable in this run | 0 reports | Non-gating; no synthetic incidents emitted. |
| CCTV | Report-only | Public camera catalogs returned references | 6369 reference records | Route still lacks provider status metadata, so CLI contract reports that gap. |
| Live news | Report-only | Curated broadcast links returned references | 15 reference records | Route still lacks provider status metadata, so CLI contract reports that gap. |
| Cyber threats | Report-only | Threat/vulnerability route passed | Provider-backed reports | Technical severity remains unknown unless supplied by source. |

## Sources Found Unavailable, Blocked, Or Not Configured

- airplanes.live military/LADD returned HTTP 403 from this host; ADSB.lol
  equivalents supplied usable alternate aircraft observations.
- AIS Stream is not configured because `AIS_API_KEY` is unset; live vessel
  observations are omitted while static ports/chokepoints remain references.
- GDELT was unavailable from this host during the live gate; it is report-only
  and did not block required-source verification.
- CCTV and live-news reference routes returned data but need provider status
  metadata before they can satisfy the shared provider-collection contract.
- Docker source verification was not run locally because Docker is not installed
  on this machine.

## Regression Coverage

`pnpm run test:integrity` includes deterministic subprocess coverage for:

- `/api/sources` succeeds while all data routes return HTTP 503: release gate
  exits nonzero.
- Every data route returns HTTP 200 with `{}`: release gate exits nonzero.
- Valid empty payloads are classified without invented records.
- Static reference records do not count as live observations.

The suite also covers RSS/Atom parsing, HTML blocking pages, last-known-good
cache restore/corruption behavior, real/demo snapshot isolation, and
client-side snapshot key isolation.
