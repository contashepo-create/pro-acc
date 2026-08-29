/**
 * Route-boundary tests for purchases/invoices, fiscal/[id]/reopen+close,
 * fiscal/closing, fiscal/reversing, projects/[id]/financials,
 * subscription/upgrade-request.
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
          if (o.op === 'neq') return get(o.col!) !== o.val;
          return true;
        })
      );
    const api: TestBuilder = {
      select: () => api,
      eq: (col: string, val: unknown) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: unknown) => { ops.push({ op: 'in', col, val }); return api; },
      neq: (col: string, val: unknown) => { ops.push({ op: 'neq', col, val }); return api; },
      order: () => api, limit: () => api, range: () => api, is: () => api,
      or: () => api, lt: () => api, gte: () => api, lte: () => api,
      insert: () => api, update: () => api, delete: () => api,
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

import { GET as piGET } from '@/app/api/purchases/invoices/route';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';
import { POST as reopenPOST } from '@/app/api/fiscal/[id]/reopen/route';
import { POST as closePOST } from '@/app/api/fiscal/[id]/close/route';
import { POST as closingPOST } from '@/app/api/fiscal/closing/route';
import { POST as reversingPOST } from '@/app/api/fiscal/reversing/route';
import { GET as finGET } from '@/app/api/projects/[id]/financials/route';
import { GET as upgGET, POST as upgPOST, DELETE as upgDELETE } from '@/app/api/subscription/upgrade-request/route';
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
      subscription_plans: { code: 'enterprise', features_modules: { purchases: true, tax_reports: true, projects: true, subscription: true } } }],
    purchase_invoices: [], purchase_invoice_items: [], projects: [], invoices: [], credit_notes: [],
    upgrade_requests: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { resetRateLimits(); mockDb = makeDb(baseDb()); });

describe('purchases/invoices GET', () => {
  test('lists purchase invoices with items', async () => {
    mockDb = makeDb({ ...baseDb(), purchase_invoices: [{ id: ID1, company_id: C1, contacts: { name: 'مورد' }, paid_amount: 0 }],
      purchase_invoice_items: [{ id: 'it1', purchase_invoice_id: ID1, company_id: C1 }] });
    const res = await piGET(req('admin', 'GET', 'http://localhost/api/purchases/invoices'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.invoices[0].supplier_name).toBe('مورد');
    expect(json.data.invoices[0].items).toHaveLength(1);
  });

  test('rejects an invalid status filter', async () => {
    const res = await piGET(req('admin', 'GET', 'http://localhost/api/purchases/invoices?status=bogus'));
    expect(res.status).toBe(400);
  });
});

describe('fiscal/[id]/reopen', () => {
  test('reopens a fiscal year and maps not-found error', async () => {
    mockDb.rpcResults.set('reopen_fiscal_year_atomic', { data: { id: ID1 }, error: null });
    const res = await reopenPOST(req('admin', 'POST', 'http://localhost/x'), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
    mockDb.rpcResults.set('reopen_fiscal_year_atomic', { data: null, error: { message: 'السنة المالية غير موجودة' } });
    const res2 = await reopenPOST(req('admin', 'POST', 'http://localhost/x'), { params: Promise.resolve({ id: ID1 }) });
    expect(res2.status).toBe(404);
  });
});

describe('fiscal/[id]/close', () => {
  test('closes a fiscal year', async () => {
    mockDb.rpcResults.set('close_fiscal_year_atomic', { data: { id: ID1 }, error: null });
    const res = await closePOST(req('admin', 'POST', 'http://localhost/x'), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });
});

describe('fiscal/closing', () => {
  test('returns 410 for the deprecated endpoint', async () => {
    const res = await closingPOST(req('admin', 'POST', 'http://localhost/x'));
    expect(res.status).toBe(410);
  });
});

describe('fiscal/reversing', () => {
  test('creates a reversing entry', async () => {
    mockDb.rpcResults.set('reverse_journal_entry_atomic', { data: { id: 'rev1' }, error: null });
    const res = await reversingPOST(req('admin', 'POST', 'http://localhost/x', { originalEntryId: ID1, reverseDate: '2026-02-01' }));
    expect(res.status).toBe(201);
  });

  test('rejects a missing originalEntryId and invalid date', async () => {
    const res1 = await reversingPOST(req('admin', 'POST', 'http://localhost/x', {}));
    expect(res1.status).toBe(400);
    const res2 = await reversingPOST(req('admin', 'POST', 'http://localhost/x', { originalEntryId: ID1, reverseDate: 'bad' }));
    expect(res2.status).toBe(400);
  });
});

describe('projects/[id]/financials GET', () => {
  test('returns a project financial summary', async () => {
    mockDb = makeDb({ ...baseDb(), projects: [{ id: ID1, company_id: C1, contract_value: 1000, contacts: { name: 'عميل' } }], invoices: [], credit_notes: [] });
    const res = await finGET(req('admin', 'GET', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });

  test('returns 404 for unknown project', async () => {
    const res = await finGET(req('admin', 'GET', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(404);
  });
});

describe('subscription/upgrade-request', () => {
  test('GET lists the caller requests', async () => {
    mockDb = makeDb({ ...baseDb(), upgrade_requests: [{ id: ID1, company_id: C1, user_id: 'u1', status: 'pending' }] });
    const res = await upgGET(req('admin', 'GET', 'http://localhost/api/subscription/upgrade-request'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.requests).toHaveLength(1);
  });

  test('POST creates an upgrade request (receipts are Telegram-only now)', async () => {
    mockDb.rpcResults.set('create_upgrade_request_atomic', { data: { id: ID1 }, error: null });
    const res = await upgPOST(req('admin', 'POST', 'http://localhost/x', {
      requested_plan_id: ID1, duration_type: 'monthly', payment_method_code: 'bank', payment_amount: 100, payment_date: '2026-01-01',
    }));
    expect(res.status).toBe(201);
  });

  test('POST rejects a stored receipt reference — proof goes via Telegram', async () => {
    const res = await upgPOST(req('admin', 'POST', 'http://localhost/x', {
      requested_plan_id: ID1, duration_type: 'monthly', payment_method_code: 'bank', payment_amount: 100, payment_date: '2026-01-01',
      receipt_image_url: `${C1}/payment-proofs/receipt.jpg`,
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toContain('تليجرام');
  });

  test('DELETE cancels the caller own pending request', async () => {
    mockDb.rpcResults.set('cancel_own_subscription_request', { data: { id: ID1, status: 'cancelled' }, error: null });
    const res = await upgDELETE(req('admin', 'DELETE', `http://localhost/x?id=${ID1}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.request.status).toBe('cancelled');
  });

  test('DELETE rejects an invalid id and maps not-found', async () => {
    const res1 = await upgDELETE(req('admin', 'DELETE', 'http://localhost/x?id=nope'));
    expect(res1.status).toBe(400);
    mockDb.rpcResults.set('cancel_own_subscription_request', { data: null, error: { message: 'request not found or already reviewed' } });
    const res2 = await upgDELETE(req('admin', 'DELETE', `http://localhost/x?id=${ID1}`));
    expect(res2.status).toBe(404);
  });
});
