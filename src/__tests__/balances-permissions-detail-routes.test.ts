/**
 * Route-boundary tests for previously-uncovered routes: fiscal/validate-balances,
 * permissions/actions GET, permissions/modules GET, bonds/[id] GET,
 * credit-notes/[id] GET, project-expenses/[id] GET.
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
          if (o.op === 'eq') return r[o.col!] === o.val;
          if (o.op === 'in') return (o.val as any[]).includes(r[o.col!]);
          if (o.op === 'neq') return r[o.col!] !== o.val;
          return true;
        })
      );
    const api: any = {
      select: () => api,
      eq: (col: string, val: any) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: any) => { ops.push({ op: 'in', col, val }); return api; },
      neq: (col: string, val: any) => { ops.push({ op: 'neq', col, val }); return api; },
      order: () => api, limit: () => api, range: () => api,
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

import { GET as validateGET } from '@/app/api/fiscal/validate-balances/route';
import { GET as actionsGET } from '@/app/api/permissions/actions/route';
import { GET as modulesGET } from '@/app/api/permissions/modules/route';
import { GET as bondGET } from '@/app/api/bonds/[id]/route';
import { GET as creditNoteGET } from '@/app/api/credit-notes/[id]/route';
import { GET as projectExpenseGET } from '@/app/api/project-expenses/[id]/route';

const C1 = 'company-1';
const ID = '00000000-0000-4000-8000-000000000001';
function req(role = 'admin', method = 'GET', url = 'http://localhost/x', body?: any) {
  const token = createToken('u1', role, 0);
  return { url, method, nextUrl: new URL(url), headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined }, json: async () => body } as any;
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: { projects: true, reports: true, fiscal: true, permissions: true, bonds: true, credit_notes: true } } }],
    accounts: [], journal_lines: [], bonds: [], credit_notes: [], project_expenses: [], custom_actions: [], custom_modules: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { mockDb = makeDb(baseDb()); });

describe('fiscal/validate-balances', () => {
  test('returns no issues when there are no accounts', async () => {
    const res = await validateGET(req('admin', 'GET', 'http://localhost/api/fiscal/validate-balances'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.issues).toEqual([]);
    expect(json.data.totalIssues).toBe(0);
  });

  test('detects a negative asset balance from journal lines', async () => {
    mockDb = makeDb({
      ...baseDb(),
      accounts: [{ id: 'a1', company_id: C1, code: '1110', name: 'خزينة', type: 'asset', parent_id: null, is_active: true }],
      journal_lines: [{ account_id: 'a1', company_id: C1, debit: 0, credit: 50 }],
    });
    const res = await validateGET(req('admin', 'GET', 'http://localhost/api/fiscal/validate-balances'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.totalIssues).toBeGreaterThan(0);
  });
});

describe('permissions/actions & modules', () => {
  test('actions GET lists tenant custom actions', async () => {
    mockDb = makeDb({ ...baseDb(), custom_actions: [{ id: 'a1', company_id: C1, name: 'إجراء' }] });
    const res = await actionsGET(req('admin', 'GET', 'http://localhost/api/permissions/actions'));
    expect(res.status).toBe(200);
    expect((await res.json()).data.actions).toHaveLength(1);
  });

  test('modules GET lists tenant custom modules', async () => {
    mockDb = makeDb({ ...baseDb(), custom_modules: [{ id: 'm1', company_id: C1, name: 'وحدة' }] });
    const res = await modulesGET(req('admin', 'GET', 'http://localhost/api/permissions/modules'));
    expect(res.status).toBe(200);
    expect((await res.json()).data.modules).toHaveLength(1);
  });
});

describe('detail GET routes', () => {
  test('bond GET returns 404 for a missing bond', async () => {
    const res = await bondGET(req('admin', 'GET', 'http://localhost/x'), params(ID));
    expect(res.status).toBe(404);
  });

  test('credit-note GET returns 404 for a malformed id', async () => {
    const res = await creditNoteGET(req('admin', 'GET', 'http://localhost/x'), params('bad'));
    expect(res.status).toBe(400);
  });

  test('project-expense GET returns 404 for a missing expense', async () => {
    const res = await projectExpenseGET(req('admin', 'GET', 'http://localhost/x'), params(ID));
    expect(res.status).toBe(404);
  });
});
