import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E configuration for pro-acc.
 *
 * Prerequisites before first run:
 *   npx playwright install --with-deps chromium
 *
 * Usage:
 *   npm run test:e2e                          # headless against local dev
 *   npm run test:e2e -- --headed              # watch in browser
 *   npx playwright test --project=chromium    # specific browser
 *
 * Environment variables (set in .env.local or CI):
 *   E2E_BASE_URL   — override base URL (default: http://localhost:3000)
 *   E2E_EMAIL      — test user email
 *   E2E_PASSWORD   — test user password
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,        // accounting tests must not interleave
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,                  // sequential — shared test company
  reporter: process.env.CI
    ? [['html', { open: 'never' }], ['github']]
    : [['list']],
  timeout: 60_000,             // some operations (setup_initial_company) can be slow

  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    locale: 'ar-SA',
    timezoneId: 'Asia/Riyadh',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Start the dev server automatically when running locally */
  webServer: process.env.CI
    ? undefined  // CI should build + start separately
    : {
        command: 'npm run dev',
        port: 3000,
        timeout: 120_000,
        reuseExistingServer: true,
      },
});
