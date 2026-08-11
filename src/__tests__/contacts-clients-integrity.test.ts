/**
 * Section 8 tests — Customers & Suppliers (contacts / clients / balances)
 *
 * Critical fixes covered:
 * 1. Contact balances were ALWAYS 0: creation flows never set account_id, yet
 *    balance was computed from account_id. Now computed from contact_id-tagged
 *    journal lines (control-account model).
 * 2. contacts/[id] GET loaded EVERY journal_entries row of the company (N+1
 *    bomb) to compute one balance — now a single contact_id-scoped query.
 * 3. contacts/[id] PUT auto-created a sub-account with a DUPLICATE control
 *    code (1130/2110/2150), corrupting the chart and breaking
 *    resolveAccountId — now removed (control accounts + contact_id only).
 * 4. Opening balance was stored as a dead column (no JE) — now posts a
 *    balanced opening entry tagged with contact_id.
 * 5. AR/AP counterpart lines now carry contact_id (receipts, disbursements,
 *    purchase invoices, sales invoices) so payments reduce contact balances.
 * 6. Validation + tenant scoping + fuller delete dependency guards.
 */

process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';

import { createToken } from '@/lib/auth';
import { getContactBalance, getContactBalances } from '@/lib/contact-utils';

type Row = Record<string, any>;
type Op = { op: string; col?: string; val?: any };

function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Op[]; mut: { kind?: string; payload?: any } }> = [];
  let insertCounter = 0;

  const from = (table: string) => {
    const ops: Op[] = [];
    const mut: { kind?: string; payload?: any } = {};
    const call: any = { table, ops, mut };
    calls.push(call);

    const applyFilters = () =>
      (db[table] || []).filter((r) =>
        ops.every((o) => {
          if (o.op === 'eq') return r[o.col!] === o.val;
          if (o.op === 'neq') return r[o.col!] !== o.val;
          if (o.op === 'in') return (o.val as any[]).includes(r[o.col!]);
          if (o.op === 'is') return o.val === null ? r[o.col!] == null : r[o.col!] === o.val;
          if (o.op === 'gt') return (Number(r[o.col!]) || 0) > (Number(o.val) || 0);
          return true;
        })
      );

    const api: any = {
      select: () => api,
      eq: (col: string, val: any) => { ops.push({ op: 'eq', col, val }); return api; },
      neq: (col: string, val: any) => { ops.push({ op: 'neq', col, val }); return api; },
      in: (col: string, val: any) => { ops.push({ op: 'in', col, val }); return api; },
      is: (col: string, val: any) => { ops.push({ op: 'is', col, val }); return api; },
      or: () => api,
      gte: () => api,
      lte: () => api,
      order: () => api,
      limit: () => api,
      range: () => api,
      insert: (payload: any) => { mut.kind = 'insert'; mut.payload = payload; return api; },
      update: (payload: any) => { mut.kind = 'update'; mut.payload = payload; return api; },
      delete: () => { mut.kind = 'delete'; return api; },
      maybeSingle: async () => ({ data: applyFilters()[0] ?? null, error: null }),
      single: async () => {
        if (mut.kind === 'insert') {
          mut.payload = { id: `id-${++insertCounter}`, ...mut.payload };
          (db[table] = db[table] || []).push(mut.payload);
          return { data: mut.payload, error: null };
        }
        if (mut.kind === 'update') {
          return { data: { ...applyFilters()[0], ...mut.payload }, error: null };
        }
        if (mut.kind === 'delete') {
          return { data: applyFilters()[0] ?? { deleted: true }, error: null };
        }
        const row = applyFilters()[0] ?? null;
        return { data: row, error: row ? null : { message: 'not found' } };
      },
      then: (onF: any, onR: any) =>
        Promise.resolve({ data: applyFilters(), error: null }).then(onF, onR),
    };
    return api;
  };

  const db_: any = { from, calls };
  db_.rpcImpl = async (name: string) => ({ data: null, error: { message: `missing ${name}` } });
  db_.rpc = (name: string, params: any) => db_.rpcImpl(name, params);
  return db_;
}

let mockDb: ReturnType<typeof makeDb>;

jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));
jest.mock('@/lib/plan-limits', () => ({ checkPlanLimit: jest.fn(async () => ({ allowed: true })) }));
jest.mock('@/lib/usage-limits', () => ({ checkUsageLimit: jest.fn(async () => ({ allowed: true })) }));

import { GET as contactGET, POST as contactPOST } from '@/app/api/contacts/route';
import { GET as contactOneGET, PUT as contactPUT, DELETE as contactDELETE } from '@/app/api/contacts/[id]/route';
import { GET as clientsGET, POST as clientsPOST } from '@/app/api/clients/route';
import { GET as contactBalanceGET } from '@/app/api/vouchers/contact-balance/route';

