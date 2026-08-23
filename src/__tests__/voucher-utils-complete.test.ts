let rows: Record<string, any[]> = {};
import { wrapSupabase } from './mocks';
const rpc = jest.fn();
let failUpdateTable: string | null = null;
let failInsertTable: string | null = null;
let nullTables = new Set<string>();

function query(table: string) {
  const filters: Array<[string, string, any]> = [];
  let mode = 'select'; let payload: any;
  const matches = () => (rows[table] || []).filter((row) => filters.every(([op, col, value]) => op === 'eq' ? row[col] === value : op === 'neq' ? row[col] !== value : op === 'in' ? value.includes(row[col]) : true));
  const api: any = {
    select: () => api,
    eq: (col: string, val: any) => { filters.push(['eq', col, val]); return api; },
    neq: (col: string, val: any) => { filters.push(['neq', col, val]); return api; },
    in: (col: string, val: any[]) => { filters.push(['in', col, val]); return api; },
    order: () => api,
    insert: (value: any) => { mode = 'insert'; payload = value; return api; },
    update: (value: any) => { mode = 'update'; payload = value; return api; },
    delete: () => { mode = 'delete'; return api; },
    maybeSingle: async () => {
      if (mode === 'update') {
        if (failUpdateTable === table) return { data: null, error: new Error('update') };
        const target = matches()[0]; if (target) Object.assign(target, payload);
        return { data: target ? { id: target.id } : null, error: null };
      }
      return { data: matches()[0] || null, error: null };
    },
    then: (resolve: any, reject: any) => {
      let error: Error | null = null;
      if (mode === 'insert' && failInsertTable === table) error = new Error('insert');
      else if (mode === 'insert') rows[table] = [...(rows[table] || []), payload];
      if (mode === 'update') for (const target of matches()) Object.assign(target, payload);
      if (mode === 'delete') rows[table] = (rows[table] || []).filter((r) => !matches().includes(r));
      return Promise.resolve({ data: nullTables.has(table) ? null : matches(), error }).then(resolve, reject);
    },
  };
  return api;
}
const db = { from: jest.fn((table: string) => query(table)), rpc };
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => db }));

import {
  hydratePartyNames, resolveAccountId, postReversalEntry, applyInvoiceAllocations,
  revertInvoiceAllocations, allocateOldestUnpaidInvoices,
} from '@/lib/voucher-utils';

beforeEach(() => { rows = {}; failUpdateTable = null; failInsertTable = null; nullTables = new Set(); jest.clearAllMocks(); });

