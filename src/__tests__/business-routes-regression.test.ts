/**
 * Route-handler regression tests for the changed business endpoints.
 *
 * This is a different testing layer from the unit tests (which exercise
 * libraries) and the migration smoke suite (which exercises the database and
 * RPCs): here the REAL Next.js route handlers are invoked directly with a
 * mocked Supabase client, pinning the HTTP behaviour of each fix:
 *
 *   - progress-billing list/detail must not select the non-existent
 *     `total_amount` column (that 500'd the whole section) and must compute it.
 *   - fiscal POST must route creation through the atomic RPC and map overlap /
 *     second-open-year errors to 409.
 *   - fiscal DELETE must refuse to delete the open year.
 *   - quotations POST must reject an empty item list (a quotation with no
 *     items is meaningless).
 *   - quotations PUT must accept the UI's `tax_enabled` field and strip it
 *     (plus `items`) before calling the RPC, instead of rejecting the edit.
 */
import { randomBytes } from 'crypto';

process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';

import { createToken } from '@/lib/auth';

type Row = Record<string, any>;
type RpcResult = { data: any; error: any } | ((name: string, params: any) => { data: any; error: any });

function makeDb(db: Record<string, Row[]>) {
  const rpcCalls: Array<{ name: string; params: any }> = [];
  const rpcResults = new Map<string, RpcResult>();
  const selectArgs: string[] = [];

  const from = (table: string) => {
    const filters: Array<{ kind: string; col: string; val: any }> = [];
    let rangeBounds: { from: number; to: number } | null = null;
    let limitCount: number | null = null;
    let mut: { kind?: string; payload?: any } = {};

    const filtered = () => {
      let rows = (db[table] || []).filter((row) =>
        filters.every((f) => {
          if (f.kind === 'eq') return row[f.col] === f.val;
          if (f.kind === 'neq') return row[f.col] !== f.val;
          if (f.kind === 'in') return f.val.includes(row[f.col]);
          if (f.kind === 'gte') return row[f.col] >= f.val;
          if (f.kind === 'lte') return row[f.col] <= f.val;
          return true;
        })
      );
      if (rangeBounds) rows = rows.slice(rangeBounds.from, rangeBounds.to + 1);
      else if (limitCount != null) rows = rows.slice(0, limitCount);
      return rows;
    };

    const api: any = {
      select: (cols: string) => { selectArgs.push(String(cols)); return api; },
      eq: (col: string, val: any) => { filters.push({ kind: 'eq', col, val }); return api; },
      neq: (col: string, val: any) => { filters.push({ kind: 'neq', col, val }); return api; },
      in: (col: string, val: any) => { filters.push({ kind: 'in', col, val }); return api; },
      gte: (col: string, val: any) => { filters.push({ kind: 'gte', col, val }); return api; },
      lte: (col: string, val: any) => { filters.push({ kind: 'lte', col, val }); return api; },
      or: () => api,
      not: () => api,
      is: () => api,
      order: () => api,
      limit: (n: number) => { limitCount = n; return api; },
      range: (fromIdx: number, toIdx: number) => { rangeBounds = { from: fromIdx, to: toIdx }; return api; },
      insert: (payload: any) => { mut = { kind: 'insert', payload }; return api; },
      update: (payload: any) => { mut = { kind: 'update', payload }; return api; },
      upsert: (payload: any) => { mut = { kind: 'upsert', payload }; return api; },
      delete: () => { mut = { kind: 'delete' }; return api; },
      maybeSingle: async () => ({ data: filtered()[0] || null, error: null }),
      single: async () => {
        const row = filtered()[0] || null;
        return { data: row, error: row ? null : { message: 'not found', code: 'PGRST116' } };
      },
      then: (resolve: any, reject: any) => {
        if (mut.kind === 'insert' || mut.kind === 'upsert') {
          return Promise.resolve({ data: mut.payload, error: null }).then(resolve, reject);
        }
        if (mut.kind === 'update' || mut.kind === 'delete') {
          return Promise.resolve({ data: filtered()[0] ?? null, error: null }).then(resolve, reject);
        }
        const rows = filtered();
        return Promise.resolve({ data: rows, error: null, count: rows.length }).then(resolve, reject);
      },
    };
    return api;
  };

  return {
    from,
    rpcCalls,
    rpcResults,
    selectArgs,
    rpc: async (name: string, params: any) => {
      rpcCalls.push({ name, params });
      const result = rpcResults.get(name);
      if (!result) return { data: null, error: null };
      if (typeof result === 'function') return result(name, params);
      return result;
    },
  };
}

let mockDb: ReturnType<typeof makeDb>;
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));

import { POST as fiscalPOST } from '@/app/api/fiscal/route';
import { DELETE as fiscalDELETE } from '@/app/api/fiscal/[id]/route';
import { GET as progressGET, POST as progressPOST } from '@/app/api/progress-billing/route';
import { GET as progressDetailGET } from '@/app/api/progress-billing/[id]/route';
import { POST as quotationsPOST } from '@/app/api/quotations/route';
import { PUT as quotationsPUT } from '@/app/api/quotations/[id]/route';

const C1 = 'company-1';
const ADMIN = 'u-admin';
const CLAIM_ID = '10000000-0000-4000-8000-000000000001';
const YEAR_ID = '20000000-0000-4000-8000-000000000001';

