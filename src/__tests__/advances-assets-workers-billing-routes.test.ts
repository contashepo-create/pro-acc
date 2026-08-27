/**
 * Route-boundary tests for employee-advances, fixed-assets, daily-workers,
 * progress-billing/[id], notifications, equipment-costs, projects/[id]/close.
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
      insert: (payload: Row | Row[]) => { db[table] = [...(db[table] || []), ...(Array.isArray(payload) ? payload : [payload])]; return api; },
      update: () => api, delete: () => api,
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

import { GET as advGET, POST as advPOST } from '@/app/api/employee-advances/route';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';
import { GET as faGET, POST as faPOST } from '@/app/api/fixed-assets/route';
import { GET as dwGET, POST as dwPOST } from '@/app/api/daily-workers/route';
import { GET as pbGET, PUT as pbPUT, DELETE as pbDELETE } from '@/app/api/progress-billing/[id]/route';
import { GET as notifGET, POST as notifPOST } from '@/app/api/notifications/route';
import { GET as ecGET, POST as ecPOST } from '@/app/api/equipment-costs/route';
import { POST as closePOST } from '@/app/api/projects/[id]/close/route';
import { resetRateLimits } from '@/lib/memory-rate-limit';

const C1 = 'company-1';
const ID1 = '00000000-0000-4000-8000-00000000f0f1';
const ID2 = '00000000-0000-4000-8000-00000000f0f2';

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
      subscription_plans: { code: 'enterprise', features_modules: { employees: true, fixed_assets: true, progress_billing: true, projects: true, dashboard: true } } }],
    employee_advances: [], fixed_assets: [], daily_workers: [], progress_billing: [],
    notifications: [], equipment_costs: [], projects: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { resetRateLimits(); mockDb = makeDb(baseDb()); });

describe('employee-advances', () => {
  test('GET lists advances with employee names', async () => {
    mockDb = makeDb({ ...baseDb(), employee_advances: [{ id: ID1, company_id: C1, employees: { name: 'موظف' } }] });
    const res = await advGET(req('admin', 'GET', 'http://localhost/api/employee-advances'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.advances[0].employee_name).toBe('موظف');
  });

  test('POST creates an advance', async () => {
    mockDb.rpcResults.set('create_employee_advance', { data: { id: ID1 }, error: null });
    const res = await advPOST(req('admin', 'POST', 'http://localhost/x', { employee_id: ID1, amount: 1000, bank_safe_id: ID2 }));
    expect(res.status).toBe(201);
  });
});

describe('fixed-assets', () => {
  test('GET lists assets with net book value', async () => {
    mockDb = makeDb({ ...baseDb(), fixed_assets: [{ id: ID1, company_id: C1, purchase_cost: 1000, accumulated_depreciation: 200 }] });
    const res = await faGET(req('admin', 'GET', 'http://localhost/api/fixed-assets'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.assets[0].net_book_value).toBe(800);
  });

  test('POST creates an asset', async () => {
    mockDb.rpcResults.set('create_fixed_asset', { data: { id: ID1 }, error: null });
    const res = await faPOST(req('admin', 'POST', 'http://localhost/x', {
      name: 'مبنى', code: 'FA-1', category: 'building', purchase_date: '2026-01-01', purchase_cost: 1000, useful_life_years: 10, bank_safe_id: ID2,
    }));
    expect(res.status).toBe(201);
  });
});

describe('daily-workers', () => {
  test('GET lists active workers', async () => {
    mockDb = makeDb({ ...baseDb(), daily_workers: [{ id: ID1, company_id: C1, name: 'عامل', is_active: true }] });
    const res = await dwGET(req('admin', 'GET', 'http://localhost/api/daily-workers'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.workers).toHaveLength(1);
  });

  test('POST creates a worker', async () => {
    mockDb.rpcResults.set('create_daily_worker_atomic', { data: { id: ID1 }, error: null });
    const res = await dwPOST(req('admin', 'POST', 'http://localhost/x', { name: 'عامل', daily_wage: 100 }));
    expect(res.status).toBe(201);
  });
});

describe('progress-billing/[id]', () => {
  test('GET returns a claim and 404 when missing', async () => {
    mockDb = makeDb({ ...baseDb(), progress_billing: [{ id: ID1, company_id: C1, net_amount: 100, tax_amount: 10 }] });
    const res = await pbGET(req('admin', 'GET', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.total_amount).toBe(110);
    const res2 = await pbGET(req('admin', 'GET', `http://localhost/x/${ID2}`), { params: Promise.resolve({ id: ID2 }) });
    expect(res2.status).toBe(404);
  });

  test('PUT cancels a claim', async () => {
    mockDb = makeDb({ ...baseDb(), progress_billing: [{ id: ID1, company_id: C1, net_amount: 100, tax_amount: 10 }] });
    mockDb.rpcResults.set('cancel_progress_billing_atomic', { data: { id: ID1 }, error: null });
    const res = await pbPUT(req('admin', 'PUT', 'http://localhost/x', { status: 'cancelled' }), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });

  test('PUT updates claim metadata', async () => {
    mockDb = makeDb({ ...baseDb(), progress_billing: [{ id: ID1, company_id: C1, net_amount: 100, tax_amount: 10, claim_number: '1' }] });
    mockDb.rpcResults.set('update_progress_billing_metadata', { data: { id: ID1 }, error: null });
    const res = await pbPUT(req('admin', 'PUT', 'http://localhost/x', { claim_number: '2' }), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });

  test('DELETE cancels a claim', async () => {
    mockDb = makeDb({ ...baseDb(), progress_billing: [{ id: ID1, company_id: C1, net_amount: 100, tax_amount: 10 }] });
    mockDb.rpcResults.set('cancel_progress_billing_atomic', { data: { id: ID1 }, error: null });
    const res = await pbDELETE(req('admin', 'DELETE', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });
});

describe('notifications', () => {
  test('GET lists notifications with unread count', async () => {
    mockDb = makeDb({ ...baseDb(), notifications: [{ id: ID1, company_id: C1, is_read: false }] });
    const res = await notifGET(req('admin', 'GET', 'http://localhost/api/notifications?unread_only=true'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.notifications).toHaveLength(1);
    expect(json.data.unreadCount).toBe(1);
  });

  test('POST creates a notification and rejects unsafe links', async () => {
    const res = await notifPOST(req('admin', 'POST', 'http://localhost/x', { type: 'info', title: 't', message: 'm', link: '/internal' }));
    expect(res.status).toBe(201);
    const res2 = await notifPOST(req('admin', 'POST', 'http://localhost/x', { type: 'info', title: 't', message: 'm', link: 'https://evil.com' }));
    expect(res2.status).toBe(400);
  });
});

describe('equipment-costs', () => {
  test('GET lists equipment costs', async () => {
    mockDb = makeDb({ ...baseDb(), equipment_costs: [{ id: ID1, company_id: C1, projects: { name: 'مشروع' } }] });
    const res = await ecGET(req('admin', 'GET', 'http://localhost/api/equipment-costs'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.rows).toHaveLength(1);
  });

  test('POST posts an equipment cost', async () => {
    mockDb.rpcResults.set('post_equipment_cost', { data: { id: ID1 }, error: null });
    const res = await ecPOST(req('admin', 'POST', 'http://localhost/x', { equipment_id: ID1, project_id: ID2, cost_type: 'fuel', amount: 100, date: '2026-01-01' }));
    expect(res.status).toBe(201);
  });
});

describe('projects/[id]/close POST', () => {
  test('closes a project', async () => {
    mockDb = makeDb({ ...baseDb(), projects: [{ id: ID1, company_id: C1, name: 'مشروع', contacts: { name: 'عميل' } }] });
    mockDb.rpcResults.set('close_project', { data: { total_revenue: 100, total_expenses: 60, net_profit: 40 }, error: null });
    const res = await closePOST(req('admin', 'POST', 'http://localhost/x', { close_date: '2026-01-31' }), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.closure_summary.net_profit).toBe(40);
    expect(json.data.client_name).toBe('عميل');
  });

  test('rejects an invalid id and returns 404 for unknown project', async () => {
    const res1 = await closePOST(req('admin', 'POST', 'http://localhost/x', {}), { params: Promise.resolve({ id: 'bad' }) });
    expect(res1.status).toBe(422);
    const res2 = await closePOST(req('admin', 'POST', 'http://localhost/x', {}), { params: Promise.resolve({ id: ID1 }) });
    expect(res2.status).toBe(404);
  });
});
