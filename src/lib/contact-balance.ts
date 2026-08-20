export type ClientBalanceMeaning = {
  label: 'مستحق على العميل' | 'رصيد لصالح العميل' | 'الحساب متعادل';
  shortLabel: 'على العميل' | 'لصالح العميل' | 'متعادل';
};

/**
 * Receivables use the client control account convention:
 * debit balance = the client owes the company; credit balance = client credit.
 */
export function getClientBalanceMeaning(balance: number): ClientBalanceMeaning {
  if (balance > 0) return { label: 'مستحق على العميل', shortLabel: 'على العميل' };
  if (balance < 0) return { label: 'رصيد لصالح العميل', shortLabel: 'لصالح العميل' };
  return { label: 'الحساب متعادل', shortLabel: 'متعادل' };
}
