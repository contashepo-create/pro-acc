/** Customers/suppliers: atomic lifecycle, control-account balances and tenant scope. */

process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';

// The DB-backed share of the per-user rate limit is out of scope for these
// suites (the memory fast path is what they exercise); the authoritative
// store is covered by shared-rate-limit.test.ts + the 077 migration smoke.
jest.mock('@/lib/shared-rate-limit', () => ({ hitSharedRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }) }));
import { createToken } from '@/lib/auth';
import { getContactBalance, getContactBalances } from '@/lib/contact-utils';

type Row = Record<string, any>;
type Op = { op: string; col?: string; val?: any };

function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Op[]; mut: { kind?: string; payload?: any } }> = [];
  const rpcCalls: Array<{ name: string; params: any }> = [];
  const from = (table: string) => {
    const ops: Op[] = [];
    const mut: { kind?: string; payload?: any } = {};
    calls.push({ table, ops, mut });
    const applyFilters = () => (db[table] || []).filter((row) => ops.every((op) => {
      if (op.op === 'eq') return row[op.col!] === op.val;
      if (op.op === 'neq') return row[op.col!] !== op.val;
      if (op.op === 'in') return (op.val as any[]).includes(row[op.col!]);
      if (op.op === 'is') return op.val === null ? row[op.col!] == null : row[op.col!] === op.val;
      return true;
    }));
    const api: any = {
      select: () => api,
      eq: (col: string, val: any) => { ops.push({ op: 'eq', col, val }); return api; },
      neq: (col: string, val: any) => { ops.push({ op: 'neq', col, val }); return api; },
      in: (col: string, val: any[]) => { ops.push({ op: 'in', col, val }); return api; },
      is: (col: string, val: any) => { ops.push({ op: 'is', col, val }); return api; },
      order: () => api,
      limit: () => api,
      range: () => api,
      maybeSingle: async () => ({ data: applyFilters()[0] ?? null, error: null }),
      single: async () => {
        const row = applyFilters()[0] ?? null;
        return { data: row, error: row ? null : { message: 'not found' } };
      },
      then: (onFulfilled: any, onRejected: any) => Promise.resolve({ data: applyFilters(), error: null, count: applyFilters().length }).then(onFulfilled, onRejected),
    };
    return api;
  };

  const allowedCodes = (type: string) => type === 'client' ? ['1130', '2180']
    : type === 'supplier' ? ['2110']
      : type === 'subcontractor' ? ['2110', '2150'] : ['1130', '2110', '2180'];
  const balanceFor = (companyId: string, contactId: string) => {
    const contact = (db.contacts || []).find((row) => row.id === contactId && row.company_id === companyId);
    if (!contact) return 0;
    const accountById = Object.fromEntries((db.accounts || [])
      .filter((row) => row.company_id === companyId).map((row) => [row.id, row.code]));
    return (db.journal_lines || [])
      .filter((line) => line.company_id === companyId && line.contact_id === contactId
        && allowedCodes(contact.type).includes(accountById[line.account_id]))
      .reduce((sum, line) => sum + (Number(line.debit) || 0) - (Number(line.credit) || 0), 0);
  };

  const instance: any = { from, calls, rpcCalls };
  instance.rpcImpl = async (name: string, params: any) => {
    if (name === 'get_contact_balance') return { data: balanceFor(params.p_company_id, params.p_contact_id), error: null };
    if (name === 'get_contact_balance_batch') return {
      data: params.p_contact_ids.map((id: string) => ({ contact_id: id, balance: balanceFor(params.p_company_id, id) })), error: null,
    };
    if (name === 'create_contact_atomic') return {
      data: { id: '90000000-0000-4000-8000-000000000001', company_id: params.p_company_id, ...params.p_data,
        opening_journal_id: params.p_opening_amount > 0 ? '90000000-0000-4000-8000-000000000002' : null }, error: null,
    };
    if (name === 'update_contact_atomic') {
      const contact = (db.contacts || []).find((row) => row.id === params.p_contact_id && row.company_id === params.p_company_id);
      if (!contact) return { data: null, error: { message: 'الطرف غير موجود' } };
      return { data: { ...contact, ...params.p_patch }, error: null };
    }
    if (name === 'deactivate_contact_atomic') {
      const contact = (db.contacts || []).find((row) => row.id === params.p_contact_id && row.company_id === params.p_company_id);
      if (!contact) return { data: null, error: { message: 'الطرف غير موجود' } };
      return { data: { id: params.p_contact_id, is_active: false, already_processed: false }, error: null };
    }
    return { data: null, error: { message: `missing ${name}` } };
  };
  instance.rpc = (name: string, params: any) => {
    rpcCalls.push({ name, params });
    return instance.rpcImpl(name, params);
  };
  return instance;
}

let mockDb: ReturnType<typeof makeDb>;
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));

