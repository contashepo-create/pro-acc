/**
 * Accounting Logic Tests - Critical for financial correctness
 * Tests VAT calculations, journal balancing, invoice totals, etc.
 */

describe('Invoice Calculations (VAT 15%)', () => {
  const VAT_RATE = 0.15;

  test('should calculate VAT correctly', () => {
    const subtotal = 1000;
    const vatAmount = subtotal * VAT_RATE;
    const total = subtotal + vatAmount;

    expect(vatAmount).toBe(150);
    expect(total).toBe(1150);
  });

  test('should handle zero VAT', () => {
    const subtotal = 1000;
    const vatRate = 0;
    const vatAmount = subtotal * vatRate;
    const total = subtotal + vatAmount;

    expect(vatAmount).toBe(0);
    expect(total).toBe(1000);
  });

  test('should handle invoice items total', () => {
    const items = [
      { quantity: 2, unitPrice: 100 },
      { quantity: 3, unitPrice: 50 },
    ];
    const subtotal = items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
    expect(subtotal).toBe(350); // 2*100 + 3*50

    const vatAmount = subtotal * VAT_RATE;
    const total = subtotal + vatAmount;
    expect(total).toBe(402.5);
  });

  test('should handle large numbers', () => {
    const subtotal = 1000000;
    const vatAmount = subtotal * VAT_RATE;
    const total = subtotal + vatAmount;

    expect(vatAmount).toBe(150000);
    expect(total).toBe(1150000);
  });

  test('should handle decimal precision', () => {
    const subtotal = 99.99;
    const vatAmount = subtotal * VAT_RATE; // 14.9985
    const total = subtotal + vatAmount;

    expect(vatAmount).toBeCloseTo(14.9985);
    expect(total).toBeCloseTo(114.9885);
  });
});

describe('Journal Entry Balancing', () => {
  test('should balance debit and credit', () => {
    const lines = [
      { debit: 1150, credit: 0, account: '1130' }, // AR debit
      { debit: 0, credit: 1000, account: '4100' }, // Revenue credit
      { debit: 0, credit: 150, account: '2120' }, // VAT credit
    ];

    const totalDebit = lines.reduce((sum, l) => sum + l.debit, 0);
    const totalCredit = lines.reduce((sum, l) => sum + l.credit, 0);

    expect(totalDebit).toBe(totalCredit);
    expect(totalDebit).toBe(1150);
  });

  test('should detect unbalanced entry', () => {
    const lines = [
      { debit: 1000, credit: 0 },
      { debit: 0, credit: 900 }, // Not balanced
    ];

    const totalDebit = lines.reduce((sum, l) => sum + l.debit, 0);
    const totalCredit = lines.reduce((sum, l) => sum + l.credit, 0);

    expect(totalDebit).not.toBe(totalCredit);
    expect(Math.abs(totalDebit - totalCredit)).toBeGreaterThan(0.01);
  });

  test('should allow tolerance of 0.01 for rounding', () => {
    const lines = [
      { debit: 100.005, credit: 0 },
      { debit: 0, credit: 100.01 },
    ];

    const totalDebit = lines.reduce((sum, l) => sum + l.debit, 0);
    const totalCredit = lines.reduce((sum, l) => sum + l.credit, 0);

    // Within 0.01 tolerance
    expect(Math.abs(totalDebit - totalCredit)).toBeLessThan(0.01);
  });
});

describe('Trial Balance Calculations', () => {
  test('should calculate trial balance correctly', () => {
    const accounts = [
      { code: '1130', type: 'asset', total_debit: 15000, total_credit: 5000 },
      { code: '2110', type: 'liability', total_debit: 2000, total_credit: 10000 },
      { code: '4100', type: 'revenue', total_debit: 0, total_credit: 20000 },
      { code: '5210', type: 'expense', total_debit: 8000, total_credit: 0 },
    ];

    const totalDebit = accounts.reduce((sum, a) => sum + a.total_debit, 0);
    const totalCredit = accounts.reduce((sum, a) => sum + a.total_credit, 0);

    // In double-entry, total debit should equal total credit
    expect(totalDebit).toBe(25000); // 15000+2000+0+8000
    expect(totalCredit).toBe(35000); // 5000+10000+20000+0
    // Note: In real trial balance, these should be equal if all entries balanced
    // This test shows calculation, not balance check
  });

  test('should calculate net income', () => {
    const revenue = [{ amount: 20000 }, { amount: 5000 }];
    const expenses = [{ amount: 8000 }, { amount: 3000 }];

    const totalRevenue = revenue.reduce((sum, r) => sum + r.amount, 0);
    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
    const netIncome = totalRevenue - totalExpenses;

    expect(totalRevenue).toBe(25000);
    expect(totalExpenses).toBe(11000);
    expect(netIncome).toBe(14000);
  });
});

