import { defaultFiscalWindow, localDateISO } from '@/lib/fiscal-calendar';
import { eosbMonthlyAmount, eosbMonthlyFactor } from '@/lib/eosb';
import { companyDisplayMoney, companyMoneyParts } from '@/lib/company-money';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('السنة المالية الافتراضية', () => {
  test('السعودية تقويم ميلادي كامل', () => {
    const w = defaultFiscalWindow('SA', new Date(2026, 2, 15));
    expect(w.start).toBe('2026-01-01');
    expect(w.end).toBe('2026-12-31');
  });

  test('مصر من يوليو إلى يونيو وتغطي تاريخ اليوم', () => {
    const winter = defaultFiscalWindow('EG', new Date(2026, 2, 15));
    expect(winter.start).toBe('2025-07-01');
    expect(winter.end).toBe('2026-06-30');
    const summer = defaultFiscalWindow('EG', new Date(2026, 7, 1));
    expect(summer.start).toBe('2026-07-01');
    expect(summer.end).toBe('2027-06-30');
  });

  test('تاريخ اليوم محلي وليس بتوقيت عالمي', () => {
    expect(localDateISO(new Date(2026, 2, 15, 1, 0, 0))).toBe('2026-03-15');
  });
});

describe('مكافأة نهاية الخدمة', () => {
  test('نصف شهر للخمس الأولى ثم شهر كامل في الدولتين', () => {
    expect(eosbMonthlyFactor('SA', 3)).toBe(0.5);
    expect(eosbMonthlyFactor('EG', 3)).toBe(0.5);
    expect(eosbMonthlyFactor('SA', 5)).toBe(1);
    expect(eosbMonthlyFactor('EG', 8)).toBe(1);
    expect(eosbMonthlyFactor('EG', 4.99)).toBe(0.5);
    expect(eosbMonthlyFactor('SA', -1)).toBe(0);
    expect(eosbMonthlyAmount(12000, 2, 'EG')).toBe(500);
    expect(eosbMonthlyAmount(12000, 6, 'SA')).toBe(1000);
    expect(eosbMonthlyAmount(0, 6, 'SA')).toBe(0);
  });
});

describe('عرض عملة المنشأة', () => {
  test('يستخدم رمز مصر عند غياب الرمز المخزّن', () => {
    expect(companyDisplayMoney(10, { country_code: 'EG' })).toContain('ج.م');
    expect(companyDisplayMoney(10, { country_code: 'SA' })).toContain('ر.س');
    expect(companyDisplayMoney(Number.NaN, { country_code: 'EG' })).toContain('ج.م');
  });

  test('رمز العملة الدولي يتبع الدولة أو الحقل المخزّن', () => {
    expect(companyMoneyParts({ country_code: 'EG' }).code).toBe('EGP');
    expect(companyMoneyParts({ country_code: 'SA' }).code).toBe('SAR');
    expect(companyMoneyParts({ country_code: 'EG', currency_code: 'USD' }).code).toBe('USD');
    expect(companyMoneyParts(null).locale).toBe('ar-SA');
  });

  test('المساعد والتنبيهات لا يثبتان ريالا عند غياب الرمز', () => {
    const assistant = readFileSync(join(process.cwd(), 'src/app/api/assistant/route.ts'), 'utf8');
    const smart = readFileSync(join(process.cwd(), 'src/app/api/notifications/smart/route.ts'), 'utf8');
    expect(assistant).toContain('companyMoneyParts');
    expect(assistant).not.toMatch(/ر\.س/);
    expect(smart).toContain('companyMoneyParts');
    expect(smart).toContain('defaultFiscalWindow');
    expect(smart).not.toMatch(/ر\.س/);
    expect(smart).not.toContain('12-31');
  });
});
