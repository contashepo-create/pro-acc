/**
 * Route-boundary tests for reminders, subscription/activate-code,
 * auth/cleanup-inactive, company/users, company/users/[id], company/reset.
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
process.env.CRON_SECRET = 'cron-secret-123';
import { createToken } from '@/lib/auth';

const sendVerificationEmailMock = jest.fn();
jest.mock('@/lib/email', () => ({ sendVerificationEmail: (...a: unknown[]) => sendVerificationEmailMock(...a) }));
const sendOverdueMock = jest.fn();
const sendSingleMock = jest.fn();
jest.mock('@/lib/messaging', () => ({
  renderTemplate: (tpl: string) => String(tpl).replace('{customer_name}', 'عميل').replace('{amount}', '100.00'),
  sendOverdueReminders: (...a: unknown[]) => sendOverdueMock(...a),
  sendInvoiceReminder: (...a: unknown[]) => sendSingleMock(...a),
  TEMPLATES: { invoice_overdue_ar: { body: 'مرحباً {customer_name}، المبلغ {amount}' } },
}));

type Row = Record<string, unknown>;
type Op = { op: string; col?: string; val?: unknown };

function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Op[] }> = [];
  const rpcResults = new Map<string, { data: unknown; error: unknown }>();
  const from = (table: string) => {
    const ops: Op[] = [];
    calls.push({ table, ops });
    const rows = () =>
      (db[table] || []).filter((r) =>
        ops.every((o) => {
          const get = (col: string): unknown => {
            let cur: unknown = r;
            for (const k of col.split('.')) {
              if (cur == null) break;
              cur = (cur as Record<string, unknown>)[k];
            }
            return cur;
          };
          if (o.op === 'eq') return get(o.col!) === o.val;
          if (o.op === 'in') return (o.val as unknown[]).includes(get(o.col!));
          if (o.op === 'lt') return String(get(o.col!)) < String(o.val);
          if (o.op === 'gte') return String(get(o.col!)) >= String(o.val);
          if (o.op === 'lte') return String(get(o.col!)) <= String(o.val);
          if (o.op === 'ilike') return String(get(o.col!) ?? '').toLowerCase().includes(String(o.val).toLowerCase());
          return true;
        })
      );
    const api: TestBuilder = {
      select: () => api,
      eq: (col: string, val: unknown) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: unknown) => { ops.push({ op: 'in', col, val }); return api; },
      ilike: (col: string, val: unknown) => { ops.push({ op: 'ilike', col, val }); return api; },
      order: () => api, limit: () => api, range: () => api, is: () => api, neq: () => api,
      or: () => api, lt: (col: string, val: unknown) => { ops.push({ op: 'lt', col, val }); return api; },
      gte: (col: string, val: unknown) => { ops.push({ op: 'gte', col, val }); return api; },
      lte: (col: string, val: unknown) => { ops.push({ op: 'lte', col, val }); return api; },
      insert: (payload: Row | Row[]) => { db[table] = [...(db[table] || []), ...(Array.isArray(payload) ? payload : [payload])]; return api; },
      update: () => api, delete: () => api,
      maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
      single: async () => ({ data: rows()[0] || null, error: rows()[0] ? null : { message: 'not found' } }),
      then: <T1 = { data: unknown; error: unknown; count?: number }, T2 = never>(
        ok?: ((v: { data: unknown; error: unknown; count?: number }) => T1 | PromiseLike<T1>) | null,
        fail?: ((e: unknown) => T2 | PromiseLike<T2>) | null,
      ) => Promise.resolve({ data: rows(), error: null, count: rows().length }).then(ok ?? undefined, fail ?? undefined),
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

import { GET as remindersGET, POST as remindersPOST } from '@/app/api/reminders/route';
import { GET as activateGET, POST as activatePOST } from '@/app/api/subscription/activate-code/route';
import { GET as cleanupGET, POST as cleanupPOST } from '@/app/api/auth/cleanup-inactive/route';
import { GET as compUsersGET } from '@/app/api/company/users/route';
import { GET as compUserGET, PUT as compUserPUT } from '@/app/api/company/users/[id]/route';
import { POST as resetPOST, DELETE as resetDELETE } from '@/app/api/company/reset/route';
import { resetRateLimits } from '@/lib/memory-rate-limit';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';

const C1 = 'company-1';
const U1 = '00000000-0000-4000-8000-00000000d0d1';
const U2 = '00000000-0000-4000-8000-00000000d0e1';

function req(role = 'admin', method = 'GET', url = 'http://localhost/x', body?: Row, extraHeaders: Record<string, string> = {}) {
  const token = createToken('u1', role, 0);
  return { url, method, nextUrl: new URL(url), headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : (extraHeaders[k] ?? null) },
    cookies: { get: () => undefined }, json: async () => body } as unknown as NextRequest;
}

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, name: 'مدير', email: 'admin@example.com', is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true, name: 'شركة' }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', name: 'احترافي', features_modules: {} } }],
    invoices: [], reminder_log: [], activation_codes: [], subscription_plans: [], audit_log: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { resetRateLimits(); sendOverdueMock.mockReset(); sendSingleMock.mockReset(); sendVerificationEmailMock.mockReset(); mockDb = makeDb(baseDb()); });

describe('reminders GET', () => {
  test('returns overdue, upcoming, and recent reminders', async () => {
    mockDb = makeDb({ ...baseDb(), invoices: [
      { id: 'i1', company_id: C1, number: 1, total: 100, due_date: new Date(Date.now() - 86400000).toISOString().split('T')[0], status: 'unpaid', contacts: { name: 'عميل', phone: '05', email: 'c@e.com' } },
    ], reminder_log: [{ id: 'r1', company_id: C1, sent_at: '2026-01-01' }] });
    const res = await remindersGET(req('admin', 'GET', 'http://localhost/api/reminders'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.overdueCount).toBe(1);
    expect(json.data.overdue[0].has_phone).toBe(true);
    expect(json.data.templates.length).toBeGreaterThan(0);
  });
});

describe('reminders POST', () => {
  test('rejects a non-manager role', async () => {
    mockDb = makeDb({ ...baseDb(), users: [{ id: 'u1', company_id: C1, name: 'م', email: 'a@e.com', is_active: true, token_version: 0, role: 'accountant' }] });
    const res = await remindersPOST(req('accountant', 'POST', 'http://localhost/x', { action: 'send_all_overdue' }));
    expect(res.status).toBe(403);
  });

  test('sends all overdue reminders', async () => {
    sendOverdueMock.mockResolvedValue({ sent: 3 });
    const res = await remindersPOST(req('admin', 'POST', 'http://localhost/x', { action: 'send_all_overdue' }));
    expect(res.status).toBe(200);
    expect(sendOverdueMock).toHaveBeenCalled();
  });

  test('sends a single reminder', async () => {
    sendSingleMock.mockResolvedValue({ ok: true });
    const res = await remindersPOST(req('admin', 'POST', 'http://localhost/x', { action: 'send_single', invoice_id: '00000000-0000-4000-8000-00000000e0f1' }));
    expect(res.status).toBe(200);
  });

  test('builds a whatsapp/email preview fallback', async () => {
    mockDb = makeDb({ ...baseDb(), invoices: [{ id: '00000000-0000-4000-8000-00000000e0f1', company_id: C1, number: 5, total: 100, due_date: new Date().toISOString().split('T')[0], contacts: { name: 'عميل', phone: '0501234567', email: 'c@e.com' } }] });
    const res = await remindersPOST(req('admin', 'POST', 'http://localhost/x', { action: 'preview', invoice_id: '00000000-0000-4000-8000-00000000e0f1' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.whatsapp.url).toContain('wa.me/');
  });

  test('rejects an invalid action payload', async () => {
    const res = await remindersPOST(req('admin', 'POST', 'http://localhost/x', { action: 'bogus' }));
    expect(res.status).toBe(400);
  });
});

describe('subscription/activate-code', () => {
  test('POST redeems a valid code (plan)', async () => {
    mockDb.rpcResults.set('redeem_activation_code', { data: { type: 'plan', plan_code: 'pro' }, error: null });
    const res = await activatePOST(req('admin', 'POST', 'http://localhost/x', { code: 'AB12-CD34-EF56-7890' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.message).toContain('الباقة');
  });

  test('POST redeems an add-on code', async () => {
    mockDb.rpcResults.set('redeem_activation_code', { data: { type: 'addon', addon_type: 'extra_user' }, error: null });
    const res = await activatePOST(req('admin', 'POST', 'http://localhost/x', { code: 'AB12-CD34-EF56-7890' }));
    const json = await res.json();
    expect(json.data.message).toContain('الإضافة');
  });

  test('POST rejects an invalid code and maps RPC errors', async () => {
    const res1 = await activatePOST(req('admin', 'POST', 'http://localhost/x', { code: 'bad!' }));
    expect(res1.status).toBe(400);
    mockDb.rpcResults.set('redeem_activation_code', { data: null, error: { message: 'expired code' } });
    const res2 = await activatePOST(req('admin', 'POST', 'http://localhost/x', { code: 'AB12-CD34-EF56-7890' }));
    expect(res2.status).toBe(400);
    mockDb.rpcResults.set('redeem_activation_code', { data: null, error: { message: 'another company' } });
    const res3 = await activatePOST(req('admin', 'POST', 'http://localhost/x', { code: 'AB12-CD34-EF56-7890' }));
    expect(res3.status).toBe(403);
  });

  test('GET checks a valid plan code', async () => {
    mockDb = makeDb({ ...baseDb(), activation_codes: [{ id: 'a1', company_id: C1, code_hash: 'x', plan_code: 'pro', is_used: false }], subscription_plans: [{ code: 'pro', name: 'احترافي', is_active: true }] });
    const res = await activateGET(req('admin', 'GET', 'http://localhost/x?code=AB12-CD34-EF56-7890'));
    expect(res.status).toBe(200);
  });

  test('GET reports an expired code', async () => {
    mockDb = makeDb({ ...baseDb(), activation_codes: [{ id: 'a1', company_id: C1, code_hash: 'x', plan_code: 'pro', is_used: false, expires_at: new Date(Date.now() - 100000).toISOString() }] });
    const res = await activateGET(req('admin', 'GET', 'http://localhost/x?code=AB12-CD34-EF56-7890'));
    const json = await res.json();
    expect(json.data.valid).toBe(false);
  });
});

describe('auth/cleanup-inactive', () => {
  function cronReq(method = 'GET', secret?: string) {
    return { url: 'http://localhost/x', method, nextUrl: new URL('http://localhost/x'),
      headers: { get: (k: string) => k === 'x-cron-secret' ? (secret ?? null) : (k === 'authorization' ? null : null) },
      cookies: { get: () => undefined }, json: async () => undefined } as unknown as NextRequest;
  }

  test('GET deactivates expired companies when authorized', async () => {
    mockDb.rpcResults.set('deactivate_inactive_expired_companies', { data: { deactivated_companies: 2, deactivated_users: 5 }, error: null });
    const res = await cleanupGET(cronReq('GET', process.env.CRON_SECRET));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.deactivatedCompanies).toBe(2);
  });

  test('GET rejects a missing or wrong secret', async () => {
    const res1 = await cleanupGET(cronReq('GET'));
    expect(res1.status).toBe(401);
    const res2 = await cleanupGET(cronReq('GET', 'wrong'));
    expect(res2.status).toBe(401);
  });

  test('POST deactivates when authorized', async () => {
    mockDb.rpcResults.set('deactivate_inactive_expired_companies', { data: { deactivated_companies: 1, deactivated_users: 1 }, error: null });
    const res = await cleanupPOST(cronReq('POST', process.env.CRON_SECRET));
    expect(res.status).toBe(200);
  });
});

describe('company/users GET', () => {
  test('lists company users with plan limits', async () => {
    const res = await compUsersGET(req('admin', 'GET', 'http://localhost/api/company/users'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.users).toHaveLength(1);
    expect(json.data.maxUsers).toBe(1);
  });
});

describe('company/users/[id]', () => {
  test('GET returns a user and 404 when missing', async () => {
    mockDb = makeDb({ ...baseDb(), users: [...baseDb().users, { id: U1, company_id: C1, name: 'م', email: 'a@e.com', role: 'accountant', is_active: true }] });
    const res = await compUserGET(req('admin', 'GET', `http://localhost/x/${U1}`), { params: Promise.resolve({ id: U1 }) });
    expect(res.status).toBe(200);
    const res2 = await compUserGET(req('admin', 'GET', `http://localhost/x/${U2}`), { params: Promise.resolve({ id: U2 }) });
    expect(res2.status).toBe(404);
  });

  test('PUT updates a user name', async () => {
    mockDb = makeDb({ ...baseDb(), users: [...baseDb().users, { id: U1, company_id: C1, name: 'م', email: 'a@e.com', role: 'accountant', is_active: true, token_version: 0 }] });
    const res = await compUserPUT(req('admin', 'PUT', 'http://localhost/x', { name: 'اسم جديد' }), { params: Promise.resolve({ id: U1 }) });
    expect(res.status).toBe(200);
  });

  test('PUT blocks self-demotion and self-disable', async () => {
    mockDb = makeDb({ ...baseDb(), users: [{ id: 'u1', company_id: C1, name: 'مدير', email: 'a@e.com', role: 'admin', is_active: true, token_version: 0 }] });
    const res1 = await compUserPUT(req('admin', 'PUT', 'http://localhost/x', { role: 'accountant' }), { params: Promise.resolve({ id: 'u1' }) });
    expect(res1.status).toBe(400);
    const res2 = await compUserPUT(req('admin', 'PUT', 'http://localhost/x', { is_active: false }), { params: Promise.resolve({ id: 'u1' }) });
    expect(res2.status).toBe(400);
  });

  test('PUT blocks promoting to admin when one already exists', async () => {
    mockDb = makeDb({ ...baseDb(), users: [
      { id: 'u1', company_id: C1, name: 'مدير', email: 'a@e.com', role: 'admin', is_active: true, token_version: 0 },
      { id: U1, company_id: C1, name: 'م', email: 'b@e.com', role: 'accountant', is_active: true, token_version: 0 },
    ] });
    const res = await compUserPUT(req('admin', 'PUT', 'http://localhost/x', { role: 'admin' }), { params: Promise.resolve({ id: U1 }) });
    expect(res.status).toBe(403);
  });

  test('PUT rejects a duplicate email', async () => {
    mockDb = makeDb({ ...baseDb(), users: [
      { id: 'u1', company_id: C1, name: 'مدير', email: 'a@e.com', role: 'admin', is_active: true, token_version: 0 },
      { id: U1, company_id: C1, name: 'م', email: 'b@e.com', role: 'accountant', is_active: true, token_version: 0 },
    ] });
    const res = await compUserPUT(req('admin', 'PUT', 'http://localhost/x', { email: 'a@e.com' }), { params: Promise.resolve({ id: U1 }) });
    expect(res.status).toBe(400);
  });
});

describe('company/reset (ميزة ملغاة نهائياً)', () => {
  test('POST is a 410 tombstone regardless of payload', async () => {
    mockDb.rpcResults.set('reset_company_business_data', { data: { cleared: true }, error: null });
    const res = await resetPOST(req('admin', 'POST', 'http://localhost/x', { action: 'confirm', code: '123456' }));
    expect(res.status).toBe(410);
    expect(mockDb.calls.length).toBe(0);
  });

  test('DELETE is a 410 tombstone too', async () => {
    mockDb.rpcResults.set('cancel_telegram_reset_session_atomic', { data: { cancelled: true }, error: null });
    const res = await resetDELETE(req('admin', 'DELETE', 'http://localhost/x'));
    expect(res.status).toBe(410);
  });
});
