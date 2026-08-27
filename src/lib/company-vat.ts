/**
 * نسبة ضريبة القيمة المضافة للمنشأة.
 * المصدر المعتمد: companies.vat_rate (كسر 0.15 أو نسبة 15 للتوافق مع الصفوف القديمة).
 */

export type CompanyTaxInfo = {
  vat_rate?: unknown;
  country_code?: string | null;
};

/** كسر ضريبة من قيمة مخزّنة ككسر (0.14) أو كنسبة (14). بدون افتراض دولة. */
export function normalizeVatFraction(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n > 1 && n <= 100) return Math.round(n) / 100;
  if (n <= 1) return n;
  return 0;
}

export function parseCompanyVatRate(company?: CompanyTaxInfo | null): number {
  const countryDefault = company?.country_code === 'EG' ? 0.14 : 0.15;
  const fraction = normalizeVatFraction(company?.vat_rate);
  return fraction > 0 ? fraction : countryDefault;
}

export function vatPercentLabel(rate: number): string {
  const pct = Math.round(rate * 10000) / 100;
  return Number.isInteger(pct) ? String(pct) : String(pct);
}

export function vatOnAmount(amount: number, rate: number): number {
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(rate) || rate <= 0) return 0;
  return Math.round(amount * rate * 100) / 100;
}
