/**
 * Route-boundary tests for detail CRUD flows: fiscal/[id], categories/[id],
 * boq/[id], warehouses/[id], journal/[id], salary-sheets/[id], banks/[id],
 * clients/[id]/statement, approvals/[id].
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
import { createToken } from '@/lib/auth';

type Row = Record<string, unknown>;
type Op = { op: string; col?: string; val?: unknown };

function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Op[] }> = [];
  const rpcResults = new Map<string, { data: unknown; error?: unknown } | null>();
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
          if (o.op === 'gte') return String(get(o.col!)) >= String(o.val);
          if (o.op === 'lte') return String(get(o.col!)) <= String(o.val);
          return true;
        })
      );
    const api: TestBuilder = {
      select: () => api,
      eq: (col: string, val: unknown) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: unknown) => { ops.push({ op: 'in', col, val }); return api; },
      order: () => api, limit: () => api, range: () => api, is: () => api, neq: () => api,
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

import { GET as fiscalGET, PUT as fiscalPUT, DELETE as fiscalDELETE } from '@/app/api/fiscal/[id]/route';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';
import { GET as catGET, PUT as catPUT, DELETE as catDELETE } from '@/app/api/categories/[id]/route';
import { GET as boqGET, PUT as boqPUT, DELETE as boqDELETE } from '@/app/api/boq/[id]/route';
import { GET as whGET, PUT as whPUT, DELETE as whDELETE } from '@/app/api/warehouses/[id]/route';
import { GET as jGET, PUT as jPUT, DELETE as jDELETE } from '@/app/api/journal/[id]/route';
import { GET as ssGET, PUT as ssPUT, DELETE as ssDELETE } from '@/app/api/salary-sheets/[id]/route';
import { GET as bankGET, PUT as bankPUT, DELETE as bankDELETE } from '@/app/api/banks/[id]/route';
import { GET as statementGET } from '@/app/api/clients/[id]/statement/route';
import { GET as apprGET, PUT as apprPUT } from '@/app/api/approvals/[id]/route';
import { resetRateLimits } from '@/lib/memory-rate-limit';

const C1 = 'company-1';
const R1 = '00000000-0000-4000-8000-00000000f0a1';

function req(role = 'admin', method = 'GET', url = 'http://localhost/x', body?: Row) {
  const token = createToken('u1', role, 0);
  return { url, method, nextUrl: new URL(url), headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined }, json: async () => body } as unknown as NextRequest;
}

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: {} } }],
    fiscal_years: [], transaction_categories: [], boq_items: [], warehouses: [],
    journal_entries: [], journal_lines: [], salary_sheets: [], salary_items: [],
    banks_safes: [], contacts: [], invoices: [], voucher_receipts: [], approval_requests: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { resetRateLimits(); mockDb = makeDb(baseDb()); });

describe('fiscal/[id]', () => {
  test('GET returns a fiscal year', async () => {
    mockDb = makeDb({ ...baseDb(), fiscal_years: [{ id: R1, company_id: C1, name: '2026' }] });
    const res = await fiscalGET(req('admin', 'GET', `http://localhost/x/${R1}`), { params: Promise.resolve({ id: R1 }) });
    expect(res.status).toBe(200);
  });

  test('GET returns 404 when missing', async () => {
    const res = await fiscalGET(req('admin', 'GET', `http://localhost/x/${R1}`), { params: Promise.resolve({ id: R1 }) });
    expect(res.status).toBe(404);
  });

  test('PUT updates an open fiscal year', async () => {
    mockDb = makeDb({ ...baseDb(), fiscal_years: [{ id: R1, company_id: C1, name: '2026', status: 'open' }] });
    const res = await fiscalPUT(req('admin', 'PUT', 'http://localhost/x', { name: '2026' }), { params: Promise.resolve({ id: R1 }) });
    expect(res.status).toBe(200);
  });

  test('PUT rejects a closed fiscal year and overlap errors', async () => {
    mockDb = makeDb({ ...baseDb(), fiscal_years: [{ id: R1, company_id: C1, status: 'closed' }] });
    const res1 = await fiscalPUT(req('admin', 'PUT', 'http://localhost/x', { name: 'x' }), { params: Promise.resolve({ id: R1 }) });
    expect(res1.status).toBe(400);
    mockDb = makeDb({ ...baseDb(), fiscal_years: [{ id: R1, company_id: C1, status: 'open' }] });
    mockDb.rpcResults.set('overlap', null);
    const res2 = await fiscalPUT(req('admin', 'PUT', 'http://localhost/x', { name: 'x' }), { params: Promise.resolve({ id: R1 }) });
    expect(res2.status).toBe(200);
  });

  test('DELETE rejects closed and open years, deletes a draft', async () => {
    mockDb = makeDb({ ...baseDb(), fiscal_years: [{ id: R1, company_id: C1, status: 'closed' }] });
    const res1 = await fiscalDELETE(req('admin', 'DELETE', `http://localhost/x/${R1}`), { params: Promise.resolve({ id: R1 }) });
    expect(res1.status).toBe(400);
    mockDb = makeDb({ ...baseDb(), fiscal_years: [{ id: R1, company_id: C1, status: 'open' }] });
    const res2 = await fiscalDELETE(req('admin', 'DELETE', `http://localhost/x/${R1}`), { params: Promise.resolve({ id: R1 }) });
    expect(res2.status).toBe(409);
    mockDb = makeDb({ ...baseDb(), fiscal_years: [{ id: R1, company_id: C1, status: 'draft' }] });
    const res3 = await fiscalDELETE(req('admin', 'DELETE', `http://localhost/x/${R1}`), { params: Promise.resolve({ id: R1 }) });
    expect(res3.status).toBe(200);
  });
});

describe('categories/[id]', () => {
  test('GET returns a category', async () => {
    mockDb = makeDb({ ...baseDb(), transaction_categories: [{ id: R1, company_id: C1, name: 'نقل' }] });
    const res = await catGET(req('admin', 'GET', `http://localhost/x/${R1}`), { params: Promise.resolve({ id: R1 }) });
    expect(res.status).toBe(200);
  });

  test('GET returns 404 when missing', async () => {
    const res = await catGET(req('admin', 'GET', `http://localhost/x/${R1}`), { params: Promise.resolve({ id: R1 }) });
    expect(res.status).toBe(404);
  });

  test('PUT updates a category', async () => {
    mockDb = makeDb({ ...baseDb(), transaction_categories: [{ id: R1, company_id: C1, name: 'نقل' }] });
    const res = await catPUT(req('admin', 'PUT', 'http://localhost/x', { name: 'مواصلات' }), { params: Promise.resolve({ id: R1 }) });
    expect(res.status).toBe(200);
  });

  test('DELETE deletes an unused category', async () => {
    mockDb = makeDb({ ...baseDb(), transaction_categories: [{ id: R1, company_id: C1, name: 'نقل' }] });
    const res = await catDELETE(req('admin', 'DELETE', `http://localhost/x/${R1}`), { params: Promise.resolve({ id: R1 }) });
    expect(res.status).toBe(200);
  });

  test('DELETE blocks a category in use', async () => {
    mockDb = makeDb({ ...baseDb(), transaction_categories: [{ id: R1, company_id: C1, name: 'نقل' }], cash_transactions: [{ id: 't1', category_id: R1, company_id: C1 }] });
    const res = await catDELETE(req('admin', 'DELETE', `http://localhost/x/${R1}`), { params: Promise.resolve({ id: R1 }) });
    expect(res.status).toBe(400);
  });
});

describe('boq/[id]', () => {
  test('GET returns a boq item and rejects invalid id', async () => {
    mockDb = makeDb({ ...baseDb(), boq_items: [{ id: R1, company_id: C1, description: 'بند', projects: { name: 'مشروع' } }] });
    const res = await boqGET(req('admin', 'GET', `http://localhost/x/${R1}`), { params: Promise.resolve({ id: R1 }) });
    expect(res.status).toBe(200);
    const res2 = await boqGET(req('admin', 'GET', 'http://localhost/x'), { params: Promise.resolve({ id: 'bad' }) });
    expect(res2.status).toBe(400);
  });

  test('PUT updates a boq item', async () => {
    mockDb = makeDb({ ...baseDb(), boq_items: [{ id: R1, company_id: C1, description: 'بند' }] });
    mockDb.rpcResults.set('update_boq_item_atomic', { data: { id: R1 }, error: null });
    const res = await boqPUT(req('admin', 'PUT', 'http://localhost/x', { description: 'بند محدث' }), { params: Promise.resolve({ id: R1 }) });
    expect(res.status).toBe(200);
  });

  test('DELETE removes a boq item', async () => {
    mockDb = makeDb({ ...baseDb(), boq_items: [{ id: R1, company_id: C1, description: 'بند' }] });
    mockDb.rpcResults.set('delete_boq_item_atomic', { data: { deleted: true }, error: null });
    const res = await boqDELETE(req('admin', 'DELETE', `http://localhost/x/${R1}`), { params: Promise.resolve({ id: R1 }) });
    expect(res.status).toBe(200);
  });
});

describe('warehouses/[id]', () => {
  test('GET returns a warehouse', async () => {
    mockDb = makeDb({ ...baseDb(), warehouses: [{ id: R1, company_id: C1, name: 'مخزن' }] });
    const res = await whGET(req('admin', 'GET', `http://localhost/x/${R1}`), { params: Promise.resolve({ id: R1 }) });
    expect(res.status).toBe(200);
  });

  test('GET returns 404 when missing', async () => {
    const res = await whGET(req('admin', 'GET', `http://localhost/x/${R1}`), { params: Promise.resolve({ id: R1 }) });
    expect(res.status).toBe(404);
  });

  test('PUT updates a warehouse', async () => {
    mockDb.rpcResults.set('update_warehouse_atomic', { data: { id: R1 }, error: null });
    const res = await whPUT(req('admin', 'PUT', 'http://localhost/x', { name: 'مخزن ب' }), { params: Promise.resolve({ id: R1 }) });
    expect(res.status).toBe(200);
  });

  test('PUT maps duplicate name and not-found errors', async () => {
    mockDb.rpcResults.set('update_warehouse_atomic', { data: null, error: { message: 'اسم المستودع مستخدم' } });
    const res1 = await whPUT(req('admin', 'PUT', 'http://localhost/x', { name: 'مخزن' }), { params: Promise.resolve({ id: R1 }) });
    expect(res1.status).toBe(409);
    mockDb.rpcResults.set('update_warehouse_atomic', { data: null, error: { message: 'المستودع غير موجود' } });
    const res2 = await whPUT(req('admin', 'PUT', 'http://localhost/x', { name: 'مخزن' }), { params: Promise.resolve({ id: R1 }) });
    expect(res2.status).toBe(404);
  });

  test('DELETE deactivates a warehouse', async () => {
    mockDb.rpcResults.set('update_warehouse_atomic', { data: { id: R1 }, error: null });
    const res = await whDELETE(req('admin', 'DELETE', `http://localhost/x/${R1}`), { params: Promise.resolve({ id: R1 }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.deactivated).toBe(true);
  });
});

describe('journal/[id]', () => {
  test('GET returns an entry with lines and totals', async () => {
    mockDb = makeDb({ ...baseDb(), journal_entries: [{ id: R1, company_id: C1, number: 'JE-1', description: 'قيد' }],
      journal_lines: [
        { id: 'l1', journal_entry_id: R1, company_id: C1, account_code: '1000', debit: 100, credit: 0, accounts: { name: 'نقد', type: 'asset' } },
        { id: 'l2', journal_entry_id: R1, company_id: C1, account_code: '3000', debit: 0, credit: 100, accounts: { name: 'رأس المال', type: 'equity' } },
      ] });
    const res = await jGET(req('admin', 'GET', `http://localhost/x/${R1}`), { params: Promise.resolve({ id: R1 }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.totalDebit).toBe(100);
    expect(json.data.totalCredit).toBe(100);
  });

  test('GET returns 404 when missing', async () => {
    const res = await jGET(req('admin', 'GET', `http://localhost/x/${R1}`), { params: Promise.resolve({ id: R1 }) });
    expect(res.status).toBe(404);
  });

  test('PUT rejects editing a posted entry (409)', async () => {
    mockDb = makeDb({ ...baseDb(), journal_entries: [{ id: R1, company_id: C1 }] });
    const res = await jPUT(req('admin', 'PUT', 'http://localhost/x', {}), { params: Promise.resolve({ id: R1 }) });
    expect(res.status).toBe(409);
  });

  test('DELETE posts a reversal and keeps the original', async () => {
    mockDb = makeDb({ ...baseDb(), journal_entries: [{ id: R1, company_id: C1, number: 'JE-1', description: 'قيد' }] });
    mockDb.rpcResults.set('post_journal_reversal', { data: { reversed: true }, error: null });
    const res = await jDELETE(req('admin', 'DELETE', `http://localhost/x/${R1}`), { params: Promise.resolve({ id: R1 }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.reversed).toBe(true);
  });
});

describe('salary-sheets/[id]', () => {
  test('GET returns a sheet with items', async () => {
    mockDb = makeDb({ ...baseDb(), salary_sheets: [{ id: R1, company_id: C1, name: 'رواتب' }],
      salary_items: [{ id: 'i1', sheet_id: R1, company_id: C1, employees: { name: 'موظف' } }] });
    const res = await ssGET(req('admin', 'GET', `http://localhost/x/${R1}`), { params: Promise.resolve({ id: R1 }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.items[0].employee_name).toBe('موظف');
  });

  test('PUT updates a draft sheet', async () => {
    mockDb = makeDb({ ...baseDb(), salary_sheets: [{ id: R1, company_id: C1, status: 'draft', name: 'رواتب' }] });
    const res = await ssPUT(req('admin', 'PUT', 'http://localhost/x', { name: 'رواتب يناير' }), { params: Promise.resolve({ id: R1 }) });
    expect(res.status).toBe(200);
  });

  test('PUT rejects a non-draft sheet and status changes', async () => {
    mockDb = makeDb({ ...baseDb(), salary_sheets: [{ id: R1, company_id: C1, status: 'approved' }] });
    const res1 = await ssPUT(req('admin', 'PUT', 'http://localhost/x', { name: 'x' }), { params: Promise.resolve({ id: R1 }) });
    expect(res1.status).toBe(409);
    mockDb = makeDb({ ...baseDb(), salary_sheets: [{ id: R1, company_id: C1, status: 'draft' }] });
    const res2 = await ssPUT(req('admin', 'PUT', 'http://localhost/x', { status: 'approved' }), { params: Promise.resolve({ id: R1 }) });
    expect(res2.status).toBe(409);
  });

  test('DELETE deletes a draft sheet', async () => {
    mockDb.rpcResults.set('delete_draft_salary_sheet', { data: true, error: null });
    const res = await ssDELETE(req('admin', 'DELETE', `http://localhost/x/${R1}`), { params: Promise.resolve({ id: R1 }) });
    expect(res.status).toBe(200);
  });
});

describe('banks/[id]', () => {
  test('GET returns a bank with balances', async () => {
    mockDb = makeDb({ ...baseDb(), banks_safes: [{ id: R1, company_id: C1, name: 'بنك', opening_balance: 100, accounts: { code: '1110', name: 'بنك' } }] });
    mockDb.rpcResults.set('get_bank_safe_balances', { data: [{ current_balance: 500, opening_balance: 100 }], error: null });
    const res = await bankGET(req('admin', 'GET', `http://localhost/x/${R1}`), { params: Promise.resolve({ id: R1 }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.current_balance).toBe(500);
  });

  test('PUT updates bank metadata', async () => {
    mockDb = makeDb({ ...baseDb(), banks_safes: [{ id: R1, company_id: C1, name: 'بنك', type: 'bank', opening_balance: 0 }] });
    mockDb.rpcResults.set('update_bank_safe_metadata_atomic', { data: { id: R1 }, error: null });
    const res = await bankPUT(req('admin', 'PUT', 'http://localhost/x', { name: 'بنك أ' }), { params: Promise.resolve({ id: R1 }) });
    expect(res.status).toBe(200);
  });

  test('PUT rejects changing the type (409)', async () => {
    mockDb = makeDb({ ...baseDb(), banks_safes: [{ id: R1, company_id: C1, name: 'بنك', type: 'bank', opening_balance: 0 }] });
    const res = await bankPUT(req('admin', 'PUT', 'http://localhost/x', { type: 'safe' }), { params: Promise.resolve({ id: R1 }) });
    expect(res.status).toBe(409);
  });

  test('DELETE deactivates a bank', async () => {
    mockDb.rpcResults.set('deactivate_bank_safe', { data: { id: R1 }, error: null });
    const res = await bankDELETE(req('admin', 'DELETE', `http://localhost/x/${R1}`), { params: Promise.resolve({ id: R1 }) });
    expect(res.status).toBe(200);
  });
});

describe('clients/[id]/statement GET', () => {
  test('returns a statement', async () => {
    mockDb = makeDb({ ...baseDb(), contacts: [{ id: R1, company_id: C1, name: 'عميل', type: 'client' }] });
    mockDb.rpcResults.set('get_contact_statement_summary', { data: { opening_balance: 0, closing_balance: 50, period_debit: 50, period_credit: 0, total_count: 1 }, error: null });
    mockDb.rpcResults.set('get_contact_statement_lines', { data: [{ line_id: 'l1', entry_date: '2026-01-01', debit: 50, credit: 0, running_balance: 50 }], error: null });
    const res = await statementGET(req('admin', 'GET', `http://localhost/x/${R1}`), { params: Promise.resolve({ id: R1 }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.entries).toHaveLength(1);
    expect(json.data.balance).toBe(50);
  });

  test('rejects an invalid id and invalid period', async () => {
    const res1 = await statementGET(req('admin', 'GET', 'http://localhost/x'), { params: Promise.resolve({ id: 'bad' }) });
    expect(res1.status).toBe(400);
    const res2 = await statementGET(req('admin', 'GET', `http://localhost/x/${R1}?from=bad`), { params: Promise.resolve({ id: R1 }) });
    expect(res2.status).toBe(400);
  });
});

describe('approvals/[id]', () => {
  test('GET returns an approval for an admin', async () => {
    mockDb = makeDb({ ...baseDb(), approval_requests: [{ id: R1, company_id: C1, entity_type: 'journal_entry', status: 'pending' }] });
    const res = await apprGET(req('admin', 'GET', `http://localhost/x/${R1}`), { params: Promise.resolve({ id: R1 }) });
    expect(res.status).toBe(200);
  });

  test('GET returns 404 when missing', async () => {
    const res = await apprGET(req('admin', 'GET', `http://localhost/x/${R1}`), { params: Promise.resolve({ id: R1 }) });
    expect(res.status).toBe(404);
  });

  test('PUT approves a pending approval', async () => {
    mockDb = makeDb({ ...baseDb(), approval_requests: [{ id: R1, company_id: C1, entity_type: 'journal_entry', status: 'pending' }] });
    mockDb.rpcResults.set('respond_approval_request_atomic', { data: { id: R1, status: 'approved' }, error: null });
    const res = await apprPUT(req('admin', 'PUT', 'http://localhost/x', { action: 'approve' }), { params: Promise.resolve({ id: R1 }) });
    expect(res.status).toBe(200);
  });

  test('PUT replays an already-decided approval', async () => {
    mockDb = makeDb({ ...baseDb(), approval_requests: [{ id: R1, company_id: C1, entity_type: 'journal_entry', status: 'approved' }] });
    const res = await apprPUT(req('admin', 'PUT', 'http://localhost/x', { action: 'approve' }), { params: Promise.resolve({ id: R1 }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.replayed).toBe(true);
  });
});
