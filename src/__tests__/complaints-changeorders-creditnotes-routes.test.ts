/**
 * Route-boundary tests for complaints/[id], change-orders/[id],
 * credit-notes (list/create), and credit-notes/[id].
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

import { DELETE as compDELETE, PATCH as compPATCH } from '@/app/api/complaints/[id]/route';
import { GET as coGET, PATCH as coPATCH, DELETE as coDELETE } from '@/app/api/change-orders/[id]/route';
import { GET as cnGET, POST as cnPOST } from '@/app/api/credit-notes/route';
import { GET as cnDetailGET, DELETE as cnDetailDELETE } from '@/app/api/credit-notes/[id]/route';
import { resetRateLimits } from '@/lib/memory-rate-limit';

const C1 = 'company-1';
const ID1 = '00000000-0000-4000-8000-00000000f0d1';

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
      subscription_plans: { code: 'enterprise', features_modules: { complaints: true, projects: true, credit_notes: true } } }],
    complaints: [], change_orders: [], credit_notes: [], credit_note_items: [],
    contacts: [], invoices: [], projects: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { resetRateLimits(); mockDb = makeDb(baseDb()); });

describe('complaints/[id]', () => {
  test('DELETE archives a complaint and maps errors', async () => {
    mockDb.rpcResults.set('archive_company_complaint_atomic', { data: { archived: true }, error: null });
    const res = await compDELETE(req('admin', 'DELETE', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
    mockDb.rpcResults.set('archive_company_complaint_atomic', { data: null, error: { message: 'غير موجود' } });
    const res2 = await compDELETE(req('admin', 'DELETE', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res2.status).toBe(404);
  });

  test('DELETE rejects an invalid id', async () => {
    const res = await compDELETE(req('admin', 'DELETE', 'http://localhost/x'), { params: Promise.resolve({ id: 'bad' }) });
    expect(res.status).toBe(400);
  });

  test('PATCH updates a complaint and maps in-progress 409', async () => {
    mockDb.rpcResults.set('update_company_complaint_atomic', { data: { id: ID1 }, error: null });
    const res = await compPATCH(req('admin', 'PATCH', 'http://localhost/x', { subject: 'محدث' }), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
    mockDb.rpcResults.set('update_company_complaint_atomic', { data: null, error: { message: 'قيد المعالجة' } });
    const res2 = await compPATCH(req('admin', 'PATCH', 'http://localhost/x', { subject: 'محدث' }), { params: Promise.resolve({ id: ID1 }) });
    expect(res2.status).toBe(409);
  });
});

describe('change-orders/[id]', () => {
  test('GET returns an order', async () => {
    mockDb = makeDb({ ...baseDb(), change_orders: [{ id: ID1, company_id: C1, title: 'تغيير' }] });
    const res = await coGET(req('admin', 'GET', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });

  test('GET returns 404 when missing', async () => {
    const res = await coGET(req('admin', 'GET', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(404);
  });

  test('PATCH updates an order via RPC', async () => {
    mockDb = makeDb({ ...baseDb(), change_orders: [{ id: ID1, company_id: C1, title: 'old' }] });
    mockDb.rpcResults.set('update_change_order_atomic', { data: { id: ID1 }, error: null });
    const res = await coPATCH(req('admin', 'PATCH', 'http://localhost/x', { title: 'new' }), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });

  test('PATCH rejects no changes', async () => {
    mockDb = makeDb({ ...baseDb(), change_orders: [{ id: ID1, company_id: C1, title: 'x' }] });
    const res = await coPATCH(req('admin', 'PATCH', 'http://localhost/x', { title: 'x' }), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(400);
  });

  test('DELETE cancels an order', async () => {
    mockDb = makeDb({ ...baseDb(), change_orders: [{ id: ID1, company_id: C1, title: 'x' }] });
    mockDb.rpcResults.set('cancel_change_order_atomic', { data: { id: ID1 }, error: null });
    const res = await coDELETE(req('admin', 'DELETE', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });
});

describe('credit-notes', () => {
  test('GET lists credit notes with names', async () => {
    mockDb = makeDb({ ...baseDb(), credit_notes: [{ id: ID1, company_id: C1, contact_id: 'c1', invoice_id: 'i1', project_id: 'p1' }],
      contacts: [{ id: 'c1', name: 'عميل', company_id: C1 }], invoices: [{ id: 'i1', number: 'INV-1', company_id: C1 }], projects: [{ id: 'p1', name: 'مشروع', company_id: C1 }] });
    const res = await cnGET(req('admin', 'GET', 'http://localhost/api/credit-notes'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.credit_notes[0].contact_name).toBe('عميل');
    expect(json.data.credit_notes[0].project_name).toBe('مشروع');
  });

  test('GET rejects an invalid project/invoice filter', async () => {
    const res = await cnGET(req('admin', 'GET', 'http://localhost/api/credit-notes?projectId=bad'));
    expect(res.status).toBe(400);
  });

  test('POST creates a credit note', async () => {
    mockDb.rpcResults.set('create_credit_note_atomic', { data: { id: ID1 }, error: null });
    const res = await cnPOST(req('admin', 'POST', 'http://localhost/api/credit-notes', {
      reason: 'مرتجع', items: [{ description: 'بند', quantity: 1, unit_price: 100 }], date: '2026-01-01',
    }));
    expect(res.status).toBe(201);
  });

  test('POST rejects missing reason and invalid items', async () => {
    const res1 = await cnPOST(req('admin', 'POST', 'http://localhost/api/credit-notes', {}));
    expect(res1.status).toBe(400);
    const res2 = await cnPOST(req('admin', 'POST', 'http://localhost/api/credit-notes', { reason: 'سبب', items: [] }));
    expect(res2.status).toBe(400);
  });
});

describe('credit-notes/[id]', () => {
  test('GET returns a credit note with items and names', async () => {
    mockDb = makeDb({ ...baseDb(), credit_notes: [{ id: ID1, company_id: C1, contact_id: 'c1', invoice_id: 'i1', project_id: 'p1' }],
      credit_note_items: [{ id: 'it1', credit_note_id: ID1, company_id: C1 }],
      contacts: [{ id: 'c1', name: 'عميل', company_id: C1 }], invoices: [{ id: 'i1', number: 'INV-1', company_id: C1 }], projects: [{ id: 'p1', name: 'مشروع', company_id: C1 }] });
    const res = await cnDetailGET(req('admin', 'GET', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.items).toHaveLength(1);
    expect(json.data.invoice_number).toBe('INV-1');
  });

  test('GET returns 404 when missing and rejects invalid id', async () => {
    const res = await cnDetailGET(req('admin', 'GET', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(404);
    const res2 = await cnDetailGET(req('admin', 'GET', 'http://localhost/x'), { params: Promise.resolve({ id: 'bad' }) });
    expect(res2.status).toBe(400);
  });

  test('DELETE cancels a credit note', async () => {
    mockDb.rpcResults.set('cancel_credit_note_atomic', { data: { cancelled: true }, error: null });
    const res = await cnDetailDELETE(req('admin', 'DELETE', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });
});