import { POST as contactPOST } from '@/app/api/contacts/route';
import { GET as contactOneGET, PUT as contactPUT, DELETE as contactDELETE } from '@/app/api/contacts/[id]/route';
import { GET as clientsGET, POST as clientsPOST } from '@/app/api/clients/route';
import { GET as clientOneGET, PUT as clientPUT, DELETE as clientDELETE } from '@/app/api/clients/[id]/route';
import { GET as clientStatementGET } from '@/app/api/clients/[id]/statement/route';
import { GET as contactBalanceGET } from '@/app/api/vouchers/contact-balance/route';

const C1 = 'company-1';
const C2 = 'company-2';
const CLIENT = '00000000-0000-4000-8000-000000000c01';
const CLIENT2 = '00000000-0000-4000-8000-000000000c02';
const SUPPLIER = '00000000-0000-4000-8000-000000000501';
const FOREIGN = '00000000-0000-4000-8000-000000000f01';
const AR = '00000000-0000-4000-8000-000000001130';
const AP = '00000000-0000-4000-8000-000000002110';
const REVENUE = '00000000-0000-4000-8000-000000004100';
const BANK = '00000000-0000-4000-8000-000000001000';

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true }],
    contacts: [
      { id: CLIENT, company_id: C1, name: 'عميل', type: 'client', is_active: true, deleted_at: null },
      { id: CLIENT2, company_id: C1, name: 'عميل 2', type: 'client', is_active: true, deleted_at: null },
      { id: SUPPLIER, company_id: C1, name: 'مورد', type: 'supplier', is_active: true, deleted_at: null },
    ],
    accounts: [
      { id: AR, company_id: C1, code: '1130' },
      { id: AP, company_id: C1, code: '2110' },
      { id: REVENUE, company_id: C1, code: '4100' },
      { id: BANK, company_id: C1, code: '1000' },
    ],
    journal_lines: [] as Row[],
    invoices: [] as Row[],
    purchase_invoices: [] as Row[],
    voucher_receipts: [] as Row[],
    voucher_disbursements: [] as Row[],
    projects: [] as Row[],
    subscriptions: [{
      id: 's1', company_id: C1, status: 'active', start_date: '2024-01-01',
      end_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      subscription_plans: { features_modules: { clients: true, contacts: true, receipts: true } },
    }],
  } as Record<string, Row[]>;
}

function authedRequest(body?: any, method = 'GET') {
  const token = createToken('u1', 'admin');
  const url = 'http://localhost/api/test';
  return {
    url, nextUrl: new URL(url), method,
    headers: { get: (key: string) => key === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined }, json: async () => body,
  } as any;
}
const withQuery = (request: any, query: string) => {
  const url = `http://localhost/api/test${query}`;
  return { ...request, url, nextUrl: new URL(url) };
};
const paramsOf = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => { mockDb = makeDb(baseDb()); });

describe('control-account contact balances', () => {
  test('ignores tagged revenue/bank counterpart lines and foreign tenants', async () => {
    const db = baseDb();
    db.journal_lines.push(
      { company_id: C1, contact_id: CLIENT, account_id: AR, debit: 1000, credit: 0 },
      { company_id: C1, contact_id: CLIENT, account_id: REVENUE, debit: 0, credit: 1000 },
      { company_id: C1, contact_id: CLIENT, account_id: BANK, debit: 300, credit: 0 },
      { company_id: C1, contact_id: CLIENT, account_id: AR, debit: 0, credit: 300 },
      { company_id: C2, contact_id: CLIENT, account_id: AR, debit: 9999, credit: 0 },
    );
    mockDb = makeDb(db);
    expect(await getContactBalance(C1, CLIENT)).toBe(700);
  });

  test('batch preserves client debit and supplier credit signs', async () => {
    const db = baseDb();
    db.journal_lines.push(
      { company_id: C1, contact_id: CLIENT, account_id: AR, debit: 500, credit: 0 },
      { company_id: C1, contact_id: SUPPLIER, account_id: AP, debit: 0, credit: 250 },
    );
    mockDb = makeDb(db);
    expect(await getContactBalances(C1, [CLIENT, SUPPLIER])).toEqual({ [CLIENT]: 500, [SUPPLIER]: -250 });
  });
});

