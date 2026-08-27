/**
 * Route-boundary tests for previously-uncovered routes: approvals GET,
 * vouchers/client-advance, equipment-costs GET, notifications/smart.
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
          if (o.op === 'lt') return (r[o.col!] as string) < (o.val as string);
          if (o.op === 'gte') return (r[o.col!] as string) >= (o.val as string);
          if (o.op === 'lte') return (r[o.col!] as string) <= (o.val as string);
          return true;
        })
      );
    const api: TestBuilder = {
      select: () => api,
      eq: (col: string, val: unknown) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: unknown) => { ops.push({ op: 'in', col, val }); return api; },
      lt: (col: string, val: unknown) => { ops.push({ op: 'lt', col, val }); return api; },
      gte: () => api, lte: () => api, is: () => api, order: () => api, limit: () => api, range: () => api,
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

import { GET as approvalsGET } from '@/app/api/approvals/route';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';
import { GET as clientAdvanceGET } from '@/app/api/vouchers/client-advance/route';
import { GET as equipmentCostsGET } from '@/app/api/equipment-costs/route';
import { GET as smartNotificationsGET } from '@/app/api/notifications/smart/route';

const C1 = 'company-1';
const CLIENT = '00000000-0000-4000-8000-000000000c01';
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
      subscription_plans: { code: 'enterprise', features_modules: { projects: true, reports: true, approvals: true, notifications: true, receipts: true, fixed_assets: true } } }],
    approval_requests: [], invoices: [], equipment_costs: [], contacts: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { mockDb = makeDb(baseDb()); });

describe('approvals GET', () => {
  test('rejects an invalid status/entity_type filter', async () => {
    expect((await approvalsGET(req('admin', 'GET', 'http://localhost/api/approvals?status=bogus'))).status).toBe(400);
    expect((await approvalsGET(req('admin', 'GET', 'http://localhost/api/approvals?entity_type=bogus'))).status).toBe(400);
  });

  test('lists tenant approval requests with urgency', async () => {
    mockDb = makeDb({ ...baseDb(), approval_requests: [{ id: 'a1', company_id: C1, entity_type: 'invoice', status: 'pending', requester: { name: 'م' }, approver: null }] });
    const res = await approvalsGET(req('admin', 'GET', 'http://localhost/api/approvals'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.requests).toHaveLength(1);
    expect(json.data.requests[0].requester_name).toBe('م');
  });
});

describe('vouchers/client-advance', () => {
  test('rejects a missing/invalid contact id and returns the balance', async () => {
    expect((await clientAdvanceGET(req('admin', 'GET', 'http://localhost/x'))).status).toBe(400);
    mockDb = makeDb({ ...baseDb(), contacts: [{ id: CLIENT, company_id: C1, type: 'client' }] });
    mockDb.rpcResults.set('get_customer_advances', { data: [{ balance: 250 }], error: null });
    const res = await clientAdvanceGET(req('admin', 'GET', `http://localhost/x?contactId=${CLIENT}`));
    expect(res.status).toBe(200);
    expect((await res.json()).data.balance).toBe(250);
  });
});

describe('equipment-costs GET', () => {
  test('rejects an invalid project filter and lists tenant rows', async () => {
    expect((await equipmentCostsGET(req('admin', 'GET', 'http://localhost/api/equipment-costs?project_id=bad'))).status).toBe(400);
    mockDb = makeDb({ ...baseDb(), equipment_costs: [{ id: 'e1', company_id: C1 }] });
    const res = await equipmentCostsGET(req('admin', 'GET', 'http://localhost/api/equipment-costs'));
    expect(res.status).toBe(200);
    expect((await res.json()).data.rows).toHaveLength(1);
  });
});

describe('notifications/smart', () => {
  test('builds smart notifications from overdue invoices', async () => {
    mockDb = makeDb({ ...baseDb(), invoices: [{ id: 'i1', company_id: C1, status: 'unpaid', total: 100, due_date: '2020-01-01', contacts: { name: 'عميل' } }] });
    const res = await smartNotificationsGET(req('admin', 'GET', 'http://localhost/api/notifications/smart'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.data.notifications)).toBe(true);
    expect(json.data.notifications.some((n: Row) => n.type === 'danger')).toBe(true);
  });
});
