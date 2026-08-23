import { createHash } from 'crypto';
/**
 * UBL 2.1 XML invoice builder for ZATCA-oriented exports.
 *
 * This module deliberately produces an unsigned UBL document only. It does not
 * perform Phase 2 signing, invoice hash chaining, clearance or reporting.
 * Callers must not describe its output as a cleared/compliant Phase 2 invoice.
 *
 * Reference: https://docs.oasis-open.org/ubl/os-UBL-2.1/
 */

interface UBLInvoiceItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  total: number;
}

interface UBLInvoiceData {
  /** Invoice UUID */
  uuid: string;
  /** Invoice number */
  number: number;
  /** Issue date (YYYY-MM-DD) */
  issueDate: string;
  /** Issue time (HH:MM:SS) */
  issueTime: string;
  /** Invoice type code: 388=Tax Invoice, 389=Debit Note, 381=Credit Note */
  invoiceTypeCode: string;
  /** ZATCA subtype: 0100000=standard, 0200000=simplified. */
  invoiceTypeName?: '0100000' | '0200000';
  /** Document currency code */
  currencyCode: string;
  /** Seller info */
  seller: {
    name: string;
    vatNumber: string;
    registrationNumber?: string;
    address?: {
      street?: string;
      city?: string;
      postalZone?: string;
      country?: string;
    };
  };
  /** Buyer info */
  buyer: {
    name: string;
    vatNumber?: string;
    address?: {
      street?: string;
      city?: string;
      postalZone?: string;
      country?: string;
    };
  };
  /** Line items */
  items: UBLInvoiceItem[];
  /** Amounts */
  amounts: {
    lineExtensionAmount: number;
    taxExclusiveAmount: number;
    taxInclusiveAmount: number;
    taxAmount: number;
    allowanceTotalAmount?: number;
    chargeTotalAmount?: number;
  };
  /** VAT rate (e.g. 0.15 for 15%) */
  vatRate: number;
  /** Payment means code: 10=cash, 30=credit transfer, 42=bank account, etc. */
  paymentMeansCode?: string;
  /** Notes */
  notes?: string[];
}

function escapeXml(str: string | null | undefined): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const moneyMatches = (left: number, right: number) => Math.abs(left - right) <= 0.01;

function assertFinancialConsistency(data: UBLInvoiceData) {
  const monetaryValues = [
    data.amounts.lineExtensionAmount,
    data.amounts.taxExclusiveAmount,
    data.amounts.taxInclusiveAmount,
    data.amounts.taxAmount,
    data.amounts.allowanceTotalAmount ?? 0,
    data.amounts.chargeTotalAmount ?? 0,
  ];
  if (!data.items.length || monetaryValues.some((value) => !Number.isFinite(value) || value < 0)
    || !Number.isFinite(data.vatRate) || data.vatRate < 0 || data.vatRate > 1) {
    throw new Error('Invalid UBL financial values');
  }
  for (const item of data.items) {
    if (![item.quantity, item.unitPrice, item.total, item.vatRate].every(Number.isFinite)
      || item.quantity <= 0 || item.unitPrice < 0 || item.total < 0
      || item.vatRate < 0 || item.vatRate > 1) {
      throw new Error('Invalid UBL invoice line');
    }
  }

  const lineTotal = roundMoney(data.items.reduce((sum, item) => sum + item.total, 0));
  const expectedExclusive = roundMoney(
    lineTotal - (data.amounts.allowanceTotalAmount ?? 0) + (data.amounts.chargeTotalAmount ?? 0)
  );
  const expectedTax = roundMoney(data.amounts.taxExclusiveAmount * data.vatRate);
  const expectedInclusive = roundMoney(data.amounts.taxExclusiveAmount + data.amounts.taxAmount);
  if (!moneyMatches(lineTotal, data.amounts.lineExtensionAmount)
    || !moneyMatches(expectedExclusive, data.amounts.taxExclusiveAmount)
    || !moneyMatches(expectedTax, data.amounts.taxAmount)
    || !moneyMatches(expectedInclusive, data.amounts.taxInclusiveAmount)) {
    throw new Error('Inconsistent UBL invoice totals');
  }
}

