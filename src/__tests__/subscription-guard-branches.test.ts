type SubRow = {
  status: string;
  end_date: string | null;
  plan_code: string | null;
  subscription_plans: { code: string | null; name: string | null; features_modules: Record<string, unknown> | string | null } | null;
};
let subscription: SubRow | null = null;
const db = { from: jest.fn(() => { const api: TestBuilder = { select: () => api, eq: () => api, order: () => api, limit: () => api, maybeSingle: async () => ({ data: subscription, error: null }) }; return api; }) };
import type { TestBuilder } from './mocks';
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => db }));

import { getSubscriptionAccess, assertSubscriptionAccess, isSubscriptionReadOnlyMethod } from '@/lib/subscription-guard';

const future = () => { const d = new Date(); d.setDate(d.getDate() + 10); return d.toISOString().slice(0, 10); };
const past = () => { const d = new Date(); d.setDate(d.getDate() - 10); return d.toISOString().slice(0, 10); };
const sub = (status: string, end_date: string | null = future(), features: Record<string, unknown> | string | null = { invoices: true }): SubRow => ({ status, end_date, plan_code: 'fallback', subscription_plans: { code: 'pro', name: 'Pro', features_modules: features } });

beforeEach(() => { jest.clearAllMocks(); subscription = null; });

describe('subscription access status branches', () => {
  test('classifies missing, cancelled, pending and unexpected subscriptions', async () => {
    await expect(getSubscriptionAccess('c')).resolves.toMatchObject({ status: 'missing', isExpired: true, reason: 'no_subscription' });
    subscription = sub('cancelled');
    await expect(getSubscriptionAccess('c')).resolves.toMatchObject({ status: 'cancelled', reason: 'subscription_cancelled' });
    subscription = sub('pending');
    await expect(getSubscriptionAccess('c')).resolves.toMatchObject({ status: 'pending', reason: 'payment_pending' });
    subscription = sub('inactive');
    await expect(getSubscriptionAccess('c')).resolves.toMatchObject({ status: 'expired', reason: 'subscription_inactive' });
  });

  test('classifies live/expired trial and active subscriptions with/without dates', async () => {
    subscription = sub('trial', future());
    await expect(getSubscriptionAccess('c')).resolves.toMatchObject({ status: 'trial', allowed: true, isExpired: false });
    subscription = sub('trial', past());
    await expect(getSubscriptionAccess('c')).resolves.toMatchObject({ status: 'trial_expired', allowed: false, reason: 'trial_expired' });
    subscription = sub('active', future());
    await expect(getSubscriptionAccess('c')).resolves.toMatchObject({ status: 'active', allowed: true, planCode: 'pro', planName: 'Pro' });
    subscription = sub('active', past());
    await expect(getSubscriptionAccess('c')).resolves.toMatchObject({ status: 'expired', reason: 'subscription_expired' });
    subscription = sub('active', null);
    await expect(getSubscriptionAccess('c')).resolves.toMatchObject({ status: 'active', daysRemaining: 0, endDate: null });
  });

  test('parses object/string feature maps and tolerates malformed/missing plans', async () => {
    subscription = sub('active', future(), '{"invoices":false}');
    await expect(getSubscriptionAccess('c')).resolves.toMatchObject({ features: { invoices: false } });
    subscription = sub('active', future(), '{bad');
    await expect(getSubscriptionAccess('c')).resolves.toMatchObject({ features: {} });
    subscription = { status: 'active', end_date: future(), plan_code: 'legacy', subscription_plans: null };
    await expect(getSubscriptionAccess('c')).resolves.toMatchObject({ planCode: 'legacy', planName: null, features: {} });
  });
});

describe('subscription request enforcement branches', () => {
  test('recognizes all readonly method variants and defaults', () => {
    expect(isSubscriptionReadOnlyMethod(undefined)).toBe(true);
    expect(isSubscriptionReadOnlyMethod('get')).toBe(true);
    expect(isSubscriptionReadOnlyMethod('HEAD')).toBe(true);
    expect(isSubscriptionReadOnlyMethod('OPTIONS')).toBe(true);
    expect(isSubscriptionReadOnlyMethod('POST')).toBe(false);
  });

  test('expiry locks EVERY module (reads included) except the renewal + data-download whitelist', async () => {
    subscription = sub('cancelled');
    // Reads of business modules are blocked — no browsing after expiry.
    for (const method of ['GET', 'POST', 'PUT', 'DELETE'] as const) {
      await expect(assertSubscriptionAccess('c', method, '/api/invoices')).rejects.toThrow('انتهت صلاحية الاشتراك');
      await expect(assertSubscriptionAccess('c', method, '/api/dashboard')).rejects.toThrow();
      await expect(assertSubscriptionAccess('c', method, '/api/journal')).rejects.toThrow();
      await expect(assertSubscriptionAccess('c', method, '/api/reports/financial')).rejects.toThrow();
      await expect(assertSubscriptionAccess('c', method, '/api/notifications')).rejects.toThrow();
    }
    // The renewal flow and the table data download keep working.
    for (const path of [
      '/api/support', '/api/support/ticket', '/api/upload/receipt', '/api/auth/logout?x=1',
      '/api/company/export-download', '/api/payment-methods', '/api/subscription/activate-code',
      '/api/subscription/upgrade-request', '/api/subscription/addon-request', '/api/auth/subscription-status',
    ]) {
      await expect(assertSubscriptionAccess('c', 'POST', path)).resolves.toBeTruthy();
      await expect(assertSubscriptionAccess('c', 'GET', path)).resolves.toBeTruthy();
    }
  });

  test('uses specific errors for missing/trial-expired/general expired writes', async () => {
    subscription = null;
    await expect(assertSubscriptionAccess('c', 'POST', '/api/invoices')).rejects.toThrow('لا يوجد اشتراك');
    await expect(assertSubscriptionAccess('c', 'GET', '/api/invoices')).rejects.toThrow('لا يوجد اشتراك');
    subscription = sub('trial', past());
    await expect(assertSubscriptionAccess('c', 'POST', '/api/invoices')).rejects.toThrow('التجريبية');
    subscription = sub('cancelled');
    await expect(assertSubscriptionAccess('c', 'POST', '/api/invoices')).rejects.toThrow('انتهت صلاحية');
    await expect(assertSubscriptionAccess('c', 'GET', '/api/invoices')).rejects.toThrow('انتهت صلاحية');
  });

  test('enforces disabled modules but permits enabled, unknown and always-available modules', async () => {
    subscription = sub('active', future(), { invoices: false, journal: true, accounts: false });
    await expect(assertSubscriptionAccess('c', 'POST', '/api/invoices')).rejects.toThrow('invoices');
    await expect(assertSubscriptionAccess('c', 'POST', '/api/journal')).resolves.toBeTruthy();
    await expect(assertSubscriptionAccess('c', 'POST', '/api/unmapped')).resolves.toBeTruthy();
    await expect(assertSubscriptionAccess('c', 'POST', '/api/dashboard')).resolves.toBeTruthy();
    // No plan name/code exercises the display fallback.
    subscription = { status: 'active', end_date: future(), plan_code: null, subscription_plans: { code: null, name: null, features_modules: { invoices: false } } };
    await expect(assertSubscriptionAccess('c', 'POST', '/api/invoices')).rejects.toThrow('—');
  });
});
