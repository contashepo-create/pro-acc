/** Unit tests for approval, automatic-account and sales-journal helpers. */

const requireApproval = jest.fn();
const createJournalEntry = jest.fn();
const insertJournalHeader = jest.fn();
const insertJournalLines = jest.fn();
const createDefaultChartOfAccounts = jest.fn();

let tableRows: Record<string, Row[]> = {};
type Row = Record<string, unknown>;
let tableErrors: Record<string, Error> = {};
let insertErrors: Record<string, Error> = {};
const operations: Array<{ table: string; operation: string; payload?: Row; filters: Array<[string, string, unknown]> }> = [];

function makeQuery(table: string) {
  const filters: Array<[string, string, unknown]> = [];
  let operation = 'select';
  let payload: Row | undefined;
  const matching = () => (tableRows[table] || []).filter((row) => filters.every(([kind, col, value]) =>
    kind !== 'eq' || row[col] === value));
  const api: TestBuilder = {
    select: () => api,
    eq: (col: string, value: unknown) => { filters.push(['eq', col, value]); return api; },
    order: () => api,
    limit: () => api,
    insert: (value: Row) => { operation = 'insert'; payload = value; return api; },
    update: (value: Row) => { operation = 'update'; payload = value; return api; },
    delete: () => { operation = 'delete'; return api; },
    maybeSingle: async () => {
      operations.push({ table, operation, payload, filters: [...filters] });
      if (operation === 'insert') {
        const row = { id: 'new-account', ...(payload ?? {}) };
        tableRows[table] = [...(tableRows[table] || []), row];
        return { data: row, error: null };
      }
      return { data: matching()[0] || null, error: tableErrors[table] || null };
    },
    single: async () => {
      operations.push({ table, operation, payload, filters: [...filters] });
      if (operation === 'insert') {
        if (insertErrors[table]) return { data: null, error: insertErrors[table] };
        const row = { id: 'new-account', ...payload };
        tableRows[table] = [...(tableRows[table] || []), row];
        return { data: row, error: null };
      }
      return { data: matching()[0] || null, error: null };
    },
    then: <T1 = { data: unknown; error: unknown }, T2 = never>(
      resolve?: ((v: { data: unknown; error: unknown }) => T1 | PromiseLike<T1>) | null,
      reject?: ((e: unknown) => T2 | PromiseLike<T2>) | null,
    ) => {
      operations.push({ table, operation, payload, filters: [...filters] });
      if (operation === 'delete') tableRows[table] = (tableRows[table] || []).filter((row) => !matching().includes(row));
      return Promise.resolve({ data: matching(), error: null }).then(resolve ?? undefined, reject ?? undefined);
    },
  };
  return api;
}

import type { TestBuilder } from './mocks';
const db = { from: jest.fn((table: string) => makeQuery(table)) };

jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => db }));
jest.mock('@/lib/notifications', () => ({ requireApproval }));
jest.mock('@/lib/journal-utils', () => ({ createJournalEntry, insertJournalHeader, insertJournalLines }));
jest.mock('@/lib/default-accounts', () => ({ createDefaultChartOfAccounts }));

import {
  checkTransactionBeforeSave, createJournalEntryForApprovedTransaction,
  getTransactionApprovalStatus,
} from '@/lib/approval-helpers';
import { createAutoAccount } from '@/lib/auto-account';
import { resolveSalesAccounts, postSalesInvoiceJournal } from '@/lib/invoice-accounting';

beforeEach(() => {
  jest.clearAllMocks();
  operations.length = 0;
  tableRows = {};
  tableErrors = {};
  insertErrors = {};
});

