const team = process.env.APPLE_TEAM_ID;
if (!/^[A-Z0-9]{10}$/.test(team || '')) {
  throw new Error('A valid APPLE_TEAM_ID is required for signed macOS builds.');
}

module.exports = {
  extends: './electron-builder.yml',
  forceCodeSigning: true,
  mac: {
    // v26 expects a qualifier, not the "Developer ID Application:" prefix.
    identity: team,
    hardenedRuntime: true,
    entitlements: 'electron/entitlements.mac.plist',
    entitlementsInherit: 'electron/entitlements.mac.plist',
    notarize: true,
  },
  dmg: { sign: true },
};
