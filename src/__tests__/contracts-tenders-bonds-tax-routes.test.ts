/**
 * Route-boundary tests for contracts, tenders, bank-reconciliation, bonds,
 * clients, tax-returns list/create routes.
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
import { createToken } from '@/lib/auth';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
type Op = { op: string; col?: string; val?: unknown };

function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Op[] }> = [];
  const rpcResults = new Map<string, { data: unknown; error?: unknown }>();
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

import { GET as cGET, POST as cPOST } from '@/app/api/contracts/route';
import { GET as tGET, POST as tPOST } from '@/app/api/tenders/route';
import { GET as brGET, POST as brPOST } from '@/app/api/bank-reconciliation/route';
import { GET as bGET, POST as bPOST } from '@/app/api/bonds/route';
import { GET as clGET, POST as clPOST } from '@/app/api/clients/route';
import { GET as taxGET } from '@/app/api/tax-returns/route';
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
      subscription_plans: { code: 'enterprise', features_modules: { contracts: true, tenders: true, banks: true, cash: true, clients: true, contacts: true, tax_reports: true } } }],
    contracts: [], tenders: [], bank_reconciliation: [], bonds: [], contacts: [], invoices: [], purchase_invoices: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { resetRateLimits(); mockDb = makeDb(baseDb()); });

describe('contracts', () => {
  test('GET lists contracts with derived fields', async () => {
    mockDb = makeDb({ ...baseDb(), contracts: [{ id: ID1, company_id: C1, end_date: new Date(Date.now() + 5 * 86400000).toISOString(), projects: { name: 'مشروع' }, contacts: { name: 'عميل' } }] });
    const res = await cGET(req('admin', 'GET', 'http://localhost/api/contracts'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.contracts[0].project_name).toBe('مشروع');
    expect(json.data.contracts[0].isExpiringSoon).toBe(true);
  });

  test('GET rejects an invalid status', async () => {
    const res = await cGET(req('admin', 'GET', 'http://localhost/api/contracts?status=bogus'));
    expect(res.status).toBe(400);
  });

  test('POST creates a contract', async () => {
    mockDb.rpcResults.set('create_contract_atomic', { data: { id: ID1 }, error: null });
    const res = await cPOST(req('admin', 'POST', 'http://localhost/x', {
      title: 'عقد', start_date: '2026-01-01', end_date: '2026-12-31', value: 1000,
    }));
    expect(res.status).toBe(201);
  });
});

describe('tenders', () => {
  test('GET lists tenders with stats', async () => {
    mockDb = makeDb({ ...baseDb(), tenders: [{ id: ID1, company_id: C1, submission_deadline: new Date(Date.now() + 3 * 86400000).toISOString(), tenders_contacts: { name: 'عميل' } }] });
    const res = await tGET(req('admin', 'GET', 'http://localhost/api/tenders'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.tenders[0].contact_name).toBe('عميل');
    expect(json.data.stats.total).toBe(1);
  });

  test('POST creates a tender', async () => {
    mockDb.rpcResults.set('create_tender_atomic', { data: { id: ID1 }, error: null });
    const res = await tPOST(req('admin', 'POST', 'http://localhost/x', { title: 'مناقصة', client_name: 'عميل' }));
    expect(res.status).toBe(201);
  });
});

describe('bank-reconciliation', () => {
  test('GET lists reconciliations', async () => {
    mockDb = makeDb({ ...baseDb(), bank_reconciliation: [{ id: ID1, company_id: C1, banks_safes: { name: 'بنك' } }] });
    const res = await brGET(req('admin', 'GET', 'http://localhost/api/bank-reconciliation'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data[0].bank_safe_name).toBe('بنك');
  });

  test('POST creates a reconciliation', async () => {
    mockDb.rpcResults.set('create_bank_reconciliation', { data: { id: ID1 }, error: null });
    const res = await brPOST(req('admin', 'POST', 'http://localhost/x', { bankSafeId: ID1, date: '2026-01-01', closingBalance: 100 }));
    expect(res.status).toBe(201);
  });
});

describe('bonds', () => {
  test('GET lists bonds with summary', async () => {
    mockDb = makeDb({ ...baseDb(), bonds: [{ id: ID1, company_id: C1, expiry_date: new Date(Date.now() + 5 * 86400000).toISOString(), projects: { name: 'مشروع' } }] });
    mockDb.rpcResults.set('get_bond_summary', { data: { total: 1 }, error: null });
    const res = await bGET(req('admin', 'GET', 'http://localhost/api/bonds'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.bonds[0].project_name).toBe('مشروع');
  });

  test('POST creates a bond', async () => {
    mockDb.rpcResults.set('create_bond_atomic', { data: { id: ID1 }, error: null });
    const res = await bPOST(req('admin', 'POST', 'http://localhost/x', { title: 'ضمان', type: 'bid_bond', amount: 1000, issue_date: '2026-01-01', expiry_date: '2026-12-31' }));
    expect(res.status).toBe(201);
  });
});

describe('clients', () => {
  test('GET lists clients', async () => {
    mockDb = makeDb({ ...baseDb(), contacts: [{ id: ID1, company_id: C1, name: 'عميل', type: 'client', is_active: true }] });
    const res = await clGET(req('admin', 'GET', 'http://localhost/api/clients'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.clients).toHaveLength(1);
  });

  test('GET rejects an invalid contactId', async () => {
    const res = await clGET(req('admin', 'GET', 'http://localhost/api/clients?contactId=bad'));
    expect(res.status).toBe(400);
  });

  test('POST creates a client', async () => {
    mockDb.rpcResults.set('create_contact_atomic', { data: { id: ID1 }, error: null });
    const res = await clPOST(req('admin', 'POST', 'http://localhost/x', { name: 'عميل', type: 'client' }));
    expect(res.status).toBe(201);
  });
});

describe('tax-returns GET', () => {
  test('generates a VAT return', async () => {
    mockDb.rpcResults.set('get_vat_return_summary', { data: { outputVat: 15, inputVat: 5, totalSales: 100, totalPurchases: 50, zeroRatedSales: 0 }, error: null });
    const res = await taxGET(req('admin', 'GET', 'http://localhost/api/tax-returns?from=2026-01-01&to=2026-01-31'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.vatReturn.standardRatedVAT).toBe(15);
  });

  test('rejects an invalid period', async () => {
    const res = await taxGET(req('admin', 'GET', 'http://localhost/api/tax-returns?from=bad'));
    expect(res.status).toBe(400);
  });
});
