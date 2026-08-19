/** Unit coverage for shared API, cache, subscription, project and storage helpers. */

const rpc = jest.fn();
const subscriptionSingle = jest.fn();
const planSingle = jest.fn();
const mockSupabase = {
  rpc,
  from: jest.fn((table: string) => {
    const api: any = {
      select: () => api, eq: () => api, order: () => api, limit: () => api,
      single: table === 'subscriptions' ? subscriptionSingle : planSingle,
    };
    return api;
  }),
};
const getCompanyPlanLimits = jest.fn();
const checkPlanLimit = jest.fn();
const hasModule = jest.fn();

jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockSupabase }));
jest.mock('@/lib/plan-limits', () => ({ getCompanyPlanLimits, checkPlanLimit, hasModule }));

import { NextResponse } from 'next/server';
import { apiFetch } from '@/lib/api-client';
import { getCacheConfig, applyCacheHeaders, generateETag, checkETag } from '@/lib/cache';
import { accumulateProjectLine, sumProjectJournal, sumProjectsJournal } from '@/lib/project-costs';
import { signPrivateReceiptReference } from '@/lib/storage-references';
import { getCompanyLimits, checkUsageLimit, checkModuleAccess, UsageLimitError } from '@/lib/usage-limits';
import { getCompanySubscription, requireActiveSubscription, SubscriptionError } from '@/lib/subscription';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('apiFetch', () => {
  test('cache-busts GET and applies safe fetch defaults', async () => {
    const response = new Response('{}');
    global.fetch = jest.fn(async () => response) as any;
    jest.spyOn(Date, 'now').mockReturnValue(12345);
    await expect(apiFetch('/api/items')).resolves.toBe(response);
    expect(global.fetch).toHaveBeenCalledWith('/api/items?_ts=12345', { credentials: 'same-origin', cache: 'no-store' });
    await apiFetch('/api/items?q=1');
    expect(global.fetch).toHaveBeenLastCalledWith('/api/items?q=1&_ts=12345', expect.any(Object));
    jest.restoreAllMocks();
  });

  test('does not alter write URLs and lets explicit options override defaults', async () => {
    global.fetch = jest.fn(async () => new Response()) as any;
    await apiFetch('/api/items', { method: 'post', credentials: 'include', cache: 'reload' });
    expect(global.fetch).toHaveBeenCalledWith('/api/items', expect.objectContaining({ method: 'post', credentials: 'include', cache: 'reload' }));
  });
});

describe('cache helpers', () => {
  test('resolves exact, prefix and default cache policies', () => {
    expect(getCacheConfig('GET', '/api/accounts').cache).toBe('no-store');
    expect(getCacheConfig('GET', '/api/reports/aging').cache).toBe('no-store');
    expect(getCacheConfig('POST', '/unknown')).toMatchObject({ cache: 'private', maxAge: 0 });
  });

  test('sets no-store, private/public, vary and security headers', () => {
    const noStore = applyCacheHeaders(NextResponse.json({}), { cache: 'no-store' });
    expect(noStore.headers.get('Cache-Control')).toContain('no-store');
    expect(noStore.headers.get('Pragma')).toBe('no-cache');
    expect(noStore.headers.get('Vary')).toContain('Cookie');
    expect(noStore.headers.get('X-Frame-Options')).toBe('DENY');

    const privateResponse = applyCacheHeaders(NextResponse.json({}), { cache: 'private', maxAge: 20, staleWhileRevalidate: 10, vary: 'Accept-Language' });
    expect(privateResponse.headers.get('Cache-Control')).toBe('private, max-age=20, stale-while-revalidate=10');
    expect(privateResponse.headers.get('Vary')).toContain('Accept-Language');

    const publicResponse = applyCacheHeaders(NextResponse.json({}), { cache: 'public', maxAge: 60, vary: 'Accept-Encoding' });
    expect(publicResponse.headers.get('Vary')).toBe('Accept-Encoding');
  });

  test('generates deterministic ETags and checks request headers', () => {
    expect(generateETag({ a: 1 })).toBe(generateETag({ a: 1 }));
    expect(generateETag({ a: 1 })).not.toBe(generateETag({ a: 2 }));
    const etag = generateETag(['x']);
    expect(checkETag(new Request('https://app.test', { headers: { 'If-None-Match': etag } }), etag)).toBe(true);
    expect(checkETag(new Request('https://app.test'), etag)).toBe(false);
  });
});

describe('project journal helpers', () => {
  test('accumulates only expense and revenue account lines', () => {
    const acc = { expenses: 0, revenue: 0 };
    accumulateProjectLine(acc, { type: 'expense', debit: 100, credit: 20 });
    accumulateProjectLine(acc, { type: 'revenue', debit: 10, credit: 200 });
    accumulateProjectLine(acc, { type: 'asset', debit: 999, credit: 0 });
    expect(acc).toEqual({ expenses: 80, revenue: 190 });
  });

  test('summarizes one project with rounded accounts and profit', async () => {
    rpc.mockResolvedValueOnce({ data: [
      { code: '5100', name: 'Cost', account_type: 'expense', debit: 100.005, credit: 0 },
      { code: '4100', name: 'Revenue', account_type: 'revenue', debit: 0, credit: 250.005 },
    ], error: null });
    await expect(sumProjectJournal('c1', 'p1', '2026-01-01', '2026-12-31')).resolves.toMatchObject({ expenses: 100.01, revenue: 250.01, profit: 150 });
    expect(rpc).toHaveBeenCalledWith('get_project_account_totals', expect.objectContaining({ p_company_id: 'c1', p_project_ids: ['p1'] }));
  });

  test('summarizes multiple projects, ignores unknown rows and handles empty/error', async () => {
    expect(await sumProjectsJournal('c1', [])).toEqual({});
    rpc.mockResolvedValueOnce({ data: [
      { project_id: 'p1', account_type: 'expense', debit: 10, credit: 1 },
      { project_id: 'p2', account_type: 'revenue', debit: 2, credit: 20 },
      { project_id: 'foreign', account_type: 'expense', debit: 999, credit: 0 },
    ], error: null });
    await expect(sumProjectsJournal('c1', ['p1', 'p2'])).resolves.toEqual({ p1: { expenses: 9, revenue: 0 }, p2: { expenses: 0, revenue: 18 } });
    rpc.mockResolvedValueOnce({ data: null, error: new Error('db') });
    await expect(sumProjectJournal('c1', 'p1')).rejects.toThrow('db');
  });
});

