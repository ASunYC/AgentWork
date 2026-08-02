import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './e2e', use: { baseURL: 'http://127.0.0.1:3000' }, webServer: { command: 'next dev -p 3000', url: 'http://127.0.0.1:3000', reuseExistingServer: true, timeout: 120000 } });
