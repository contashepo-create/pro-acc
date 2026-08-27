/**
 * Route-boundary tests for upload/receipt, subcontractors/payments,
 * permissions GET (userId).
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
    storage: { from: () => ({
      list: async () => ({ data: [], error: null }),
      upload: async () => ({ error: null }),
      createSignedUrl: async () => ({ data: { signedUrl: 'https://signed.example/x' }, error: null }),
      remove: async () => ({ error: null }),
    }) },
  };
}

let mockDb: ReturnType<typeof makeDb>;
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));

import { POST as upPOST } from '@/app/api/upload/receipt/route';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';
import { POST as payPOST } from '@/app/api/subcontractors/payments/route';
import { GET as permGET } from '@/app/api/permissions/route';
import { resetRateLimits } from '@/lib/memory-rate-limit';

const C1 = 'company-1';
const ID1 = '00000000-0000-4000-8000-00000000f0f1';

function req(role = 'admin', method = 'GET', url = 'http://localhost/x', body?: Row) {
  const token = createToken('u1', role, 0);
  return { url, method, nextUrl: new URL(url), headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined }, json: async () => body } as unknown as NextRequest;
}

function makeFile(type: string, size: number, bytes: Uint8Array) {
  return { type, size, arrayBuffer: async () => bytes } as unknown as File;
}

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, name: 'م', email: 'admin@example.com', is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: { subcontractors: true, settings: true } } }],
    user_permissions: [], custom_modules: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { resetRateLimits(); mockDb = makeDb(baseDb()); });

describe('upload/receipt POST', () => {
  function upReq(file: File | null) {
    const base = req('admin', 'POST', 'http://localhost/x');
    return { ...base, formData: async () => ({ get: () => file }) } as unknown as NextRequest;
  }

  test('rejects a missing file and unsupported type', async () => {
    const res1 = await upPOST(upReq(null));
    expect(res1.status).toBe(400);
    const res2 = await upPOST(upReq(makeFile('text/html', 10, new Uint8Array([1, 2, 3]))));
    expect(res2.status).toBe(400);
  });

  test('rejects an oversized file', async () => {
    const res = await upPOST(upReq(makeFile('application/pdf', 6 * 1024 * 1024, new Uint8Array([0x25, 0x50, 0x44, 0x46]))));
    expect(res.status).toBe(400);
  });

  test('uploads a valid PDF receipt', async () => {
    const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('x'.repeat(30)), Buffer.from('\n%%EOF')]);
    const res = await upPOST(upReq(makeFile('application/pdf', pdf.length, new Uint8Array(pdf))));
    expect(res.status).toBe(200);
  });
});

describe('subcontractors/payments POST', () => {
  test('rejects missing fields and invalid amount', async () => {
    const res1 = await payPOST(req('admin', 'POST', 'http://localhost/x', {}));
    expect(res1.status).toBe(400);
    const res2 = await payPOST(req('admin', 'POST', 'http://localhost/x', { contract_id: ID1, amount: -5, date: '2026-01-01', bank_safe_id: ID1 }));
    expect(res2.status).toBe(400);
  });

  test('maps RPC not-found and conflict errors', async () => {
    mockDb.rpcResults.set('create_subcontractor_payment_atomic', { data: null, error: { message: 'غير موجود' } });
    const res1 = await payPOST(req('admin', 'POST', 'http://localhost/x', { contract_id: ID1, amount: 100, date: '2026-01-01', bank_safe_id: ID1 }));
    expect(res1.status).toBe(404);
    mockDb.rpcResults.set('create_subcontractor_payment_atomic', { data: null, error: { message: 'تتجاوز' } });
    const res2 = await payPOST(req('admin', 'POST', 'http://localhost/x', { contract_id: ID1, amount: 100, date: '2026-01-01', bank_safe_id: ID1 }));
    expect(res2.status).toBe(409);
  });
});

describe('permissions GET (userId)', () => {
  test('returns permissions for an existing user', async () => {
    mockDb = makeDb({ ...baseDb(), users: [...baseDb().users, { id: ID1, company_id: C1, name: 'م', email: 'b@e.com', is_active: true, token_version: 0, role: 'accountant' }] });
    const res = await permGET(req('admin', 'GET', `http://localhost/api/permissions?userId=${ID1}`));
    expect(res.status).toBe(200);
  });
});
