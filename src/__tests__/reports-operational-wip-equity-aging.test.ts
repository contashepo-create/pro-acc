/**
 * Route-boundary tests for reports: operational, wip, equity-changes,
 * aging, contact-balances.
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
import { createToken } from '@/lib/auth';

type Row = Record<string, any>;
type Op = { op: string; col?: string; val?: any };

function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Op[] }> = [];
  const rpcResults = new Map<string, any>();
  const from = (table: string) => {
    const ops: Op[] = [];
    calls.push({ table, ops });
    const rows = () =>
      (db[table] || []).filter((r) =>
        ops.every((o) => {
          const get = (col: string) => col.split('.').reduce((acc, k) => (acc == null ? acc : (acc as any)[k]), r);
          if (o.op === 'eq') return get(o.col!) === o.val;
          if (o.op === 'in') return (o.val as any[]).includes(get(o.col!));
          return true;
        })
      );
    const api: any = {
      select: () => api,
      eq: (col: string, val: any) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: any) => { ops.push({ op: 'in', col, val }); return api; },
      order: () => api, limit: () => api, range: () => api, is: () => api, neq: () => api,
      or: () => api, lt: () => api, gte: () => api, lte: () => api,
      insert: () => api, update: () => api, delete: () => api,
      maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
      single: async () => ({ data: rows()[0] || null, error: rows()[0] ? null : { message: 'not found' } }),
      then: (ok: any, fail: any) =>
        Promise.resolve({ data: rows(), error: null, count: rows().length }).then(ok, fail),
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

import { GET as operationalGET } from '@/app/api/reports/operational/route';
import { GET as wipGET } from '@/app/api/reports/wip/route';
import { GET as equityGET } from '@/app/api/reports/equity-changes/route';
import { GET as agingGET } from '@/app/api/reports/aging/route';
import { GET as cbGET } from '@/app/api/reports/contact-balances/route';
import { resetRateLimits } from '@/lib/memory-rate-limit';

const C1 = 'company-1';
const ID1 = '00000000-0000-4000-8000-00000000f0f1';

function req(role = 'admin', method = 'GET', url = 'http://localhost/x') {
  const token = createToken('u1', role, 0);
  return { url, method, nextUrl: new URL(url), headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined } } as any;
}

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, name: 'م', email: 'admin@example.com', is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: { reports_basic: true, reports_advanced: true, projects: true } } }],
    projects: [], inventory_transactions: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { resetRateLimits(); mockDb = makeDb(baseDb()); });

describe('reports/operational', () => {
  test('rejects an invalid report type and date', async () => {
    const res1 = await operationalGET(req('admin', 'GET', 'http://localhost/api/reports/operational?type=bogus'));
    expect(res1.status).toBe(400);
    const res2 = await operationalGET(req('admin', 'GET', 'http://localhost/api/reports/operational?from=bad'));
    expect(res2.status).toBe(400);
  });

  test('returns project costs from the ledger', async () => {
    mockDb.rpcResults.set('get_project_account_totals', { data: [{ account_type: 'expense', code: '5110', debit: 100, credit: 0 }], error: null });
    const res = await operationalGET(req('admin', 'GET', 'http://localhost/api/reports/operational?type=project-costs'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.materials).toBe(100);
  });

  test('returns 404 for an unknown project', async () => {
    const res = await operationalGET(req('admin', 'GET', `http://localhost/api/reports/operational?projectId=${ID1}`));
    expect(res.status).toBe(404);
  });
});

describe('reports/wip', () => {
  test('returns an empty WIP report', async () => {
    mockDb.rpcResults.set('get_report_projects', { data: [], error: null });
    const res = await wipGET(req('admin', 'GET', 'http://localhost/api/reports/wip'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.data.rows)).toBe(true);
  });
});

describe('reports/equity-changes', () => {
  test('returns equity changes', async () => {
    mockDb.rpcResults.set('get_equity_changes_summary', { data: { openingCapital: 100, openingRetained: 50 }, error: null });
    const res = await equityGET(req('admin', 'GET', 'http://localhost/api/reports/equity-changes?from=2026-01-01&to=2026-12-31'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.opening.capital).toBe(100);
  });

  test('rejects an invalid period', async () => {
    const res = await equityGET(req('admin', 'GET', 'http://localhost/api/reports/equity-changes?from=bad'));
    expect(res.status).toBe(400);
  });
});

describe('reports/aging', () => {
  test('returns an aging report', async () => {
    mockDb.rpcResults.set('get_aging_by_contact', { data: [{ contact_id: ID1, contact_name: 'عميل', open_amount: 100, unapplied: 0, max_days_overdue: 40, bucket_0_30: 0, bucket_31_60: 100, bucket_61_90: 0, bucket_90_plus: 0, last_invoice_date: '2026-01-01' }], error: null });
    const res = await agingGET(req('admin', 'GET', 'http://localhost/api/reports/aging?type=ar&asOf=2026-02-01'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.aging[0].bucket).toBe('31-60');
  });

  test('rejects an invalid type and date', async () => {
    const res1 = await agingGET(req('admin', 'GET', 'http://localhost/api/reports/aging?type=bogus'));
    expect(res1.status).toBe(400);
    const res2 = await agingGET(req('admin', 'GET', 'http://localhost/api/reports/aging?asOf=bad'));
    expect(res2.status).toBe(400);
  });
});

describe('reports/contact-balances', () => {
  test('returns contact balances', async () => {
    mockDb.rpcResults.set('get_contact_balances', { data: [{ contact_id: ID1, name: 'عميل', contact_type: 'client', opening: 10, period_debit: 100, period_credit: 50, closing: 60, phone: '05', tax_number: '0' }], error: null });
    const res = await cbGET(req('admin', 'GET', 'http://localhost/api/reports/contact-balances?type=all'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.contacts[0].balance_type).toBe('مدين');
  });

  test('rejects an invalid type', async () => {
    const res = await cbGET(req('admin', 'GET', 'http://localhost/api/reports/contact-balances?type=bogus'));
    expect(res.status).toBe(400);
  });
});
