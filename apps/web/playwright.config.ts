import { defineConfig, devices } from '@playwright/test';

const webUrl = process.env['E2E_WEB_URL'] ?? 'http://localhost:3000';
const apiUrl = process.env['E2E_API_URL'] ?? 'http://127.0.0.1:4000';
const chromiumPath = process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE'];
// The agent worker has no HTTP port; its Prometheus endpoint tells Playwright it is up.
const workerMetricsPort = 9464;
const ingestionMetricsPort = 9465;
// The stand-in for Contenter's service API (the business module, ADR-0021).
const contenterPort = Number(process.env['E2E_CONTENTER_PORT'] ?? 4010);

/**
 * End-to-end tests of the main path (UX-001, AUTH-001) and of the project workflow in the
 * backoffice (WF-003). Expects built API, web and agent worker, a migrated database and a
 * Temporal server (TEMPORAL_ADDRESS, default localhost:7233), plus the ingestion worker's
 * object store and scanner (S3_*, CLAMD_HOST); `e2e/prepare.mjs` seeds the administrator.
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
    // The stylesheet honours this and drops its transitions; axe reads colours mid-fade otherwise.
    reducedMotion: 'reduce',
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
      command: 'node e2e/fake-contenter.mjs',
      url: `http://127.0.0.1:${contenterPort}/__control/ready`,
      env: { E2E_CONTENTER_PORT: String(contenterPort) },
      reuseExistingServer: !process.env['CI'],
      timeout: 30_000,
    },
    {
      command: 'node --import ../api/dist/instrumentation.js ../api/dist/main.js',
      url: `${apiUrl}/v1/health/live`,
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
    },
    {
      command: 'node ../worker-agent/dist/main.js',
      port: workerMetricsPort,
      env: { TEMPORAL_METRICS_ADDRESS: `127.0.0.1:${workerMetricsPort}` },
      reuseExistingServer: !process.env['CI'],
      timeout: 90_000,
    },
    {
      // Scans and reads the sources the knowledge screens add (needs CLAMD_HOST and S3_*).
      command: 'node ../worker-ingestion/dist/main.js',
      port: ingestionMetricsPort,
      env: { TEMPORAL_METRICS_ADDRESS: `127.0.0.1:${ingestionMetricsPort}` },
      reuseExistingServer: !process.env['CI'],
      timeout: 90_000,
    },
    {
      command: 'node node_modules/next/dist/bin/next start -p 3000',
      url: webUrl,
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
    },
  ],
});
