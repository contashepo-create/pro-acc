/** Route-boundary tests for voucher and bank atomic RPCs.
 *
 * Ledger direction, allocation rollback, concurrency and tenant enforcement are
 * exercised against PostgreSQL in scripts/test-migrations.mjs. These tests
 * deliberately verify the HTTP boundary instead of reimplementing those RPCs
 * as a JavaScript mock.
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';

// The DB-backed share of the per-user rate limit is out of scope for these
// suites (the memory fast path is what they exercise); the authoritative
// store is covered by shared-rate-limit.test.ts + the 077 migration smoke.
jest.mock('@/lib/shared-rate-limit', () => ({ hitSharedRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }) }));
import { createToken } from '@/lib/auth';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
type Op = { op: string; col?: string; val?: unknown };
type RpcResult = { data: unknown; error: unknown };

function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Op[]; mut: { kind?: string; payload?: Row | Row[] } }> = [];
  const rpcCalls: Array<{ name: string; params?: Row }> = [];
  const rpcResults = new Map<string, RpcResult>();
  const from = (table: string) => {
    const ops: Op[] = [];
    const mut: { kind?: string; payload?: Row | Row[] } = {};
    calls.push({ table, ops, mut });
    const rows = () => (db[table] || []).filter((row) => ops.every((op) => {
      if (op.op === 'eq') return row[op.col!] === op.val;
      if (op.op === 'neq') return row[op.col!] !== op.val;
      if (op.op === 'in') return (op.val as unknown[]).includes(row[op.col!]);
      if (op.op === 'gte') return String(row[op.col!]) >= String(op.val);
      if (op.op === 'lte') return String(row[op.col!]) <= String(op.val);
      return true;
    }));
    const api: TestBuilder = {
      select: () => api,
      eq: (col: string, val: unknown) => { ops.push({ op: 'eq', col, val }); return api; },
      neq: (col: string, val: unknown) => { ops.push({ op: 'neq', col, val }); return api; },
      in: (col: string, val: unknown) => { ops.push({ op: 'in', col, val }); return api; },
      gte: (col: string, val: unknown) => { ops.push({ op: 'gte', col, val }); return api; },
      lte: (col: string, val: unknown) => { ops.push({ op: 'lte', col, val }); return api; },
      is: () => api, or: () => api, order: () => api, limit: () => api, range: () => api,
      insert: (payload: Row | Row[]) => { mut.kind = 'insert'; mut.payload = payload; return api; },
      update: (payload: Row) => { mut.kind = 'update'; mut.payload = payload; return api; },
      delete: () => { mut.kind = 'delete'; return api; },
      maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
      single: async () => ({ data: rows()[0] || null, error: rows()[0] ? null : { message: 'not found' } }),
      then: <T1 = { data: unknown; error: unknown; count?: number }, T2 = never>(
        ok?: ((v: { data: unknown; error: unknown; count?: number }) => T1 | PromiseLike<T1>) | null,
        fail?: ((e: unknown) => T2 | PromiseLike<T2>) | null,
      ) => Promise.resolve({ data: rows(), error: null, count: rows().length }).then(ok ?? undefined, fail ?? undefined),
    };
    return api;
  };
  const client = {
    from, calls, rpcCalls, rpcResults,
    rpc: async (name: string, params?: Row): Promise<RpcResult> => {
      rpcCalls.push({ name, params });
      return rpcResults.get(name) || { data: { id: `${name}-id`, status: 'posted' }, error: null };
    },
  };
  return client;
}

let mockDb: ReturnType<typeof makeDb>;
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));
jest.mock('@/lib/permissions', () => ({
  canBypassTelegramConfirmation: jest.fn(async () => true),
  hasModulePermission: jest.fn(async () => true),
}));
jest.mock('@/lib/notifications', () => ({
  checkApprovalThreshold: jest.fn(async () => ({ requiresApproval: false })),
  sendApprovalRequestNotification: jest.fn(async () => undefined),
  requireApproval: jest.fn(async () => null),
}));

import { POST as receiptPOST, GET as receiptGET } from '@/app/api/vouchers/receipt/route';
import { PUT as receiptPUT, DELETE as receiptDELETE } from '@/app/api/vouchers/receipt/[id]/route';
import { POST as disbursementPOST, GET as disbursementGET } from '@/app/api/vouchers/disbursement/route';
import { PUT as disbursementPUT, DELETE as disbursementDELETE } from '@/app/api/vouchers/disbursement/[id]/route';
import { POST as bankPOST } from '@/app/api/banks/route';
import { canBypassTelegramConfirmation } from '@/lib/permissions';
import { checkApprovalThreshold, sendApprovalRequestNotification } from '@/lib/notifications';

const mockCanBypass = jest.mocked(canBypassTelegramConfirmation);
const mockCheckApprovalThreshold = jest.mocked(checkApprovalThreshold);
const mockSendApprovalRequestNotification = jest.mocked(sendApprovalRequestNotification);

const C1 = 'company-1';
const USER = 'u1';
const CONTACT = '00000000-0000-4000-8000-000000000c01';
const SAFE = '00000000-0000-4000-8000-000000000ba1';

function baseDb() {
  return {
    users: [{ id: USER, company_id: C1, is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true }],
    subscriptions: [{
      id: 'sub-1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: { banks: true } },
    }],
    settings: [],
    voucher_receipts: [],
    voucher_disbursements: [],
    contacts: [{ id: CONTACT, company_id: C1, name: 'طرف' }],
    employees: [],
  } as Record<string, Row[]>;
}

function request(body?: Row, method = 'POST', url = 'http://localhost/api/test') {
  const token = createToken(USER, 'admin');
  return {
    url, method,
    headers: { get: (key: string) => key === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined },
    json: async () => body,
  } as unknown as NextRequest;
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const rpc = (name: string) => mockDb.rpcCalls.find((call) => call.name === name);

beforeEach(() => {
  mockDb = makeDb(baseDb());
  mockCanBypass.mockResolvedValue(true);
  mockCheckApprovalThreshold.mockResolvedValue({ requiresApproval: false });
  mockSendApprovalRequestNotification.mockResolvedValue(undefined);
});

describe('voucher atomic route boundaries', () => {
  test('receipt validates a required client contact before calling PostgreSQL', async () => {
    const response = await receiptPOST(request({ date: '2026-08-01', receipt_type: 'client', amount: 10, bank_safe_id: SAFE, reason: 'x' }));
    expect(response.status).toBe(400);
    expect(mockDb.rpcCalls).toHaveLength(0);
  });

  test('receipt rejects duplicate explicit allocations before the RPC', async () => {
    const response = await receiptPOST(request({
      date: '2026-08-01', receipt_type: 'client', contact_id: CONTACT, amount: 10, bank_safe_id: SAFE, reason: 'x',
      invoice_items: [{ invoice_id: 'i1', amount: 5 }, { invoice_id: 'i1', amount: 5 }],
    }));
    expect(response.status).toBe(400);
    expect(mockDb.rpcCalls).toHaveLength(0);
  });

  test('receipt passes trusted tenant/user and normalized values only to its atomic RPC', async () => {
    const response = await receiptPOST(request({
      date: '2026-08-01', receiptType: 'client', contactId: CONTACT, amount: '125.50', bankSafeId: SAFE, reason: 'تحصيل',
    }));
    expect(response.status).toBe(201);
    expect(rpc('create_voucher_receipt_atomic')!.params).toMatchObject({
      p_company_id: C1, p_user_id: USER, p_contact_id: CONTACT, p_bank_safe_id: SAFE,
      p_amount: 125.5, p_request_approval: false,
    });
    // Only the financial audit trail is written directly (fail-open logging);
    // no business data bypasses the atomic RPC.
    const nonAuditMutations = mockDb.calls.filter((call) => call.mut.kind && call.table !== 'financial_audit_trails');
    expect(nonAuditMutations).toHaveLength(0);
  });

  test('additional user persists an unposted approval request when approval configuration is unavailable', async () => {
    const db = baseDb();
    db.users[0].role = 'accountant';
    mockDb = makeDb(db);
    mockDb.rpcResults.set('create_voucher_receipt_atomic', {
      data: { id: 'vr-pending', status: 'pending', requires_approval: true, approval_id: 'approval-1' },
      error: null,
    });
    mockCanBypass.mockResolvedValueOnce(false);
    mockCheckApprovalThreshold.mockResolvedValueOnce({
      requiresApproval: true,
      configurationUnavailable: true,
    });

    const response = await receiptPOST(request({
      date: '2026-08-01', receipt_type: 'client', contact_id: CONTACT,
      amount: 125.5, bank_safe_id: SAFE, reason: 'تحصيل من عميل',
    }));
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(json.success).toBe(true);
    expect(json.data).toMatchObject({
      requiresApproval: true, blocked: true,
      transactionId: 'vr-pending', approvalId: 'approval-1',
    });
    expect(json.data.message).toMatch(/تم حفظ طلب الاعتماد/);
    expect(rpc('create_voucher_receipt_atomic')!.params).toMatchObject({
      p_company_id: C1, p_user_id: USER, p_request_approval: true,
    });
    expect(mockSendApprovalRequestNotification).not.toHaveBeenCalled();
  });

  test('employee advance disbursement requires an employee before its RPC', async () => {
    const response = await disbursementPOST(request({
      date: '2026-08-01', disbursement_type: 'employee_advance', amount: 10, bank_safe_id: SAFE, reason: 'x',
    }));
    expect(response.status).toBe(400);
    expect(mockDb.rpcCalls).toHaveLength(0);
  });

  test('disbursement passes tenant, party and amount to the atomic writer', async () => {
    const response = await disbursementPOST(request({
      date: '2026-08-01', disbursement_type: 'supplier', contact_id: CONTACT,
      amount: 75, bank_safe_id: SAFE, reason: 'سداد',
    }));
    expect(response.status).toBe(201);
    expect(rpc('create_voucher_disbursement_atomic')!.params).toMatchObject({
      p_company_id: C1, p_user_id: USER, p_contact_id: CONTACT, p_amount: 75,
      p_bank_safe_id: SAFE, p_request_approval: false,
    });
  });

  test.each([
    ['update_voucher_receipt_atomic', (req: NextRequest) => receiptPUT(req, params('vr-1'))],
    ['cancel_voucher_receipt_atomic', (req: NextRequest) => receiptDELETE(req, params('vr-1'))],
    ['update_voucher_disbursement_atomic', (req: NextRequest) => disbursementPUT(req, params('vd-1'))],
    ['cancel_voucher_disbursement_atomic', (req: NextRequest) => disbursementDELETE(req, params('vd-1'))],
  ])('%s receives company and actor identity from the session', async (rpcName, invoke) => {
    const response = await invoke(request(rpcName.startsWith('update') ? { amount: 20 } : undefined, rpcName.startsWith('update') ? 'PUT' : 'DELETE'));
    expect(response.status).toBe(200);
    expect(rpc(rpcName)!.params).toMatchObject({ p_company_id: C1, p_user_id: USER });
  });

  test('list endpoints keep tenant and cancelled filters and retain the legacy disbursements key', async () => {
    (baseDb().voucher_disbursements as Row[]).push();
    mockDb = makeDb({ ...baseDb(), voucher_disbursements: [
      { id: 'ok', company_id: C1, status: 'posted', date: '2026-08-01', disbursement_type: 'other' },
      { id: 'cancelled', company_id: C1, status: 'cancelled', date: '2026-08-01', disbursement_type: 'other' },
    ] });
    const disbResponse = await disbursementGET(request(undefined, 'GET'));
    const disbJson = await disbResponse.json();
    expect(disbJson.data.disbursements.map((row: Row) => row.id)).toEqual(['ok']);
    expect(disbJson.data.vouchers).toEqual(disbJson.data.disbursements);

    const receiptResponse = await receiptGET(request(undefined, 'GET'));
    expect(receiptResponse.status).toBe(200);
    for (const call of mockDb.calls.filter((item) => ['voucher_receipts', 'voucher_disbursements'].includes(item.table))) {
      expect(call.ops).toEqual(expect.arrayContaining([expect.objectContaining({ op: 'eq', col: 'company_id', val: C1 })]));
    }
  });
});

describe('bank creation boundary', () => {
  test('validates type before calling the atomic bank writer', async () => {
    const response = await bankPOST(request({ name: 'غير صالح', type: 'wallet' }));
    expect(response.status).toBe(400);
    expect(mockDb.rpcCalls).toHaveLength(0);
  });

  test('delegates account allocation, opening journal and audit to create_bank_safe', async () => {
    const response = await bankPOST(request({ name: 'الخزينة', type: 'safe', opening_balance: 100 }));
    expect(response.status).toBe(201);
    expect(rpc('create_bank_safe')!.params).toEqual({
      p_company_id: C1, p_name: 'الخزينة', p_type: 'safe', p_account_number: '',
      p_opening_balance: 100, p_user_id: USER,
    });
    expect(mockDb.calls.filter((call) => call.mut.kind)).toHaveLength(0);
  });
});
