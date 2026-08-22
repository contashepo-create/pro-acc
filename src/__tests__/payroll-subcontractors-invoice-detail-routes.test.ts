/**
 * Route-boundary tests for payroll, subcontractors (list/detail/certificates/
 * payments), and invoices/[id].
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
import { createToken } from '@/lib/auth';

type Row = Record<string, any>;
type Op = { op: string; col?: string; val?: any };

function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Op[] }> = [];
  const rpcResults = new Map<string, any>();
  const from = (table: string) => {
    const ops: Op[] = [];
    calls.push({ table, ops });
    const rows = () =>
      (db[table] || []).filter((r) =>
        ops.every((o) => {
          const get = (col: string) => col.split('.').reduce((acc, k) => (acc == null ? acc : (acc as any)[k]), r);
          if (o.op === 'eq') return get(o.col!) === o.val;
          if (o.op === 'in') return (o.val as any[]).includes(get(o.col!));
          if (o.op === 'gte') return String(get(o.col!)) >= String(o.val);
          if (o.op === 'lte') return String(get(o.col!)) <= String(o.val);
          return true;
        })
      );
    const api: any = {
      select: () => api,
      eq: (col: string, val: any) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: any) => { ops.push({ op: 'in', col, val }); return api; },
      order: () => api, limit: () => api, range: () => api, is: () => api, neq: () => api,
      or: () => api, lt: () => api, gte: (col: string, val: any) => { ops.push({ op: 'gte', col, val }); return api; },
      lte: (col: string, val: any) => { ops.push({ op: 'lte', col, val }); return api; },
      insert: (payload: any) => { db[table] = [...(db[table] || []), payload]; return api; },
      update: () => api, delete: () => api,
      maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
      single: async () => ({ data: rows()[0] || null, error: rows()[0] ? null : { message: 'not found' } }),
      then: (ok: any, fail: any) =>
        Promise.resolve({ data: rows(), error: null, count: rows().length }).then(ok, fail),
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

import { GET as payrollGET, POST as payrollPOST } from '@/app/api/payroll/route';
import { GET as subGET, POST as subPOST } from '@/app/api/subcontractors/route';
import { GET as subDetailGET, PUT as subPUT, DELETE as subDELETE } from '@/app/api/subcontractors/[id]/route';
import { GET as certGET, POST as certPOST } from '@/app/api/subcontractors/certificates/route';
import { POST as payPOST } from '@/app/api/subcontractors/payments/route';
import { GET as invGET } from '@/app/api/invoices/[id]/route';
import { resetRateLimits } from '@/lib/memory-rate-limit';

const C1 = 'company-1';
const ID1 = '00000000-0000-4000-8000-00000000f0c1';
const CON = '00000000-0000-4000-8000-00000000f0d1';

function req(role = 'admin', method = 'GET', url = 'http://localhost/x', body?: any) {
  const token = createToken('u1', role, 0);
  return { url, method, nextUrl: new URL(url), headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined }, json: async () => body } as any;
}

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, name: 'م', email: 'admin@example.com', is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true, name: 'شركة', tax_number: '123' }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: { payroll: true, subcontractors: true, invoices: true } } }],
    payroll: [], contacts: [], subcontractor_certificates: [], subcontractor_contracts: [],
    invoices: [], invoice_items: [], projects: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { resetRateLimits(); mockDb = makeDb(baseDb()); });

describe('payroll', () => {
  test('GET lists payroll records', async () => {
    mockDb = makeDb({ ...baseDb(), payroll: [{ id: ID1, company_id: C1, employees: { name: 'موظف', department: 'قسم' } }] });
    const res = await payrollGET(req('admin', 'GET', 'http://localhost/api/payroll'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.records[0].employee_name).toBe('موظف');
  });

  test('POST posts a payroll batch', async () => {
    mockDb.rpcResults.set('post_payroll_batch', { data: { records: [{ id: 'r1' }] }, error: null });
    const res = await payrollPOST(req('admin', 'POST', 'http://localhost/api/payroll', { date: '2026-01-31', employee_ids: [ID1] }));
    expect(res.status).toBe(201);
  });
});

describe('subcontractors', () => {
  test('GET lists subcontractors', async () => {
    mockDb = makeDb({ ...baseDb(), contacts: [{ id: ID1, company_id: C1, name: 'مقاول', type: 'subcontractor', is_active: true, notes: 'التخصص: حديد' }] });
    const res = await subGET(req('admin', 'GET', 'http://localhost/api/subcontractors'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.subcontractors[0].specialty).toBe('حديد');
  });

  test('POST creates a subcontractor', async () => {
    mockDb.rpcResults.set('create_contact_atomic', { data: { id: ID1 }, error: null });
    const res = await subPOST(req('admin', 'POST', 'http://localhost/api/subcontractors', { name: 'مقاول' }));
    expect(res.status).toBe(201);
  });

  test('POST rejects an invalid email', async () => {
    const res = await subPOST(req('admin', 'POST', 'http://localhost/api/subcontractors', { name: 'مقاول', email: 'bad' }));
    expect(res.status).toBe(400);
  });

  test('POST maps plan-limit error', async () => {
    mockDb.rpcResults.set('create_contact_atomic', { data: null, error: { message: 'contact plan limit: suppliers' } });
    const res = await subPOST(req('admin', 'POST', 'http://localhost/api/subcontractors', { name: 'مقاول' }));
    expect(res.status).toBe(403);
  });
});

describe('subcontractors/[id]', () => {
  test('GET returns a subcontractor', async () => {
    mockDb = makeDb({ ...baseDb(), contacts: [{ id: ID1, company_id: C1, name: 'مقاول', type: 'subcontractor', is_active: true }] });
    const res = await subDetailGET(req('admin', 'GET', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });

  test('GET returns 404 when missing', async () => {
    const res = await subDetailGET(req('admin', 'GET', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(404);
  });

  test('GET rejects an invalid id', async () => {
    const res = await subDetailGET(req('admin', 'GET', 'http://localhost/x'), { params: Promise.resolve({ id: 'bad' }) });
    expect(res.status).toBe(400);
  });

  test('PUT updates a subcontractor', async () => {
    mockDb.rpcResults.set('update_subcontractor_atomic', { data: { id: ID1 }, error: null });
    const res = await subPUT(req('admin', 'PUT', 'http://localhost/x', { name: 'مقاول ب' }), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });

  test('DELETE deactivates a subcontractor', async () => {
    mockDb.rpcResults.set('deactivate_subcontractor_atomic', { data: { id: ID1 }, error: null });
    const res = await subDELETE(req('admin', 'DELETE', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.deactivated).toBe(true);
  });
});

describe('subcontractors/certificates', () => {
  test('GET lists certificates', async () => {
    mockDb = makeDb({ ...baseDb(), subcontractor_certificates: [{ id: ID1, company_id: C1, number: 1, amount: 100, subcontractor_contracts: { contract_number: 'C-1', contacts: { name: 'مقاول' } } }] });
    const res = await certGET(req('admin', 'GET', 'http://localhost/api/subcontractors/certificates'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.certificates[0].subcontractor_name).toBe('مقاول');
  });

  test('POST creates a certificate', async () => {
    mockDb.rpcResults.set('create_subcontractor_certificate_atomic', { data: { id: ID1 }, error: null });
    const res = await certPOST(req('admin', 'POST', 'http://localhost/x', { contract_id: CON, date: '2026-01-01', certificate_number: 1, gross_amount: 1000 }));
    expect(res.status).toBe(201);
  });

  test('POST rejects an invalid certificate number', async () => {
    const res = await certPOST(req('admin', 'POST', 'http://localhost/x', { contract_id: CON, date: '2026-01-01', certificate_number: 0, gross_amount: 1000 }));
    expect(res.status).toBe(400);
  });
});

describe('subcontractors/payments POST', () => {
  test('records a payment', async () => {
    mockDb.rpcResults.set('create_subcontractor_payment_atomic', { data: { id: ID1 }, error: null });
    const res = await payPOST(req('admin', 'POST', 'http://localhost/x', { contract_id: CON, amount: 500, date: '2026-01-01', bank_safe_id: ID1 }));
    expect(res.status).toBe(201);
  });

  test('rejects a missing bank_safe_id', async () => {
    const res = await payPOST(req('admin', 'POST', 'http://localhost/x', { contract_id: CON, amount: 500, date: '2026-01-01' }));
    expect(res.status).toBe(400);
  });
});

describe('invoices/[id] GET', () => {
  test('returns an invoice with items, company and contact', async () => {
    mockDb = makeDb({ ...baseDb(),
      invoices: [{ id: ID1, company_id: C1, contact_id: CON, project_id: ID1, number: 'INV-1', total: 115, status: 'unpaid' }],
      invoice_items: [{ id: 'it1', invoice_id: ID1, company_id: C1, description: 'x' }],
      contacts: [{ id: CON, company_id: C1, name: 'عميل' }],
      projects: [{ id: ID1, company_id: C1, name: 'مشروع' }],
    });
    const res = await invGET(req('admin', 'GET', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.number).toBe('INV-1');
    expect(json.data.items).toHaveLength(1);
  });

  test('rejects an invalid id and returns 404 when missing', async () => {
    const res1 = await invGET(req('admin', 'GET', 'http://localhost/x'), { params: Promise.resolve({ id: 'bad' }) });
    expect(res1.status).toBe(400);
    const res2 = await invGET(req('admin', 'GET', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res2.status).toBe(404);
  });
});
