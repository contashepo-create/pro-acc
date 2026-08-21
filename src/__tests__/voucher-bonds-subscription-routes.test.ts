/**
 * Route-boundary tests for previously-uncovered routes: bonds GET,
 * vouchers/unpaid-invoices, vouchers/advance-report, subscription/activate-code.
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
          if (o.op === 'neq') return r[o.col!] !== o.val;
          if (o.op === 'is') return o.val === null ? r[o.col!] == null : r[o.col!] === o.val;
          return true;
        })
      );
    const api: any = {
      select: () => api,
      eq: (col: string, val: any) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: any) => { ops.push({ op: 'in', col, val }); return api; },
      neq: (col: string, val: any) => { ops.push({ op: 'neq', col, val }); return api; },
      is: (col: string, val: any) => { ops.push({ op: 'is', col, val }); return api; },
      gte: () => api, lte: () => api, or: () => api, order: () => api, limit: () => api, range: () => api,
      maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
      single: async () => ({ data: rows()[0] || null, error: rows()[0] ? null : { message: 'not found' } }),
      then: (ok: any, fail: any) =>
        Promise.resolve({ data: rows(), error: null, count: rows().length }).then(ok, fail),
    };
    return api;
  };
  return {
    from, calls, rpcResults,
    rpc: async (name: string) => rpcResults.get(name) || { data: [], error: null },
  };
}

let mockDb: ReturnType<typeof makeDb>;
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));

import { GET as bondsGET } from '@/app/api/bonds/route';
import { GET as unpaidInvoicesGET } from '@/app/api/vouchers/unpaid-invoices/route';
import { GET as advanceReportGET } from '@/app/api/vouchers/advance-report/route';
import { POST as activateCodePOST } from '@/app/api/subscription/activate-code/route';

const C1 = 'company-1';
const CLIENT = '00000000-0000-4000-8000-000000000c01';
function req(role = 'admin', method = 'GET', url = 'http://localhost/x', body?: any) {
  const token = createToken('u1', role, 0);
  return { url, method, headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined }, json: async () => body } as any;
}

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: { projects: true, reports: true, bonds: true, receipts: true } } }],
    bonds: [], contacts: [], invoices: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { mockDb = makeDb(baseDb()); });

describe('bonds GET', () => {
  test('rejects an invalid status/type filter', async () => {
    expect((await bondsGET(req('admin', 'GET', 'http://localhost/api/bonds?status=bogus'))).status).toBe(400);
    expect((await bondsGET(req('admin', 'GET', 'http://localhost/api/bonds?type=bogus'))).status).toBe(400);
  });

  test('lists tenant bonds with expiry metadata', async () => {
    mockDb = makeDb({ ...baseDb(), bonds: [{
      id: 'b1', company_id: C1, code: 'B1', status: 'active', type: 'bid_bond',
      expiry_date: '2099-01-01', projects: null, contacts: null, banks_safes: null,
    }] });
    const res = await bondsGET(req('admin', 'GET', 'http://localhost/api/bonds'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.bonds).toHaveLength(1);
    expect(json.data.bonds[0].isExpiringSoon).toBe(false);
  });
});

describe('vouchers/unpaid-invoices', () => {
  test('rejects a missing/invalid contact id', async () => {
    expect((await unpaidInvoicesGET(req('admin', 'GET', 'http://localhost/api/vouchers/unpaid-invoices'))).status).toBe(400);
    expect((await unpaidInvoicesGET(req('admin', 'GET', 'http://localhost/api/vouchers/unpaid-invoices?contactId=bad'))).status).toBe(400);
  });

  test('returns remaining balances for a valid client', async () => {
    mockDb = makeDb({ ...baseDb(), contacts: [{ id: CLIENT, company_id: C1, type: 'client', is_active: true, deleted_at: null }],
      invoices: [{ id: 'i1', contact_id: CLIENT, company_id: C1, number: 1, date: '2026-01-01', total: 100, paid_amount: 40, status: 'partial', deleted_at: null }] });
    const res = await unpaidInvoicesGET(req('admin', 'GET', `http://localhost/api/vouchers/unpaid-invoices?contactId=${CLIENT}`));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.invoices[0].remaining).toBe(60);
  });

  test('returns 404 for a non-client contact', async () => {
    mockDb = makeDb({ ...baseDb(), contacts: [{ id: CLIENT, company_id: C1, type: 'supplier', is_active: true, deleted_at: null }] });
    const res = await unpaidInvoicesGET(req('admin', 'GET', `http://localhost/api/vouchers/unpaid-invoices?contactId=${CLIENT}`));
    expect(res.status).toBe(404);
  });
});

describe('vouchers/advance-report', () => {
  test('rejects an invalid asOf date', async () => {
    const res = await advanceReportGET(req('admin', 'GET', 'http://localhost/api/vouchers/advance-report?asOf=bogus'));
    expect(res.status).toBe(400);
  });

  test('returns customer advances from the RPC', async () => {
    mockDb.rpcResults.set('get_customer_advances', { data: [{ contact_id: CLIENT, contact_name: 'عميل', balance: 500 }], error: null });
    const res = await advanceReportGET(req());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data[0].balance).toBe(500);
  });
});

describe('subscription/activate-code', () => {
  test('rejects a malformed code', async () => {
    const res = await activateCodePOST(req('admin', 'POST', 'http://localhost/x', { code: '!!bad!!' }));
    expect(res.status).toBe(400);
  });

  test('redeems a valid code via the RPC', async () => {
    mockDb.rpcResults.set('redeem_activation_code', { data: { status: 'activated' }, error: null });
    const res = await activateCodePOST(req('admin', 'POST', 'http://localhost/x', { code: 'AB12-CD34-EF56-7890' }));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toBeDefined();
  });
});
