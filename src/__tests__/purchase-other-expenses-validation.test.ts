import { purchaseInvoiceSchema } from '@/lib/validation';

describe('purchaseInvoiceSchema — other expenses', () => {
  const base = {
    date: '2026-08-01',
    supplier_id: '00000000-0000-4000-8000-000000000001',
    items: [{ description: 'بضاعة', quantity: 2, unit_price: 100 }],
    tax_rate: 0.15,
  };

  test('accepts valid other_expenses with optional fields', () => {
    const parsed = purchaseInvoiceSchema.safeParse({
      ...base,
      other_expenses: [
        { description: 'أجرة نقل', amount: 50, account_code: '5400' },
        { description: 'صيانة', amount: 30, account_id: '00000000-0000-4000-8000-000000000002' },
      ],
      payment_account_id: '00000000-0000-4000-8000-000000000003',
    });
    expect(parsed.success).toBe(true);
  });

  test('rejects an other_expense with a non-positive amount', () => {
    const parsed = purchaseInvoiceSchema.safeParse({
      ...base,
      other_expenses: [{ description: 'x', amount: 0 }],
    });
    expect(parsed.success).toBe(false);
  });

  test('rejects an other_expense with an amount having more than 2 decimals', () => {
    const parsed = purchaseInvoiceSchema.safeParse({
      ...base,
      other_expenses: [{ description: 'x', amount: 10.555 }],
    });
    expect(parsed.success).toBe(false);
  });

  test('rejects an other_expense with an empty description', () => {
    const parsed = purchaseInvoiceSchema.safeParse({
      ...base,
      other_expenses: [{ description: '', amount: 10 }],
    });
    expect(parsed.success).toBe(false);
  });

  test('rejects an other_expense with an invalid account_id', () => {
    const parsed = purchaseInvoiceSchema.safeParse({
      ...base,
      other_expenses: [{ description: 'x', amount: 10, account_id: 'not-a-uuid' }],
    });
    expect(parsed.success).toBe(false);
  });

  test('rejects an invalid payment_account_id', () => {
    const parsed = purchaseInvoiceSchema.safeParse({
      ...base,
      payment_account_id: 'bad',
    });
    expect(parsed.success).toBe(false);
  });

  test('rejects more than 100 other expenses', () => {
    const parsed = purchaseInvoiceSchema.safeParse({
      ...base,
      other_expenses: Array.from({ length: 101 }, () => ({ description: 'x', amount: 1 })),
    });
    expect(parsed.success).toBe(false);
  });

  test('rejects unknown fields in an other_expense object (strict)', () => {
    const parsed = purchaseInvoiceSchema.safeParse({
      ...base,
      other_expenses: [{ description: 'x', amount: 1, unknown_field: 5 }],
    });
    expect(parsed.success).toBe(false);
  });

  test('omits other expenses when not provided (optional)', () => {
    const parsed = purchaseInvoiceSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    expect((parsed.data as any).other_expenses).toBeUndefined();
  });
});
