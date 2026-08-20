/** Route boundaries for the atomic inventory and warehouse lifecycle.
 * Concurrency, ledger balance, rollback, weighted cost, and transfers run in
 * scripts/test-migrations.mjs against the real PostgreSQL functions.
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';

import { createToken } from '@/lib/auth';
type Row = Record<string, any>;
type Op = { op: string; col?: string; val?: any };

function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Op[] }> = [];
  const rpcCalls: Array<{ name: string; params: any }> = [];
  const from = (table: string) => {
    const ops: Op[] = []; calls.push({ table, ops });
    const rows = () => (db[table] || []).filter((row) => ops.every((op) => {
      if (op.op === 'eq') return row[op.col!] === op.val;
      if (op.op === 'in') return op.val.includes(row[op.col!]);
      if (op.op === 'is') return op.val === null ? row[op.col!] == null : row[op.col!] === op.val;
      if (op.op === 'gte') return String(row[op.col!]) >= String(op.val);
      return true;
    }));
    const api: any = {
      select: () => api,
      eq: (col: string, val: any) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: any[]) => { ops.push({ op: 'in', col, val }); return api; },
      is: (col: string, val: any) => { ops.push({ op: 'is', col, val }); return api; },
      gte: (col: string, val: any) => { ops.push({ op: 'gte', col, val }); return api; },
      neq: () => api, or: () => api, order: () => api, range: () => api, limit: () => api,
      maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
      single: async () => ({ data: rows()[0] || null, error: rows()[0] ? null : { message: 'not found' } }),
      then: (ok: any, fail: any) => Promise.resolve({ data: rows(), error: null, count: rows().length }).then(ok, fail),
    };
    return api;
  };
  const instance = { from, calls, rpcCalls } as {
    from: (table: string) => any;
    calls: typeof calls;
    rpcCalls: Array<{ name: string; params: any }>;
    [key: string]: any;
  };
  instance.rpc = async (name: string, params: any) => {
    rpcCalls.push({ name, params });
    if (name === 'post_inventory_movement_atomic') {
      const item = (db.inventory_items || []).find((row) => row.id === params.p_item_id && row.company_id === params.p_company_id);
      if (!item) return { data: null, error: { message: 'الصنف غير موجود' } };
      if (item.warehouse_id !== params.p_warehouse_id) return { data: null, error: { message: 'الصنف لا ينتمي إلى مستودع المصدر' } };
      if (params.p_type === 'issue' && Number(item.quantity) < params.p_quantity) {
        return { data: null, error: { message: 'الكمية غير متوفرة في المخزون' } };
      }
      return { data: { transaction: { id: TX, company_id: params.p_company_id, ...params } }, error: null };
    }
    if (name === 'update_inventory_transaction_note_atomic') {
      const row = (db.inventory_transactions || []).find((txn) => txn.id === params.p_transaction_id && txn.company_id === params.p_company_id);
      return row ? { data: { ...row, notes: params.p_notes }, error: null }
        : { data: null, error: { message: 'الحركة غير موجودة' } };
    }
    if (name === 'create_inventory_item_atomic') {
      const warehouse = (db.warehouses || []).find((row) => row.id === params.p_warehouse_id && row.company_id === params.p_company_id);
      return warehouse ? { data: { id: NEW_ITEM, company_id: params.p_company_id }, error: null }
        : { data: null, error: { message: 'المستودع غير موجود' } };
    }
    if (name === 'update_inventory_item_atomic') {
      const item = (db.inventory_items || []).find((row) => row.id === params.p_item_id && row.company_id === params.p_company_id);
      if (!item) return { data: null, error: { message: 'الصنف غير موجود' } };
      if ((params.p_patch.warehouse_id || params.p_patch.is_active === false) && Number(item.quantity) !== 0) {
        return { data: null, error: { message: params.p_patch.is_active === false ? 'لا يمكن تعطيل صنف عليه رصيد' : 'لا يمكن نقل صنف عليه رصيد دون حركة تحويل' } };
      }
      return { data: { ...item, ...params.p_patch }, error: null };
    }
    if (name === 'create_purchase_invoice_atomic') return { data: { id: PI }, error: null };
    return { data: null, error: { message: `missing ${name}` } };
  };
  return instance;
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
const NEW_ITEM = '00000000-0000-4000-8000-00000000bb02';
const TX = '00000000-0000-4000-8000-00000000cc01';
const FOREIGN_TX = '00000000-0000-4000-8000-00000000cc09';
const SUPPLIER = '00000000-0000-4000-8000-000000000501';
const PO = '00000000-0000-4000-8000-000000000c01';
const PI = '00000000-0000-4000-8000-000000000d01';

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, is_active: true, role: 'admin', token_version: 0 }],
    companies: [{ id: C1, is_active: true }],
    warehouses: [
      { id: W1, company_id: C1, name: 'الرئيسي', is_active: true },
      { id: W2, company_id: C1, name: 'الفرع', is_active: true },
      { id: FOREIGN_W, company_id: C2, name: 'أجنبي', is_active: true },
    ],
    inventory_items: [
      { id: ITEM, company_id: C1, code: 'STEEL', warehouse_id: W1, quantity: 10, unit_price: 100, is_active: true },
      { id: FOREIGN_ITEM, company_id: C2, code: 'X', warehouse_id: FOREIGN_W, quantity: 5, is_active: true },
    ],
    inventory_transactions: [{ id: TX, company_id: C1, item_id: ITEM, type: 'add' },
      { id: FOREIGN_TX, company_id: C2, item_id: FOREIGN_ITEM, type: 'add' }],
    purchase_invoice_items: [],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01',
      subscription_plans: { features_modules: { inventory: true, purchases: true, warehouses: true } } }],
  } as Record<string, Row[]>;
}

function request(body?: any, method = 'POST') {
  const token = createToken('u1', 'admin');
  return { url: 'http://localhost/api/test', method,
    headers: { get: (key: string) => key === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined }, json: async () => body } as any;
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const movement = (patch: any = {}) => ({
  item_id: ITEM, warehouse_id: W1, type: 'add', quantity: 5,
  unit_price: 120, date: '2026-08-01', ...patch,
});

beforeEach(() => { mockDb = makeDb(baseDb()); });

describe('atomic inventory movement boundary', () => {
  test('delegates all effects to one trusted tenant/user-bound RPC', async () => {
    const response = await movementPOST(request(movement()));
    expect(response.status).toBe(201);
    expect(mockDb.rpcCalls[0]).toEqual({ name: 'post_inventory_movement_atomic', params: {
      p_company_id: C1, p_item_id: ITEM, p_warehouse_id: W1, p_type: 'add', p_quantity: 5,
      p_unit_price: 120, p_date: '2026-08-01', p_notes: '', p_to_warehouse_id: null, p_user_id: 'u1',
      p_project_id: null,
    } });
    expect(mockDb.calls.some((call) => ['journal_entries', 'inventory_items', 'inventory_transactions'].includes(call.table))).toBe(false);
  });

  test('compatibility route delegates to the same RPC', async () => {
    expect((await movementAliasPOST(request(movement({ type: 'transfer', to_warehouse_id: W2 })))).status).toBe(201);
    expect(mockDb.rpcCalls[0].name).toBe('post_inventory_movement_atomic');
    expect(mockDb.rpcCalls[0].params.p_to_warehouse_id).toBe(W2);
  });

  test('foreign item is hidden and mismatched warehouse cannot mutate it', async () => {
    expect((await movementPOST(request(movement({ item_id: FOREIGN_ITEM, warehouse_id: FOREIGN_W })))).status).toBe(404);
    mockDb = makeDb(baseDb());
    expect((await movementPOST(request(movement({ warehouse_id: FOREIGN_W })))).status).toBe(400);
  });

  test('invalid amount and transfer destination fail before the RPC', async () => {
    expect((await movementPOST(request(movement({ quantity: -1 })))).status).toBe(400);
    expect((await movementPOST(request(movement({ type: 'transfer', to_warehouse_id: W1 })))).status).toBe(400);
    expect(mockDb.rpcCalls).toHaveLength(0);
  });

  test('insufficient stock is a safe conflict with no application writes', async () => {
    const response = await movementPOST(request(movement({ type: 'issue', quantity: 99 })));
    expect(response.status).toBe(400);
    expect(mockDb.calls.some((call) => ['journal_entries', 'inventory_items', 'inventory_transactions'].includes(call.table))).toBe(false);
  });

  test('a project allocation is passed through to the movement RPC', async () => {
    const PROJECT = '00000000-0000-4000-8000-00000000ab01';
    const response = await movementPOST(request(movement({ type: 'issue', project_id: PROJECT })));
    expect(response.status).toBe(201);
    expect(mockDb.rpcCalls[0].name).toBe('post_inventory_movement_atomic');
    expect(mockDb.rpcCalls[0].params.p_project_id).toBe(PROJECT);
  });

  test('an invalid project id is rejected before the RPC', async () => {
    const response = await movementPOST(request(movement({ project_id: 'not-a-uuid' })));
    expect(response.status).toBe(400);
    expect(mockDb.rpcCalls).toHaveLength(0);
  });
});

describe('immutable movement history', () => {
  test('financial edits are rejected while note correction is audited by RPC', async () => {
    const rejected = await movementPUT(request({ quantity: 99 }, 'PUT'), params(TX));
    expect(rejected.status).toBe(400);
    expect((await rejected.json()).message).toContain('حركة عكسية');
    expect(mockDb.rpcCalls).toHaveLength(0);

    const updated = await movementPUT(request({ notes: 'تصحيح' }, 'PUT'), params(TX));
    expect(updated.status).toBe(200);
    expect(mockDb.rpcCalls[0]).toMatchObject({ name: 'update_inventory_transaction_note_atomic',
      params: { p_company_id: C1, p_transaction_id: TX, p_user_id: 'u1' } });
  });

  test('DELETE is blocked and a foreign movement remains a 404', async () => {
    expect((await movementDELETE(request(undefined, 'DELETE'), params(TX))).status).toBe(409);
    expect((await movementDELETE(request(undefined, 'DELETE'), params(FOREIGN_TX))).status).toBe(404);
  });
});

describe('atomic inventory item lifecycle', () => {
  test('creation uses RPC and rejects a foreign warehouse', async () => {
    const body = { code: 'CEM', name: 'أسمنت', unit: 'كيس', warehouse_id: W1 };
    expect((await itemPOST(request(body))).status).toBe(201);
    expect(mockDb.rpcCalls[0].name).toBe('create_inventory_item_atomic');
    mockDb = makeDb(baseDb());
    expect((await itemPOST(request({ ...body, warehouse_id: FOREIGN_W }))).status).toBe(404);
  });

  test('quantity/price/code cannot be changed and metadata uses RPC', async () => {
    expect((await itemPUT(request({ quantity: 1 }, 'PUT'), params(ITEM))).status).toBe(400);
    expect((await itemPUT(request({ name: 'حديد مسلح' }, 'PUT'), params(ITEM))).status).toBe(200);
    expect(mockDb.rpcCalls[0].name).toBe('update_inventory_item_atomic');
  });

  test('DELETE soft-deactivates only a zero-balance item', async () => {
    expect((await itemDELETE(request(undefined, 'DELETE'), params(ITEM))).status).toBe(409);
    const db = baseDb();
    db.inventory_items.push({ id: NEW_ITEM, company_id: C1, code: 'TMP', warehouse_id: W1, quantity: 0, is_active: true });
    mockDb = makeDb(db);
    expect((await itemDELETE(request(undefined, 'DELETE'), params(NEW_ITEM))).status).toBe(200);
    expect(mockDb.rpcCalls[0]).toMatchObject({ name: 'update_inventory_item_atomic', params: { p_patch: { is_active: false } } });
  });
});

test('purchase invoices never mutate inventory outside their atomic accounting RPC', async () => {
  const response = await purchaseInvoicePOST(request({
    date: '2026-08-01', supplier_id: SUPPLIER, purchase_order_id: PO,
    items: [{ description: 'STEEL', quantity: 2, unit_price: 100 }], tax_rate: 0,
  }));
  expect(response.status).toBe(201);
  expect(mockDb.rpcCalls[0].name).toBe('create_purchase_invoice_atomic');
  expect(mockDb.calls.some((call) => call.table === 'inventory_items')).toBe(false);
});
