/**
 * Route-boundary tests for detail CRUD flows:
 * /api/tenders/[id], /api/contracts/[id], /api/bonds/[id].
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
import { createToken } from '@/lib/auth';

type Row = Record<string, unknown>;
type Op = { op: string; col?: string; val?: unknown };

function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Op[] }> = [];
  const rpcResults = new Map<string, { data: unknown; error?: unknown } | null>();
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

import { GET as tenderGET, PUT as tenderPUT, DELETE as tenderDELETE, POST as tenderPOST } from '@/app/api/tenders/[id]/route';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';
import { GET as contractGET, PUT as contractPUT, DELETE as contractDELETE } from '@/app/api/contracts/[id]/route';
import { GET as bondGET, PUT as bondPUT, DELETE as bondDELETE } from '@/app/api/bonds/[id]/route';
import { resetRateLimits } from '@/lib/memory-rate-limit';

const C1 = 'company-1';
const TID = '00000000-0000-4000-8000-00000000e0a1';
const CTID = '00000000-0000-4000-8000-00000000e0b1';
const BID = '00000000-0000-4000-8000-00000000e0c1';

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
      subscription_plans: { code: 'enterprise', features_modules: { tenders: true, contracts: true, cash: true } } }],
    tenders: [], tender_cost_items: [], contracts: [], contract_documents: [], bonds: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { resetRateLimits(); mockDb = makeDb(baseDb()); });

describe('tenders/[id] GET', () => {
  test('returns tender with cost items and margin', async () => {
    mockDb = makeDb({ ...baseDb(), tenders: [{ id: TID, company_id: C1, title: 'مناقصة', estimated_value: 1000, contacts: { name: 'عميل' } }],
      tender_cost_items: [{ id: 'ci1', tender_id: TID, company_id: C1, amount: 200 }] });
    const res = await tenderGET(req('admin', 'GET', `http://localhost/x/${TID}`), { params: Promise.resolve({ id: TID }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.contact_name).toBe('عميل');
    expect(json.data.total_cost).toBe(200);
    expect(json.data.profit_margin).toBeCloseTo(80, 1);
  });

  test('rejects an invalid id and returns 404 for unknown tender', async () => {
    const res1 = await tenderGET(req('admin', 'GET', 'http://localhost/x'), { params: Promise.resolve({ id: 'bad' }) });
    expect(res1.status).toBe(400);
    const res2 = await tenderGET(req('admin', 'GET', `http://localhost/x/${TID}`), { params: Promise.resolve({ id: TID }) });
    expect(res2.status).toBe(404);
  });
});

describe('tenders/[id] PUT', () => {
  test('updates tender status via RPC', async () => {
    mockDb.rpcResults.set('transition_tender_atomic', { data: { id: TID, status: 'submitted' }, error: null });
    const res = await tenderPUT(req('admin', 'PUT', 'http://localhost/x', { action: 'update_status', status: 'submitted' }), { params: Promise.resolve({ id: TID }) });
    expect(res.status).toBe(200);
  });

  test('converts a won tender to project', async () => {
    mockDb.rpcResults.set('convert_won_tender_to_project_atomic', { data: { id: 'p1' }, error: null });
    const res = await tenderPUT(req('admin', 'PUT', 'http://localhost/x', { action: 'convert_to_project' }), { params: Promise.resolve({ id: TID }) });
    expect(res.status).toBe(201);
  });

  test('updates tender fields via RPC', async () => {
    mockDb.rpcResults.set('update_tender_atomic', { data: { id: TID }, error: null });
    const res = await tenderPUT(req('admin', 'PUT', 'http://localhost/x', { title: 'مناقصة جديدة' }), { params: Promise.resolve({ id: TID }) });
    expect(res.status).toBe(200);
  });

  test('maps mutation errors', async () => {
    mockDb.rpcResults.set('transition_tender_atomic', { data: null, error: { message: 'غير موجودة' } });
    const res1 = await tenderPUT(req('admin', 'PUT', 'http://localhost/x', { action: 'update_status', status: 'submitted' }), { params: Promise.resolve({ id: TID }) });
    expect(res1.status).toBe(404);
    mockDb.rpcResults.set('transition_tender_atomic', { data: null, error: { message: 'لا يمكن' } });
    const res2 = await tenderPUT(req('admin', 'PUT', 'http://localhost/x', { action: 'update_status', status: 'submitted' }), { params: Promise.resolve({ id: TID }) });
    expect(res2.status).toBe(409);
  });

  test('rejects an invalid action payload', async () => {
    const res = await tenderPUT(req('admin', 'PUT', 'http://localhost/x', { action: 'update_status', status: 'bogus' }), { params: Promise.resolve({ id: TID }) });
    expect(res.status).toBe(400);
  });
});

describe('tenders/[id] DELETE + POST', () => {
  test('DELETE removes a draft tender', async () => {
    mockDb.rpcResults.set('delete_draft_tender_atomic', { data: { deleted: true }, error: null });
    const res = await tenderDELETE(req('admin', 'DELETE', `http://localhost/x/${TID}`), { params: Promise.resolve({ id: TID }) });
    expect(res.status).toBe(200);
  });

  test('POST adds a cost item', async () => {
    mockDb.rpcResults.set('create_tender_cost_item_atomic', { data: { id: 'ci2' }, error: null });
    const res = await tenderPOST(req('admin', 'POST', 'http://localhost/x', { category: 'materials', amount: 100 }), { params: Promise.resolve({ id: TID }) });
    expect(res.status).toBe(201);
  });

  test('POST rejects an invalid cost item', async () => {
    const res = await tenderPOST(req('admin', 'POST', 'http://localhost/x', { category: 'bogus', amount: 100 }), { params: Promise.resolve({ id: TID }) });
    expect(res.status).toBe(400);
  });
});

describe('contracts/[id]', () => {
  test('GET returns contract with documents', async () => {
    mockDb = makeDb({ ...baseDb(), contracts: [{ id: CTID, company_id: C1, title: 'عقد', projects: { name: 'مشروع' }, contacts: { name: 'عميل' } }],
      contract_documents: [{ id: 'doc1', contract_id: CTID, company_id: C1, filename: 'a.pdf' }] });
    const res = await contractGET(req('admin', 'GET', `http://localhost/x/${CTID}`), { params: Promise.resolve({ id: CTID }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.project_name).toBe('مشروع');
    expect(json.data.documents).toHaveLength(1);
  });

  test('GET rejects invalid id and returns 404', async () => {
    const res1 = await contractGET(req('admin', 'GET', 'http://localhost/x'), { params: Promise.resolve({ id: 'bad' }) });
    expect(res1.status).toBe(400);
    const res2 = await contractGET(req('admin', 'GET', `http://localhost/x/${CTID}`), { params: Promise.resolve({ id: CTID }) });
    expect(res2.status).toBe(404);
  });

  test('PUT updates a contract', async () => {
    mockDb.rpcResults.set('update_contract_atomic', { data: { id: CTID }, error: null });
    const res = await contractPUT(req('admin', 'PUT', 'http://localhost/x', { title: 'عقد محدث' }), { params: Promise.resolve({ id: CTID }) });
    expect(res.status).toBe(200);
  });

  test('PUT maps errors', async () => {
    mockDb.rpcResults.set('update_contract_atomic', { data: null, error: { message: 'غير موجود' } });
    const res1 = await contractPUT(req('admin', 'PUT', 'http://localhost/x', { title: 'x' }), { params: Promise.resolve({ id: CTID }) });
    expect(res1.status).toBe(404);
    mockDb.rpcResults.set('update_contract_atomic', { data: null, error: { message: 'لا يمكن' } });
    const res2 = await contractPUT(req('admin', 'PUT', 'http://localhost/x', { title: 'x' }), { params: Promise.resolve({ id: CTID }) });
    expect(res2.status).toBe(409);
  });

  test('DELETE removes a draft contract and cleans storage', async () => {
    mockDb.rpcResults.set('delete_draft_contract_atomic', { data: { storage_paths: [`${C1}/${CTID}/a.pdf`] }, error: null });
    const res = await contractDELETE(req('admin', 'DELETE', `http://localhost/x/${CTID}`), { params: Promise.resolve({ id: CTID }) });
    expect(res.status).toBe(200);
  });

  test('DELETE rejects invalid id', async () => {
    const res = await contractDELETE(req('admin', 'DELETE', 'http://localhost/x'), { params: Promise.resolve({ id: 'bad' }) });
    expect(res.status).toBe(400);
  });
});

describe('bonds/[id]', () => {
  test('GET returns bond with derived days', async () => {
    mockDb = makeDb({ ...baseDb(), bonds: [{ id: BID, company_id: C1, title: 'ضمان', issue_date: new Date().toISOString(), expiry_date: new Date(Date.now() + 86400000).toISOString(), tenders: { title: 'مناقصة' } }] });
    const res = await bondGET(req('admin', 'GET', `http://localhost/x/${BID}`), { params: Promise.resolve({ id: BID }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.daysUntilExpiry).toBe(1);
  });

  test('PUT releases or cancels a bond', async () => {
    mockDb.rpcResults.set('transition_bond_atomic', { data: { id: BID, status: 'released' }, error: null });
    const res = await bondPUT(req('admin', 'PUT', 'http://localhost/x', { action: 'release' }), { params: Promise.resolve({ id: BID }) });
    expect(res.status).toBe(200);
  });

  test('PUT updates bond fields', async () => {
    mockDb.rpcResults.set('update_bond_atomic', { data: { id: BID }, error: null });
    const res = await bondPUT(req('admin', 'PUT', 'http://localhost/x', { title: 'ضمان محدث' }), { params: Promise.resolve({ id: BID }) });
    expect(res.status).toBe(200);
  });

  test('DELETE cancels a bond', async () => {
    mockDb.rpcResults.set('transition_bond_atomic', { data: { id: BID }, error: null });
    const res = await bondDELETE(req('admin', 'DELETE', `http://localhost/x/${BID}`), { params: Promise.resolve({ id: BID }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.cancelled).toBe(true);
  });

  test('PUT maps mutation errors', async () => {
    mockDb.rpcResults.set('transition_bond_atomic', { data: null, error: { message: 'غير موجود' } });
    const res1 = await bondPUT(req('admin', 'PUT', 'http://localhost/x', { action: 'release' }), { params: Promise.resolve({ id: BID }) });
    expect(res1.status).toBe(404);
  });
});
