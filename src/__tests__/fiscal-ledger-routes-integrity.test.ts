/**
 * Route-boundary tests for previously-uncovered fiscal & ledger-report routes:
 * fiscal/[id]/close, fiscal/[id]/reopen, fiscal/closing (deprecated),
 * fiscal/reversing, reports/general-ledger, reports/consolidation.
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
          if (o.op === 'eq') return r[o.col!] === o.val;
          if (o.op === 'in') return (o.val as unknown[]).includes(r[o.col!]);
          if (o.op === 'neq') return r[o.col!] !== o.val;
          return true;
        })
      );
    const api: TestBuilder = {
      select: () => api,
      eq: (col: string, val: unknown) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: unknown) => { ops.push({ op: 'in', col, val }); return api; },
      neq: (col: string, val: unknown) => { ops.push({ op: 'neq', col, val }); return api; },
      gte: () => api, lte: () => api, or: () => api, is: () => api, order: () => api, limit: () => api, range: () => api,
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

import { POST as closePOST } from '@/app/api/fiscal/[id]/close/route';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';
import { POST as reopenPOST } from '@/app/api/fiscal/[id]/reopen/route';
import { POST as closingPOST } from '@/app/api/fiscal/closing/route';
import { POST as reversingPOST } from '@/app/api/fiscal/reversing/route';
import { GET as ledgerGET } from '@/app/api/reports/general-ledger/route';
import { GET as consolidationGET } from '@/app/api/reports/consolidation/route';

const C1 = 'company-1';
const FY = '00000000-0000-4000-8000-000000000f01';
function req(role = 'admin', method = 'GET', url = 'http://localhost/x', body?: Row) {
  const token = createToken('u1', role, 0);
  return { url, method, nextUrl: new URL(url), headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined }, json: async () => body } as unknown as NextRequest;
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: { projects: true, reports: true, financial_reports: true, fiscal: true } } }],
    accounts: [], cost_centers: [], journal_entries: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { mockDb = makeDb(baseDb()); });

describe('fiscal close/reopen/closing', () => {
  test('closes a fiscal year via the atomic RPC', async () => {
    mockDb.rpcResults.set('close_fiscal_year_atomic', { data: { status: 'closed' }, error: null });
    const res = await closePOST(req('admin', 'POST', 'http://localhost/x'), params(FY));
    expect(res.status).toBe(200);
    expect((await res.json()).data.status).toBe('closed');
  });

  test('close returns 404 when the year is missing', async () => {
    mockDb.rpcResults.set('close_fiscal_year_atomic', { data: null, error: { message: 'السنة المالية غير موجودة' } });
    const res = await closePOST(req('admin', 'POST', 'http://localhost/x'), params(FY));
    expect(res.status).toBe(404);
  });

  test('reopen returns a 409 for an unclosed year', async () => {
    mockDb.rpcResults.set('reopen_fiscal_year_atomic', { data: null, error: { message: 'السنة غير مقفلة' } });
    const res = await reopenPOST(req('admin', 'POST', 'http://localhost/x'), params(FY));
    expect(res.status).toBe(409);
  });

  test('the legacy closing endpoint is deprecated (410)', async () => {
    const res = await closingPOST(req('admin', 'POST', 'http://localhost/x'));
    expect(res.status).toBe(410);
  });
});

describe('fiscal reversing', () => {
  test('rejects missing originalEntryId and an invalid reverse date', async () => {
    expect((await reversingPOST(req('admin', 'POST', 'http://localhost/x', {}))).status).toBe(400);
    expect((await reversingPOST(req('admin', 'POST', 'http://localhost/x', { originalEntryId: 'e1', reverseDate: 'bad' }))).status).toBe(400);
  });

  test('posts a reversing entry via the RPC', async () => {
    mockDb.rpcResults.set('reverse_journal_entry_atomic', { data: { id: 'rev1' }, error: null });
    const res = await reversingPOST(req('admin', 'POST', 'http://localhost/x', { originalEntryId: 'e1', reverseDate: '2026-01-02' }));
    expect(res.status).toBe(201);
    expect((await res.json()).data.id).toBe('rev1');
  });

  test('maps a closed-fiscal-year RPC error to 409', async () => {
    mockDb.rpcResults.set('reverse_journal_entry_atomic', { data: null, error: { message: 'cannot post to a closed fiscal year' } });
    const res = await reversingPOST(req('admin', 'POST', 'http://localhost/x', { originalEntryId: 'e1' }));
    expect(res.status).toBe(409);
  });
});

describe('reports/general-ledger & consolidation', () => {
  test('general-ledger rejects an invalid period', async () => {
    const res = await ledgerGET(req('admin', 'GET', 'http://localhost/api/reports/general-ledger?from=2026-02-01&to=2026-01-01'));
    expect(res.status).toBe(400);
  });

  test('general-ledger returns 404 for a missing account', async () => {
    const res = await ledgerGET(req('admin', 'GET', 'http://localhost/api/reports/general-ledger?account_code=9999'));
    expect(res.status).toBe(404);
  });

  test('consolidation returns categorized trial-balance data', async () => {
    mockDb.rpcResults.set('get_trial_balance_rows', { data: [
      { account_id: 'a', account_code: '1110', account_name: 'خزينة', account_type: 'asset', debit: 500, credit: 0 },
    ], error: null });
    const res = await consolidationGET(req('admin', 'GET', 'http://localhost/api/reports/consolidation'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.data.assets).toHaveLength(1);
    expect(json.data.data.assets[0].balance).toBe(500);
    expect(json.data.isBalanced).toBe(false); // assets 500 vs nothing else
  });
});
