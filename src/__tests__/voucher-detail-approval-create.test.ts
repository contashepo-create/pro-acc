/**
 * Route-boundary tests for vouchers/disbursement/[id], vouchers/receipt/[id],
 * approvals POST.
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

import { PUT as disbPUT, DELETE as disbDELETE } from '@/app/api/vouchers/disbursement/[id]/route';
import { PUT as rcptPUT, DELETE as rcptDELETE } from '@/app/api/vouchers/receipt/[id]/route';
import { POST as apprPOST } from '@/app/api/approvals/route';
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
      subscription_plans: { code: 'enterprise', features_modules: { journal: true, approvals: true } } }],
  } as Record<string, Row[]>;
}

beforeEach(() => { resetRateLimits(); mockDb = makeDb(baseDb()); });

describe('vouchers/disbursement/[id]', () => {
  test('PUT updates a disbursement', async () => {
    mockDb.rpcResults.set('update_voucher_disbursement_atomic', { data: { id: ID1 }, error: null });
    const res = await disbPUT(req('admin', 'PUT', 'http://localhost/x', { reason: 'تعديل' }), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });

  test('PUT rejects an invalid payload', async () => {
    const res = await disbPUT(req('admin', 'PUT', 'http://localhost/x', { amount: -5 }), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(400);
  });

  test('DELETE cancels a disbursement', async () => {
    mockDb.rpcResults.set('cancel_voucher_disbursement_atomic', { data: { id: ID1 }, error: null });
    const res = await disbDELETE(req('admin', 'DELETE', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });
});

describe('vouchers/receipt/[id]', () => {
  test('PUT updates a receipt', async () => {
    mockDb.rpcResults.set('update_voucher_receipt_atomic', { data: { id: ID1 }, error: null });
    const res = await rcptPUT(req('admin', 'PUT', 'http://localhost/x', { reason: 'تعديل' }), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });

  test('DELETE cancels a receipt', async () => {
    mockDb.rpcResults.set('cancel_voucher_receipt_atomic', { data: { id: ID1 }, error: null });
    const res = await rcptDELETE(req('admin', 'DELETE', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });
});

describe('approvals POST', () => {
  test('creates an approval request', async () => {
    mockDb.rpcResults.set('create_approval_request_atomic', { data: { id: ID1 }, error: null });
    const res = await apprPOST(req('admin', 'POST', 'http://localhost/x', {
      entity_type: 'journal_entry', entity_id: ID1, description: 'اعتماد',
    }));
    expect(res.status).toBe(201);
  });

  test('rejects an invalid payload', async () => {
    const res = await apprPOST(req('admin', 'POST', 'http://localhost/x', { entity_type: 'bogus', entity_id: 'x' }));
    expect(res.status).toBe(400);
  });
});