function baseDb(): Record<string, Row[]> {
  return {
    users: [{ id: ADMIN, company_id: C1, role: 'admin', is_active: true, token_version: 0, name: 'مدير' }],
    companies: [{ id: C1, name: 'شركة', email: 'co@example.com', phone: '0500', is_active: true }],
    subscriptions: [{
      id: 's1', company_id: C1, plan_code: 'enterprise', status: 'active',
      start_date: '2024-01-01', end_date: '2099-01-01',
      subscription_plans: { code: 'enterprise', name: 'Enterprise', trial_days: 0, max_quotations_per_month: null, features_modules: {} },
    }],
    fiscal_years: [{ id: YEAR_ID, company_id: C1, name: '2026', start_date: '2026-01-01', end_date: '2026-12-31', status: 'open' }],
    progress_billing: [{
      id: CLAIM_ID, company_id: C1, project_id: 'p1', claim_number: 'PB-000001', date: '2026-01-10',
      gross_amount: 100, retention_rate: 0.1, retention_amount: 10, net_amount: 90,
      tax_rate: 0.15, tax_amount: 13.5, status: 'approved', is_final: false,
      projects: { name: 'مشروع أ' },
    }],
    contacts: [{ id: 'c1', company_id: C1, name: 'عميل أ', type: 'client', is_active: true }],
    quotations: [],
  };
}

function req(method: string, body?: any, path = '/api/test') {
  const token = createToken(ADMIN, 'admin');
  return {
    url: `http://localhost${path}`,
    method,
    headers: { get: (key: string) => (key.toLowerCase() === 'authorization' ? `Bearer ${token}` : null) },
    cookies: { get: () => undefined },
    json: async () => body,
  } as any;
}

beforeEach(() => {
  mockDb = makeDb(baseDb());
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) })) as any;
});

describe('progress-billing route regression', () => {
  test('list GET does not select total_amount and computes it', async () => {
    const response = await progressGET(req('GET', undefined, '/api/progress-billing'));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.claims[0].total_amount).toBeCloseTo(103.5);
    // The 500 came from selecting a phantom column — pin its absence.
    const select = mockDb.selectArgs.find((s) => s.includes('claim_number')) || '';
    expect(select).not.toContain('total_amount');
  });

  test('detail GET computes total_amount without selecting it', async () => {
    const response = await progressDetailGET(req('GET'), { params: Promise.resolve({ id: CLAIM_ID }) });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.total_amount).toBeCloseTo(103.5);
    expect(mockDb.selectArgs.join(' ')).not.toContain('total_amount');
  });
});

describe('fiscal route regression', () => {
  test('POST routes creation through the atomic RPC', async () => {
    mockDb.rpcResults.set('create_fiscal_year_atomic', { data: { id: 'new-year' }, error: null });
    const response = await fiscalPOST(req('POST', { name: '2027', start_date: '2027-01-01', end_date: '2027-12-31' }, '/api/fiscal'));
    expect(response.status).toBe(201);
    const call = mockDb.rpcCalls.find((c) => c.name === 'create_fiscal_year_atomic');
    expect(call).toBeDefined();
    expect(call!.params).toMatchObject({
      p_company_id: C1, p_name: '2027', p_start_date: '2027-01-01', p_end_date: '2027-12-31', p_user_id: ADMIN,
    });
  });

  test('POST maps an overlapping period to 409', async () => {
    mockDb.rpcResults.set('create_fiscal_year_atomic', { data: null, error: { message: 'الفترة المالية تتداخل مع فترة موجودة' } });
    const response = await fiscalPOST(req('POST', { name: '2027', start_date: '2027-01-01', end_date: '2027-12-31' }, '/api/fiscal'));
    expect(response.status).toBe(409);
  });

  test('POST maps a second open year to 409', async () => {
    mockDb.rpcResults.set('create_fiscal_year_atomic', { data: null, error: { message: 'لا يمكن فتح أكثر من سنة مالية واحدة في نفس الوقت' } });
    const response = await fiscalPOST(req('POST', { name: '2027', start_date: '2027-01-01', end_date: '2027-12-31' }, '/api/fiscal'));
    expect(response.status).toBe(409);
  });

  test('DELETE refuses to delete the open year', async () => {
    const response = await fiscalDELETE(req('DELETE'), { params: Promise.resolve({ id: YEAR_ID }) });
    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.message).toContain('مفتوحة');
  });

  test('DELETE refuses a closed year too (must reopen or keep it)', async () => {
    const db = baseDb();
    db.fiscal_years[0].status = 'closed';
    mockDb = makeDb(db);
    const response = await fiscalDELETE(req('DELETE'), { params: Promise.resolve({ id: YEAR_ID }) });
    expect(response.status).toBe(400);
  });
});

describe('quotations route regression', () => {
  test('POST rejects a quotation with no items', async () => {
    const response = await quotationsPOST(req('POST', { date: '2026-01-01', contact_id: 'c1', items: [], tax_rate: 0.15 }, '/api/quotations'));
    expect(response.status).toBe(400);
    expect(mockDb.rpcCalls.filter((c) => c.name === 'create_quotation')).toHaveLength(0);
  });

  test('PUT accepts the UI tax_enabled field and strips it before the RPC', async () => {
    mockDb.rpcResults.set('update_draft_quotation', { data: { id: 'q1' }, error: null });
    const body = {
      date: '2026-01-01', contact_id: 'c1', tax_enabled: false, tax_rate: 0,
      items: [{ description: 'بند', quantity: 1, unit_price: 100 }],
    };
    const response = await quotationsPUT(req('PUT', body), { params: Promise.resolve({ id: 'q1' }) });
    expect(response.status).toBe(200);
    const call = mockDb.rpcCalls.find((c) => c.name === 'update_draft_quotation');
    expect(call).toBeDefined();
    expect(call!.params.p_payload).not.toHaveProperty('tax_enabled');
    expect(call!.params.p_payload).not.toHaveProperty('items');
    expect(call!.params.p_items).toEqual(body.items);
  });
});
