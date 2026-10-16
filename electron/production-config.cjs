const fs = require('node:fs');
const path = require('node:path');

function desktopNextConfig(appDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(appDir, '.next', 'required-server-files.json'), 'utf8'));
  if (!manifest.config || manifest.config.distDir !== '.next') {
    throw new Error('Packaged Next.js configuration is missing or uses an unsupported build directory.');
  }
  return {
    ...manifest.config,
    // Fetch, ISR, and image caches must never mutate the signed app bundle.
    experimental: { ...manifest.config.experimental, isrFlushToDisk: false },
  };
}

module.exports = { desktopNextConfig };