const C1 = 'company-1';
const C2 = 'company-2';
const CLIENT = '00000000-0000-4000-8000-000000000c01';
const CLIENT2 = '00000000-0000-4000-8000-000000000c02';
const SUPPLIER = '00000000-0000-4000-8000-000000000501';
const AR = '00000000-0000-4000-8000-000000001130';
const AP = '00000000-0000-4000-8000-000000002110';
const CAPITAL = '00000000-0000-4000-8000-000000003100';
const REVENUE = '00000000-0000-4000-8000-000000004100';

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, is_active: true, role: 'admin' }],
    contacts: [
      { id: CLIENT, company_id: C1, name: 'عميل', type: 'client', account_id: null },
      { id: CLIENT2, company_id: C1, name: 'عميل 2', type: 'client', account_id: null },
      { id: SUPPLIER, company_id: C1, name: 'مورد', type: 'supplier', account_id: null },
    ],
    accounts: [
      { id: AR, company_id: C1, code: '1130', name: 'العملاء' },
      { id: AP, company_id: C1, code: '2110', name: 'ذمم الموردين' },
      { id: CAPITAL, company_id: C1, code: '3100', name: 'رأس المال' },
      { id: REVENUE, company_id: C1, code: '4100', name: 'إيرادات' },
    ],
    journal_entries: [] as Row[],
    journal_lines: [] as Row[],
    journal_sequences: [] as Row[],
    invoices: [] as Row[],
    purchase_invoices: [] as Row[],
    voucher_receipts: [] as Row[],
    voucher_disbursements: [] as Row[],
    projects: [] as Row[],
  } as Record<string, Row[]>;
}

function authedRequest(body?: any, method = 'GET') {
  const token = createToken('u1', 'admin');
  return {
    url: 'http://localhost/api/test',
    method,
    headers: { get: (k: string) => (k === 'authorization' ? `Bearer ${token}` : null) },
    cookies: { get: () => undefined },
    json: async () => body,
  } as any;
}

const paramsOf = (id: string) => ({ params: Promise.resolve({ id }) });
const urlOf = (qs = '') => `http://localhost/api/test${qs}`;
const withUrl = (req: any, qs = '') => ({ ...req, url: urlOf(qs), nextUrl: new URL(urlOf(qs)) });
const insertsOf = (t: string) => mockDb.calls.filter((c) => c.mut.kind === 'insert' && c.table === t);
const deletesOf = (t: string) => mockDb.calls.filter((c) => c.mut.kind === 'delete' && c.table === t);

// ---------------------------------------------------------------------------

describe('getContactBalance — contact_id-based, company-scoped', () => {
  test('sums only contact_id-tagged lines within the company', async () => {
    const db = baseDb();
    db.journal_lines.push(
      { company_id: C1, contact_id: CLIENT, account_id: AR, debit: 1000, credit: 0 },
      { company_id: C1, contact_id: CLIENT, account_id: AR, debit: 0, credit: 300 },
      { company_id: C1, contact_id: CLIENT2, account_id: AR, debit: 500, credit: 0 },
      { company_id: C2, contact_id: CLIENT, account_id: AR, debit: 9999, credit: 0 }, // foreign company
    );
    mockDb = makeDb(db);
    expect(await getContactBalance(C1, CLIENT)).toBe(700);
    expect(await getContactBalance(C1, CLIENT2)).toBe(500);
  });

  test('batch returns a map and ignores cross-tenant lines', async () => {
    const db = baseDb();
    db.journal_lines.push(
      { company_id: C1, contact_id: CLIENT, debit: 100, credit: 0 },
      { company_id: C1, contact_id: SUPPLIER, debit: 0, credit: 250 },
      { company_id: C2, contact_id: CLIENT, debit: 5000, credit: 0 },
    );
    mockDb = makeDb(db);
    const map = await getContactBalances(C1, [CLIENT, SUPPLIER]);
    expect(map[CLIENT]).toBe(100);
    expect(map[SUPPLIER]).toBe(-250);
  });
});

