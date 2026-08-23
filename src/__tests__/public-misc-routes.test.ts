/**
 * Route-boundary tests for public/lightly-guarded routes: docs (OpenAPI),
 * visitors tracking (POST + admin GET), advertisements (public list),
 * and ads/track (authenticated exactly-once ad event recording).
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
import { createToken } from '@/lib/auth';

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
          return true;
        })
      );
    const api: TestBuilder = {
      select: () => api,
      eq: (col: string, val: unknown) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: unknown) => { ops.push({ op: 'in', col, val }); return api; },
      order: () => api, limit: () => api, range: () => api, is: () => api, neq: () => api,
      or: () => api, lt: () => api, gte: (col: string, val: unknown) => { ops.push({ op: 'gte', col, val }); return api; },
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

/** Build a query chain whose awaited terminal `then` resolves `{data, error: err}`. */
function chainWithError(err: unknown): TestBuilder {
  const chain: TestBuilder = {
    select: () => chain,
    eq: () => chain, in: () => chain, order: () => chain, limit: () => chain,
    range: () => chain, is: () => chain, neq: () => chain, or: () => chain,
    lt: () => chain, gte: () => chain, lte: () => chain,
    then: <T1 = { data: unknown; error: unknown }, T2 = never>(
      ok?: ((v: { data: unknown; error: unknown }) => T1 | PromiseLike<T1>) | null,
    ) => {
      const result = ok ? ok({ data: null, error: err }) : undefined;
      return Promise.resolve(result as T1 | T2);
    },
  };
  return chain;
}

let mockDb: ReturnType<typeof makeDb>;
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));

import { GET as docsGET } from '@/app/api/docs/route';
import { GET as visitorsGET, POST as visitorsPOST } from '@/app/api/visitors/route';
import { GET as advertisementsGET } from '@/app/api/advertisements/route';
import { POST as adsTrackPOST } from '@/app/api/ads/track/route';
import { resetRateLimits } from '@/lib/memory-rate-limit';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';

const C1 = 'company-1';

function req(role = 'admin', method = 'GET', url = 'http://localhost/x', body?: Row, extraHeaders: Record<string, string> = {}) {
  const token = createToken('u1', role, 0);
  return { url, method, nextUrl: new URL(url), headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : (extraHeaders[k] ?? null) },
    cookies: { get: () => undefined }, json: async () => body } as unknown as NextRequest;
}

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: {} } }],
    visitor_logs: [], visitor_stats: [], advertisements: [], audit_log: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { resetRateLimits(); mockDb = makeDb(baseDb()); });

