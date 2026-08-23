/**
 * Route-boundary regression tests for the reports that carry the most
 * accounting risk: aging, VAT, cash flow, WIP, plus the shared date-range and
 * pagination validation every report depends on.
 *
 * These lock in behaviour that is easy to regress silently:
 *  - a malformed/reversed date range must be REJECTED, never quietly widened
 *    into "everything" (which would leak prior periods into a filed return);
 *  - pagination junk must be rejected rather than coerced (NaN offsets and
 *    huge page sizes are how report endpoints turn into data-dump endpoints);
 *  - every RPC/query must carry the caller's own company_id;
 *  - VAT/aging figures must come from the POSTED ledger, so drafts cannot
 *    inflate a return.
 *
 * Ledger-level maths (posted-only aggregation, reversal netting, disabled
 * accounts staying visible historically) is proven end-to-end against real
 * PostgreSQL in scripts/test-migrations.mjs.
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
// The DB-backed share of the per-user rate limit is out of scope for these
// suites (the memory fast path is what they exercise); the authoritative
// store is covered by shared-rate-limit.test.ts + the 077 migration smoke.
jest.mock('@/lib/shared-rate-limit', () => ({ hitSharedRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }) }));
import { createToken } from '@/lib/auth';
import { parseReportPagination } from '@/lib/report-validation';
import { computeWip } from '@/lib/construction';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
type Op = { op: string; col?: string; val?: unknown; args?: unknown[] };

function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Op[]; mut: { kind?: string; payload?: Row | Row[] } }> = [];
  const rpcCalls: Array<{ name: string; params?: Row }> = [];
  const rpcResults = new Map<string, { data: unknown; error: unknown }>();
  const from = (table: string) => {
    const ops: Op[] = []; const mut: { kind?: string; payload?: Row | Row[] } = {}; calls.push({ table, ops, mut });
    const rows = () => (db[table] || []).filter((row) => ops.every((op) => {
      if (op.op === 'eq') return row[op.col!] === op.val;
      if (op.op === 'in') return (op.val as unknown[]).includes(row[op.col!]);
      if (op.op === 'neq') return row[op.col!] !== op.val;
      if (op.op === 'gte') return String(row[op.col!]) >= String(op.val);
      if (op.op === 'lte') return String(row[op.col!]) <= String(op.val);
      return true;
    }));
    const api: TestBuilder = {
      select: () => api,
      eq: (col: string, val: unknown) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: unknown) => { ops.push({ op: 'in', col, val }); return api; },
      neq: (col: string, val: unknown) => { ops.push({ op: 'neq', col, val }); return api; },
      gte: (col: string, val: unknown) => { ops.push({ op: 'gte', col, val }); return api; },
      lte: (col: string, val: unknown) => { ops.push({ op: 'lte', col, val }); return api; },
      is: (col: string, val: unknown) => { ops.push({ op: 'is', col, val }); return api; },
      not: () => api, or: () => api, order: () => api,
      limit: (...args: unknown[]) => { ops.push({ op: 'limit', args }); return api; },
      range: (...args: unknown[]) => { ops.push({ op: 'range', args }); return api; },
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
  return {
    from, calls, rpcCalls, rpcResults,
    rpc: async (name: string, params?: Row): Promise<{ data: unknown; error: unknown }> => {
      rpcCalls.push({ name, params });
      return rpcResults.get(name) || { data: [], error: null };
    },
  };
}

let mockDb: ReturnType<typeof makeDb>;
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));

import { GET as agingGET } from '@/app/api/reports/aging/route';
import { GET as vatGET } from '@/app/api/reports/vat/route';
import { GET as cashFlowGET } from '@/app/api/reports/cash-flow/route';
import { GET as wipGET } from '@/app/api/reports/wip/route';

const C1 = 'company-1';
const USER = 'u1';

function baseDb(): Record<string, Row[]> {
  return {
    users: [{ id: USER, company_id: C1, is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true }],
    subscriptions: [{
      id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: {
        code: 'enterprise',
        features_modules: { reports: true, financial_reports: true, projects: true },
      },
    }],
    accounts: [], invoices: [], purchase_invoices: [], journal_entries: [], journal_lines: [],
    banks_safes: [], contacts: [], projects: [],
  };
}

function request(url: string) {
  const token = createToken(USER, 'admin');
  return {
    url, method: 'GET',
    headers: { get: (key: string) => (key === 'authorization' ? `Bearer ${token}` : null) },
    cookies: { get: () => undefined },
    nextUrl: new URL(url),
  } as unknown as NextRequest;
}

const rpc = (name: string) => mockDb.rpcCalls.find((call) => call.name === name);
const body = async (response: any) => JSON.parse(await response.text());

beforeEach(() => { mockDb = makeDb(baseDb()); });

describe('aging report regression', () => {
  test('rejects an invalid asOf date instead of silently using today', async () => {
    const response = await agingGET(request('http://localhost/api/reports/aging?type=ar&asOf=2026-13-45'));
    expect(response.status).toBe(400);
    // Nothing may reach the database once the period is known to be invalid.
    expect(mockDb.rpcCalls).toHaveLength(0);
  });

  test('rejects an unknown aging type rather than defaulting to receivables', async () => {
    const response = await agingGET(request('http://localhost/api/reports/aging?type=all'));
    expect(response.status).toBe(400);
    expect(mockDb.rpcCalls).toHaveLength(0);
  });

  test('passes the caller company and asOf date to the posted-ledger RPC', async () => {
    mockDb.rpcResults.set('get_aging_by_contact', { data: [], error: null });
    const response = await agingGET(request('http://localhost/api/reports/aging?type=ap&asOf=2026-03-31'));
    expect(response.status).toBe(200);
    expect(rpc('get_aging_by_contact')!.params).toEqual({
      p_company_id: C1, p_type: 'ap', p_as_of: '2026-03-31',
    });
  });

  test('buckets, balances and totals are derived consistently from RPC rows', async () => {
    mockDb.rpcResults.set('get_aging_by_contact', {
      data: [
        {
          contact_id: 'c-1', contact_name: 'عميل قديم', open_amount: 1000, unapplied: 250,
          bucket_0_30: 200, bucket_31_60: 300, bucket_61_90: 100, bucket_90_plus: 400,
          max_days_overdue: 95, last_invoice_date: '2026-01-10',
        },
        {
          contact_id: 'c-2', contact_name: 'عميل حديث', open_amount: 500, unapplied: 0,
          bucket_0_30: 500, bucket_31_60: 0, bucket_61_90: 0, bucket_90_plus: 0,
          max_days_overdue: 12, last_invoice_date: '2026-03-01',
        },
      ],
      error: null,
    });
    const response = await agingGET(request('http://localhost/api/reports/aging?type=ar&asOf=2026-03-31'));
    const payload = (await body(response)).data;

    // AR balance is net of unapplied receipts on account.
    const oldest = payload.aging.find((row: Row) => row.id === 'c-1');
    expect(oldest.balance).toBe(750);
    expect(oldest.bucket).toBe('90+');
    // 12 days overdue must land in the first bucket, not merely "not overdue".
    expect(payload.aging.find((row: Row) => row.id === 'c-2').bucket).toBe('0-30');
    // Rows are ordered by exposure so the biggest debtor is actionable first.
    expect(payload.aging.map((row: Row) => row.id)).toEqual(['c-1', 'c-2']);
    // Bucket totals must reconcile to the sum of the per-contact buckets.
    expect(payload.totals['0-30']).toBe(700);
    expect(payload.totals['90+']).toBe(400);
    expect(payload.totals.balance).toBe(1250);
    expect(
      payload.totals['0-30'] + payload.totals['31-60'] + payload.totals['61-90'] + payload.totals['90+'],
    ).toBe(1500);
  });
});

describe('VAT report regression', () => {
  function seedVatMocks() {
    mockDb.rpcResults.set('get_vat_return_summary', {
      data: { outputVat: 150, inputVat: 90, netVat: 60 }, error: null,
    });
    mockDb.rpcResults.set('get_vat_ledger_lines', { data: [], error: null });
  }

  test('rejects a reversed period instead of returning an unbounded return', async () => {
    seedVatMocks();
    const response = await vatGET(request('http://localhost/api/reports/vat?from=2026-06-30&to=2026-01-01'));
    expect(response.status).toBe(400);
    expect(mockDb.rpcCalls).toHaveLength(0);
  });

  test('rejects malformed dates', async () => {
    seedVatMocks();
    expect((await vatGET(request('http://localhost/api/reports/vat?from=not-a-date&to=2026-01-01'))).status).toBe(400);
    expect((await vatGET(request('http://localhost/api/reports/vat?from=2026-02-30&to=2026-03-01'))).status).toBe(400);
    expect(mockDb.rpcCalls).toHaveLength(0);
  });

  test('rejects junk pagination rather than coercing it to NaN offsets', async () => {
    seedVatMocks();
    for (const query of ['page=0', 'page=-1', 'page=abc', 'page_size=0', 'page_size=abc', 'page_size=100000']) {
      const response = await vatGET(request(`http://localhost/api/reports/vat?from=2026-01-01&to=2026-03-31&${query}`));
      expect(response.status).toBe(400);
    }
    expect(mockDb.rpcCalls).toHaveLength(0);
  });

  test('valid pagination becomes a bounded limit/offset window', async () => {
    seedVatMocks();
    const response = await vatGET(request('http://localhost/api/reports/vat?from=2026-01-01&to=2026-03-31&page=3&page_size=25'));
    expect(response.status).toBe(200);
    expect(rpc('get_vat_ledger_lines')!.params).toMatchObject({
      p_company_id: C1, p_from: '2026-01-01', p_to: '2026-03-31', p_limit: 25, p_offset: 50,
    });
  });

  test('summary and evidence queries are scoped to the caller company and posted entries', async () => {
    seedVatMocks();
    const response = await vatGET(request('http://localhost/api/reports/vat?from=2026-01-01&to=2026-03-31'));
    expect(response.status).toBe(200);
    expect(rpc('get_vat_return_summary')!.params).toEqual({
      p_company_id: C1, p_from: '2026-01-01', p_to: '2026-03-31',
    });

    // Both document tables must be tenant-filtered AND restricted to posted,
    // non-deleted journals — a draft invoice must never reach a VAT return.
    for (const table of ['invoices', 'purchase_invoices']) {
      const call = mockDb.calls.find((entry) => entry.table === table)!;
      expect(call).toBeDefined();
      const eq = call.ops.filter((op) => op.op === 'eq');
      expect(eq).toEqual(expect.arrayContaining([
        { op: 'eq', col: 'company_id', val: C1 },
        { op: 'eq', col: 'journal_entries.company_id', val: C1 },
        { op: 'eq', col: 'journal_entries.status', val: 'posted' },
      ]));
      expect(call.ops).toEqual(expect.arrayContaining([
        { op: 'is', col: 'journal_entries.deleted_at', val: null },
      ]));
    }
  });

  test('net VAT is taken from the control accounts, which stay authoritative', async () => {
    seedVatMocks();
    const response = await vatGET(request('http://localhost/api/reports/vat?from=2026-01-01&to=2026-03-31'));
    const payload = (await body(response)).data;
    // The posted VAT control accounts drive the return; invoice totals are only
    // reconciliation evidence and must never silently replace them.
    expect(payload.vat_collected.from_journal).toBe(150);
    expect(payload.vat_paid.from_journal).toBe(90);
    expect(payload.summary.total_vat_collected).toBe(150);
    expect(payload.summary.total_vat_paid).toBe(90);
    expect(payload.summary.vat_payable).toBe(60);
    expect(payload.summary.vat_payable_status).toBe('payable');
    expect(payload.accountingBasis).toBe('posted_vat_control_accounts');
  });

  test('a refund position is labelled refundable rather than shown as negative payable', async () => {
    mockDb.rpcResults.set('get_vat_return_summary', {
      data: { outputVat: 40, inputVat: 100 }, error: null,
    });
    mockDb.rpcResults.set('get_vat_ledger_lines', { data: [], error: null });
    const response = await vatGET(request('http://localhost/api/reports/vat?from=2026-01-01&to=2026-03-31'));
    const payload = (await body(response)).data;
    expect(payload.summary.vat_payable).toBe(-60);
    expect(payload.summary.vat_payable_status).toBe('refundable');
  });
});

describe('cash flow report regression', () => {
  test('rejects an inverted period', async () => {
    const response = await cashFlowGET(request('http://localhost/api/reports/cash-flow?from=2026-12-31&to=2026-01-01'));
    expect(response.status).toBe(400);
  });

  test('rejects malformed dates before touching the ledger', async () => {
    expect((await cashFlowGET(request('http://localhost/api/reports/cash-flow?from=2026-99-01'))).status).toBe(400);
    expect((await cashFlowGET(request('http://localhost/api/reports/cash-flow?to=20260101'))).status).toBe(400);
  });

  test('a company with no cash or bank accounts yields an empty, balanced report', async () => {
    const response = await cashFlowGET(request('http://localhost/api/reports/cash-flow?from=2026-01-01&to=2026-03-31'));
    expect(response.status).toBe(200);
    const payload = (await body(response)).data;
    // No cash accounts must mean zeroes, never a crash or a silent omission.
    expect(payload.opening_balance).toBe(0);
    expect(payload.closing_balance).toBe(0);
    expect(payload.net_change).toBe(0);
    // The requested period is echoed back so the caller can prove what was run.
    expect(payload.period).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    // Direct-method cash flow always reports the three standard sections.
    expect(payload.operating.total_inflows).toBe(0);
    expect(payload.investing.total_outflows).toBe(0);
    expect(payload.financing.net).toBe(0);
  });
});

describe('WIP report regression', () => {
  test('WIP rows are tenant scoped and restricted to active projects', async () => {
    mockDb.rpcResults.set('get_report_projects', { data: [], error: null });
    const response = await wipGET(request('http://localhost/api/reports/wip'));
    expect(response.status).toBe(200);
    expect(rpc('get_report_projects')!.params).toEqual({ p_company_id: C1, p_active_only: true });
  });

  test('over-billing and under-billing are classified from earned revenue', () => {
    // 50% complete on a 1,000,000 contract earns 500,000.
    const underBilled = computeWip({ contractAmount: 1_000_000, costsIncurred: 500_000, billedToDate: 400_000 });
    expect(underBilled.percentComplete).toBeCloseTo(0.5, 10);
    expect(underBilled.earnedRevenue).toBeCloseTo(500_000, 6);
    expect(underBilled.overUnderBilled).toBeCloseTo(100_000, 6);
    expect(underBilled.status).toBe('under-billed');

    const overBilled = computeWip({ contractAmount: 1_000_000, costsIncurred: 500_000, billedToDate: 650_000 });
    expect(overBilled.overUnderBilled).toBeCloseTo(-150_000, 6);
    expect(overBilled.status).toBe('over-billed');
  });

  test('cost overruns cap completion at 100% and surface a negative profit', () => {
    const overrun = computeWip({ contractAmount: 100_000, costsIncurred: 130_000, billedToDate: 100_000 });
    // Percent complete must never exceed 100%, or earned revenue would exceed
    // the contract and overstate income.
    expect(overrun.percentComplete).toBe(1);
    expect(overrun.earnedRevenue).toBe(100_000);
    expect(overrun.costToComplete).toBe(0);
    expect(overrun.estimatedProfit).toBe(-30_000);
  });

  test('a zero-value contract cannot divide by zero', () => {
    const empty = computeWip({ contractAmount: 0, costsIncurred: 0, billedToDate: 0 });
    expect(empty.percentComplete).toBe(0);
    expect(empty.earnedRevenue).toBe(0);
    expect(Number.isFinite(empty.percentComplete)).toBe(true);
  });
});

describe('shared report pagination validation', () => {
  test('defaults are applied when nothing is supplied', () => {
    expect(parseReportPagination(new URLSearchParams())).toEqual({ page: 1, pageSize: 100 });
  });

  test('non-numeric, zero, negative and float inputs are rejected', () => {
    for (const query of ['page=0', 'page=-3', 'page=1.5', 'page=abc', 'page= 1', 'page=1e3']) {
      expect(parseReportPagination(new URLSearchParams(query))).toBeNull();
    }
    for (const query of ['page_size=0', 'page_size=-10', 'page_size=abc', 'page_size=2.5']) {
      expect(parseReportPagination(new URLSearchParams(query))).toBeNull();
    }
  });

  test('page size is capped so a report cannot become a bulk export', () => {
    expect(parseReportPagination(new URLSearchParams('page_size=501'))).toBeNull();
    expect(parseReportPagination(new URLSearchParams('page_size=500'))).toEqual({ page: 1, pageSize: 500 });
    // An explicit lower cap must be honoured by callers that need one.
    expect(parseReportPagination(new URLSearchParams('page_size=200'), { maxPageSize: 100 })).toBeNull();
  });

  test('absurdly large page numbers are rejected rather than overflowing an offset', () => {
    expect(parseReportPagination(new URLSearchParams('page=9999999999'))).toBeNull();
    expect(parseReportPagination(new URLSearchParams('page=999999999'))).toEqual({ page: 999999999, pageSize: 100 });
  });
});
