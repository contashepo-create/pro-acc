let subscription: any = null;
const list = jest.fn();
const db = {
  storage: { from: jest.fn((bucket: string) => ({ list: (directory: string, options: unknown) => list(bucket, directory, options) })) },
  from: jest.fn(() => {
    const api: any = { select: () => api, eq: () => api, order: () => api, limit: () => api, maybeSingle: async () => ({ data: subscription, error: null }) };
    return api;
  }),
};
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => db }));

import { countUsedStorageBytes, hasModule } from '@/lib/plan-limits';

beforeEach(() => { jest.clearAllMocks(); subscription = null; });

describe('storage accounting and module entitlement helpers', () => {
  test('counts receipt files and recursively counts one contract folder level', async () => {
    list.mockImplementation(async (bucket: string, directory: string) => {
      if (bucket === 'receipts') return { data: [{ name: 'r.png', metadata: { size: 100 } }, { name: 'zero', metadata: { size: 0 } }], error: null };
      if (directory === 'c1') return { data: [{ name: 'contract-1', metadata: null }, { name: 'direct.pdf', metadata: { size: 200 } }], error: null };
      if (directory === 'c1/contract-1') return { data: [{ name: 'doc.pdf', metadata: { size: 300 } }], error: null };
      return { data: [], error: null };
    });
    await expect(countUsedStorageBytes('c1')).resolves.toBe(600);
  });

  test('treats empty/absent buckets as empty and surfaces unexpected storage failures', async () => {
    list.mockResolvedValue({ data: undefined, error: null });
    await expect(countUsedStorageBytes('c1')).resolves.toBe(0);
    list.mockResolvedValue({ data: [], error: null });
    await expect(countUsedStorageBytes('c1')).resolves.toBe(0);
    list.mockResolvedValue({ data: null, error: { message: 'bucket not found 404' } });
    await expect(countUsedStorageBytes('c1')).resolves.toBe(0);
    list.mockResolvedValue({ data: null, error: new Error('permission denied') });
    await expect(countUsedStorageBytes('c1')).rejects.toThrow('permission denied');
    list.mockResolvedValue({ data: null, error: {} });
    await expect(countUsedStorageBytes('c1')).rejects.toEqual({});
  });

  test('enforces the bounded storage pagination scan', async () => {
    const page = Array.from({ length: 1000 }, (_, index) => ({ name: `f${index}`, metadata: { size: 1 } }));
    list.mockResolvedValue({ data: page, error: null });
    await expect(countUsedStorageBytes('c1')).rejects.toThrow('safe scan limit');
  });

  test('returns zero when the client has no storage surface', async () => {
    const storageRef = (db as { storage?: unknown }).storage;
    delete (db as { storage?: unknown }).storage;
    await expect(countUsedStorageBytes('c1')).resolves.toBe(0);
    (db as { storage?: unknown }).storage = storageRef;
  });

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
