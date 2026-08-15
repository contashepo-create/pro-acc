/**
 * Section 6 tests — Vouchers (receipt/disbursement) & Banks/Safes
 *
 * CRITICAL regressions/bugs covered:
 * 1. Disbursement JE direction was INVERTED (bank debited on payment) —
 *    now: debit counterpart / credit bank
 * 2. Counterpart account passed as CODE ('2110') in account_id — crashed
 *    after Section 3's insertJournalLines enforcement; now resolved to a
 *    real company-scoped account id
 * 3. Receipts blocked by a balance check copy-pasted from disbursements
 *    (receipts ADD money — never need balance)
 * 4. Voucher PUT (edit) deletes the original JE → now reversal + new entry
 * 5. Voucher DELETE destroys JE/allocations → now soft-cancel + reversal +
 *    allocation reverts
 * 6. Bank auto-account code collisions (timestamp-4) → sequential unique
 */

process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';

import { createToken } from '@/lib/auth';

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
      gt: (col: string, val: any) => { ops.push({ op: 'gt', col, val }); return api; },
      or: () => api,
      gte: () => api,
      lte: () => api,
      like: () => api,
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
jest.mock('@/lib/permissions', () => ({
  canBypassTelegramConfirmation: jest.fn(async () => true),
  hasModulePermission: jest.fn(async () => true),
}));
jest.mock('@/lib/notifications', () => ({ requireApproval: jest.fn(async () => null) }));
jest.mock('@/lib/approval-helpers', () => ({
  checkTransactionBeforeSave: jest.fn(async () => ({ blocked: false, message: '' })),
}));

import * as receiptRoute from '@/app/api/vouchers/receipt/route';
import { POST as receiptPOST, GET as receiptListGET } from '@/app/api/vouchers/receipt/route';
import { PUT as receiptPUT, DELETE as receiptDELETE } from '@/app/api/vouchers/receipt/[id]/route';
import { POST as disbPOST, GET as disbListGET } from '@/app/api/vouchers/disbursement/route';
import { PUT as disbPUT, DELETE as disbDELETE } from '@/app/api/vouchers/disbursement/[id]/route';
import { POST as banksPOST } from '@/app/api/banks/route';
import { PUT as bankPUT } from '@/app/api/banks/[id]/route';

const C1 = 'company-1';
const C2 = 'company-2';
const CLIENT = '00000000-0000-4000-8000-000000000c01';
const SUPPLIER = '00000000-0000-4000-8000-000000000501';
const SAFE = '00000000-0000-4000-8000-000000000ba1';
const FOREIGN_SAFE = '00000000-0000-4000-8000-000000000ba2';
const BANK_ACC = '00000000-0000-4000-8000-000000001110';
const AR = '00000000-0000-4000-8000-000000001130';
const AP = '00000000-0000-4000-8000-000000002110';
const OTHER_REV = '00000000-0000-4000-8000-000000004200';
const CAPITAL = '00000000-0000-4000-8000-000000003100';

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, is_active: true, token_version: 0, role: 'admin' }],
    contacts: [
      { id: CLIENT, company_id: C1, name: 'عميل' },
      { id: SUPPLIER, company_id: C1, name: 'مورد' },
    ],
    employees: [] as Row[],
    accounts: [
      { id: BANK_ACC, company_id: C1, code: '1110-0001', name: 'الخزينة الرئيسية' },
      { id: AR, company_id: C1, code: '1130', name: 'العملاء' },
      { id: AP, company_id: C1, code: '2110', name: 'ذمم الموردين' },
      { id: OTHER_REV, company_id: C1, code: '4200', name: 'إيرادات أخرى' },
      { id: CAPITAL, company_id: C1, code: '3100', name: 'رأس المال' },
      { id: 'parent-1110', company_id: C1, code: '1110', name: 'النقدية' },
    ],
    banks_safes: [{ id: SAFE, company_id: C1, name: 'الخزينة', type: 'safe', account_id: BANK_ACC, opening_balance: '0' }],
    companies: [{ id: C1, is_active: true }],
    company_telegram_configs: [],
    voucher_receipts: [] as Row[],
    voucher_disbursements: [] as Row[],
    receipt_invoice_items: [] as Row[],
    disbursement_invoice_items: [] as Row[],
    invoices: [] as Row[],
    purchase_invoices: [] as Row[],
    journal_entries: [] as Row[],
    journal_lines: [] as Row[],
        subscriptions: [{
      id: 's1', company_id: C1, plan_id: 'p1', plan_code: 'enterprise', status: 'active',
      start_date: '2024-01-01',
      end_date: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
      subscription_plans: { code: 'enterprise', name: 'Enterprise', features_modules: {
        dashboard: true, accounts: true, journal: true, invoices: true, quotations: true,
        clients: true, contacts: true, reports_basic: true, reports_advanced: true,
        reports_consolidated: true, settings: true, subscription: true, inventory: true,
        purchases: true, cost_centers: true, banks: true, cash: true, warehouses: true,
        branches: true, tax_reports: true, fixed_assets: true, pos: true, workflows: true,
        approvals: true, custody: true, employees: true, projects: true, budgets: true,
        messages: true, crm: true, contracts: true, tenders: true, boq: true,
        progress_billing: true, subcontractors: true, payroll: true
      } },
    }],
