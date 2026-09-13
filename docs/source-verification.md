# Source Verification Matrix

Last checked: 2026-09-13 from the local Codex host with short live HTTP probes.

Policy: failed streams are omitted. They must not emit synthetic records, reassuring defaults, current timestamps for old observations, or invented risk/severity. When a real alternate is wired, the route exposes both source statuses. When an alternate is not wired, the response documents candidate alternates.

## Checked Sources

| Feed | Primary source | Probe result | Alternate / behavior |
| --- | --- | --- | --- |
| Earthquakes | USGS `2.5_day.geojson` | 200, valid GeoJSON | No alternate needed in this pass. Invalid geometry is rejected. |
| Seismic exposure overlays | USGS `4.5_day.geojson` | 200, valid GeoJSON | If unavailable, seismic exposure is omitted; facility reference status is not overwritten. |
| GDELT mentions | GDELT Geo API | Fetch timed out from this host | Route returns unavailable/last-known-good only. Response lists GDACS RSS and ACLED as alternates; no synthetic incidents. |
| Cyber KEV | CISA KEV JSON | 200, valid JSON | Technical severity remains null unless a source supplies it. |
| Weather/events | NASA EONET, NOAA/NWS active alerts | 200, valid JSON/GeoJSON | Each provider has independent status; geometry-free alerts remain text-visible. |
| Fires | NASA FIRMS VIIRS/MODIS, NASA EONET volcanoes | 200, valid CSV/JSON | VIIRS is primary, MODIS alternate. EONET measurements unsupported by source remain null. |
| Flights | OpenSky global states | 200, valid JSON | airplanes.live military/LADD returned 403. ADSB.lol military and ADSB.lol LADD returned 200 and are now wired alternates. |
| Satellites | SatNOGS TLE API | 200, valid JSON | CelesTrak active TLE returned 200 and is wired as a real alternate. The old ISS emergency fallback was removed. |
| Markets | Yahoo Finance chart/quote | 200, valid JSON for checked symbol | CoinGecko simple price returned 200 and fills only crypto gaps. Missing symbols are omitted, not estimated. |
| Internet outages | Georgia Tech IODA | 200, valid JSON | If unavailable, outage stream is omitted and Cloudflare Radar Outage Center is listed as manual reference. Country-level points are centroids, not exact outage locations. |
| Air quality | OpenAQ v2 latest | 410 Gone | OpenAQ v3 requires an API key. Open-Meteo Air Quality returned 200 and is wired as a fixed-city real-data alternate. |
| Space weather | NOAA SWPC Kp | 200, valid JSON | Old `json/alerts.json` returned 404. Current `products/alerts.json` returned 200 and is now used. Missing Kp remains unknown, not quiet. |
| Malware | abuse.ch Feodo, URLhaus | 200, valid JSON/CSV | Country-level Feodo points are centroids. URLhaus host geolocation uses ip-api; missing dates remain null. |
| Country risk | Internal static risk table | Removed | Synthetic country-risk scores are omitted. Candidate real providers: GDACS, ACLED, ReliefWeb-style humanitarian feeds where accessible. |
| SCM exposure | USGS, local fires, local GDELT | Source-backed only | Missing streams are omitted. Supplier risk is not inferred; the route emits proximity indicators only. |

## Sources Found Unavailable Or Blocked

- OpenAQ v2 latest returned HTTP 410.
- OpenAQ v3 latest/locations returned HTTP 401 without an API key.
- NOAA SWPC `json/alerts.json` returned HTTP 404; replaced with `products/alerts.json`.
- airplanes.live military/LADD and point sample returned HTTP 403 from this host; ADSB.lol equivalents returned HTTP 200.
- ReliefWeb v1 returned HTTP 410, and the checked v2 reports GET returned HTTP 403.
- GDELT Geo timed out from this host during the probe; the route now exposes alternates in metadata and does not create replacement incidents.

## Additional No-Synthetic Hardening

- Caltrans CCTV camera IDs are now deterministic from provider fields. Random IDs are not used.
- The Ontario CCTV API-list placeholders for Toronto were removed; if Ontario 511 does not return actual camera records, those camera points are omitted.
- NIGGG-BAS seismic parsing now preserves missing magnitude, depth, location label, and observation time as `null`; it does not substitute `0`, a generic place, or the current time.

## Verification Command Shape

The live probe used Node `fetch` with an explicit timeout and only checked transport status plus basic JSON/text shape. It did not assert provider semantic correctness beyond successful parse and expected top-level structure. Runtime route validation still performs record-level checks before emitting data.
