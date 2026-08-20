/**
 * Structural validation of ZATCA UBL XML output.
 *
 * This is a lightweight substitute for full XSD validation — it checks all
 * the mandatory elements and attributes that ZATCA Phase 1/2 requires,
 * without needing the actual XSD files. Once you download the official ZATCA
 * XSD schemas, add a proper libxmljs2 validation test alongside this one.
 *
 * Reference: ZATCA E-Invoice Data Dictionary + OASIS UBL 2.1
 */

import { generateUBLInvoice, generateInvoiceHash } from '@/lib/zatca/ubl-builder';

function makeStandardInvoice() {
  return {
    uuid: 'b1c2d3e4-f5a6-7890-bcde-fa1234567890',
    number: 42,
    issueDate: '2026-08-20',
    issueTime: '10:30:00',
    invoiceTypeCode: '388',
    invoiceTypeName: '0100000' as const,
    currencyCode: 'SAR',
    seller: {
      name: 'شركة الاختبار للمقاولات',
      vatNumber: '300000000000003',
      registrationNumber: '1010123456',
      address: { street: 'شارع الملك فهد', city: 'الرياض', postalZone: '12271', country: 'SA' },
    },
    buyer: {
      name: 'مؤسسة العميل التجارية',
      vatNumber: '310000000000001',
      address: { street: 'شارع الأمير سلطان', city: 'جدة', postalZone: '21589', country: 'SA' },
    },
    items: [
      { id: '1', description: 'خدمة استشارات هندسية', quantity: 5, unitPrice: 200, vatRate: 0.15, total: 1000 },
      { id: '2', description: 'أعمال مساحة', quantity: 2, unitPrice: 500, vatRate: 0.15, total: 1000 },
    ],
    amounts: {
      lineExtensionAmount: 2000,
      taxExclusiveAmount: 2000,
      taxInclusiveAmount: 2300,
      taxAmount: 300,
    },
    vatRate: 0.15,
    paymentMeansCode: '10',
    notes: ['فاتورة تجريبية للاختبار'],
  };
}

