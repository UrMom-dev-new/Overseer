# Ransomware and extortion claims

Open **SDK → Ransomware Feed** on desktop or **Layers → SDK → Ransomware Feed** on mobile. The control opens a searchable report dialog. Escape or Close dismisses it. Both layouts use the same handler. No API key is required.

The server route works in web, Docker and desktop builds. An installed desktop binary must be rebuilt or updated to include this change; a repository push does not update installed applications.

## Source and attribution

- Provider: RansomLook, https://www.ransomlook.io/.
- Endpoint: https://www.ransomlook.io/api/recent/100.
- Documentation and data terms: https://www.ransomlook.io/about and https://www.ransomlook.io/api/.
- Data license: CC BY 4.0, https://creativecommons.org/licenses/by/4.0/.
- Changes: normalization, deterministic deduplication and plain-text shortening. Provider credit, license and transformation notice appear in the response and UI. No provider implementation code is copied.

Posts are operator claims and announcements, not independently verified incidents or unique victims. Ransomware.live is not silently used as a fallback.

## Contract and coverage

`GET /api/ransomware` returns `ransomware_reports`, provider `status`, successful-snapshot `collectedAt` (or null), `nextRefreshAt`, explicitly non-exhaustive `coverage`, and `attribution`.

Records include title, group, optional plain-text description, discovery time, unassessed verification and integrity provenance. Missing or invalid discovery times remain null. Timezone-less source timestamps are interpreted as UTC with a visible quality flag. Future dates are flagged, not silently corrected. Discovery time is not publication or attack time. Unsupported dates, geography, country and sector remain null.

The maximum is the latest 100 provider posts. Search, group and date filters only narrow that loaded sample; a seven-day filter does not retrieve all posts in a seven-day archive. Unknown and future discovery dates remain visible in All loaded posts but are excluded from date filters.

This is a list-first capability. It does not enable the SDK's generic CYBER map layer or manufacture map coordinates. The menu counts this feed's accepted reports, not `sdk_entities`.

## Resilience and security

The collector uses a fixed HTTPS URL, no redirects, a ten-second deadline including body consumption, a one-MiB response bound, JSON media-type validation and schema validation. HTTP 200 HTML/challenge pages are errors. Valid empty responses differ from failed or all-rejected responses; mixed valid/invalid rows report partial collection.

Provider access is limited by a thirty-minute per-process cache and a single in-flight request. Manual refresh respects the collection gate. Failures back off from one minute to thirty minutes; a usable longer Retry-After takes precedence. Polling stops when the panel closes.

A failed refresh may serve the last successful snapshot for at most 24 hours, explicitly stale and retaining original timestamps. Expiry is checked even during long cooldowns. Cache is not persisted across restarts. Multiple server processes have independent rate budgets; deploy a shared collector before scaling publicly across multiple instances.

Old source discoveries trigger a currency warning; undated-only records have unknown freshness. Successful transport does not prove current upstream monitoring. Diagnostic counts describe the served snapshot; failure code and last-attempt time describe the failed collection attempt.

Only selected metadata is retained. Original leak-site URLs, website links, screenshots, raw HTML and evidence fields are discarded. The application never follows those links or downloads stolen material. React renders text, not provider HTML. External actions use fixed provider-attribution and license links.

## Integration and tests

The source manifest and verifier register `ransomware` as report evidence, never live observation. Existing registries and evaluator remain unchanged in `source-manifest-base.ts` and `source-contracts-base.ts`; public entrypoints aggregate the new definitions from `ransomware-source.ts` without mutating baseline registries.

Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`. The new fixture-only tests cover normalization, timestamps, bounds, IDs, null geography, filtering, response validation, provider errors, timeout, single-flight cache, Retry-After, recovery, expiry and shared diagnostics registration.

For live verification, start the app, request `/api/ransomware`, and open the feed and Source Diagnostics. Confirm records render, counts agree, discovery and collection timestamps are distinct, and attribution is visible. Interrupt provider connectivity to inspect stale/unavailable behavior. Check Escape, keyboard focus and narrow-screen layout in the packaged application before release.

A live provider fetch, full application build and packaged browser interaction must be checked separately from dependency-free tests. Do not mark those checks passed without observed results.
