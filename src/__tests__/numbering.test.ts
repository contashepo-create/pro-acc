/**
 * Tests for lib/numbering.ts - Atomic sequence generation
 */

// Create a chainable mock builder
function createChainableMock(finalReturn: any = { data: null, error: null }) {
  const chain: any = {};
  const methods = ['select', 'eq', 'order', 'limit', 'maybeSingle', 'update', 'insert'];
  
  for (const method of methods) {
    chain[method] = jest.fn().mockReturnValue(chain);
  }
  chain.maybeSingle = jest.fn().mockResolvedValue(finalReturn);
  chain.single = jest.fn().mockResolvedValue(finalReturn);
  
  return chain;
}

let mockRpc: jest.Mock;
let mockChain: any;

jest.mock('../lib/supabase-client', () => ({
  getSupabase: () => ({
    rpc: mockRpc,
    from: () => mockChain,
  }),
}));

import {
  getNextInvoiceNumber,
  getNextJournalNumber,
  getNextVoucherNumber,
  getNextQuotationNumber,
  getNextPurchaseInvoiceNumber,
  getNextPurchaseOrderNumber,
  isUniqueViolation,
} from '../lib/numbering';

const TEST_COMPANY_ID = '12345678-1234-1234-1234-123456789abc';

test('detects database unique violations safely', () => {
  expect(isUniqueViolation({ code: '23505' })).toBe(true);
  expect(isUniqueViolation({ message: 'duplicate key value violates unique constraint' })).toBe(true);
  expect(isUniqueViolation(new Error('other'))).toBe(false);
  expect(isUniqueViolation(null)).toBe(false);
});

describe('Invoice Numbering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRpc = jest.fn();
    mockChain = createChainableMock();
  });

  test('should use RPC function for invoice number', async () => {
    mockRpc.mockResolvedValue({ data: 42, error: null });
    
    const num = await getNextInvoiceNumber(TEST_COMPANY_ID, 2026);
    
    expect(mockRpc).toHaveBeenCalledWith('next_invoice_number', {
      p_company_id: TEST_COMPANY_ID,
      p_year: 2026,
    });
    expect(num).toBe(42);
  });

  test('should fallback to MAX+1 when RPC fails', async () => {
    mockRpc.mockRejectedValue(new Error('function not found'));
    mockChain.maybeSingle.mockResolvedValue({ data: { last_number: 99 } });
    
    const num = await getNextInvoiceNumber(TEST_COMPANY_ID, 2026);
    expect(num).toBe(100);
  });

  test('uses company-wide MAX when yearly invoice sequence is behind', async () => {
    mockRpc.mockResolvedValue({ data: 2, error: null });
    mockChain.maybeSingle.mockResolvedValue({ data: { number: 88 } });
    const num = await getNextInvoiceNumber(TEST_COMPANY_ID, 2026);
    expect(num).toBe(89);
  });

  test('should return 1 when fallback and no existing records', async () => {
    mockRpc.mockRejectedValue(new Error('function not found'));
    mockChain.maybeSingle.mockResolvedValue({ data: null });
    mockChain.insert = jest.fn().mockResolvedValue({ error: null });
    // Need to make insert chainable too
    const origFrom = jest.requireMock('../lib/supabase-client').getSupabase;
    
    const num = await getNextInvoiceNumber(TEST_COMPANY_ID, 2026);
    // With null data, it should fallback to 0 + 1 = 1
    expect(num).toBe(1);
  });
});

describe('Journal Numbering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRpc = jest.fn();
    mockChain = createChainableMock();
  });

  test('should accept date string and extract year', async () => {
    mockRpc.mockResolvedValue({ data: 7, error: null });
    
    const num = await getNextJournalNumber(TEST_COMPANY_ID, '2026-07-15');
    
    expect(mockRpc).toHaveBeenCalledWith('next_journal_number', {
      p_company_id: TEST_COMPANY_ID,
      p_year: 2026,
    });
    expect(num).toBe(7);
  });

  test('should accept year as number directly', async () => {
    mockRpc.mockResolvedValue({ data: 15, error: null });
    
    const num = await getNextJournalNumber(TEST_COMPANY_ID, 2025);
    
    expect(mockRpc).toHaveBeenCalledWith('next_journal_number', {
      p_company_id: TEST_COMPANY_ID,
      p_year: 2025,
    });
    expect(num).toBe(15);
  });

  test('uses company-wide MAX when yearly sequence is behind existing journals', async () => {
    mockRpc.mockResolvedValue({ data: 3, error: null });
    mockChain.maybeSingle.mockResolvedValue({ data: { number: 40 } });
    const num = await getNextJournalNumber(TEST_COMPANY_ID, 2026);
    expect(num).toBe(41);
  });

  test('falls back through existing and missing journal sequence rows', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'rpc' } });
    mockChain.maybeSingle
      .mockResolvedValueOnce({ data: { last_number: 9 } })
      .mockResolvedValueOnce({ data: { number: 3 } });
    expect(await getNextJournalNumber(TEST_COMPANY_ID, 2026)).toBe(10);
    mockChain.maybeSingle
      .mockResolvedValueOnce({ data: null })
      .mockResolvedValueOnce({ data: null });
    expect(await getNextJournalNumber(TEST_COMPANY_ID, 2026)).toBe(1);
  });
});

