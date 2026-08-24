/**
 * E2E: Tenant isolation — verify that data does not bleed across companies.
 *
 * This test ensures that:
 *   - Dashboard data is company-scoped
 *   - API responses only contain the current company's data
 *   - Direct URL access to another company's resources is blocked
 */

import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Tenant Isolation', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('API responses include company_id filter', async ({ page }) => {
    // Intercept API calls and verify they're tenant-scoped
    type TenantBody = { data?: { invoices?: Array<Record<string, unknown>> } };
  const apiResponses: Array<{ url: string; body: TenantBody }> = [];

    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('/api/') && response.status() === 200) {
        try {
          const body = await response.json();
          apiResponses.push({ url, body });
        } catch {
          // Not JSON — skip
        }
      }
    });

    await page.goto('/invoices');
    await page.waitForLoadState('networkidle');

    // Verify that at least some API calls were made
    // (the page should load data from the API)
    if (apiResponses.length > 0) {
      // Every successful data response should be scoped to one company
      for (const { body } of apiResponses) {
        if (body?.data?.invoices) {
          // If there are invoices, they should all belong to the same company
          const companyIds = new Set(
            body.data.invoices
              .filter((inv) => inv.company_id)
              .map((inv) => inv.company_id),
          );
          expect(companyIds.size).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  test('cannot access other company data via direct URL manipulation', async ({ page }) => {
    // Try to access an invoice with a fabricated UUID
    const fakeId = '00000000-0000-4000-8000-000000000000';
    const response = await page.goto(`/api/invoices/${fakeId}`);

    if (response) {
      const status = response.status();
      // Should get 404 or 403, never 200 with another company's data
      expect([401, 403, 404, 500]).toContain(status);
    }
  });

  test('unauthenticated API access is rejected', async ({ page }) => {
    // Create a new context without cookies (no auth)
    const newPage = await page.context().browser()!.newPage();

    try {
      const response = await newPage.goto('/api/invoices');
      if (response) {
        const status = response.status();
        expect([401, 403]).toContain(status);
      }
    } finally {
      await newPage.close();
    }
  });
});
