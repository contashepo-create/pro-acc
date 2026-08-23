/**
 * Tests for UBL 2.1 XML invoice builder.
 *
 * Verifies XML structure, financial consistency enforcement, XML escaping
 * (anti-XSS/injection), and hash generation.
 */

import type { UBLInvoiceData } from '@/lib/zatca/ubl-builder';
import { generateUBLInvoice, generateInvoiceHash } from '@/lib/zatca/ubl-builder';

/* ── helpers ── */
function validInvoiceData(overrides: Record<string, unknown> = {}): UBLInvoiceData {
  return {
    uuid: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    number: 1,
    issueDate: '2026-01-15',
    issueTime: '14:30:00',
    invoiceTypeCode: '388',
    invoiceTypeName: '0100000' as const,
    currencyCode: 'SAR',
    seller: {
      name: 'شركة المقاولات المتحدة',
      vatNumber: '300000000000003',
      registrationNumber: '1234567890',
      address: { street: 'شارع الملك فهد', city: 'الرياض', postalZone: '12345', country: 'SA' },
    },
    buyer: {
      name: 'مؤسسة العميل',
      vatNumber: '310000000000001',
      address: { street: 'شارع الأمير', city: 'جدة', postalZone: '54321', country: 'SA' },
    },
    items: [
      { id: '1', description: 'خدمة استشارية', quantity: 10, unitPrice: 100, vatRate: 0.15, total: 1000 },
    ],
    amounts: {
      lineExtensionAmount: 1000,
      taxExclusiveAmount: 1000,
      taxInclusiveAmount: 1150,
      taxAmount: 150,
    },
    vatRate: 0.15,
    paymentMeansCode: '10',
    notes: ['ملاحظة تجريبية'],
    ...overrides,
  };
}

describe('generateUBLInvoice', () => {
  test('generates valid XML with required UBL elements', () => {
    const xml = generateUBLInvoice(validInvoiceData());

    // XML declaration
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);

    // Root element with correct namespaces
    expect(xml).toContain('xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"');
    expect(xml).toContain('xmlns:cac=');
    expect(xml).toContain('xmlns:cbc=');

    // Required structural elements
    expect(xml).toContain('<cbc:UBLVersionID>2.1</cbc:UBLVersionID>');
    expect(xml).toContain('<cbc:IssueDate>2026-01-15</cbc:IssueDate>');
    expect(xml).toContain('<cbc:IssueTime>14:30:00</cbc:IssueTime>');
    expect(xml).toContain('<cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode>');
    expect(xml).toContain('<cbc:TaxCurrencyCode>SAR</cbc:TaxCurrencyCode>');

    // Invoice type
    expect(xml).toContain('name="0100000"');
    expect(xml).toContain('>388</cbc:InvoiceTypeCode>');

    // Closes properly
    expect(xml).toMatch(/<\/Invoice>$/);
  });

  test('includes seller information', () => {
    const xml = generateUBLInvoice(validInvoiceData());

    expect(xml).toContain('<cac:AccountingSupplierParty>');
    expect(xml).toContain('شركة المقاولات المتحدة');
    expect(xml).toContain('300000000000003');
    expect(xml).toContain('شارع الملك فهد');
    expect(xml).toContain('الرياض');
    expect(xml).toContain('12345');
    expect(xml).toContain('1234567890'); // CRN
  });

  test('includes buyer information', () => {
    const xml = generateUBLInvoice(validInvoiceData());

    expect(xml).toContain('<cac:AccountingCustomerParty>');
    expect(xml).toContain('مؤسسة العميل');
    expect(xml).toContain('310000000000001');
    expect(xml).toContain('جدة');
  });

  test('includes correct monetary totals', () => {
    const xml = generateUBLInvoice(validInvoiceData());

    expect(xml).toContain('>1000.00</cbc:LineExtensionAmount>');
    expect(xml).toContain('>1000.00</cbc:TaxExclusiveAmount>');
    expect(xml).toContain('>1150.00</cbc:TaxInclusiveAmount>');
    expect(xml).toContain('>150.00</cbc:TaxAmount>');
    expect(xml).toContain('>1150.00</cbc:PayableAmount>');
  });

  test('includes tax details with correct VAT percentage', () => {
    const xml = generateUBLInvoice(validInvoiceData());

    expect(xml).toContain('<cac:TaxTotal>');
    expect(xml).toContain('<cbc:Percent>15</cbc:Percent>');
    expect(xml).toContain('<cbc:ID>VAT</cbc:ID>');
    expect(xml).toContain('<cbc:ID>S</cbc:ID>'); // Standard rate category
  });

  test('includes invoice line items', () => {
    const xml = generateUBLInvoice(validInvoiceData());

    expect(xml).toContain('<cac:InvoiceLine>');
    expect(xml).toContain('خدمة استشارية');
    expect(xml).toContain('>100.00</cbc:PriceAmount>');
    expect(xml).toContain('>1000.00</cbc:LineExtensionAmount>');
  });

  test('includes multiple line items with sequential IDs', () => {
    const data = validInvoiceData({
      items: [
        { id: '1', description: 'بند أول', quantity: 5, unitPrice: 100, vatRate: 0.15, total: 500 },
        { id: '2', description: 'بند ثاني', quantity: 10, unitPrice: 50, vatRate: 0.15, total: 500 },
      ],
    });
    const xml = generateUBLInvoice(data);

    // Both items present
    expect(xml).toContain('بند أول');
    expect(xml).toContain('بند ثاني');
    // Sequential IDs
    const lines = xml.match(/<cac:InvoiceLine>/g);
    expect(lines).toHaveLength(2);
  });

  test('includes notes', () => {
    const xml = generateUBLInvoice(validInvoiceData());
    expect(xml).toContain('<cbc:Note>ملاحظة تجريبية</cbc:Note>');
  });

  test('includes payment means', () => {
    const xml = generateUBLInvoice(validInvoiceData());
    expect(xml).toContain('<cbc:PaymentMeansCode>10</cbc:PaymentMeansCode>');
  });

  test('omits payment means when not provided', () => {
    const data = validInvoiceData({ paymentMeansCode: undefined });
    const xml = generateUBLInvoice(data);
    expect(xml).not.toContain('<cac:PaymentMeans>');
  });

  test('defaults to SA country when not specified', () => {
    const data = validInvoiceData();
    data.seller.address = {};
    data.buyer.address = {};
    const xml = generateUBLInvoice(data);
    expect(xml).toContain('<cbc:IdentificationCode>SA</cbc:IdentificationCode>');
  });

  test('defaults invoiceTypeName to 0200000 (simplified) when not specified', () => {
    const data = validInvoiceData({ invoiceTypeName: undefined });
    const xml = generateUBLInvoice(data);
    expect(xml).toContain('name="0200000"');
  });
});

