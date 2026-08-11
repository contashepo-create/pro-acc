/**
 * Section 4 tests — Sales invoices & ZATCA
 *
 * 1. Server-side amount computation: client-sent subtotal/vat/total are
 *    ignored (VAT-understatement vector closed); discounts honoured
 * 2. Invoice journal entry: independent journal numbering, balanced lines,
 *    tenant-scoped codes/names via insertJournalLines
 * 3. Tenant checks: foreign client → 404, foreign bank/safe → 400,
 *    zero database writes in both cases
 * 4. Immediate collection flow (bank line + receipt voucher)
 * 5. PATCH paid → paid_amount=total; PATCH cancelled → reversal entry
 * 6. ZATCA UBL: XML injection via seller/buyer/notes escapes
 */

process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';

import { createToken } from '@/lib/auth';
import { generateUBLInvoice } from '@/lib/zatca';

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
        const row = applyFilters()[0] ?? null;
        return { data: row, error: row ? null : { message: 'not found' } };
      },
      then: (onF: any, onR: any) =>
        Promise.resolve({ data: applyFilters(), error: null }).then(onF, onR),
    };
    return api;
  };

  const db_: any = { from, calls };
  db_.rpcImpl = async (name: string) => ({ data: null, error: { message: `Could not find the function ${name}` } });
  db_.rpc = (name: string, params: any) => db_.rpcImpl(name, params);
  return db_;
}

let mockDb: ReturnType<typeof makeDb>;

jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));
jest.mock('@/lib/usage-limits', () => ({
  checkUsageLimit: jest.fn(async () => ({ allowed: true })),
  checkModuleAccess: jest.fn(async () => true),
}));

import { POST as invoicesPOST } from '@/app/api/invoices/route';
import { PATCH as invoicePATCH } from '@/app/api/invoices/[id]/route';

const C1 = 'company-1';
const CLIENT = '00000000-0000-4000-8000-0000000000c1';
const AR = '00000000-0000-4000-8000-000000001130';
const REV = '00000000-0000-4000-8000-000000004100';
const VAT = '00000000-0000-4000-8000-000000002120';
const BANK_ACC = '00000000-0000-4000-8000-000000001121';
const SAFE = '00000000-0000-4000-8000-0000000000b1';

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, is_active: true, role: 'admin' }],
    companies: [{ id: C1, is_active: true, name: 'شركة الاختبار', tax_number: '312345678901234' }],
    contacts: [{ id: CLIENT, company_id: C1, name: 'عميل' }],
    projects: [] as Row[],
    accounts: [
      { id: AR, company_id: C1, code: '1130', name: 'العملاء' },
      { id: REV, company_id: C1, code: '4100', name: 'إيرادات مقاولات' },
      { id: VAT, company_id: C1, code: '2120', name: 'ضريبة المبيعات' },
      { id: BANK_ACC, company_id: C1, code: '1121', name: 'بنك الراجحي' },
    ],
    banks_safes: [{ id: SAFE, company_id: C1, account_id: BANK_ACC }],
    invoice_sequences: [] as Row[],
    journal_sequences: [] as Row[],
    voucher_receipts: [] as Row[],
    invoices: [] as Row[],
    invoice_items: [] as Row[],
    journal_entries: [] as Row[],
    journal_lines: [] as Row[],
  } as Record<string, Row[]>;
}

function authedRequest(body?: any) {
  const token = createToken('u1', 'admin');
  return {
    headers: { get: (k: string) => (k === 'authorization' ? `Bearer ${token}` : null) },
    cookies: { get: () => undefined },
    json: async () => body,
  } as any;
}

const paramsOf = (id: string) => ({ params: Promise.resolve({ id }) });

function invoiceBody(overrides: any = {}) {
  return {
    clientId: CLIENT,
    date: '2026-08-01',
    dueDate: '2026-08-15',
    items: [
      { description: 'بند 1', quantity: 2, unitPrice: 100, total: 200 },
      { description: 'بند 2', quantity: 3, unitPrice: 50, total: 150 },
    ],
    // LYING totals — server must ignore these
    subtotal: 0.01, vatAmount: 0, total: 0.01,
    vatRate: 0.15,
    notes: 'اختبار',
    ...overrides,
  };
}

function insertsOf(table: string) {
  return mockDb.calls.filter((c) => c.mut.kind === 'insert' && c.table === table);
}

