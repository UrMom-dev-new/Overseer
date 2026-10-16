<div align="center">

# ⬡ OVERSEER

### Open Source Intelligence & Reconnaissance Integrated System

**A real-time global intelligence dashboard that aggregates live flight tracking, CCTV networks, earthquake monitoring, conflict zone mapping, and 24/7 news feeds into a single GPU-accelerated interface.**

</div>

---

## Overview

Overseer is a production-grade OSINT platform that provides situational awareness across multiple intelligence domains. Built with Next.js 16 and MapLibre GL, source-backed data points are rendered via WebGL for 60fps performance even with thousands of concurrent entities on-screen.

## Install And Run

### Windows Desktop: Download An Installer

Windows users do not need Git, Node.js, pnpm, Docker, or a terminal when using
the desktop installer.

1. Open the latest Windows beta prerelease on the
   [Releases page](https://github.com/UrMom-dev-new/Overseer/releases).
2. Download `Overseer-Setup-<version>-x64.exe`. This is the recommended file
   for nontechnical testers.
3. Double-click the installer, then open **Overseer** from the Start menu.
4. If a feed is unavailable, open **Data Sources** inside Overseer to see the
   provider status instead of guessing.

If no public prerelease exists yet, the current Windows build is maintainer-only:
the **Desktop Packages** workflow uploads `Overseer-Windows-x64-<commit>`
artifacts that expire after 30 days and require GitHub sign-in. Those artifacts
include a setup EXE, a portable EXE, SHA-256 checksums, build identity, and the
packaged-app live-source report. Draft prerelease links are maintainer-only
until publication is explicitly approved.

Windows beta builds are unsigned unless a release says otherwise. Windows may
show an unknown-publisher or SmartScreen warning. Do not disable Windows
security protections. See [Windows installation and troubleshooting](docs/windows-desktop.md)
for limitations, diagnostics, and bug-report details.

### macOS Desktop

Download a macOS DMG from the [Releases page](https://github.com/UrMom-dev-new/Overseer/releases),
open it, and drag Overseer to Applications. Use `arm64` for Apple Silicon;
Intel Macs need an `x64` download. Only download architectures actually listed
in that release. Separate native ARM and Intel build targets are configured;
they are not a universal binary.

Existing betas remain unsigned until a signed/notarized release is explicitly
published with verification evidence. Do not disable Gatekeeper. Maintainers:
follow the [Apple Developer and signing setup guide](docs/macos-signing.md) to
configure the protected signed-release workflow.

### Requirements

- Git
- Node.js 22.x recommended
- Corepack, included with modern Node.js, to install the pinned `pnpm@11.19.0`
- Docker Desktop or Docker Engine, optional for containerized self-hosting
- macOS or Windows, optional for Electron desktop packages

Most core feeds work without API keys. Optional credentials can be added later
with `.env`; see [Environment Variables](#environment-variables).

### 1. Clone The Repository

```bash
git clone https://github.com/UrMom-dev-new/Overseer.git
cd Overseer
```

### 2. Install Dependencies

```bash
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install
```

### 3. Run The Web App For Development

```bash
pnpm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 4. Run A Production Build Locally

```bash
pnpm run build
mkdir -p .next/standalone/.next/static .next/standalone/public
cp -R .next/static/. .next/standalone/.next/static
cp -R public/. .next/standalone/public
PORT=3000 HOSTNAME=127.0.0.1 node .next/standalone/server.js
```

Open [http://localhost:3000](http://localhost:3000). Change `PORT=3000` to a
different port if `3000` is already in use.

### Run With Docker

```bash
git clone https://github.com/UrMom-dev-new/Overseer.git
cd Overseer

# Optional: only needed for API keys, custom ports, or cache settings.
cp .env.template .env

docker compose up -d --build
```

Open [http://localhost:3000](http://localhost:3000).

Common Docker commands:

```bash
docker compose logs -f
docker compose up -d --build
docker compose down
```

Set `OVERSEER_PORT=3005` in `.env` to publish the web UI on a different host
port. The container still listens on `3000` internally. Docker stores bounded
source snapshots in the `overseer-data` volume.

### Run As A Desktop App

Development desktop shell:

```bash
pnpm run desktop:dev
```

Production desktop shell from the local checkout:

```bash
pnpm run desktop:start
```

Build unsigned local desktop packages:

```bash
pnpm run desktop:pack:mac    # macOS arm64 app bundle in release/mac-arm64
pnpm run desktop:pack:mac:intel # Intel macOS bundle in release/mac (native Intel host)
pnpm run desktop:pack:win    # Windows x64 unpacked app in release/win-unpacked
```

Installer/package commands are also available:

```bash
pnpm run desktop:dist:mac    # macOS DMG + ZIP
pnpm run desktop:dist:mac:intel # Intel macOS DMG + ZIP (native Intel host)
pnpm run desktop:dist:win    # Windows NSIS installer + portable EXE
```

These commands always produce unsigned developer builds. The separate
`desktop:dist:mac:signed` command requires Apple credentials and fails on signing,
notarization, Gatekeeper, renderer, or required live-source errors. See
[macOS signing setup](docs/macos-signing.md),
[docs/macos-desktop.md](docs/macos-desktop.md) and
[docs/windows-desktop.md](docs/windows-desktop.md).

### Verify A Local Install

```bash
pnpm run lint
pnpm run typecheck
pnpm run test:integrity
pnpm run build
pnpm run smoke:prod
```

To check live provider availability against a running app:

```bash
OVERSEER_BASE_URL=http://127.0.0.1:3000 pnpm run verify:live-sources -- --output=./overseer-live-report.json
```

`verify:live-sources` checks backend source contracts for required capabilities;
it is not a browser-rendering test.

### Key Capabilities

| Domain | Data Points | Sources |
|--------|------------|---------|
| **Aviation** | Commercial, Private, Military, Jets | OpenSky Network, ADSB.lol alternates |
| **Maritime** | Live AIS when configured, Ports, Chokepoints | AIS Stream, reference datasets |
| **CCTV** | Live-video candidates, snapshots/recorded clips, provider players | Caltrans, TfL, WSDOT, NYC DOT, VicRoads + more; availability varies |
| **Surveillance Capabilities** | Police surveillance capability references, awards, equipment transfers, historical flight paths | Ringmast4r map, EFF Atlas, USASpending.gov, Washington Post, BuzzFeed |
| **Data Centers** | Coordinate-bearing data center reference map plus catalog summaries | Ringmast4r Global-Data-Center-Map |
| **GPS / GNSS** | Predicted GPS satellite positions and orbital epochs | Ringmast4r GNSS, current CelesTrak GPS-OPS alternate |
| **Seismic** | Real-time M2.5+ | USGS Earthquake API |
| **Fires** | Active Hotspots | NASA FIRMS |
| **News** | 24/7 Live Streams | 25+ Global Broadcasters |
| **Weather** | Severe Events | NOAA/NWS, NASA EONET |
| **Space** | Solar Weather, Satellites | NOAA SWPC, SatNOGS, CelesTrak |
| **Cyber** | CVE Threats, Vulnerability Scanning | CISA KEV, NVD, Custom Scanner |
| **RECON OUI** | MAC address vendor/prefix lookup | Ringmast4r OUI-Master-Database, macvendors.co alternate |
| **RECON ODINT** | Passive public-domain and API endpoint reference inventory | Ringmast4r ODINT CYBER RECON TOUR |
| **RECON FED** | Intelligence agency and cultural center reference rolodex | Ringmast4r FED Markdown databases |
| **Conflict** | Frontlines and regional monitoring | DeepState, source-backed reports |
| **Crypto** | BTC + ETH Wallet Tracing, OFAC SDN Match | blockstream.info, Blockscout, OpenSanctions |
| **Sanctions** | Person / Org / Vessel SDN Search | OpenSanctions (US OFAC SDN mirror) |
| **Telegram OSINT** | Geoparsed Posts from Public Channels | `t.me/s/<channel>` web preview |

### CCTV Playback

The **SURVEIL** menu separates **Live CCTV Video**, **Camera Snapshots / Clips**,
and **Provider Camera Players**. Catalog counts describe available access links,
not verified online cameras. Open a map camera to check playback inside Overseer.

- Caltrans cameras use their published HLS video URLs when available. HLS is
  labeled **Live video** only while decoded video and the live playlist advance.
  Paused, stalled, ended, expired, or failed video is not labeled live.
- YouTube cameras must pass a current-live, video-identity, and embedding check,
  then demonstrate advancing playback. Checks expire and are renewed during
  viewing; archived and upcoming broadcasts are not substituted.
- JPG sources are refreshed snapshots; MP4 sources are recorded clips, not
  continuous live video. Neither is labeled live or silently substituted for a
  failed stream. Cameras offering both have an explicit video/snapshot toggle.
- Provider-controlled embeds remain unverified. Sources that disallow embedding
  can be opened using the provider link. Overseer does not bypass restrictions.

Not every public camera supplies continuous video. Source capture time remains
unknown unless the provider supplies it; an image receipt time is not a capture
time. Retry checks the selected media again, and closing the viewer stops playback.

**SURVEIL > Camera Sources** includes all 27 networks from the supplied global
public camera catalog, with searchable region/access filters, provider links,
reuse notes, limitations, configuration requirements, and per-provider collection
results. A network reference does not create cameras at inferred coordinates.

Connected catalog APIs include Fintraffic Digitraffic snapshots (published preset
IDs and image observation times), all 12 Caltrans districts, Singapore LTA images,
Hong Kong Transport Department snapshots, and TfL images/recorded clips. Finland
presets and Ontario views are separate views of their source station, not extra
physical cameras. Attribution is retained in the viewer. Known collection failures
omit that provider's records without affecting successful providers.

Ontario 511, WSDOT's official Traveler Information API, and SANRAL i-TRAFFIC require
server-side credentials. Set `ONTARIO_511_API_KEY`, `WSDOT_ACCESS_CODE`, or
`SANRAL_API_KEY` in the runtime environment and restart the app. Optional
`TFL_APP_KEY` and `DATA_GOV_SG_API_KEY` configure higher-rate access. Never prefix
these keys with `NEXT_PUBLIC_`. Catalog requests are coalesced and cached for at
least a minute; HTTP 429 retry delays are respected and cached check times are
not renewed by reads.

NSW and Queensland remain resource-review references. Approval-only and
viewer-only networks retain public provider links; this import does not scrape
their viewers, extract restricted streams, or imply redistribution rights.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  OVERSEER CLIENT                   │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐ │
│  │ MapLibre  │  │  HUD     │  │  RECON Toolkit│ │
│  │  GL (GPU) │  │ Panels   │  │  Port Scan    │ │
│  │  WebGL    │  │ Layers   │  │  DNS / WHOIS  │ │
│  │  Render   │  │ Controls │  │  Vuln Scanner │ │
│  └──────────┘  └──────────┘  └───────────────┘ │
├─────────────────────────────────────────────────┤
│               NEXT.JS API ROUTES                 │
│  /api/flights         /api/earthquakes          │
│  /api/cctv            /api/news                 │
│  /api/fires           /api/maritime             │
│  /api/gdelt           /api/satellites           │
│  /api/weather         /api/scanner              │
│  /api/data-centers    /api/fed-rolodex          │
│  /api/sentinel        /api/live-news            │
│  /api/osint/*  (whois, dns, ip, cve, sanctions, │
│                 crypto, sweep, threats, …)      │
├─────────────────────────────────────────────────┤
│              EXTERNAL DATA SOURCES               │
│  OpenSky · ADSB.lol · USGS · NASA · NOAA       │
│  GDACS · EONET · FIRMS · SatNOGS · CelesTrak   │
│  Ringmast4r datasets · OpenSanctions            │
│  blockstream.info · Blockscout                  │
│  t.me public previews                            │
└─────────────────────────────────────────────────┘
```

---

## Features

### Intelligence Layers
- **20+ toggleable data layers** with real-time entity counts
- **GPU-accelerated rendering** — all map data rendered via WebGL, not DOM
- **Progressive loading** — data fetched on-demand when layers are activated
- **Viewport-aware** — only loads relevant data for the visible region

### RECON Toolkit
- **Port Scanner** — TCP connect scan with service fingerprinting
- **DNS Lookup** — Full record resolution (A, AAAA, MX, NS, TXT, CNAME)
- **WHOIS** — Domain/IP registration data (auto-cross-checked against OFAC SDN)
- **SSL/TLS Inspector** — Certificate chain analysis
- **IP Intelligence** — Geolocation, ASN, threat reputation (auto-cross-checked against OFAC SDN)
- **Vulnerability Scanner** — CVE lookup against NVD database
- **MAC Vendor Lookup** — OUI prefix lookup using [`Ringmast4r/OUI-Master-Database`](https://github.com/Ringmast4r/OUI-Master-Database), with `macvendors.co` as a real alternate when needed
- **ODINT Source Inventory** — passive target/reference inventory from [`Ringmast4r/ODINT`](https://github.com/Ringmast4r/ODINT), exposed at `/api/odint-targets` with provider status and GitHub source links
- **FED Rolodex** — intelligence entity and cultural-center reference inventory from [`Ringmast4r/FED`](https://github.com/Ringmast4r/FED), exposed at `/api/fed-rolodex`
- **Crypto Wallet Trace** — BTC + ETH lookup (balance, tx history, OFAC SDN sanctions flag)
- **OFAC Sanctions Search** — query persons, organizations, vessels and aircraft against the US OFAC SDN list

### Live Broadcast Network
- A shared catalog of 15 broadcaster references supplies both the map and **Reports & Feeds > Feeds** list
- Click a news dot or feed entry to check the broadcaster's current live video and open its player; no API key is needed
- Feeds from NBC, CBS, ABC, Sky News, Al Jazeera, France 24, NHK, WION, and more
- Playback resolves the current video ID on demand, confirms the channel is live and embedding is permitted, and handles provider errors with retry and an external broadcaster link
- Catalog availability does not guarantee video playback. Offline, restricted or unverified broadcasts show an explicit state; no recorded or synthetic substitute is emitted

### Police Surveillance Capabilities
- Opt-in **Police Capabilities** layer under Surveillance
- Uses the public [`Ringmast4r/surveillance-capabilities-map`](https://github.com/Ringmast4r/surveillance-capabilities-map) source files
- Integrates EFF Atlas of Surveillance rows, USASpending contracts/grants, Washington Post 1033 transfer data, and historical FBI/DHS flight paths
- City coordinates are source-derived where available; state centroid records are labeled as region precision
- Treated as reference/report data, not live observations

### Global Surveillance Industry Dossiers
- Opt-in **Industry Dossiers** layer under Surveillance
- Uses the public [`Ringmast4r/Surveillance-Industry`](https://github.com/Ringmast4r/Surveillance-Industry) Markdown dossier project
- Parses the README dossier index plus individual country, region, and Palantir dossier files
- Country and regional markers are representative centroids with explicit precision labels; Palantir uses the source-stated Denver location
- Unavailable dossier files are omitted and surfaced in provider status rather than replaced with synthetic records
- Treated as reference/report data, not live observations

### Global Data Center Map
- Opt-in **Data Centers** layer under **Infrastructure**
- Uses the public [`Ringmast4r/Global-Data-Center-Map`](https://github.com/Ringmast4r/Global-Data-Center-Map) ATLAS source files
- Exposes `/api/data-centers?maxLocations=10000` with `data_centers[]`, `summaries[]`, source status, counts, attribution, and precision notes; the default includes all coordinate-bearing facilities in the current upstream dataset
- Plots only valid `Point` features from upstream `datacenters.geojson`; facilities that exist only in `datacenters.json` are counted in summaries but are not geocoded or inferred
- Raw GitHub fetch failures are reported in provider status and link back to the GitHub repository/blob page as the alternate source view
- Required attribution: `Data centers (c) Ringmast4r - Global-Data-Center-Map`
- Treated as reference infrastructure data, not live operational telemetry; upstream coordinate precision varies from building-level to city, state, or country centroid

### Global Infrastructure Catalog
- Open **Infrastructure > Source Catalog** for all 28 sources in the supplied `global_infrastructure_source_catalog.csv`, including coverage, licenses, vintage, limitations, provider/terms links and alternative sources. The catalog's review date is supplied metadata, not proof of a successful data connection.
- **Power Networks**, **Water Systems**, **Wastewater**, **Health Facilities**, and **Telecommunications** are separate Infrastructure layers on desktop and mobile. They query mapped OSM nodes/ways in the current viewport through Overpass. Queries are limited to one degree per side and 5,000 objects; larger views display an explicit query-limit state.
- Source points, lines, polygons, IDs, lifecycle tags and edit timestamps are retained. No facility centroids, operating status, missing assets or independent corroboration are inferred. OSM-derived Overture, Healthsites and Open Infrastructure Map products overlap this baseline.
- Overpass collection uses two bounded providers, a 15-minute expiring cache, request coalescing and cooldowns. Unavailable, malformed, incomplete or expired responses are omitted, not replaced with generated assets. A valid empty area does not prove no infrastructure exists.
- The catalog also accepts local **WGS84 GeoJSON FeatureCollection** files for eligible open sources. Select a source and sector, enter the actual dataset license/permission reference, then use the upload icon. Point, LineString and Polygon geometries are supported, up to 10 MiB / 10,000 features per file and 25,000 features per session. Imports stay in memory only, retain provenance and vintage, and can be removed per source. They are not live feeds and their coordinate accuracy remains unverified. PBF, GeoParquet, Shapefile and tabular resources require conversion to GeoJSON outside Overseer first.
- Credentials, commercial/permission-gated sources, unavailable directories, modeled/estimated-only products and visual-only maps are not automatically ingested. Catalog inclusion does not grant reuse permission. Restricted, modeled/estimated-only and approximate-centroid sources are excluded from this generic import path. Other providers remain catalog references unless a user imports an eligible file.
- See [Infrastructure integration](docs/infrastructure-sources.md) for API details, limitations and provider validation results.

### GPS / GNSS
- Enable **Space > GPS / GNSS** in the desktop or mobile layer menu; no API key is required
- `/api/gnss` integrates [`Ringmast4r/GNSS`](https://github.com/Ringmast4r/GNSS) GPS orbital data, with current [CelesTrak GPS-OPS](https://celestrak.org/NORAD/elements/gp.php?GROUP=GPS-OPS&FORMAT=JSON) OMM JSON as the alternate when the repository snapshot is unavailable or expired
- Uses Satellite.js SGP4 propagation within Overseer; positions refresh every minute while enabled and catalogs are cached for one hour
- Orbital elements older than 14 days, malformed records and failed propagations are omitted. Predictions expire after two minutes (or sooner if the elements expire); total source failure returns HTTP 503 and an empty layer
- Popups show PRN, NORAD ID, altitude, orbital epoch, prediction time and provider. These are orbital predictions, not receiver signal strength, actual reception, fix status or jamming observations
- Adapted from Ringmast4r/GNSS under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); Overseer adds validated catalog collection, current-source fallback, expiry checks and native map rendering

### ODINT Passive Recon Sources
- Uses the public [`Ringmast4r/ODINT`](https://github.com/Ringmast4r/ODINT) `CYBER RECON TOUR` text files
- Parses concrete domains, URLs, and explicitly stated API endpoint references into `/api/odint-targets`
- Returns file summaries for country lists, regional website lists, and the Mexico API inventory so source coverage remains auditable
- Query parameters include `maxFiles`, `maxTargets`, `maxSummaries`, `region`, and `country` for bounded exploration
- Unavailable GitHub tree/raw files are omitted, reported in provider status, and linked back to GitHub blob/repository pages as alternate human-readable source views
- Treated as passive reference data only; it does not trigger active scanning and does not imply targets are vulnerable, hostile, or currently observable

### FED Intelligence Rolodex
- Uses the public [`Ringmast4r/FED`](https://github.com/Ringmast4r/FED) Markdown databases
- Parses `spy-vs-spy.md` into `intelligence_entities[]` records with country/topic/category, source line, optional website, and provenance
- Parses `cultural-centers.md` into `cultural_centers[]` records with country, section/location context, optional website, network label, and provenance
- Returns database summaries for the README, intelligence agency rolodex, and cultural center rolodex
- Query parameters include `maxEntities` and `maxCenters` for bounded responses
- Unavailable GitHub raw Markdown files are omitted, reported in provider status, and linked back to the GitHub repository/blob pages as alternate source views
- Treated as passive reference data only; descriptions remain source text from FED and are not live observations or independent Overseer verification

### Telegram OSINT Layer
- **Public-channel feed** scraped from the unauthenticated `t.me/s/<channel>` web preview — no Bot API token, no MTProto
- Default curated set of 5 channels (EN + RU/UA war reporting), overridable via `OVERSEER_TELEGRAM_CHANNELS`
- Posts are geoparsed against a multilingual place dictionary (EN + Cyrillic + Arabic) and plotted on the map
- Click any cyan dot to read the post and jump to the original on Telegram

### Crypto Wallet Intelligence
- **BTC** lookups via [blockstream.info](https://blockstream.info) (Esplora API, keyless)
- **ETH** lookups via [Blockscout](https://github.com/blockscout/blockscout)'s public ETH instance (`eth.blockscout.com`, keyless)
- Every lookup is cross-checked against the OFAC SDN sanctioned-address list (mirrored from [`0xB10C/ofac-sanctioned-digital-currency-addresses`](https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses))
- Sanctioned wallets surface a red **SANCTIONED — OFAC SDN** badge in the RECON panel

### OFAC SDN Cross-Check
- Standalone `SANCTIONS` tab in the RECON toolkit — full-text search across persons, organisations, vessels and aircraft
- WHOIS and IP-intel routes auto-cross-check registrant / ASN-owner names against the SDN list and surface an inline alert
- Data sourced from [OpenSanctions](https://www.opensanctions.org) (CC-BY 4.0) — keyless, ~7 MB cached in-memory for 24h

### Conflict Zone Monitoring
- **13 active conflict/tension zones** with severity-coded warning markers
- Active Wars: Ukraine, Gaza, Sudan, Myanmar, DRC, Yemen
- High Tension: Syria, Lebanon, Sahel, Somalia, Red Sea
- Elevated: Taiwan Strait, Korean DMZ

### Performance Optimized
- **75% reduction in edge requests** vs initial release
- Aggressive polling relaxation (15-30 min intervals for stable data)
- Reference datasets served from memory where appropriate
- `layerFetchedRef` prevents duplicate API requests

### Feed Integrity
- **Executable source contracts** — required capability schemas, record selectors, evidence kind, provider status, configuration state, and freshness policy live in one shared contract used by diagnostics, CLI verification, and tests
- **No synthetic fallback records** — unavailable streams are omitted or served from eligible last-known-good snapshots with original times preserved; missing data is not replaced with invented incidents, measurements, or reassuring defaults
- **Provider-level status** — feed responses identify which provider/query succeeded, failed, was not configured, or served last-known-good data
- **Configured versus active fallback** — `/api/sources` shows configured fallback options separately from an active fallback; `activeFallback` is only set when a fallback actually supplied the result
- **Distinct diagnostics actions** — **Test Source** runs the route contract check, while **Refresh Feed** goes through the dashboard fetch/store path and can update visible data
- **Source diagnostics panel** — click the database icon in the right rail to inspect `/api/sources`, credential state, cached statuses, provider status, payload validation, and route-level results
- **Documented verification** — see [docs/feed-integrity.md](docs/feed-integrity.md), [docs/source-verification.md](docs/source-verification.md), and [docs/release-process.md](docs/release-process.md)

### Verification Commands

Run the focused checks before changing or releasing feeds:

```bash
pnpm install --frozen-lockfile
pnpm run lint
pnpm run typecheck
pnpm run test:integrity
pnpm run build
pnpm run smoke:prod
```

To verify live source availability against a running app, start the app and point the live-source verifier at it:

```bash
OVERSEER_BASE_URL=http://127.0.0.1:3000 pnpm run verify:live-sources -- --output=./overseer-live-report.json
```

`verify:live-sources` is a backend contract gate for required sources. It does
not claim that browser rendering was checked. Use `--report-only` for
informational live-provider inventory; report-only mode is not a release gate.

Useful command map:

| Command | Purpose |
| --- | --- |
| `pnpm run test:integrity` | Deterministic no-network regression checks for feed normalization, source contracts, client snapshot behavior, cache recovery, and no-synthetic behavior |
| `pnpm run smoke:prod` | Starts the built standalone server, confirms `/api/health` identifies Overseer, checks app shell HTML, and probes representative required routes |
| `pnpm run verify:live-sources` | Evaluates required live-provider contracts and writes a machine-readable JSON report with counts, provider status, configuration, and limitations |
| `pnpm run smoke:desktop` | Launches Electron or a packaged desktop binary, verifies the embedded dashboard app instance, and closes it with bounded cleanup |

---

## Environment Variables

OVERSEER works **partially without any API keys** — most core feeds use public,
keyless sources. Copy `.env.template` to `.env` only for the optional services you need:

```env
# Published host port (container always listens on 3000). Default: 3000
OVERSEER_PORT=3000

# Optional writable data directory for bounded source snapshots.
# Docker sets this to /app/data via docker-compose.yml; desktop uses userData/data.
OVERSEER_DATA_DIR=
OVERSEER_SNAPSHOT_RETENTION_MS=86400000
OVERSEER_SNAPSHOT_MAX_ENTRIES=80
OVERSEER_SNAPSHOT_CACHE=1

# RECON scanner backend (the only vars the current code reads).
# SCANNER_KEY must match the backend's OVERSEER_KEY — generate with: openssl rand -hex 32
SCANNER_URL=
SCANNER_KEY=

# Optional, for higher rate limits / future sources (see DOCKER.md for signup links)
FIRMS_API_KEY=                # NASA FIRMS  — firms.modaps.eosdis.nasa.gov/api/map_key/
OPENSKY_CLIENT_ID=            # OpenSky OAuth2 (since Mar 2025) — opensky-network.org
OPENSKY_CLIENT_SECRET=
AIS_API_KEY=                  # aisstream.io maritime vessel positions
OVERSEER_TELEGRAM_CHANNELS=   # optional comma-separated public channel usernames
GEMINI_API_KEY_1=             # optional AI analyst key
```

> Without `SCANNER_URL`/`SCANNER_KEY` the RECON toolkit returns `503`; every
> other keyless layer continues to work. `.env` is gitignored.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript 5 |
| Map Engine | MapLibre GL JS (WebGL) |
| Desktop | Electron + Electron Builder |
| Animations | Framer Motion |
| Icons | Lucide React |
| Styling | Custom CSS Design System |
| Deployment | Docker, Electron desktop packages, Node/Next standalone |

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `F` | Toggle flight layers |
| `E` | Toggle earthquakes |
| `S` | Toggle satellites |
| `D` | Toggle day/night cycle |
| `Escape` | Close panels |

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

<div align="center">



</div>