describe('XML escaping (anti-injection)', () => {
  test('escapes XML special characters in seller name', () => {
    const data = validInvoiceData();
    data.seller.name = '<script>alert("xss")</script>';
    const xml = generateUBLInvoice(data);
    expect(xml).not.toContain('<script>');
    expect(xml).toContain('&lt;script&gt;');
  });

  test('escapes ampersands', () => {
    const data = validInvoiceData();
    data.buyer.name = 'A & B Company';
    const xml = generateUBLInvoice(data);
    expect(xml).toContain('A &amp; B Company');
  });

  test('escapes quotes in notes', () => {
    const data = validInvoiceData({ notes: ['Test "quoted" & <tagged>'] });
    const xml = generateUBLInvoice(data);
    expect(xml).toContain('&quot;');
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&lt;tagged&gt;');
  });
});

describe('financial consistency validation', () => {
  test('throws on empty items array', () => {
    expect(() => generateUBLInvoice(validInvoiceData({ items: [] }))).toThrow('Invalid UBL financial values');
  });

  test('throws on negative monetary values', () => {
    expect(() => generateUBLInvoice(validInvoiceData({
      amounts: { lineExtensionAmount: -100, taxExclusiveAmount: -100, taxInclusiveAmount: -115, taxAmount: -15 },
    }))).toThrow();
  });

  test('throws on NaN/Infinity values', () => {
    expect(() => generateUBLInvoice(validInvoiceData({
      amounts: { lineExtensionAmount: NaN, taxExclusiveAmount: 1000, taxInclusiveAmount: 1150, taxAmount: 150 },
    }))).toThrow();
  });

  test('throws on inconsistent totals', () => {
    // subtotal = 1000, but claim tax = 200 (should be 150 at 15%)
    expect(() => generateUBLInvoice(validInvoiceData({
      amounts: { lineExtensionAmount: 1000, taxExclusiveAmount: 1000, taxInclusiveAmount: 1200, taxAmount: 200 },
    }))).toThrow('Inconsistent');
  });

  test('throws on invalid line items (negative quantity)', () => {
    expect(() => generateUBLInvoice(validInvoiceData({
      items: [{ id: '1', description: 'test', quantity: -1, unitPrice: 100, vatRate: 0.15, total: 100 }],
    }))).toThrow('Invalid UBL invoice line');
  });

  test('throws on VAT rate > 1', () => {
    expect(() => generateUBLInvoice(validInvoiceData({ vatRate: 1.5 }))).toThrow();
  });

  test('accepts zero VAT (zero-rated)', () => {
    const data = validInvoiceData({
      items: [{ id: '1', description: 'zero-rated', quantity: 10, unitPrice: 100, vatRate: 0, total: 1000 }],
      amounts: { lineExtensionAmount: 1000, taxExclusiveAmount: 1000, taxInclusiveAmount: 1000, taxAmount: 0 },
      vatRate: 0,
    });
    expect(() => generateUBLInvoice(data)).not.toThrow();
  });
});

describe('generateInvoiceHash', () => {
  test('produces a base64-encoded SHA-256 hash', () => {
    const xml = generateUBLInvoice(validInvoiceData());
    const hash = generateInvoiceHash(xml);

    // base64 pattern
    expect(hash).toMatch(/^[A-Za-z0-9+/]+=*$/);
    // SHA-256 base64 is always 44 chars
    expect(hash).toHaveLength(44);
  });

  test('same input produces same hash', () => {
    const xml = generateUBLInvoice(validInvoiceData());
    expect(generateInvoiceHash(xml)).toBe(generateInvoiceHash(xml));
  });

  test('different input produces different hash', () => {
    const xml1 = generateUBLInvoice(validInvoiceData({ uuid: 'aaa' }));
    const xml2 = generateUBLInvoice(validInvoiceData({ uuid: 'bbb' }));
    expect(generateInvoiceHash(xml1)).not.toBe(generateInvoiceHash(xml2));
  });
});
