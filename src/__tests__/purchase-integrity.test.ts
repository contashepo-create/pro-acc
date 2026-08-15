/**
 * Section 5 tests — Purchases (orders + invoices)
 *
 * 1. Tenant isolation: every [id] route company-scoped (was fully broken —
 *    cross-tenant read/write/receive/delete); supplier & PO pre-checked
 * 2. Validation: Zod schemas reject negative qty/price, tax_rate > 1,
 *    negative receive quantities (inventory-deduction exploit)
 * 3. Amounts: server-side recomputation; balanced JE with real account
 *    codes/company_id via insertJournalLines (was raw company-less lines)
 * 4. Cancel flow: reversal entry keeps the original (audit), blocked when paid
 * 5. Receive flow: per-item capping BEFORE stock mutation (over-receipt
 *    inflation closed)
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

import { GET as listInvoicesGET, POST as invoicesPOST } from '@/app/api/purchases/invoices/route';
import { GET as invoiceGET, PUT as invoicePUT, DELETE as invoiceDELETE } from '@/app/api/purchases/invoices/[id]/route';
import { GET as listOrdersGET, POST as ordersPOST } from '@/app/api/purchases/orders/route';
import { GET as orderGET, PUT as orderPUT, PATCH as orderPATCH, DELETE as orderDELETE } from '@/app/api/purchases/orders/[id]/route';

const C1 = 'company-1';
const C2 = 'company-2';
const SUPPLIER = '00000000-0000-4000-8000-000000000501';
const FOREIGN_SUPPLIER = '00000000-0000-4000-8000-00000000f001';
const FOREIGN_PO = '00000000-0000-4000-8000-000000000f02';
const INV_ACC = '00000000-0000-4000-8000-000000001170';
const VAT_ACC = '00000000-0000-4000-8000-000000001180';
const AP_ACC = '00000000-0000-4000-8000-000000002110';

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, is_active: true, token_version: 0, role: 'admin' }],
    contacts: [
      { id: SUPPLIER, company_id: C1, name: 'مورد' },
      { id: FOREIGN_SUPPLIER, company_id: C2, name: 'مورد أجنبي' },
    ],
    accounts: [
      { id: INV_ACC, company_id: C1, code: '1170', name: 'المخزون' },
      { id: VAT_ACC, company_id: C1, code: '1180', name: 'ضريبة المشتريات' },
      { id: AP_ACC, company_id: C1, code: '2110', name: 'ذمم الموردين' },
    ],
    purchase_invoices: [] as Row[],
    purchase_invoice_items: [] as Row[],
    purchase_orders: [] as Row[],
    purchase_order_items: [] as Row[],
    disbursement_invoice_items: [] as Row[],
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
    inventory_items: [] as Row[],
    inventory_transactions: [] as Row[],
    warehouses: [{ id: 'wh-1', company_id: C1 }],
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

function insertsOf(table: string) {
  return mockDb.calls.filter((c) => c.mut.kind === 'insert' && c.table === table);
}
function mutationsOf(table: string) {
  return mockDb.calls.filter((c) => c.mut.kind && c.table === table);
}

function invoiceBody(overrides: any = {}) {
  return {
    date: '2026-08-01',
    supplier_id: SUPPLIER,
    purchase_order_id: null,
    items: [
      { description: 'حديد', quantity: 2, unit_price: 100 },
      { description: 'أسمنت', quantity: 3, unit_price: 50 },
    ],
    tax_rate: 0.15,
    notes: 'اختبار',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------

describe('POST /api/purchases/invoices — validation & tenant checks', () => {
  test('foreign supplier → 404 with zero writes (no invoice, no JE, no items)', async () => {
    mockDb = makeDb(baseDb());
    const res = await invoicesPOST(authedRequest(invoiceBody({ supplier_id: FOREIGN_SUPPLIER })));
    expect(res.status).toBe(404);
    expect(insertsOf('purchase_invoices')).toHaveLength(0);
    expect(insertsOf('journal_entries')).toHaveLength(0);
    expect(insertsOf('purchase_invoice_items')).toHaveLength(0);
  });

  test('foreign purchase order → 404 with zero writes', async () => {
    mockDb = makeDb(baseDb());
    const res = await invoicesPOST(authedRequest(invoiceBody({ purchase_order_id: FOREIGN_PO })));
    expect(res.status).toBe(404);
    expect(insertsOf('purchase_invoices')).toHaveLength(0);
  });

  test('tax_rate above 100% or negative quantity → 400 with zero writes', async () => {
    mockDb = makeDb(baseDb());
    const r1 = await invoicesPOST(authedRequest(invoiceBody({ tax_rate: 1.5 })));
    expect(r1.status).toBe(400);

    mockDb = makeDb(baseDb());
    const r2 = await invoicesPOST(authedRequest(invoiceBody({
      items: [{ description: 'بند', quantity: -2, unit_price: 100 }],
    })));
    expect(r2.status).toBe(400);
    expect(insertsOf('purchase_invoices')).toHaveLength(0);
  });
});

describe('POST /api/purchases/invoices — amounts & journal integrity', () => {
  test('recomputes totals server-side and posts a balanced, tenant-scoped JE', async () => {
    mockDb = makeDb(baseDb());
    // item totals sent by client are ignored (recomputed)
    const res = await invoicesPOST(authedRequest(invoiceBody({
      items: [{ description: 'حديد', quantity: 2, unit_price: 100, total: 0.01 }],
    })));
    expect(res.status).toBe(201);

    const inv = insertsOf('purchase_invoices')[0].mut.payload;
    expect(inv.company_id).toBe(C1);
    expect(inv.subtotal).toBe(200);        // not 0.01
    expect(inv.tax_amount).toBe(30);       // 200 × 15%
    expect(inv.total).toBe(230);
    expect(inv.status).toBe('unpaid');
    expect(inv.paid_amount).toBe(0);

    const itemInsert = insertsOf('purchase_invoice_items')[0].mut.payload;
    expect(itemInsert.total).toBe(200);    // real line total, not client's

    const je = insertsOf('journal_entries')[0].mut.payload;
    expect(je.company_id).toBe(C1);
    expect(je.number).toBe(1);             // journal sequence — not the invoice number
    expect(je.reference_type).toBe('purchase_invoice');

    const jl = insertsOf('journal_lines')[0].mut.payload as Row[];
    expect(jl).toHaveLength(3);
    for (const l of jl) {
      expect(l.company_id).toBe(C1);       // previously missing entirely!
      expect(l.account_code).toMatch(/^\d{4}$/);
      expect(l.account_name).toBeTruthy();
    }
    expect(jl.find((l) => l.account_code === '1170').debit).toBe(200);
    expect(jl.find((l) => l.account_code === '1180').debit).toBe(30);
    expect(jl.find((l) => l.account_code === '2110').credit).toBe(230);
  });

  test('fails loudly and rolls back when posting accounts are missing (no silent skip)', async () => {
    const db = baseDb();
    db.accounts = []; // no INVENTORY/AP accounts
    mockDb = makeDb(db);
    const res = await invoicesPOST(authedRequest(invoiceBody()));
    expect(res.status).toBe(500);

    // rolled back: invoice deleted, no JE lines persisted
    const invDeletes = mockDb.calls.filter((c) => c.mut.kind === 'delete' && c.table === 'purchase_invoices');
    expect(invDeletes.length).toBeGreaterThan(0);
    expect(insertsOf('journal_lines')).toHaveLength(0);
  });
});

describe('Purchase invoice [id] — tenant isolation', () => {
  function foreignInvoiceDb() {
    const db = baseDb();
    db.purchase_invoices.push({
      id: 'pi-foreign', company_id: C2, number: 9, total: 500,
      status: 'unpaid', journal_entry_id: null, purchase_order_id: null,
    });
    return db;
  }

  test('GET foreign invoice → 404', async () => {
    mockDb = makeDb(foreignInvoiceDb());
    const res = await invoiceGET(authedRequest(undefined, 'GET'), paramsOf('pi-foreign'));
    expect(res.status).toBe(404);
  });

  test('PUT foreign invoice → 404 with zero updates', async () => {
    mockDb = makeDb(foreignInvoiceDb());
    const res = await invoicePUT(authedRequest({ status: 'cancelled' }, 'PUT'), paramsOf('pi-foreign'));
    expect(res.status).toBe(404);
    expect(mutationsOf('purchase_invoices').filter((c) => c.mut.kind === 'update')).toHaveLength(0);
  });

  test('DELETE foreign invoice → 404 with zero deletes', async () => {
    mockDb = makeDb(foreignInvoiceDb());
    const res = await invoiceDELETE(authedRequest(undefined, 'DELETE'), paramsOf('pi-foreign'));
    expect(res.status).toBe(404);
    expect(mutationsOf('purchase_invoices').filter((c) => c.mut.kind === 'delete')).toHaveLength(0);
  });
});

describe('PUT /api/purchases/invoices/[id] — cancel with reversal', () => {
  test('cancelling posts a full reversal and KEEPS the original entry', async () => {
    const db = baseDb();
    db.purchase_invoices.push({
      id: 'pi-1', company_id: C1, number: 5, total: 230,
      status: 'unpaid', journal_entry_id: 'je-1', purchase_order_id: null,
    });
    db.journal_lines.push(
      { id: 'l1', company_id: C1, journal_entry_id: 'je-1', account_id: INV_ACC, account_code: '1170', account_name: 'المخزون', debit: 200, credit: 0, description: 'مشتريات' },
      { id: 'l2', company_id: C1, journal_entry_id: 'je-1', account_id: VAT_ACC, account_code: '1180', account_name: 'ضريبة', debit: 30, credit: 0, description: 'ضريبة' },
      { id: 'l3', company_id: C1, journal_entry_id: 'je-1', account_id: AP_ACC, account_code: '2110', account_name: 'ذمم', debit: 0, credit: 230, description: 'ذمم' },
    );
    mockDb = makeDb(db);

    const res = await invoicePUT(authedRequest({ status: 'cancelled' }, 'PUT'), paramsOf('pi-1'));
    expect(res.status).toBe(200);

    const rev = insertsOf('journal_entries')[0].mut.payload;
    expect(rev.reference_type).toBe('purchase_invoice_reversal');
    expect(rev.company_id).toBe(C1);
    expect(rev.created_by).toBe('u1'); // current user — not the original creator

    const revLines = insertsOf('journal_lines')[0].mut.payload as Row[];
    expect(revLines).toHaveLength(3);
    const invLine = revLines.find((l) => l.account_code === '1170');
    expect(invLine.debit).toBe(0);       // swapped
    expect(invLine.credit).toBe(200);
    for (const l of revLines) expect(l.company_id).toBe(C1);

    // original entry NOT deleted (audit trail preserved) — was hard-deleted before
    expect(mockDb.calls.filter((c) => c.mut.kind === 'delete' && c.table === 'journal_entries')).toHaveLength(0);

    const upd = mockDb.calls.find((c) => c.mut.kind === 'update' && c.table === 'purchase_invoices');
    expect(upd!.mut.payload.status).toBe('cancelled');
    expect(upd!.ops.some((o) => o.col === 'company_id' && o.val === C1)).toBe(true);
  });

  test('cancelling a paid invoice is blocked (reversal of payments first)', async () => {
    const db = baseDb();
    db.purchase_invoices.push({
      id: 'pi-1', company_id: C1, number: 5, total: 230,
      status: 'partial', journal_entry_id: 'je-1', purchase_order_id: null,
    });
    db.disbursement_invoice_items.push({ id: 'd1', purchase_invoice_id: 'pi-1', amount: '100' });
    mockDb = makeDb(db);

    const res = await invoicePUT(authedRequest({ status: 'cancelled' }, 'PUT'), paramsOf('pi-1'));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.message).toContain('مدفوعات');
    expect(insertsOf('journal_entries')).toHaveLength(0); // no reversal posted
  });

  test('rejects invalid status values', async () => {
    const db = baseDb();
    db.purchase_invoices.push({ id: 'pi-1', company_id: C1, number: 5, status: 'unpaid', journal_entry_id: null, purchase_order_id: null });
    mockDb = makeDb(db);
    const res = await invoicePUT(authedRequest({ status: 'hacked' }, 'PUT'), paramsOf('pi-1'));
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/purchases/invoices/[id] — drafts only', () => {
  test('posted invoice (has JE) cannot be hard-deleted', async () => {
    const db = baseDb();
    db.purchase_invoices.push({ id: 'pi-1', company_id: C1, number: 5, status: 'unpaid', journal_entry_id: 'je-1', purchase_order_id: null });
    mockDb = makeDb(db);
    const res = await invoiceDELETE(authedRequest(undefined, 'DELETE'), paramsOf('pi-1'));
    expect(res.status).toBe(400);
    expect(mutationsOf('purchase_invoices').filter((c) => c.mut.kind === 'delete')).toHaveLength(0);
  });

  test('invoice with payments cannot be hard-deleted (payment history protected)', async () => {
    const db = baseDb();
    db.purchase_invoices.push({ id: 'pi-1', company_id: C1, number: 5, status: 'unpaid', journal_entry_id: null, purchase_order_id: null });
    db.disbursement_invoice_items.push({ id: 'd1', purchase_invoice_id: 'pi-1', amount: '50' });
    mockDb = makeDb(db);
    const res = await invoiceDELETE(authedRequest(undefined, 'DELETE'), paramsOf('pi-1'));
    expect(res.status).toBe(400);
    // payment link rows must NOT be wiped (the old code deleted them!)
    expect(mutationsOf('disbursement_invoice_items').filter((c) => c.mut.kind === 'delete')).toHaveLength(0);
  });

  test('pure draft (no JE, no payments, no PO) deletes cleanly', async () => {
    const db = baseDb();
    db.purchase_invoices.push({ id: 'pi-1', company_id: C1, number: 5, status: 'unpaid', journal_entry_id: null, purchase_order_id: null });
    db.purchase_invoice_items.push({ id: 'it-1', purchase_invoice_id: 'pi-1' });
    mockDb = makeDb(db);
    const res = await invoiceDELETE(authedRequest(undefined, 'DELETE'), paramsOf('pi-1'));
    expect(res.status).toBe(200);
    expect(mutationsOf('purchase_invoices').filter((c) => c.mut.kind === 'delete')).toHaveLength(1);
    expect(mutationsOf('purchase_invoice_items').filter((c) => c.mut.kind === 'delete')).toHaveLength(1);
  });
});

describe('POST /api/purchases/orders', () => {
  test('foreign supplier → 404 with zero writes', async () => {
    mockDb = makeDb(baseDb());
    const res = await ordersPOST(authedRequest({
      date: '2026-08-01',
      supplier_id: FOREIGN_SUPPLIER,
      items: [{ description: 'بند', quantity: 1, unit_price: 10 }],
    }));
    expect(res.status).toBe(404);
    expect(insertsOf('purchase_orders')).toHaveLength(0);
  });

  test('total recomputed server-side; items validated', async () => {
    mockDb = makeDb(baseDb());
    const res = await ordersPOST(authedRequest({
      date: '2026-08-01',
      supplier_id: SUPPLIER,
      items: [
        { description: 'أ', quantity: 2, unit_price: 10, total: 999 }, // lying total ignored
        { description: 'ب', quantity: 1, unit_price: 5 },
      ],
    }));
    expect(res.status).toBe(201);
    const po = insertsOf('purchase_orders')[0].mut.payload;
    expect(po.total).toBe(25); // 2*10 + 1*5 — not 999+…
    expect(po.status).toBe('pending');
    const itemInserts = insertsOf('purchase_order_items');
    expect(itemInserts[0].mut.payload.total).toBe(20);
    expect(itemInserts[1].mut.payload.total).toBe(5);
    for (const ins of itemInserts) expect(ins.mut.payload.company_id).toBe(C1);
  });

  test('negative price rejected', async () => {
    mockDb = makeDb(baseDb());
    const res = await ordersPOST(authedRequest({
      date: '2026-08-01',
      supplier_id: SUPPLIER,
      items: [{ description: 'بند', quantity: 1, unit_price: -10 }],
    }));
    expect(res.status).toBe(400);
    expect(insertsOf('purchase_orders')).toHaveLength(0);
  });
});

describe('PATCH /api/purchases/orders/[id] — goods receipt hardening', () => {
  function receivingDb() {
    const db = baseDb();
    db.purchase_orders.push({
      id: 'po-1', company_id: C1, po_number: 7, date: '2026-08-01',
      supplier_id: SUPPLIER, status: 'partial', total: 300,
    });
    db.purchase_order_items.push({
      id: 'poi-1', purchase_order_id: 'po-1', description: 'حديد',
      quantity: 3, received_quantity: 1, unit_price: 100, total: 300,
    });
    db.inventory_items.push({
      id: 'inv-1', company_id: C1, code: 'حديد', quantity: 10, unit_price: 90, warehouse_id: 'wh-1',
    });
    return db;
  }

  test('over-receipt is capped BEFORE touching stock', async () => {
    mockDb = makeDb(receivingDb());
    const res = await orderPATCH(authedRequest({ quantities: { 'poi-1': 99 } }, 'PATCH'), paramsOf('po-1'));
    expect(res.status).toBe(200);

    const itemUpd = mockDb.calls.find((c) => c.mut.kind === 'update' && c.table === 'purchase_order_items');
    expect(itemUpd!.mut.payload.received_quantity).toBe(3); // 1 + capped 2, not 1 + 99

    const trx = insertsOf('inventory_transactions')[0].mut.payload;
    expect(trx.quantity).toBe(2);            // capped — the old code added 99!
    expect(trx.company_id).toBe(C1);

    const invUpd = mockDb.calls.find((c) => c.mut.kind === 'update' && c.table === 'inventory_items');
    expect(invUpd!.mut.payload.quantity).toBe(12); // 10 + 2
  });

  test('negative receive quantity → 400 (inventory deduction exploit closed)', async () => {
    mockDb = makeDb(receivingDb());
    const res = await orderPATCH(authedRequest({ quantities: { 'poi-1': -5 } }, 'PATCH'), paramsOf('po-1'));
    expect(res.status).toBe(400);
    expect(insertsOf('inventory_transactions')).toHaveLength(0);
    expect(mutationsOf('purchase_order_items')).toHaveLength(0);
  });

  test('foreign order → 404 with zero stock mutation', async () => {
    const db = receivingDb();
    db.purchase_orders[0].company_id = C2;
    mockDb = makeDb(db);
    const res = await orderPATCH(authedRequest({}, 'PATCH'), paramsOf('po-1'));
    expect(res.status).toBe(404);
    expect(insertsOf('inventory_transactions')).toHaveLength(0);
    expect(mutationsOf('inventory_items')).toHaveLength(0);
  });
});

describe('GET lists — filter & batch loading fixes', () => {
  test('invoices: supplierId actually filters (was ignored), paid_amount real (was hardcoded 0), items batched', async () => {
    const db = baseDb();
    db.purchase_invoices.push(
      { id: 'pi-1', company_id: C1, invoice_number: 1, date: '2026-08-01', supplier_id: SUPPLIER },
      { id: 'pi-2', company_id: C1, invoice_number: 2, date: '2026-08-02', supplier_id: '00000000-0000-4000-8000-000000000502' },
    );
    db.purchase_invoice_items.push({ id: 'it-1', purchase_invoice_id: 'pi-1', description: 'حديد', quantity: 2 });
    db.disbursement_invoice_items.push(
      { id: 'd1', purchase_invoice_id: 'pi-1', amount: '80' },
      { id: 'd2', purchase_invoice_id: 'pi-2', amount: '50' },
    );
    mockDb = makeDb(db);

    const req = authedRequest(undefined, 'GET');
    req.url = `http://localhost/api/purchases/invoices?supplierId=${SUPPLIER}`;
    const res = await listInvoicesGET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.invoices).toHaveLength(1);          // filter applied
    expect(json.data.invoices[0].id).toBe('pi-1');
    expect(json.data.invoices[0].paid_amount).toBe(80);  // from disbursements, not 0
    expect(json.data.invoices[0].items).toHaveLength(1);
  });

  test('orders: items loaded in ONE batch query instead of N+1 per order', async () => {
    const db = baseDb();
    db.purchase_orders.push(
      { id: 'po-1', company_id: C1, po_number: 1, date: '2026-08-01', supplier_id: SUPPLIER, status: 'pending' },
      { id: 'po-2', company_id: C1, po_number: 2, date: '2026-08-02', supplier_id: SUPPLIER, status: 'pending' },
    );
    db.purchase_order_items.push(
      { id: 'poi-1', purchase_order_id: 'po-1', description: 'أ' },
      { id: 'poi-2', purchase_order_id: 'po-2', description: 'ب' },
    );
    mockDb = makeDb(db);

    const req = authedRequest(undefined, 'GET');
    req.url = 'http://localhost/api/purchases/orders?status=pending';
    const res = await listOrdersGET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.orders).toHaveLength(2);
    expect(json.data.orders[0].items).toHaveLength(1);

    const itemReads = mockDb.calls.filter((c) => c.table === 'purchase_order_items' && !c.mut.kind);
    expect(itemReads).toHaveLength(1);
    expect(itemReads[0].ops.some((o) => o.op === 'in')).toBe(true);
  });
});

describe('Purchase order [id] — remaining tenant isolation', () => {
  test('GET/PUT/DELETE foreign order → 404', async () => {
    const db = baseDb();
    db.purchase_orders.push({ id: 'po-f', company_id: C2, po_number: 1, status: 'pending', supplier_id: FOREIGN_SUPPLIER });
    mockDb = makeDb(db);

    expect((await orderGET(authedRequest(undefined, 'GET'), paramsOf('po-f'))).status).toBe(404);
    expect((await orderPUT(authedRequest({ notes: 'x' }, 'PUT'), paramsOf('po-f'))).status).toBe(404);
    expect((await orderDELETE(authedRequest(undefined, 'DELETE'), paramsOf('po-f'))).status).toBe(404);
    expect(mutationsOf('purchase_orders')).toHaveLength(0);
  });
});