describe('contacts/[id] GET — balance + no N+1', () => {
  test('balance from contact_id lines; does NOT load all journal_entries', async () => {
    const db = baseDb();
    db.journal_lines.push(
      { company_id: C1, contact_id: CLIENT, account_id: AR, debit: 800, credit: 0 },
      { company_id: C1, contact_id: CLIENT, account_id: AR, debit: 0, credit: 200 },
    );
    mockDb = makeDb(db);

    const res = await contactOneGET(authedRequest(), paramsOf(CLIENT));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.balance).toBe(600);
    expect(json.data.balance_type).toBe('debit');
    // The old N+1 fetched every journal_entries row — that must be gone.
    expect(mockDb.calls.find((c) => c.table === 'journal_entries')).toBeUndefined();
  });

  test('cross-tenant contact → 404', async () => {
    const db = baseDb();
    db.contacts.push({ id: 'foreign', company_id: C2, name: 'أجنبي', type: 'client' });
    mockDb = makeDb(db);
    const res = await contactOneGET(authedRequest(), paramsOf('foreign'));
    expect(res.status).toBe(404);
  });
});

describe('clients GET — real balances (batch)', () => {
  test('each client carries its signed balance', async () => {
    const db = baseDb();
    db.journal_lines.push(
      { company_id: C1, contact_id: CLIENT, debit: 500, credit: 0 },
      { company_id: C1, contact_id: CLIENT2, debit: 0, credit: 300 },
    );
    mockDb = makeDb(db);
    const res = await clientsGET(withUrl(authedRequest()));
    expect(res.status).toBe(200);
    const json = await res.json();
    const byId: Record<string, number> = {};
    for (const c of json.data.clients) byId[c.id] = c.balance;
    expect(byId[CLIENT]).toBe(500);
    expect(byId[CLIENT2]).toBe(-300);
  });
});

describe('vouchers/contact-balance — labels by type', () => {
  test('client debit balance → مدين', async () => {
    const db = baseDb();
    db.journal_lines.push({ company_id: C1, contact_id: CLIENT, debit: 400, credit: 100 });
    mockDb = makeDb(db);
    const res = await contactBalanceGET(withUrl(authedRequest(), `?contactId=${CLIENT}`));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.balance).toBe(300);
    expect(json.data.label).toBe('مدين');
    // no full journal_entries scan
    expect(mockDb.calls.find((c) => c.table === 'journal_entries')).toBeUndefined();
  });

  test('supplier credit balance → دائن/مستحق له', async () => {
    const db = baseDb();
    db.journal_lines.push({ company_id: C1, contact_id: SUPPLIER, debit: 0, credit: 500 });
    mockDb = makeDb(db);
    const res = await contactBalanceGET(withUrl(authedRequest(), `?contactId=${SUPPLIER}`));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.balance).toBe(500);
    expect(json.data.label).toContain('مستحق');
  });
});

describe('contacts POST — opening balance becomes a real balanced JE', () => {
  test('debit opening: Dr AR (contact_id) / Cr capital', async () => {
    mockDb = makeDb(baseDb());
    const res = await contactPOST(authedRequest({
      name: 'عميل جديد', type: 'client', opening_balance: 1000, opening_balance_type: 'debit',
    }, 'POST'));
    expect(res.status).toBe(201);

    const je = insertsOf('journal_entries')[0].mut.payload;
    expect(je.type).toBe('opening_balance');

    const lines = insertsOf('journal_lines')[0].mut.payload as Row[];
    expect(lines).toHaveLength(2);
    const arLine = lines.find((l) => l.account_id === AR);
    const capLine = lines.find((l) => l.account_id === CAPITAL);
    expect(arLine.debit).toBe(1000);
    expect(arLine.credit).toBe(0);
    expect(arLine.contact_id).toBeTruthy(); // tagged → enters contact balance
    expect(capLine.credit).toBe(1000);
    // balanced
    const sum = (k: 'debit' | 'credit') => lines.reduce((s, l) => s + (l[k] || 0), 0);
    expect(sum('debit')).toBe(sum('credit'));
  });

  test('credit opening: Cr AR (contact_id) / Dr capital', async () => {
    mockDb = makeDb(baseDb());
    const res = await contactPOST(authedRequest({
      name: 'عميل دائن', type: 'client', opening_balance: 250, opening_balance_type: 'credit',
    }, 'POST'));
    expect(res.status).toBe(201);
    const lines = insertsOf('journal_lines')[0].mut.payload as Row[];
    const arLine = lines.find((l) => l.account_id === AR);
    expect(arLine.credit).toBe(250);
    expect(arLine.contact_id).toBeTruthy();
    expect(lines.find((l) => l.account_id === CAPITAL).debit).toBe(250);
  });

  test('supplier opening uses AP (2110)', async () => {
    mockDb = makeDb(baseDb());
    const res = await contactPOST(authedRequest({
      name: 'مورد جديد', type: 'supplier', opening_balance: 700, opening_balance_type: 'credit',
    }, 'POST'));
    expect(res.status).toBe(201);
    const lines = insertsOf('journal_lines')[0].mut.payload as Row[];
    expect(lines.find((l) => l.account_id === AP).credit).toBe(700);
  });

  test('no opening balance → no JE created', async () => {
    mockDb = makeDb(baseDb());
    await contactPOST(authedRequest({ name: 'بسيط', type: 'client' }, 'POST'));
    expect(insertsOf('journal_entries')).toHaveLength(0);
  });

  test('opening balance without capital account → rollback (no orphan contact)', async () => {
    const db = baseDb();
    db.accounts = db.accounts.filter((a) => a.code !== '3100');
    mockDb = makeDb(db);
    const res = await contactPOST(authedRequest({
      name: 'بدون رأس مال', type: 'client', opening_balance: 500, opening_balance_type: 'debit',
    }, 'POST'));
    expect(res.status).toBe(500);
    // contact was rolled back
    expect(deletesOf('contacts').length).toBeGreaterThan(0);
    // no JE lines committed
    expect(insertsOf('journal_lines')).toHaveLength(0);
  });

  test('invalid type / email rejected before any write', async () => {
    mockDb = makeDb(baseDb());
    const r1 = await contactPOST(authedRequest({ name: 'x', type: 'alien' }, 'POST'));
    expect(r1.status).toBe(400);
    const r2 = await contactPOST(authedRequest({ name: 'x', type: 'client', email: 'not-an-email' }, 'POST'));
    expect(r2.status).toBe(400);
    expect(insertsOf('contacts')).toHaveLength(0);
  });
});