describe('docs OpenAPI', () => {
  test('returns a spec with the request host/protocol and cache headers', async () => {
    const res = await docsGET(req('admin', 'GET', 'http://localhost/api/docs/openapi.json', undefined, { host: 'acme.example', 'x-forwarded-proto': 'https' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.openapi).toBe('3.0.3');
    expect(json.data.servers[0].url).toBe('https://acme.example');
    expect(json.data.paths['/api/auth/login']).toBeDefined();
    expect(res.headers.get('cache-control')).toMatch(/public/);
  });
});

describe('visitors', () => {
  test('POST records a visit and updates stats (existing stat row)', async () => {
    const today = new Date().toISOString().split('T')[0];
    mockDb = makeDb({ ...baseDb(), visitor_stats: [{ date: today, visits: 5, unique_visitors: 2 }] });
    const res = await visitorsPOST(req('admin', 'POST', 'http://localhost/api/visitors', { path: '/dashboard' }, { 'x-forwarded-for': '1.2.3.4', 'user-agent': 'ua' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.ok).toBe(true);
  });

  test('POST creates a new stat row when none exists', async () => {
    const res = await visitorsPOST(req('admin', 'POST', 'http://localhost/api/visitors', { path: '/' }));
    expect(res.status).toBe(200);
  });

  test('POST falls back to root path for non-string payload', async () => {
    const res = await visitorsPOST(req('admin', 'POST', 'http://localhost/api/visitors', { path: 42 }));
    expect(res.status).toBe(200);
  });

  test('POST silently succeeds when the db throws', async () => {
    const crashing = makeDb(baseDb());
    crashing.from = () => { throw new Error('boom'); };
    mockDb = crashing;
    const res = await visitorsPOST(req('admin', 'POST', 'http://localhost/api/visitors', { path: '/' }));
    expect(res.status).toBe(200);
  });

  test('GET requires admin and returns today + weekly stats', async () => {
    const today = new Date().toISOString().split('T')[0];
    mockDb = makeDb({ ...baseDb(), visitor_stats: [{ date: today, visits: 3, unique_visitors: 1 }] });
    const res = await visitorsGET(req('admin', 'GET', 'http://localhost/api/visitors'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.visits).toBe(3);
  });

  test('GET denies non-admin (DB role is authoritative)', async () => {
    mockDb = makeDb({ ...baseDb(), users: [{ id: 'u1', company_id: C1, is_active: true, token_version: 0, role: 'accountant' }] });
    const res = await visitorsGET(req('accountant', 'GET', 'http://localhost/api/visitors'));
    expect(res.status).toBe(403);
  });
});

describe('advertisements GET', () => {
  const ad = (over: Record<string, any> = {}) => ({
    id: 'a1', title: 'ad', body: 'b', type: 'banner', display_mode: 'banner',
    priority: 1, link_url: null, link_text: null, expires_at: null, starts_at: null, is_active: true,
    ...over,
  });
  test('returns active, unexpired ads for a whitelisted mode', async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const past = new Date(Date.now() - 86400000).toISOString();
    mockDb = makeDb({ ...baseDb(), advertisements: [
      ad({ display_mode: 'banner', starts_at: past }),
      ad({ display_mode: 'banner', expires_at: past, starts_at: past }),
      ad({ display_mode: 'banner', starts_at: future }),
    ] });
    const res = await advertisementsGET(req('admin', 'GET', 'http://localhost/api/advertisements?display_mode=banner'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(1);
  });

  test('falls back to top_bar for an unknown display mode', async () => {
    const res = await advertisementsGET(req('admin', 'GET', 'http://localhost/api/advertisements?display_mode=hack'));
    expect(res.status).toBe(200);
  });

  test('returns an empty list when the table is missing (42P01)', async () => {
    mockDb = makeDb(baseDb());
    const original = mockDb.from;
    mockDb.from = ((t: string) => {
      if (t !== 'advertisements') return original(t);
      // Terminal query resolves with a PostgREST-style undefined-table error.
      return chainWithError({ code: '42P01', message: 'relation does not exist' });
    });
    const res = await advertisementsGET(req('admin', 'GET', 'http://localhost/api/advertisements'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual([]);
  });
});

describe('ads/track POST', () => {
  test('records a view for an authenticated user', async () => {
    mockDb.rpcResults.set('record_ad_event', { data: true, error: null });
    const res = await adsTrackPOST(req('admin', 'POST', 'http://localhost/api/ads/track', { ad_id: '11111111-1111-4111-8111-111111111111', event: 'view' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.recorded).toBe(true);
  });

  test('reports already-recorded when the RPC returns non-true', async () => {
    mockDb.rpcResults.set('record_ad_event', { data: false, error: null });
    const res = await adsTrackPOST(req('admin', 'POST', 'http://localhost/api/ads/track', { ad_id: '11111111-1111-4111-8111-111111111111', event: 'click' }));
    const json = await res.json();
    expect(json.data.already_recorded).toBe(true);
  });

  test('rejects invalid ad id or event', async () => {
    const res1 = await adsTrackPOST(req('admin', 'POST', 'http://localhost/api/ads/track', { ad_id: 'not-an-id', event: 'view' }));
    expect(res1.status).toBe(200);
    const json = await res1.json();
    expect(json.data.ok).toBe(false);
    const res2 = await adsTrackPOST(req('admin', 'POST', 'http://localhost/api/ads/track', { ad_id: '11111111-1111-4111-8111-111111111111', event: 'hover' }));
    const json2 = await res2.json();
    expect(json2.data.ok).toBe(false);
  });

  test('returns a 500 via handleApiError when the RPC fails', async () => {
    mockDb.rpcResults.set('record_ad_event', { data: null, error: { message: 'db down' } });
    const res = await adsTrackPOST(req('admin', 'POST', 'http://localhost/api/ads/track', { ad_id: '11111111-1111-4111-8111-111111111111', event: 'view' }));
    expect(res.status).toBe(500);
  });
});
