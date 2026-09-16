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
the desktop installer. The **Desktop Packages** workflow builds an unsigned
Windows x64 setup executable and tests the installed app before making it
available as a workflow artifact.

1. Open [Desktop Packages](https://github.com/UrMom-dev-new/Overseer/actions/workflows/desktop-packages.yml).
2. Choose a successful run for the revision you want. If none exists, a
   repository maintainer can select **Run workflow** for that revision.
3. Download the `Overseer-Windows-x64-...` artifact and extract its ZIP.
4. Double-click `Overseer-Setup-<version>-x64.exe`, then open **Overseer** from
   the Start menu. Installation is for the current Windows user.

The artifact also contains a distinctly named portable EXE, SHA-256 checksums,
and the exact source commit. Artifacts expire after 30 days and downloads
require GitHub sign-in. A successful workflow run must exist first; this
repository does not yet provide a permanent public installer release.
Unsigned builds may show an unknown-publisher/SmartScreen warning. Do not
disable Windows security protections. See [Windows installation and
troubleshooting](docs/windows-desktop.md) for details and feature limitations.

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
pnpm run desktop:pack:win    # Windows x64 unpacked app in release/win-unpacked
```

Installer/package commands are also available:

```bash
pnpm run desktop:dist:mac    # macOS DMG + ZIP
pnpm run desktop:dist:win    # Windows NSIS installer + portable EXE
```

Desktop artifacts are unsigned developer builds unless signing credentials are
added in a protected release workflow. See
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
| **CCTV** | 2,000+ Cameras | TfL, WSDOT, Caltrans, NYC DOT, VicRoads + more |
| **Surveillance Capabilities** | Police surveillance capability references, awards, equipment transfers, historical flight paths | Ringmast4r map, EFF Atlas, USASpending.gov, Washington Post, BuzzFeed |
| **Data Centers** | Coordinate-bearing data center reference map plus catalog summaries | Ringmast4r Global-Data-Center-Map |
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
- **25+ live 24/7 news streams** from global broadcasters
- Click any news dot on the map to open the live stream
- Feeds from NBC, CBS, ABC, Sky News, Al Jazeera, France 24, NHK, WION, and more

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
- Opt-in **Data Centers** layer under Threats & Infra
- Uses the public [`Ringmast4r/Global-Data-Center-Map`](https://github.com/Ringmast4r/Global-Data-Center-Map) ATLAS source files
- Exposes `/api/data-centers?maxLocations=5000` with `data_centers[]`, `summaries[]`, source status, counts, attribution, and precision notes
- Plots only valid `Point` features from upstream `datacenters.geojson`; facilities that exist only in `datacenters.json` are counted in summaries but are not geocoded or inferred
- Raw GitHub fetch failures are reported in provider status and link back to the GitHub repository/blob page as the alternate source view
- Required attribution: `Data centers (c) Ringmast4r - Global-Data-Center-Map`
- Treated as reference infrastructure data, not live operational telemetry; upstream coordinate precision varies from building-level to city, state, or country centroid

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
