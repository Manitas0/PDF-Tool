// End-to-end tests of the Electron app: run with `npm test` in desktop/ (on Linux without a
// display: `xvfb-run -a npm test`). @playwright/test, pdf-lib and jszip come from the repository
// root's node_modules (`npm ci --omit=optional` there first).
import { defineConfig } from '@playwright/test';

const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: 'tests',
  outputDir: 'test-results',
  // Every test starts its own app instance; PDF-Tool is a single-instance app, so run them one after another.
  workers: 1,
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: isCI
    ? [['github'], ['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    trace: 'retain-on-failure',
  },
});
