/**
 * ZATCA E-Invoicing Module (Phase 2)
 * 
 * This module provides the foundation for ZATCA compliance:
 * - QR Code generation (TLV encoding for simplified invoices)
 * - UBL 2.1 XML invoice generation
 * 
 * Current Status: Phase 2 (Simplified) implementation
 * 
 * For Phase 2 (Standard), additional features needed:
 * - Cryptographic stamp (XML digital signature using ECDSA/rsa-pss)
 * - Invoice hash computation
 * - Integration with ZATCA clearance/reporting APIs
 * - UUID generation per ZATCA spec
 * 
 * References:
 * - ZATCA E-Invoicing: https://zatca.gov.sa/en/E-Invoices/
 * - UBL 2.1: https://docs.oasis-open.org/ubl/os-UBL-2.1/
 * - ISO 8601 timestamps
 */

export { generateZatcaQRData, getQRCodeString, validateInvoiceForZatca } from './qr-code';
export { generateUBLInvoice, generateInvoiceHash } from './ubl-builder';
