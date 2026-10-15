# Infrastructure Sources

The supplied catalog contains 28 provider/product references, not asset coordinates. `src/data/infrastructure-sources.json` preserves every CSV field. The Infrastructure source catalog exposes those records, their access restrictions, and scoped alternatives. Its review date comes from the attachment; it is not a live verification timestamp. None of the catalog rows are represented as observed infrastructure assets.

## Native Map Layers

Five separately selectable layers cover power, water, wastewater, medical facilities and telecommunications. OSM nodes and ways are fetched with explicit sector filters through FOSSGIS Overpass and the Private.coffee alternate. These are two access routes to the same OSM database, not independent confirmation. Geofabrik's regional PBF extracts are listed as a manual bulk alternative; the app does not download a planet file or parse PBF.

`GET /api/infrastructure-assets?sectors=power,water,wastewater,medical,telecom&bbox=west,south,east,north`

- Valid bounds must fit within one degree on each side. Global queries and antimeridian-crossing boxes are rejected with HTTP 400; narrow or split the area.
- Source geometry is kept as Point, LineString or Polygon, without creating a representative centroid. Multipolygon relations are not collected. This is deliberately incomplete coverage, not a global asset register.
- Selected tags include power plants, substations and lines; water works, wells, towers, drinking-water points and dams; wastewater plants, pumping stations and sewage features; hospitals/clinics; communications towers and telecom exchanges/data centers. Construction/disused/abandoned/demolished prefixes are queried and retained. Lifecycle tags do not establish current operating state.
- Object type/ID, tags, source URL and edit time are retained. An edit date is not a survey date. Old object edits do not expire static reference geometry; missing, future or more-than-48-hour-old replica timestamps invalidate the query response.
- Each provider gets 12 seconds including body reading. Responses are bounded to 8 MiB and 5,000 objects. Overpass runtime remarks, malformed envelopes, invalid records, excessive size and truncation are failures, not successful empty collections.
- Per-sector provider status is retained even when an alternate succeeds. Failed streams return HTTP 503 with no assets and no successful-fetch timestamp. Only a genuine schema-valid empty query reports successful empty data.
- Infrastructure diagnostics also age at the 15-minute collection boundary, without mutating or renewing the stored success timestamp. An expired cached collection is unavailable, not a healthy current feed.
- Single-flight requests, a bounded 24-entry cache, five-second query cooldown and 30-second provider/negative-cache cooldown limit public endpoint load. Longer provider Retry-After values are honored. Successful results expire after 15 minutes without renewing their original timestamps. The client drops expired data and recollects; no stale assets are silently restored from browser snapshots.
- Public Overpass services can refuse or throttle access. They are suitable only for limited exploratory queries, not guaranteed production availability. Larger deployments need separately provisioned data access or extracts under the applicable provider policy.

## Local Open-Data Imports

The catalog has a native GeoJSON upload for eligible public/reference datasets. Files are parsed inside the app, not uploaded to a server or sent to a geocoder. Imports are session-only and displayed separately from upstream query health. Enabling a sector displays matching imported features even when Overpass is unavailable.

Select the actual source and sector, provide the actual resource's license or permission reference, and import a WGS84 FeatureCollection with Point, LineString or Polygon geometry. No coordinate conversion, guessed geocoding or geometry repair is performed. Invalid geometry, custom CRS, conflicting source IDs and oversized inputs reject the whole file. Source feature IDs, attributes, provider, license, catalog vintage, import time and limitations are retained; unspecified edit dates remain unknown. Import time is not an observation date. Accuracy is explicitly unverified. Duplicate source IDs update session records on reimport, not cross-provider deduplication or independent corroboration.

Limits: 10 MiB and 10,000 features per file, 25,000 imported features per session. Remove a source's imports using its trash icon. Closing/reloading the app clears imports. Bulk PBF, GeoParquet, Shapefile, CSV and XLSX downloads must be converted to the supported GeoJSON format first; cataloging a product does not mean those formats are natively supported.

The importer does not accept the catalog's permission/commercial sources, OpenCelliD estimated cell locations, modeled Gridfinder network, municipality-centroid EMODnet desalination points, unavailable WHO directory, visual-only maps or retired HIFLD portal. Eligible products with dataset-specific terms still require the user's actual resource permission reference. No credentials or licenses are inferred from a portal's availability.

## Provider Checks

On 2026-10-15, a small Stara Zagora-area query received HTTP 406 from FOSSGIS and HTTP 429 from Private.coffee in the development network. The adapter returned empty assets, explicit provider failures and no successful fetch time as intended. A third mirror was investigated but timed out and was not added. Live geometry rendering from these endpoints could not be certified in that network.

The local import path was exercised in the actual production UI with three real WRI CSV records converted from their supplied coordinates, including Kajaki Hydroelectric Power Plant (`GEODB0040538`). Desktop/mobile catalog layouts, restricted-source filtering, activation of the Power layer, map navigation, rendering and provenance popup were checked. These were explicitly historical reference imports, not live operational observations. No generated asset fixtures were installed in the app.

Provider documentation confirmed:

- [Geofabrik extracts](https://download.geofabrik.de/) are OSM-derived and normally daily, under ODbL 1.0.
- [Overpass documentation](https://wiki.openstreetmap.org/wiki/Overpass_API) lists both query endpoints and warns about public-server load and usage policies.
- [WRI GPPD](https://github.com/wri/global-power-plant-database) is unmaintained, last version 1.3.0, and must remain historical reference.
- [WHO GHFD](https://www.who.int/data/GIS/GHFD) says its global directory is not yet available.
- [PeeringDB AUP](https://www.peeringdb.com/aup) and [TeleGeography licensing](https://www2.telegeography.com/license-geocoded-map-data) require use-specific permission/licensing review. They are not silently enabled.

Other catalog claims remain supplied reference metadata, not claims that their resource endpoints were tested or that every listed dataset is connected. Alternatives have their own coverage, permissions and entity types and are not silently substituted as equivalent observations.
