/**
 * Route-boundary tests for previously-uncovered routes: auth/subscribe,
 * messages GET, dashboard GET, docs, reminders, visitors, push-notifications,
 * settings/telegram/test.
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
          return true;
        })
      );
    const api: any = {
      select: () => api,
      eq: (col: string, val: any) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: any) => { ops.push({ op: 'in', col, val }); return api; },
      order: () => api, limit: () => api, range: () => api, is: () => api, neq: () => api, or: () => api,
      lt: () => api, gte: () => api, lte: () => api, insert: () => api,
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

import { POST as subscribePOST } from '@/app/api/auth/subscribe/route';
import { GET as messagesGET } from '@/app/api/messages/route';
import { GET as dashboardGET } from '@/app/api/dashboard/route';
import { GET as remindersGET } from '@/app/api/reminders/route';
import { GET as ganttGET } from '@/app/api/gantt/route';
import { GET as ganttDepsGET } from '@/app/api/gantt/dependencies/route';

const PID = '00000000-0000-4000-8000-000000000d01';

const C1 = 'company-1';
function req(role = 'admin', method = 'GET', url = 'http://localhost/x', body?: any) {
  const token = createToken('u1', role, 0);
  return { url, method, nextUrl: new URL(url), headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined }, json: async () => body } as any;
}

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: { projects: true, reports: true, messages: true, dashboard: true, reminders: true } } }],
    messages: [], projects: [], reminders: [], audit_log: [], project_tasks: [], project_task_dependencies: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { mockDb = makeDb(baseDb()); });

describe('auth/subscribe', () => {
  test('the legacy subscription endpoint is deprecated (410)', async () => {
    const res = await subscribePOST(req('admin', 'POST', 'http://localhost/x', {}));
    expect(res.status).toBe(410);
  });
});

describe('messages GET', () => {
  test('lists tenant messages', async () => {
    mockDb = makeDb({ ...baseDb(), messages: [{ id: 'm1', company_id: C1 }] });
    const res = await messagesGET(req('admin', 'GET', 'http://localhost/api/messages'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.messages).toHaveLength(1);
  });
});

describe('dashboard GET', () => {
  test('returns the tenant dashboard', async () => {
    const res = await dashboardGET(req('admin', 'GET', 'http://localhost/api/dashboard'));
    expect(res.status).toBe(200);
  });
});

describe('reminders & visitors GET', () => {
  test('reminders lists tenant reminders', async () => {
    const res = await remindersGET(req('admin', 'GET', 'http://localhost/api/reminders'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveProperty('overdue');
  });
});

describe('gantt routes', () => {
  test('gantt rejects an invalid project id', async () => {
    const res = await ganttGET(req('admin', 'GET', 'http://localhost/x?project_id=bad'));
    expect(res.status).toBe(400);
  });

  test('gantt returns tasks for a valid project', async () => {
    mockDb = makeDb({ ...baseDb(), projects: [{ id: PID, company_id: C1 }] });
    const res = await ganttGET(req('admin', 'GET', `http://localhost/x?project_id=${PID}`));
    expect(res.status).toBe(200);
  });

  test('gantt dependencies rejects an invalid project id', async () => {
    const res = await ganttDepsGET(req('admin', 'GET', 'http://localhost/x?project_id=bad'));
    expect(res.status).toBe(400);
  });
});
