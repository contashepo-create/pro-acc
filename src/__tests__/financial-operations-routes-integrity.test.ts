/**
 * Route-boundary tests for financial-operation routes (previously uncovered):
 * currencies (CRUD), projects/[id]/close, projects/[id]/financials, credit-notes GET.
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
import { createToken } from '@/lib/auth';

type Row = Record<string, any>;
type Op = { op: string; col?: string; val?: any };

function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Op[]; mut?: any }> = [];
  const rpcResults = new Map<string, any>();
  const from = (table: string) => {
    const ops: Op[] = [];
    const mut: any = {};
    calls.push({ table, ops, mut });
    const rows = () =>
      (db[table] || []).filter((r) =>
        ops.every((o) => {
          if (o.op === 'eq') return r[o.col!] === o.val;
          if (o.op === 'in') return (o.val as any[]).includes(r[o.col!]);
          if (o.op === 'neq') return r[o.col!] !== o.val;
          return true;
        })
      );
    const api: any = {
      select: () => api,
      eq: (col: string, val: any) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: any) => { ops.push({ op: 'in', col, val }); return api; },
      neq: (col: string, val: any) => { ops.push({ op: 'neq', col, val }); return api; },
      gte: () => api, lte: () => api, or: () => api, is: () => api, order: () => api, limit: () => api, range: () => api,
      delete: () => { mut.kind = 'delete'; return api; },
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

import { GET as currenciesGET, POST as currenciesPOST } from '@/app/api/currencies/route';
import { GET as currencyGET, PUT as currencyPUT, DELETE as currencyDELETE } from '@/app/api/currencies/[id]/route';
import { POST as closePOST } from '@/app/api/projects/[id]/close/route';
import { GET as projectFinancialsGET } from '@/app/api/projects/[id]/financials/route';
import { GET as creditNotesGET } from '@/app/api/credit-notes/route';

const C1 = 'company-1';
const PID = '00000000-0000-4000-8000-000000000d01';
const CURR = '00000000-0000-4000-8000-000000000c01';

function req(role = 'admin', method = 'GET', url = 'http://localhost/x', body?: any) {
  const token = createToken('u1', role, 0);
  return { url, method, headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined }, json: async () => body } as any;
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: { projects: true, reports: true, financial_reports: true, currencies: true, credit_notes: true } } }],
    currencies: [{ id: CURR, company_id: C1, code: 'SAR', name: 'ريال', rate: 1, is_base: true }],
    projects: [{ id: PID, company_id: C1, name: 'مشروع', contract_value: 1000, status: 'active', start_date: '2026-01-01', tax_enabled: false, tax_rate: 0.15 }],
    credit_notes: [], contacts: [], invoices: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { mockDb = makeDb(baseDb()); });

describe('currencies routes', () => {
  test('GET lists tenant currencies', async () => {
    const res = await currenciesGET(req('admin', 'GET', 'http://localhost/api/currencies'));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toHaveLength(1);
  });

  test('POST validates and saves a currency', async () => {
    mockDb.rpcResults.set('save_currency', { data: CURR, error: null });
    const res = await currenciesPOST(req('admin', 'POST', 'http://localhost/api/currencies', { code: 'usd', name: 'دولار', rate: 3.75, isBase: false }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.code).toBe('SAR');
  });

  test('POST rejects invalid code/rate/name', async () => {
    expect((await currenciesPOST(req('admin', 'POST', 'http://localhost/api/currencies', { code: 'x', name: 'y', rate: 1 }))).status).toBe(400);
    expect((await currenciesPOST(req('admin', 'POST', 'http://localhost/api/currencies', { code: 'USD', name: 'y', rate: 0 }))).status).toBe(400);
    expect((await currenciesPOST(req('admin', 'POST', 'http://localhost/api/currencies', { code: 'USD', name: '', rate: 1 }))).status).toBe(400);
  });

  test('GET [id] returns 404 for a foreign-tenant currency', async () => {
    const res = await currencyGET(req(), params('00000000-0000-4000-8000-00000000dead'));
    expect(res.status).toBe(404);
  });

  test('GET [id] returns the tenant currency', async () => {
    const res = await currencyGET(req(), params(CURR));
    expect(res.status).toBe(200);
    expect((await res.json()).data.code).toBe('SAR');
  });

  test('PUT updates and validates', async () => {
    const res = await currencyPUT(req('admin', 'PUT', 'http://localhost/x', { rate: 3.76 }), params(CURR));
    expect(res.status).toBe(200);
    expect((await res.json()).data.code).toBe('SAR');
    // invalid rate
    const bad = await currencyPUT(req('admin', 'PUT', 'http://localhost/x', { rate: -1 }), params(CURR));
    expect(bad.status).toBe(400);
  });

  test('DELETE rejects deleting the base currency (409)', async () => {
    const res = await currencyDELETE(req('admin', 'DELETE'), params(CURR));
    expect(res.status).toBe(409);
  });

  test('DELETE removes a non-base currency', async () => {
    const nonBase = '00000000-0000-4000-8000-000000000c02';
    mockDb = makeDb({ ...baseDb(), currencies: [{ id: nonBase, company_id: C1, code: 'USD', name: 'دولار', rate: 3.75, is_base: false }] });
    const res = await currencyDELETE(req('admin', 'DELETE'), params(nonBase));
    expect(res.status).toBe(200);
    expect((await res.json()).data.deleted).toBe(true);
  });
});

describe('project close & financials', () => {
  test('close rejects an invalid project id (422)', async () => {
    const res = await closePOST(req('admin', 'POST', 'http://localhost/x', {}), params('not-a-uuid'));
    expect(res.status).toBe(422);
  });

  test('close returns a not-found for a missing project', async () => {
    mockDb.rpcResults.set('close_project', { data: null, error: { message: 'المشروع غير موجود' } });
    const res = await closePOST(req('admin', 'POST', 'http://localhost/x', { close_date: '2026-06-01' }), params(PID));
    expect(res.status).toBe(404);
  });

  test('project financials returns a reference summary without touching the client', async () => {
    mockDb.rpcResults.set('get_project_account_totals', { data: [
      { project_id: PID, code: '4100', account_type: 'revenue', debit: 0, credit: 800 },
      { project_id: PID, code: '5110', account_type: 'expense', debit: 600, credit: 0 },
    ], error: null });
    const res = await projectFinancialsGET(req(), params(PID));
    expect(res.status).toBe(200);
    const json = await res.json();
    // profit uses a single basis: ledger revenue (800) - expenses (600)
    expect(json.data.summary.actual_profit).toBe(200);
  });
});

describe('credit-notes GET', () => {
  test('returns 400 for an invalid project filter id', async () => {
    const res = await creditNotesGET(req('admin', 'GET', 'http://localhost/api/credit-notes?projectId=bad'));
    expect(res.status).toBe(400);
  });

  test('lists tenant credit notes', async () => {
    const res = await creditNotesGET(req('admin', 'GET', 'http://localhost/api/credit-notes'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.credit_notes).toEqual([]);
    expect(json.data.total).toBe(0);
  });
});
