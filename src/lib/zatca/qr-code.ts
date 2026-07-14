/**
 * ZATCA Phase 2 — QR Code Generation (TLV Encoding)
 * 
 * Implements the simplified invoice QR code as specified by ZATCA:
 * https://zatca.gov.sa/en/E-Invoices/Pages/Electronic-invoices.aspx
 * 
 * The QR code contains a TLV (Tag-Length-Value) encoded string with:
 * - Tag 1: Seller name
 * - Tag 2: VAT registration number
 * - Tag 3: Invoice timestamp (ISO 8601)
 * - Tag 4: Invoice total (with VAT)
 * - Tag 5: VAT total
 * 
 * For Phase 2 (simplified), this is sufficient.
 * Phase 2 (standard) requires additional fields and cryptographic stamp.
 */

/**
 * Encode a string value in TLV format (Tag-Length-Value)
 * ZATCA uses base tag numbers starting from 1
 */
function tlvEncode(tag: number, value: string): Buffer {
  const valueBuffer = Buffer.from(value, 'utf-8');
  const tagBuffer = Buffer.from([tag]);
  const lengthBuffer = Buffer.from([valueBuffer.length]);
  return Buffer.concat([tagBuffer, lengthBuffer, valueBuffer]);
}

interface InvoiceQRData {
  /** Company/seller name (Arabic or English) */
  sellerName: string;
  /** VAT registration number (15 digits) */
  vatNumber: string;
  /** Invoice timestamp in ISO 8601 format */
  timestamp: string;
  /** Invoice total amount including VAT */
  invoiceTotal: number;
  /** VAT amount */
  vatTotal: number;
}

/**
 * Generate ZATCA-compliant QR code data (base64 encoded TLV)
 * This produces the string that should be encoded in the QR code
 */
export function generateZatcaQRData(data: InvoiceQRData): string {
  const { sellerName, vatNumber, timestamp, invoiceTotal, vatTotal } = data;

  // Validate VAT number format (15 digits for Saudi)
  if (!/^\d{15}$/.test(vatNumber)) {
    throw new Error('VAT number must be 15 digits');
  }

  // Build TLV blocks
  const tlv1 = tlvEncode(1, sellerName);
  const tlv2 = tlvEncode(2, vatNumber);
  const tlv3 = tlvEncode(3, timestamp);
  const tlv4 = tlvEncode(4, invoiceTotal.toFixed(2));
  const tlv5 = tlvEncode(5, vatTotal.toFixed(2));

  // Concatenate all TLV blocks
  const tlvBuffer = Buffer.concat([tlv1, tlv2, tlv3, tlv4, tlv5]);

  // Return as base64
  return tlvBuffer.toString('base64');
}

/**
 * Generate a data URI for the QR code that can be used in an <img> tag
 * Note: This requires a QR code library at runtime. For now, returns the data string.
 * In production, use a library like `qrcode` to render the actual QR image.
 */
export function getQRCodeString(data: InvoiceQRData): string {
  return generateZatcaQRData(data);
}

/**
 * Validate invoice data before generating QR code
 */
export function validateInvoiceForZatca(data: InvoiceQRData): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!data.sellerName || data.sellerName.trim().length === 0) {
    errors.push('اسم البائع مطلوب');
  }
  if (!/^\d{15}$/.test(data.vatNumber)) {
    errors.push('رقم التسجيل الضريبي يجب أن يكون 15 رقماً');
  }
  if (!data.timestamp || isNaN(Date.parse(data.timestamp))) {
    errors.push('وقت الفاتورة غير صحيح');
  }
  if (typeof data.invoiceTotal !== 'number' || data.invoiceTotal < 0) {
    errors.push('المبلغ الإجمالي يجب أن يكون رقماً موجباً');
  }
  if (typeof data.vatTotal !== 'number' || data.vatTotal < 0) {
    errors.push('مبلغ الضريبة يجب أن يكون رقماً موجباً');
  }
  if (data.vatTotal > data.invoiceTotal) {
    errors.push('مبلغ الضريبة لا يمكن أن يكون أكبر من الإجمالي');
  }

  return { valid: errors.length === 0, errors };
}
