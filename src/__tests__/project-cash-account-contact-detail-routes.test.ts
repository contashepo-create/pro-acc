/**
 * Route-boundary tests for projects/[id], cash/[id], accounts/[id],
 * contacts/[id], approvals (list), notifications/smart.
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
          if (o.op === 'neq') return get(o.col!) !== o.val;
          if (o.op === 'lt') return String(get(o.col!)) < String(o.val);
          return true;
        })
      );
    const api: any = {
      select: () => api,
      eq: (col: string, val: any) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: any) => { ops.push({ op: 'in', col, val }); return api; },
      neq: (col: string, val: any) => { ops.push({ op: 'neq', col, val }); return api; },
      order: () => api, limit: () => api, range: () => api, is: () => api,
      or: () => api, lt: (col: string, val: any) => { ops.push({ op: 'lt', col, val }); return api; },
      gte: () => api, lte: () => api,
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

import { GET as projGET, PUT as projPUT, DELETE as projDELETE } from '@/app/api/projects/[id]/route';
import { GET as cashGET, PUT as cashPUT, DELETE as cashDELETE } from '@/app/api/cash/[id]/route';
import { GET as accGET, PUT as accPUT } from '@/app/api/accounts/[id]/route';
import { GET as conGET, PUT as conPUT, DELETE as conDELETE } from '@/app/api/contacts/[id]/route';
import { GET as apprGET } from '@/app/api/approvals/route';
import { GET as smartGET } from '@/app/api/notifications/smart/route';
import { resetRateLimits } from '@/lib/memory-rate-limit';

const C1 = 'company-1';
const ID1 = '00000000-0000-4000-8000-00000000f0f1';
const ID2 = '00000000-0000-4000-8000-00000000f0f2';

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
      subscription_plans: { code: 'enterprise', features_modules: { projects: true, cash: true, accounts: true, contacts: true, approvals: true, dashboard: true } } }],
    projects: [], boq_items: [], cash_transactions: [], accounts: [], contacts: [],
    approval_requests: [], invoices: [], journal_lines: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { resetRateLimits(); mockDb = makeDb(baseDb()); });

describe('projects/[id]', () => {
  test('GET returns a project with boq and 404 when missing', async () => {
    mockDb = makeDb({ ...baseDb(), projects: [{ id: ID1, company_id: C1, name: 'مشروع', contacts: { name: 'عميل' } }], boq_items: [] });
    const res = await projGET(req('admin', 'GET', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.client_name).toBe('عميل');
  });

  test('GET returns 404 for unknown project', async () => {
    const res = await projGET(req('admin', 'GET', `http://localhost/x/${ID2}`), { params: Promise.resolve({ id: ID2 }) });
    expect(res.status).toBe(404);
  });

  test('PUT updates a project', async () => {
    mockDb = makeDb({ ...baseDb(), projects: [{ id: ID1, company_id: C1, name: 'مشروع' }] });
    mockDb.rpcResults.set('update_project_atomic', { data: { id: ID1 }, error: null });
    const res = await projPUT(req('admin', 'PUT', 'http://localhost/x', { name: 'مشروع ب' }), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });

  test('DELETE cancels an empty project', async () => {
    mockDb = makeDb({ ...baseDb(), projects: [{ id: ID1, company_id: C1, name: 'مشروع' }] });
    mockDb.rpcResults.set('cancel_empty_project_atomic', { data: { id: ID1 }, error: null });
    const res = await projDELETE(req('admin', 'DELETE', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });
});

describe('cash/[id]', () => {
  test('GET returns a transaction with names and 404 when missing', async () => {
    mockDb = makeDb({ ...baseDb(), cash_transactions: [{ id: ID1, company_id: C1, banks_safes: { name: 'بنك' }, journal_entries: { number: 5 } }] });
    const res = await cashGET(req('admin', 'GET', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.bank_safe_name).toBe('بنك');
  });

  test('GET returns 404 for unknown transaction', async () => {
    const res = await cashGET(req('admin', 'GET', `http://localhost/x/${ID2}`), { params: Promise.resolve({ id: ID2 }) });
    expect(res.status).toBe(404);
  });

  test('PUT updates the note', async () => {
    mockDb.rpcResults.set('update_cash_transaction_note', { data: { id: ID1 }, error: null });
    const res = await cashPUT(req('admin', 'PUT', 'http://localhost/x', { reason: 'تعديل' }), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });

  test('DELETE cancels a transaction', async () => {
    mockDb.rpcResults.set('cancel_cash_transaction', { data: { id: ID1 }, error: null });
    const res = await cashDELETE(req('admin', 'DELETE', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });
});

describe('accounts/[id]', () => {
  test('GET returns an account with children and 404 when missing', async () => {
    mockDb = makeDb({ ...baseDb(), accounts: [
      { id: ID1, company_id: C1, code: '1000', name: 'أصول', type: 'asset' },
      { id: ID2, company_id: C1, parent_id: ID1, code: '1110', name: 'نقد', type: 'asset' },
    ] });
    const res = await accGET(req('admin', 'GET', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.children).toHaveLength(1);
  });

  test('GET returns 404 for unknown account', async () => {
    const res = await accGET(req('admin', 'GET', `http://localhost/x/${ID2}`), { params: Promise.resolve({ id: ID2 }) });
    expect(res.status).toBe(404);
  });

  test('PUT updates an account', async () => {
    mockDb = makeDb({ ...baseDb(), accounts: [{ id: ID1, company_id: C1, code: '1000', name: 'أصول', type: 'asset' }] });
    mockDb.rpcResults.set('update_account_atomic', { data: { id: ID1 }, error: null });
    const res = await accPUT(req('admin', 'PUT', 'http://localhost/x', { name: 'أصول محدثة' }), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });
});

describe('contacts/[id]', () => {
  test('GET returns a contact and 404 when missing', async () => {
    mockDb = makeDb({ ...baseDb(), contacts: [{ id: ID1, company_id: C1, name: 'عميل', type: 'client', is_active: true }] });
    const res = await conGET(req('admin', 'GET', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });

  test('GET returns 404 for unknown contact', async () => {
    const res = await conGET(req('admin', 'GET', `http://localhost/x/${ID2}`), { params: Promise.resolve({ id: ID2 }) });
    expect(res.status).toBe(404);
  });

  test('PUT updates a contact', async () => {
    mockDb.rpcResults.set('update_contact_atomic', { data: { id: ID1 }, error: null });
    const res = await conPUT(req('admin', 'PUT', 'http://localhost/x', { name: 'عميل ب' }), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });

  test('DELETE deactivates a contact', async () => {
    mockDb.rpcResults.set('deactivate_contact_atomic', { data: { id: ID1 }, error: null });
    const res = await conDELETE(req('admin', 'DELETE', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });
});

describe('approvals GET', () => {
  test('lists approvals', async () => {
    mockDb = makeDb({ ...baseDb(), approval_requests: [{ id: ID1, company_id: C1, status: 'pending', entity_type: 'journal_entry', requester: { name: 'م' }, approver: { name: 'أ' } }] });
    const res = await apprGET(req('admin', 'GET', 'http://localhost/api/approvals'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.requests[0].requester_name).toBe('م');
  });

  test('rejects an invalid status', async () => {
    const res = await apprGET(req('admin', 'GET', 'http://localhost/api/approvals?status=bogus'));
    expect(res.status).toBe(400);
  });
});

describe('notifications/smart GET', () => {
  test('returns smart notifications', async () => {
    mockDb = makeDb({ ...baseDb(), invoices: [{ id: ID1, company_id: C1, total: 100, due_date: new Date(Date.now() - 86400000).toISOString().split('T')[0], status: 'unpaid', contacts: { name: 'عميل' } }] });
    const res = await smartGET(req('admin', 'GET', 'http://localhost/api/notifications/smart'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.notifications.length).toBeGreaterThan(0);
  });
});
