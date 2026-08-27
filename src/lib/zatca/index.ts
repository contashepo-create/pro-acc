/**
 * Tax-document presentation helpers.
 *
 * Current capability is deliberately limited to:
 * - ZATCA Phase 1 TLV QR fields (tags 1–5)
 * - financially validated, unsigned UBL 2.1 XML
 *
 * This is not a Phase 2 implementation: no XML signature, cryptographic stamp,
 * hash chain, clearance or reporting integration is provided.
 */

export { generateZatcaQRData, getQRCodeString, validateInvoiceForZatca } from './qr-code';
export { generateUBLInvoice, generateInvoiceHash } from './ubl-builder';
