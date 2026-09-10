import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3400' },
  webServer: [
    {
      command: 'node e2e/fixture-server.mjs',
      url: 'http://127.0.0.1:3411/health',
      reuseExistingServer: false,
    },
    {
      command: 'node node_modules/next/dist/bin/next dev -p 3400',
      url: 'http://127.0.0.1:3400',
      reuseExistingServer: false,
      timeout: 120000,
      env: { API_BASE_URL: 'http://127.0.0.1:3411' },
    },
  ],
});
