/**
 * Route-boundary tests for /api/crm and /api/crm/[id]: leads/opportunities
 * pipeline list+create, and per-contact detail/update/delete/follow-up.
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
import { createToken } from '@/lib/auth';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
type Op = { op: string; col?: string; val?: unknown };

function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Op[] }> = [];
  const rpcResults = new Map<string, { data: unknown; error: unknown }>();
  const from = (table: string) => {
    const ops: Op[] = [];
    calls.push({ table, ops });
    const rows = () =>
      (db[table] || []).filter((r) =>
        ops.every((o) => {
          if (o.op === 'eq') return r[o.col!] === o.val;
          if (o.op === 'in') return (o.val as unknown[]).includes(r[o.col!]);
          if (o.op === 'gte') return String(r[o.col!]) >= String(o.val);
          if (o.op === 'lte') return String(r[o.col!]) <= String(o.val);
          if (o.op === 'lt') return String(r[o.col!]) < String(o.val);
          return true;
        })
      );
    const api: TestBuilder = {
      select: () => api,
      eq: (col: string, val: unknown) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: unknown) => { ops.push({ op: 'in', col, val }); return api; },
      order: () => api, limit: () => api, range: () => api, is: () => api, neq: () => api,
      or: () => api, lt: (col: string, val: unknown) => { ops.push({ op: 'lt', col, val }); return api; },
      gte: (col: string, val: unknown) => { ops.push({ op: 'gte', col, val }); return api; },
      lte: (col: string, val: unknown) => { ops.push({ op: 'lte', col, val }); return api; },
      insert: () => api, update: () => api, delete: () => api,
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

import { GET as crmGET, POST as crmPOST } from '@/app/api/crm/route';
import {
  GET as contactGET, PUT as contactPUT, DELETE as contactDELETE, POST as contactPOST,
} from '@/app/api/crm/[id]/route';
import { resetRateLimits } from '@/lib/memory-rate-limit';

const PID = '00000000-0000-4000-8000-000000000d01';
const CID = '00000000-0000-4000-8000-00000000000a';
const C1 = 'company-1';
const ADMIN = '00000000-0000-4000-8000-00000000a001';

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
      subscription_plans: { code: 'enterprise', features_modules: { crm: true } } }],
    crm_contacts: [], crm_followups: [], audit_log: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { resetRateLimits(); mockDb = makeDb(baseDb()); });

function crmRow(over: Record<string, any> = {}) {
  return {
    id: CID, company_id: C1, name: 'عميل محتمل', type: 'lead',
    email: 'lead@example.com', pipeline_stage: 'new', estimated_value: 1000,
    crm_followups: [{ id: 'f1', type: 'call', scheduled_at: new Date(Date.now() + 86400000).toISOString(), notes: 'x' }],
    ...over,
  };
}

describe('crm GET list', () => {
  test('lists tenant pipeline with counts', async () => {
    mockDb = makeDb({ ...baseDb(), crm_contacts: [crmRow()] });
    const res = await crmGET(req('admin', 'GET', 'http://localhost/api/crm'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.contacts).toHaveLength(1);
    expect(json.data.total).toBe(1);
    expect(json.data.pipeline).toHaveProperty('new');
    expect(json.data.conversionRate).toBe('0.0');
  });

  test('rejects an invalid pipeline stage filter', async () => {
    const res = await crmGET(req('admin', 'GET', 'http://localhost/api/crm?stage=bogus'));
    expect(res.status).toBe(400);
  });

  test('rejects an invalid type filter', async () => {
    const res = await crmGET(req('admin', 'GET', 'http://localhost/api/crm?type=bogus'));
    expect(res.status).toBe(400);
  });
});

describe('crm POST create', () => {
  test('creates a lead through the lifecycle RPC', async () => {
    mockDb = makeDb(baseDb());
    mockDb.rpcResults.set('create_crm_contact_atomic', { data: { id: CID }, error: null });
    const res = await crmPOST(req('admin', 'POST', 'http://localhost/api/crm', {
      name: 'عميل محتمل', type: 'lead', email: 'lead@example.com', assigned_to: null,
    }));
    expect(res.status).toBe(201);
  });

  test('rejects an invalid payload', async () => {
    const res = await crmPOST(req('admin', 'POST', 'http://localhost/api/crm', { name: '' }));
    expect(res.status).toBe(400);
  });

  test('maps a business-rule RPC error to a 400', async () => {
    mockDb.rpcResults.set('create_crm_contact_atomic', { data: null, error: { message: 'بيانات غير صالحة' } });
    const res = await crmPOST(req('admin', 'POST', 'http://localhost/api/crm', {
      name: 'x', type: 'lead', email: 'a@b.co', assigned_to: null,
    }));
    expect(res.status).toBe(400);
  });
});

describe('crm/[id] GET', () => {
  test('returns contact with follow-ups', async () => {
    mockDb = makeDb({ ...baseDb(), crm_contacts: [crmRow()], crm_followups: [] });
    const res = await contactGET(req('admin', 'GET', `http://localhost/api/crm/${CID}`), { params: Promise.resolve({ id: CID }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.followups).toEqual([]);
    expect(json.data.upcomingFollowups).toBe(0);
  });

  test('rejects invalid id and returns 404 for unknown contact', async () => {
    const res1 = await contactGET(req('admin', 'GET', 'http://localhost/x'), { params: Promise.resolve({ id: 'bad' }) });
    expect(res1.status).toBe(400);
    const res2 = await contactGET(req('admin', 'GET', 'http://localhost/x'), { params: Promise.resolve({ id: CID }) });
    expect(res2.status).toBe(404);
  });
});

describe('crm/[id] PUT', () => {
  test('updates a contact via RPC', async () => {
    mockDb.rpcResults.set('update_crm_contact_atomic', { data: { id: CID }, error: null });
    const res = await contactPUT(req('admin', 'PUT', 'http://localhost/x', { name: 'محدث' }), { params: Promise.resolve({ id: CID }) });
    expect(res.status).toBe(200);
  });

  test('rejects invalid id or payload', async () => {
    const res1 = await contactPUT(req('admin', 'PUT', 'http://localhost/x', { name: 'x' }), { params: Promise.resolve({ id: 'bad' }) });
    expect(res1.status).toBe(400);
    const res2 = await contactPUT(req('admin', 'PUT', 'http://localhost/x', {}), { params: Promise.resolve({ id: CID }) });
    expect(res2.status).toBe(400);
  });

  test('maps not-found and stage-transition RPC errors', async () => {
    mockDb.rpcResults.set('update_crm_contact_atomic', { data: null, error: { message: 'غير موجود' } });
    const res1 = await contactPUT(req('admin', 'PUT', 'http://localhost/x', { name: 'x' }), { params: Promise.resolve({ id: CID }) });
    expect(res1.status).toBe(404);
    mockDb.rpcResults.set('update_crm_contact_atomic', { data: null, error: { message: 'انتقال مرحلة غير مسموح' } });
    const res2 = await contactPUT(req('admin', 'PUT', 'http://localhost/x', { name: 'x' }), { params: Promise.resolve({ id: CID }) });
    expect(res2.status).toBe(409);
  });
});

describe('crm/[id] DELETE', () => {
  test('deletes a contact via RPC', async () => {
    mockDb.rpcResults.set('delete_crm_contact_atomic', { data: true, error: null });
    const res = await contactDELETE(req('admin', 'DELETE', 'http://localhost/x'), { params: Promise.resolve({ id: CID }) });
    expect(res.status).toBe(200);
  });

  test('rejects invalid id', async () => {
    const res = await contactDELETE(req('admin', 'DELETE', 'http://localhost/x'), { params: Promise.resolve({ id: 'bad' }) });
    expect(res.status).toBe(400);
  });

  test('maps not-found and cannot-delete RPC errors', async () => {
    mockDb.rpcResults.set('delete_crm_contact_atomic', { data: null, error: { message: 'غير موجود' } });
    const res1 = await contactDELETE(req('admin', 'DELETE', 'http://localhost/x'), { params: Promise.resolve({ id: CID }) });
    expect(res1.status).toBe(404);
    mockDb.rpcResults.set('delete_crm_contact_atomic', { data: null, error: { message: 'لا يمكن حذف' } });
    const res2 = await contactDELETE(req('admin', 'DELETE', 'http://localhost/x'), { params: Promise.resolve({ id: CID }) });
    expect(res2.status).toBe(409);
  });
});

describe('crm/[id] POST follow-up', () => {
  test('schedules a follow-up via RPC', async () => {
    mockDb.rpcResults.set('create_crm_followup_atomic', { data: { id: 'f2' }, error: null });
    const res = await contactPOST(req('admin', 'POST', 'http://localhost/x', {
      type: 'call', scheduled_at: new Date().toISOString(),
    }), { params: Promise.resolve({ id: CID }) });
    expect(res.status).toBe(201);
  });

  test('rejects invalid id or payload', async () => {
    const res1 = await contactPOST(req('admin', 'POST', 'http://localhost/x', { type: 'call', scheduled_at: 'bad' }), { params: Promise.resolve({ id: CID }) });
    expect(res1.status).toBe(400);
    const res2 = await contactPOST(req('admin', 'POST', 'http://localhost/x', { type: 'call', scheduled_at: new Date().toISOString() }), { params: Promise.resolve({ id: 'bad' }) });
    expect(res2.status).toBe(400);
  });

  test('maps not-found RPC error to 404', async () => {
    mockDb.rpcResults.set('create_crm_followup_atomic', { data: null, error: { message: 'غير موجود' } });
    const res = await contactPOST(req('admin', 'POST', 'http://localhost/x', { type: 'call', scheduled_at: new Date().toISOString() }), { params: Promise.resolve({ id: CID }) });
    expect(res.status).toBe(404);
  });
});
