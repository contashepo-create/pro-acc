/** Custody HTTP boundaries; PostgreSQL lifecycle/rollback/concurrency guards are
 * exercised by scripts/test-migrations.mjs. */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
// The DB-backed share of the per-user rate limit is out of scope for these
// suites (the memory fast path is what they exercise); the authoritative
// store is covered by shared-rate-limit.test.ts + the 077 migration smoke.
jest.mock('@/lib/shared-rate-limit', () => ({ hitSharedRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }) }));
import { createToken } from '@/lib/auth';

type Row = Record<string, any>;
function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Array<{ op: string; col?: string; val?: any }>; mut?: string }> = [];
  const rpcCalls: Array<{ name: string; params: any }> = [];
  const from = (table: string) => {
    const ops: Array<{ op: string; col?: string; val?: any }> = [];
    const call = { table, ops, mut: undefined as string | undefined }; calls.push(call);
    const rows = () => (db[table] || []).filter((row) => ops.every((op) => {
      if (op.op === 'eq') return row[op.col!] === op.val;
      if (op.op === 'is') return row[op.col!] == null;
      return true;
    }));
    const api: any = {
      select: () => api,
      eq: (col: string, val: any) => { ops.push({ op: 'eq', col, val }); return api; },
      is: (col: string, val: any) => { ops.push({ op: 'is', col, val }); return api; },
      order: () => api, range: () => api, limit: () => api,
      insert: () => { call.mut = 'insert'; return api; },
      update: () => { call.mut = 'update'; return api; },
      delete: () => { call.mut = 'delete'; return api; },
      maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
      single: async () => ({ data: rows()[0] || null, error: rows()[0] ? null : { message: 'not found' } }),
      then: (ok: any, fail: any) => Promise.resolve({ data: rows(), error: null, count: rows().length }).then(ok, fail),
    };
    return api;
  };
  return {
    from, calls, rpcCalls,
    rpc: async (name: string, params: any) => {
      rpcCalls.push({ name, params });
      return { data: name === 'post_custody_expense'
        ? { id: CUSTODY, applied_from_custody: 5, excess: 0 }
        : name === 'settle_custody_file' ? { id: CUSTODY, shortage: 0 } : { id: CUSTODY }, error: null };
    },
  };
}

let mockDb: ReturnType<typeof makeDb>;
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));

import { POST as openPOST } from '@/app/api/custodies/route';
import { GET as detailGET, PUT as detailPUT, DELETE as detailDELETE } from '@/app/api/custodies/[id]/route';
import { POST as addPOST } from '@/app/api/custodies/[id]/add/route';
import { POST as expensePOST } from '@/app/api/custodies/[id]/expense/route';
import { POST as settlePOST } from '@/app/api/custodies/[id]/settle/route';

const C1 = 'company-1'; const C2 = 'company-2'; const USER = 'u1';
const EMPLOYEE = '00000000-0000-4000-8000-000000000101';
const BANK = '00000000-0000-4000-8000-000000000201';
const CUSTODY = '00000000-0000-4000-8000-000000000301';
const FOREIGN_CUSTODY = '00000000-0000-4000-8000-000000000309';
const PROJECT = '00000000-0000-4000-8000-000000000401';
const FOREIGN_PROJECT = '00000000-0000-4000-8000-000000000409';
const EXPENSE_ACCOUNT = '00000000-0000-4000-8000-000000000501';

function seed() {
  return {
    users: [{ id: USER, company_id: C1, is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true }],
    subscriptions: [{ id: 'sub', company_id: C1, status: 'active', end_date: '2099-01-01',
      subscription_plans: { features_modules: { custodies: true } } }],
    custodies: [
      { id: CUSTODY, company_id: C1, employee_id: EMPLOYEE, amount: 20, total_received: 20,
        total_expenses: 0, remaining_amount: 20, date: '2026-08-01', status: 'open', project_id: PROJECT,
        bank_safe_id: BANK, deleted_at: null, employees: { name: 'موظف' }, projects: { name: 'مشروع' }, banks_safes: { name: 'خزينة' } },
      { id: FOREIGN_CUSTODY, company_id: C2, employee_id: EMPLOYEE, amount: 20, status: 'open', deleted_at: null },
    ],
    custody_transactions: [],
    projects: [
      { id: PROJECT, company_id: C1 },
      { id: FOREIGN_PROJECT, company_id: C2 },
    ],
    accounts: [{ id: EXPENSE_ACCOUNT, company_id: C1, code: '5100', type: 'expense', is_active: true, is_header: false }],
  } as Record<string, Row[]>;
}
function request(body?: any, method = 'POST') {
  const token = createToken(USER, 'admin');
  return { url: 'http://localhost/api/custodies', method,
    headers: { get: (key: string) => key === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined }, json: async () => body } as any;
}
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const rpc = (name: string) => mockDb.rpcCalls.find((call) => call.name === name);
beforeEach(() => { mockDb = makeDb(seed()); });

