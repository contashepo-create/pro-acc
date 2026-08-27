/**
 * E2E: Smoke test — no console errors on critical pages.
 *
 * Visits each critical page and asserts no JavaScript errors are logged.
 * This catches broken imports, missing env vars, and render crashes that
 * unit tests can't detect.
 */

import { test, expect } from '@playwright/test';
import { login } from './helpers';

const CRITICAL_PAGES = [
  { path: '/dashboard', name: 'Dashboard' },
  { path: '/invoices', name: 'Invoices' },
  { path: '/accounts', name: 'Chart of Accounts' },
  { path: '/journals', name: 'Journal Entries' },
  { path: '/clients', name: 'Clients' },
  { path: '/vouchers', name: 'Vouchers' },
  { path: '/reports', name: 'Reports' },
  { path: '/settings', name: 'Settings' },
  { path: '/banks', name: 'Banks & Safes' },
  { path: '/cash', name: 'Cash Transactions' },
];

test.describe('Console Error Smoke Test', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  for (const { path, name } of CRITICAL_PAGES) {
    test(`${name} (${path}) has no console errors`, async ({ page }) => {
      const consoleErrors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });

      await page.goto(path);
      await page.waitForLoadState('networkidle');

      // Filter known non-critical messages
      const critical = consoleErrors.filter(
        (e) =>
          !e.includes('favicon') &&
          !e.includes('404') &&
          !e.includes('Failed to load resource') && // network-level, not app-level
          !e.includes('ResizeObserver'), // browser-internal, harmless
      );

      expect(critical).toHaveLength(0);
    });
  }
});