/** Generate an unsigned, financially consistent UBL 2.1 XML invoice. */
export function generateUBLInvoice(data: UBLInvoiceData): string {
  assertFinancialConsistency(data);
  const {
    uuid, number, seller, buyer, items, amounts, vatRate, notes,
  } = data;

  // Escape every scalar interpolated raw into an XML element/attribute position
  const issueDate = escapeXml(data.issueDate);
  const issueTime = escapeXml(data.issueTime);
  const invoiceTypeCode = escapeXml(data.invoiceTypeCode);
  const invoiceTypeName = escapeXml(data.invoiceTypeName ?? '0200000');
  const currencyCode = escapeXml(data.currencyCode);
  const paymentMeansCode =
    data.paymentMeansCode != null ? escapeXml(data.paymentMeansCode) : undefined;

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
         xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
  
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
  <cbc:ID>${number}</cbc:ID>
  <cbc:UUID>${escapeXml(uuid)}</cbc:UUID>
  <cbc:IssueDate>${issueDate}</cbc:IssueDate>
  <cbc:IssueTime>${issueTime}</cbc:IssueTime>
  <cbc:InvoiceTypeCode name="${invoiceTypeName}">${invoiceTypeCode}</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${currencyCode}</cbc:DocumentCurrencyCode>
  <cbc:TaxCurrencyCode>${currencyCode}</cbc:TaxCurrencyCode>`;

  // Notes
  if (notes) {
    for (const note of notes) {
      xml += `\n  <cbc:Note>${escapeXml(note)}</cbc:Note>`;
    }
  }

  // Seller (AccountingSupplierParty)
  xml += `
  
  <cac:AccountingSupplierParty>
    <cac:Party>
      ${seller.registrationNumber ? `<cac:PartyIdentification><cbc:ID schemeID="CRN">${escapeXml(seller.registrationNumber)}</cbc:ID></cac:PartyIdentification>` : ''}
      <cac:PostalAddress>
        ${seller.address?.street ? `<cbc:StreetName>${escapeXml(seller.address.street)}</cbc:StreetName>` : ''}
        ${seller.address?.city ? `<cbc:CityName>${escapeXml(seller.address.city)}</cbc:CityName>` : ''}
        ${seller.address?.postalZone ? `<cbc:PostalZone>${escapeXml(seller.address.postalZone)}</cbc:PostalZone>` : ''}
        ${seller.address?.country ? `<cac:Country><cbc:IdentificationCode>${escapeXml(seller.address.country)}</cbc:IdentificationCode></cac:Country>` : '<cac:Country><cbc:IdentificationCode>SA</cbc:IdentificationCode></cac:Country>'}
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${escapeXml(seller.vatNumber)}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escapeXml(seller.name)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>`;

  // Buyer (AccountingCustomerParty)
  xml += `
  
  <cac:AccountingCustomerParty>
    <cac:Party>
      ${buyer.vatNumber ? `<cac:PartyIdentification><cbc:ID schemeID="VAT">${escapeXml(buyer.vatNumber)}</cbc:ID></cac:PartyIdentification>` : ''}
      <cac:PostalAddress>
        ${buyer.address?.street ? `<cbc:StreetName>${escapeXml(buyer.address.street)}</cbc:StreetName>` : ''}
        ${buyer.address?.city ? `<cbc:CityName>${escapeXml(buyer.address.city)}</cbc:CityName>` : ''}
        ${buyer.address?.postalZone ? `<cbc:PostalZone>${escapeXml(buyer.address.postalZone)}</cbc:PostalZone>` : ''}
        ${buyer.address?.country ? `<cac:Country><cbc:IdentificationCode>${escapeXml(buyer.address.country)}</cbc:IdentificationCode></cac:Country>` : '<cac:Country><cbc:IdentificationCode>SA</cbc:IdentificationCode></cac:Country>'}
      </cac:PostalAddress>
      ${buyer.vatNumber ? `<cac:PartyTaxScheme><cbc:CompanyID>${escapeXml(buyer.vatNumber)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : ''}
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escapeXml(buyer.name)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>`;

  // Payment means
  if (paymentMeansCode) {
    xml += `
  
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>${paymentMeansCode}</cbc:PaymentMeansCode>
  </cac:PaymentMeans>`;
  }

  // Tax totals
  xml += `
  
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${currencyCode}">${amounts.taxAmount.toFixed(2)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${currencyCode}">${amounts.taxExclusiveAmount.toFixed(2)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${currencyCode}">${amounts.taxAmount.toFixed(2)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>${(vatRate * 100).toFixed(0)}</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>`;

  // Legal totals
  xml += `
  
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${currencyCode}">${amounts.lineExtensionAmount.toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${currencyCode}">${amounts.taxExclusiveAmount.toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${currencyCode}">${amounts.taxInclusiveAmount.toFixed(2)}</cbc:TaxInclusiveAmount>
    ${amounts.allowanceTotalAmount !== undefined ? `<cbc:AllowanceTotalAmount currencyID="${currencyCode}">${amounts.allowanceTotalAmount.toFixed(2)}</cbc:AllowanceTotalAmount>` : ''}
    ${amounts.chargeTotalAmount !== undefined ? `<cbc:ChargeTotalAmount currencyID="${currencyCode}">${amounts.chargeTotalAmount.toFixed(2)}</cbc:ChargeTotalAmount>` : ''}
    <cbc:PayableAmount currencyID="${currencyCode}">${amounts.taxInclusiveAmount.toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>`;

  // Invoice lines
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    xml += `
  
  <cac:InvoiceLine>
    <cbc:ID>${i + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="PCE">${item.quantity}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${currencyCode}">${item.total.toFixed(2)}</cbc:LineExtensionAmount>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="${currencyCode}">${roundMoney(item.total * item.vatRate).toFixed(2)}</cbc:TaxAmount>
      <cbc:RoundingAmount currencyID="${currencyCode}">${item.total.toFixed(2)}</cbc:RoundingAmount>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Name>${escapeXml(item.description)}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>${(item.vatRate * 100).toFixed(0)}</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${currencyCode}">${item.unitPrice.toFixed(2)}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`;
  }

  xml += `\n</Invoice>`;
  return xml;
}

/** Raw SHA-256 digest helper. This is not a ZATCA signature, stamp or hash chain. */
export function generateInvoiceHash(xmlContent: string): string {
  return createHash('sha256').update(xmlContent).digest('base64');
}
