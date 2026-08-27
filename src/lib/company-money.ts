import { formatCurrency } from '@/lib/utils';
import { getCountryConfig } from '@/lib/countries';

export type CompanyMoneyInfo = {
  locale?: string | null;
  currency_symbol?: string | null;
  country_code?: string | null;
};

export function companyMoneyParts(company?: CompanyMoneyInfo | null) {
  const cfg = getCountryConfig(String(company?.country_code || 'SA'));
  return {
    locale: String(company?.locale || '').trim() || cfg.locale,
    symbol: String(company?.currency_symbol || '').trim() || cfg.currencySymbol,
  };
}

export function companyDisplayMoney(amount: number, company?: CompanyMoneyInfo | null): string {
  const { locale, symbol } = companyMoneyParts(company);
  return formatCurrency(Number.isFinite(amount) ? amount : 0, locale, symbol);
}
