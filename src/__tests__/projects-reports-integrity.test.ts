/** Route-boundary tests for project lifecycle RPCs and project reporting.
 * Atomic project/invoice/BOQ rollback and cross-tenant enforcement run against
 * PostgreSQL in scripts/test-migrations.mjs.
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
import { createToken } from '@/lib/auth';

type Row = Record<string, any>;
type Op = { op: string; col?: string; val?: any };
function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Op[]; mut: { kind?: string; payload?: any } }> = [];
  const rpcCalls: Array<{ name: string; params: any }> = [];
  const rpcResults = new Map<string, { data: any; error: any }>();
  const from = (table: string) => {
    const ops: Op[] = []; const mut: any = {}; calls.push({ table, ops, mut });
    const rows = () => (db[table] || []).filter((row) => ops.every((op) => {
      if (op.op === 'eq') return row[op.col!] === op.val;
      if (op.op === 'in') return op.val.includes(row[op.col!]);
      if (op.op === 'neq') return row[op.col!] !== op.val;
      return true;
    }));
    const api: any = {
      select: () => api,
      eq: (col: string, val: any) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: any) => { ops.push({ op: 'in', col, val }); return api; },
      neq: (col: string, val: any) => { ops.push({ op: 'neq', col, val }); return api; },
      not: () => api, gte: () => api, lte: () => api, or: () => api,
      is: (col: string, val: any) => { ops.push({ op: 'is', col, val }); return api; },
      order: () => api, limit: () => api, range: () => api,
      insert: (payload: any) => { mut.kind = 'insert'; mut.payload = payload; return api; },
      update: (payload: any) => { mut.kind = 'update'; mut.payload = payload; return api; },
      delete: () => { mut.kind = 'delete'; return api; },
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
      return rpcResults.get(name) || { data: { id: `${name}-id`, status: 'active' }, error: null };
    },
  };
}

let mockDb: ReturnType<typeof makeDb>;
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));

import { GET as projectsGET, POST as projectPOST } from '@/app/api/projects/route';
import { GET as projectGET, PUT as projectPUT, DELETE as projectDELETE } from '@/app/api/projects/[id]/route';
import { GET as projectCostsGET } from '@/app/api/projects/costs/route';

const C1 = 'company-1'; const USER = 'u1';
const CLIENT = '00000000-0000-4000-8000-000000000c01';
const PROJECT = '00000000-0000-4000-8000-000000000d01';
const FOREIGN_PROJECT = '00000000-0000-4000-8000-000000000d02';
function baseDb() {
  return {
    users: [{ id: USER, company_id: C1, is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: { projects: true, reports: true } } }],
    contacts: [{ id: CLIENT, company_id: C1, name: 'عميل' }],
    projects: [], boq_items: [], journal_lines: [],
  } as Record<string, Row[]>;
}
function request(body?: any, method = 'POST', url = 'http://localhost/api/test') {
  const token = createToken(USER, 'admin');
  return { url, method, headers: { get: (key: string) => key === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined }, json: async () => body } as any;
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const rpc = (name: string) => mockDb.rpcCalls.find((call) => call.name === name);
beforeEach(() => { mockDb = makeDb(baseDb()); });

describe('project atomic lifecycle boundary', () => {
  test('cash-customer creation is delegated without any direct chart mutation', async () => {
    const response = await projectPOST(request({ name: 'مشروع نقدي', contract_value: 500, start_date: '2026-01-15' }));
    expect(response.status).toBe(201);
    expect(rpc('create_project_atomic')!.params).toMatchObject({
      p_company_id: C1, p_user_id: USER, p_client_id: null, p_contract_value: 500,
    });
    expect(mockDb.calls.filter((call) => call.mut.kind)).toHaveLength(0);
  });

  test('BOQ normalization and optional invoice flag cross one atomic boundary', async () => {
    const response = await projectPOST(request({
      name: 'مشروع', client_id: CLIENT, start_date: '2026-01-15', auto_invoice: true,
      items: [{ description: ' بند ', unit: 'م', quantity: 2, unit_price: 500 }],
    }));
    expect(response.status).toBe(201);
    expect(rpc('create_project_atomic')!.params).toMatchObject({
      p_company_id: C1, p_client_id: CLIENT, p_contract_value: 1000, p_auto_invoice: true,
      p_items: [{ description: 'بند', unit: 'م', quantity: 2, unit_price: 500 }],
    });
  });

  test('invalid BOQ is rejected before PostgreSQL is called', async () => {
    const response = await projectPOST(request({
      name: 'مشروع', contract_value: 10, start_date: '2026-01-15',
      items: [{ description: 'x', quantity: -1, unit_price: 10 }],
    }));
    expect(response.status).toBe(400);
    expect(mockDb.rpcCalls).toHaveLength(0);
  });

  test('project update rejects unknown identity fields and sends trusted identity', async () => {
    mockDb = makeDb({ ...baseDb(), projects: [{ id: PROJECT, company_id: C1 }] });
    expect((await projectPUT(request({ name: 'جديد', company_id: 'attacker', created_by: 'attacker' }, 'PUT'), params(PROJECT))).status).toBe(400);
    expect(mockDb.rpcCalls).toHaveLength(0);
    const response = await projectPUT(request({ name: 'جديد' }, 'PUT'), params(PROJECT));
    expect(response.status).toBe(200);
    expect(rpc('update_project_atomic')!.params).toMatchObject({
      p_company_id: C1, p_project_id: PROJECT, p_user_id: USER, p_payload: { name: 'جديد' },
    });
  });

  test('DELETE is a tenant-scoped audited cancellation RPC, never a hard delete', async () => {
    mockDb = makeDb({ ...baseDb(), projects: [{ id: PROJECT, company_id: C1 }] });
    const response = await projectDELETE(request(undefined, 'DELETE'), params(PROJECT));
    expect(response.status).toBe(200);
    expect(rpc('cancel_empty_project_atomic')!.params).toEqual({ p_company_id: C1, p_project_id: PROJECT, p_user_id: USER });
    expect(mockDb.calls.filter((call) => call.mut.kind === 'delete')).toHaveLength(0);
  });
});

describe('project reads and costs', () => {
  test('single-project IDOR is blocked by a company-scoped parent lookup', async () => {
    mockDb = makeDb({ ...baseDb(), projects: [{ id: FOREIGN_PROJECT, company_id: 'company-2' }] });
    const response = await projectGET(request(undefined, 'GET'), params(FOREIGN_PROJECT));
    expect(response.status).toBe(404);
    expect(mockDb.calls.find((call) => call.table === 'projects')!.ops).toContainEqual({ op: 'eq', col: 'company_id', val: C1 });
  });

  test('project list batch-loads BOQ once and always scopes child rows by company', async () => {
    mockDb = makeDb({ ...baseDb(),
      projects: [{ id: 'p1', company_id: C1 }, { id: 'p2', company_id: C1 }],
      boq_items: [{ id: 'b1', project_id: 'p1', company_id: C1 }],
    });
    const response = await projectsGET(request(undefined, 'GET'));
    const json = await response.json();
    expect(json.data.rows[0].boq_items).toHaveLength(1);
    const childCalls = mockDb.calls.filter((call) => call.table === 'boq_items');
    expect(childCalls).toHaveLength(1);
    expect(childCalls[0].ops).toContainEqual({ op: 'eq', col: 'company_id', val: C1 });
  });

  test('cost report verifies the parent tenant and aggregates each tagged line once', async () => {
    mockDb = makeDb({ ...baseDb(),
      projects: [{ id: PROJECT, company_id: C1 }],
      journal_lines: [
        { company_id: C1, project_id: PROJECT, debit: 100, credit: 0, accounts: { code: '5100', name: 'تكلفة', type: 'expense' } },
        { company_id: C1, project_id: PROJECT, debit: 0, credit: 180, accounts: { code: '4100', name: 'إيراد', type: 'revenue' } },
        { company_id: 'company-2', project_id: PROJECT, debit: 999, credit: 0, accounts: { code: '5100', name: 'أجنبي', type: 'expense' } },
      ],
    });
    const response = await projectCostsGET(request(undefined, 'GET', `http://localhost/api/projects/costs?projectId=${PROJECT}`));
    const json = await response.json();
    expect(json.data).toMatchObject({ grand_total: 100, total_revenue: 180, net_profit: 80 });
    const linesCall = mockDb.calls.find((call) => call.table === 'journal_lines')!;
    expect(linesCall.ops).toEqual(expect.arrayContaining([
      { op: 'eq', col: 'project_id', val: PROJECT }, { op: 'eq', col: 'company_id', val: C1 },
    ]));
  });

  test('cost report returns 404 for another tenant project before reading journal lines', async () => {
    mockDb = makeDb({ ...baseDb(), projects: [{ id: FOREIGN_PROJECT, company_id: 'company-2' }] });
    const response = await projectCostsGET(request(undefined, 'GET', `http://localhost/api/projects/costs?projectId=${FOREIGN_PROJECT}`));
    expect(response.status).toBe(404);
    expect(mockDb.calls.filter((call) => call.table === 'journal_lines')).toHaveLength(0);
  });
});
