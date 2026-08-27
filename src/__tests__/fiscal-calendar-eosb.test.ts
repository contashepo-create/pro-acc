import { defaultFiscalWindow } from '@/lib/fiscal-calendar';
import { eosbMonthlyAmount, eosbMonthlyFactor } from '@/lib/eosb';
import { companyDisplayMoney } from '@/lib/company-money';

describe('السنة المالية الافتراضية', () => {
  test('السعودية تقويم ميلادي كامل', () => {
    const w = defaultFiscalWindow('SA', new Date('2026-03-15T00:00:00Z'));
    expect(w.start).toBe('2026-01-01');
    expect(w.end).toBe('2026-12-31');
  });

  test('مصر من يوليو إلى يونيو وتغطي تاريخ اليوم', () => {
    const winter = defaultFiscalWindow('EG', new Date('2026-03-15T00:00:00Z'));
    expect(winter.start).toBe('2025-07-01');
    expect(winter.end).toBe('2026-06-30');
    const summer = defaultFiscalWindow('EG', new Date('2026-08-01T00:00:00Z'));
    expect(summer.start).toBe('2026-07-01');
    expect(summer.end).toBe('2027-06-30');
  });
});

describe('مكافأة نهاية الخدمة', () => {
  test('نصف شهر للخمس الأولى ثم شهر كامل في الدولتين', () => {
    expect(eosbMonthlyFactor('SA', 3)).toBe(0.5);
    expect(eosbMonthlyFactor('EG', 3)).toBe(0.5);
    expect(eosbMonthlyFactor('SA', 5)).toBe(1);
    expect(eosbMonthlyFactor('EG', 8)).toBe(1);
    expect(eosbMonthlyAmount(12000, 2, 'EG')).toBe(500);
    expect(eosbMonthlyAmount(12000, 6, 'SA')).toBe(1000);
  });
});

describe('عرض عملة المنشأة', () => {
  test('يستخدم رمز مصر عند غياب الرمز المخزّن', () => {
    expect(companyDisplayMoney(10, { country_code: 'EG' })).toContain('ج.م');
    expect(companyDisplayMoney(10, { country_code: 'SA' })).toContain('ر.س');
  });
});
