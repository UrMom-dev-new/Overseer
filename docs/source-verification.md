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
| Surveillance capabilities | Report-only | Ringmast4r source files with EFF Atlas, USASpending, Washington Post, and BuzzFeed-derived datasets | Reference records, aggregate locations, and capped flight paths | Not live observations. City coordinates are source-derived where available; state centroids are labeled region precision. |
| Surveillance industry | Report-only | Ringmast4r Surveillance-Industry README and Markdown dossier files | Reference dossiers and representative dossier locations | Not live observations. Unavailable dossier Markdown files are omitted and reported in provider status. |
| ODINT targets | Report-only | Ringmast4r ODINT `CYBER RECON TOUR` public text files | Passive domain, URL, API endpoint references, and file summaries | Not live observations or scan results. Full-route probes are omitted from automated release gates because fetching the full repo inventory is intentionally bounded on demand. |
| FED rolodex | Report-only | Ringmast4r FED Markdown databases | Intelligence entity references, cultural center references, and database summaries | Not live observations or official confirmation. Descriptions remain unassessed source text from FED. |
| Data centers | Report-only | Ringmast4r Global-Data-Center-Map ATLAS files | Coordinate-bearing data center references and catalog summaries | Not live operational telemetry. Only upstream GeoJSON points are plotted; catalog-only records are counted in summaries and never geocoded. |
| Cyber threats | Report-only | Threat/vulnerability route passed | Provider-backed reports | Technical severity remains unknown unless supplied by source. |
| MAC OUI lookup | On-demand report-only | Ringmast4r OUI-Master-Database master CSV; macvendors.co alternate | One vendor/reference lookup per submitted MAC/OUI | Parameterized RECON route. Missing fields remain null and unmatched prefixes return Not Found without manufacturer guessing. |

## Sources Found Unavailable, Blocked, Or Not Configured

- airplanes.live military/LADD returned HTTP 403 from this host; ADSB.lol
  equivalents supplied usable alternate aircraft observations.
- AIS Stream is not configured because `AIS_API_KEY` is unset; live vessel
  observations are omitted while static ports/chokepoints remain references.
- GDELT was unavailable from this host during the live gate; it is report-only
  and did not block required-source verification.
- Surveillance-Industry uses GitHub raw Markdown as the primary source and
  links each record back to the GitHub dossier page as the human-readable
  alternate. If GitHub raw is unavailable, the route omits dossier records and
  reports the repository URL instead of creating placeholder dossiers.
- ODINT uses the GitHub tree API to discover `CYBER RECON TOUR` text files and
  GitHub raw for file contents. If the tree or individual raw files are
  unavailable, the route omits those records and reports the GitHub repository
  or blob URL as the alternate source view. The source contract is report-only
  and excluded from fast live-source gate probes because callers can request a
  bounded subset with `maxFiles`, `region`, or `country`.
- FED uses GitHub raw Markdown for `README.md`, `spy-vs-spy.md`, and
  `cultural-centers.md`. If one database file is unavailable, that file's
  records are omitted and its provider status reports the GitHub blob/repository
  URL as the alternate source view. No placeholder intelligence entities or
  cultural centers are generated.
- Global-Data-Center-Map uses GitHub raw for `README.md`, `STATISTICS.md`,
  `datacenters.json`, and `datacenters.geojson`. If raw files are unavailable,
  the route omits affected records and reports the GitHub repository/blob URL as
  the alternate source view. Facilities without valid upstream GeoJSON point
  geometry remain summary-only and are not geocoded or plotted.
- OUI-Master-Database uses the GitHub raw master CSV as the primary source for
  `/api/osint/mac`. Because the route requires a user-supplied MAC/OUI and the
  CSV is large, it is contract-described but omitted from automated live-source
  gate probes. `macvendors.co` is retained as a bounded alternate provider.
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
