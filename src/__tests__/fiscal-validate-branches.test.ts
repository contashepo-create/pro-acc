/**
 * Route-boundary tests for remaining fiscal/validate-balances branches
 * (empty accounts, equity issues, POST pre-validation).
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
          return true;
        })
      );
    const api: TestBuilder = {
      select: () => api,
      eq: (col: string, val: unknown) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: unknown) => { ops.push({ op: 'in', col, val }); return api; },
      order: () => api, limit: () => api, range: () => api, is: () => api, neq: () => api,
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
    from, calls, rpcResults, db,
    rpc: async (name: string) => rpcResults.get(name) || { data: null, error: null },
  };
}

let mockDb: ReturnType<typeof makeDb>;
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));

import { GET as validateGET, POST as validatePOST } from '@/app/api/fiscal/validate-balances/route';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';
import { resetRateLimits } from '@/lib/memory-rate-limit';

const C1 = 'company-1';
const A1 = '00000000-0000-4000-8000-0000000000a1';
const A2 = '00000000-0000-4000-8000-0000000000b1';
const A3 = '00000000-0000-4000-8000-0000000000c1';
const A4 = '00000000-0000-4000-8000-0000000000d1';

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
      subscription_plans: { code: 'enterprise', features_modules: { fiscal: true } } }],
    accounts: [], journal_lines: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { resetRateLimits(); mockDb = makeDb(baseDb()); });

describe('fiscal/validate-balances GET remaining branches', () => {
  test('returns an empty result when there are no accounts', async () => {
    const res = await validateGET(req('admin', 'GET', 'http://localhost/api/fiscal/validate-balances'));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.totalIssues).toBe(0);
    expect(body.data.accounts).toEqual([]);
  });

  test('flags a positive equity balance as an issue', async () => {
    mockDb.db.accounts.push({ id: A1, company_id: C1, code: '3100', name: 'رأس المال', type: 'equity', parent_id: null, is_active: true });
    mockDb.db.journal_lines.push({ id: 'l1', company_id: C1, account_id: A1, debit: 500, credit: 0 });
    const res = await validateGET(req('admin', 'GET', 'http://localhost/api/fiscal/validate-balances'));
    const body = await res.json();
    expect(body.data.totalIssues).toBe(1);
    expect(body.data.issues[0].issueType).toBe('equity_positive');
  });

  test('accepts valid equity, revenue and expense accounts', async () => {
    mockDb.db.accounts.push(
      { id: A1, company_id: C1, code: '3100', name: 'رأس المال', type: 'equity', parent_id: null, is_active: true },
      { id: A2, company_id: C1, code: '4100', name: 'إيراد', type: 'revenue', parent_id: null, is_active: true },
      { id: A3, company_id: C1, code: '5100', name: 'مصروف', type: 'expense', parent_id: null, is_active: true },
    );
    mockDb.db.journal_lines.push(
      { id: 'l1', company_id: C1, account_id: A1, debit: 0, credit: 300 },
      { id: 'l2', company_id: C1, account_id: A2, debit: 0, credit: 100 },
      { id: 'l3', company_id: C1, account_id: A3, debit: 50, credit: 0 },
    );
    const res = await validateGET(req('admin', 'GET', 'http://localhost/api/fiscal/validate-balances'));
    const body = await res.json();
    expect(body.data.totalIssues).toBe(0);
  });
});

describe('fiscal/validate-balances POST pre-validation', () => {
  test('rejects missing or invalid inputs', async () => {
    const res = await validatePOST(req('admin', 'POST', 'http://localhost/api/fiscal/validate-balances', { accountId: A1, proposedDebit: -1, proposedCredit: 0 }));
    expect(res.status).toBe(400);
  });

  test('returns an error when the account does not exist', async () => {
    const res = await validatePOST(req('admin', 'POST', 'http://localhost/api/fiscal/validate-balances', { accountId: A4, proposedDebit: 10, proposedCredit: 0 }));
    expect(res.status).toBe(400);
  });

  test('validates an asset with a valid proposed balance', async () => {
    mockDb.db.accounts.push({ id: A1, company_id: C1, code: '1110', name: 'نقد', type: 'asset', parent_id: null });
    const res = await validatePOST(req('admin', 'POST', 'http://localhost/api/fiscal/validate-balances', { accountId: A1, proposedDebit: 10, proposedCredit: 0 }));
    const body = await res.json();
    expect(body.data.isValid).toBe(true);
  });

  test('warns on a proposed negative asset balance', async () => {
    mockDb.db.accounts.push({ id: A1, company_id: C1, code: '1110', name: 'نقد', type: 'asset', parent_id: null });
    const res = await validatePOST(req('admin', 'POST', 'http://localhost/api/fiscal/validate-balances', { accountId: A1, proposedDebit: 0, proposedCredit: 100 }));
    const body = await res.json();
    expect(body.data.isValid).toBe(false);
    expect(body.data.warning).toContain('سالب');
  });

  test('warns on a proposed positive liability balance', async () => {
    mockDb.db.accounts.push({ id: A2, company_id: C1, code: '2120', name: 'دائن', type: 'liability', parent_id: null });
    const res = await validatePOST(req('admin', 'POST', 'http://localhost/api/fiscal/validate-balances', { accountId: A2, proposedDebit: 100, proposedCredit: 0 }));
    const body = await res.json();
    expect(body.data.isValid).toBe(false);
  });

  test('warns on a proposed negative expense balance', async () => {
    mockDb.db.accounts.push({ id: A3, company_id: C1, code: '5100', name: 'مصروف', type: 'expense', parent_id: null });
    const res = await validatePOST(req('admin', 'POST', 'http://localhost/api/fiscal/validate-balances', { accountId: A3, proposedDebit: 0, proposedCredit: 50 }));
    const body = await res.json();
    expect(body.data.isValid).toBe(false);
    expect(body.data.warning).toContain('سالب');
  });
});