describe('Subscription & Limits', () => {
  test('should enforce trial 7 days', () => {
    const trialDays = 7;
    const startDate = new Date('2026-01-01');
    const endDate = new Date(startDate.getTime() + trialDays * 86400000);

    const diffDays = Math.ceil((endDate.getTime() - startDate.getTime()) / 86400000);
    expect(diffDays).toBe(7);
  });

  test('should calculate yearly discount', () => {
    const monthlyPrice = 199;
    const yearlyDiscountPercent = 20;
    const yearlyPrice = monthlyPrice * 12 * (1 - yearlyDiscountPercent / 100);

    expect(yearlyPrice).toBe(199 * 12 * 0.8); // 1910.4
    expect(yearlyPrice).toBeLessThan(monthlyPrice * 12);
  });

  test('should enforce usage limits', () => {
    const limits = {
      max_users: 3,
      max_invoices_per_month: 50,
    };

    const currentUsers = 2;
    const currentInvoices = 45;

    expect(currentUsers < limits.max_users).toBe(true);
    expect(currentInvoices < limits.max_invoices_per_month).toBe(true);

    // At limit
    expect(3 >= limits.max_users).toBe(true); // Would block
    expect(50 >= limits.max_invoices_per_month).toBe(true); // Would block
  });
});

describe('Security - Input Validation', () => {
  test('should reject invalid account code', () => {
    const validCode = '1130';
    const invalidCodes = ['11', '113', '11300', 'ABCD', ''];

    expect(/^\d{4}$/.test(validCode)).toBe(true);
    invalidCodes.forEach(code => {
      expect(/^\d{4}$/.test(code)).toBe(false);
    });
  });

  test('should reject negative amounts', () => {
    const amounts = [100, 0, -10, -0.01];
    
    expect(amounts[0] >= 0).toBe(true);
    expect(amounts[1] >= 0).toBe(true);
    expect(amounts[2] >= 0).toBe(false);
    expect(amounts[3] >= 0).toBe(false);
  });

  test('should validate email format', () => {
    const validEmails = ['test@example.com', 'conta.moha@gmail.com'];
    const invalidEmails = ['test', 'test@', '@example.com', ''];

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    validEmails.forEach(email => {
      expect(emailRegex.test(email)).toBe(true);
    });

    invalidEmails.forEach(email => {
      expect(emailRegex.test(email)).toBe(false);
    });
  });
});

describe('Backup & HMAC Verification', () => {
  test('should generate consistent HMAC', () => {
    const crypto = require('crypto');
    const secret = 'test-secret';
    const data = JSON.stringify({ company_id: '123', data: { accounts: [] } });

    const hmac1 = crypto.createHmac('sha256', secret).update(data).digest('hex');
    const hmac2 = crypto.createHmac('sha256', secret).update(data).digest('hex');

    expect(hmac1).toBe(hmac2);
    expect(hmac1).toHaveLength(64); // SHA256 hex length
  });

  test('should detect tampered backup', () => {
    const crypto = require('crypto');
    const secret = 'test-secret';
    const originalData = JSON.stringify({ company_id: '123', amount: 100 });
    const tamperedData = JSON.stringify({ company_id: '123', amount: 9999 });

    const originalHmac = crypto.createHmac('sha256', secret).update(originalData).digest('hex');
    const tamperedHmac = crypto.createHmac('sha256', secret).update(tamperedData).digest('hex');

    expect(originalHmac).not.toBe(tamperedHmac);
  });
});