describe('approval helpers', () => {
  test('delegates the complete approval context and normalizes the result', async () => {
    requireApproval.mockResolvedValueOnce({ blocked: true, message: 'pending', requiresApproval: true, ignored: 1 });
    await expect(checkTransactionBeforeSave('c1', 'u1', 500, 'voucher', 'v1', 'desc'))
      .resolves.toEqual({ blocked: true, message: 'pending', requiresApproval: true });
    expect(requireApproval).toHaveBeenCalledWith('c1', 500, 'voucher', 'u1', 'v1', 'desc');
  });

  test('fails closed when legacy application-side posting is attempted', async () => {
    await expect(createJournalEntryForApprovedTransaction()).rejects.toThrow('atomic approval RPC');
  });

  test('surfaces approval and transaction lookup errors', async () => {
    tableErrors.approval_requests = new Error('approval');
    await expect(getTransactionApprovalStatus('c1', 'voucher_receipt', 'v1')).rejects.toThrow('approval');
    tableErrors = { voucher_receipts: new Error('voucher') };
    await expect(getTransactionApprovalStatus('c1', 'voucher_receipt', 'v1')).rejects.toThrow('voucher');
  });

  test('prefers the newest approval request, then falls back to transaction status', async () => {
    tableRows.approval_requests = [{ id: 'a1', company_id: 'c1', transaction_type: 'voucher_receipt', transaction_id: 'v1', status: 'pending' }];
    await expect(getTransactionApprovalStatus('c1', 'voucher_receipt', 'v1'))
      .resolves.toEqual({ status: 'pending', approvalId: 'a1' });

    tableRows.approval_requests = [{ id: null, company_id: 'c1', transaction_type: 'voucher_receipt', transaction_id: 'v1', status: 'pending' }];
    await expect(getTransactionApprovalStatus('c1', 'voucher_receipt', 'v1'))
      .resolves.toEqual({ status: 'pending', approvalId: null });

    tableRows.approval_requests = [];
    tableRows.voucher_receipts = [{ id: 'v1', company_id: 'c1', status: 'approved' }];
    await expect(getTransactionApprovalStatus('c1', 'voucher_receipt', 'v1'))
      .resolves.toEqual({ status: 'approved', approvalId: null });
    await expect(getTransactionApprovalStatus('c1', 'unknown', 'x'))
      .resolves.toEqual({ status: 'not_required', approvalId: null });
    tableRows.voucher_receipts = [];
    await expect(getTransactionApprovalStatus('c1', 'voucher_receipt', 'missing'))
      .resolves.toEqual({ status: 'not_found', approvalId: null });
  });
});

describe('createAutoAccount', () => {
  const base = { companyId: 'c1', code: '1131', name: 'Customer A', type: 'asset' as const, parentCode: '1130' };

  test('rejects invalid precision or missing parent without writing', async () => {
    await expect(createAutoAccount({ ...base, openingBalance: 1.001 })).resolves.toBeNull();
    await expect(createAutoAccount(base)).resolves.toBeNull();
  });

  test('returns null when database access throws or account insertion fails', async () => {
    db.from.mockImplementationOnce(() => { throw new Error('db'); });
    await expect(createAutoAccount(base)).resolves.toBeNull();
    tableRows.accounts = [{ id: 'parent', company_id: 'c1', code: '1130' }];
    insertErrors.accounts = new Error('insert');
    await expect(createAutoAccount(base)).resolves.toBeNull();
  });

  test('creates a child account without a journal for zero opening balance', async () => {
    tableRows.accounts = [{ id: 'parent', company_id: 'c1', code: '1130' }];
    await expect(createAutoAccount(base)).resolves.toMatchObject({ id: 'new-account', code: '1131', name: 'Customer A' });
    expect(createJournalEntry).not.toHaveBeenCalled();
  });

  test('posts positive and negative opening balances and returns journal id', async () => {
    tableRows.accounts = [
      { id: 'parent', company_id: 'c1', code: '1130' },
      { id: 'capital', company_id: 'c1', code: '3100' },
    ];
    createJournalEntry.mockResolvedValue({ journalId: 'j1' });
    await expect(createAutoAccount({ ...base, openingBalance: 100, createdBy: 'u1' }))
      .resolves.toMatchObject({ journalId: 'j1' });
    expect(createJournalEntry.mock.calls[0][1].lines).toEqual([
      { account_id: 'new-account', debit: 100, credit: 0 },
      { account_id: 'capital', debit: 0, credit: 100 },
    ]);

    // Use a different code so the in-memory insert remains unambiguous.
    await createAutoAccount({ ...base, code: '1132', openingBalance: -50, createdBy: 'u1' });
    expect(createJournalEntry.mock.calls[1][1].lines[0]).toMatchObject({ debit: 0, credit: 50 });
  });

  test('rolls back the account when actor/capital/journal is missing', async () => {
    tableRows.accounts = [{ id: 'parent', company_id: 'c1', code: '1130' }];
    await expect(createAutoAccount({ ...base, openingBalance: 10 })).resolves.toBeNull();
    expect(operations.some((op) => op.table === 'accounts' && op.operation === 'delete')).toBe(true);

    tableRows.accounts = [{ id: 'parent', company_id: 'c1', code: '1130' }];
    await expect(createAutoAccount({ ...base, openingBalance: 10, createdBy: 'u1' })).resolves.toBeNull();

    tableRows.accounts = [{ id: 'parent', company_id: 'c1', code: '1130' }, { id: 'capital', company_id: 'c1', code: '3100' }];
    createJournalEntry.mockResolvedValueOnce({ error: new Error('journal failed') });
    await expect(createAutoAccount({ ...base, openingBalance: 10, createdBy: 'u1' })).resolves.toBeNull();
  });
});

