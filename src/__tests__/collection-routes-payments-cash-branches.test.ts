/**
 * Route-boundary tests for collection/list routes: payments, complaints,
 * cash, petty-cash, branches, budgets, project-expenses.
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
import { createToken } from '@/lib/auth';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';

const initPaymentMock = jest.fn();
const getPaymentStatusMock = jest.fn();
jest.mock('@/lib/payments/moyasar', () => ({
  initPayment: (...a: unknown[]) => initPaymentMock(...a),
  getPaymentStatus: (...a: unknown[]) => getPaymentStatusMock(...a),
  mapPaymentStatus: (s: string) => s,
}));

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
      ilike: () => api, order: () => api, limit: () => api, range: () => api, is: () => api,
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

import { GET as payGET, POST as payPOST, PUT as payPUT } from '@/app/api/payments/route';
import { GET as compGET, POST as compPOST } from '@/app/api/complaints/route';
import { GET as cashGET, POST as cashPOST } from '@/app/api/cash/route';
import { GET as pcGET, POST as pcPOST } from '@/app/api/petty-cash/route';
import { GET as branchGET, POST as branchPOST } from '@/app/api/branches/route';
import { GET as budgetGET, POST as budgetPOST } from '@/app/api/budgets/route';
import { GET as peGET, POST as pePOST } from '@/app/api/project-expenses/route';
import { resetRateLimits } from '@/lib/memory-rate-limit';

const C1 = 'company-1';
const ID1 = '00000000-0000-4000-8000-00000000f0b1';
const INV = '00000000-0000-4000-8000-00000000f0c1';

function req(role = 'admin', method = 'GET', url = 'http://localhost/x', body?: any, extraHeaders: Record<string, string> = {}) {
  const token = createToken('u1', role, 0);
  return { url, method, nextUrl: new URL(url), headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : (extraHeaders[k] ?? null) },
    cookies: { get: () => undefined }, json: async () => body } as unknown as NextRequest;
}

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, name: 'مدير', email: 'admin@example.com', is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true, name: 'شركة' }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: { invoices: true, cash: true, petty_cash: true, branches: true, budgets: true, projects: true, complaints: true } } }],
    payment_records: [], invoices: [], banks_safes: [], complaints: [], cash_transactions: [],
    petty_cash_boxes: [], petty_cash_transactions: [], branches: [], projects: [],
    project_expenses: [], accounts: [], contacts: [], financial_audit_log: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { resetRateLimits(); initPaymentMock.mockReset(); getPaymentStatusMock.mockReset(); mockDb = makeDb(baseDb()); });

describe('payments GET', () => {
  test('lists payment records optionally filtered by invoice', async () => {
    mockDb = makeDb({ ...baseDb(), payment_records: [{ id: ID1, company_id: C1, invoice_id: INV }] });
    const res = await payGET(req('admin', 'GET', `http://localhost/api/payments?invoice_id=${INV}`));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.payments).toHaveLength(1);
  });
});

describe('payments POST', () => {
  test('initiates a gateway payment', async () => {
    initPaymentMock.mockResolvedValue({ paymentId: 'g1', paymentUrl: 'https://pay' });
    mockDb = makeDb({ ...baseDb(), invoices: [{ id: INV, company_id: C1, number: 1, total: 100, paid_amount: 0, status: 'unpaid', contacts: { name: 'عميل', email: 'c@e.com' } }] });
    const res = await payPOST(req('admin', 'POST', 'http://localhost/api/payments', { invoice_id: INV }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.paymentId).toBe('g1');
  });

  test('creates a manual pending record when the gateway is unavailable', async () => {
    initPaymentMock.mockRejectedValue(new Error('down'));
    mockDb = makeDb({ ...baseDb(), invoices: [{ id: INV, company_id: C1, number: 1, total: 100, paid_amount: 0, status: 'unpaid' }] });
    const res = await payPOST(req('admin', 'POST', 'http://localhost/api/payments', { invoice_id: INV }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.message).toContain('يدوي');
  });

  test('rejects a missing invoice_id and paid invoices', async () => {
    const res1 = await payPOST(req('admin', 'POST', 'http://localhost/api/payments', {}));
    expect(res1.status).toBe(400);
    mockDb = makeDb({ ...baseDb(), invoices: [{ id: INV, company_id: C1, number: 1, total: 100, paid_amount: 100, status: 'paid' }] });
    const res2 = await payPOST(req('admin', 'POST', 'http://localhost/api/payments', { invoice_id: INV }));
    expect(res2.status).toBe(400);
  });

  test('rejects an unknown invoice', async () => {
    const res = await payPOST(req('admin', 'POST', 'http://localhost/api/payments', { invoice_id: INV }));
    expect(res.status).toBe(404);
  });
});

describe('payments PUT', () => {
  test('replays an already-processed paid record', async () => {
    mockDb = makeDb({ ...baseDb(), payment_records: [{ id: ID1, company_id: C1, invoice_id: INV, amount: 100, status: 'paid', payment_gateway_id: 'g1', journal_entry_id: 'je1' }] });
    const res = await payPUT(req('admin', 'PUT', `http://localhost/api/payments?id=${ID1}`, {}));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.alreadyProcessed).toBe(true);
  });

  test('rejects a manual payment record (409)', async () => {
    mockDb = makeDb({ ...baseDb(), payment_records: [{ id: ID1, company_id: C1, invoice_id: INV, amount: 100, status: 'pending', payment_gateway_id: 'manual_x' }] });
    const res = await payPUT(req('admin', 'PUT', `http://localhost/api/payments?id=${ID1}`, {}));
    expect(res.status).toBe(409);
  });
});

describe('complaints', () => {
  test('GET tracks a complaint by tracking id', async () => {
    mockDb = makeDb({ ...baseDb(), complaints: [{ id: ID1, subject: 'شكوى', status: 'open' }] });
    const res = await compGET(req('admin', 'GET', `http://localhost/api/complaints?tracking_id=${ID1}`));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.subject).toBe('شكوى');
  });

  test('GET lists tenant complaints', async () => {
    mockDb = makeDb({ ...baseDb(), complaints: [{ id: ID1, company_id: C1, subject: 'شكوى', users: { name: 'م' } }] });
    const res = await compGET(req('admin', 'GET', 'http://localhost/api/complaints'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.complaints[0].user_name).toBe('م');
  });

  test('POST accepts a public complaint', async () => {
    mockDb.rpcResults.set('create_complaint_atomic', { data: { id: ID1 }, error: null });
    const publicReq = { url: 'http://localhost/api/complaints', method: 'POST', nextUrl: new URL('http://localhost/api/complaints'),
      headers: { get: () => null }, cookies: { get: () => undefined }, json: async () => ({ name: 'م', email: 'a@b.co', subject: 'شكوى', message: 'مشكلة كبيرة' }) } as unknown as NextRequest;
    const res = await compPOST(publicReq);
    expect(res.status).toBe(201);
  });

  test('POST accepts a tenant complaint', async () => {
    mockDb.rpcResults.set('create_complaint_atomic', { data: { id: ID1 }, error: null });
    const res = await compPOST(req('admin', 'POST', 'http://localhost/api/complaints', { subject: 'شكوى', body: 'مشكلة' }));
    expect(res.status).toBe(201);
  });
});

describe('cash', () => {
  test('GET lists cash transactions', async () => {
    mockDb = makeDb({ ...baseDb(), cash_transactions: [{ id: ID1, company_id: C1, status: 'posted' }] });
    const res = await cashGET(req('admin', 'GET', 'http://localhost/api/cash'));
    expect(res.status).toBe(200);
  });

  test('POST posts a cash transaction', async () => {
    mockDb.rpcResults.set('post_cash_transaction', { data: { id: ID1 }, error: null });
    const res = await cashPOST(req('admin', 'POST', 'http://localhost/api/cash', {
      date: '2026-01-01', type: 'receipt', amount: 100, bankSafeId: ID1, reason: 'مقبوض',
    }));
    expect(res.status).toBe(201);
  });

  test('POST rejects an invalid cash payload', async () => {
    const res = await cashPOST(req('admin', 'POST', 'http://localhost/api/cash', { date: 'bad', type: 'x', amount: -1, bankSafeId: 'x', reason: '' }));
    expect(res.status).toBe(400);
  });
});

describe('petty-cash', () => {
  test('GET lists boxes and transactions', async () => {
    mockDb = makeDb({ ...baseDb(), petty_cash_boxes: [{ id: ID1, company_id: C1, name: 'صندوق' }] });
    mockDb.rpcResults.set('get_petty_cash_balances', { data: [{ box_id: ID1, current_balance: 10 }], error: null });
    const res = await pcGET(req('admin', 'GET', 'http://localhost/api/petty-cash'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.boxes[0].current_balance).toBe(10);
  });

  test('POST posts a petty cash transaction', async () => {
    mockDb.rpcResults.set('post_petty_cash_transaction', { data: { id: ID1 }, error: null });
    const res = await pcPOST(req('admin', 'POST', 'http://localhost/api/petty-cash', { box_id: ID1, type: 'withdrawal', amount: 50, reason: 'مصاريف' }));
    expect(res.status).toBe(201);
  });

  test('POST rejects a cross-company receipt reference', async () => {
    mockDb.rpcResults.set('post_petty_cash_transaction', { data: { id: ID1 }, error: null });
    const res = await pcPOST(req('admin', 'POST', 'http://localhost/api/petty-cash', { box_id: ID1, type: 'withdrawal', amount: 50, reason: 'م', receipt_url: 'other-company/x' }));
    expect(res.status).toBe(403);
  });
});

describe('branches', () => {
  test('GET lists branches', async () => {
    mockDb = makeDb({ ...baseDb(), branches: [{ id: ID1, company_id: C1, code: 'BR-1', users: { name: 'مدير' } }] });
    const res = await branchGET(req('admin', 'GET', 'http://localhost/api/branches'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.branches[0].manager_name).toBe('مدير');
  });

  test('POST creates a branch', async () => {
    mockDb = makeDb({ ...baseDb(), branches: [] });
    const res = await branchPOST(req('admin', 'POST', 'http://localhost/api/branches', { code: 'BR1', name: 'فرع' }));
    expect(res.status).toBe(201);
  });

  test('POST rejects missing code or name', async () => {
    const res = await branchPOST(req('admin', 'POST', 'http://localhost/api/branches', { code: 'BR1' }));
    expect(res.status).toBe(400);
  });
});

describe('budgets', () => {
  test('GET lists budgets with variance', async () => {
    mockDb.rpcResults.set('get_project_budget_rows', { data: [{ project_id: ID1, category: 'materials', amount: 1000, actual_spent: 600 }], error: null });
    const res = await budgetGET(req('admin', 'GET', 'http://localhost/api/budgets'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.budgets[0].variance).toBe(400);
    expect(json.data.budgets[0].is_over_budget).toBe(false);
  });

  test('POST creates a budget', async () => {
    mockDb.rpcResults.set('create_project_budget_atomic', { data: { id: ID1 }, error: null });
    const res = await budgetPOST(req('admin', 'POST', 'http://localhost/api/budgets', { project_id: ID1, category: 'materials', amount: 1000 }));
    expect(res.status).toBe(201);
  });

  test('POST rejects an invalid budget payload', async () => {
    const res = await budgetPOST(req('admin', 'POST', 'http://localhost/api/budgets', { project_id: 'bad', category: 'materials', amount: 1000 }));
    expect(res.status).toBe(400);
  });
});

describe('project-expenses', () => {
  test('GET lists project expenses', async () => {
    mockDb = makeDb({ ...baseDb(), project_expenses: [{ id: ID1, company_id: C1, projects: { name: 'مشروع' } }] });
    const res = await peGET(req('admin', 'GET', 'http://localhost/api/project-expenses'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.expenses[0].project_name).toBe('مشروع');
  });

  test('POST posts a project expense', async () => {
    mockDb = makeDb({ ...baseDb(), projects: [{ id: ID1, company_id: C1 }], accounts: [{ id: 'acc1', company_id: C1, code: '5110', is_active: true }] });
    mockDb.rpcResults.set('post_project_expense', { data: { id: ID1 }, error: null });
    const res = await pePOST(req('admin', 'POST', 'http://localhost/api/project-expenses', {
      project_id: ID1, expense_type: 'materials', description: 'خامات', amount: 500, date: '2026-01-01',
    }));
    expect(res.status).toBe(201);
  });

  test('POST rejects a missing project expense account', async () => {
    mockDb = makeDb({ ...baseDb(), projects: [{ id: ID1, company_id: C1 }], accounts: [] });
    const res = await pePOST(req('admin', 'POST', 'http://localhost/api/project-expenses', {
      project_id: ID1, expense_type: 'materials', description: 'خامات', amount: 500, date: '2026-01-01',
    }));
    expect(res.status).toBe(400);
  });
});
