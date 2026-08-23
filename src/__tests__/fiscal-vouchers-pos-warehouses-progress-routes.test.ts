/**
 * Route-boundary tests for fiscal (list/create), vouchers/disbursement,
 * vouchers/receipt, pos/sales, warehouses, progress-billing (list).
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
import { createToken } from '@/lib/auth';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
type Op = { op: string; col?: string; val?: unknown };

function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Op[] }> = [];
  const rpcResults = new Map<string, any>();
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
          if (o.op === 'neq') return get(o.col!) !== o.val;
          if (o.op === 'gte') return String(get(o.col!)) >= String(o.val);
          if (o.op === 'lte') return String(get(o.col!)) <= String(o.val);
          return true;
        })
      );
    const api: TestBuilder = {
      select: () => api,
      eq: (col: string, val: unknown) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: unknown) => { ops.push({ op: 'in', col, val }); return api; },
      neq: (col: string, val: unknown) => { ops.push({ op: 'neq', col, val }); return api; },
      order: () => api, limit: () => api, range: () => api, is: () => api,
      or: () => api, lt: () => api, gte: (col: string, val: unknown) => { ops.push({ op: 'gte', col, val }); return api; },
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

import { GET as fiscalGET, POST as fiscalPOST } from '@/app/api/fiscal/route';
import { GET as disbGET } from '@/app/api/vouchers/disbursement/route';
import { GET as rcptGET } from '@/app/api/vouchers/receipt/route';
import { GET as posGET, POST as posPOST } from '@/app/api/pos/sales/route';
import { GET as whGET, POST as whPOST } from '@/app/api/warehouses/route';
import { GET as pbGET, POST as pbPOST } from '@/app/api/progress-billing/route';
import { resetRateLimits } from '@/lib/memory-rate-limit';

const C1 = 'company-1';
const ID1 = '00000000-0000-4000-8000-00000000f0f1';

function req(role = 'admin', method = 'GET', url = 'http://localhost/x', body?: Row) {
  const token = createToken('u1', role, 0);
  return { url, method, nextUrl: new URL(url), headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined }, json: async () => body } as unknown as NextRequest;
}

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, name: 'م', email: 'admin@example.com', is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: { tax_reports: true, journal: true, cash: true, pos: true, warehouses: true, projects: true } } }],
    fiscal_years: [], voucher_disbursements: [], voucher_receipts: [], pos_sales: [], warehouses: [], progress_billing: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { resetRateLimits(); mockDb = makeDb(baseDb()); });

describe('fiscal', () => {
  test('GET lists fiscal years', async () => {
    mockDb = makeDb({ ...baseDb(), fiscal_years: [{ id: ID1, company_id: C1, name: '2026' }] });
    const res = await fiscalGET(req('admin', 'GET', 'http://localhost/api/fiscal'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.fiscalYears).toHaveLength(1);
  });

  test('POST creates a fiscal year', async () => {
    mockDb.rpcResults.set('create_fiscal_year_atomic', { data: { id: ID1 }, error: null });
    const res = await fiscalPOST(req('admin', 'POST', 'http://localhost/x', { name: '2026', start_date: '2026-01-01', end_date: '2026-12-31' }));
    expect(res.status).toBe(201);
  });

  test('POST rejects missing fields', async () => {
    const res = await fiscalPOST(req('admin', 'POST', 'http://localhost/x', { name: '2026' }));
    expect(res.status).toBe(400);
  });
});

describe('vouchers/disbursement GET', () => {
  test('lists disbursements', async () => {
    mockDb = makeDb({ ...baseDb(), voucher_disbursements: [{ id: ID1, company_id: C1, status: 'posted', date: '2026-01-01', contacts: { name: 'مورد' } }] });
    const res = await disbGET(req('admin', 'GET', 'http://localhost/api/vouchers/disbursement'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.disbursements).toHaveLength(1);
  });
});

describe('vouchers/receipt GET', () => {
  test('lists receipts', async () => {
    mockDb = makeDb({ ...baseDb(), voucher_receipts: [{ id: ID1, company_id: C1, status: 'posted', date: '2026-01-01', contacts: { name: 'عميل' } }] });
    const res = await rcptGET(req('admin', 'GET', 'http://localhost/api/vouchers/receipt'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.receipts).toHaveLength(1);
  });
});

describe('pos/sales', () => {
  test('GET lists sales', async () => {
    mockDb = makeDb({ ...baseDb(), pos_sales: [{ id: ID1, company_id: C1, pos_terminals: { name: 'طرفية', code: 'T1' } }] });
    const res = await posGET(req('admin', 'GET', 'http://localhost/api/pos/sales'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.sales[0].terminal_code).toBe('T1');
  });

  test('POST creates a sale', async () => {
    mockDb.rpcResults.set('create_pos_sale_atomic', { data: { id: ID1 }, error: null });
    const res = await posPOST(req('admin', 'POST', 'http://localhost/x', { terminal_id: ID1, total: 100 }));
    expect(res.status).toBe(201);
  });
});

describe('warehouses', () => {
  test('GET lists warehouses', async () => {
    mockDb = makeDb({ ...baseDb(), warehouses: [{ id: ID1, company_id: C1, name: 'مخزن' }] });
    const res = await whGET(req('admin', 'GET', 'http://localhost/api/warehouses'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.warehouses).toHaveLength(1);
  });

  test('POST creates a warehouse and maps plan-limit error', async () => {
    mockDb.rpcResults.set('create_warehouse_atomic', { data: { id: ID1 }, error: null });
    const res = await whPOST(req('admin', 'POST', 'http://localhost/x', { name: 'مخزن' }));
    expect(res.status).toBe(201);
    mockDb.rpcResults.set('create_warehouse_atomic', { data: null, error: { message: 'warehouse plan limit' } });
    const res2 = await whPOST(req('admin', 'POST', 'http://localhost/x', { name: 'مخزن' }));
    expect(res2.status).toBe(403);
  });
});

describe('progress-billing', () => {
  test('GET lists claims', async () => {
    mockDb = makeDb({ ...baseDb(), progress_billing: [{ id: ID1, company_id: C1, projects: { name: 'مشروع' } }] });
    const res = await pbGET(req('admin', 'GET', 'http://localhost/api/progress-billing'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.claims).toHaveLength(1);
  });

  test('POST creates a claim', async () => {
    mockDb.rpcResults.set('create_progress_billing_claim_atomic', { data: { id: ID1 }, error: null });
    const res = await pbPOST(req('admin', 'POST', 'http://localhost/x', {
      project_id: ID1, claim_number: '1', date: '2026-01-01', gross_amount: 1000,
    }));
    expect(res.status).toBe(201);
  });
});
