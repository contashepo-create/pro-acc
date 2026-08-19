import { getClientBalanceMeaning } from '@/lib/contact-balance';

describe('client statement balance meaning', () => {
  test('a debit receivable means the client owes the company', () => {
    expect(getClientBalanceMeaning(34100)).toEqual({
      label: 'مستحق على العميل', shortLabel: 'على العميل',
    });
  });

  test('a credit receivable means the balance belongs to the client', () => {
    expect(getClientBalanceMeaning(-34100)).toEqual({
      label: 'رصيد لصالح العميل', shortLabel: 'لصالح العميل',
    });
  });

  test('zero is shown as settled', () => {
    expect(getClientBalanceMeaning(0).label).toBe('الحساب متعادل');
  });
});
