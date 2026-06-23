<div align="center">

# OVERSEER

**Self-hostable real-time situational-awareness dashboard**

[![Next.js](https://img.shields.io/badge/Next.js-16-black?style=for-the-badge&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MapLibre](https://img.shields.io/badge/MapLibre_GL-WebGL-396CB2?style=for-the-badge)](https://maplibre.org/)
[![License](https://img.shields.io/badge/License-MIT-D4AF37?style=for-the-badge)](LICENSE)

OVERSEER aggregates public APIs, private APIs, map overlays, live feeds, environmental hazards, cyber signals, and operator-defined data feeds into a single MapLibre-powered dashboard.

</div>

---

## Contents

- [Overview](#overview)
- [Current capabilities](#current-capabilities)
- [Architecture](#architecture)
- [Quick start](#quick-start)
- [Docker self-hosting](#docker-self-hosting)
- [Environment configuration](#environment-configuration)
- [Admin feed configuration](#admin-feed-configuration)
- [Data layers](#data-layers)
- [API routes](#api-routes)
- [Security model](#security-model)
- [Testing](#testing)
- [Continuous integration](#continuous-integration)
- [Project structure](#project-structure)
- [Troubleshooting](#troubleshooting)
- [Responsible use](#responsible-use)
- [License](#license)

---

## Overview

OVERSEER is a Next.js application for monitoring heterogeneous open-source intelligence feeds on a global map. It includes a real-time dashboard, a GPU-rendered map, layer controls, live intelligence panels, an admin feed editor, and API routes that normalize data from external and internal sources.

The project was renamed from **osiris** to **overseer**. Current code, package metadata, Docker files, feed configuration, UI naming, and public assets should use the OVERSEER name.

Core design goals:

- Keep the dashboard useful with mostly keyless public feeds.
- Make feed endpoints editable from the UI through a protected admin panel.
- Support self-hosting through Docker Compose without requiring external Compose networks.
- Keep map rendering fast by using MapLibre/WebGL instead of DOM-heavy markers.
- Normalize feed payloads behind local `/api/...` routes so the UI does not directly depend on every upstream source.
- Provide baseline security controls for admin writes, webhook ingestion, popup rendering, and feed testing.

---

## Current capabilities

### Dashboard and map

- MapLibre GL map with dark and satellite styles.
- Globe and Mercator projection modes.
- Desktop and mobile dashboard shells.
- Layer groups for aviation, maritime, surveillance, natural hazards, infrastructure, cyber, and display overlays.
- Live entity counts per layer where the underlying feed exposes array data.
- Region dossier, search, view presets, scale bar, live alerts, markets panel, intelligence feed, and OSINT tools.
- Shareable URL layer state through the `?layers=` query parameter.

### Editable feed system

- Central feed registry in `src/lib/feed-config.ts`.
- Persistent admin-edited feed configuration through `src/lib/feed-config-store.ts`.
- Runtime polling and feed-health state extracted into `src/hooks/useFeedController.ts` and `src/lib/feed-controller.ts`.
- Admin UI for editing endpoints, enabling/disabling feeds, changing poll intervals, testing endpoints, and previewing sample JSON.
- Feed health fields: status, last checked time, last success time, last error, HTTP status, latency, record count, and sample preview.

### Recently added routes

- `/api/balloons` for high-altitude balloon / sonde observations.
- `/api/radiation` for radiation monitoring stations, with optional external JSON feed override.
- `/api/admin/feed-config/test` for authenticated feed endpoint testing and diagnostics.

### Security hardening

- Admin feed writes require `OVERSEER_ADMIN_KEY`.
- Admin writes are locked when the key is not configured.
- Admin-key comparisons use constant-time digest comparison.
- The admin key is kept in memory in the UI session rather than persisted to local storage.
- MapLibre popups use sanitized DOM content instead of raw interpolated HTML.
- Unsafe popup URL protocols are blocked.
- External popup links use `rel="noopener noreferrer"`.
- GitHub webhook forwarding is env-configured instead of hardcoded.
- SDK ingestion is disabled until an ingest key is configured.
- Umami middleware and the external Umami Compose network dependency have been removed.

---

## Architecture

```txt
┌────────────────────────────────────────────────────────────────────┐
│                             Browser UI                              │
│                                                                    │
│  DashboardClient                                                   │
│  ├─ LayerPanel                                                     │
│  ├─ AdminPanel                                                     │
│  ├─ IntelFeed / MarketsPanel / OSINT panels                         │
│  └─ OverseerMap                                                    │
│     ├─ map/popup.ts                                                │
│     ├─ map/register-layers.ts                                      │
│     └─ map/solar.ts                                                │
└────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│                          Feed controller                            │
│                                                                    │
│  useFeedController                                                 │
│  ├─ loads /api/admin/feed-config                                   │
│  ├─ polls enabled core feeds                                       │
│  ├─ polls active map-layer feeds                                   │
│  ├─ transforms payloads into dashboard state                       │
│  └─ records feed health, errors, latency, counts, and samples       │
└────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│                         Next.js API routes                          │
│                                                                    │
│  /api/flights       /api/maritime       /api/cctv                  │
│  /api/earthquakes   /api/fires          /api/weather               │
│  /api/news          /api/live-news      /api/gdelt                 │
│  /api/markets       /api/space-weather  /api/malware               │
│  /api/balloons      /api/radiation      /api/infrastructure        │
│  /api/osint/*       /api/sdk/*          /api/admin/feed-config     │
└────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│                      External / local data sources                  │
│                                                                    │
│  Public APIs, static datasets, RSS/news feeds, scanner backend,     │
│  optional AIS feed, optional radiation feed, webhook ingest, and    │
│  operator-edited feed endpoints.                                   │
└────────────────────────────────────────────────────────────────────┘
```

---

## Quick start

### Prerequisites

- Node.js 22 recommended.
- npm with lockfile support.
- A modern browser with WebGL support.

### Local development

```bash
git clone <your-overseer-repository-url>
cd overseer
npm ci
cp .env.example .env.local
npm run dev
```

Open:

```txt
http://localhost:3000
```

The app can run without most third-party API keys. Features that require explicit secrets, such as admin writes, SDK ingestion, scanner-backed recon, and production GitHub webhook verification, remain disabled or locked until configured.

### Production build

```bash
npm run lint
npx tsc --noEmit --pretty false
npm run test
npm run build
npm run start
```

Default production server:

```txt
http://localhost:3000
```

---

## Docker self-hosting

The default Compose file uses a project-local Compose network. It no longer depends on an external `umami_default` network.

```bash
git clone <your-overseer-repository-url>
cd overseer
cp .env.example .env
docker compose up -d --build
```

Open:

```txt
http://localhost:3000
```

### Services

| Service | Purpose | Default port |
|---|---:|---:|
| `overseer` | Next.js standalone application | `3000` |
| `overseer-cache` | Nginx cache/proxy service | `8080` |
| `overseer-intel` | Auxiliary intelligence service | `4000` |

### Persistent data

Admin-edited feed configuration is persisted to the `overseer-data` volume. Inside the container, the application uses:

```txt
/data/feed-config.json
```

This path is controlled by:

```bash
OVERSEER_CONFIG_DIR=/data
```

### Change published web port

Set `OVERSEER_PORT` in `.env`:

```bash
OVERSEER_PORT=8088
```

Then restart:

```bash
docker compose up -d
```

Open:

```txt
http://localhost:8088
```

---

## Environment configuration

Copy `.env.example` to `.env.local` for local development or `.env` for Docker Compose.

```bash
cp .env.example .env.local
```

### Runtime

| Variable | Required | Description |
|---|---:|---|
| `OVERSEER_PORT` | No | Host port used by Docker Compose. Defaults to `3000`. |
| `OVERSEER_ADMIN_KEY` | Recommended | Shared secret required for feed-admin save/reset/test write operations. Without it, admin writes are locked. |
| `OVERSEER_CONFIG_DIR` | No | Directory for persisted feed config. Docker defaults to `/data`; local dev defaults to `./.overseer`. |
| `NEXT_BUILD_WORKERS` | No | Caps Next.js build workers. Defaults to `4`, useful on constrained builders. |

Generate a strong admin key:

```bash
openssl rand -hex 32
```

### Scanner backend

| Variable | Required | Description |
|---|---:|---|
| `SCANNER_URL` | No | URL for the optional RECON scanner backend. |
| `SCANNER_KEY` | No | Shared key expected by the scanner backend. Must match the backend key. |

If these are unset, scanner-backed RECON functions return unavailable responses instead of silently using insecure defaults.

### Webhooks and ingestion

| Variable | Required | Description |
|---|---:|---|
| `GITHUB_WEBHOOK_SECRET` | Production | Secret used to verify GitHub webhook signatures. Required in production. |
| `GITHUB_WEBHOOK_FORWARD_URL` | No | Optional HTTP(S) target to forward verified GitHub webhook payloads. If unset, valid webhooks are accepted but not forwarded. |
| `SDK_INGEST_KEY` | For SDK ingest | Shared key for `/api/sdk/ingest`. Ingestion is disabled until configured. |
| `SDK_INGEST_KEYS` | No | Comma-separated list of accepted SDK ingest keys. Overrides or supplements single-key deployment patterns. |

### Optional data-source keys

| Variable | Required | Description |
|---|---:|---|
| `AIS_API_KEY` | No | Optional aisstream.io key for live maritime AIS data. |
| `RADIATION_FEED_URL` | No | Optional external JSON endpoint consumed by `/api/radiation`. |
| `SAFECAST_API_URL` | No | Alternate radiation feed URL variable supported by `/api/radiation`. |

The repository may include template comments for additional upstream sources. Only set keys for integrations you actually use.

---

## Admin feed configuration

The feed admin panel lets operators edit the API endpoints used by the dashboard without changing source code.

### Enable admin writes

Set:

```bash
OVERSEER_ADMIN_KEY=<strong-random-secret>
```

Restart the app after changing environment variables.

### Open the admin panel

Use the dashboard settings/admin control. Enter the admin key when prompted. The key is held in memory for the current panel session and is not stored in `localStorage`.

### Admin API

#### Read feed config

```http
GET /api/admin/feed-config
```

Authentication is not required for read-only config metadata. The response includes whether writes are locked.

Example response shape:

```json
{
  "feeds": [],
  "requiresAdminKey": true,
  "adminKeyConfigured": true,
  "writeLocked": false,
  "writable": true
}
```

#### Save feed config

```http
POST /api/admin/feed-config
Authorization: Bearer <OVERSEER_ADMIN_KEY>
Content-Type: application/json
```

```json
{
  "feeds": [
    {
      "id": "earthquakes",
      "endpoint": "/api/earthquakes",
      "enabled": true,
      "pollMs": 900000
    }
  ]
}
```

You can also send the key as:

```http
x-overseer-admin-key: <OVERSEER_ADMIN_KEY>
```

#### Reset feed config

```http
DELETE /api/admin/feed-config
Authorization: Bearer <OVERSEER_ADMIN_KEY>
```

This resets persisted feed configuration back to the default registry.

#### Test a feed endpoint

```http
POST /api/admin/feed-config/test
Authorization: Bearer <OVERSEER_ADMIN_KEY>
Content-Type: application/json
```

```json
{
  "id": "radiation",
  "endpoint": "/api/radiation"
}
```

Response fields include:

| Field | Meaning |
|---|---|
| `ok` | Whether the endpoint returned a successful HTTP response. |
| `status` | Feed health status: `ok`, `error`, `loading`, `idle`, or `disabled`. |
| `httpStatus` | HTTP status returned by the endpoint. |
| `latencyMs` | Request latency in milliseconds. |
| `recordCount` | Estimated number of records in the payload. |
| `lastError` | Error text for failed checks. |
| `contentType` | Response content type. |
| `responseBytes` | Raw response size in bytes. |
| `sample` | Bounded sample JSON preview. |

### Feed endpoint validation

Editable endpoints may be:

- Local app routes beginning with `/`, except admin routes.
- Absolute `http://` or `https://` URLs.

The test endpoint uses same-origin fetches for local app routes and an SSRF-guarded fetch path for remote URLs.

---

## Data layers

The active layer panel and feed registry are aligned around these core feeds.

| Feed ID | Default endpoint | Layer keys | Notes |
|---|---|---|---|
| `earthquakes` | `/api/earthquakes` | `earthquakes` | USGS-style seismic events. |
| `news` | `/api/news` | `news_intel` | Geotagged news/intelligence items. |
| `markets` | `/api/markets` | None | Markets panel data. |
| `spaceWeather` | `/api/space-weather` | None | Command/status bar data. |
| `flights` | `/api/flights` | `flights`, `private`, `jets`, `military` | Commercial/private/military aviation layers. |
| `satellites` | `/api/satellites` | `satellites` | Orbital/satellite overlays. |
| `fires` | `/api/fires` | `fires` | Fire and hazard events. |
| `cctv` | `/api/cctv?region=all&v=2` | `cctv` | Public/traffic camera inventory. |
| `maritime` | `/api/maritime` | `maritime` | Ports, chokepoints, and ships. |
| `balloons` | `/api/balloons` | `balloons` | Balloon and sonde observations. |
| `radiation` | `/api/radiation` | `radiation` | Radiation monitoring stations. |
| `liveNews` | `/api/live-news` | `live_news` | Live video/news feeds. |
| `weather` | `/api/weather` | `weather` | Severe weather overlays. |
| `infrastructure` | `/api/infrastructure` | `infrastructure` | Critical infrastructure and nuclear facilities. |
| `gdelt` | `/api/gdelt` | `global_incidents` | Geotagged global incidents. |
| `malware` | `/api/malware` | `malware` | Cyber/malware threat layer. |

Additional display or static layer controls include `day_night`, `terrain_3d`, `cables`, `conflict_zones`, `gps_jamming`, `sdk_sea`, `sdk_air`, and `sdk_naval`.

---

## API routes

The app exposes local API routes that normalize data for the frontend. Not every route requires an external key.

### Feed and dashboard routes

| Route | Purpose |
|---|---|
| `/api/health` | Basic application health response. |
| `/api/admin/feed-config` | Read/save/reset editable feed configuration. |
| `/api/admin/feed-config/test` | Authenticated feed endpoint test with diagnostics and sample preview. |
| `/api/earthquakes` | Seismic event feed. |
| `/api/news` | News/intelligence feed. |
| `/api/live-news` | Live video/news feed metadata. |
| `/api/markets` | Market/risk panel data. |
| `/api/space-weather` | Space-weather status. |
| `/api/flights` | Aircraft layers. |
| `/api/maritime` | Maritime ports, chokepoints, and ships. |
| `/api/cctv` | Camera inventory. |
| `/api/cctv/stream-status` | Camera stream status helper. |
| `/api/satellites` | Satellite/object overlays. |
| `/api/fires` | Fire/hazard events. |
| `/api/weather` | Weather events. |
| `/api/gdelt` | Global incident feed. |
| `/api/malware` | Malware/threat feed. |
| `/api/balloons` | Balloon/sonde observations. |
| `/api/radiation` | Radiation station readings. |
| `/api/infrastructure` | Critical infrastructure overlays. |
| `/api/air-quality` | Air-quality data. |
| `/api/country-risk` | Country risk metadata. |
| `/api/cyber-threats` | Cyber threat summaries. |
| `/api/frontlines` | Frontline/conflict metadata. |
| `/api/radar` | Radar-style overlay data. |
| `/api/sentinel` | Sentinel feed data. |
| `/api/stats` | Dashboard statistics. |
| `/api/geo` | IP/location helper used for initial map positioning. |
| `/api/proxy-tiles` | Tile proxy helper. |

### OSINT and investigation routes

| Route | Purpose |
|---|---|
| `/api/scanner` | Scanner-backed RECON entry point. |
| `/api/entity/expand` | Entity expansion helper. |
| `/api/region-dossier` | Region dossier generation. |
| `/api/scm-suppliers` | Supply-chain/supplier panel data. |
| `/api/osint/bgp` | BGP lookup. |
| `/api/osint/certs` | Certificate lookup. |
| `/api/osint/cve` | CVE lookup. |
| `/api/osint/dns` | DNS lookup. |
| `/api/osint/github` | GitHub-related OSINT helper. |
| `/api/osint/ip` | IP intelligence. |
| `/api/osint/leaks` | Leak lookup. |
| `/api/osint/mac` | MAC/vendor lookup. |
| `/api/osint/phone` | Phone-number intelligence. |
| `/api/osint/sanctions` | Sanctions lookup. |
| `/api/osint/shodan` | Shodan-style helper route. |
| `/api/osint/sweep` | OSINT sweep aggregation. |
| `/api/osint/threats` | Threat intelligence helper. |
| `/api/osint/whois` | WHOIS lookup. |

### AI, webhook, and SDK routes

| Route | Purpose |
|---|---|
| `/api/ai/analyze` | AI analysis helper. Requires configured model/provider keys if used. |
| `/api/ai/briefing` | AI briefing helper. Requires configured model/provider keys if used. |
| `/api/github-webhook` | GitHub webhook receiver with optional forwarding. |
| `/api/sdk/ingest` | External entity ingestion. Disabled until `SDK_INGEST_KEY` or `SDK_INGEST_KEYS` is configured. |
| `/api/sdk/stream` | SDK entity stream. |

---

## Security model

OVERSEER is designed for self-hosted operational use. Treat it as an internet-facing application only after configuring secrets and reviewing network exposure.

### Admin feed writes

- `POST /api/admin/feed-config`, `DELETE /api/admin/feed-config`, and `POST /api/admin/feed-config/test` require `OVERSEER_ADMIN_KEY`.
- If `OVERSEER_ADMIN_KEY` is unset, writes and endpoint tests are locked.
- Admin-key checks use SHA-256 digests with timing-safe comparison.
- The frontend does not persist the admin key in local storage.

### Feed endpoint testing

- Local `/api/...` routes are fetched same-origin.
- Remote `http://` and `https://` routes use the SSRF guard path.
- Admin routes are blocked as editable feed endpoints.
- Response previews are bounded to avoid excessive payload rendering.

### Map popups

- Map popups are constructed as DOM content instead of raw `setHTML(...)` strings.
- Inline event handlers are stripped.
- Unsafe URL protocols are blocked.
- External links receive `rel="noopener noreferrer"`.

### Webhooks

- `GITHUB_WEBHOOK_SECRET` is required in production for `/api/github-webhook`.
- Forwarding is disabled unless `GITHUB_WEBHOOK_FORWARD_URL` is set.
- Forward target must be `http://` or `https://`.

### SDK ingestion

- `/api/sdk/ingest` accepts no data until `SDK_INGEST_KEY` or `SDK_INGEST_KEYS` is configured.
- Ingested entities must include required source, key, and position fields.

### Remaining production hardening to consider

The current `Content-Security-Policy` is intentionally permissive because the app embeds maps, media, tiles, and external feed resources. Before deploying to a hostile public environment, review and narrow the policy in `next.config.ts` for your exact upstream domains.

---

## Testing

### Lint

```bash
npm run lint
```

### Typecheck

```bash
npx tsc --noEmit --pretty false
```

### Unit tests

```bash
npm run test
```

Vitest tests live beside the source files, for example:

```txt
src/lib/feed-config.test.ts
src/lib/feed-controller.test.ts
```

### Watch mode

```bash
npm run test:watch
```

### Playwright smoke tests

Install the browser first:

```bash
npm run test:e2e:install
```

Run smoke tests:

```bash
npm run test:e2e
```

Current smoke coverage includes:

- Dashboard command surface renders.
- Feed config API is reachable.
- Feed registry includes `balloons` and `radiation`.

For constrained or managed environments that already provide Chromium, set:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium npm run test:e2e
```

---

## Continuous integration

GitHub Actions workflow:

```txt
.github/workflows/ci.yml
```

The CI job runs:

```bash
npm ci
npm run lint
npx tsc --noEmit --pretty false
npm run test
npm run build
npx playwright install --with-deps chromium
npm run test:e2e
```

The workflow sets CI-only secrets for validation:

```bash
OVERSEER_ADMIN_KEY=ci-admin-key
SDK_INGEST_KEY=ci-sdk-key
```

---

## Project structure

```txt
overseer/
├── .github/workflows/ci.yml
├── Dockerfile
├── docker-compose.yml
├── DOCKER.md
├── SECURITY.md
├── package.json
├── playwright.config.ts
├── vitest.config.ts
├── public/
│   ├── dark-matter-style.json
│   ├── overseer-icon.png
│   └── data/
├── intel/
│   ├── Dockerfile
│   └── server.js
├── nginx/
│   └── nginx.conf
├── src/
│   ├── app/
│   │   ├── page.tsx
│   │   └── api/
│   ├── components/
│   │   ├── dashboard/DashboardClient.tsx
│   │   ├── map/popup.ts
│   │   ├── map/register-layers.ts
│   │   ├── map/solar.ts
│   │   ├── AdminPanel.tsx
│   │   ├── LayerPanel.tsx
│   │   └── OverseerMap.tsx
│   ├── hooks/
│   │   └── useFeedController.ts
│   ├── lib/
│   │   ├── admin-auth.ts
│   │   ├── feed-config.ts
│   │   ├── feed-config-store.ts
│   │   ├── feed-controller.ts
│   │   ├── ssrf-guard.ts
│   │   └── *.test.ts
│   └── test/setup.ts
└── tests/e2e/dashboard.spec.ts
```

### Important files

| File | Purpose |
|---|---|
| `src/app/page.tsx` | Thin App Router page wrapper. |
| `src/components/dashboard/DashboardClient.tsx` | Main dashboard client shell. |
| `src/components/OverseerMap.tsx` | Map orchestration component. |
| `src/components/map/popup.ts` | Popup sanitization and DOM helpers. |
| `src/components/map/register-layers.ts` | MapLibre source/layer registration helpers. |
| `src/components/map/solar.ts` | Solar terminator geometry. |
| `src/hooks/useFeedController.ts` | Runtime feed polling and dashboard data controller. |
| `src/lib/feed-config.ts` | Default editable feed registry and validation. |
| `src/lib/feed-config-store.ts` | Persistence for edited feed config. |
| `src/lib/feed-controller.ts` | Feed transforms, health helpers, record counts, sample previews. |
| `src/lib/admin-auth.ts` | Admin key authorization helpers. |
| `src/lib/ssrf-guard.ts` | Remote feed fetch guard. |

---

## Available npm scripts

| Script | Command | Purpose |
|---|---|---|
| `dev` | `next dev` | Run local development server. |
| `build` | `next build` | Build standalone production app. |
| `start` | `next start` | Start built app. |
| `lint` | `eslint` | Run ESLint. |
| `test` | `vitest run` | Run unit tests once. |
| `test:watch` | `vitest` | Run unit tests in watch mode. |
| `test:e2e` | `playwright test` | Run Playwright smoke tests. |
| `test:e2e:install` | `playwright install --with-deps chromium` | Install Playwright Chromium and dependencies. |

---

## Troubleshooting

### Admin panel says writes are locked

Set `OVERSEER_ADMIN_KEY` and restart the app.

```bash
OVERSEER_ADMIN_KEY=$(openssl rand -hex 32)
```

For Docker, put the key in `.env` and restart:

```bash
docker compose up -d
```

### Feed test returns 401

The admin key is missing or incorrect. Send it as either:

```http
Authorization: Bearer <key>
```

or:

```http
x-overseer-admin-key: <key>
```

### Feed test returns 400 for an endpoint

The endpoint failed validation. Use a same-origin path such as:

```txt
/api/radiation
```

or an absolute HTTP(S) URL such as:

```txt
https://example.com/feed.json
```

Do not use protocol-relative URLs, newline characters, or admin API routes as feed endpoints.

### `/api/radiation` only shows baseline stations

Set one of these variables to point at an external JSON feed:

```bash
RADIATION_FEED_URL=https://example.com/radiation.json
# or
SAFECAST_API_URL=https://example.com/radiation.json
```

The feed should return an array or an object containing station/measurement/feature records with latitude, longitude, and reading fields.

### RECON scanner features return 503

Set both scanner variables and make sure the scanner backend is running:

```bash
SCANNER_URL=http://scanner:7700
SCANNER_KEY=<shared-secret>
```

### Docker build is slow or memory constrained

Lower Next.js worker count:

```bash
NEXT_BUILD_WORKERS=2 docker compose build
```

### Playwright cannot launch a browser locally

Install Playwright Chromium:

```bash
npm run test:e2e:install
```

Or use a system browser:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e
```

## License

MIT. See [LICENSE](LICENSE).
