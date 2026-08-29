/**
 * Module entitlement helper tests (plan-limits.hasModule).
 * (Storage accounting was removed with the contract-document storage
 * cancellation — migration 116; receipts bucket stays legacy-read only.)
 */
type SubRow = {
  plan_code: string;
  extra_users: number; extra_branches: number; extra_storage_gb: number;
  addons_json: Record<string, unknown>;
  subscription_plans: {
    code: string; max_users: number; max_projects: number | null; max_clients: number | null;
    max_suppliers: number | null; max_employees: number | null; max_invoices_per_month: number;
    max_quotations_per_month: number; max_storage_mb: number; max_branches: number;
    features_modules: Record<string, unknown>;
  };
};
let subscription: SubRow | null = null;
const db = {
  from: jest.fn(() => {
    const api = {
      select: () => api, eq: () => api, order: () => api, limit: () => api,
      maybeSingle: async () => ({ data: subscription, error: null }),
    };
    return api;
  }),
};
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => db }));

import { hasModule } from '@/lib/plan-limits';

beforeEach(() => { jest.clearAllMocks(); subscription = null; });

describe('module entitlement helpers', () => {
  test('defaults unknown modules to enabled and honors explicit feature flags', async () => {
    await expect(hasModule('c1', 'inventory')).resolves.toBe(true);
    subscription = {
      plan_code: 'pro', extra_users: 0, extra_branches: 0, extra_storage_gb: 0, addons_json: {},
      subscription_plans: { code: 'pro', max_users: 1, max_projects: null, max_clients: null, max_suppliers: null, max_employees: null, max_invoices_per_month: 100, max_quotations_per_month: 50, max_storage_mb: 0, max_branches: 0, features_modules: {} },
    };
    await expect(hasModule('c1', 'inventory')).resolves.toBe(true);
    subscription.subscription_plans.features_modules = { inventory: false, invoices: true };
    await expect(hasModule('c1', 'inventory')).resolves.toBe(false);
    await expect(hasModule('c1', 'unknown')).resolves.toBe(true);
  });
});
