/**
 * Route-boundary tests for journal (list), cost-centers, boq (list),
 * timesheets (list/detail), quotations/[id], invoices (list),
 * bank-reconciliation/[id], fixed-assets/depreciate.
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
import { createToken } from '@/lib/auth';

type Row = Record<string, unknown>;
type Op = { op: string; col?: string; val?: unknown };

function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Op[] }> = [];
  const rpcResults = new Map<string, { data: unknown; error: unknown }>();
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
      update: (payload: Row) => { const r = (db[table] || [])[0]; if (r) Object.assign(r, payload); return api; },
      delete: () => api,
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

import { GET as journalGET } from '@/app/api/journal/route';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';
import { GET as ccGET, POST as ccPOST } from '@/app/api/cost-centers/route';
import { GET as boqGET, POST as boqPOST } from '@/app/api/boq/route';
import { GET as tsGET, POST as tsPOST } from '@/app/api/timesheets/route';
import { PUT as tsPUT } from '@/app/api/timesheets/[id]/route';
import { GET as quoteGET } from '@/app/api/quotations/[id]/route';
import { GET as invGET } from '@/app/api/invoices/route';
import { GET as brGET, PUT as brPUT, DELETE as brDELETE } from '@/app/api/bank-reconciliation/[id]/route';
import { POST as depPOST } from '@/app/api/fixed-assets/depreciate/route';
import { resetRateLimits } from '@/lib/memory-rate-limit';

const C1 = 'company-1';
const ID1 = '00000000-0000-4000-8000-00000000f0f1';
const ID2 = '00000000-0000-4000-8000-00000000f0f2';

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
      subscription_plans: { code: 'enterprise', features_modules: { journal: true, cost_centers: true, boq: true, employees: true, quotations: true, invoices: true, banks: true, fixed_assets: true } } }],
    journal_entries: [], journal_lines: [], cost_centers: [], boq_items: [], timesheets: [],
    quotations: [], quotation_items: [], invoices: [], bank_reconciliation: [], bank_reconciliation_items: [], accounts: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { resetRateLimits(); mockDb = makeDb(baseDb()); });

describe('journal GET', () => {
  test('lists entries with line summaries', async () => {
    mockDb = makeDb({ ...baseDb(), journal_entries: [{ id: ID1, company_id: C1, number: 1, date: '2026-01-01', type: 'general', description: 'قيد' }],
      journal_lines: [{ journal_entry_id: ID1, company_id: C1, debit: 100, credit: 0 }] });
    const res = await journalGET(req('admin', 'GET', 'http://localhost/api/journal'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.entries[0].total_debit).toBe(100);
  });

  test('rejects an invalid type filter', async () => {
    const res = await journalGET(req('admin', 'GET', 'http://localhost/api/journal?type=bogus'));
    expect(res.status).toBe(400);
  });

  test('rejects an unknown account filter (404)', async () => {
    const res = await journalGET(req('admin', 'GET', `http://localhost/api/journal?account_id=${ID1}`));
    expect(res.status).toBe(404);
  });
});

describe('cost-centers', () => {
  test('GET lists cost centers', async () => {
    mockDb = makeDb({ ...baseDb(), cost_centers: [{ id: ID1, company_id: C1, code: 'CC-1' }] });
    const res = await ccGET(req('admin', 'GET', 'http://localhost/api/cost-centers'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.cost_centers).toHaveLength(1);
  });

  test('POST creates a cost center', async () => {
    const res = await ccPOST(req('admin', 'POST', 'http://localhost/x', { code: 'cc1', name: 'مركز' }));
    expect(res.status).toBe(201);
  });

  test('POST rejects missing code/name and unknown parent', async () => {
    const res1 = await ccPOST(req('admin', 'POST', 'http://localhost/x', { code: 'cc1' }));
    expect(res1.status).toBe(400);
    const res2 = await ccPOST(req('admin', 'POST', 'http://localhost/x', { code: 'cc1', name: 'x', parent_id: ID1 }));
    expect(res2.status).toBe(404);
  });
});

describe('boq', () => {
  test('GET lists boq items', async () => {
    mockDb = makeDb({ ...baseDb(), boq_items: [{ id: ID1, company_id: C1, description: 'بند', projects: { name: 'مشروع' } }] });
    const res = await boqGET(req('admin', 'GET', 'http://localhost/api/boq'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.items[0].project_name).toBe('مشروع');
  });

  test('POST creates a boq item', async () => {
    mockDb.rpcResults.set('create_boq_item_atomic', { data: { id: ID1 }, error: null });
    const res = await boqPOST(req('admin', 'POST', 'http://localhost/api/boq', { project_id: ID1, item_code: 'B1', description: 'بند', unit: 'وحدة', quantity: 1, unit_price: 100 }));
    expect(res.status).toBe(201);
  });
});

describe('timesheets', () => {
  test('GET lists timesheets with summary', async () => {
    mockDb = makeDb({ ...baseDb(), timesheets: [{ id: ID1, company_id: C1, employees: { name: 'موظف' }, projects: { name: 'مشروع' } }] });
    const res = await tsGET(req('admin', 'GET', 'http://localhost/api/timesheets'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.timesheets).toHaveLength(1);
  });

  test('POST rejects a missing employee_id or date', async () => {
    const res = await tsPOST(req('admin', 'POST', 'http://localhost/x', {}));
    expect(res.status).toBe(400);
  });
});

describe('timesheets/[id] PUT', () => {
  test('clocks out and computes hours', async () => {
    mockDb = makeDb({ ...baseDb(), timesheets: [{ id: ID1, company_id: C1, check_in: '2026-01-01T08:00:00Z', status: 'in_progress', break_minutes: 0 }] });
    const res = await tsPUT(req('admin', 'PUT', 'http://localhost/x', { action: 'clock_out', check_out: '2026-01-01T17:00:00Z' }), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.regular_hours).toBe(8);
  });

  test('approves a timesheet', async () => {
    mockDb = makeDb({ ...baseDb(), timesheets: [{ id: ID1, company_id: C1, status: 'submitted' }] });
    const res = await tsPUT(req('admin', 'PUT', 'http://localhost/x', { action: 'approve' }), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });

  test('rejects an invalid action', async () => {
    const res = await tsPUT(req('admin', 'PUT', 'http://localhost/x', { action: 'bogus' }), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(400);
  });
});

describe('quotations/[id] GET', () => {
  test('returns a quotation and 404 when missing', async () => {
    mockDb = makeDb({ ...baseDb(), quotations: [{ id: ID1, company_id: C1, contacts: { name: 'عميل' } }] });
    const res = await quoteGET(req('admin', 'GET', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
    const res2 = await quoteGET(req('admin', 'GET', `http://localhost/x/${ID2}`), { params: Promise.resolve({ id: ID2 }) });
    expect(res2.status).toBe(404);
  });
});

describe('invoices GET', () => {
  test('lists invoices with client names', async () => {
    mockDb = makeDb({ ...baseDb(), invoices: [{ id: ID1, company_id: C1, contact_id: ID2 }], contacts: [{ id: ID2, company_id: C1, name: 'عميل' }] });
    const res = await invGET(req('admin', 'GET', 'http://localhost/api/invoices'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.invoices[0].client_name).toBe('عميل');
  });

  test('rejects an invalid status filter', async () => {
    const res = await invGET(req('admin', 'GET', 'http://localhost/api/invoices?status=bogus'));
    expect(res.status).toBe(400);
  });
});

describe('bank-reconciliation/[id]', () => {
  test('GET returns a reconciliation with items', async () => {
    mockDb = makeDb({ ...baseDb(), bank_reconciliation: [{ id: ID1, company_id: C1, number: 'BR-1' }], bank_reconciliation_items: [{ id: 'i1', reconciliation_id: ID1, company_id: C1 }] });
    const res = await brGET(req('admin', 'GET', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.items).toHaveLength(1);
  });

  test('GET returns 404 when missing', async () => {
    const res = await brGET(req('admin', 'GET', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(404);
  });

  test('PUT updates a reconciliation', async () => {
    mockDb.rpcResults.set('update_bank_reconciliation', { data: { id: ID1 }, error: null });
    const res = await brPUT(req('admin', 'PUT', 'http://localhost/x', { closingBalance: 100 }), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });

  test('DELETE deletes a pending reconciliation', async () => {
    mockDb.rpcResults.set('delete_pending_bank_reconciliation', { data: null, error: null });
    const res = await brDELETE(req('admin', 'DELETE', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });
});

describe('fixed-assets/depreciate POST', () => {
  test('posts a depreciation batch', async () => {
    mockDb.rpcResults.set('depreciate_fixed_assets_batch', { data: { depreciated: 2 }, error: null });
    const res = await depPOST(req('admin', 'POST', 'http://localhost/api/fixed-assets/depreciate'));
    expect(res.status).toBe(200);
  });
});