describe('sales invoice accounting helpers', () => {
  test('resolves existing control accounts', async () => {
    tableRows.accounts = [
      { id: 'ar', company_id: 'c1', code: '1130' }, { id: 'rev', company_id: 'c1', code: '4100' },
      { id: 'vat', company_id: 'c1', code: '2120' },
    ];
    await expect(resolveSalesAccounts('c1')).resolves.toEqual({ arId: 'ar', revenueId: 'rev', vatId: 'vat' });
    expect(createDefaultChartOfAccounts).not.toHaveBeenCalled();
  });

  test('bootstraps missing accounts and rejects an incomplete chart', async () => {
    createDefaultChartOfAccounts.mockImplementationOnce(async () => {
      tableRows.accounts = [{ id: 'ar', company_id: 'c1', code: '1130' }, { id: 'rev', company_id: 'c1', code: '4100' }];
    });
    await expect(resolveSalesAccounts('c1')).resolves.toEqual({ arId: 'ar', revenueId: 'rev', vatId: null });
    tableRows.accounts = [];
    createDefaultChartOfAccounts.mockResolvedValueOnce(undefined);
    await expect(resolveSalesAccounts('c1')).rejects.toThrow('حسابات الذمم أو الإيراد مفقودة');
  });

  test('posts balanced invoice lines, optional VAT and links the journal', async () => {
    tableRows.accounts = [
      { id: 'ar', company_id: 'c1', code: '1130' }, { id: 'rev', company_id: 'c1', code: '4100' },
      { id: 'vat', company_id: 'c1', code: '2120' },
    ];
    insertJournalHeader.mockResolvedValueOnce({ data: { id: 'j1' }, error: null });
    insertJournalLines.mockResolvedValueOnce({ error: null });
    await expect(postSalesInvoiceJournal({
      companyId: 'c1', userId: 'u1', invoiceId: 'i1', invoiceNumber: 7, date: '2026-08-20',
      contactId: 'contact', projectId: 'project', subtotal: 100, vatAmount: 15, total: 115,
    })).resolves.toBe('j1');
    expect(insertJournalLines.mock.calls[0][1]).toHaveLength(3);
    expect(insertJournalLines.mock.calls[0][1][0]).toMatchObject({ account_id: 'ar', debit: 115, contact_id: 'contact' });
    expect(insertJournalLines.mock.calls[0][1][2]).toMatchObject({ account_id: 'vat', credit: 15 });
    expect(operations.some((op) => op.table === 'invoices' && op.operation === 'update')).toBe(true);
  });

  test('rejects missing header and rolls back when line insertion fails', async () => {
    tableRows.accounts = [{ id: 'ar', company_id: 'c1', code: '1130' }, { id: 'rev', company_id: 'c1', code: '4100' }];
    insertJournalHeader.mockResolvedValueOnce({ data: null, error: null });
    await expect(postSalesInvoiceJournal({ companyId: 'c1', userId: 'u1', invoiceId: 'i1', invoiceNumber: 1, date: '2026-08-20', contactId: 'c', subtotal: 10, vatAmount: 0, total: 10 })).rejects.toThrow('فشل قيد');
    insertJournalHeader.mockResolvedValueOnce({ data: null, error: new Error('header') });
    await expect(postSalesInvoiceJournal({ companyId: 'c1', userId: 'u1', invoiceId: 'i1', invoiceNumber: 1, date: '2026-08-20', contactId: 'c', subtotal: 10, vatAmount: 0, total: 10 }))
      .rejects.toThrow('header');

    insertJournalHeader.mockResolvedValueOnce({ data: { id: 'j2' }, error: null });
    insertJournalLines.mockResolvedValueOnce({ error: new Error('lines') });
    await expect(postSalesInvoiceJournal({ companyId: 'c1', userId: 'u1', invoiceId: 'i1', invoiceNumber: 1, date: '2026-08-20', contactId: 'c', subtotal: 10, vatAmount: 0, total: 10 }))
      .rejects.toThrow('lines');
    expect(operations.filter((op) => op.operation === 'delete').map((op) => op.table)).toEqual(expect.arrayContaining(['journal_lines', 'journal_entries']));
  });
});
