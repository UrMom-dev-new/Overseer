# macOS Signing And Notarization Setup

The signed release path supports separate Apple Silicon (`arm64`) and Intel
(`x64`) DMG/ZIP downloads. Adding this workflow does not sign existing downloads.
Until a successful signed run is promoted, published unsigned betas remain unsigned.

## 1. Enroll With Apple

Enroll in the [Apple Developer Program](https://developer.apple.com/programs/enroll/)
as an individual or organization. Apple lists membership at USD 99 per year,
or local pricing where available. A free Apple account is not enough for
Developer ID distribution. Complete enrollment and accept Apple's current
agreements. Find your ten-character Team ID under your developer account's
membership details.

## 2. Create A Developer ID Application Certificate

Follow Apple's [Developer ID certificate instructions](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/)
using the Account Holder account:

1. On your Mac, open Keychain Access. Choose Certificate Assistant > Request a
   Certificate From a Certificate Authority. Save the certificate signing request
   to disk, keeping its private key in your keychain.
2. In the Apple Developer account, open Certificates, Identifiers & Profiles >
   Certificates > Add > Developer ID > **Developer ID Application**. Upload the
   request. Do not choose Apple Development, Apple Distribution, or Developer ID
   Installer; this project distributes an app in DMG/ZIP, not a signed PKG.
3. Download the `.cer` and open it to install it in the same Mac's keychain.
4. In Keychain Access > My Certificates, expand the Developer ID Application
   certificate and confirm its private key is present. Select the certificate
   and private key, export them together as `.p12`, and set a strong export password.
   A `.cer` alone cannot sign an application.

Keep the original certificate/private key and export password in secure storage.
Do not commit them, attach them to an issue, or paste them into chat.

## 3. Create The Notarization API Key

Use a **team** App Store Connect API key, not an individual key, for compatibility
with the pinned notarization tooling. In [App Store Connect](https://appstoreconnect.apple.com/),
the Account Holder first requests API access if necessary. Under Users and Access >
Integrations > App Store Connect API > Team Keys, create a dedicated key with the
Developer role. Record the Key ID and Issuer ID and download the `.p8` private
key. Apple only allows downloading it once. See Apple's
[API access guide](https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api/)
and [key creation guide](https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api).

This key is separate from the certificate's private key. Store both securely;
revoke and replace a credential immediately if it is exposed.

## 4. Configure The GitHub Environment

In `UrMom-dev-new/Overseer`, open Settings > Environments and create
`macos-release`. Restrict deployment branches to `main` and add required
maintainer review where your GitHub plan supports it. Review the workflow and
all code it executes before approving a signing job; it handles private keys.

Add these **environment secrets**:

| Secret | Value |
| --- | --- |
| `MACOS_CERTIFICATE_P12` | Base64 encoding of the exported `.p12`, not the `.cer` |
| `MACOS_CERTIFICATE_PASSWORD` | The `.p12` export password |
| `MACOS_NOTARY_KEY_P8` | Entire `.p8` file, including BEGIN/END lines; not base64 |
| `APPLE_API_KEY_ID` | Ten-character API Key ID |
| `APPLE_API_ISSUER` | Team API key's Issuer ID (UUID) |
| `APPLE_TEAM_ID` | Ten-character developer Team ID |

To put the certificate's base64 value on the macOS clipboard without printing it:

```bash
base64 -i /absolute/path/DeveloperID.p12 | pbcopy
```

Paste into the GitHub secret form, then clear your clipboard. The signing
workflow maps the certificate and password to electron-builder's `CSC_LINK`
and `CSC_KEY_PASSWORD`. No credentials belong in `.env`, the repository, build
artifacts, or release notes.

## 5. Build, Validate, Then Promote

After these repository changes are merged, open Actions > **Signed macOS Release** >
Run workflow on `main`, then approve the protected environment jobs.
It uses native `macos-15` ARM and `macos-15-intel` Intel runners. Missing inputs
fail before packaging; invalid credentials or Apple rejection fail the build.

Each job signs with Developer ID Application, enables hardened runtime with only
the Electron JIT exception, notarizes/staples the app, signs/notarizes/staples the
DMG, and verifies code signatures, team, timestamp, architecture, tickets, and
Gatekeeper acceptance. It extracts the actual ZIP and mounts the actual DMG
read-only, checking that their app signatures match. It then launches the ZIP's
app for renderer smoke and the required live-source gate. Keys are temporary;
runtime checks do not inherit signing credentials.

The desktop runtime uses Next's serialized standalone configuration with disk
cache flushing disabled. App-owned source snapshots remain in the user's data
directory; framework build/development caches are excluded from packages. This
keeps the signed bundle immutable after launch.

Only successful jobs upload `Overseer-macOS-<arch>-signed-<commit>`, including
DMG/ZIP, SHA-256 checksums, live-source report, and post-verification signing
evidence. Embedded build metadata leaves signing/notarization unknown because
it is generated before signing; the external verification report records the
actual results. Both architecture jobs must pass for a dual-architecture release.

This workflow deliberately does **not** publish or replace a public release.
With publication approval, promote the exact tested DMG/ZIP files and reports
from the same successful workflow run, without rebuilding them. Match commit,
architecture, version, and checksums. Label downloads `arm64` for Apple Silicon
and `x64` for Intel; do not describe these as a universal binary. Do not relabel
old unsigned assets as signed. Keep Windows signing status separate.

## Local Signed Build

With the same secret values loaded securely in your shell, map
`MACOS_CERTIFICATE_P12` to `CSC_LINK` and `MACOS_CERTIFICATE_PASSWORD` to
`CSC_KEY_PASSWORD`. Keep the other four variable names as above. On a native
Mac matching the target architecture:

```bash
pnpm run desktop:dist:mac:signed -- --arch=arm64
# On an Intel Mac instead:
pnpm run desktop:dist:mac:signed -- --arch=x64
```

The signed command requires outbound access to Apple and real data providers.
Do not bypass a failed signature, notarization, Gatekeeper, renderer, or required
source gate. Provider downtime can block promotion even when signing succeeds.
