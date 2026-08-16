/** Route boundaries for cash, bank reconciliation, petty cash and POS.
 * Ledger balance, rollback, concurrency and trigger guards run against real
 * PostgreSQL in scripts/test-migrations.mjs.
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
import { createToken } from '@/lib/auth';

type Row = Record<string, any>;
type Op = { op: string; col?: string; val?: any };
function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Op[]; mut?: string }> = [];
  const rpcCalls: Array<{ name: string; params: any }> = [];
  const rpcResults = new Map<string, { data: any; error: any }>();
  const from = (table: string) => {
    const ops: Op[] = []; const call = { table, ops, mut: undefined as string | undefined }; calls.push(call);
    const rows = () => (db[table] || []).filter((row) => ops.every((op) => {
      if (op.op === 'eq') return row[op.col!] === op.val;
      if (op.op === 'in') return op.val.includes(row[op.col!]);
      if (op.op === 'gte') return String(row[op.col!]) >= String(op.val);
      if (op.op === 'neq') return row[op.col!] !== op.val;
      return true;
    }));
    const api: any = {
      select: () => api,
      eq: (col: string, val: any) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: any[]) => { ops.push({ op: 'in', col, val }); return api; },
      gte: (col: string, val: any) => { ops.push({ op: 'gte', col, val }); return api; },
      neq: (col: string, val: any) => { ops.push({ op: 'neq', col, val }); return api; },
      is: () => api, or: () => api, lte: () => api, order: () => api, range: () => api, limit: () => api,
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
    from, calls, rpcCalls, rpcResults,
    rpc: async (name: string, params: any) => {
      rpcCalls.push({ name, params });
      return rpcResults.get(name) || { data: { id: RESULT }, error: null };
    },
  };
}

let mockDb: ReturnType<typeof makeDb>;
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));

import { POST as cashPOST } from '@/app/api/cash/route';
import { GET as cashGET, PUT as cashPUT, DELETE as cashDELETE } from '@/app/api/cash/[id]/route';
import { PUT as bankPUT } from '@/app/api/banks/[id]/route';
import { POST as reconciliationPOST } from '@/app/api/bank-reconciliation/route';
import { PUT as reconciliationPUT } from '@/app/api/bank-reconciliation/[id]/route';
import { POST as terminalPOST } from '@/app/api/pos/terminals/route';
import { POST as salePOST } from '@/app/api/pos/sales/route';
import { POST as pettyPOST } from '@/app/api/petty-cash/route';
import { PUT as pettyBoxPUT } from '@/app/api/petty-cash/boxes/route';

const C1 = 'company-1'; const C2 = 'company-2'; const USER = 'u1';
const BANK = '00000000-0000-4000-8000-000000000101';
const FOREIGN_BANK = '00000000-0000-4000-8000-000000000109';
const ACCOUNT = '00000000-0000-4000-8000-000000000201';
const CASH = '00000000-0000-4000-8000-000000000301';
const FOREIGN_CASH = '00000000-0000-4000-8000-000000000309';
const RECONCILIATION = '00000000-0000-4000-8000-000000000401';
const TERMINAL = '00000000-0000-4000-8000-000000000501';
const BOX = '00000000-0000-4000-8000-000000000601';
const RESULT = '00000000-0000-4000-8000-000000000999';

function baseDb() {
  return {
    users: [{ id: USER, company_id: C1, is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01',
      subscription_plans: { features_modules: { banks: true, cash: true, pos: true, petty_cash: true } } }],
    banks_safes: [
      { id: BANK, company_id: C1, type: 'bank', opening_balance: 100, is_active: true },
      { id: FOREIGN_BANK, company_id: C2, type: 'bank', opening_balance: 0, is_active: true },
    ],
    cash_transactions: [
      { id: CASH, company_id: C1, reason: 'own', status: 'active' },
      { id: FOREIGN_CASH, company_id: C2, reason: 'foreign', status: 'active' },
    ],
  } as Record<string, Row[]>;
}
function request(body?: any, method = 'POST') {
  const token = createToken(USER, 'admin');
  return { url: 'http://localhost/api/test', method,
    headers: { get: (key: string) => key === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined }, json: async () => body } as any;
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const rpc = (name: string) => mockDb.rpcCalls.find((call) => call.name === name);
beforeEach(() => { mockDb = makeDb(baseDb()); });

describe('cash lifecycle boundary', () => {
  test('posts trusted tenant/user and canonical values through one RPC', async () => {
    const response = await cashPOST(request({
      date: '2026-08-01', type: 'expense', amount: 10.25, bankSafeId: BANK,
      accountId: ACCOUNT, reason: 'مصروف', tax_enabled: true, tax_rate: 0.1234,
    }));
    expect(response.status).toBe(201);
    expect(rpc('post_cash_transaction')!.params).toMatchObject({
      p_company_id: C1, p_created_by: USER, p_bank_safe_id: BANK,
      p_account_id: ACCOUNT, p_amount: 10.25, p_tax_rate: 0.1234,
    });
    expect(mockDb.calls.filter((call) => call.mut)).toHaveLength(0);
  });

  test('rejects invalid precision and caller-supplied fields before RPC', async () => {
    const body = { date: '2026-08-01', type: 'expense', amount: 1.001, bankSafeId: BANK, reason: 'x' };
    expect((await cashPOST(request(body))).status).toBe(400);
    expect((await cashPOST(request({ ...body, amount: 1, company_id: C2 }))).status).toBe(400);
    expect(mockDb.rpcCalls).toHaveLength(0);
  });

  test('detail lookup hides a foreign transaction', async () => {
    expect((await cashGET(request(undefined, 'GET'), params(FOREIGN_CASH))).status).toBe(404);
    const call = mockDb.calls.find((value) => value.table === 'cash_transactions')!;
    expect(call.ops).toContainEqual({ op: 'eq', col: 'company_id', val: C1 });
  });

  test('note correction and cancellation carry tenant/user into atomic RPCs', async () => {
    expect((await cashPUT(request({ reason: 'تصحيح' }, 'PUT'), params(CASH))).status).toBe(200);
    expect(rpc('update_cash_transaction_note')!.params).toMatchObject({
      p_company_id: C1, p_transaction_id: CASH, p_user_id: USER,
    });
    mockDb.rpcCalls.length = 0;
    expect((await cashDELETE(request(undefined, 'DELETE'), params(CASH))).status).toBe(200);
    expect(rpc('cancel_cash_transaction')!.params).toMatchObject({
      p_company_id: C1, p_transaction_id: CASH, p_user_id: USER,
    });
  });
});

describe('bank and reconciliation boundaries', () => {
  test('bank metadata update uses audited RPC and accepts unchanged legacy immutable fields', async () => {
    const response = await bankPUT(request({ name: 'البنك المعدل', type: 'bank', opening_balance: 100 }, 'PUT'), params(BANK));
    expect(response.status).toBe(200);
    expect(rpc('update_bank_safe_metadata_atomic')!.params).toEqual({
      p_company_id: C1, p_bank_safe_id: BANK, p_patch: { name: 'البنك المعدل' }, p_user_id: USER,
    });
    expect(mockDb.calls.filter((call) => call.mut)).toHaveLength(0);
  });

  test('foreign bank metadata is hidden before mutation', async () => {
    expect((await bankPUT(request({ name: 'x' }, 'PUT'), params(FOREIGN_BANK))).status).toBe(404);
    expect(mockDb.rpcCalls).toHaveLength(0);
  });

  test('reconciliation creation validates items and delegates the ledger snapshot', async () => {
    const response = await reconciliationPOST(request({
      bankSafeId: BANK, date: '2026-08-01', closingBalance: 99.5,
      items: [{ transactionType: 'شيك معلق', amount: 10, isCleared: false }],
    }));
    expect(response.status).toBe(201);
    expect(rpc('create_bank_reconciliation')!.params).toMatchObject({
      p_company_id: C1, p_bank_safe_id: BANK, p_closing_balance: 99.5, p_user_id: USER,
    });
  });

  test('completion is tenant/user bound and financial fields are strict', async () => {
    expect((await reconciliationPUT(request({ status: 'completed' }, 'PUT'), params(RECONCILIATION))).status).toBe(200);
    expect(rpc('update_bank_reconciliation')!.params).toMatchObject({
      p_company_id: C1, p_reconciliation_id: RECONCILIATION, p_complete: true, p_user_id: USER,
    });
    mockDb.rpcCalls.length = 0;
    expect((await reconciliationPUT(request({ status: 'pending' }, 'PUT'), params(RECONCILIATION))).status).toBe(400);
    expect(mockDb.rpcCalls).toHaveLength(0);
  });
});

describe('petty cash and POS boundaries', () => {
  test('petty-cash receipt references must be in the authenticated tenant path', async () => {
    const body = { box_id: BOX, type: 'withdrawal', amount: 5, reason: 'مصاريف', receipt_url: `${C2}/foreign.pdf` };
    expect((await pettyPOST(request(body))).status).toBe(403);
    expect(mockDb.rpcCalls).toHaveLength(0);
  });

  test('petty reconcile delegates physical count with trusted identity', async () => {
    expect((await pettyBoxPUT(request({ box_id: BOX, action: 'reconcile', physical_count: 12.5 }, 'PUT'))).status).toBe(200);
    expect(rpc('reconcile_petty_cash_box')!.params).toMatchObject({
      p_company_id: C1, p_box_id: BOX, p_physical_count: 12.5, p_user_id: USER,
    });
  });

  test('terminal creation uses one tenant-bound audited RPC', async () => {
    expect((await terminalPOST(request({ code: 'T2', name: 'طرفية', bank_safe_id: BANK }))).status).toBe(201);
    expect(rpc('create_pos_terminal_atomic')!.params).toEqual({
      p_company_id: C1, p_code: 'T2', p_name: 'طرفية', p_bank_safe_id: BANK,
      p_branch_id: null, p_user_id: USER,
    });
    expect(mockDb.calls.filter((call) => call.mut)).toHaveLength(0);
  });

  test('POS sale validates terminal UUID and delegates accounting effects', async () => {
    expect((await salePOST(request({ terminal_id: 'bad', total: 10 }))).status).toBe(400);
    expect((await salePOST(request({ terminal_id: TERMINAL, total: 10, payment_method: 'card' }))).status).toBe(201);
    expect(rpc('create_pos_sale_atomic')!.params).toMatchObject({
      p_company_id: C1, p_terminal_id: TERMINAL, p_total: 10, p_user_id: USER,
    });
  });
});
