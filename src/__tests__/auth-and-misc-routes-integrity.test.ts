/**
 * Route-boundary tests for previously-uncovered routes: csrf-token, auth/me,
 * financial-audit, reports/anomalies, reports/cost-center.
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
          if (o.op === 'is') return o.val === null ? r[o.col!] == null : r[o.col!] === o.val;
          return true;
        })
      );
    const api: TestBuilder = {
      select: () => api,
      eq: (col: string, val: unknown) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: unknown) => { ops.push({ op: 'in', col, val }); return api; },
      neq: (col: string, val: unknown) => { ops.push({ op: 'neq', col, val }); return api; },
      is: (col: string, val: unknown) => { ops.push({ op: 'is', col, val }); return api; },
      gte: () => api, lte: () => api, or: () => api, order: () => api, limit: () => api, range: () => api,
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
    rpc: async (name: string) => rpcResults.get(name) || { data: [], error: null },
  };
}

let mockDb: ReturnType<typeof makeDb>;
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));

import { GET as csrfGET } from '@/app/api/csrf-token/route';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';
import { GET as meGET } from '@/app/api/auth/me/route';
import { GET as auditGET } from '@/app/api/financial-audit/route';
import { GET as anomaliesGET } from '@/app/api/reports/anomalies/route';
import { GET as costCenterGET } from '@/app/api/reports/cost-center/route';

const C1 = 'company-1';
function req(role = 'admin', url = 'http://localhost/x') {
  const token = createToken('u1', role, 0);
  return { url, method: 'GET', headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined } } as unknown as NextRequest;
}

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, is_active: true, token_version: 0, role: 'admin', name: 'مدير', email: 'a@b.c' }],
    companies: [{ id: C1, is_active: true, name: 'شركة' }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: { projects: true, reports: true, financial_reports: true } } }],
    financial_audit_trails: [], invoices: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { mockDb = makeDb(baseDb()); });

describe('csrf-token', () => {
  test('issues an HttpOnly=false csrf cookie token', async () => {
    const res = await csrfGET();
    const json = await res.json();
    expect(json.token).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('auth/me', () => {
  test('returns the current user and company (skipModuleGuard path)', async () => {
    const res = await meGET(req());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.user.email).toBe('a@b.c');
    expect(json.data.company.name).toBe('شركة');
  });

  test('returns 401 when unauthenticated', async () => {
    const noAuth = { url: 'http://localhost/x', method: 'GET', headers: { get: () => null }, cookies: { get: () => undefined } } as unknown as NextRequest;
    const res = await meGET(noAuth);
    expect(res.status).toBe(401);
  });
});

describe('financial-audit', () => {
  test('lists tenant audit rows scoped by company', async () => {
    mockDb = makeDb({ ...baseDb(), financial_audit_trails: [{ id: 'a1', company_id: C1, entity_type: 'invoice', action: 'create' }] });
    const res = await auditGET(req('admin', 'http://localhost/api/financial-audit'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.rows).toHaveLength(1);
    expect(json.data.total).toBe(1);
  });
});

describe('reports/anomalies', () => {
  test('returns categorized anomaly findings', async () => {
    mockDb.rpcResults.set('get_monthly_profit_loss', { data: [{ month_number: 1, expenses: 100 }], error: null });
    const res = await anomaliesGET(req('admin', 'http://localhost/api/reports/anomalies'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.categories).toHaveProperty('duplicate_invoices');
    expect(json.data.categories).toHaveProperty('outliers');
    expect(json.data.categories).toHaveProperty('spending_spikes');
  });
});

describe('reports/cost-center', () => {
  test('rejects an invalid period and computes margins', async () => {
    const bad = await costCenterGET(req('admin', 'http://localhost/api/reports/cost-center?from=2026-02-01&to=2026-01-01'));
    expect(bad.status).toBe(400);
    mockDb.rpcResults.set('get_cost_center_profitability', { data: [
      { cost_center_id: 'cc1', code: 'CC', name: 'مركز', revenue: 1000, expenses: 600 },
    ], error: null });
    const res = await costCenterGET(req());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.cost_centers[0].profit).toBe(400);
    expect(json.data.totals.overall_margin).toBe(40);
  });
});
