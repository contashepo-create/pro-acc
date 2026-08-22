/**
 * Route-boundary tests for contracts/[id] POST document upload plus
 * GET/PUT error branches.
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
import { createToken } from '@/lib/auth';

type Row = Record<string, any>;
type Op = { op: string; col?: string; val?: any };

function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Op[] }> = [];
  const rpcResults = new Map<string, any>();
  const storageCalls: Array<{ op: string; args: any[] }> = [];
  const from = (table: string) => {
    const ops: Op[] = [];
    calls.push({ table, ops });
    const rows = () =>
      (db[table] || []).filter((r) =>
        ops.every((o) => {
          const get = (col: string) => col.split('.').reduce((acc, k) => (acc == null ? acc : (acc as any)[k]), r);
          if (o.op === 'eq') return get(o.col!) === o.val;
          if (o.op === 'in') return (o.val as any[]).includes(get(o.col!));
          return true;
        })
      );
    const api: any = {
      select: () => api,
      eq: (col: string, val: any) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: any) => { ops.push({ op: 'in', col, val }); return api; },
      order: () => api, limit: () => api, range: () => api, is: () => api, neq: () => api,
      or: () => api, lt: () => api, gte: () => api, lte: () => api,
      insert: () => api, update: () => api, delete: () => api,
      maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
      single: async () => ({ data: rows()[0] || null, error: rows()[0] ? null : { message: 'not found' } }),
      then: (ok: any, fail: any) =>
        Promise.resolve({ data: rows(), error: null, count: rows().length }).then(ok, fail),
    };
    return api;
  };
  const storage = {
    from: (bucket: string) => ({
      upload: async (...args: any[]) => { storageCalls.push({ op: 'upload', args }); return storage.uploadResult || { error: null }; },
      remove: async (...args: any[]) => { storageCalls.push({ op: 'remove', args }); return { error: null }; },
    }),
  };
  return {
    from, calls, rpcResults, db, storage,
    rpc: async (name: string) => rpcResults.get(name) || { data: null, error: null },
  };
}

let mockDb: ReturnType<typeof makeDb>;
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));

jest.mock('@/lib/plan-limits', () => ({
  getCompanyPlanLimits: async () => ({ max_storage_mb: 10 }),
  countUsedStorageBytes: async () => 0,
}));

import { GET as conGET, PUT as conPUT, POST as conPOST } from '@/app/api/contracts/[id]/route';
import { resetRateLimits } from '@/lib/memory-rate-limit';

const C1 = 'company-1';
const CTID = '00000000-0000-4000-8000-00000000e0b1';

function req(role = 'admin', method = 'GET', url = 'http://localhost/x', body?: any) {
  const token = createToken('u1', role, 0);
  return { url, method, nextUrl: new URL(url), headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined }, json: async () => body, text: async () => JSON.stringify(body) } as any;
}

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, name: 'م', email: 'admin@example.com', is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: { contracts: true } } }],
    contracts: [], contract_documents: [],
  } as Record<string, Row[]>;
}

// A minimal valid PDF payload.
const pdfBase64 = Buffer.from('%PDF-1.4\n%%EOF').toString('base64');

beforeEach(() => {
  resetRateLimits();
  mockDb = makeDb(baseDb());
});

describe('contracts/[id] GET/PUT', () => {
  test('GET returns a contract with project and contact names', async () => {
    mockDb.db.contracts.push({ id: CTID, company_id: C1, name: 'عقد', projects: { name: 'مشروع أ' }, contacts: { name: 'عميل ب' } });
    mockDb.db.contract_documents.push({ id: 'd1', contract_id: CTID, company_id: C1, filename: 'x.pdf' });
    const res = await conGET(req('admin', 'GET', 'http://localhost/api/contracts/' + CTID), { params: Promise.resolve({ id: CTID }) });
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.project_name).toBe('مشروع أ');
    expect(body.data.contact_name).toBe('عميل ب');
    expect(body.data.documents.length).toBe(1);
  });

  test('GET returns 404 for a missing contract', async () => {
    const res = await conGET(req('admin', 'GET', 'http://localhost/api/contracts/' + CTID), { params: Promise.resolve({ id: CTID }) });
    expect(res.status).toBe(404);
  });

  test('PUT maps a not-found update error to 404', async () => {
    mockDb.rpcResults.set('update_contract_atomic', { data: null, error: { message: 'العقد غير موجود' } });
    const res = await conPUT(req('admin', 'PUT', 'http://localhost/x', { title: 'عقد جديد' }), { params: Promise.resolve({ id: CTID }) });
    expect(res.status).toBe(404);
  });

  test('PUT maps a state-transition error to 409', async () => {
    mockDb.rpcResults.set('update_contract_atomic', { data: null, error: { message: 'لا يمكن الانتقال إلى حالة' } });
    const res = await conPUT(req('admin', 'PUT', 'http://localhost/x', { title: 'عقد جديد' }), { params: Promise.resolve({ id: CTID }) });
    expect(res.status).toBe(409);
  });
});

describe('contracts/[id] POST document upload', () => {
  test('rejects an invalid contract id', async () => {
    const res = await conPOST(req('admin', 'POST', 'http://localhost/x', {}), { params: Promise.resolve({ id: 'bad' }) });
    expect(res.status).toBe(400);
  });

  test('rejects an invalid body', async () => {
    const res = await conPOST(req('admin', 'POST', 'http://localhost/x', { filename: 'bad\\name' }), { params: Promise.resolve({ id: CTID }) });
    expect(res.status).toBe(400);
  });

  test('rejects invalid base64 data', async () => {
    const res = await conPOST(req('admin', 'POST', 'http://localhost/x', {
      filename: 'doc.pdf', content_type: 'application/pdf', file_data: 'not-base64!!!',
    }), { params: Promise.resolve({ id: CTID }) });
    expect(res.status).toBe(400);
  });

  test('rejects content that does not match its type', async () => {
    const res = await conPOST(req('admin', 'POST', 'http://localhost/x', {
      filename: 'doc.pdf', content_type: 'application/pdf', file_data: Buffer.from('hello world not a pdf').toString('base64'),
    }), { params: Promise.resolve({ id: CTID }) });
    expect(res.status).toBe(400);
  });

  test('uploads a valid pdf and records document metadata', async () => {
    mockDb.rpcResults.set('create_contract_document_atomic', { data: { id: 'doc1' }, error: null });
    const res = await conPOST(req('admin', 'POST', 'http://localhost/x', {
      filename: 'contract.pdf', content_type: 'application/pdf', file_data: pdfBase64, description: 'نسخة موقعة',
    }), { params: Promise.resolve({ id: CTID }) });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  test('removes the uploaded object when metadata persistence fails with 404', async () => {
    mockDb.rpcResults.set('create_contract_document_atomic', { data: null, error: { message: 'البيانات غير صالحة' } });
    const res = await conPOST(req('admin', 'POST', 'http://localhost/x', {
      filename: 'contract.pdf', content_type: 'application/pdf', file_data: pdfBase64,
    }), { params: Promise.resolve({ id: CTID }) });
    expect(res.status).toBe(404);
  });
});
