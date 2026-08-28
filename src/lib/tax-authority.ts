import { getCountryConfig } from '@/lib/countries';

/** تسميات الجهة الضريبية حسب دولة التشغيل (السعودية أو مصر). */
export function taxAuthorityName(countryCode?: string | null): string {
  const code = String(countryCode || 'SA').toUpperCase();
  if (code === 'EG') return 'مصلحة الضرائب المصرية';
  return 'هيئة الزكاة والضريبة والجمارك';
}

export function taxQrCaption(countryCode?: string | null): string {
  const code = String(countryCode || 'SA').toUpperCase();
  if (code === 'EG') return 'رمز الفاتورة الإلكترونية';
  return 'رمز الفوترة الإلكترونية';
}

export function taxQrFootnote(countryCode?: string | null): string {
  const code = String(countryCode || 'SA').toUpperCase();
  if (code === 'EG') {
    return 'فاتورة ضريبية وفق متطلبات منظومة الفاتورة الإلكترونية في مصر.';
  }
  return `مطابقة لمتطلبات الفوترة الضريبية الصادرة عن ${taxAuthorityName('SA')}.`;
}

export function usesPhaseOneTaxQr(countryCode?: string | null): boolean {
  return getCountryConfig(String(countryCode || 'SA')).taxAuthority === 'zatca';
}
