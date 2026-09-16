# Self-Hosting OVERSEER with Docker

OVERSEER ships as a self-contained Next.js standalone build. This guide covers
running it with Docker / Docker Compose, deploying it as a [CasaOS](https://casaos.io)
app, and configuring the optional API keys.

> **TL;DR:** OVERSEER runs fully **without any API keys**. All core feeds
> (aviation, satellites, fires, earthquakes, weather, news, CVEs) use public
> keyless sources. Keys only matter for the optional RECON scanner backend and
> for raising rate limits on a few feeds.

---

## 1. Docker Compose (recommended)

```bash
git clone https://github.com/UrMom-dev-new/Overseer.git
cd Overseer

# optional: configure keys / scanner backend
cp .env.template .env        # then edit .env

docker compose up -d
```

Open <http://localhost:3000>.

What the compose file does:

- **`build:`** — builds the local `Dockerfile` with the checked-out source.
  This repository does not publish a registry image yet; add an explicit
  `image:` tag only after a protected publish workflow exists.
- **`env_file: .env` (`required: false`)** — if a `.env` file exists its
  values are injected into the container; if it's missing, OVERSEER still starts
  with the keyless feeds.
- **`ports: ${OVERSEER_PORT:-3000}:3000`** — the web UI. The container always
  listens on 3000; the published **host** port is `OVERSEER_PORT` (default
  `3000`). Set `OVERSEER_PORT` in `.env` to remap it, e.g. `OVERSEER_PORT=3005`
  when 3000 is already in use — no need to edit the compose file.
- **`overseer-data:/app/data`** — writable storage for bounded source
  snapshots. Restored snapshots are labeled as cached/last-known-good while the
  app refreshes; they are not newly verified live data.
- **`restart: unless-stopped`** — survives reboots.

Common commands:

```bash
docker compose logs -f          # follow logs
docker compose up -d --build    # rebuild locally after pulling new code
docker compose down             # stop & remove
```

The compose path is the supported local-build path. There is no versioned
container image published by this repository at the time of writing, and
normal development builds do not push images.

### Plain `docker run`

```bash
docker build -t overseer:latest .
docker run -d --name overseer -p 3000:3000 --env-file .env --restart unless-stopped overseer:latest
```

### Image details

Multi-stage build on `node:22-alpine`, runs as a non-root user (`nextjs`,
uid 1001), serves Next.js standalone via `node server.js` on port 3000.
Final image is ~220 MB. Build excludes `node_modules`, `.next`, `.git` and the
repo's large `*.diff` artifacts via `.dockerignore`.

---

## 2. CasaOS

The compose file includes an `x-casaos:` metadata block (title, description,
icon, port map, env descriptions) that plain Docker Compose ignores but CasaOS
reads.

**Install:**

1. On the CasaOS host, clone the repo somewhere persistent (e.g.
   `/DATA/AppData/overseer`).
2. CasaOS dashboard → **`+`** → **Install a customized app** → paste the
   contents of `docker-compose.yml`.
   *(or simply run `docker compose up -d` from the cloned directory).*
3. OVERSEER appears on the dashboard with its icon, reachable on host port
   `3000` (or whatever `OVERSEER_PORT` you set in `.env`).

The UrMom source mark is `public/UrMom.svg`. The CasaOS icon is
`public/casaos-icon.png` (512×512 PNG), referenced by the `icon:` URL in the
metadata.

> CasaOS stores imported compose files under `/var/lib/casaos/apps/`, so a
> relative `build:` context may not resolve there. If importing the YAML
> directly, either build/tag `overseer:latest` first
> (`docker build -t overseer:latest /path/to/overseer`) or publish a registry
> image from your own CI and set `image:` to that tag.

---

## 3. API keys & data sources

Copy `.env.template` to `.env` and fill in only what you need.

### What the code actually reads today

| Variable | Purpose | Required for |
|----------|---------|--------------|
| `SCANNER_URL` | RECON scanner backend base URL (e.g. `http://scanner:7700`) | RECON toolkit (quick/ssl/headers/rdns/subdomains/tech/whois/geoloc/vuln) |
| `SCANNER_KEY` | Shared secret; **must equal the backend's `OVERSEER_KEY`** | RECON toolkit |

Without `SCANNER_URL`/`SCANNER_KEY` the RECON endpoints return `503` and the
rest of OVERSEER works normally. Generate a key with `openssl rand -hex 32`.

### Optional keys

Most data routes use **keyless** public feeds. Set these only for optional
providers, higher rate limits, or credentialed feeds.

| Variable | Service | How to get it (all free) |
|----------|---------|--------------------------|
| `FIRMS_API_KEY` | NASA FIRMS active fires | Enter an email at <https://firms.modaps.eosdis.nasa.gov/api/map_key/> — the `MAP_KEY` is emailed instantly. Limit 5000 req / 10 min. |
| `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET` | OpenSky aviation | Create an account at <https://opensky-network.org/>, open **Account → API client**, create a client and copy id/secret. **OAuth2 only since March 2025** (username/password auth removed). |
| `AIS_API_KEY` | aisstream.io maritime | Sign up at <https://aisstream.io/>, create a key on the **API Keys** page. Used over `wss://stream.aisstream.io/v0/stream`. |
| `GEMINI_API_KEY_1` | Optional AI analyst | Create a key in Google AI Studio if you want the AI briefing/analysis endpoints. |

> Keep `.env` out of version control — it is already in `.gitignore`. Only
> `.env.template` (no secrets) is committed.

### Optional runtime overrides

| Variable | Purpose | Default |
|----------|---------|---------|
| `OVERSEER_TELEGRAM_CHANNELS` | Comma-separated list of public Telegram channel usernames (no `@`) to scrape for the **Telegram OSINT** map layer. Overrides the curated default set. | `osintdefender,insiderpaper,aljazeeraenglish,nexta_live,war_monitor` |
| `OVERSEER_PORT` | Host port the compose file publishes (container itself always listens on 3000). | `3000` |
| `OVERSEER_DATA_DIR` | Writable runtime data directory for eligible source snapshots. Compose sets this to `/app/data`. | unset outside compose |
| `OVERSEER_SNAPSHOT_CACHE` | Set to `0`, `false`, `off`, or `disabled` to disable disk snapshot persistence. | enabled when `OVERSEER_DATA_DIR` is set |
| `OVERSEER_SNAPSHOT_RETENTION_MS` | Maximum age for persisted snapshots before pruning. | `86400000` |
| `OVERSEER_SNAPSHOT_MAX_ENTRIES` | Maximum persisted snapshot files per namespace. | `80` |

### Keyless sources (no configuration needed)

Aviation → OpenSky / `adsb.lol` · Satellites → SatNOGS / `celestrak.org` (TLE) · Fires →
NASA FIRMS open-data CSV · Earthquakes → USGS · Weather → NOAA/NWS / NASA EONET · Space
weather → NOAA SWPC · CVEs → CISA KEV / NVD · News → public RSS / HLS streams · CCTV →
public traffic-authority feeds · Crypto (BTC) → `blockstream.info` · Crypto
(ETH) → `eth.blockscout.com` ([Blockscout](https://github.com/blockscout/blockscout)
open-source explorer) · OFAC SDN sanctions → [OpenSanctions](https://www.opensanctions.org)
mirror (CC-BY 4.0) · Telegram OSINT → public `t.me/s/<channel>` web preview.