describe('tenant-scoped reads', () => {
  test('contact detail returns the authoritative balance', async () => {
    const db = baseDb();
    db.journal_lines.push({ company_id: C1, contact_id: CLIENT, account_id: AR, debit: 800, credit: 200 });
    mockDb = makeDb(db);
    const response = await contactOneGET(authedRequest(), paramsOf(CLIENT));
    expect(response.status).toBe(200);
    expect((await response.json()).data.balance).toBe(600);
  });

  test('cross-tenant contact is not exposed', async () => {
    const db = baseDb();
    db.contacts.push({ id: FOREIGN, company_id: C2, name: 'أجنبي', type: 'client', is_active: true, deleted_at: null });
    mockDb = makeDb(db);
    expect((await contactOneGET(authedRequest(), paramsOf(FOREIGN))).status).toBe(404);
  });

  test('client list receives balances from one batch RPC', async () => {
    const db = baseDb();
    db.journal_lines.push({ company_id: C1, contact_id: CLIENT, account_id: AR, debit: 125, credit: 0 });
    mockDb = makeDb(db);
    const response = await clientsGET(authedRequest());
    const clients = (await response.json()).data.clients;
    expect(clients.find((row: Row) => row.id === CLIENT).balance).toBe(125);
    expect(mockDb.rpcCalls.filter((call: any) => call.name === 'get_contact_balance_batch')).toHaveLength(1);
  });

  test('client detail, statement, update and deactivate reject a foreign-tenant id', async () => {
    const db = baseDb();
    db.contacts.push({ id: FOREIGN, company_id: C2, name: 'أجنبي', type: 'client', is_active: true, deleted_at: null });
    mockDb = makeDb(db);
    expect((await clientOneGET(authedRequest(), paramsOf(FOREIGN))).status).toBe(404);
    expect((await clientStatementGET(authedRequest(), paramsOf(FOREIGN))).status).toBe(404);
    expect((await clientPUT(authedRequest({ name: 'محاولة عابرة' }, 'PUT'), paramsOf(FOREIGN))).status).toBe(404);
    expect((await clientDELETE(authedRequest(undefined, 'DELETE'), paramsOf(FOREIGN))).status).toBe(404);
  });
});

describe('voucher contact balance labels', () => {
  test('uses signed client and supplier control balances', async () => {
    const db = baseDb();
    db.journal_lines.push(
      { company_id: C1, contact_id: CLIENT, account_id: AR, debit: 400, credit: 100 },
      { company_id: C1, contact_id: SUPPLIER, account_id: AP, debit: 0, credit: 500 },
    );
    mockDb = makeDb(db);
    const clientResponse = await contactBalanceGET(withQuery(authedRequest(), `?contactId=${CLIENT}`));
    expect((await clientResponse.json()).data).toMatchObject({ balance: 300, label: 'مدين' });
    const supplierResponse = await contactBalanceGET(withQuery(authedRequest(), `?contactId=${SUPPLIER}`));
    expect((await supplierResponse.json()).data.label).toContain('مستحق');
  });
});

describe('atomic contact mutations', () => {
  test('creation sends contact and opening balance to one tenant-bound RPC', async () => {
    const response = await contactPOST(authedRequest({
      name: 'عميل جديد', type: 'client', opening_balance: 1000, opening_balance_type: 'debit',
    }, 'POST'));
    expect(response.status).toBe(201);
    expect(mockDb.rpcCalls).toEqual([{
      name: 'create_contact_atomic',
      params: {
        p_company_id: C1, p_user_id: 'u1', p_data: { name: 'عميل جديد', type: 'client' },
        p_opening_amount: 1000, p_opening_type: 'debit',
      },
    }]);
    expect(mockDb.calls.find((call: any) => call.mut.kind && call.table === 'contacts')).toBeUndefined();
  });

  test('update uses one audited RPC and never creates a duplicate control account', async () => {
    const response = await contactPUT(authedRequest({ name: 'اسم محدّث' }, 'PUT'), paramsOf(CLIENT));
    expect(response.status).toBe(200);
    expect(mockDb.rpcCalls[0]).toEqual({
      name: 'update_contact_atomic',
      params: { p_company_id: C1, p_contact_id: CLIENT, p_patch: { name: 'اسم محدّث' }, p_user_id: 'u1' },
    });
    expect(mockDb.calls.find((call: any) => call.table === 'accounts')).toBeUndefined();
  });

  test('DELETE soft-deactivates even when history exists and performs no hard delete', async () => {
    const db = baseDb();
    db.invoices.push({ id: 'invoice-1', company_id: C1, contact_id: CLIENT });
    db.journal_lines.push({ company_id: C1, contact_id: CLIENT, account_id: AR, debit: 100, credit: 0 });
    mockDb = makeDb(db);
    const response = await contactDELETE(authedRequest(undefined, 'DELETE'), paramsOf(CLIENT));
    expect(response.status).toBe(200);
    expect(mockDb.rpcCalls[0].name).toBe('deactivate_contact_atomic');
    expect(mockDb.calls.some((call: any) => call.mut.kind === 'delete')).toBe(false);
  });

  test('rejects invalid input before any RPC', async () => {
    expect((await contactPOST(authedRequest({ name: 'x', type: 'alien' }, 'POST'))).status).toBe(400);
    expect((await contactPUT(authedRequest({ opening_balance: 5 }, 'PUT'), paramsOf(CLIENT))).status).toBe(400);
    expect((await contactPOST(authedRequest({ name: 'عابر', type: 'client', company_id: C2 }, 'POST'))).status).toBe(400);
    expect(mockDb.rpcCalls).toHaveLength(0);
  });
});

describe('clients endpoint type boundary', () => {
  test('does not create a supplier that would disappear from the client list', async () => {
    const response = await clientsPOST(authedRequest({ name: 'مورد', type: 'supplier' }, 'POST'));
    expect(response.status).toBe(400);
    expect(mockDb.rpcCalls).toHaveLength(0);
  });
});
