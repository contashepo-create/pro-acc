import { parseCompanyVatRate, vatOnAmount, vatPercentLabel } from '@/lib/company-vat';

describe('parseCompanyVatRate', () => {
  test('reads a fraction', () => {
    expect(parseCompanyVatRate({ vat_rate: 0.14, country_code: 'EG' })).toBe(0.14);
    expect(parseCompanyVatRate({ vat_rate: 0.15, country_code: 'SA' })).toBe(0.15);
  });

  test('reads a legacy percent stored as 15', () => {
    expect(parseCompanyVatRate({ vat_rate: 15, country_code: 'SA' })).toBe(0.15);
    expect(parseCompanyVatRate({ vat_rate: 14, country_code: 'EG' })).toBe(0.14);
  });

  test('falls back to the operating country', () => {
    expect(parseCompanyVatRate({ country_code: 'EG' })).toBe(0.14);
    expect(parseCompanyVatRate({ country_code: 'SA' })).toBe(0.15);
    expect(parseCompanyVatRate(null)).toBe(0.15);
  });
});

describe('vatPercentLabel / vatOnAmount', () => {
  test('formats percents without trailing zeros', () => {
    expect(vatPercentLabel(0.15)).toBe('15');
    expect(vatPercentLabel(0.14)).toBe('14');
  });

  test('rounds tax on an amount to two decimals', () => {
    expect(vatOnAmount(100, 0.14)).toBe(14);
    expect(vatOnAmount(250, 0.15)).toBe(37.5);
  });
});
