/**
 * معامل الاستحقاق الشهري لمكافأة نهاية الخدمة (معيار المحاسبة الدولي 19).
 * السعودية ومصر: نصف شهر عن كل سنة من الخمس الأولى، ثم شهر كامل بعد ذلك.
 * القسط الشهري = الراتب × المعامل / 12.
 */
export function eosbMonthlyFactor(_countryCode: string | null | undefined, serviceYears: number): number {
  void _countryCode;
  if (!Number.isFinite(serviceYears) || serviceYears < 0) return 0;
  return serviceYears >= 5 ? 1 : 0.5;
}

export function eosbMonthlyAmount(salary: number, serviceYears: number, countryCode?: string | null): number {
  if (!Number.isFinite(salary) || salary <= 0) return 0;
  const factor = eosbMonthlyFactor(countryCode, serviceYears);
  return Math.round((salary * factor) / 12 * 100) / 100;
}
