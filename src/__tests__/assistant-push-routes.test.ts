/**
 * Route-boundary tests for /api/assistant (deterministic accounting helper)
 * and /api/push-notifications (web-push subscription CRUD + queue).
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
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
          if (o.op === 'eq') return r[o.col!] === o.val;
          if (o.op === 'in') return (o.val as any[]).includes(r[o.col!]);
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
    from, calls, rpcResults,
    rpc: async (name: string) => rpcResults.get(name) || { data: null, error: null },
  };
}

let mockDb: ReturnType<typeof makeDb>;
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));

import { POST as assistantPOST } from '@/app/api/assistant/route';
import {
  GET as pushGET, POST as pushPOST, PUT as pushPUT, DELETE as pushDELETE,
} from '@/app/api/push-notifications/route';
import { resetRateLimits } from '@/lib/memory-rate-limit';

const C1 = 'company-1';
const ENDPOINT = 'https://fcm.example.com/send/abc123';

function req(role = 'admin', method = 'GET', url = 'http://localhost/x', body?: any) {
  const token = createToken('u1', role, 0);
  return { url, method, nextUrl: new URL(url), headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined }, json: async () => body } as any;
}

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: { reports: true, reports_basic: true, dashboard: true } } }],
    push_subscriptions: [], audit_log: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { resetRateLimits(); mockDb = makeDb(baseDb()); });

const snapshot = {
  revenue: 5000, expenses: 2000, netProfit: 3000,
  unpaidInvoices: 4, outstandingInvoices: 800, overdueInvoices: 200,
  journalEntries: 10, monthJournalEntries: 3,
  clients: 5, suppliers: 2, totalProjects: 3, activeProjects: 2, completedProjects: 1,
  activeProjectNames: ['مشروع أ', 'مشروع ب'],
};

describe('assistant', () => {
  test('rejects empty or oversized messages', async () => {
    const res = await assistantPOST(req('admin', 'POST', 'http://localhost/api/assistant', { message: '   ' }));
    expect(res.status).toBe(400);
    const res2 = await assistantPOST(req('admin', 'POST', 'http://localhost/api/assistant', { message: 'x'.repeat(1001) }));
    expect(res2.status).toBe(400);
  });

  test('returns a greeting when no intent is detected', async () => {
    const res = await assistantPOST(req('admin', 'POST', 'http://localhost/api/assistant', { message: 'مرحبا' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.response).toContain('مرحباً');
  });

  test('answers a financial (profit) question from the snapshot', async () => {
    mockDb.rpcResults.set('get_assistant_company_snapshot', { data: snapshot, error: null });
    const res = await assistantPOST(req('admin', 'POST', 'http://localhost/api/assistant', { message: 'كم أرباحي' }));
    const json = await res.json();
    expect(json.data.response).toContain('صافي الربح');
  });

  test('answers an invoice question', async () => {
    mockDb.rpcResults.set('get_assistant_company_snapshot', { data: snapshot, error: null });
    const res = await assistantPOST(req('admin', 'POST', 'http://localhost/api/assistant', { message: 'كم فاتورة متأخرة' }));
    const json = await res.json();
    expect(json.data.response).toContain('فواتير غير مسددة');
  });

  test('answers a journal question', async () => {
    mockDb.rpcResults.set('get_assistant_company_snapshot', { data: snapshot, error: null });
    const res = await assistantPOST(req('admin', 'POST', 'http://localhost/api/assistant', { message: 'ملخص القيد المنشور' }));
    const json = await res.json();
    expect(json.data.response).toContain('إجمالي القيود');
  });

  test('answers a contact question', async () => {
    mockDb.rpcResults.set('get_assistant_company_snapshot', { data: snapshot, error: null });
    const res = await assistantPOST(req('admin', 'POST', 'http://localhost/api/assistant', { message: 'كم عدد عميل' }));
    const json = await res.json();
    expect(json.data.response).toContain('العملاء');
  });

  test('answers a project question', async () => {
    mockDb.rpcResults.set('get_assistant_company_snapshot', { data: snapshot, error: null });
    const res = await assistantPOST(req('admin', 'POST', 'http://localhost/api/assistant', { message: 'ملخص مشروعي' }));
    const json = await res.json();
    expect(json.data.response).toContain('إجمالي المشاريع');
  });
});

describe('push-notifications', () => {
  test('GET lists the caller subscriptions', async () => {
    mockDb = makeDb({ ...baseDb(), push_subscriptions: [{ id: 'p1', user_id: 'u1', company_id: C1, endpoint: ENDPOINT, is_active: true, user_agent: 'ua', created_at: '2026-01-01', updated_at: '2026-01-01' }] });
    const res = await pushGET(req('admin', 'GET', 'http://localhost/api/push-notifications'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.subscriptions).toHaveLength(1);
  });

  test('POST registers a push subscription', async () => {
    mockDb.rpcResults.set('upsert_push_subscription_atomic', { data: { id: 'p1' }, error: null });
    const res = await pushPOST(req('admin', 'POST', 'http://localhost/api/push-notifications', {
      subscription: { endpoint: ENDPOINT, keys: { p256dh: 'k1', auth: 'k2' } },
    }));
    expect(res.status).toBe(201);
  });

  test('POST rejects a non-https endpoint', async () => {
    const res = await pushPOST(req('admin', 'POST', 'http://localhost/api/push-notifications', {
      subscription: { endpoint: 'http://insecure.example.com/x', keys: { p256dh: 'k1', auth: 'k2' } },
    }));
    expect(res.status).toBe(400);
  });

  test('PUT queues a notification (manager+)', async () => {
    mockDb.rpcResults.set('queue_push_notifications_atomic', { data: { queued: 2 }, error: null });
    const res = await pushPUT(req('admin', 'PUT', 'http://localhost/api/push-notifications', { title: 't', message: 'm' }));
    expect(res.status).toBe(200);
  });

  test('PUT rejects invalid payload', async () => {
    const res = await pushPUT(req('admin', 'PUT', 'http://localhost/api/push-notifications', { title: '', message: '' }));
    expect(res.status).toBe(400);
  });

  test('PUT maps target and permission RPC errors', async () => {
    mockDb.rpcResults.set('queue_push_notifications_atomic', { data: null, error: { message: 'المستهدف غير موجود' } });
    const res1 = await pushPUT(req('admin', 'PUT', 'http://localhost/api/push-notifications', { title: 't', message: 'm' }));
    expect(res1.status).toBe(404);
    mockDb.rpcResults.set('queue_push_notifications_atomic', { data: null, error: { message: 'لا تملك صلاحية' } });
    const res2 = await pushPUT(req('admin', 'PUT', 'http://localhost/api/push-notifications', { title: 't', message: 'm' }));
    expect(res2.status).toBe(403);
  });

  test('DELETE deactivates a push subscription', async () => {
    mockDb.rpcResults.set('deactivate_push_subscription_atomic', { data: true, error: null });
    const res = await pushDELETE(req('admin', 'DELETE', `http://localhost/api/push-notifications?endpoint=${encodeURIComponent(ENDPOINT)}`));
    expect(res.status).toBe(200);
  });

  test('DELETE rejects a missing/non-https endpoint', async () => {
    const res1 = await pushDELETE(req('admin', 'DELETE', 'http://localhost/api/push-notifications'));
    expect(res1.status).toBe(400);
    const res2 = await pushDELETE(req('admin', 'DELETE', `http://localhost/api/push-notifications?endpoint=${encodeURIComponent('http://x')}`));
    expect(res2.status).toBe(400);
  });

  test('DELETE maps not-found RPC error to 404', async () => {
    mockDb.rpcResults.set('deactivate_push_subscription_atomic', { data: null, error: { message: 'غير موجود' } });
    const res = await pushDELETE(req('admin', 'DELETE', `http://localhost/api/push-notifications?endpoint=${encodeURIComponent(ENDPOINT)}`));
    expect(res.status).toBe(404);
  });
});
