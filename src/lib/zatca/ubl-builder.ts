/**
 * ZATCA Phase 2 — UBL 2.1 XML Invoice Builder
 * 
 * Generates a simplified UBL 2.1 XML invoice document
 * compliant with ZATCA E-Invoicing requirements.
 * 
 * Reference: UBL 2.1 specification + ZATCA implementation guidelines
 * https://docs.oasis-open.org/ubl/os-UBL-2.1/
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
  /** Document currency code */
  currencyCode: string;
  /** Seller info */
  seller: {
    name: string;
    vatNumber: string;
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

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generate a UBL 2.1 XML invoice document
 */
export function generateUBLInvoice(data: UBLInvoiceData): string {
  const {
    uuid, number, issueDate, issueTime, invoiceTypeCode, currencyCode,
    seller, buyer, items, amounts, vatRate, paymentMeansCode, notes,
  } = data;

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
  <cbc:InvoiceTypeCode name="0200000">${invoiceTypeCode}</cbc:InvoiceTypeCode>
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
      <cac:PartyIdentification>
        <cbc:ID schemeID="CRN">${escapeXml(seller.vatNumber)}</cbc:ID>
      </cac:PartyIdentification>
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
      <cbc:TaxAmount currencyID="${currencyCode}">${(item.total * item.vatRate / (1 + item.vatRate)).toFixed(2)}</cbc:TaxAmount>
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

/**
 * Generate XML hash for cryptographic stamp (placeholder for Phase 2 standard invoices)
 * In production, this should use the actual invoice hash + private key signing
 */
export function generateInvoiceHash(xmlContent: string): string {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(xmlContent).digest('base64');
}
