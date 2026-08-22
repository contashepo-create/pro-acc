/**
 * Route-boundary tests for banks, settings/telegram, subcontractors/contracts,
 * admin/app-settings, admin/subscription-plans.
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
process.env.ADMIN_TOKEN_SECRET = 'test-admin-secret-key-for-unit-tests-32chars!';
import { createToken, createAdminToken } from '@/lib/auth';

type Row = Record<string, any>;
type Op = { op: string; col?: string; val?: any };

function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Op[] }> = [];
  const rpcResults = new Map<string, any>();
  const from = (table: string) => {
    const ops: Op[] = [];
    calls.push({ table, ops });
    const rows = () =>
      (db[table] || []).filter((r) =>
        ops.every((o) => {
          const get = (col: string) => col.split('.').reduce((acc, k) => (acc == null ? acc : (acc as any)[k]), r);
          if (o.op === 'eq') return get(o.col!) === o.val;
          if (o.op === 'in') return (o.val as any[]).includes(get(o.col!));
          return true;
        })
      );
    const api: any = {
      select: () => api,
      eq: (col: string, val: any) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: any) => { ops.push({ op: 'in', col, val }); return api; },
      order: () => api, limit: () => api, range: () => api, is: () => api, neq: () => api,
      or: () => api, lt: () => api, gte: () => api, lte: () => api,
      insert: (payload: any) => { db[table] = [...(db[table] || []), payload]; return api; },
      update: () => api, delete: () => api,
      maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
      single: async () => ({ data: rows()[0] || null, error: rows()[0] ? null : { message: 'not found' } }),
      then: (ok: any, fail: any) =>
        Promise.resolve({ data: rows(), error: null, count: rows().length }).then(ok, fail),
    };
    return api;
  };
  return {
    from, calls, rpcResults,
    rpc: async (name: string) => rpcResults.get(name) || { data: null, error: null },
  };
}

let mockDb: ReturnType<typeof makeDb>;
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));

import { GET as bankGET, POST as bankPOST } from '@/app/api/banks/route';
import { GET as tgGET, PUT as tgPUT } from '@/app/api/settings/telegram/route';
import { GET as subConGET, POST as subConPOST } from '@/app/api/subcontractors/contracts/route';
import { GET as appSetGET, PUT as appSetPUT } from '@/app/api/admin/app-settings/route';
import { GET as plansGET, POST as plansPOST } from '@/app/api/admin/subscription-plans/route';
import { resetRateLimits } from '@/lib/memory-rate-limit';

const C1 = 'company-1';
const A1 = '00000000-0000-4000-8000-0000000000a1';
const ID1 = '00000000-0000-4000-8000-00000000f0f1';

function req(role = 'admin', method = 'GET', url = 'http://localhost/x', body?: any) {
  const token = createToken('u1', role, 0);
  return { url, method, nextUrl: new URL(url), headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined }, json: async () => body } as any;
}
function adminReq(method = 'GET', url = 'http://localhost/x', body?: any) {
  const token = createAdminToken(A1, 0);
  return { url, method, nextUrl: new URL(url), headers: { get: () => null },
    cookies: { get: (name: string) => name === 'admin_token' ? { value: token } : undefined },
    json: async () => body, text: async () => JSON.stringify(body) } as any;
}

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, name: 'م', email: 'admin@example.com', is_active: true, token_version: 0, role: 'admin' }],
    admin_users: [{ id: A1, email: 'admin@example.com', name: 'مدير', is_active: true, token_version: 0 }],
    companies: [{ id: C1, is_active: true }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: {} } }],
    banks_safes: [], company_telegram_configs: [], subcontractor_contracts: [], contacts: [],
    app_settings: [], subscription_plans: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { resetRateLimits(); mockDb = makeDb(baseDb()); });

describe('banks', () => {
  test('GET lists banks with balances', async () => {
    mockDb = makeDb({ ...baseDb(), banks_safes: [{ id: ID1, company_id: C1, name: 'بنك', type: 'bank', accounts: { code: '1110', name: 'بنك' } }] });
    mockDb.rpcResults.set('get_bank_safe_balances', { data: [{ bank_safe_id: ID1, current_balance: 500 }], error: null });
    const res = await bankGET(req('admin', 'GET', 'http://localhost/api/banks'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.banks[0].current_balance).toBe(500);
  });

  test('POST creates a bank', async () => {
    mockDb.rpcResults.set('create_bank_safe_atomic', { data: { id: ID1 }, error: null });
    const res = await bankPOST(req('admin', 'POST', 'http://localhost/x', { name: 'بنك', type: 'bank' }));
    expect(res.status).toBe(201);
  });
});

describe('settings/telegram', () => {
  test('GET returns config', async () => {
    const res = await tgGET(req('admin', 'GET', 'http://localhost/api/settings/telegram'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.isAllowed).toBe(true);
  });

  test('PUT saves config', async () => {
    mockDb.rpcResults.set('save_telegram_config_atomic', { data: { chat_id: '123' }, error: null });
    const res = await tgPUT(req('admin', 'PUT', 'http://localhost/x', {
      chat_id: '123', is_enabled: true, notify_invoices: true, notify_cash_transactions: true,
      notify_user_logins: false, approvals_enabled: true, approval_threshold: 5000,
    }));
    expect(res.status).toBe(200);
  });

  test('PUT rejects invalid config', async () => {
    const res = await tgPUT(req('admin', 'PUT', 'http://localhost/x', { chat_id: 'abc', is_enabled: true }));
    expect(res.status).toBe(400);
  });
});

describe('subcontractors/contracts', () => {
  test('GET lists contracts', async () => {
    mockDb = makeDb({ ...baseDb(), subcontractor_contracts: [{ id: ID1, company_id: C1, contacts: { name: 'مقاول' } }] });
    const res = await subConGET(req('admin', 'GET', 'http://localhost/api/subcontractors/contracts'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.contracts[0].subcontractor_name).toBe('مقاول');
  });

  test('POST creates a contract', async () => {
    mockDb = makeDb({ ...baseDb(), contacts: [{ id: ID1, company_id: C1, type: 'subcontractor' }] });
    const res = await subConPOST(req('admin', 'POST', 'http://localhost/x', { subcontractor_id: ID1, contract_number: 'C1', contract_value: 1000, start_date: '2026-01-01' }));
    expect(res.status).toBe(201);
  });

  test('POST rejects an unknown subcontractor', async () => {
    const res = await subConPOST(req('admin', 'POST', 'http://localhost/x', { subcontractor_id: ID1, contract_number: 'C1', contract_value: 1000, start_date: '2026-01-01' }));
    expect(res.status).toBe(404);
  });
});

describe('admin/app-settings', () => {
  test('GET lists settings', async () => {
    mockDb = makeDb({ ...baseDb(), app_settings: [{ key: 'maintenance', value: 'true', category: 'general' }] });
    const res = await appSetGET(adminReq('GET', 'http://localhost/api/admin/app-settings'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.maintenance).toBe('true');
  });

  test('PUT updates settings', async () => {
    mockDb.rpcResults.set('admin_upsert_app_settings', { data: { updated: 1 }, error: null });
    const res = await appSetPUT(adminReq('PUT', 'http://localhost/x', { maintenance: true }));
    expect(res.status).toBe(200);
  });
});

describe('admin/subscription-plans', () => {
  test('GET lists plans', async () => {
    mockDb = makeDb({ ...baseDb(), subscription_plans: [{ id: ID1, code: 'pro', name: 'باقة', is_active: true }] });
    const res = await plansGET(adminReq('GET', 'http://localhost/api/admin/subscription-plans'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.plans).toHaveLength(1);
  });

  test('POST creates a plan', async () => {
    mockDb.rpcResults.set('admin_manage_subscription_plan', { data: { id: ID1 }, error: null });
    const res = await plansPOST(adminReq('POST', 'http://localhost/x', {
      code: 'pro2', name: 'باقة', currency: 'SAR', price_monthly: 100, price_yearly: 1000, max_users: 5,
    }));
    expect(res.status).toBe(201);
  });
});