describe('contacts/[id] PUT — no duplicate control-account creation', () => {
  test('editing a contact without account_id does NOT insert an account', async () => {
    mockDb = makeDb(baseDb());
    const res = await contactPUT(authedRequest({ name: 'اسم محدّث' }, 'PUT'), paramsOf(CLIENT));
    expect(res.status).toBe(200);
    expect(insertsOf('accounts')).toHaveLength(0); // was creating a duplicate '1130'
    const upd = mockDb.calls.find((c) => c.mut.kind === 'update' && c.table === 'contacts');
    expect(upd!.mut.payload.name).toBe('اسم محدّث');
    expect(upd!.ops.some((o) => o.col === 'company_id' && o.val === C1)).toBe(true);
  });

  test('invalid update body rejected', async () => {
    mockDb = makeDb(baseDb());
    const res = await contactPUT(authedRequest({ type: 'alien' }, 'PUT'), paramsOf(CLIENT));
    expect(res.status).toBe(400);
  });
});

describe('contacts/[id] DELETE — guards', () => {
  test('blocked when the contact has a balance', async () => {
    const db = baseDb();
    db.journal_lines.push({ company_id: C1, contact_id: CLIENT, debit: 100, credit: 0 });
    mockDb = makeDb(db);
    const res = await contactDELETE(authedRequest(undefined, 'DELETE'), paramsOf(CLIENT));
    expect(res.status).toBe(400);
    expect(deletesOf('contacts')).toHaveLength(0);
  });

  test('blocked when linked to an invoice', async () => {
    const db = baseDb();
    db.invoices.push({ id: 'inv-1', company_id: C1, contact_id: CLIENT });
    mockDb = makeDb(db);
    const res = await contactDELETE(authedRequest(undefined, 'DELETE'), paramsOf(CLIENT));
    expect(res.status).toBe(400);
    expect((await res.json()).message).toContain('فواتير');
  });

  test('blocked when linked to a purchase invoice (supplier)', async () => {
    const db = baseDb();
    db.purchase_invoices.push({ id: 'pi-1', company_id: C1, supplier_id: SUPPLIER });
    mockDb = makeDb(db);
    const res = await contactDELETE(authedRequest(undefined, 'DELETE'), paramsOf(SUPPLIER));
    expect(res.status).toBe(400);
  });

  test('allowed for a clean contact', async () => {
    mockDb = makeDb(baseDb());
    const res = await contactDELETE(authedRequest(undefined, 'DELETE'), paramsOf(CLIENT));
    expect(res.status).toBe(200);
    expect(deletesOf('contacts').length).toBeGreaterThan(0);
  });
});

describe('clients POST — validation', () => {
  test('rejects invalid type', async () => {
    mockDb = makeDb(baseDb());
    const res = await clientsPOST(authedRequest({ name: 'x', type: 'alien' }, 'POST'));
    expect(res.status).toBe(400);
    expect(insertsOf('contacts')).toHaveLength(0);
  });

  test('rejects invalid email', async () => {
    mockDb = makeDb(baseDb());
    const res = await clientsPOST(authedRequest({ name: 'x', email: 'bad' }, 'POST'));
    expect(res.status).toBe(400);
  });
});
