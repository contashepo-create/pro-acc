let subscription: any = null;
let subscriptionError: any = null;
let counts: Record<string, number> = {};
let countError: any = null;

const db = { from: jest.fn((table: string) => {
  const api: any = {
    select: () => api, eq: () => api, gte: () => api, order: () => api, limit: () => api,
    maybeSingle: async () => ({ data: subscription, error: subscriptionError }),
    then: (resolve: any, reject: any) => Promise.resolve({ data: null, count: counts[table] ?? 0, error: countError }).then(resolve, reject),
  };
  return api;
}) };
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => db }));

import { getCompanyPlanLimits, checkPlanLimit } from '@/lib/plan-limits';

const baseSub = (overrides: any = {}) => ({
  plan_code: 'pro', extra_users: 1, extra_branches: 2, extra_storage_gb: 1, addons_json: {},
  subscription_plans: {
    code: 'pro', max_users: 1, max_projects: 5, max_clients: 10, max_suppliers: 10,
    max_employees: 10, max_invoices_per_month: 100, max_quotations_per_month: 50,
    max_storage_mb: 100, max_branches: 1, features_modules: { branches: true },
  }, ...overrides,
});

beforeEach(() => { jest.clearAllMocks(); subscription = baseSub(); subscriptionError = null; counts = {}; countError = null; });

describe('plan limit exhaustive branches', () => {
  test('returns null/no subscription and surfaces subscription errors', async () => {
    subscription = null;
    await expect(getCompanyPlanLimits('c1')).resolves.toBeNull();
    await expect(checkPlanLimit('c1', 'users')).resolves.toEqual({ allowed: true, limit: null, current: 0 });
    subscriptionError = new Error('sub');
    await expect(getCompanyPlanLimits('c1')).rejects.toThrow('sub');
  });

  test('combines base and paid extras with configured branch limits', async () => {
    const limits = await getCompanyPlanLimits('c1');
    expect(limits).toMatchObject({ planCode: 'pro', max_users: 2, max_storage_mb: 1124, max_branches: 3, max_warehouses: 3, extra_storage_gb: 1 });
  });

  test('uses legacy storage addon and feature-derived branch defaults', async () => {
    subscription = baseSub({ extra_storage_gb: 0, addons_json: { extra_storage_gb_paid: 3 }, subscription_plans: { ...baseSub().subscription_plans, max_storage_mb: null, max_branches: null, features_modules: { warehouses: true } } });
    await expect(getCompanyPlanLimits('c1')).resolves.toMatchObject({ max_storage_mb: 3072, max_branches: 3, extra_storage_gb: 3 });
    subscription.subscription_plans.features_modules = {};
    await expect(getCompanyPlanLimits('c1')).resolves.toMatchObject({ max_branches: 2 });
  });

  test('defaults missing plan/subscription values safely', async () => {
    subscription = { plan_code: 'start', extra_users: null, extra_branches: null, extra_storage_gb: null, addons_json: null, subscription_plans: null };
    await expect(getCompanyPlanLimits('c1')).resolves.toMatchObject({ planCode: 'start', max_users: 1, max_storage_mb: 0, max_branches: 0, features_modules: {} });
    subscription = { plan_code: null, extra_users: 0, extra_branches: 0, extra_storage_gb: 0, addons_json: {}, subscription_plans: { ...baseSub().subscription_plans, code: null } };
    await expect(getCompanyPlanLimits('c1')).resolves.toMatchObject({ planCode: null });
  });

  test('allows unlimited/null resources and reports explicit supplied counts', async () => {
    subscription.subscription_plans.max_projects = null;
    await expect(checkPlanLimit('c1', 'projects', 999)).resolves.toEqual({ allowed: true, limit: null, current: 0 });
    await expect(checkPlanLimit('c1', 'users', 1)).resolves.toMatchObject({ allowed: true, limit: 2, current: 1 });
    await expect(checkPlanLimit('c1', 'users', 2)).resolves.toMatchObject({ allowed: false, limit: 2, current: 2, message: expect.stringContaining('المستخدمين') });
  });

  test('counts every database-backed resource branch', async () => {
    const cases: Array<[any, string, number]> = [
      ['users', 'users', 2], ['clients', 'contacts', 10], ['suppliers', 'contacts', 10],
      ['employees', 'employees', 10], ['projects', 'projects', 5], ['invoices', 'invoices', 100],
      ['quotations', 'quotations', 50], ['branches', 'branches', 3], ['warehouses', 'warehouses', 3],
    ];
    for (const [resource, table, count] of cases) {
      counts = { [table]: count };
      const result = await checkPlanLimit('c1', resource);
      expect(result.current).toBe(count);
      expect(result.allowed).toBe(false);
    }
    await expect(checkPlanLimit('c1', 'storage')).resolves.toMatchObject({ current: 0, limit: 1124, allowed: true });
  });

  test('returns zero and surfaces count failures for every resource table branch', async () => {
    const resources = ['users','clients','suppliers','employees','projects','invoices','quotations','branches','warehouses'] as const;
    for (const resource of resources) {
      counts = {};
      await expect(checkPlanLimit('c1', resource)).resolves.toMatchObject({ current: 0, allowed: true });
      countError = new Error(`count-${resource}`);
      await expect(checkPlanLimit('c1', resource)).rejects.toThrow(`count-${resource}`);
      countError = null;
    }
  });
});
