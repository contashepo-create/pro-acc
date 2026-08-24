/**
 * Route-boundary tests for the supplier statement endpoint.
 *
 * Security: the supplier must belong to the caller's tenant; a foreign
 * supplier id yields 404; invalid id yields 400; a valid supplier returns the
 * statement with a correct accounting basis.
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
import { createToken } from '@/lib/auth';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
type Op = { op: string; col?: string; val?: unknown };

function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Op[] }> = [];
  const from = (table: string) => {
    const ops: Op[] = [];
    calls.push({ table, ops });
    const rows = () =>
      (db[table] || []).filter((r) =>
        ops.every((o) => {
          if (o.op === 'eq') return r[o.col!] === o.val;
          if (o.op === 'in') return (o.val as unknown[]).includes(r[o.col!]);
          if (o.op === 'gte') return (r[o.col!] as string) >= (o.val as string);
          if (o.op === 'lte') return (r[o.col!] as string) <= (o.val as string);
          return true;
        })
      );
    const api: TestBuilder = {
      select: () => api,
      eq: (col: string, val: unknown) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: unknown) => { ops.push({ op: 'in', col, val }); return api; },
      gte: (col: string, val: unknown) => { ops.push({ op: 'gte', col, val }); return api; },
      lte: (col: string, val: unknown) => { ops.push({ op: 'lte', col, val }); return api; },
      order: () => api,
      range: () => api,
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
    from,
    calls,
    rpc: undefined as ((name: string, params?: Row) => Promise<{ data: unknown; error: unknown }>) | undefined,
  };
}

let mockDb: ReturnType<typeof makeDb>;
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));

import { GET } from '@/app/api/suppliers/[id]/statement/route';

const C1 = 'company-1';
const SUPPLIER = '00000000-0000-4000-8000-000000000001';
const FOREIGN_SUPPLIER = '00000000-0000-4000-8000-000000000099';

function req(role = 'admin') {
  const UID: Record<string, string> = { admin: 'u1', supervisor: 'u2', foreign: 'u3' };
  const token = createToken(UID[role] || 'u1', role, 0);
  return {
    method: 'GET',
    url: `http://localhost/api/suppliers/${SUPPLIER}/statement`,
    headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined },
  } as unknown as NextRequest;
}

function baseDb() {
  return {
    users: [
      { id: 'u1', company_id: C1, is_active: true, token_version: 0, role: 'admin' },
      { id: 'u2', company_id: C1, is_active: true, token_version: 0, role: 'supervisor' },
      { id: 'u3', company_id: 'company-2', is_active: true, token_version: 0, role: 'admin' },
    ],
    companies: [{ id: C1, is_active: true }, { id: 'company-2', is_active: true }],
    subscriptions: [
      { id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
        subscription_plans: { code: 'enterprise', features_modules: { projects: true, reports: true } } },
      { id: 's2', company_id: 'company-2', status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
        subscription_plans: { code: 'enterprise', features_modules: { projects: true, reports: true } } },
    ],
    contacts: [
      { id: SUPPLIER, company_id: C1, name: 'مورد', type: 'supplier' },
      { id: FOREIGN_SUPPLIER, company_id: 'company-2', name: 'مورد أجنبي', type: 'supplier' },
    ],
    purchase_invoices: [{ id: 'pi1', supplier_id: SUPPLIER, company_id: C1, number: 1, date: '2026-01-01', total: 100, paid_amount: 0, status: 'unpaid' }],
    voucher_disbursements: [{ id: 'vd1', contact_id: SUPPLIER, company_id: C1, number: 1, date: '2026-01-02', amount: 50, status: 'approved' }],
  } as Record<string, Row[]>;
}

// Stub the contact-statement RPCs used by the route.
const rpcResults = new Map<string, { data: unknown; error: unknown }>();
jest.spyOn(globalThis as { fetch: typeof fetch }, 'fetch'); // noop to keep eslint quiet if needed
function installRpc() {
  mockDb.rpc = async (name: string) => {
    if (name === 'get_contact_statement_summary') return { data: { total_count: 1, opening_balance: 0, period_debit: 100, period_credit: 50, closing_balance: 50 }, error: null };
    if (name === 'get_contact_statement_lines') return { data: [{ line_id: 'l1', entry_date: '2026-01-01', entry_number: 1, reference_type: 'purchase_invoice', reference_id: 'pi1', description: 'فاتورة', debit: 100, credit: 0, running_balance: 100, entry_id: 'e1' }], error: null };
    return rpcResults.get(name) || { data: [], error: null };
  };
}

beforeEach(() => {
  mockDb = makeDb(baseDb());
  installRpc();
  rpcResults.clear();
});

describe('supplier statement — security & tenant isolation', () => {
  test('returns 404 when a foreign-tenant admin requests this tenant supplier', async () => {
    const res = await GET(req('foreign'), { params: Promise.resolve({ id: SUPPLIER }) });
    expect(res.status).toBe(404);
  });

  test('a foreign admin can view its own tenant supplier', async () => {
    const res = await GET(req('foreign'), { params: Promise.resolve({ id: FOREIGN_SUPPLIER }) });
    expect(res.status).toBe(200);
  });

  test('returns 400 for a malformed supplier id', async () => {
    const res = await GET(req('admin'), { params: Promise.resolve({ id: 'not-a-uuid' }) });
    expect(res.status).toBe(400);
  });

  test('returns 404 for a non-supplier contact id', async () => {
    mockDb = makeDb({ ...baseDb(), contacts: [{ id: SUPPLIER, company_id: C1, name: 'عميل', type: 'client' }] });
    installRpc();
    const res = await GET(req('admin'), { params: Promise.resolve({ id: SUPPLIER }) });
    expect(res.status).toBe(404);
  });
});

describe('supplier statement — accounting correctness', () => {
  test('returns opening balance, entries and balance from the ledger', async () => {
    const res = await GET(req('admin'), { params: Promise.resolve({ id: SUPPLIER }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.supplier.name).toBe('مورد');
    expect(json.data.opening_balance).toBe(0);
    expect(json.data.balance).toBe(50);
    expect(json.data.entries).toHaveLength(1);
    expect(json.data.accountingBasis).toBe('posted_contact_control_accounts');
    expect(json.data.purchase_invoices).toHaveLength(1);
    expect(json.data.disbursements).toHaveLength(1);
  });
});