// ---------------------------------------------------------------------------

describe('POST /api/invoices — server-side amounts (never trust client)', () => {
  test('recomputes subtotal/vat/total from items, ignoring client lies', async () => {
    mockDb = makeDb(baseDb());
    const res = await invoicesPOST(authedRequest(invoiceBody()));
    expect(res.status).toBe(201);

    const inv = insertsOf('invoices')[0].mut.payload;
    expect(inv.subtotal).toBe(350);         // 2*100 + 3*50 — not 0.01
    expect(inv.vat_amount).toBe(52.5);      // 350 * 15% — not 0
    expect(inv.total).toBe(402.5);          // not 0.01
    expect(inv.company_id).toBe(C1);
    expect(inv.status).toBe('unpaid');
    expect(inv.paid_amount).toBe(0);

    const itemInserts = insertsOf('invoice_items');
    expect(itemInserts.length).toBeGreaterThan(0);
    for (const ins of itemInserts) {
      expect(ins.mut.payload.company_id).toBe(C1);
    }
  });

  test('honours per-item discount in server computation', async () => {
    mockDb = makeDb(baseDb());
    const body = invoiceBody({
      items: [{ description: 'بند', quantity: 2, unitPrice: 100, discount: 50, total: 150 }],
    });
    const res = await invoicesPOST(authedRequest(body));
    expect(res.status).toBe(201);
    const inv = insertsOf('invoices')[0].mut.payload;
    expect(inv.subtotal).toBe(150);   // 200 - 50
    expect(inv.vat_amount).toBe(22.5);
    expect(inv.total).toBe(172.5);
    const item = insertsOf('invoice_items')[0].mut.payload;
    expect(item.total).toBe(150);
    expect(item.unit_price).toBe(100);
    expect(item.company_id).toBe(C1);
  });

  test('discount is capped at the item gross', async () => {
    mockDb = makeDb(baseDb());
    const body = invoiceBody({
      items: [{ description: 'بند', quantity: 1, unitPrice: 100, discount: 99999 }],
    });
    const res = await invoicesPOST(authedRequest(body));
    expect(res.status).toBe(201);
    expect(insertsOf('invoices')[0].mut.payload.subtotal).toBe(0);
    expect(insertsOf('invoices')[0].mut.payload.total).toBe(0);
  });

  test('vatEnabled=false zeroes the VAT', async () => {
    mockDb = makeDb(baseDb());
    const res = await invoicesPOST(authedRequest(invoiceBody({ vatEnabled: false, vatRate: 0 })));
    expect(res.status).toBe(201);
    const inv = insertsOf('invoices')[0].mut.payload;
    expect(inv.vat_amount).toBe(0);
    expect(inv.total).toBe(350);
  });
});

describe('POST /api/invoices — journal posting', () => {
  test('uses the journal sequence (not the invoice number) and posts balanced, tenant-scoped lines', async () => {
    const db = baseDb();
    db.journal_sequences.push({ company_id: C1, year: 2026, last_number: 7 });
    mockDb = makeDb(db);

    const res = await invoicesPOST(authedRequest(invoiceBody()));
    expect(res.status).toBe(201);

    const invInsert = insertsOf('invoices')[0].mut.payload;
    const jeInsert = insertsOf('journal_entries')[0].mut.payload;
    expect(invInsert.number).toBe(1);            // first invoice
    expect(jeInsert.number).toBe(8);             // journal sequence continued — NOT 1
    expect(jeInsert.company_id).toBe(C1);

    const jl = insertsOf('journal_lines')[0].mut.payload as Row[];
    const sum = (k: 'debit' | 'credit') => jl.reduce((s, l) => s + (l[k] || 0), 0);
    expect(sum('debit')).toBeCloseTo(402.5);
    expect(sum('credit')).toBeCloseTo(402.5);
    for (const l of jl) {
      expect(l.company_id).toBe(C1);
      expect(l.account_code).toMatch(/^\d{4}$/);
      expect(l.account_name).toBeTruthy();
    }
    // AR line carries the full total when unpaid
    const arLine = jl.find((l) => l.account_code === '1130');
    expect(arLine.debit).toBeCloseTo(402.5);
    const vatLine = jl.find((l) => l.account_code === '2120');
    expect(vatLine.credit).toBeCloseTo(52.5);
  });

  test('immediate collection: bank line uses the REAL account code, voucher created, status paid', async () => {
    mockDb = makeDb(baseDb());
    const res = await invoicesPOST(authedRequest(invoiceBody({
      collected_amount: 402.5,
      bank_safe_id: SAFE,
    })));
    expect(res.status).toBe(201);

    const inv = insertsOf('invoices')[0].mut.payload;
    expect(inv.status).toBe('paid');
    expect(inv.paid_amount).toBe(402.5);

    const jl = insertsOf('journal_lines')[0].mut.payload as Row[];
    const bankLine = jl.find((l) => l.account_id === BANK_ACC);
    expect(bankLine.account_code).toBe('1121');  // real code — not hardcoded 1120
    expect(bankLine.debit).toBeCloseTo(402.5);
    expect(jl.find((l) => l.account_code === '1130')).toBeUndefined(); // nothing left on AR

    const voucher = insertsOf('voucher_receipts')[0].mut.payload;
    expect(voucher.company_id).toBe(C1);
    expect(voucher.amount).toBe(402.5);
  });
});

