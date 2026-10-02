import { defineConfig, devices } from '@playwright/test';

const webUrl = process.env['E2E_WEB_URL'] ?? 'http://localhost:3000';
const apiUrl = process.env['E2E_API_URL'] ?? 'http://127.0.0.1:4000';
const chromiumPath = process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE'];

/**
 * End-to-end tests of the main path (UX-001, AUTH-001). Expects built API and web apps
 * and a migrated database; `e2e/prepare.mjs` seeds the administrator.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env['CI']),
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: webUrl,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {}),
      },
    },
  ],
  webServer: [
    {
      command: 'node --import ../api/dist/instrumentation.js ../api/dist/main.js',
      url: `${apiUrl}/v1/health/live`,
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
    },
    {
      command: 'node node_modules/next/dist/bin/next start -p 3000',
      url: webUrl,
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
    },
  ],
});
