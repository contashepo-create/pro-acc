/**
 * E2E: Role-Based Access Control at the UI level.
 *
 * Verifies that the UI correctly hides/shows elements based on user
 * permissions. This complements the API-level RBAC tests in the unit suite.
 *
 * Note: This test requires a lower-privilege test user to be set up.
 * If E2E_VIEWER_EMAIL/E2E_VIEWER_PASSWORD are not set, the test
 * will verify admin-level UI elements instead.
 */

import { test, expect } from '@playwright/test';
import { login } from './helpers';

const VIEWER_EMAIL = process.env.E2E_VIEWER_EMAIL;
const VIEWER_PASSWORD = process.env.E2E_VIEWER_PASSWORD;

test.describe('RBAC UI Controls', () => {
  test('admin user can see management actions', async ({ page }) => {
    await login(page);

    // Navigate to settings — should be accessible to admin
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // Admin should see company settings
    const hasSettings = await page.locator('text=/إعدادات|الشركة|عام/').isVisible({ timeout: 5_000 }).catch(() => false);
    expect(hasSettings).toBe(true);
  });

  test('dashboard shows appropriate navigation for logged-in user', async ({ page }) => {
    await login(page);

    // Key navigation elements should be visible
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Sidebar or navigation should contain accounting modules
    const nav = await page.textContent('nav, aside, [role="navigation"]');
    const hasInvoices = nav?.includes('فواتير') || nav?.includes('الفواتير');
    const hasAccounts = nav?.includes('حسابات') || nav?.includes('الحسابات') || nav?.includes('دليل');
    const hasJournals = nav?.includes('قيود') || nav?.includes('القيود');

    // At least some accounting modules should be visible
    expect(hasInvoices || hasAccounts || hasJournals).toBe(true);
  });

  // This test is conditional — only runs if viewer credentials are configured
  test.skip(!VIEWER_EMAIL, 'viewer user cannot see delete/admin actions');
  test('viewer user cannot see delete/admin actions', async ({ page }) => {
    if (!VIEWER_EMAIL || !VIEWER_PASSWORD) return;

    await login(page, VIEWER_EMAIL, VIEWER_PASSWORD);
    await page.goto('/invoices');
    await page.waitForLoadState('networkidle');

    // Viewer should NOT see destructive actions
    const hasDelete = await page.locator('button').filter({ hasText: /حذف|delete/i }).isVisible().catch(() => false);
    const hasSettings = await page.locator('a[href="/settings"], button').filter({ hasText: /إعدادات/ }).isVisible().catch(() => false);

    expect(hasDelete).toBe(false);
    expect(hasSettings).toBe(false);
  });
});
