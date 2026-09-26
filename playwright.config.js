import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', fullyParallel: false, workers: 1, timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:4319', headless: true, screenshot: 'only-on-failure' },
  webServer: { command: 'PORT=4319 DATA_DIR=test-results/e2e-data node server/index.mjs', port: 4319, reuseExistingServer: false },
});
