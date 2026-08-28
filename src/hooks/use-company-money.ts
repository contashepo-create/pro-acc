'use client';

import { useCallback } from 'react';
import { useAuthStore } from '@/store/auth-store';
import { companyDisplayMoney, companyMoneyParts } from '@/lib/company-money';

/** عرض مبالغ المنشأة برمز الدولة (ريال أو جنيه) من جلسة المستخدم. */
export function useCompanyMoney() {
  const company = useAuthStore((s) => s.company);
  const parts = companyMoneyParts(company);
  const money = useCallback(
    (amount: number) => companyDisplayMoney(Number(amount) || 0, company),
    [company],
  );
  return { money, symbol: parts.symbol, locale: parts.locale, code: parts.code, company };
}
