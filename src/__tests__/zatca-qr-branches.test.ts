import { generateZatcaQRData, validateInvoiceForZatca } from '@/lib/zatca/qr-code';
const base = { sellerName: 'Seller', vatNumber: '123456789012345', timestamp: '2026-08-20T10:00:00Z', invoiceTotal: 115, vatTotal: 15 };
describe('ZATCA QR validation branches', () => {
  test('collects every invalid field error', () => {
    const result = validateInvoiceForZatca({ sellerName: ' ', vatNumber: 'bad', timestamp: 'bad', invoiceTotal: NaN, vatTotal: -1 });
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(5);
    expect(validateInvoiceForZatca({ ...base, invoiceTotal: 'x' as unknown as number }).valid).toBe(false);
    expect(validateInvoiceForZatca({ ...base, vatTotal: Infinity }).valid).toBe(false);
    expect(validateInvoiceForZatca({ ...base, vatTotal: 116 }).errors).toContain('مبلغ الضريبة لا يمكن أن يكون أكبر من الإجمالي');
  });
  test('rejects invalid VAT before general validation and oversized TLV values', () => {
    expect(() => generateZatcaQRData({ ...base, vatNumber: 'bad' })).toThrow('15 digits');
    expect(() => generateZatcaQRData({ ...base, timestamp: 'bad' })).toThrow('وقت الفاتورة');
    expect(() => generateZatcaQRData({ ...base, sellerName: 'x'.repeat(256) })).toThrow('exceeds 255 bytes');
  });
});