describe('Voucher Numbering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRpc = jest.fn();
    mockChain = createChainableMock();
  });

  test('should call next_voucher_number for receipts', async () => {
    mockRpc.mockResolvedValue({ data: 3, error: null });
    
    const num = await getNextVoucherNumber(TEST_COMPANY_ID, 'voucher_receipts');
    
    expect(mockRpc).toHaveBeenCalledWith('next_voucher_number', {
      p_company_id: TEST_COMPANY_ID,
      p_table_name: 'voucher_receipts',
    });
    expect(num).toBe(3);
  });

  test('falls back to table max or one when voucher RPC fails', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'rpc' } });
    mockChain.maybeSingle.mockResolvedValueOnce({ data: { number: 7 } });
    expect(await getNextVoucherNumber(TEST_COMPANY_ID, 'voucher_receipts')).toBe(8);
    mockChain.maybeSingle.mockResolvedValueOnce({ data: null });
    expect(await getNextVoucherNumber(TEST_COMPANY_ID, 'voucher_receipts')).toBe(1);
  });

  test('should call next_voucher_number for disbursements', async () => {
    mockRpc.mockResolvedValue({ data: 5, error: null });
    
    const num = await getNextVoucherNumber(TEST_COMPANY_ID, 'voucher_disbursements');
    
    expect(mockRpc).toHaveBeenCalledWith('next_voucher_number', {
      p_company_id: TEST_COMPANY_ID,
      p_table_name: 'voucher_disbursements',
    });
    expect(num).toBe(5);
  });
});

describe('Quotation Numbering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRpc = jest.fn();
    mockChain = createChainableMock();
  });

  test('falls back to quotation max or one', async () => {
    mockRpc.mockRejectedValue(new Error('rpc'));
    mockChain.maybeSingle.mockResolvedValueOnce({ data: { number: 5 } });
    expect(await getNextQuotationNumber(TEST_COMPANY_ID)).toBe(6);
    mockChain.maybeSingle.mockResolvedValueOnce({ data: null });
    expect(await getNextQuotationNumber(TEST_COMPANY_ID)).toBe(1);
  });

  test('should call next_quotation_number', async () => {
    mockRpc.mockResolvedValue({ data: 10, error: null });
    
    const num = await getNextQuotationNumber(TEST_COMPANY_ID);
    
    expect(mockRpc).toHaveBeenCalledWith('next_quotation_number', {
      p_company_id: TEST_COMPANY_ID,
    });
    expect(num).toBe(10);
  });
});

describe('Purchase Invoice Numbering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRpc = jest.fn();
    mockChain = createChainableMock();
  });

  test('falls back to the highest legacy/current purchase invoice number', async () => {
    mockRpc.mockRejectedValue(new Error('rpc'));
    mockChain.maybeSingle.mockResolvedValueOnce({ data: { invoice_number: 8 } }).mockResolvedValueOnce({ data: { number: 10 } });
    expect(await getNextPurchaseInvoiceNumber(TEST_COMPANY_ID)).toBe(11);
  });

  test('should call next_purchase_invoice_number', async () => {
    mockRpc.mockResolvedValue({ data: 22, error: null });
    
    const num = await getNextPurchaseInvoiceNumber(TEST_COMPANY_ID);
    
    expect(mockRpc).toHaveBeenCalledWith('next_purchase_invoice_number', {
      p_company_id: TEST_COMPANY_ID,
    });
    expect(num).toBe(22);
  });
});

describe('Purchase Order Numbering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRpc = jest.fn();
    mockChain = createChainableMock();
  });

  test('falls back to the highest legacy/current purchase order number', async () => {
    mockRpc.mockRejectedValue(new Error('rpc'));
    mockChain.maybeSingle.mockResolvedValueOnce({ data: { po_number: 4 } }).mockResolvedValueOnce({ data: { number: 6 } });
    expect(await getNextPurchaseOrderNumber(TEST_COMPANY_ID)).toBe(7);
  });

  test('should call next_purchase_order_number', async () => {
    mockRpc.mockResolvedValue({ data: 8, error: null });
    
    const num = await getNextPurchaseOrderNumber(TEST_COMPANY_ID);
    
    expect(mockRpc).toHaveBeenCalledWith('next_purchase_order_number', {
      p_company_id: TEST_COMPANY_ID,
    });
    expect(num).toBe(8);
  });
});
