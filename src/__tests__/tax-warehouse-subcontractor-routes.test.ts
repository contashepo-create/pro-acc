/**
 * Route-boundary tests for previously-uncovered routes: tax-returns GET,
 * warehouses GET/POST, subcontractors (contracts/certificates/payments) GET.
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
          if (o.op === 'gte') return r[o.col!] >= o.val;
          if (o.op === 'lte') return r[o.col!] <= o.val;
          return true;
        })
      );
    const api: any = {
      select: () => api,
      eq: (col: string, val: any) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: any) => { ops.push({ op: 'in', col, val }); return api; },
      neq: (col: string, val: any) => { ops.push({ op: 'neq', col, val }); return api; },
      gte: (col: string, val: any) => { ops.push({ op: 'gte', col, val }); return api; },
      lte: (col: string, val: any) => { ops.push({ op: 'lte', col, val }); return api; },
      is: (col: string, val: any) => { ops.push({ op: 'is', col, val }); return api; },
      order: () => api, limit: () => api, range: () => api, maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
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

import { GET as taxGET } from '@/app/api/tax-returns/route';
import { GET as warehousesGET, POST as warehousesPOST } from '@/app/api/warehouses/route';
import { GET as contractsGET } from '@/app/api/subcontractors/contracts/route';
import { GET as certificatesGET } from '@/app/api/subcontractors/certificates/route';

const C1 = 'company-1';
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
      subscription_plans: { code: 'enterprise', features_modules: { projects: true, reports: true, tax_returns: true, warehouses: true, subcontractors: true } } }],
    warehouses: [], invoices: [], subcontractor_contracts: [], subcontractor_certificates: [], subcontractor_payments: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { mockDb = makeDb(baseDb()); });

describe('tax-returns GET', () => {
  test('rejects an invalid period', async () => {
    const res = await taxGET(req('admin', 'GET', 'http://localhost/api/tax-returns?from=bad&to=2026-01-31'));
    expect(res.status).toBe(400);
  });

  test('builds a VAT return from control-account movements', async () => {
    mockDb.rpcResults.set('get_vat_return_summary', { data: { outputVat: 150, inputVat: 60, totalSales: 1000, totalPurchases: 400 }, error: null });
    const res = await taxGET(req('admin', 'GET', 'http://localhost/api/tax-returns?from=2026-01-01&to=2026-01-31'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.vatReturn.netVATDue).toBe(90); // 150 - 60
  });
});

describe('warehouses', () => {
  test('GET lists tenant warehouses', async () => {
    mockDb = makeDb({ ...baseDb(), warehouses: [{ id: 'w1', company_id: C1, name: 'مستودع', is_active: true }] });
    const res = await warehousesGET(req('admin', 'GET', 'http://localhost/api/warehouses'));
    expect(res.status).toBe(200);
    expect((await res.json()).data.warehouses).toHaveLength(1);
  });

  test('POST rejects an invalid body and creates via RPC', async () => {
    const bad = await warehousesPOST(req('admin', 'POST', 'http://localhost/x', { name: '' }));
    expect(bad.status).toBe(400);
    mockDb.rpcResults.set('create_warehouse_atomic', { data: { id: 'w1' }, error: null });
    const ok = await warehousesPOST(req('admin', 'POST', 'http://localhost/x', { name: 'مستودع' }));
    expect(ok.status).toBe(201);
  });
});

describe('subcontractors GET', () => {
  test('lists tenant subcontractor contracts', async () => {
    mockDb = makeDb({ ...baseDb(), subcontractor_contracts: [{ id: 'c1', company_id: C1, contract_number: 'C1', contacts: { name: 'باطن' } }] });
    const res = await contractsGET(req('admin', 'GET', 'http://localhost/api/subcontractors/contracts'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.contracts[0].subcontractor_name).toBe('باطن');
  });

  test('lists tenant subcontractor certificates', async () => {
    mockDb = makeDb({ ...baseDb(), subcontractor_certificates: [{ id: 'x1', company_id: C1, number: 1, amount: 100, subcontractor_contracts: { contract_number: 'C1', contacts: { name: 'باطن' } } }] });
    const res = await certificatesGET(req('admin', 'GET', 'http://localhost/api/subcontractors/certificates'));
    expect(res.status).toBe(200);
    expect((await res.json()).data.certificates).toHaveLength(1);
  });

});
