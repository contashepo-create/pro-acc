/**
 * Section 7 tests — Inventory (items / movements / warehouses)
 *
 * Critical fixes covered:
 * 1. UNIFIED STOCK WRITER: api/inventory-transactions POST previously logged
 *    movements WITHOUT touching item stock (ledger ≠ warehouse). Both
 *    movement routes now delegate to the same hardened engine.
 * 2. Cross-tenant: item/warehouse looked up WITHOUT company filter →
 *    foreign stock was mutable. Now 404.
 * 3. 'adjustment' JE was posted SINGLE-SIDED (trial balance corruption) —
 *    now balanced (surplus→4200, deficit→5100). 'return' posts Dr 1170/Cr 5100.
 * 4. Transfer upsert REPLACED destination stock (repeated transfers
 *    destroyed prior balances) — now additive with weighted average.
 * 5. Movement PATCH/DELETE un-hardened: quantity edits and deletes now
 *    blocked with counter-movement guidance (integrity > convenience).
 * 6. Purchase invoice no longer bumps stock (single writer = PO receipt).
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

import { POST as movementPOST } from '@/app/api/inventory-transactions/route';
import { POST as movementAliasPOST } from '@/app/api/inventory/transactions/route';
import { PUT as movementPUT, DELETE as movementDELETE } from '@/app/api/inventory-transactions/[id]/route';
import { POST as itemPOST } from '@/app/api/inventory/route';
import { PUT as itemPUT, DELETE as itemDELETE } from '@/app/api/inventory/[id]/route';
import { POST as purchaseInvoicePOST } from '@/app/api/purchases/invoices/route';

const C1 = 'company-1';
const C2 = 'company-2';
const W1 = '00000000-0000-4000-8000-00000000aa01';
const W2 = '00000000-0000-4000-8000-00000000aa02';
const FOREIGN_W = '00000000-0000-4000-8000-00000000aa09';
const ITEM = '00000000-0000-4000-8000-00000000bb01';
const FOREIGN_ITEM = '00000000-0000-4000-8000-00000000bb09';
const ACC_INV = '00000000-0000-4000-8000-000000001170';
const ACC_REV = '00000000-0000-4000-8000-000000004200';
const ACC_COST = '00000000-0000-4000-8000-000000005100';
const ACC_AP = '00000000-0000-4000-8000-000000002110';
const ACC_VATP = '00000000-0000-4000-8000-000000001180';
const SUPPLIER = '00000000-0000-4000-8000-000000000501';
const PO = '00000000-0000-4000-8000-000000000c01';

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, is_active: true, role: 'admin' }],
    warehouses: [
      { id: W1, company_id: C1, name: 'المستودع الرئيسي' },
      { id: W2, company_id: C1, name: 'مستودع الفرع' },
      { id: FOREIGN_W, company_id: C2, name: 'أجنبي' },
    ],
    inventory_items: [
      { id: ITEM, company_id: C1, code: 'STEEL', name: 'حديد', unit: 'طن', warehouse_id: W1, quantity: '10', unit_price: '100', category: null, is_active: true },
      { id: FOREIGN_ITEM, company_id: C2, code: 'X', name: 'أجنبي', unit: 'وحدة', warehouse_id: FOREIGN_W, quantity: '5', unit_price: '50', is_active: true },
    ],
    inventory_transactions: [] as Row[],
    accounts: [
      { id: ACC_INV, company_id: C1, code: '1170', name: 'المخزون' },
      { id: ACC_REV, company_id: C1, code: '4200', name: 'إيرادات أخرى' },
      { id: ACC_COST, company_id: C1, code: '5100', name: 'تكاليف مباشرة' },
      { id: ACC_AP, company_id: C1, code: '2110', name: 'ذمم الموردين' },
      { id: ACC_VATP, company_id: C1, code: '1180', name: 'ضريبة مشتريات' },
    ],
    contacts: [{ id: SUPPLIER, company_id: C1, name: 'مورد' }],
    purchase_orders: [{ id: PO, company_id: C1, po_number: 1, supplier_id: SUPPLIER }],
    purchase_invoices: [] as Row[],
    purchase_invoice_items: [] as Row[],
    journal_entries: [] as Row[],
    journal_lines: [] as Row[],
    journal_sequences: [] as Row[],
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
const updatesOf = (t: string) => mockDb.calls.filter((c) => c.mut.kind === 'update' && c.table === t);

const movement = (over: any = {}) => ({
  item_id: ITEM,
  warehouse_id: W1,
  type: 'add',
  quantity: 5,
  unit_price: 120,
  date: '2026-08-01',
  ...over,
});

// ---------------------------------------------------------------------------

describe('stock movements — tenant isolation & validation', () => {
  test('foreign item → 404 with zero writes', async () => {
    mockDb = makeDb(baseDb());
    const res = await movementPOST(authedRequest(movement({ item_id: FOREIGN_ITEM })));
    expect(res.status).toBe(404);
    expect(insertsOf('inventory_transactions')).toHaveLength(0);
    expect(updatesOf('inventory_items')).toHaveLength(0);
  });

  test('foreign source warehouse → 404; negative quantity → 400', async () => {
    mockDb = makeDb(baseDb());
    const r1 = await movementPOST(authedRequest(movement({ warehouse_id: FOREIGN_W })));
    expect(r1.status).toBe(404);

    mockDb = makeDb(baseDb());
    const r2 = await movementPOST(authedRequest(movement({ quantity: -5 })));
    expect(r2.status).toBe(400);
    expect(insertsOf('inventory_transactions')).toHaveLength(0);
  });
});

describe('stock movements — the unified engine actually moves stock', () => {
  test('add: quantity increases with weighted-average price', async () => {
    mockDb = makeDb(baseDb());
    const res = await movementPOST(authedRequest(movement({ type: 'add', quantity: 10, unit_price: 160 })));
    expect(res.status).toBe(201);

    const upd = updatesOf('inventory_items')[0];
    expect(upd.mut.payload.quantity).toBe(20);
    // (10×100 + 10×160) / 20 = 130
    expect(upd.mut.payload.unit_price).toBe(130);
    expect(upd.ops.some((o) => o.col === 'company_id' && o.val === C1)).toBe(true);

    const txn = insertsOf('inventory_transactions')[0].mut.payload;
    expect(txn.company_id).toBe(C1);
    expect(txn.total_value).toBe(1600);
  });

  test('the alias route api/inventory/transactions behaves identically', async () => {
    mockDb = makeDb(baseDb());
    const res = await movementAliasPOST(authedRequest(movement({ type: 'add', quantity: 5, unit_price: 100 })));
    expect(res.status).toBe(201);
    expect(updatesOf('inventory_items')[0].mut.payload.quantity).toBe(15);
  });

  test('issue: overshoot blocked before any write; valid issue posts Dr 5100 / Cr 1170', async () => {
    mockDb = makeDb(baseDb());
    const r1 = await movementPOST(authedRequest(movement({ type: 'issue', quantity: 25 })));
    expect(r1.status).toBe(400);
    expect(insertsOf('journal_entries')).toHaveLength(0);
    expect(updatesOf('inventory_items')).toHaveLength(0);

    mockDb = makeDb(baseDb());
    const r2 = await movementPOST(authedRequest(movement({ type: 'issue', quantity: 4 })));
    expect(r2.status).toBe(201);
    expect(updatesOf('inventory_items')[0].mut.payload.quantity).toBe(6);

    const jl = insertsOf('journal_lines')[0].mut.payload as Row[];
    const sum = (k: 'debit' | 'credit') => jl.reduce((s, l) => s + (l[k] || 0), 0);
    expect(sum('debit')).toBe(400); // 4 × دفتري 100
    expect(sum('credit')).toBe(400);
    expect(jl.find((l) => l.account_code === '5100').debit).toBe(400);
    expect(jl.find((l) => l.account_code === '1170').credit).toBe(400);
    for (const l of jl) expect(l.company_id).toBe(C1);
  });

  test("adjustment ('adjustment' alias): balanced JE — surplus→4200 / deficit→5100", async () => {
    // surplus: 10 → 13 at book price 100 = +300
    mockDb = makeDb(baseDb());
    const rUp = await movementPOST(authedRequest(movement({ type: 'adjustment', quantity: 13 })));
    expect(rUp.status).toBe(201);
    let jl = insertsOf('journal_lines')[0].mut.payload as Row[];
    expect(jl.find((l) => l.account_code === '1170').debit).toBe(300);
    expect(jl.find((l) => l.account_code === '4200').credit).toBe(300);
    expect(updatesOf('inventory_items')[0].mut.payload.quantity).toBe(13);

    // deficit: 10 → 7 → 3 units × book 100 = 300 to costs
    mockDb = makeDb(baseDb());
    const rDown = await movementPOST(authedRequest(movement({ type: 'adjustment', quantity: 7 })));
    expect(rDown.status).toBe(201);
    jl = insertsOf('journal_lines')[0].mut.payload as Row[];
    expect(jl.find((l) => l.account_code === '5100').debit).toBe(300);
    expect(jl.find((l) => l.account_code === '1170').credit).toBe(300);
  });

  test('return: stock back in with Dr 1170 / Cr 5100 reversal of issue cost', async () => {
    mockDb = makeDb(baseDb());
    const res = await movementPOST(authedRequest(movement({ type: 'return', quantity: 2 })));
    expect(res.status).toBe(201);
    expect(updatesOf('inventory_items')[0].mut.payload.quantity).toBe(12);
    const jl = insertsOf('journal_lines')[0].mut.payload as Row[];
    expect(jl.find((l) => l.account_code === '1170').debit).toBe(200);
    expect(jl.find((l) => l.account_code === '5100').credit).toBe(200);
  });

  test('transfer: additive at destination (was REPLACING the balance)', async () => {
    const db = baseDb();
    db.inventory_items.push({
      id: 'tgt-1', company_id: C1, code: 'STEEL', name: 'حديد', unit: 'طن',
      warehouse_id: W2, quantity: '3', unit_price: '90', is_active: true,
    });
    mockDb = makeDb(db);

    const res = await movementPOST(authedRequest(movement({ type: 'transfer', quantity: 4, to_warehouse_id: W2 })));
    expect(res.status).toBe(201);

    // source reduced 10 → 6
    expect(updatesOf('inventory_items').find((c) => c.ops.some((o) => o.val === ITEM))!.mut.payload.quantity).toBe(6);
    // destination MERGED 3 + 4 = 7 — not overwritten to 4
    const tgtUpd = updatesOf('inventory_items').find((c) => c.ops.some((o) => o.val === 'tgt-1'));
    expect(tgtUpd!.mut.payload.quantity).toBe(7);
  });

  test('missing inventory account → loud failure, no stock mutation (was silent unbalanced JE)', async () => {
    const db = baseDb();
    db.accounts = db.accounts.filter((a) => a.code !== '1170');
    mockDb = makeDb(db);
    const res = await movementPOST(authedRequest(movement({ type: 'issue', quantity: 2 })));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.message).toContain('1170');
    expect(updatesOf('inventory_items')).toHaveLength(0);
  });
});

describe('movement history is immutable (quantity/price/type)', () => {
  test('PUT changing quantity → 400 with counter-movement guidance', async () => {
    const db = baseDb();
    db.inventory_transactions.push({ id: 'tx-1', company_id: C1, item_id: ITEM, type: 'add', quantity: 5 });
    mockDb = makeDb(db);
    const res = await movementPUT(authedRequest({ quantity: 99 }, 'PUT'), paramsOf('tx-1'));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.message).toContain('حركة عكسية');
    expect(updatesOf('inventory_transactions')).toHaveLength(0);
  });

  test('PUT notes only → 200 (metadata is fixable)', async () => {
    const db = baseDb();
    db.inventory_transactions.push({ id: 'tx-1', company_id: C1, item_id: ITEM, type: 'add', quantity: 5 });
    mockDb = makeDb(db);
    const res = await movementPUT(authedRequest({ notes: 'تصحيح وصف' }, 'PUT'), paramsOf('tx-1'));
    expect(res.status).toBe(200);
    expect(updatesOf('inventory_transactions')[0].mut.payload.notes).toBe('تصحيح وصف');
  });

  test('DELETE → blocked with reversal guidance (no silent ledger/stock divergence)', async () => {
    const db = baseDb();
    db.inventory_transactions.push({ id: 'tx-1', company_id: C1, item_id: ITEM, type: 'add', quantity: 5 });
    mockDb = makeDb(db);
    const res = await movementDELETE(authedRequest(undefined, 'DELETE'), paramsOf('tx-1'));
    expect(res.status).toBe(400);
    expect(mockDb.calls.filter((c) => c.mut.kind === 'delete' && c.table === 'inventory_transactions')).toHaveLength(0);
  });
});

describe('inventory items — create/edit/delete guards', () => {
  test('item creation on a foreign warehouse → 404', async () => {
    mockDb = makeDb(baseDb());
    const res = await itemPOST(authedRequest({ code: 'CEM', name: 'أسمنت', unit: 'كيس', warehouse_id: FOREIGN_W }));
    expect(res.status).toBe(404);
    expect(insertsOf('inventory_items')).toHaveLength(0);
  });

  test('item PUT: quantity/price are rejected — stock moves via transactions only', async () => {
    mockDb = makeDb(baseDb());
    const res = await itemPUT(authedRequest({ name: 'حديد مسلح', quantity: 999 }, 'PUT'), paramsOf(ITEM));
    expect(res.status).toBe(400);
    expect(updatesOf('inventory_items')).toHaveLength(0);
  });

  test('item PUT: rename works; warehouse move with stock → 400', async () => {
    mockDb = makeDb(baseDb());
    const r1 = await itemPUT(authedRequest({ name: 'حديد مسلح' }, 'PUT'), paramsOf(ITEM));
    expect(r1.status).toBe(200);
    expect(updatesOf('inventory_items')[0].mut.payload.name).toBe('حديد مسلح');

    mockDb = makeDb(baseDb());
    const r2 = await itemPUT(authedRequest({ warehouse_id: W2 }, 'PUT'), paramsOf(ITEM)); // has qty 10
    expect(r2.status).toBe(400);
  });

  test('item DELETE: blocked with stock or history; allowed for pristine drafts', async () => {
    mockDb = makeDb(baseDb());
    const r1 = await itemDELETE(authedRequest(undefined, 'DELETE'), paramsOf(ITEM)); // qty 10
    expect(r1.status).toBe(400);

    const db = baseDb();
    db.inventory_items.push({ id: 'draft-item', company_id: C1, code: 'TMP', name: 'مؤقت', unit: 'وحدة', warehouse_id: W1, quantity: '0', is_active: true });
    mockDb = makeDb(db);
    const r2 = await itemDELETE(authedRequest(undefined, 'DELETE'), paramsOf('draft-item'));
    expect(r2.status).toBe(200);
  });
});

describe('single stock writer — purchase invoice no longer bumps stock', () => {
  test('invoice with PO: JE posts, inventory untouched (receipt is the stock writer)', async () => {
    mockDb = makeDb(baseDb());
    const res = await purchaseInvoicePOST(authedRequest({
      date: '2026-08-01',
      supplier_id: SUPPLIER,
      purchase_order_id: PO,
      items: [{ description: 'STEEL', quantity: 2, unit_price: 100 }],
      tax_rate: 0,
    }));
    expect(res.status).toBe(201);
    // no inventory_items updates from the invoice anymore (was the double-entry bug)
    expect(updatesOf('inventory_items')).toHaveLength(0);
    expect(insertsOf('inventory_transactions')).toHaveLength(0);
    // but the financial JE still posted
    expect(insertsOf('journal_entries')).toHaveLength(1);
  });
});
