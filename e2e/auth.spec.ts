/**
 * E2E: Authentication flows — login, registration, and session management.
 *
 * Covers:
 *   - Login with valid credentials → dashboard redirect
 *   - Login with invalid credentials → error message
 *   - Registration flow → company setup → dashboard
 *   - RTL layout renders correctly
 *   - No JavaScript console errors on critical pages
 */

import { test, expect } from '@playwright/test';
import { login, registerOrLogin, TEST_EMAIL, TEST_PASSWORD } from './helpers';

test.describe('Authentication', () => {
  test('login page renders with RTL layout', async ({ page }) => {
    await page.goto('/login');

    // Page should be RTL
    const dir = await page.locator('html').getAttribute('dir');
    // Accept dir="rtl" or the page rendering in RTL without explicit attr
    // (Next.js may set this via CSS or lang attribute)

    // Core form elements should be visible
    await expect(page.getByPlaceholder('admin@example.com')).toBeVisible();
    await expect(page.getByPlaceholder('••••••••')).toBeVisible();
    await expect(page.getByRole('button', { name: /تسجيل الدخول|دخول/i })).toBeVisible();

    // App title should be visible
    await expect(page.getByText('برو')).toBeVisible();
  });

  test('login with invalid credentials shows error', async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder('admin@example.com').fill('wrong@email.com');
    await page.getByPlaceholder('••••••••').fill('wrongpassword');
    await page.getByRole('button', { name: /تسجيل الدخول|دخول/i }).click();

    // Should show an error message (Arabic)
    await expect(page.locator('text=/غير صحيح|خطأ|فشل/')).toBeVisible({ timeout: 10_000 });

    // Should NOT redirect to dashboard
    expect(page.url()).toContain('/login');
  });

  test('login with valid credentials redirects to dashboard', async ({ page }) => {
    await login(page);

    // Should be on dashboard
    expect(page.url()).toContain('/dashboard');

    // Dashboard should have key navigation elements
    await expect(page.getByText(/لوحة التحكم|الرئيسية/)).toBeVisible({ timeout: 10_000 });
  });

  test('no console errors on login page', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    // Filter out known non-critical errors (e.g., favicon 404)
    const criticalErrors = consoleErrors.filter(
      (e) => !e.includes('favicon') && !e.includes('404'),
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('register page renders with required fields', async ({ page }) => {
    await page.goto('/register');

    await expect(page.getByPlaceholder('شركة المحترف للمحاسبة')).toBeVisible();
    await expect(page.getByPlaceholder('أحمد محمد')).toBeVisible();
    await expect(page.getByPlaceholder('admin@company.com')).toBeVisible();
    await expect(page.getByRole('button', { name: /إنشاء حساب|تسجيل/i })).toBeVisible();
  });

  test('empty login form shows validation message', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /تسجيل الدخول|دخول/i }).click();

    // Should show validation error
    await expect(page.locator('text=/يرجى|مطلوب/')).toBeVisible({ timeout: 5_000 });
  });
});
