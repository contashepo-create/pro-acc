/**
 * Route-boundary tests for the financial report endpoints (all previously
 * uncovered): reports/financial (trial balance / income statement / balance
 * sheet), reports/operational, reports/profitability, reports/project-profit-loss.
 *
 * Security: a valid tenant token is required and the report scopes queries by
 * company. Accounting: results are computed from the posted-ledger rows and
 * reject invalid periods/type.
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
import { createToken } from '@/lib/auth';

type Row = Record<string, unknown>;
type Op = { op: string; col?: string; val?: unknown };

function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Op[] }> = [];
  const rpcResults = new Map<string, { data: unknown; error?: unknown } | { rows: unknown } | null>();
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
  const s = {
    from, calls, rpcResults,
    rpc: async (name: string, _params?: Row) => {
      calls.push({ table: `rpc:${name}`, ops: [] });
      const val = rpcResults.get(name);
      if (val && typeof val === 'object' && 'rows' in val) return val;
      return rpcResults.get(name) || { data: [], error: null };
    },
  };
  return s;
}

let mockDb: ReturnType<typeof makeDb>;
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));

import { GET as financialGET } from '@/app/api/reports/financial/route';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';
import { GET as operationalGET } from '@/app/api/reports/operational/route';
import { GET as profitabilityGET } from '@/app/api/reports/profitability/route';
import { GET as projectProfitLossGET } from '@/app/api/reports/project-profit-loss/route';

const C1 = 'company-1';
function req(role = 'admin', url = 'http://localhost/api/reports/financial') {
  const token = createToken('u1', role, 0);
  return {
    url, method: 'GET',
    nextUrl: new URL(url),
    headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined },
  } as unknown as NextRequest;
}

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: { projects: true, reports: true, financial_reports: true } } }],
    projects: [], journal_lines: [], inventory_transactions: [],
    contacts: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { mockDb = makeDb(baseDb()); });

describe('reports/financial', () => {
  test('rejects an invalid report type and an invalid period', async () => {
    const bad = await financialGET(req('admin', 'http://localhost/api/reports/financial?type=bogus'));
    expect(bad.status).toBe(400);
    const badRange = await financialGET(req('admin', 'http://localhost/api/reports/financial?from=2026-02-01&to=2026-01-01'));
    expect(badRange.status).toBe(400);
  });

  test('builds a trial balance from posted-ledger rows', async () => {
    mockDb.rpcResults.set('get_financial_statement_rows', { data: [
      { account_id: 'a1', account_code: '1110', account_name: 'خزينة', account_type: 'asset', opening_debit: 0, opening_credit: 0, period_debit: 100, period_credit: 0, cumulative_debit: 100, cumulative_credit: 0 },
      { account_id: 'a2', account_code: '4100', account_name: 'إيراد', account_type: 'revenue', opening_debit: 0, opening_credit: 0, period_debit: 0, period_credit: 80, cumulative_debit: 0, cumulative_credit: 80 },
    ], error: null });
    const res = await financialGET(req());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.accounts).toHaveLength(2);
    expect(json.data.total_debit).toBe(100);
    expect(json.data.total_credit).toBe(80);
    expect(json.data.accounts[0].balance).toBe(100);
    expect(json.data.accounts[1].normal_balance).toBe('credit');
  });

  test('builds an income statement (revenue minus expenses)', async () => {
    mockDb.rpcResults.set('get_financial_statement_rows', { data: [
      { account_id: 'r', account_code: '4100', account_name: 'إيراد', account_type: 'revenue', opening_debit: 0, opening_credit: 0, period_debit: 0, period_credit: 1000, cumulative_debit: 0, cumulative_credit: 1000 },
      { account_id: 'e', account_code: '5110', account_name: 'تكلفة', account_type: 'expense', opening_debit: 0, opening_credit: 0, period_debit: 700, period_credit: 0, cumulative_debit: 700, cumulative_credit: 0 },
    ], error: null });
    const res = await financialGET(req('admin', 'http://localhost/api/reports/financial?type=income_statement'));
    const json = await res.json();
    expect(json.data.total_revenue).toBe(1000);
    expect(json.data.total_expenses).toBe(700);
    expect(json.data.net_income).toBe(300);
  });

  test('builds a balanced balance sheet with net income', async () => {
    mockDb.rpcResults.set('get_financial_statement_rows', { data: [
      { account_id: 'a', account_code: '1110', account_name: 'خزينة', account_type: 'asset', opening_debit: 0, opening_credit: 0, period_debit: 500, period_credit: 0, cumulative_debit: 500, cumulative_credit: 0 },
      { account_id: 'e', account_code: '3200', account_name: 'حقوق', account_type: 'equity', opening_debit: 0, opening_credit: 0, period_debit: 0, period_credit: 300, cumulative_debit: 0, cumulative_credit: 300 },
      { account_id: 'r', account_code: '4100', account_name: 'إيراد', account_type: 'revenue', opening_debit: 0, opening_credit: 0, period_debit: 0, period_credit: 200, cumulative_debit: 0, cumulative_credit: 200 },
    ], error: null });
    const res = await financialGET(req('admin', 'http://localhost/api/reports/financial?type=balance_sheet'));
    const json = await res.json();
    // Assets (500) == liabilities(0) + equity(300) + net income(200)
    expect(json.data.total_assets).toBe(500);
    expect(json.data.total_equity).toBe(500);
  });
});

describe('reports/operational', () => {
  test('aggregates project costs by category from get_project_account_totals', async () => {
    mockDb.rpcResults.set('get_project_account_totals', { data: [
      { project_id: 'p1', code: '5110', account_type: 'expense', debit: 50, credit: 0 },
      { project_id: 'p1', code: '5120', account_type: 'expense', debit: 30, credit: 0 },
      { project_id: 'p1', code: '5130', account_type: 'expense', debit: 20, credit: 0 },
    ], error: null });
    const res = await operationalGET(req('admin', 'http://localhost/api/reports/operational?type=project-costs'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.total).toBe(100);
    expect(json.data.materials).toBe(50);
    expect(json.data.workers).toBe(30);
    expect(json.data.subcontractors).toBe(20);
  });

  test('rejects an invalid report type', async () => {
    const res = await operationalGET(req('admin', 'http://localhost/api/reports/operational?type=nope'));
    expect(res.status).toBe(400);
  });
});

describe('reports/profitability & project-profit-loss', () => {
  test('profitability aggregates revenue and costs per project', async () => {
    mockDb.rpcResults.set('get_report_projects', { data: [{ project_id: 'p1', name: 'مشروع', contract_value: 1000, client_id: null, client_name: null, status: 'active', start_date: '2026-01-01', end_date: null }], error: null });
    mockDb.rpcResults.set('get_project_billing_totals', { data: [{ project_id: 'p1', billed: 800, credits: 0, net_billed: 800 }], error: null });
    mockDb.rpcResults.set('get_project_costing_overhead', { data: [], error: null });
    // sumProjectsJournal calls get_project_account_totals
    mockDb.rpcResults.set('get_project_account_totals', { data: [
      { project_id: 'p1', code: '4100', account_type: 'revenue', debit: 0, credit: 800 },
      { project_id: 'p1', code: '5110', account_type: 'expense', debit: 600, credit: 0 },
    ], error: null });
    const res = await profitabilityGET(req('admin', 'http://localhost/api/reports/profitability'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.projects[0].revenue).toBe(800);
    expect(json.data.projects[0].total_costs).toBe(600);
    expect(json.data.projects[0].profit).toBe(200);
  });

  test('project-profit-loss reports direct profit and allocated overhead separately', async () => {
    mockDb.rpcResults.set('get_report_projects', { data: [{ project_id: 'p1', name: 'مشروع', contract_value: 1000, client_id: null, client_name: null, status: 'active', start_date: '2026-01-01', end_date: null }], error: null });
    mockDb.rpcResults.set('get_project_billing_totals', { data: [{ project_id: 'p1', billed: 800, credits: 0, net_billed: 800 }], error: null });
    mockDb.rpcResults.set('get_project_costing_overhead', { data: [{ project_id: 'p1', direct_cost: 600, direct_labor: 100, allocated_overhead: 50, allocation_basis: 'direct_cost', rate: 0.1 }], error: null });
    mockDb.rpcResults.set('get_project_account_totals', { data: [
      { project_id: 'p1', code: '4100', account_type: 'revenue', debit: 0, credit: 800 },
      { project_id: 'p1', code: '5110', account_type: 'expense', debit: 600, credit: 0 },
    ], error: null });
    const res = await projectProfitLossGET(req('admin', 'http://localhost/api/reports/project-profit-loss'));
    expect(res.status).toBe(200);
    const json = await res.json();
    const row = json.data.projects[0];
    expect(row.revenue).toBe(800);
    expect(row.costs).toBe(600);
    expect(row.allocated_overhead).toBe(50);
    // profit = direct profit (800-600) - overhead (50) = 150
    expect(row.profit).toBe(150);
  });
});
