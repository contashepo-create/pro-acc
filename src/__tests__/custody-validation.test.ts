/**
 * Tests for custody validation schemas.
 * Pure Zod schemas — no external dependencies.
 */

import {
  custodyUuid,
  custodyDate,
  custodyMoney,
  custodyText,
  openCustodySchema,
  addCustodyFundsSchema,
  custodyExpenseSchema,
  settleCustodySchema,
  updateCustodySchema,
} from '@/lib/custody-validation';

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const VALID_DATE = '2026-01-15';

describe('custody primitive validators', () => {
  describe('custodyUuid', () => {
    test('accepts valid UUIDs', () => {
      expect(custodyUuid.safeParse(VALID_UUID).success).toBe(true);
    });
    test('rejects invalid UUIDs', () => {
      expect(custodyUuid.safeParse('not-a-uuid').success).toBe(false);
      expect(custodyUuid.safeParse('').success).toBe(false);
    });
  });

  describe('custodyDate', () => {
    test('accepts valid dates', () => {
      expect(custodyDate.safeParse('2026-01-15').success).toBe(true);
      expect(custodyDate.safeParse('2026-12-31').success).toBe(true);
    });
    test('rejects invalid date formats', () => {
      expect(custodyDate.safeParse('15-01-2026').success).toBe(false);
      expect(custodyDate.safeParse('2026/01/15').success).toBe(false);
    });
    test('rejects impossible dates', () => {
      expect(custodyDate.safeParse('2026-02-30').success).toBe(false);
      expect(custodyDate.safeParse('2026-13-01').success).toBe(false);
    });
  });

  describe('custodyMoney', () => {
    test('accepts valid money amounts', () => {
      expect(custodyMoney.safeParse(100.50).success).toBe(true);
      expect(custodyMoney.safeParse(1).success).toBe(true);
      expect(custodyMoney.safeParse(0.01).success).toBe(true);
    });
    test('rejects zero and negative amounts', () => {
      expect(custodyMoney.safeParse(0).success).toBe(false);
      expect(custodyMoney.safeParse(-100).success).toBe(false);
    });
    test('rejects more than 2 decimal places', () => {
      expect(custodyMoney.safeParse(100.123).success).toBe(false);
    });
    test('rejects amounts exceeding max', () => {
      expect(custodyMoney.safeParse(10_000_000_000_000).success).toBe(false);
    });
    test('rejects NaN and Infinity', () => {
      expect(custodyMoney.safeParse(NaN).success).toBe(false);
      expect(custodyMoney.safeParse(Infinity).success).toBe(false);
    });
  });

  describe('custodyText', () => {
    test('trims whitespace', () => {
      const result = custodyText.parse('  hello  ');
      expect(result).toBe('hello');
    });
    test('rejects text over 2000 chars', () => {
      expect(custodyText.safeParse('x'.repeat(2001)).success).toBe(false);
    });
  });
});

describe('openCustodySchema', () => {
  const validOpen = {
    employee_id: VALID_UUID,
    date: VALID_DATE,
    amount: 5000,
    bank_safe_id: VALID_UUID,
  };

  test('accepts valid open custody request', () => {
    expect(openCustodySchema.safeParse(validOpen).success).toBe(true);
  });

  test('accepts optional fields', () => {
    expect(openCustodySchema.safeParse({
      ...validOpen,
      project_id: VALID_UUID,
      reason: 'مصاريف مشروع',
      description: 'وصف إضافي',
    }).success).toBe(true);
  });

  test('accepts null project_id', () => {
    expect(openCustodySchema.safeParse({ ...validOpen, project_id: null }).success).toBe(true);
  });

  test('rejects missing required fields', () => {
    const { employee_id, ...rest } = validOpen;
    expect(openCustodySchema.safeParse(rest).success).toBe(false);
  });

  test('rejects extra unknown fields (strict mode)', () => {
    expect(openCustodySchema.safeParse({ ...validOpen, hack: true }).success).toBe(false);
  });
});

describe('custodyExpenseSchema', () => {
  const validExpense = {
    amount: 500,
    description: 'شراء مواد',
  };

  test('accepts valid expense', () => {
    expect(custodyExpenseSchema.safeParse(validExpense).success).toBe(true);
  });

  test('requires description', () => {
    expect(custodyExpenseSchema.safeParse({ amount: 500, description: '' }).success).toBe(false);
  });

  test('rejects both invoice_id and purchase_invoice_id set', () => {
    const result = custodyExpenseSchema.safeParse({
      ...validExpense,
      invoice_id: VALID_UUID,
      purchase_invoice_id: VALID_UUID,
    });
    expect(result.success).toBe(false);
  });

  test('accepts one document link at a time', () => {
    expect(custodyExpenseSchema.safeParse({
      ...validExpense,
      invoice_id: VALID_UUID,
      purchase_invoice_id: null,
    }).success).toBe(true);
  });
});

describe('settleCustodySchema', () => {
  test('requires confirm: true', () => {
    expect(settleCustodySchema.safeParse({ confirm: true }).success).toBe(true);
    expect(settleCustodySchema.safeParse({ confirm: false }).success).toBe(false);
    expect(settleCustodySchema.safeParse({}).success).toBe(false);
  });

  test('accepts optional returned_cash', () => {
    expect(settleCustodySchema.safeParse({
      confirm: true,
      returned_cash: 100,
      bank_safe_id: VALID_UUID,
    }).success).toBe(true);
  });

  test('rejects negative returned_cash', () => {
    expect(settleCustodySchema.safeParse({
      confirm: true,
      returned_cash: -50,
    }).success).toBe(false);
  });
});

describe('updateCustodySchema', () => {
  test('accepts valid updates', () => {
    expect(updateCustodySchema.safeParse({ reason: 'سبب جديد' }).success).toBe(true);
    expect(updateCustodySchema.safeParse({ notes: 'ملاحظة' }).success).toBe(true);
  });

  test('rejects empty object (no fields to update)', () => {
    expect(updateCustodySchema.safeParse({}).success).toBe(false);
  });

  test('rejects extra unknown fields (strict mode)', () => {
    expect(updateCustodySchema.safeParse({ reason: 'ok', hack: true }).success).toBe(false);
  });
});