describe('voucher helper functions', () => {
  test('hydrates unique contact and employee names while preserving embedded names', async () => {
    rows.contacts = [{ id: 'c1', company_id: 'co', name: 'Client' }];
    rows.employees = [{ id: 'e1', company_id: 'co', name: 'Employee' }];
    const input = [
      { contact_id: 'c1', employee_id: 'e1' },
      { contact_id: 'c1', contacts: { name: 'Embedded' }, employee_id: null },
    ];
    const result = await hydratePartyNames(db, 'co', input, { contacts: true, employees: true });
    expect(result[0]).toMatchObject({ contact_name: 'Client', employee_name: 'Employee' });
    expect(result[1].contact_name).toBe('Embedded');
    await expect(hydratePartyNames(db, 'co', [], { contacts: true })).resolves.toEqual([]);
  });

  test('handles default/no-id hydration options and missing lookup names', async () => {
    const plain = [{ contact_id: null, employee_id: null }];
    await expect(hydratePartyNames(db, 'co', plain)).resolves.toBe(plain);
    await expect(hydratePartyNames(db, 'co', plain, { contacts: true, employees: true })).resolves.toBe(plain);
    rows.contacts = [];
    rows.employees = [];
    const missing = [{ contact_id: 'x', employee_id: 'y' }];
    await hydratePartyNames(db, 'co', missing, { contacts: true, employees: true });
    expect(missing[0]).toMatchObject({ contact_name: '', employee_name: '' });
    const fallbackRows = [{ contact_id: 'c1', contacts: { name: '' }, employee_id: 'e1', employees: { name: '' } }, { contact_id: null, employee_id: null }];
    rows.contacts = [{ id: 'c1', company_id: 'co', name: 'Mapped Client' }];
    rows.employees = [{ id: 'e1', company_id: 'co', name: 'Mapped Employee' }];
    await hydratePartyNames(db, 'co', fallbackRows, { contacts: true, employees: true });
    expect(fallbackRows[0]).toMatchObject({ contact_name: 'Mapped Client', employee_name: 'Mapped Employee' });
    const nullDataDb = wrapSupabase({ from: () => { const api: any = { select: () => api, eq: () => api, in: async () => ({ data: null }) }; return api; } });
    await expect(hydratePartyNames(nullDataDb, 'co', [{ contact_id: 'x' }], { contacts: true })).resolves.toBeTruthy();
    await expect(hydratePartyNames(nullDataDb, 'co', [{ employee_id: 'x' }], { employees: true })).resolves.toBeTruthy();
  });

  test('resolves account codes and posts reversal RPC outcomes', async () => {
    rows.accounts = [{ id: 'a1', company_id: 'co', code: '1130' }];
    await expect(resolveAccountId('co', '1130')).resolves.toBe('a1');
    await expect(resolveAccountId('co', 'none')).resolves.toBeNull();
    rpc.mockResolvedValueOnce({ data: { id: 'r1' }, error: null });
    await expect(postReversalEntry('co', { journalEntryId: 'j', referenceType: 'x', referenceId: 'r', description: 'reverse', userId: 'u' })).resolves.toEqual({ error: null });
    rpc.mockResolvedValueOnce({ data: null, error: null });
    const failed = await postReversalEntry('co', { journalEntryId: 'j', referenceType: 'x', referenceId: 'r', description: 'reverse', userId: 'u' });
    expect(failed.error).toBeInstanceOf(Error);
  });

  test('validates allocation amount, duplicates and voucher ceiling', async () => {
    await expect(applyInvoiceAllocations('co', 'receipt', 'v', null, 0, [], 'c')).resolves.toMatchObject({ error: expect.stringContaining('غير صالحة'), applied: 0 });
    await expect(applyInvoiceAllocations('co', 'receipt', 'v', null, 100, [{ invoice_id: 'i', amount: 1 }, { invoice_id: 'i', amount: 2 }], 'c')).resolves.toMatchObject({ error: expect.stringContaining('أكثر من مرة') });
    await expect(applyInvoiceAllocations('co', 'receipt', 'v', null, 10, [{ invoice_id: 'i', amount: 11 }], 'c')).resolves.toMatchObject({ error: expect.stringContaining('أكبر') });
  });

  test('allocates receipts and disbursements with partial/full statuses and links', async () => {
    rows.invoices = [
      { id: 'i1', company_id: 'co', contact_id: 'c1', total: '100', paid_amount: '20', status: 'partial' },
      { id: 'i2', company_id: 'co', contact_id: 'c1', total: '50', paid_amount: '0', status: 'unpaid' },
    ];
    const result = await applyInvoiceAllocations('co', 'receipt', 'v1', 'j1', 100, [
      { invoice_id: 'i1', amount: 80 }, { invoice_id: 'i2', amount: 20 },
    ], 'c1');
    expect(result).toEqual({ error: null, applied: 100 });
    expect(rows.invoices[0]).toMatchObject({ paid_amount: 100, status: 'paid' });
    expect(rows.invoices[1]).toMatchObject({ paid_amount: 20, status: 'partial' });
    expect(rows.receipt_invoice_items).toHaveLength(2);

    rows.purchase_invoices = [{ id: 'p1', company_id: 'co', supplier_id: 's1', total: 10, paid_amount: 0, status: 'unpaid' }];
    await expect(applyInvoiceAllocations('co', 'disbursement', 'd1', null, 10, [{ invoice_id: 'p1', amount: 10 }], 's1')).resolves.toEqual({ error: null, applied: 10 });
    expect(rows.disbursement_invoice_items[0]).toMatchObject({ voucher_disbursement_id: 'd1', purchase_invoice_id: 'p1' });
  });

  test('reports update/link persistence failures and caps allocation at remaining balance', async () => {
    rows.invoices = [{ id: 'i', company_id: 'co', contact_id: null, total: 10, paid_amount: null, status: 'unpaid' }];
    failUpdateTable = 'invoices';
    await expect(applyInvoiceAllocations('co', 'receipt', 'v', null, 20, [{ invoice_id: 'i', amount: 20 }], null)).resolves.toMatchObject({ error: expect.stringContaining('تحديث') });
    failUpdateTable = null; failInsertTable = 'receipt_invoice_items';
    await expect(applyInvoiceAllocations('co', 'receipt', 'v', null, 20, [{ invoice_id: 'i', amount: 20 }], null)).resolves.toMatchObject({ error: expect.stringContaining('ربط') });
    failInsertTable = null;
    rows.invoices[0] = { id: 'i', company_id: 'co', contact_id: null, total: 10, paid_amount: null, status: 'unpaid' };
    await expect(applyInvoiceAllocations('co', 'receipt', 'v', null, 20, [{ invoice_id: 'i', amount: 20 }], null)).resolves.toEqual({ error: null, applied: 10 });
  });

  test('rejects missing/cancelled/foreign/paid/zero-total invoices', async () => {
    await expect(applyInvoiceAllocations('co', 'receipt', 'v', null, 10, [{ invoice_id: 'x', amount: 10 }], 'c')).resolves.toMatchObject({ error: expect.stringContaining('غير موجودة') });
    rows.invoices = [{ id: 'x', company_id: 'co', contact_id: 'c', total: 10, paid_amount: 0, status: 'cancelled' }];
    await expect(applyInvoiceAllocations('co', 'receipt', 'v', null, 10, [{ invoice_id: 'x', amount: 10 }], 'c')).resolves.toMatchObject({ error: expect.stringContaining('ملغاة') });
    rows.invoices[0] = { ...rows.invoices[0], status: 'unpaid', contact_id: 'other' };
    await expect(applyInvoiceAllocations('co', 'receipt', 'v', null, 10, [{ invoice_id: 'x', amount: 10 }], 'c')).resolves.toMatchObject({ error: expect.stringContaining('نفس الطرف') });
    rows.invoices[0] = { ...rows.invoices[0], contact_id: 'c', paid_amount: 10 };
    await expect(applyInvoiceAllocations('co', 'receipt', 'v', null, 10, [{ invoice_id: 'x', amount: 10 }], 'c')).resolves.toMatchObject({ error: expect.stringContaining('بالكامل') });
    rows.invoices[0] = { id: 'x', company_id: 'co', contact_id: 'c', total: undefined, paid_amount: undefined, status: 'unpaid' };
    await expect(applyInvoiceAllocations('co', 'receipt', 'v', null, 10, [{ invoice_id: 'x', amount: 10 }], 'c')).resolves.toMatchObject({ error: expect.stringContaining('بالكامل') });
  });

  test('handles null allocation/FIFO query pages', async () => {
    nullTables.add('receipt_invoice_items');
    await expect(revertInvoiceAllocations('co', 'receipt', 'v')).resolves.toBeUndefined();
    nullTables = new Set(['invoices']);
    await expect(allocateOldestUnpaidInvoices('co', 'v', null, 10, 'c')).resolves.toEqual({ error: null, applied: 0 });
  });

  test('reverts links and recalculates unpaid/partial status while skipping cancelled', async () => {
    rows.invoices = [
      { id: 'i1', company_id: 'co', total: 100, paid_amount: 40, status: 'partial' },
      { id: 'i2', company_id: 'co', total: 50, paid_amount: 50, status: 'cancelled' },
    ];
    rows.receipt_invoice_items = [
      { id: 'l1', voucher_receipt_id: 'v1', invoice_id: 'i1', amount: 40 },
      { id: 'l2', voucher_receipt_id: 'v1', invoice_id: 'i2', amount: 50 },
    ];
    await revertInvoiceAllocations('co', 'receipt', 'v1');
    expect(rows.invoices[0]).toMatchObject({ paid_amount: 0, status: 'unpaid' });
    expect(rows.invoices[1].status).toBe('cancelled');
    expect(rows.receipt_invoice_items).toEqual([]);
  });

  test('reverts disbursement links with partial remaining status and missing invoices', async () => {
    rows.purchase_invoices = [
      { id: 'p1', company_id: 'co', total: 100, paid_amount: 80, status: 'paid' },
      { id: 'p2', company_id: 'co', total: 50, paid_amount: 50, status: 'paid' },
      { id: 'p3', company_id: 'co', total: undefined, paid_amount: undefined, status: 'unpaid' },
    ];
    rows.disbursement_invoice_items = [
      { voucher_disbursement_id: 'd1', purchase_invoice_id: 'missing', amount: 1 },
      { voucher_disbursement_id: 'd1', purchase_invoice_id: 'p1', amount: 30 },
      { voucher_disbursement_id: 'd1', purchase_invoice_id: 'p2', amount: 'bad' },
      { voucher_disbursement_id: 'd1', purchase_invoice_id: 'p3', amount: undefined },
    ];
    await revertInvoiceAllocations('co', 'disbursement', 'd1');
    expect(rows.purchase_invoices[0]).toMatchObject({ paid_amount: 50, status: 'partial' });
    expect(rows.purchase_invoices[1]).toMatchObject({ paid_amount: 50, status: 'paid' });
    expect(rows.purchase_invoices[2]).toMatchObject({ paid_amount: 0, status: 'unpaid' });
    expect(rows.disbursement_invoice_items).toEqual([]);
  });

  test('builds FIFO allocations, skips fully due rows and handles no invoices', async () => {
    rows.invoices = [
      { id: 'malformed', company_id: 'co', contact_id: 'c', status: 'unpaid', date: '2025-12-31', number: 0, total: undefined, paid_amount: undefined },
      { id: 'paidmath', company_id: 'co', contact_id: 'c', status: 'unpaid', date: '2026-01-01', number: 1, total: 10, paid_amount: 10 },
      { id: 'i1', company_id: 'co', contact_id: 'c', status: 'unpaid', date: '2026-01-02', number: 2, total: 30, paid_amount: 0 },
      { id: 'i2', company_id: 'co', contact_id: 'c', status: 'partial', date: '2026-01-03', number: 3, total: 50, paid_amount: 10 },
    ];
    const result = await allocateOldestUnpaidInvoices('co', 'v', null, 50, 'c');
    expect(result).toEqual({ error: null, applied: 50 });
    expect(rows.invoices.find((r) => r.id === 'i1')).toMatchObject({ status: 'paid' });
    await expect(allocateOldestUnpaidInvoices('co', 'v', null, 0, 'c')).resolves.toEqual({ error: null, applied: 0 });
    rows.invoices = [];
    await expect(allocateOldestUnpaidInvoices('co', 'v', null, 10, 'c')).resolves.toEqual({ error: null, applied: 0 });
  });
});
