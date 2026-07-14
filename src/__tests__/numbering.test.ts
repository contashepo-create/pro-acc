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
} from '../lib/numbering';

const TEST_COMPANY_ID = '12345678-1234-1234-1234-123456789abc';

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

  test('should call next_purchase_order_number', async () => {
    mockRpc.mockResolvedValue({ data: 8, error: null });
    
    const num = await getNextPurchaseOrderNumber(TEST_COMPANY_ID);
    
    expect(mockRpc).toHaveBeenCalledWith('next_purchase_order_number', {
      p_company_id: TEST_COMPANY_ID,
    });
    expect(num).toBe(8);
  });
});
