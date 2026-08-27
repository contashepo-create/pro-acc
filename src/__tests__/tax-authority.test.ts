import { taxAuthorityName, taxQrCaption, taxQrFootnote, usesPhaseOneTaxQr } from '@/lib/tax-authority';

describe('tax authority labels by operating country', () => {
  test('Saudi captions name the Zakat authority and enable phase-one QR', () => {
    expect(taxAuthorityName('SA')).toBe('هيئة الزكاة والضريبة والجمارك');
    expect(taxQrCaption('SA')).toContain('الفوترة');
    expect(usesPhaseOneTaxQr('SA')).toBe(true);
    expect(taxQrFootnote('SA')).toContain('هيئة الزكاة');
  });

  test('Egyptian captions name the tax authority and do not use phase-one QR', () => {
    expect(taxAuthorityName('EG')).toBe('مصلحة الضرائب المصرية');
    expect(taxQrCaption('EG')).toContain('الفاتورة الإلكترونية');
    expect(usesPhaseOneTaxQr('EG')).toBe(false);
    expect(taxQrFootnote('EG')).toContain('مصر');
  });
});
