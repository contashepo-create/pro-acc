/** Route-boundary tests for salary-sheets/[id] edit-lock and delete guards. */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';

type Row = Record<string, unknown>;
type Op = { op: string; col?: string; val?: unknown };

function makeDb(db: Record<string, Row[]>) {
  const rpcResults = new Map<string, { data: unknown; error: unknown }>();
  const from = (table: string) => {
    const ops: Op[] = [];
    let pending: Row | null = null;
    const rows = () => {
      const filtered = (db[table] || []).filter((r) =>
        ops.every((o) => o.op !== 'eq' || r[o.col!] === o.val)
      );
      return pending ? filtered.map((r) => ({ ...r, ...pending })) : filtered;
    };
    const api = {
      select: () => api,
      eq: (col: string, val: unknown) => { ops.push({ op: 'eq', col, val }); return api; },
      order: () => api, limit: () => api, range: () => api,
      update: (payload: Row) => { pending = payload; return api; },
      insert: () => api, delete: () => api,
      maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
      single: async () => ({ data: rows()[0] || null, error: null }),
      then: (ok?: (v: { data: unknown; error: unknown }) => unknown) => Promise.resolve({ data: rows(), error: null }).then(ok ?? undefined),
    };
    return api;
  };
  return { from, rpc: async (name: string) => rpcResults.get(name) || { data: null, error: null } };
}

jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));
jest.mock('@/lib/api-helpers', () => {
  const actual = jest.requireActual('@/lib/validation');
  void actual;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  return {
    success: (data: unknown, status = 200) => json({ success: true, data }, status),
    error: (message: string, status = 400) => json({ success: false, message }, status),
    parseBody: async (req: { json: () => Promise<unknown> }) => req.json(),
    requireModulePermission: async (_req: unknown, _m: string) => ({ companyId: 'C1', userId: 'U1' }),
    requireManagerOrAbove: async () => ({ companyId: 'C1', userId: 'U1' }),
    handleApiError: (e: unknown) => json({ success: false, message: String(e instanceof Error ? e.message : e) }, 500),
    getPaginationParams: () => ({ page: 1, pageSize: 25 }),
  };
});

import { PUT as sheetPUT, DELETE as sheetDELETE } from '@/app/api/salary-sheets/[id]/route';

let mockDb: ReturnType<typeof makeDb>;
const ID = '00000000-0000-4000-8000-0000000000s1'.replace('s', 'a');

function req(body?: unknown) {
  return { url: 'http://localhost/x', headers: { get: () => null }, cookies: {}, json: async () => body } as never;
}

describe('salary-sheets/[id] guards', () => {
  test('PUT refuses a sheet already in the approval cycle', async () => {
    mockDb = makeDb({ salary_sheets: [{ id: ID, company_id: 'C1', status: 'pending_approval' }] });
    const res = await sheetPUT(req({ name: 'x' }), { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(409);
  });

  test('PUT refuses manual status change even on drafts', async () => {
    mockDb = makeDb({ salary_sheets: [{ id: ID, company_id: 'C1', status: 'draft' }] });
    const res = await sheetPUT(req({ status: 'approved' }), { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(409);
  });

  test('PUT renames a draft', async () => {
    mockDb = makeDb({ salary_sheets: [{ id: ID, company_id: 'C1', status: 'draft', name: 'old' }] });
    const res = await sheetPUT(req({ name: 'new-name' }), { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.name).toBe('new-name');
  });

  test('DELETE delegates to guarded RPC', async () => {
    mockDb = makeDb({});
    const res = await sheetDELETE(req(), { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.deleted).toBe(false);
  });
});
