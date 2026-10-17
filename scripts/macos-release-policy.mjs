export const credentialNames = [
  'CSC_LINK', 'CSC_KEY_PASSWORD', 'MACOS_NOTARY_KEY_P8',
  'APPLE_API_KEY_ID', 'APPLE_API_ISSUER', 'APPLE_TEAM_ID',
];

export function validateReleaseEnvironment(env, platform, hostArch, arch) {
  const missing = credentialNames.filter((name) => !env[name]?.trim());
  if (missing.length) throw new Error(`Missing macOS release credentials: ${missing.join(', ')}`);
  if (platform !== 'darwin') throw new Error('Signed macOS releases require macOS.');
  if (!['arm64', 'x64'].includes(arch) || arch !== hostArch) {
    throw new Error('Build and validate on a native arm64 or x64 runner matching --arch.');
  }
  if (!/^[A-Z0-9]{10}$/.test(env.APPLE_TEAM_ID)) throw new Error('Invalid APPLE_TEAM_ID.');
  if (!/^[A-Z0-9]{10}$/.test(env.APPLE_API_KEY_ID)) throw new Error('Invalid APPLE_API_KEY_ID.');
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(env.APPLE_API_ISSUER)) {
    throw new Error('Invalid APPLE_API_ISSUER; use a team API key with an issuer ID.');
  }
  if (!env.MACOS_NOTARY_KEY_P8.includes('-----BEGIN PRIVATE KEY-----')) {
    throw new Error('MACOS_NOTARY_KEY_P8 must contain the downloaded .p8 file.');
  }
  if (!/^[A-Za-z0-9+/=\s]+$/.test(env.CSC_LINK)) {
    throw new Error('CSC_LINK must be the base64-encoded Developer ID .p12, not a URL.');
  }
}

export function validateSignature(details, team, { app = true } = {}) {
  if (!new RegExp(`^Authority=Developer ID Application: .+ \\(${team}\\)$`, 'm').test(details)
    || !details.includes(`\nTeamIdentifier=${team}\n`)
    || !/^Timestamp=.+$/m.test(details)) {
    throw new Error('Expected a timestamped Developer ID Application signature from the configured team.');
  }
  if (app && (!/^Identifier=dev\.urmom\.overseer$/m.test(details) || !/flags=.*\bruntime\b/.test(details))) {
    throw new Error('Expected the Overseer app identity with hardened runtime.');
  }
  const cdhash = details.match(/^CDHash=([a-f0-9]+)$/m)?.[1];
  if (!cdhash) throw new Error('Signature is missing its CodeDirectory hash.');
  return cdhash;
}

export function validateArchitecture(output, arch) {
  const expected = arch === 'x64' ? 'x86_64' : 'arm64';
  if (output.trim() !== expected) throw new Error(`Expected native ${expected} executable; got ${output.trim()}.`);
}

export function validateNotarization(result) {
  if (result.status !== 'Accepted' || !result.id) throw new Error('Apple did not accept the notarization submission.');
  return { id: result.id, status: result.status };
}

// Every command must succeed; no warning-only fallback for signature or ticket failures.
export function verifySignedArtifact(run, path, team, arch, { app = true } = {}) {
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', path]);
  const hash = validateSignature(run('/usr/bin/codesign', ['--display', '--verbose=4', path]), team, { app });
  if (app) validateArchitecture(run('/usr/bin/lipo', ['-archs', `${path}/Contents/MacOS/Overseer`]), arch);
  run('/usr/bin/xcrun', ['stapler', 'validate', path]);
  const assessment = run('/usr/sbin/spctl', app
    ? ['--assess', '--type', 'execute', '--verbose=4', path]
    : ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=4', path]);
  if (!/:\s*accepted\s*$/m.test(assessment) || !/^source=Notarized Developer ID\s*$/m.test(assessment)) {
    throw new Error('Gatekeeper did not explicitly accept a Notarized Developer ID artifact.');
  }
  return hash;
}