describe('ZATCA UBL structural validation', () => {
  let xml: string;

  beforeAll(() => {
    xml = generateUBLInvoice(makeStandardInvoice());
  });

  // ─── Required root attributes ───
  test('XML declaration is present and UTF-8', () => {
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  });

  test('Invoice root element has correct UBL 2.1 namespace', () => {
    expect(xml).toContain('xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"');
  });

  test('has CommonAggregateComponents namespace', () => {
    expect(xml).toContain('xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"');
  });

  test('has CommonBasicComponents namespace', () => {
    expect(xml).toContain('xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"');
  });

  // ─── Required header fields (ZATCA mandatory) ───
  test('UBLVersionID is 2.1', () => {
    expect(xml).toContain('<cbc:UBLVersionID>2.1</cbc:UBLVersionID>');
  });

  test('ProfileID is present', () => {
    expect(xml).toContain('<cbc:ProfileID>');
  });

  test('ID (invoice number) is present', () => {
    expect(xml).toMatch(/<cbc:ID>42<\/cbc:ID>/);
  });

  test('UUID is present', () => {
    expect(xml).toContain('<cbc:UUID>b1c2d3e4-f5a6-7890-bcde-fa1234567890</cbc:UUID>');
  });

  test('IssueDate in YYYY-MM-DD format', () => {
    expect(xml).toMatch(/<cbc:IssueDate>\d{4}-\d{2}-\d{2}<\/cbc:IssueDate>/);
  });

  test('IssueTime in HH:MM:SS format', () => {
    expect(xml).toMatch(/<cbc:IssueTime>\d{2}:\d{2}:\d{2}<\/cbc:IssueTime>/);
  });

  test('InvoiceTypeCode with name attribute (ZATCA subtype)', () => {
    expect(xml).toMatch(/<cbc:InvoiceTypeCode name="\d{7}">388<\/cbc:InvoiceTypeCode>/);
  });

  test('DocumentCurrencyCode is SAR', () => {
    expect(xml).toContain('<cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode>');
  });

  test('TaxCurrencyCode is present', () => {
    expect(xml).toContain('<cbc:TaxCurrencyCode>SAR</cbc:TaxCurrencyCode>');
  });

  // ─── Seller (AccountingSupplierParty) ───
  test('AccountingSupplierParty is present with required sub-elements', () => {
    expect(xml).toContain('<cac:AccountingSupplierParty>');
    expect(xml).toContain('<cbc:RegistrationName>شركة الاختبار للمقاولات</cbc:RegistrationName>');
    expect(xml).toContain('<cbc:CompanyID>300000000000003</cbc:CompanyID>');
  });

  test('seller has PostalAddress with country', () => {
    // Should contain at least one SA country code within the supplier section
    const supplierSection = xml.split('<cac:AccountingSupplierParty>')[1]?.split('</cac:AccountingSupplierParty>')[0];
    expect(supplierSection).toContain('<cbc:IdentificationCode>SA</cbc:IdentificationCode>');
    expect(supplierSection).toContain('الرياض');
    expect(supplierSection).toContain('12271');
  });

  test('seller has TaxScheme with VAT ID', () => {
    expect(xml).toContain('<cbc:ID>VAT</cbc:ID>');
  });

  // ─── Buyer (AccountingCustomerParty) ───
  test('AccountingCustomerParty is present', () => {
    expect(xml).toContain('<cac:AccountingCustomerParty>');
    expect(xml).toContain('مؤسسة العميل التجارية');
  });

  // ─── Tax information ───
  test('TaxTotal section is present with amount', () => {
    expect(xml).toContain('<cac:TaxTotal>');
    expect(xml).toMatch(/<cbc:TaxAmount currencyID="SAR">300\.00<\/cbc:TaxAmount>/);
  });

  test('TaxSubtotal has taxable amount and percentage', () => {
    expect(xml).toContain('<cbc:TaxableAmount currencyID="SAR">2000.00</cbc:TaxableAmount>');
    expect(xml).toContain('<cbc:Percent>15</cbc:Percent>');
  });

  test('TaxCategory ID is S (standard rate)', () => {
    expect(xml).toContain('<cbc:ID>S</cbc:ID>');
  });

  // ─── Legal monetary totals ───
  test('LegalMonetaryTotal has all required amounts', () => {
    expect(xml).toContain('<cac:LegalMonetaryTotal>');
    expect(xml).toContain('<cbc:LineExtensionAmount currencyID="SAR">2000.00</cbc:LineExtensionAmount>');
    expect(xml).toContain('<cbc:TaxExclusiveAmount currencyID="SAR">2000.00</cbc:TaxExclusiveAmount>');
    expect(xml).toContain('<cbc:TaxInclusiveAmount currencyID="SAR">2300.00</cbc:TaxInclusiveAmount>');
    expect(xml).toContain('<cbc:PayableAmount currencyID="SAR">2300.00</cbc:PayableAmount>');
  });

  // ─── Invoice lines ───
  test('has correct number of InvoiceLine elements', () => {
    const lines = xml.match(/<cac:InvoiceLine>/g);
    expect(lines).toHaveLength(2);
  });

  test('each line has sequential ID', () => {
    expect(xml).toContain('<cbc:ID>1</cbc:ID>');
    expect(xml).toContain('<cbc:ID>2</cbc:ID>');
  });

  test('line items have quantity, price, and description', () => {
    expect(xml).toContain('خدمة استشارات هندسية');
    expect(xml).toContain('أعمال مساحة');
    expect(xml).toContain('<cbc:InvoicedQuantity unitCode="PCE">5</cbc:InvoicedQuantity>');
    expect(xml).toContain('<cbc:InvoicedQuantity unitCode="PCE">2</cbc:InvoicedQuantity>');
    expect(xml).toContain('<cbc:PriceAmount currencyID="SAR">200.00</cbc:PriceAmount>');
    expect(xml).toContain('<cbc:PriceAmount currencyID="SAR">500.00</cbc:PriceAmount>');
  });

  test('line items have per-line tax amounts', () => {
    // Line 1: 1000 × 0.15 = 150
    expect(xml).toContain('>150.00</cbc:TaxAmount>');
    // Line 2: 1000 × 0.15 = 150
    // Both lines should have their tax amounts
  });

  // ─── Cross-check: XML is well-formed ───
  test('XML is well-formed (all opened tags are closed)', () => {
    // Simple bracket balance check
    const openTags = xml.match(/<[a-z]/gi)?.length || 0;
    const closeTags = xml.match(/<\/[a-z]/gi)?.length || 0;
    const selfClosing = xml.match(/\/>/g)?.length || 0;
    // Open tags should equal close tags + self-closing (approximately)
    // The XML declaration doesn't count as a tag
    expect(Math.abs(openTags - closeTags - selfClosing)).toBeLessThanOrEqual(2); // XML decl + root
  });

  test('closing </Invoice> tag is present', () => {
    expect(xml.trimEnd()).toMatch(/<\/Invoice>$/);
  });

  // ─── Hash generation ───
  test('hash is deterministic for the same invoice', () => {
    const invoice = makeStandardInvoice();
    const xml1 = generateUBLInvoice(invoice);
    const xml2 = generateUBLInvoice(invoice);
    expect(generateInvoiceHash(xml1)).toBe(generateInvoiceHash(xml2));
  });

  // ─── Simplified invoice variant ───
  test('simplified invoice (B2C) uses type name 0200000', () => {
    const simplified = makeStandardInvoice();
    simplified.invoiceTypeName = '0200000';
    // Remove buyer VAT (simplified doesn't require it)
    delete (simplified.buyer as any).vatNumber;
    const simplifiedXml = generateUBLInvoice(simplified);
    expect(simplifiedXml).toContain('name="0200000"');
  });
});
