/**
 * Route-boundary tests for messages, categories, notifications/[id],
 * support, dashboard, pos/terminals.
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

import { GET as msgGET, POST as msgPOST } from '@/app/api/messages/route';
import { GET as catGET, POST as catPOST } from '@/app/api/categories/route';
import { PUT as notifPUT, DELETE as notifDELETE } from '@/app/api/notifications/[id]/route';
import { GET as supGET, POST as supPOST } from '@/app/api/support/route';
import { GET as dashGET } from '@/app/api/dashboard/route';
import { GET as termGET, POST as termPOST } from '@/app/api/pos/terminals/route';
import { resetRateLimits } from '@/lib/memory-rate-limit';

const C1 = 'company-1';
const ID1 = '00000000-0000-4000-8000-00000000f0f1';

function req(role = 'admin', method = 'GET', url = 'http://localhost/x', body?: any) {
  const token = createToken('u1', role, 0);
  return { url, method, nextUrl: new URL(url), headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined }, json: async () => body } as any;
}

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, name: 'م', email: 'admin@example.com', is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: { messages: true, dashboard: true, reports: true, pos: true, support: true } } }],
    messages: [], transaction_categories: [], notifications: [], support_tickets: [],
    projects: [], audit_log: [], pos_terminals: [], branches: [], banks_safes: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { resetRateLimits(); mockDb = makeDb(baseDb()); });

describe('messages', () => {
  test('GET lists messages', async () => {
    mockDb = makeDb({ ...baseDb(), messages: [{ id: ID1, company_id: C1, subject: 'مرحباً' }] });
    const res = await msgGET(req('admin', 'GET', 'http://localhost/api/messages'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.messages).toHaveLength(1);
  });

  test('POST sends a message', async () => {
    mockDb.rpcResults.set('send_company_message_atomic', { data: { id: ID1 }, error: null });
    const res = await msgPOST(req('admin', 'POST', 'http://localhost/x', { subject: 'مرحباً', body: 'نص' }));
    expect(res.status).toBe(201);
  });
});

describe('categories', () => {
  test('GET lists categories with account', async () => {
    mockDb = makeDb({ ...baseDb(), transaction_categories: [{ id: ID1, company_id: C1, name: 'نقل', accounts: { code: '5100', name: 'مصاريف' } }] });
    const res = await catGET(req('admin', 'GET', 'http://localhost/api/categories'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.categories[0].account_code).toBe('5100');
  });

  test('POST creates a category', async () => {
    const res = await catPOST(req('admin', 'POST', 'http://localhost/x', { name: 'نقل', type: 'expense', account_id: ID1 }));
    expect(res.status).toBe(201);
  });

  test('POST rejects missing fields', async () => {
    const res = await catPOST(req('admin', 'POST', 'http://localhost/x', { name: 'نقل' }));
    expect(res.status).toBe(400);
  });
});

describe('notifications/[id]', () => {
  test('PUT marks a notification read', async () => {
    mockDb = makeDb({ ...baseDb(), notifications: [{ id: ID1, company_id: C1, is_read: false }] });
    const res = await notifPUT(req('admin', 'PUT', 'http://localhost/x', { isRead: true }), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });

  test('PUT returns 404 when missing', async () => {
    const res = await notifPUT(req('admin', 'PUT', 'http://localhost/x', { isRead: true }), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(404);
  });

  test('DELETE removes a notification', async () => {
    mockDb = makeDb({ ...baseDb(), notifications: [{ id: ID1, company_id: C1 }] });
    const res = await notifDELETE(req('admin', 'DELETE', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });

  test('PUT rejects an invalid id', async () => {
    const res = await notifPUT(req('admin', 'PUT', 'http://localhost/x', { isRead: true }), { params: Promise.resolve({ id: 'bad' }) });
    expect(res.status).toBe(400);
  });
});

describe('support', () => {
  test('GET lists the caller tickets', async () => {
    mockDb = makeDb({ ...baseDb(), support_tickets: [{ id: ID1, company_id: C1, user_id: 'u1', subject: 'مشكلة' }] });
    const res = await supGET(req('admin', 'GET', 'http://localhost/api/support'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.tickets).toHaveLength(1);
  });

  test('POST opens a support ticket', async () => {
    mockDb.rpcResults.set('create_support_ticket_atomic', { data: { id: ID1 }, error: null });
    const res = await supPOST(req('admin', 'POST', 'http://localhost/x', { subject: 'مشكلة', message: 'نص طويل كافٍ' }));
    expect(res.status).toBe(201);
  });

  test('POST rejects an external attachment', async () => {
    const res = await supPOST(req('admin', 'POST', 'http://localhost/x', { subject: 'مشكلة', message: 'نص طويل كافٍ', attachment_url: 'https://evil.com/x' }));
    expect(res.status).toBe(400);
  });
});

describe('dashboard GET', () => {
  test('returns the financial dashboard', async () => {
    mockDb.rpcResults.set('get_financial_summary', { data: { revenue: 100, expenses: 40, accountsReceivable: 20, accountsPayable: 10, cashBalance: 30 }, error: null });
    mockDb.rpcResults.set('get_assistant_company_snapshot', { data: { totalProjects: 1, activeProjects: 1, overdueInvoiceCount: 2, overdueInvoices: 50 }, error: null });
    const res = await dashGET(req('admin', 'GET', 'http://localhost/api/dashboard'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.netProfit).toBe(60);
  });
});

describe('pos/terminals', () => {
  test('GET lists terminals', async () => {
    mockDb = makeDb({ ...baseDb(), pos_terminals: [{ id: ID1, company_id: C1, code: 'T1', banks_safes: { name: 'خزينة' } }] });
    const res = await termGET(req('admin', 'GET', 'http://localhost/api/pos/terminals'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.terminals[0].bank_safe_name).toBe('خزينة');
  });

  test('POST creates a terminal', async () => {
    mockDb.rpcResults.set('create_pos_terminal_atomic', { data: { id: ID1 }, error: null });
    const res = await termPOST(req('admin', 'POST', 'http://localhost/x', { code: 'T1', name: 'طرفية', bank_safe_id: ID1 }));
    expect(res.status).toBe(201);
  });
});