describe('private storage references', () => {
  test('handles missing, legacy, unsafe, failed and successful references', async () => {
    const createSignedUrl = jest.fn();
    const client = { storage: { from: jest.fn(() => ({ createSignedUrl })) } };
    await expect(signPrivateReceiptReference(client, null)).resolves.toBeNull();
    await expect(signPrivateReceiptReference(client, 'https://legacy.test/file')).resolves.toBe('https://legacy.test/file');
    for (const unsafe of ['../secret', '/absolute', 'folder\\file']) {
      await expect(signPrivateReceiptReference(client, unsafe)).resolves.toBeNull();
    }
    createSignedUrl.mockResolvedValueOnce({ data: null, error: new Error('storage') });
    await expect(signPrivateReceiptReference(client, 'c1/file.png')).resolves.toBeNull();
    createSignedUrl.mockResolvedValueOnce({ data: { signedUrl: 'https://signed.test' }, error: null });
    await expect(signPrivateReceiptReference(client, 'c1/file.png', 30)).resolves.toBe('https://signed.test');
    expect(createSignedUrl).toHaveBeenLastCalledWith('c1/file.png', 30);
  });
});

describe('usage limits facade', () => {
  test('normalizes plan limits and returns safe defaults without a subscription', async () => {
    getCompanyPlanLimits.mockResolvedValueOnce({
      planCode: 'pro', max_users: 3, max_clients: undefined, max_suppliers: 10,
      max_employees: 20, max_projects: 5, max_invoices_per_month: 500,
      max_quotations_per_month: 250, max_storage_mb: 1024, features_modules: { inventory: true },
      extra_users: 2, extra_branches: 1, extra_storage_gb: 1,
    });
    await expect(getCompanyLimits('c1')).resolves.toMatchObject({ planCode: 'pro', max_users: 3, max_clients: null });
    getCompanyPlanLimits.mockResolvedValueOnce(null);
    await expect(getCompanyLimits('new')).resolves.toMatchObject({ planCode: null, max_users: 1, max_invoices_per_month: 100 });
  });

  test('delegates usage/module checks and names limit errors', async () => {
    checkPlanLimit.mockResolvedValueOnce({ allowed: false, limit: 1, current: 1 });
    await expect(checkUsageLimit('c1', 'users', 1)).resolves.toMatchObject({ allowed: false });
    expect(checkPlanLimit).toHaveBeenCalledWith('c1', 'users', 1);
    hasModule.mockResolvedValueOnce(true);
    await expect(checkModuleAccess('c1', 'inventory')).resolves.toBe(true);
    expect(new UsageLimitError('limit')).toMatchObject({ name: 'UsageLimitError', message: 'limit' });
  });
});

describe('subscription helpers', () => {
  test('returns null on absent/error rows', async () => {
    subscriptionSingle.mockResolvedValueOnce({ data: null, error: { message: 'not found' } });
    await expect(getCompanySubscription('c1')).resolves.toBeNull();
  });

  test('loads plan name and computes active/expiring/expired flags', async () => {
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    subscriptionSingle.mockResolvedValueOnce({ data: {
      id: 's1', company_id: 'c1', plan_id: 'plan1', plan_code: 'pro', status: 'active',
      start_date: '2026-01-01', end_date: tomorrow.toISOString().slice(0, 10),
    }, error: null });
    planSingle.mockResolvedValueOnce({ data: { name: 'Pro' }, error: null });
    const result = await getCompanySubscription('c1');
    expect(result).toMatchObject({ plan_name: 'Pro', is_expired: false, is_expiring_soon: true });

    subscriptionSingle.mockResolvedValueOnce({ data: {
      id: 's2', company_id: 'c1', plan_id: null, plan_code: 'trial', status: 'expired',
      start_date: '2020-01-01', end_date: '2020-01-02',
    }, error: null });
    await expect(getCompanySubscription('c1')).resolves.toMatchObject({ plan_name: null, is_expired: true, is_expiring_soon: false });
  });

  test('requires an existing non-expired subscription', async () => {
    subscriptionSingle.mockResolvedValueOnce({ data: null, error: {} });
    await expect(requireActiveSubscription('missing')).rejects.toThrow('لا يوجد اشتراك فعال');
    subscriptionSingle.mockResolvedValueOnce({ data: {
      id: 's', company_id: 'c', plan_id: null, plan_code: 'x', status: 'expired', start_date: '2020-01-01', end_date: '2020-01-02',
    }, error: null });
    await expect(requireActiveSubscription('c')).rejects.toThrow('انتهت صلاحية الاشتراك');
    expect(new SubscriptionError('x').name).toBe('SubscriptionError');
  });
});
