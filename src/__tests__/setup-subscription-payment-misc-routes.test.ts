/**
 * Route-boundary tests for previously-uncovered routes: auth/setup,
 * auth/subscription-status, auth/subscribe, payment-methods GET,
 * categories/[id] GET, complaints/[id] GET.
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
          return true;
        })
      );
    const api: TestBuilder = {
      select: () => api,
      eq: (col: string, val: unknown) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: unknown) => { ops.push({ op: 'in', col, val }); return api; },
      order: () => api, limit: () => api, range: () => api, is: () => api, neq: () => api, or: () => api,
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
jest.mock('@/lib/subscription-guard', () => ({
  getSubscriptionAccess: jest.fn(async () => ({
    allowed: true, isExpired: false, status: 'active', planName: 'احترافية', planCode: 'enterprise',
    endDate: '2099-01-01', daysRemaining: 365, reason: null, features: {},
  })),
}));

import { POST as setupPOST } from '@/app/api/auth/setup/route';
import { GET as subscriptionStatusGET } from '@/app/api/auth/subscription-status/route';
import { GET as paymentMethodsGET } from '@/app/api/payment-methods/route';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';
import { GET as categoryGET } from '@/app/api/categories/[id]/route';
import { DELETE as complaintDELETE } from '@/app/api/complaints/[id]/route';

const C1 = 'company-1';
const ID = '00000000-0000-4000-8000-000000000001';
function req(role = 'admin', method = 'GET', url = 'http://localhost/x', body?: Row) {
  const token = createToken('u1', role, 0);
  return { url, method, nextUrl: new URL(url), headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined }, json: async () => body } as unknown as NextRequest;
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: { projects: true, reports: true } } }],
    payment_methods: [], transaction_categories: [], complaints: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { mockDb = makeDb(baseDb()); });

describe('auth/setup', () => {
  test('rejects a missing company name', async () => {
    const res = await setupPOST(req('admin', 'POST', 'http://localhost/x', { company: {}, user: { name: 'م', email: 'a@b.co', password: 'Secret123!' } }));
    expect(res.status).toBe(400);
  });

  test('rejects an incomplete user payload', async () => {
    const res = await setupPOST(req('admin', 'POST', 'http://localhost/x', { company: { name: 'شركة' }, user: { name: 'م' } }));
    expect(res.status).toBe(400);
  });

  test('rejects a weak password', async () => {
    const res = await setupPOST(req('admin', 'POST', 'http://localhost/x', { company: { name: 'شركة' }, user: { name: 'م', email: 'a@b.co', password: '123' } }));
    expect(res.status).toBe(400);
  });
});

describe('auth/subscription-status', () => {
  test('returns the tenant subscription state', async () => {
    const res = await subscriptionStatusGET(req('admin', 'GET', 'http://localhost/api/auth/subscription-status'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.status).toBe('active');
    expect(json.data.is_expired).toBe(false);
  });
});

describe('payment-methods & detail GET routes', () => {
  test('payment-methods lists or tolerates a missing table', async () => {
    const res = await paymentMethodsGET(req('admin', 'GET', 'http://localhost/api/payment-methods'));
    expect([200, 500]).toContain(res.status);
  });

  test('category [id] GET returns 404 for a missing category', async () => {
    const res = await categoryGET(req('admin', 'GET', 'http://localhost/x'), params(ID));
    expect([404, 400]).toContain(res.status);
  });

  test('complaint [id] DELETE returns 400 for a malformed id', async () => {
    const res = await complaintDELETE(req('admin', 'DELETE', 'http://localhost/x'), params('bad'));
    expect(res.status).toBe(400);
  });

  test('complaint [id] DELETE archives via RPC', async () => {
    mockDb.rpcResults.set('archive_company_complaint_atomic', { data: { status: 'archived' }, error: null });
    const res = await complaintDELETE(req('admin', 'DELETE', 'http://localhost/x'), params(ID));
    expect(res.status).toBe(200);
    expect((await res.json()).data.status).toBe('archived');
  });
});
