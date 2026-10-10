// End-to-end tests: run with `npm run test:e2e`.
// Playwright starts the local static server (scripts/serve.mjs) automatically.
import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const isCI = Boolean(process.env.CI);

// Chromium on Linux replaces download names it cannot encode in the system locale with
// "download". Under a POSIX/C locale this hits every name with umlauts, so make sure the
// browser runs with a UTF-8 locale (no effect on macOS/Windows).
const localeVars = [process.env.LC_ALL, process.env.LC_CTYPE, process.env.LANG].filter(Boolean);
const hasUtf8Locale = localeVars.length > 0 && /utf-?8/i.test(localeVars[0]);
const browserEnv = hasUtf8Locale ? undefined : { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' };

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
