/**
 * E2E test helpers — login, company setup, and common page interactions.
 *
 * Uses environment variables for test credentials:
 *   E2E_EMAIL     — existing test user email
 *   E2E_PASSWORD  — test user password
 *
 * If the test user doesn't exist yet, `registerAndSetup` creates one.
 */

import { type Page, expect } from '@playwright/test';

export const TEST_EMAIL = process.env.E2E_EMAIL || 'e2e-test@example.test';
export const TEST_PASSWORD = process.env.E2E_PASSWORD || 'E2eTestP@ss2026!';
export const TEST_COMPANY = 'شركة الاختبار E2E';
export const TEST_USER = 'مستخدم اختبار';

/**
 * Login with email/password via the /login page.
 * Waits for redirect to /dashboard.
 */
export async function login(page: Page, email = TEST_EMAIL, password = TEST_PASSWORD) {
  await page.goto('/login');
  await page.getByPlaceholder('admin@example.com').fill(email);
  await page.getByPlaceholder('••••••••').fill(password);
  await page.getByRole('button', { name: /تسجيل الدخول|دخول/i }).click();
  // Wait for successful redirect
  await page.waitForURL('**/dashboard**', { timeout: 15_000 });
}

/**
 * Register a new company + user (first-time-only flow).
 * Falls back to login if the user already exists.
 */
export async function registerOrLogin(page: Page) {
  await page.goto('/register');
  // Fill registration form
  await page.getByPlaceholder('شركة المحترف للمحاسبة').fill(TEST_COMPANY);
  await page.getByPlaceholder('أحمد محمد').fill(TEST_USER);
  await page.getByPlaceholder('admin@company.com').fill(TEST_EMAIL);
  await page.getByPlaceholder('••••••••').fill(TEST_PASSWORD);

  // Handle CAPTCHA — look for the challenge and try to answer
  const captchaField = page.locator('input[placeholder*="التحقق"], input[placeholder*="الناتج"], input[placeholder*="الإجابة"]');
  if (await captchaField.isVisible({ timeout: 3000 }).catch(() => false)) {
    // Simple math CAPTCHA — try to extract and solve
    const questionText = await page.locator('text=/\\d+\\s*[+\\-×÷]\\s*\\d+/').textContent().catch(() => null);
    if (questionText) {
      const match = questionText.match(/(\d+)\s*([+\-×÷])\s*(\d+)/);
      if (match) {
        const [, a, op, b] = match;
        const ops: Record<string, (a: number, b: number) => number> = {
          '+': (x, y) => x + y, '-': (x, y) => x - y,
          '×': (x, y) => x * y, '÷': (x, y) => Math.floor(x / y),
        };
        const answer = (ops[op] || ops['+'])(Number(a), Number(b));
        await captchaField.fill(String(answer));
      }
    }
  }

  await page.getByRole('button', { name: /إنشاء حساب|تسجيل/i }).click();

  // Either redirects to dashboard (new) or shows error (existing user)
  const result = await Promise.race([
    page.waitForURL('**/dashboard**', { timeout: 10_000 }).then(() => 'dashboard' as const),
    page.locator('.text-danger, .text-red, [role="alert"]').waitFor({ timeout: 10_000 }).then(() => 'error' as const),
  ]).catch(() => 'timeout' as const);

  if (result === 'error' || result === 'timeout') {
    // User already exists — login instead
    await login(page);
  }
}

/**
 * Navigate to invoices page from dashboard.
 */
export async function goToInvoices(page: Page) {
  // Use the sidebar navigation
  await page.goto('/invoices');
  await page.waitForLoadState('networkidle');
}

/**
 * Format a number as the app would display it (for assertion matching).
 */
export function formatForAssertion(n: number): string {
  return n.toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
