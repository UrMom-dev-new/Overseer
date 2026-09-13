<div align="center">

# ⬡ OVERSEER

### Open Source Intelligence & Reconnaissance Integrated System

**A real-time global intelligence dashboard that aggregates live flight tracking, CCTV networks, earthquake monitoring, conflict zone mapping, and 24/7 news feeds into a single GPU-accelerated interface.**

</div>

---

## Overview

Overseer is a production-grade OSINT platform that provides situational awareness across multiple intelligence domains. Built with Next.js 16 and MapLibre GL, source-backed data points are rendered via WebGL for 60fps performance even with thousands of concurrent entities on-screen.

### Key Capabilities

| Domain | Data Points | Sources |
|--------|------------|---------|
| **Aviation** | Commercial, Private, Military, Jets | OpenSky Network, ADSB.lol alternates |
| **Maritime** | Live AIS when configured, Ports, Chokepoints | AIS Stream, reference datasets |
| **CCTV** | 2,000+ Cameras | TfL, WSDOT, Caltrans, NYC DOT, VicRoads + more |
| **Seismic** | Real-time M2.5+ | USGS Earthquake API |
| **Fires** | Active Hotspots | NASA FIRMS |
| **News** | 24/7 Live Streams | 25+ Global Broadcasters |
| **Weather** | Severe Events | NOAA/NWS, NASA EONET |
| **Space** | Solar Weather, Satellites | NOAA SWPC, SatNOGS, CelesTrak |
| **Cyber** | CVE Threats, Vulnerability Scanning | CISA KEV, NVD, Custom Scanner |
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
│  /api/sentinel        /api/live-news            │
│  /api/osint/*  (whois, dns, ip, cve, sanctions, │
│                 crypto, sweep, threats, …)      │
├─────────────────────────────────────────────────┤
│              EXTERNAL DATA SOURCES               │
│  OpenSky · ADSB.lol · USGS · NASA · NOAA       │
│  GDACS · EONET · FIRMS · SatNOGS · CelesTrak   │
│  blockstream.info · Blockscout · OpenSanctions  │
│  t.me public previews                            │
└─────────────────────────────────────────────────┘
```

---

## Features

### Intelligence Layers
- **16 toggleable data layers** with real-time entity counts
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
- **Crypto Wallet Trace** — BTC + ETH lookup (balance, tx history, OFAC SDN sanctions flag)
- **OFAC Sanctions Search** — query persons, organizations, vessels and aircraft against the US OFAC SDN list

### Live Broadcast Network
- **25+ live 24/7 news streams** from global broadcasters
- Click any news dot on the map to open the live stream
- Feeds from NBC, CBS, ABC, Sky News, Al Jazeera, France 24, NHK, WION, and more

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
- **No synthetic fallback records** — unavailable streams are omitted instead of replaced with invented data
- **Source status metadata** — feed responses identify provider availability, freshness, and alternate sources where available
- **Conservative nulls** — missing values remain unknown rather than becoming reassuring defaults such as `0`, `LOW`, or `NORMAL`
- **Source diagnostics panel** — click the database icon in the right rail to inspect `/api/sources`, provider documentation, credential state, cached statuses, and route-level test results
- **Documented verification** — see [docs/feed-integrity.md](docs/feed-integrity.md) and [docs/source-verification.md](docs/source-verification.md)

### Verification Commands

Run the focused checks before changing or releasing feeds:

```bash
pnpm run typecheck
pnpm run test:integrity
pnpm run build
pnpm run smoke:prod
```

To verify live source availability against a running app, start the app and point the live-source verifier at it:

```bash
OVERSEER_BASE_URL=http://127.0.0.1:3000 pnpm run verify:live-sources
```

Useful command map:

| Command | Purpose |
| --- | --- |
| `pnpm run test:integrity` | Deterministic no-network regression checks for feed normalization, source status, and no-synthetic behavior |
| `pnpm run smoke:prod` | Starts the built standalone server and verifies `/`, `/api/health`, `/api/earthquakes`, `/api/news`, and `/api/sources` |
| `pnpm run verify:live-sources` | Produces a JSON report of live provider availability, accepted counts, and unavailable/omitted streams |
| `pnpm run smoke:desktop` | Launches Electron or a packaged desktop binary and verifies the embedded dashboard plus `/api/health` |

---

## Quick Start

```bash
git clone https://github.com/UrMom-dev-new/Overseer.git
cd Overseer
corepack enable
pnpm install
pnpm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### Desktop Apps

Overseer can also run as a macOS or Windows desktop program through Electron:

```bash
corepack enable
pnpm install
pnpm run desktop:dev         # desktop development
pnpm run smoke:desktop       # desktop startup smoke test
pnpm run desktop:dist:mac    # macOS DMG + ZIP
pnpm run desktop:dist:win    # Windows installer + portable EXE
```

Desktop build artifacts are written to `release/`. The packaged shell opens a local startup/recovery screen immediately, binds the Next.js runtime on `127.0.0.1`, verifies `/api/health`, then loads the dashboard. See **[docs/macos-desktop.md](docs/macos-desktop.md)** and **[docs/windows-desktop.md](docs/windows-desktop.md)** for the full development, smoke-test, and installer workflows.

### Docker / Self-Hosting

```bash
git clone https://github.com/UrMom-dev-new/Overseer.git
cd Overseer
# optional: create .env only if you need keys, custom ports, or backend URLs
docker compose up -d
```

Open [http://localhost:3000](http://localhost:3000). The image is a multi-stage
`node:22-alpine` standalone build (~220 MB, non-root). The compose file also
carries CasaOS app metadata (`x-casaos:`) for one-click install on
[CasaOS](https://casaos.io). See **[DOCKER.md](DOCKER.md)** for the full Docker,
CasaOS and API-key guide.

**Custom port** — the container always listens on `3000`; set `OVERSEER_PORT` in
`.env` to change the published host port (e.g. `OVERSEER_PORT=3005`) without
editing the compose file.

### Environment Variables

OVERSEER works **partially without any API keys** — most core feeds use public,
keyless sources. Copy `.env.template` to `.env` only for the optional services you need:

```env
# Published host port (container always listens on 3000). Default: 3000
OVERSEER_PORT=3000

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