describe('POST /api/invoices — tenant isolation', () => {
  test('foreign clientId → 404 with zero writes', async () => {
    mockDb = makeDb(baseDb());
    const res = await invoicesPOST(authedRequest(invoiceBody({ clientId: '00000000-0000-4000-8000-00000000dead' })));
    expect(res.status).toBe(404);
    expect(insertsOf('invoices')).toHaveLength(0);
    expect(insertsOf('journal_entries')).toHaveLength(0);
    // sequence must not be burned by a rejected request
    expect(insertsOf('invoice_sequences')).toHaveLength(0);
  });

  test('foreign bank_safe_id → 400 with zero writes', async () => {
    mockDb = makeDb(baseDb());
    const res = await invoicesPOST(authedRequest(invoiceBody({
      collected_amount: 402.5,
      bank_safe_id: '00000000-0000-4000-8000-00000000beef',
    })));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.message).toContain('الخزينة');
    expect(insertsOf('invoices')).toHaveLength(0);
    expect(insertsOf('journal_lines')).toHaveLength(0);
  });
});

describe('PATCH /api/invoices/[id]', () => {
  test('marking paid sets paid_amount = total (trio stays consistent)', async () => {
    const db = baseDb();
    db.invoices.push({ id: 'inv-1', company_id: C1, number: 3, total: 1150, paid_amount: 0, status: 'unpaid', journal_entry_id: null });
    mockDb = makeDb(db);
    const res = await invoicePATCH(authedRequest({ status: 'paid' }), paramsOf('inv-1'));
    expect(res.status).toBe(200);
    const upd = mockDb.calls.find((c) => c.mut.kind === 'update' && c.table === 'invoices');
    expect(upd!.mut.payload.status).toBe('paid');
    expect(upd!.mut.payload.paid_amount).toBe(1150);
    expect(upd!.ops.some((o) => o.col === 'company_id' && o.val === C1)).toBe(true);
  });

  test('cancelling creates a reversal entry with swapped debit/credit', async () => {
    const db = baseDb();
    db.invoices.push({ id: 'inv-1', company_id: C1, number: 3, total: 1150, paid_amount: 0, status: 'unpaid', journal_entry_id: 'je-1' });
    db.journal_lines.push(
      { id: 'l1', journal_entry_id: 'je-1', account_id: AR, account_code: '1130', account_name: 'العملاء', debit: 1150, credit: 0, description: 'ذمم' },
      { id: 'l2', journal_entry_id: 'je-1', account_id: REV, account_code: '4100', account_name: 'إيرادات', debit: 0, credit: 1000, description: 'إيراد' },
      { id: 'l3', journal_entry_id: 'je-1', account_id: VAT, account_code: '2120', account_name: 'ضريبة', debit: 0, credit: 150, description: 'ضريبة' },
    );
    mockDb = makeDb(db);

    const res = await invoicePATCH(authedRequest({ status: 'cancelled' }), paramsOf('inv-1'));
    expect(res.status).toBe(200);

    const revEntry = insertsOf('journal_entries')[0].mut.payload;
    expect(revEntry.reference_type).toBe('invoice_reversal');
    expect(revEntry.company_id).toBe(C1);

    const revLines = insertsOf('journal_lines')[0].mut.payload as Row[];
    expect(revLines).toHaveLength(3);
    // swapped: original debit 1150 becomes credit
    const arReversal = revLines.find((l) => l.account_code === '1130');
    expect(arReversal.debit).toBe(0);
    expect(arReversal.credit).toBe(1150);
    for (const l of revLines) expect(l.company_id).toBe(C1);
  });
});

