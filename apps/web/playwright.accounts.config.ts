import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  testMatch: 'accounts-auth.spec.ts',
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3350',
    ...devices['Desktop Chrome'],
    reducedMotion: 'reduce',
    ...(process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE']
      ? { launchOptions: { executablePath: process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE'] } }
      : {}),
  },
  webServer: {
    command: 'node node_modules/next/dist/bin/next start -p 3350 -H 127.0.0.1',
    url: 'http://127.0.0.1:3350/fa',
    reuseExistingServer: false,
    timeout: 60000,
  },
});
