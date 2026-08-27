import { getCountryConfig } from '@/lib/countries';

export type FiscalWindow = { start: string; end: string; name: string };

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * نافذة السنة المالية الافتراضية حسب دولة التشغيل:
 * السعودية: أول يناير–آخر ديسمبر.
 * مصر: أول يوليو–آخر يونيو (تغطي تاريخ اليوم).
 */
export function defaultFiscalWindow(countryCode?: string | null, asOf: Date = new Date()): FiscalWindow {
  const code = String(countryCode || 'SA').toUpperCase();
  const y = asOf.getFullYear();
  const month = asOf.getMonth() + 1;
  if (code === 'EG') {
    const startY = month >= 7 ? y : y - 1;
    const start = iso(startY, 7, 1);
    const end = iso(startY + 1, 6, 30);
    return { start, end, name: `السنة المالية ${startY}/${startY + 1}` };
  }
  return {
    start: iso(y, 1, 1),
    end: iso(y, 12, 31),
    name: `السنة المالية ${y}`,
  };
}

export function defaultFiscalStart(countryCode?: string | null, asOf?: Date): string {
  return defaultFiscalWindow(countryCode, asOf).start;
}

export function operatingLocale(countryCode?: string | null): string {
  return getCountryConfig(String(countryCode || 'SA')).locale;
}