describe('SQL invoice_items inserts always list company_id', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  test('create_invoice_with_journal and 023 write company_id on invoice_items', () => {
    const dir = path.join(__dirname, '../migrations');
    for (const file of ['014-atomic-invoice-creation.sql', '022-fix-journal-lines-company-id.sql', '023-fix-child-rows-company-id.sql']) {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      const inserts = [...sql.matchAll(/INSERT INTO invoice_items\s*\(([^)]+)\)/gi)];
      expect(inserts.length).toBeGreaterThan(0);
      for (const m of inserts) expect(m[1]).toMatch(/company_id/i);
    }
  });
});

describe('ZATCA UBL — XML injection safety', () => {
  test('escapes malicious markup in seller/buyer/notes/items', () => {
    const evil = '</cbc:Note><evil>INJECTED</evil>';
    const xml = generateUBLInvoice({
      uuid: 'uuid-1', number: 1, issueDate: '2026-08-01', issueTime: '10:00:00',
      invoiceTypeCode: '388', currencyCode: 'SAR',
      seller: {
        name: `بائع${evil}`,
        vatNumber: '312345678901234',
        address: { street: 'طريق الملك', city: 'الرياض', postalZone: '12345', country: 'SA' },
      },
      buyer: {
        name: `مشتري${evil}`,
        vatNumber: '',
        address: { street: 'شارع التحلية', city: 'جدة', country: 'SA' },
      },
      items: [{ id: '1', description: `بند${evil}`, quantity: 1, unitPrice: 100, vatRate: 0.15, total: 100 }],
      amounts: { lineExtensionAmount: 100, taxExclusiveAmount: 100, taxInclusiveAmount: 115, taxAmount: 15 },
      vatRate: 0.15,
      paymentMeansCode: '10',
      notes: [`ملاحظة${evil}`],
    });

    expect(xml).not.toContain('</cbc:Note><evil>');
    expect(xml).not.toContain('<evil>INJECTED</evil>');
    expect(xml).toContain('&lt;evil&gt;');
  });

  test('escapes scalar fields interpolated raw (dates, type code, currency, payment means)', () => {
    const xml = generateUBLInvoice({
      uuid: 'uuid-1', number: 1,
      issueDate: '2026-08-01</cbc:IssueDate><evil>D</evil>',
      issueTime: '10:00:00',
      invoiceTypeCode: '388<evil>T</evil>',
      currencyCode: 'SA"R<x>',
      seller: { name: 'بائع', vatNumber: '312345678901234' },
      buyer: { name: 'مشتري' },
      items: [{ id: '1', description: 'بند', quantity: 1, unitPrice: 100, vatRate: 0.15, total: 100 }],
      amounts: { lineExtensionAmount: 100, taxExclusiveAmount: 100, taxInclusiveAmount: 115, taxAmount: 15 },
      vatRate: 0.15,
      paymentMeansCode: '10<evil>P</evil>',
    });

    expect(xml).not.toContain('<evil>');
    expect(xml).not.toContain('currencyID="SA"R<x>"');
    expect(xml).toContain('&lt;evil&gt;');
    expect(xml).toContain('SA&quot;R&lt;x&gt;');
  });

  test('tolerates null/undefined text fields without crashing', () => {
    const xml = generateUBLInvoice({
      uuid: 'uuid-1', number: 1, issueDate: '2026-08-01', issueTime: '10:00:00',
      invoiceTypeCode: '388', currencyCode: 'SAR',
      seller: { name: undefined as any, vatNumber: undefined as any },
      buyer: { name: null as any },
      items: [{ id: '1', description: undefined as any, quantity: 1, unitPrice: 100, vatRate: 0.15, total: 100 }],
      amounts: { lineExtensionAmount: 100, taxExclusiveAmount: 100, taxInclusiveAmount: 115, taxAmount: 15 },
      vatRate: 0.15,
      notes: [undefined as any],
    });
    expect(xml).toContain('<Invoice');
    expect(xml).toContain('</Invoice>');
  });
});
