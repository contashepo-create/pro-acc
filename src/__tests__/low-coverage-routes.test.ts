/**
 * Route-boundary tests for remaining low-coverage API routes:
 * fixed-assets/depreciate, reports/anomalies, telegram/webhook.
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
process.env.ADMIN_TOKEN_SECRET = 'test-admin-secret-key-for-unit-tests-32chars!';
import { createToken } from '@/lib/auth';

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
      insert: () => api, update: () => api, delete: () => api,
      maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
      single: async () => ({ data: rows()[0] || null, error: rows()[0] ? null : { message: 'not found' } }),
      then: (ok: any, fail: any) =>
        Promise.resolve({ data: rows(), error: null, count: rows().length }).then(ok, fail),
    };
    return api;
  };
  return {
    from, calls, rpcResults, db,
    rpc: async (name: string) => rpcResults.get(name) || { data: null, error: null },
  };
}

let mockDb: ReturnType<typeof makeDb>;
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));

import { POST as depPOST, GET as depGET } from '@/app/api/fixed-assets/depreciate/route';
import { GET as anomGET } from '@/app/api/reports/anomalies/route';
import { POST as webhookPOST } from '@/app/api/telegram/webhook/route';
import { resetRateLimits } from '@/lib/memory-rate-limit';

const C1 = 'company-1';
const U1 = '00000000-0000-4000-8000-0000000000u1';

function userReq(method = 'GET', url = 'http://localhost/x', body?: any) {
  const token = createToken(U1, 'admin', 0);
  return {
    url, method, nextUrl: new URL(url),
    headers: { get: (k: string) => (k === 'authorization' ? `Bearer ${token}` : null) },
    cookies: { get: () => undefined },
    json: async () => body,
  } as any;
}

const MODULES = { fixed_assets: true, reports: true };

function baseDb() {
  return {
    users: [{ id: U1, company_id: C1, name: 'م', email: 'admin@example.com', is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise', subscription_plans: { code: 'enterprise', features_modules: MODULES } }],
    fixed_assets: [], invoices: [],
  } as Record<string, Row[]>;
}

beforeEach(() => {
  resetRateLimits();
  mockDb = makeDb(baseDb());
});

describe('fixed-assets/depreciate', () => {
  test('GET returns a depreciation preview for straight-line assets', async () => {
    mockDb.db.fixed_assets.push({
      id: 'f1', code: 'FA-1', name: 'مبنى', purchase_cost: 120000, accumulated_depreciation: 0,
      useful_life_years: 10, depreciation_method: 'straight_line', status: 'active', company_id: C1,
    });
    const res = await depGET(userReq('GET', 'http://localhost/api/fixed-assets/depreciate'));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.count).toBe(1);
    expect(body.data.assets[0].monthly).toBe('1000.00');
  });

  test('GET previews declining-balance assets and clamps monthly to remaining', async () => {
    mockDb.db.fixed_assets.push({
      id: 'f2', code: 'FA-2', name: 'آلة', purchase_cost: 100, accumulated_depreciation: 90,
      useful_life_years: 5, depreciation_method: 'declining_balance', status: 'active', company_id: C1,
    });
    const res = await depGET(userReq('GET', 'http://localhost/api/fixed-assets/depreciate'));
    const body = await res.json();
    expect(body.data.assets[0].remaining).toBe('10.00');
  });

  test('GET returns empty when there are no eligible assets', async () => {
    const res = await depGET(userReq('GET', 'http://localhost/api/fixed-assets/depreciate'));
    const body = await res.json();
    expect(body.data.count).toBe(0);
  });

  test('POST propagates an rpc error', async () => {
    mockDb.rpcResults.set('depreciate_fixed_assets_batch', { data: null, error: { message: 'db down' } });
    const res = await depPOST(userReq('POST', 'http://localhost/api/fixed-assets/depreciate'));
    expect(res.status).toBe(500);
  });

  test('POST returns a summary message', async () => {
    mockDb.rpcResults.set('depreciate_fixed_assets_batch', { data: { count: 3, totalDepreciation: 500 }, error: null });
    const res = await depPOST(userReq('POST', 'http://localhost/api/fixed-assets/depreciate'));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.message).toContain('3 قيد إهلاك');
  });
});

describe('reports/anomalies', () => {
  test('GET returns an anomaly scan with empty findings', async () => {
    const res = await anomGET(userReq('GET', 'http://localhost/api/reports/anomalies'));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.total).toBe(0);
    expect(body.data.scannedInvoices).toBe(0);
  });

  test('GET handles an rpc error gracefully', async () => {
    mockDb.rpcResults.set('get_monthly_profit_loss', { data: null, error: { message: 'boom' } });
    const res = await anomGET(userReq('GET', 'http://localhost/api/reports/anomalies'));
    expect(res.status).toBe(500);
  });
});

describe('telegram/webhook', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = 'bot-token';
    process.env.TELEGRAM_WEBHOOK_SECRET = 'secret';
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    global.fetch = fetchMock as any;
  });

  function webhookReq(body: any) {
    return {
      url: 'http://localhost/api/telegram/webhook',
      method: 'POST',
      headers: { get: (k: string) => (k === 'x-telegram-bot-api-secret-token' ? 'secret' : null) },
      cookies: { get: () => undefined },
      json: async () => body,
    } as any;
  }

  test('returns 403 when the webhook secret is rejected', async () => {
    (process.env as any).NODE_ENV = 'production';
    const res = await webhookPOST({
      url: 'http://localhost/x',
      headers: { get: () => null },
      json: async () => ({}),
    } as any);
    expect(res.status).toBe(403);
    (process.env as any).NODE_ENV = 'test';
  });

  test('replies to a /start message via Telegram', async () => {
    const res = await webhookPOST(webhookReq({ message: { chat: { id: 123 }, text: '/start' } }));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalled();
    expect(String(fetchMock.mock.calls[0][0])).toContain('/sendMessage');
  });

  test('acknowledges an unknown callback query', async () => {
    const res = await webhookPOST(webhookReq({ callback_query: { id: 'c1', data: 'unknown:xyz', message: { chat: { id: 1 }, message_id: 5 } } }));
    expect(res.status).toBe(200);
  });

  test('processes an invalid test callback', async () => {
    const res = await webhookPOST(webhookReq({ callback_query: { id: 'c1', data: 'test:invalid', message: { chat: { id: 1 }, message_id: 5 } } }));
    expect(res.status).toBe(200);
  });

  test('processes a test:accept callback', async () => {
    mockDb.rpcResults.set('finish_telegram_test_run_atomic', { data: { ok: true }, error: null });
    const res = await webhookPOST(webhookReq({ callback_query: { id: 'c1', data: 'test:accept:run123', message: { chat: { id: 1 }, message_id: 5 } } }));
    expect(res.status).toBe(200);
  });

  test('handles a reset:reject callback', async () => {
    mockDb.rpcResults.set('reject_telegram_reset_session_atomic', { data: { ok: true }, error: null });
    const res = await webhookPOST(webhookReq({ callback_query: { id: 'c1', data: 'reset:reject', message: { chat: { id: 1 }, message_id: 5 } } }));
    expect(res.status).toBe(200);
  });

  test('handles an approval callback', async () => {
    mockDb.rpcResults.set('respond_approval_by_telegram_atomic', { data: { ok: true }, error: null });
    const res = await webhookPOST(webhookReq({ callback_query: { id: 'c1', data: 'approval:approve:ap123', message: { chat: { id: 1 }, message_id: 5 } } }));
    expect(res.status).toBe(200);
  });

  test('handles an approval decision failure', async () => {
    mockDb.rpcResults.set('respond_approval_by_telegram_atomic', { data: null, error: { message: 'لا صلاحية' } });
    const res = await webhookPOST(webhookReq({ callback_query: { id: 'c1', data: 'approval:approve:ap123', message: { chat: { id: 1 }, message_id: 5 } } }));
    expect(res.status).toBe(200);
  });
});
