/**
 * نسبة ضريبة القيمة المضافة للمنشأة.
 * المصدر المعتمد: companies.vat_rate (كسر 0.15 أو نسبة 15 للتوافق مع الصفوف القديمة).
 */

export type CompanyTaxInfo = {
  vat_rate?: unknown;
  country_code?: string | null;
};

export function parseCompanyVatRate(company?: CompanyTaxInfo | null): number {
  const countryDefault = company?.country_code === 'EG' ? 0.14 : 0.15;
  const raw = Number(company?.vat_rate);
  if (!Number.isFinite(raw) || raw <= 0) return countryDefault;
  if (raw > 1 && raw <= 100) return Math.round(raw) / 100;
  if (raw > 0 && raw <= 1) return raw;
  return countryDefault;
}

export function vatPercentLabel(rate: number): string {
  const pct = Math.round(rate * 10000) / 100;
  return Number.isInteger(pct) ? String(pct) : String(pct);
}

export function vatOnAmount(amount: number, rate: number): number {
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(rate) || rate <= 0) return 0;
  return Math.round(amount * rate * 100) / 100;
}
