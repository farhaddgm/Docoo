import { defineConfig, devices } from '@playwright/test';

const port = 3400;
const baseURL = `http://127.0.0.1:${port}`;
const executablePath = process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE'];

/** UI contract checks only. Real cookies, guards and PostgreSQL have a separate local gate. */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'evaluation-lab.spec.ts',
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env['CI']),
  reporter: 'list',
  outputDir: process.env['PLAYWRIGHT_OUTPUT_DIR'] ?? 'test-results/evaluation-lab',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    reducedMotion: 'reduce',
    ...devices['Desktop Chrome'],
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  webServer: {
    command: `node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { NEXT_TELEMETRY_DISABLED: '1' },
  },
});