journal_sequences: [] as Row[],
    cash_transactions: [] as Row[],
    employee_advances: [] as Row[],
  } as Record<string, Row[]>;
}

function authedRequest(body?: any, method = 'POST') {
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
const insertsOf = (t: string) => mockDb.calls.filter((c) => c.mut.kind === 'insert' && c.table === t);
const deletesOf = (t: string) => mockDb.calls.filter((c) => c.mut.kind === 'delete' && c.table === t);
const updatesOf = (t: string) => mockDb.calls.filter((c) => c.mut.kind === 'update' && c.table === t);

// ---------------------------------------------------------------------------

describe('Voucher validation — party and allocation integrity', () => {
  test('rejects a client receipt without its required contact before any write', async () => {
    mockDb = makeDb(baseDb());
    const res = await receiptPOST(authedRequest({
      date: '2026-08-01', receipt_type: 'client', amount: 100, bank_safe_id: SAFE, reason: 'قبض',
    }));
    expect(res.status).toBe(400);
    expect(insertsOf('voucher_receipts')).toHaveLength(0);
  });

  test('rejects duplicate invoice allocation ids before any financial write', async () => {
    mockDb = makeDb(baseDb());
    const invoiceId = '00000000-0000-4000-8000-000000000101';
    const res = await receiptPOST(authedRequest({
      date: '2026-08-01', receipt_type: 'client', contact_id: CLIENT, amount: 100, bank_safe_id: SAFE, reason: 'قبض',
      invoice_items: [{ invoice_id: invoiceId, amount: 50 }, { invoice_id: invoiceId, amount: 50 }],
    }));
    expect(res.status).toBe(400);
    expect(insertsOf('voucher_receipts')).toHaveLength(0);
  });

  test('requires an employee for employee-advance disbursements', async () => {
    mockDb = makeDb(baseDb());
    const res = await disbPOST(authedRequest({
      date: '2026-08-01', disbursement_type: 'employee_advance', amount: 100, bank_safe_id: SAFE, reason: 'سلفة',
    }));
    expect(res.status).toBe(400);
    expect(insertsOf('voucher_disbursements')).toHaveLength(0);
  });
});

describe('POST /api/vouchers/disbursement — JE direction (critical)', () => {
  test('supplier payment: debit AP / credit bank — never the reverse', async () => {
    const db = baseDb();
    // bank has 10,000 in the ledger
    db.journal_lines.push({ company_id: C1, account_id: BANK_ACC, debit: 10000, credit: 0 });
    mockDb = makeDb(db);

    const res = await disbPOST(authedRequest({
      date: '2026-08-01',
      disbursement_type: 'supplier',
      contact_id: SUPPLIER,
      amount: 500,
      bank_safe_id: SAFE,
      reason: 'سداد مورد',
    }));
    expect(res.status).toBe(201);

    const jl = insertsOf('journal_lines')[0].mut.payload as Row[];
    expect(jl).toHaveLength(2);
    const apLine = jl.find((l) => l.account_code === '2110');
    const bankLine = jl.find((l) => l.account_id === BANK_ACC);
    expect(apLine.debit).toBe(500);   // المقابل مدين
    expect(apLine.credit).toBe(0);
    expect(bankLine.debit).toBe(0);   // البنك دائن — المال خارج!
    expect(bankLine.credit).toBe(500);
    // resolved as real ids, never raw codes
    expect(apLine.account_id).toBe(AP);
  });

  test('insufficient balance → 400 with zero writes', async () => {
    mockDb = makeDb(baseDb()); // no ledger lines → balance 0
    const res = await disbPOST(authedRequest({
      date: '2026-08-01',
      disbursement_type: 'supplier',
      contact_id: SUPPLIER,
      amount: 500,
      bank_safe_id: SAFE,
      reason: 'سداد',
    }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.message).toContain('الرصيد غير كاف');
    expect(insertsOf('voucher_disbursements')).toHaveLength(0);
    expect(insertsOf('journal_entries')).toHaveLength(0);
  });
});

describe('POST /api/vouchers/receipt — no balance check + resolved accounts', () => {
  test('receipt on empty safe is ALLOWED (receipts add money)', async () => {
    mockDb = makeDb(baseDb()); // zero balance
    const res = await receiptPOST({
      ...authedRequest(),
      json: async () => ({
        date: '2026-08-01',
        receipt_type: 'client',
        contact_id: CLIENT,
        amount: 1000,
        bank_safe_id: SAFE,
        reason: 'دفعة من عميل',
      }),
    });
    expect(res.status).toBe(201); // was 400 'الرصيد غير كافٍ' before the fix

    const jl = insertsOf('journal_lines')[0].mut.payload as Row[];
    const bankLine = jl.find((l) => l.account_id === BANK_ACC);
    const arLine = jl.find((l) => l.account_id === AR);
    expect(bankLine.debit).toBe(1000);  // المال داخل
    expect(arLine.credit).toBe(1000);   // ذمم العميل تنخفض
    expect(arLine.account_code).toBe('1130');
  });

  test('general receipt credits OTHER_REVENUE, not a cash self-loop', async () => {
    mockDb = makeDb(baseDb());
    const res = await receiptPOST({
      ...authedRequest(),
      json: async () => ({
        date: '2026-08-01', receipt_type: 'general', amount: 250,
        bank_safe_id: SAFE, reason: 'إيراد متنوع',
      }),
    });
    expect(res.status).toBe(201);
    const jl = insertsOf('journal_lines')[0].mut.payload as Row[];
    expect(jl.find((l) => l.account_id === OTHER_REV).credit).toBe(250);
  });

  test('foreign bank safe → 404; invalid amount → 400', async () => {
    mockDb = makeDb(baseDb());
    const r1 = await receiptPOST({
      ...authedRequest(),
      json: async () => ({ date: '2026-08-01', receipt_type: 'client', contact_id: CLIENT, amount: 10, bank_safe_id: FOREIGN_SAFE, reason: 'x' }),
    });
    expect(r1.status).toBe(404);

    const r2 = await receiptPOST({
      ...authedRequest(),
      json: async () => ({ date: '2026-08-01', receipt_type: 'client', contact_id: CLIENT, amount: -5, bank_safe_id: SAFE, reason: 'x' }),
    });
    expect(r2.status).toBe(400);
    expect(insertsOf('voucher_receipts')).toHaveLength(0);
  });

  test('the broken collection-level DELETE handler is removed', () => {
    expect((receiptRoute as any).DELETE).toBeUndefined();
  });
});

describe('Invoice allocation on receipts', () => {
  test('allocates to sales invoice: paid_amount/status trio updated + link row saved', async () => {
    const db = baseDb();
    db.invoices.push({ id: '00000000-0000-4000-8000-000000000101', company_id: C1, contact_id: CLIENT, number: 1, total: '115', paid_amount: '0', status: 'unpaid' });
    db.journal_lines.push({ company_id: C1, account_id: BANK_ACC, debit: 10000, credit: 0 });
    mockDb = makeDb(db);

    const res = await receiptPOST({
      ...authedRequest(),
      json: async () => ({
        date: '2026-08-01', receipt_type: 'client', contact_id: CLIENT, amount: 100,
        bank_safe_id: SAFE, reason: 'سداد جزئي',
        invoice_items: [{ invoice_id: '00000000-0000-4000-8000-000000000101', amount: 100 }],
      }),
    });
    expect(res.status).toBe(201);

    const invUpd = updatesOf('invoices')[0].mut.payload;
    expect(invUpd.paid_amount).toBe(100);
    expect(invUpd.status).toBe('partial');

    const link = insertsOf('receipt_invoice_items')[0].mut.payload;
    expect(link.invoice_id).toBe('00000000-0000-4000-8000-000000000101');
    expect(link.amount).toBe(100);
    expect(link.company_id).toBe(C1);
    expect(link.journal_entry_id).toBeTruthy();
  });

  test('allocation beyond remaining is capped at the remaining amount', async () => {
    const db = baseDb();
    db.invoices.push({ id: '00000000-0000-4000-8000-000000000101', company_id: C1, contact_id: CLIENT, number: 1, total: '115', paid_amount: '100', status: 'partial' });
    mockDb = makeDb(db);

    const res = await receiptPOST({
      ...authedRequest(),
      json: async () => ({
        date: '2026-08-01', receipt_type: 'client', contact_id: CLIENT, amount: 20,
        bank_safe_id: SAFE, reason: 'تسوية',
        invoice_items: [{ invoice_id: '00000000-0000-4000-8000-000000000101', amount: 20 }], // remaining is 15
      }),
    });
    expect(res.status).toBe(201);
    const link = insertsOf('receipt_invoice_items')[0].mut.payload;
    expect(link.amount).toBe(15); // capped
    const invUpd = updatesOf('invoices')[0].mut.payload;
    expect(invUpd.paid_amount).toBe(115);
    expect(invUpd.status).toBe('paid');
  });

  test('foreign invoice in allocations → full rollback (no voucher, no JE, invoice untouched)', async () => {
    const db = baseDb();
    db.invoices.push({ id: '00000000-0000-4000-8000-000000000102', company_id: C2, contact_id: CLIENT, number: 9, total: '100', paid_amount: '0', status: 'unpaid' });
    mockDb = makeDb(db);

    const res = await receiptPOST({
      ...authedRequest(),
      json: async () => ({
        date: '2026-08-01', receipt_type: 'client', contact_id: CLIENT, amount: 50,
        bank_safe_id: SAFE, reason: 'اختراق',
        invoice_items: [{ invoice_id: '00000000-0000-4000-8000-000000000102', amount: 50 }],
      }),
    });
    expect(res.status).toBe(500);
    expect(deletesOf('voucher_receipts').length).toBeGreaterThan(0); // rolled back
    expect(deletesOf('journal_entries').length).toBeGreaterThan(0);
    expect(updatesOf('invoices')).toHaveLength(0);
  });
});

describe('Voucher PUT — reversal + new entry (original JE preserved)', () => {
  test('editing a receipt amount: old JE reversed (kept), new JE booked', async () => {
    const db = baseDb();
    db.voucher_receipts.push({
      id: 'vr-1', company_id: C1, number: 3, date: '2026-08-01', receipt_type: 'client',
      contact_id: CLIENT, amount: 100, bank_safe_id: SAFE, reason: 'قديم',
      status: 'approved', journal_entry_id: 'je-old',
    });
    db.journal_lines.push(
      { id: 'l1', company_id: C1, journal_entry_id: 'je-old', account_id: BANK_ACC, account_code: '1110-0001', account_name: 'الخزينة', debit: 100, credit: 0 },
      { id: 'l2', company_id: C1, journal_entry_id: 'je-old', account_id: AR, account_code: '1130', account_name: 'العملاء', debit: 0, credit: 100 },
    );
    mockDb = makeDb(db);

    const res = await receiptPUT(authedRequest({ amount: 150 }, 'PUT'), paramsOf('vr-1'));
    expect(res.status).toBe(200);

    const jeInserts = insertsOf('journal_entries');
    expect(jeInserts).toHaveLength(2); // reversal + new
    expect(jeInserts[0].mut.payload.reference_type).toBe('voucher_receipt_reversal');
    expect(jeInserts[1].mut.payload.reference_type).toBe('voucher_receipt');

    // original JE NOT deleted
    expect(deletesOf('journal_entries')).toHaveLength(0);

    // new entry carries the NEW amount
    const newLines = insertsOf('journal_lines')[1].mut.payload as Row[];
    expect(newLines.find((l) => l.account_id === BANK_ACC).debit).toBe(150);

    const upd = updatesOf('voucher_receipts')[0].mut.payload;
    expect(upd.amount).toBe(150);
    expect(upd.journal_entry_id).toBeTruthy();
  });

  test('disbursement PUT now EXISTS (was 405) and posts correct direction', async () => {
    const db = baseDb();
    db.voucher_disbursements.push({
      id: 'vd-1', company_id: C1, number: 4, date: '2026-08-01', disbursement_type: 'supplier',
      contact_id: SUPPLIER, amount: 200, bank_safe_id: SAFE, reason: 'قديم',
      status: 'approved', journal_entry_id: 'je-old',
    });
    db.journal_lines.push(
      { id: 'l1', company_id: C1, journal_entry_id: 'je-old', account_id: AP, account_code: '2110', account_name: 'موردون', debit: 200, credit: 0 },
      { id: 'l2', company_id: C1, journal_entry_id: 'je-old', account_id: BANK_ACC, account_code: '1110-0001', account_name: 'خزينة', debit: 0, credit: 200 },
      { company_id: C1, account_id: BANK_ACC, debit: 10000, credit: 0 }, // bank balance headroom
    );
    mockDb = makeDb(db);

    const res = await disbPUT(authedRequest({ amount: 300 }, 'PUT'), paramsOf('vd-1'));
    expect(res.status).toBe(200);

    const newLines = insertsOf('journal_lines')[1].mut.payload as Row[];
    const apLine = newLines.find((l) => l.account_code === '2110');
    const bankLine = newLines.find((l) => l.account_id === BANK_ACC);
    expect(apLine.debit).toBe(300);
    expect(bankLine.credit).toBe(300);
  });
});

describe('Voucher DELETE — soft-cancel with reversal & allocation revert', () => {
  test('receipt delete: reverses JE, reverts invoice allocations, keeps records', async () => {
    const db = baseDb();
    db.invoices.push({ id: '00000000-0000-4000-8000-000000000101', company_id: C1, contact_id: CLIENT, number: 1, total: '100', paid_amount: '100', status: 'paid' });
    db.voucher_receipts.push({
      id: 'vr-1', company_id: C1, number: 3, date: '2026-08-01', receipt_type: 'client',
      contact_id: CLIENT, amount: 100, bank_safe_id: SAFE, reason: 'دفعة',
      status: 'approved', journal_entry_id: 'je-old',
    });
    db.journal_lines.push(
      { id: 'l1', company_id: C1, journal_entry_id: 'je-old', account_id: BANK_ACC, account_code: '1110-0001', account_name: 'خزينة', debit: 100, credit: 0 },
      { id: 'l2', company_id: C1, journal_entry_id: 'je-old', account_id: AR, account_code: '1130', account_name: 'عملاء', debit: 0, credit: 100 },
    );
    db.receipt_invoice_items.push({ id: 'ri-1', voucher_receipt_id: 'vr-1', invoice_id: '00000000-0000-4000-8000-000000000101', amount: '100', journal_entry_id: 'je-old' });
    mockDb = makeDb(db);

    const res = await receiptDELETE(authedRequest(undefined, 'DELETE'), paramsOf('vr-1'));
    expect(res.status).toBe(200);

    // reversal posted, original kept
    const rev = insertsOf('journal_entries')[0].mut.payload;
    expect(rev.reference_type).toBe('voucher_receipt_reversal');
    expect(deletesOf('journal_entries')).toHaveLength(0);

    // voucher soft-cancelled, not wiped
    expect(deletesOf('voucher_receipts')).toHaveLength(0);
    const upd = updatesOf('voucher_receipts').find((c) => c.mut.payload.status === 'cancelled');
    expect(upd).toBeTruthy();

    // invoice allocation reverted
    const invUpd = updatesOf('invoices')[0].mut.payload;
    expect(invUpd.paid_amount).toBe(0);
    expect(invUpd.status).toBe('unpaid');
    expect(deletesOf('receipt_invoice_items')).toHaveLength(1);
  });

  test('disbursement delete: reverts purchase invoice paid trio', async () => {
    const db = baseDb();
    db.purchase_invoices.push({ id: 'pi-1', company_id: C1, supplier_id: SUPPLIER, number: 2, total: '230', paid_amount: '230', status: 'paid' });
    db.voucher_disbursements.push({
      id: 'vd-1', company_id: C1, number: 4, date: '2026-08-01', disbursement_type: 'supplier',
      contact_id: SUPPLIER, amount: 230, bank_safe_id: SAFE, reason: 'سداد',
      status: 'approved', journal_entry_id: 'je-old',
    });
    db.journal_lines.push(
      { id: 'l1', company_id: C1, journal_entry_id: 'je-old', account_id: AP, account_code: '2110', account_name: 'موردون', debit: 230, credit: 0 },
      { id: 'l2', company_id: C1, journal_entry_id: 'je-old', account_id: BANK_ACC, account_code: '1110-0001', account_name: 'خزينة', debit: 0, credit: 230 },
    );
    db.disbursement_invoice_items.push({ id: 'di-1', voucher_disbursement_id: 'vd-1', purchase_invoice_id: 'pi-1', amount: '230', journal_entry_id: 'je-old' });
    mockDb = makeDb(db);

    const res = await disbDELETE(authedRequest(undefined, 'DELETE'), paramsOf('vd-1'));
    expect(res.status).toBe(200);

    const piUpd = updatesOf('purchase_invoices')[0].mut.payload;
    expect(piUpd.paid_amount).toBe(0);
    expect(piUpd.status).toBe('unpaid');
    expect(updatesOf('voucher_disbursements').some((c) => c.mut.payload.status === 'cancelled')).toBe(true);
  });
});

describe('GET lists — keys & cancelled exclusion', () => {
  test('disbursement list returns BOTH keys and hides cancelled', async () => {
    const db = baseDb();
    db.voucher_disbursements.push(
      { id: 'vd-1', company_id: C1, number: 1, date: '2026-08-01', status: 'approved', amount: 100 },
      { id: 'vd-2', company_id: C1, number: 2, date: '2026-08-02', status: 'cancelled', amount: 200 },
    );
    mockDb = makeDb(db);
    const res = await disbListGET(authedRequest(undefined, 'GET'));
    const json = await res.json();
    expect(json.data.disbursements).toHaveLength(1); // cancelled hidden
    expect(json.data.vouchers).toHaveLength(1);      // legacy alias kept
    expect(json.data.disbursements[0].id).toBe('vd-1');
  });
});

describe('Banks — auto account code uniqueness & opening balance', () => {
  test('new safe gets a unique sequential sub-account code (no timestamp collision)', async () => {
    const db = baseDb();
    db.accounts.push({ id: 'acc-x', company_id: C1, code: '1110-0003', name: 'خزينة أخرى' });
    mockDb = makeDb(db);

    const res = await banksPOST(authedRequest({ name: 'خزينة الفرع', type: 'safe', opening_balance: 0 }));
    expect(res.status).toBe(201);

    const accInsert = insertsOf('accounts')[0].mut.payload;
    expect(accInsert.code).toBe('1110-0004'); // after the existing max — not timestamp-based

    const bsInsert = insertsOf('banks_safes')[0].mut.payload;
    expect(bsInsert.company_id).toBe(C1);
    expect(bsInsert.account_id).toBe(accInsert.id || bsInsert.account_id);
  });

  test('rejects invalid bank type', async () => {
    mockDb = makeDb(baseDb());
    const res = await banksPOST(authedRequest({ name: 'خزينة', type: 'crypto-wallet' }));
    expect(res.status).toBe(400);
    expect(insertsOf('banks_safes')).toHaveLength(0);
  });

  test('opening balance change posts a BALANCED pair to the bank\'s own entry', async () => {
    const db = baseDb();
    db.banks_safes.push({ id: 'b2', company_id: C1, name: 'بنك', type: 'bank', account_id: BANK_ACC, opening_balance: '0' });
    db.journal_lines.push({ journal_entry_id: 'je-open', account_id: BANK_ACC, company_id: C1, debit: 0, credit: 0 });
    db.journal_entries.push({ id: 'je-open', company_id: C1, number: 1, type: 'opening_balance', date: '2026-01-01' });
    mockDb = makeDb(db);

    const res = await bankPUT(authedRequest({ opening_balance: 5000 }, 'PUT'), paramsOf('b2'));
    expect(res.status).toBe(200);

    const lines = insertsOf('journal_lines')[0].mut.payload as Row[];
    expect(lines).toHaveLength(2); // bank + capital — balanced
    const sum = (k: 'debit' | 'credit') => lines.reduce((s, l) => s + (l[k] || 0), 0);
    expect(sum('debit')).toBe(5000);
    expect(sum('credit')).toBe(5000);
    expect(lines.find((l) => l.account_id === CAPITAL)).toBeTruthy();
  });

  test('opening balance without capital account → 400 (never an unbalanced entry)', async () => {
    const db = baseDb();
    db.accounts = db.accounts.filter((a) => a.code !== '3100'); // no capital
    db.banks_safes.push({ id: 'b3', company_id: C1, name: 'بنك', type: 'bank', account_id: BANK_ACC, opening_balance: '0' });
    mockDb = makeDb(db);

    const res = await bankPUT(authedRequest({ opening_balance: 1000 }, 'PUT'), paramsOf('b3'));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.message).toContain('رأس المال');
    expect(insertsOf('journal_lines')).toHaveLength(0);
  });
});