describe('custody lifecycle route boundaries', () => {
  test('opening accepts canonical values only and derives identity from auth', async () => {
    const body = { employee_id: EMPLOYEE, date: '2026-08-01', amount: 20, bank_safe_id: BANK, project_id: PROJECT, reason: 'موقع' };
    expect((await openPOST(request({ ...body, company_id: C2 }))).status).toBe(400);
    expect(mockDb.rpcCalls).toHaveLength(0);
    expect((await openPOST(request(body))).status).toBe(201);
    expect(rpc('open_custody_file')!.params).toMatchObject({
      p_company_id: C1, p_employee_id: EMPLOYEE, p_bank_safe_id: BANK, p_created_by: USER,
    });
  });

  test('foreign detail and metadata are hidden by the company filter', async () => {
    expect((await detailGET(request(undefined, 'GET'), context(FOREIGN_CUSTODY))).status).toBe(404);
    expect((await detailPUT(request({ notes: 'cross' }, 'PUT'), context(FOREIGN_CUSTODY))).status).toBe(404);
    expect(mockDb.rpcCalls).toHaveLength(0);
    expect(mockDb.calls.filter((call) => call.table === 'custodies').every((call) =>
      call.ops.some((op) => op.op === 'eq' && op.col === 'company_id' && op.val === C1),
    )).toBe(true);
  });

  test('metadata updates are strict and use the audited atomic RPC', async () => {
    expect((await detailPUT(request({ notes: 'مراجعة', amount: 99 }, 'PUT'), context(CUSTODY))).status).toBe(400);
    expect((await detailPUT(request({ notes: 'مراجعة' }, 'PUT'), context(CUSTODY))).status).toBe(200);
    expect(rpc('update_custody_metadata_atomic')!.params).toEqual({
      p_company_id: C1, p_custody_id: CUSTODY, p_patch: { notes: 'مراجعة' }, p_user_id: USER,
    });
    expect(mockDb.calls.filter((call) => call.mut)).toHaveLength(0);
  });

  test('fund additions reject leaked form fields and delegate exact values', async () => {
    const body = { amount: 5, date: '2026-08-02', bank_safe_id: BANK, description: 'تعزيز' };
    expect((await addPOST(request({ ...body, returned_cash: 1 }), context(CUSTODY))).status).toBe(400);
    expect((await addPOST(request(body), context(CUSTODY))).status).toBe(201);
    expect(rpc('add_custody_funds')!.params).toMatchObject({
      p_company_id: C1, p_custody_id: CUSTODY, p_amount: 5, p_created_by: USER,
    });
  });

  test('expense project and account lookups are tenant constrained', async () => {
    const foreign = await expensePOST(request({
      amount: 5, description: 'مصروف', project_id: FOREIGN_PROJECT, expense_account_code: '5100',
    }), context(CUSTODY));
    expect(foreign.status).toBe(404);
    expect(mockDb.rpcCalls).toHaveLength(0);
    mockDb.calls.length = 0;
    const own = await expensePOST(request({
      amount: 5, description: 'مصروف', project_id: PROJECT, expense_account_code: '5100',
    }), context(CUSTODY));
    expect(own.status).toBe(201);
    expect(rpc('post_custody_expense')!.params).toMatchObject({
      p_company_id: C1, p_custody_id: CUSTODY, p_expense_account_id: EXPENSE_ACCOUNT, p_project_id: PROJECT,
      p_created_by: USER,
    });
    expect(mockDb.calls.find((call) => call.table === 'accounts')!.ops).toEqual(expect.arrayContaining([
      { op: 'eq', col: 'company_id', val: C1 }, { op: 'eq', col: 'type', val: 'expense' },
    ]));
  });

  test('settlement requires explicit confirmation and carries trusted identity', async () => {
    expect((await settlePOST(request({ returned_cash: 20, bank_safe_id: BANK }), context(CUSTODY))).status).toBe(400);
    expect((await settlePOST(request({ confirm: true, returned_cash: 20, bank_safe_id: BANK }), context(CUSTODY))).status).toBe(200);
    expect(rpc('settle_custody_file')!.params).toMatchObject({
      p_company_id: C1, p_custody_id: CUSTODY, p_returned_cash: 20, p_created_by: USER,
    });
  });

  test('cancellation is reversal-only through its RPC', async () => {
    expect((await detailDELETE(request(undefined, 'DELETE'), context(CUSTODY))).status).toBe(200);
    expect(rpc('cancel_custody_file')!.params).toEqual({
      p_company_id: C1, p_custody_id: CUSTODY, p_created_by: USER,
    });
    expect(mockDb.calls.filter((call) => call.mut)).toHaveLength(0);
  });
});
