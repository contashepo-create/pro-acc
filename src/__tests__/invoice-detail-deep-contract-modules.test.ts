/**
 * Deep coverage for invoices/[id] GET (with project/user/journal), contracts/[id]
 * DELETE without storage paths, permissions/modules GET/POST/DELETE.
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
    storage: { from: () => ({ remove: async () => ({ error: null }) }) },
  };
}

let mockDb: ReturnType<typeof makeDb>;
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));

import { GET as invGET } from '@/app/api/invoices/[id]/route';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';
import { DELETE as conDELETE } from '@/app/api/contracts/[id]/route';
import { GET as modGET, POST as modPOST, DELETE as modDELETE } from '@/app/api/permissions/modules/route';
import { resetRateLimits } from '@/lib/memory-rate-limit';

const C1 = 'company-1';
const ID1 = '00000000-0000-4000-8000-00000000f0f1';

function req(role = 'admin', method = 'GET', url = 'http://localhost/x', body?: Row) {
  const token = createToken('u1', role, 0);
  return { url, method, nextUrl: new URL(url), headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined }, json: async () => body } as unknown as NextRequest;
}

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, name: 'مدير', email: 'admin@example.com', is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true, name: 'شركة' }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: { invoices: true, contracts: true } } }],
    invoices: [], invoice_items: [], contacts: [], projects: [], journal_entries: [], journal_lines: [],
    contracts: [], contract_documents: [], custom_modules: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { resetRateLimits(); mockDb = makeDb(baseDb()); });

describe('invoices/[id] GET deep', () => {
  test('returns an invoice with project, creator and journal lines', async () => {
    mockDb = makeDb({ ...baseDb(),
      invoices: [{ id: ID1, company_id: C1, contact_id: ID1, project_id: ID1, created_by: 'u1', journal_entry_id: 'je1', number: 'INV-1' }],
      invoice_items: [],
      contacts: [{ id: ID1, company_id: C1, name: 'عميل', city: 'الرياض' }],
      projects: [{ id: ID1, company_id: C1, name: 'مشروع' }],
      journal_entries: [{ id: 'je1', company_id: C1 }],
      journal_lines: [{ id: 'l1', journal_entry_id: 'je1', company_id: C1, account_code: '1110' }],
    });
    const res = await invGET(req('admin', 'GET', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.project_name).toBe('مشروع');
    expect(json.data.created_by_name).toBe('مدير');
    expect(json.data.journal_lines).toHaveLength(1);
    expect(json.data.client_city).toBe('الرياض');
  });
});

describe('contracts/[id] DELETE no-storage', () => {
  test('deletes a draft contract without storage cleanup', async () => {
    mockDb.rpcResults.set('delete_draft_contract_atomic', { data: { deleted: true }, error: null });
    const res = await conDELETE(req('admin', 'DELETE', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });
});

describe('permissions/modules', () => {
  test('GET lists modules and POST creates one', async () => {
    mockDb = makeDb({ ...baseDb(), custom_modules: [{ id: ID1, company_id: C1, code: 'custom_1', name: 'قسم' }] });
    const res1 = await modGET(req('admin', 'GET', 'http://localhost/api/permissions/modules'));
    expect(res1.status).toBe(200);
    const res2 = await modPOST(req('admin', 'POST', 'http://localhost/x', { name: 'قسم جديد' }));
    expect(res2.status).toBe(201);
  });

  test('DELETE removes a module and maps not-found error', async () => {
    mockDb.rpcResults.set('delete_custom_module_atomic', { data: { deleted: true }, error: null });
    const res1 = await modDELETE(req('admin', 'DELETE', `http://localhost/x?id=${ID1}`));
    expect(res1.status).toBe(200);
    mockDb.rpcResults.set('delete_custom_module_atomic', { data: null, error: { message: 'غير موجود' } });
    const res2 = await modDELETE(req('admin', 'DELETE', `http://localhost/x?id=${ID1}`));
    expect(res2.status).toBe(404);
  });
});
