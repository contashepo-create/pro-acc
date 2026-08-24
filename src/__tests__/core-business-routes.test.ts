/**
 * Route-boundary tests for previously-uncovered core business routes:
 * project-expenses GET, settings/seed-chart, complaints, contracts, timesheets,
 * subscriptions, subcontractors.
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
import { createToken } from '@/lib/auth';

type Row = Record<string, unknown>;
type Op = { op: string; col?: string; val?: unknown };

function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Op[] }> = [];
  const rpcResults = new Map<string, { data: unknown; error?: unknown }>();
  const from = (table: string) => {
    const ops: Op[] = [];
    calls.push({ table, ops });
    const rows = () =>
      (db[table] || []).filter((r) =>
        ops.every((o) => {
          if (o.op === 'eq') return r[o.col!] === o.val;
          if (o.op === 'in') return (o.val as unknown[]).includes(r[o.col!]);
          if (o.op === 'gte') return (r[o.col!] as string) >= (o.val as string);
          if (o.op === 'lte') return (r[o.col!] as string) <= (o.val as string);
          return true;
        })
      );
    const api: TestBuilder = {
      select: () => api,
      eq: (col: string, val: unknown) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: unknown) => { ops.push({ op: 'in', col, val }); return api; },
      gte: (col: string, val: unknown) => { ops.push({ op: 'gte', col, val }); return api; },
      lte: (col: string, val: unknown) => { ops.push({ op: 'lte', col, val }); return api; },
      is: () => api, neq: () => api, order: () => api, limit: () => api, range: () => api,
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
jest.mock('@/lib/default-accounts', () => ({ createDefaultChartOfAccounts: jest.fn(async () => 3) }));

import { GET as expensesGET } from '@/app/api/project-expenses/route';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';
import { POST as seedChartPOST } from '@/app/api/settings/seed-chart/route';
import { GET as complaintsGET } from '@/app/api/complaints/route';
import { GET as contractsGET } from '@/app/api/contracts/route';
import { GET as timesheetsGET } from '@/app/api/timesheets/route';
import { GET as subscriptionsGET } from '@/app/api/auth/subscription/route';
import { GET as subcontractorsGET } from '@/app/api/subcontractors/route';

const C1 = 'company-1';
function req(role = 'admin', method = 'GET', url = 'http://localhost/x', body?: Row) {
  const token = createToken('u1', role, 0);
  return { url, method, nextUrl: new URL(url), headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined }, json: async () => body } as unknown as NextRequest;
}

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: { projects: true, reports: true, complaints: true, contracts: true, timesheets: true, subcontractors: true } } }],
    project_expenses: [], complaints: [], contracts: [], timesheets: [], subcontractor_contracts: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { mockDb = makeDb(baseDb()); });

describe('project-expenses GET', () => {
  test('rejects an invalid project id and lists tenant expenses', async () => {
    expect((await expensesGET(req('admin', 'GET', 'http://localhost/x?project_id=bad'))).status).toBe(400);
    mockDb = makeDb({ ...baseDb(), project_expenses: [{ id: 'e1', company_id: C1, projects: { name: 'مشروع' } }] });
    const res = await expensesGET(req('admin', 'GET', 'http://localhost/api/project-expenses'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.expenses[0].project_name).toBe('مشروع');
  });
});

describe('settings/seed-chart', () => {
  test('seeds the default chart of accounts (admin)', async () => {
    const res = await seedChartPOST(req('admin', 'POST', 'http://localhost/x'));
    expect(res.status).toBe(200);
    expect((await res.json()).data.created).toBe(3);
  });
});

describe('complaints & contracts & timesheets GET', () => {
  test('complaints lists tenant complaints', async () => {
    mockDb = makeDb({ ...baseDb(), complaints: [{ id: 'cp1', company_id: C1 }] });
    const res = await complaintsGET(req('admin', 'GET', 'http://localhost/api/complaints'));
    expect(res.status).toBe(200);
  });

  test('contracts lists tenant contracts', async () => {
    const res = await contractsGET(req('admin', 'GET', 'http://localhost/api/contracts'));
    expect(res.status).toBe(200);
  });

  test('timesheets lists tenant timesheets', async () => {
    const res = await timesheetsGET(req('admin', 'GET', 'http://localhost/api/timesheets'));
    expect(res.status).toBe(200);
  });
});

describe('subscriptions & subcontractors GET', () => {
  test('subscription returns the current tenant subscription state', async () => {
    const res = await subscriptionsGET(req('admin', 'GET', 'http://localhost/api/subscription'));
    expect(res.status).toBe(200);
  });

  test('subcontractors lists tenant subcontractors', async () => {
    const res = await subcontractorsGET(req('admin', 'GET', 'http://localhost/api/subcontractors'));
    expect(res.status).toBe(200);
  });
});
