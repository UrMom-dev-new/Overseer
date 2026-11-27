import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './playback-tests', testMatch: '**/*.spec.ts',
  timeout: 45_000, expect: { timeout: 20_000 }, workers: 1, retries: 0,
  use: { browserName: 'chromium', baseURL: 'http://127.0.0.1:4178', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --config playback-tests/vite.config.mts',
    url: 'http://127.0.0.1:4178', reuseExistingServer: false, timeout: 30_000,
  },
});
