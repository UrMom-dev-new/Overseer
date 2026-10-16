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
  artifacts in `release/`; `desktop:dist:mac:intel` creates Intel artifacts on
  an Intel host. Native CI validates each architecture separately.
- Windows: `pnpm run desktop:dist:win` creates unsigned Windows artifacts in
  `release/` on a Windows runner.
- The `Desktop Packages` workflow builds and tests the Windows installer,
  uninstall/reinstall preservation, portable launcher, renderer hydration, map/actionable
  map-error state, layer controls, source details, live-source verification
  against the packaged app's local server, and uninstall. The installed app gets
  the full renderer/source-detail/local-server check; the portable EXE gets a
  bounded no-install wrapper launch and cleanup smoke because its wrapper does
  not expose the same diagnostics channel in CI. Successful jobs upload an
  `Overseer-Windows-x64-<commit>` artifact with distinct setup/portable EXEs,
  SHA-256 checksums, build identity, and the live-source report. These expire
  after 30 days and require GitHub sign-in to download; they are not published
  GitHub Releases.
- Checksums: the manual `Release Preflight` workflow writes SHA-256 checksums
  for generated artifacts. It builds unsigned ARM and Intel macOS DMG/ZIP files
  on native runners, compares the archived apps including executable permissions,
  launches the actual ZIP app for renderer and required live-source verification,
  and checks that runtime did not modify the bundle. Only validated archives,
  commit/version/architecture identity, checksums, and reports are uploaded.

Signing and notarization are intentionally not faked. A signed release workflow
must fail when the relevant certificates, credentials, or protected approvals
are unavailable.

## Signed macOS Builds

Follow [macOS signing setup](macos-signing.md) to enroll with Apple, export a
Developer ID Application certificate, and configure the `macos-release`
environment secrets. The manual **Signed macOS Release** workflow signs,
notarizes, staples, and validates native ARM/Intel DMG/ZIP files, including
Gatekeeper, renderer smoke, and the packaged required live-source gate. It
uploads verified artifacts but does not publish them. Promote only the exact
files from a run where both architecture jobs pass; retain their verification
reports and SHA-256 checksums. Existing unsigned betas are not changed by adding
this workflow.

## Combined Unsigned Desktop Beta

For a coordinated Windows, Apple Silicon, and Intel beta, wait for successful
`Desktop Packages` and `Release Preflight` runs on the same current `main`
commit. Run the manual **Publish Desktop Beta** workflow on `main`, supplying
those two run IDs. This is an explicit publication action, not a build trigger.
It rejects PR runs, failed runs, wrong commits, incomplete native validation,
failed required live-source gates, and checksum mismatches. It promotes only the
exact tested files, first uploading a draft, checking GitHub's asset digests,
and then publishing the prerelease with all six binaries and verification reports.
All files are labeled unsigned; macOS is not notarized. Failed uploads or
verification leave a draft instead of exposing a partial public beta.

## Windows Beta Promotion

Promote only the exact workflow artifact that passed validation. Do not rebuild
new EXEs after testing.

1. Download the successful `Overseer-Windows-x64-<commit>` workflow artifact.
2. Extract it into `release/`.
3. Confirm `Overseer-Setup-<version>-x64.exe`,
   `Overseer-Portable-<version>-x64.exe`, `SHA256SUMS.txt`,
   `build-info.json`, and `live-source-verification.json` are present.
4. Generate draft prerelease notes and verified checksums:

   ```bash
   pnpm run prepare:windows-beta-release -- --artifact-dir=release --commit=<commit> --workflow-run-url=<workflow-run-url>
   ```

5. After publication approval, create a maintainer-only GitHub draft prerelease:

   ```bash
   pnpm run prepare:windows-beta-release -- --artifact-dir=release --commit=<commit> --workflow-run-url=<workflow-run-url> --create-draft
   ```

The draft prerelease should mark the setup EXE as the recommended download, the
portable EXE as optional, include SHA-256 checksums and build identity, and
state that the beta is unsigned unless signing evidence is attached. Draft links
are maintainer-only; do not present them as public downloads until the prerelease
is published with explicit approval.

## Rollback

Rollback is source-controlled:

1. Identify the last verified commit and matching artifact checksum report.
2. Re-run deterministic gates and, where relevant, live-provider verification
   against that commit.
3. Redeploy the known-good container or desktop artifact from the protected
   release record.
4. Preserve the failed verification report and release logs so provider outage,
   platform packaging, and application regression can be distinguished.
