# Feed Integrity Notes

Overseer feed records now carry explicit integrity metadata alongside the display fields. The metadata identifies the provider, collection URL, item URL when available, data mode, evidence kind, verification state, original timing, and location relationship.

## Record Semantics

- `observation` means the provider reported a direct observation, such as an aircraft position or FIRMS thermal detection.
- `report` means a source report or aggregated mention, such as RSS, Telegram, or GDELT GEO output.
- `assessment` means a derived indicator with a disclosed methodology.
- `reference` means static contextual information, such as chokepoint reference records.

Unknown values stay `null`. The feed layer must not replace missing severity, measurements, timestamps, coordinates, or confidence with reassuring defaults such as `LOW`, `NORMAL`, `0`, or the current time.

## Empty, Failed, And Stale States

A schema-valid response with zero accepted records is a successful empty result. It replaces the prior snapshot for that source/query/window.

A timeout, rate limit, HTTP error, invalid JSON, or invalid schema is a failed collection attempt. Failed attempts do not overwrite the last successful snapshot and do not advance source observation or publication times. When an eligible last-known-good snapshot is served, the status sets `servingLastKnownGood` and keeps the original `lastSuccessfulFetchAt`.

Per-source status uses separate fields for transport availability, result state, and freshness:

- `availability`: collection transport/config state.
- `dataState`: whether the validated response contained records, was empty, or was unavailable.
- `freshness`: whether the most recent successful snapshot is within this app's stale-after policy.

## Cache Behavior

The current cache is process-local and bounded. It is lost on server restart and is not shared across horizontally scaled instances. Cache keys include source/query/window identity and the real-data namespace; secrets are not included.

Last-known-good records are only eligible within each feed's maximum usable age. Expired cache entries should be presented as unavailable or historical rather than current alerts.

## Affected Feed Meanings

- GDELT GEO records are geolocated news mentions, not confirmed incidents. Mention counts are source fields, not incident counts.
- News and Telegram/RSS items are source reports. Keyword relevance is a deterministic text aid, not AI analysis, verification, or threat severity.
- Maritime vessel records are observations when live AIS data is configured. Chokepoints are static references. Congestion indicators are unvalidated derived assessments and include methodology/sample size when present.
- FIRMS records are active-fire or thermal detections. EONET volcano records do not include FIRMS brightness, FRP, or confidence, so those measurements remain `null`.
- CISA KEV records indicate known exploitation. Technical severity and user/environment relevance are unknown unless supplied by another source.
- NWS weather alerts preserve source severity, timing, and valid Polygon/MultiPolygon geometry. Geometry-free alerts remain list-visible with "Area specified; geometry unavailable."

## Residual Heuristics

The location resolver is deterministic and conservative. It recognizes a small local alias catalog, prefers supported city matches over enclosing countries, marks ambiguous text instead of choosing arbitrarily, and preserves unresolved records in text feeds.

Keyword relevance uses word-aware matching and exposes matched terms/method. It must not be mapped back into alert severity by UI, SDK, or AI consumers.

Maritime congestion remains an unvalidated indicator when enough current vessel observations exist. It is not a security-risk escalation and it does not prove port operating conditions.

## No Demo Fallbacks

No production error path enables demo records. Unavailable providers must produce an empty/degraded response, a non-2xx unavailable response, or an eligible last-known-good snapshot with original timestamps preserved.

## Running Regression Checks

The focused regression suite does not require live providers, credentials, or an LLM:

```bash
pnpm test
```

When the package manager is unavailable, the same check can be run with local binaries:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node --test .test-build/tests/*.test.js
```

Run the broader safety checks before release:

```bash
pnpm typecheck
pnpm lint
pnpm build
pnpm run smoke:prod
```

For live provider availability, run the app and then execute:

```bash
OVERSEER_BASE_URL=http://127.0.0.1:3000 pnpm run verify:live-sources
```

The live verifier treats `/api/sources` reachability as the hard failure condition. Individual provider failures remain visible in the JSON report so unavailable streams can be omitted without blocking unrelated sources.
