# Release Process

This repository now has checked-in preflight workflows, but normal development
commands do not publish, deploy, push images, sign installers, or create GitHub
releases.

## Deterministic Gates

Before a protected release, run:

```bash
pnpm install --frozen-lockfile
pnpm run lint
pnpm run typecheck
pnpm run test:integrity
pnpm run build
pnpm run smoke:prod
```

`test:integrity` covers deterministic source-contract regressions, RSS/Atom
parsing, no-synthetic feed behavior, cache recovery, and client snapshot
isolation. `smoke:prod` launches the built app locally and verifies the app
identity and representative backend routes.

## Live Provider Gate

Run the live-provider gate against the built application:

```bash
OVERSEER_BASE_URL=http://127.0.0.1:3000 pnpm run verify:live-sources -- --output=./overseer-live-report.json
```

This validates backend route contracts for required capabilities. It reports
provider outages and configuration gaps without fabricating success. It does
not prove browser rendering; use browser/source-to-screen integration tests for
that claim.

## Artifacts

- Docker: `docker compose up -d --build` is the supported local-build path.
  This repository does not publish a versioned registry image yet.
- macOS: `pnpm run desktop:dist:mac` creates unsigned Apple Silicon developer
  artifacts in `release/`.
- Windows: `pnpm run desktop:dist:win` creates unsigned Windows artifacts in
  `release/` on a Windows runner.
- Checksums: the manual `Release Preflight` workflow writes SHA-256 checksums
  for generated artifacts.

Signing and notarization are intentionally not faked. A signed release workflow
must fail when the relevant certificates, credentials, or protected approvals
are unavailable.

## Rollback

Rollback is source-controlled:

1. Identify the last verified commit and matching artifact checksum report.
2. Re-run deterministic gates and, where relevant, live-provider verification
   against that commit.
3. Redeploy the known-good container or desktop artifact from the protected
   release record.
4. Preserve the failed verification report and release logs so provider outage,
   platform packaging, and application regression can be distinguished.
