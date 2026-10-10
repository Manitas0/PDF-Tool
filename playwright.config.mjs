// End-to-end tests: run with `npm run test:e2e`.
// Playwright starts the local static server (scripts/serve.mjs) automatically.
import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const isCI = Boolean(process.env.CI);

// Chromium on Linux replaces download names it cannot encode in the system locale with
// "download", which hits every name with umlauts under a POSIX/C locale. A configured but
// uninstalled locale (e.g. LANG=de_DE.UTF-8 in a container without generated locales)
// silently falls back to ASCII as well, so on Linux always start the browser with the
// built-in C.UTF-8 locale (no effect on macOS/Windows).
const browserEnv = process.platform === 'linux' ? { ...process.env, LC_ALL: 'C.UTF-8' } : undefined;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: isCI
    ? [['github'], ['list'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    acceptDownloads: true,
    locale: 'de-DE',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: browserEnv ? { env: browserEnv } : {},
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'node scripts/serve.mjs',
    url: `${BASE_URL}/`,
    env: { PORT: String(PORT) },
    reuseExistingServer: !isCI,
    timeout: 30_000,
  },
});
