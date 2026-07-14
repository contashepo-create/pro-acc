/**
 * Tests for ZATCA Phase 2 QR Code and UBL XML generation
 */

import { generateZatcaQRData, validateInvoiceForZatca } from '../lib/zatca/qr-code';
import { generateUBLInvoice } from '../lib/zatca/ubl-builder';

const validInvoiceData = {
  sellerName: 'شركة المقاولات المتحدة',
  vatNumber: '300000000000003',
  timestamp: '2026-07-15T14:30:00Z',
  invoiceTotal: 1150.00,
  vatTotal: 150.00,
};

describe('ZATCA QR Code Generation', () => {
  test('should generate valid base64 TLV data', () => {
    const qrData = generateZatcaQRData(validInvoiceData);
    
    // Should be valid base64
    expect(qrData).toMatch(/^[A-Za-z0-9+/=]+$/);
    
    // Decode and verify structure
    const decoded = Buffer.from(qrData, 'base64');
    
    // First tag should be 1 (seller name)
    expect(decoded[0]).toBe(1);
    // Length of seller name in UTF-8 bytes
    const sellerNameBytes = Buffer.from(validInvoiceData.sellerName, 'utf-8');
    expect(decoded[1]).toBe(sellerNameBytes.length);
  });

  test('should encode all 5 tags correctly', () => {
    const qrData = generateZatcaQRData(validInvoiceData);
    const decoded = Buffer.from(qrData, 'base64');
    
    // Parse TLV blocks
    let offset = 0;
    const tags: Record<number, string> = {};
    
    while (offset < decoded.length) {
      const tag = decoded[offset];
      const length = decoded[offset + 1];
      const value = decoded.subarray(offset + 2, offset + 2 + length).toString('utf-8');
      tags[tag] = value;
      offset += 2 + length;
    }
    
    expect(tags[1]).toBe(validInvoiceData.sellerName);
    expect(tags[2]).toBe(validInvoiceData.vatNumber);
    expect(tags[3]).toBe(validInvoiceData.timestamp);
    expect(tags[4]).toBe('1150.00');
    expect(tags[5]).toBe('150.00');
  });

  test('should reject invalid VAT number', () => {
    expect(() => generateZatcaQRData({ ...validInvoiceData, vatNumber: '123' }))
      .toThrow('VAT number must be 15 digits');
  });
});

describe('ZATCA Invoice Validation', () => {
  test('should pass for valid invoice data', () => {
    const result = validateInvoiceForZatca(validInvoiceData);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('should fail for empty seller name', () => {
    const result = validateInvoiceForZatca({ ...validInvoiceData, sellerName: '' });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('اسم البائع مطلوب');
  });

  test('should fail for invalid VAT number', () => {
    const result = validateInvoiceForZatca({ ...validInvoiceData, vatNumber: '12345' });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('15');
  });

  test('should fail for negative total', () => {
    const result = validateInvoiceForZatca({ ...validInvoiceData, invoiceTotal: -100 });
    expect(result.valid).toBe(false);
  });

  test('should fail when VAT exceeds total', () => {
    const result = validateInvoiceForZatca({ ...validInvoiceData, vatTotal: 2000, invoiceTotal: 1000 });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('مبلغ الضريبة لا يمكن أن يكون أكبر من الإجمالي');
  });
});

describe('UBL XML Generation', () => {
  const ublData = {
    uuid: 'inv-uuid-12345',
    number: 42,
    issueDate: '2026-07-15',
    issueTime: '14:30:00',
    invoiceTypeCode: '388',
    currencyCode: 'SAR',
    seller: {
      name: 'شركة الاختبار',
      vatNumber: '300000000000003',
      address: { city: 'الرياض', country: 'SA' },
    },
    buyer: {
      name: 'عميل تجريبي',
      vatNumber: '310000000000003',
    },
    items: [
      { id: '1', description: 'خدمة استشارية', quantity: 10, unitPrice: 100, vatRate: 0.15, total: 1000 },
      { id: '2', description: 'مواد بناء', quantity: 5, unitPrice: 30, vatRate: 0.15, total: 150 },
    ],
    amounts: {
      lineExtensionAmount: 1150,
      taxExclusiveAmount: 1000,
      taxInclusiveAmount: 1150,
      taxAmount: 150,
    },
    vatRate: 0.15,
    paymentMeansCode: '10',
  };

  test('should generate valid XML', () => {
    const xml = generateUBLInvoice(ublData);
    
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('<Invoice xmlns=');
    expect(xml).toContain('</Invoice>');
  });

  test('should include UBL 2.1 version', () => {
    const xml = generateUBLInvoice(ublData);
    expect(xml).toContain('<cbc:UBLVersionID>2.1</cbc:UBLVersionID>');
  });

  test('should include invoice number', () => {
    const xml = generateUBLInvoice(ublData);
    expect(xml).toContain('<cbc:ID>42</cbc:ID>');
  });

  test('should include seller VAT number', () => {
    const xml = generateUBLInvoice(ublData);
    expect(xml).toContain('300000000000003');
  });

  test('should include all line items', () => {
    const xml = generateUBLInvoice(ublData);
    expect(xml).toContain('<cac:InvoiceLine>');
    expect(xml).toContain('خدمة استشارية');
    expect(xml).toContain('مواد بناء');
  });

  test('should include monetary totals', () => {
    const xml = generateUBLInvoice(ublData);
    expect(xml).toContain('1150.00');
    expect(xml).toContain('1000.00');
    expect(xml).toContain('150.00');
  });

  test('should escape XML special characters', () => {
    const dataWithSpecialChars = {
      ...ublData,
      items: [{ ...ublData.items[0], description: 'خدمة <خاصة> & "مهمة"' }],
    };
    const xml = generateUBLInvoice(dataWithSpecialChars);
    expect(xml).toContain('&lt;خاصة&gt;');
    expect(xml).toContain('&amp;');
    expect(xml).not.toContain('<خاصة>');
  });

  test('should set correct currency code', () => {
    const xml = generateUBLInvoice(ublData);
    expect(xml).toContain('currencyID="SAR"');
    expect(xml).toContain('<cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode>');
  });

  test('should include VAT rate as percentage', () => {
    const xml = generateUBLInvoice(ublData);
    expect(xml).toContain('<cbc:Percent>15</cbc:Percent>');
  });
});
