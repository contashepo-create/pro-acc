import { normalizeAdminPlanInput, PLAN_MODULES } from '@/lib/admin-plan-input';

const valid = { code: 'pro', name: 'Pro', currency: 'USD', price_monthly: 10, price_yearly: 100, features_modules: { dashboard: true } };

describe('admin plan input exhaustive branches', () => {
  test('rejects non-object payloads and invalid required identity fields', () => {
    for (const input of [null, [], 'x', 1]) expect(normalizeAdminPlanInput(input).ok).toBe(false);
    for (const patch of [
      { code: 1 }, { code: '!' }, { name: 1 }, { name: '' }, { name: 'x'.repeat(121) },
      { currency: 'usd' }, { currency: 1 },
    ]) expect(normalizeAdminPlanInput({ ...valid, ...patch }).ok).toBe(false);
  });

  test('normalizes aliases, defaults, descriptions and nullable prices', () => {
    const result = normalizeAdminPlanInput({ code: ' Start ', name: ' Start ', priceMonthly: '15.25', priceYearly: '', description: ' d ', description_ar: ' ع ', features_modules: {}, features: ['dashboard', 'dashboard'] });
    expect(result).toMatchObject({ ok: true, payload: { code: 'start', name: 'Start', price_monthly: 15.25, price_yearly: null, currency: 'USD', yearly_discount_percent: 20, trial_days: 7, max_users: 1, max_invoices_per_month: 100, max_quotations_per_month: 50, max_storage_mb: 0, sort_order: 0, features: ['dashboard'] } });
  });

  test('rejects every malformed money representation and required monthly null', () => {
    for (const value of [{}, '1.234', -1, Number.POSITIVE_INFINITY, 1_000_000_001, null]) {
      expect(normalizeAdminPlanInput({ ...valid, price_monthly: value }).ok).toBe(false);
    }
    expect(normalizeAdminPlanInput({ ...valid, price_yearly: {} }).ok).toBe(false);
  });

  test('validates integer field types, syntax, safety, limits and nullable fields', () => {
    for (const value of [{}, '1.2', -1, Number.MAX_SAFE_INTEGER + 1, 1_000_000_001]) {
      expect(normalizeAdminPlanInput({ ...valid, max_projects: value }).ok).toBe(false);
    }
    expect(normalizeAdminPlanInput({ ...valid, yearly_discount_percent: 101 }).ok).toBe(false);
    expect(normalizeAdminPlanInput({ ...valid, trial_days: 3651 }).ok).toBe(false);
    expect(normalizeAdminPlanInput({ ...valid, max_users: 0 }).ok).toBe(false);
    expect(normalizeAdminPlanInput({ ...valid, sort_order: 10001 }).ok).toBe(false);
    expect(normalizeAdminPlanInput({ ...valid, max_clients: '' })).toMatchObject({ ok: true, payload: { max_clients: null } });
  });

  test('validates module maps, feature lists and active state', () => {
    const tooMany = Object.fromEntries(Array.from({ length: PLAN_MODULES.size + 1 }, (_, i) => [`x${i}`, true]));
    expect(normalizeAdminPlanInput({ ...valid, features_modules: null }).ok).toBe(true);
    for (const modules of [[], tooMany, { unknown: true }, { dashboard: 'yes' }]) {
      expect(normalizeAdminPlanInput({ ...valid, features_modules: modules }).ok).toBe(false);
    }
    for (const features of ['x', Array(PLAN_MODULES.size + 1).fill('dashboard'), ['unknown'], [1]]) {
      expect(normalizeAdminPlanInput({ ...valid, features }).ok).toBe(false);
    }
    expect(normalizeAdminPlanInput({ ...valid, is_active: 'yes' }).ok).toBe(false);
    expect(normalizeAdminPlanInput({ ...valid, isActive: false })).toMatchObject({ ok: true, payload: { is_active: false } });
  });

  test('supports meaningful partial updates and rejects empty/invalid partials', () => {
    expect(normalizeAdminPlanInput({}, true)).toEqual({ ok: false, message: 'لا توجد حقول قابلة للتحديث' });
    expect(normalizeAdminPlanInput({ description: 'new' }, true)).toEqual({ ok: true, payload: { description: 'new' } });
    expect(normalizeAdminPlanInput({ maxUsers: '2' }, true)).toMatchObject({ ok: true, payload: { max_users: 2 } });
    expect(normalizeAdminPlanInput({ description: 'x'.repeat(501) }, true).ok).toBe(false);
  });
});
