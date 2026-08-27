/**
 * Tests for document-number formatting.
 * Pure function — no external dependencies.
 */

import { formatDocumentNumber } from '@/lib/document-number';

describe('formatDocumentNumber', () => {
  test.each([
    ['sales_invoice', 1, 'INV-0001'],
    ['sales_invoice', 42, 'INV-0042'],
    ['sales_invoice', 9999, 'INV-9999'],
    ['sales_invoice', 12345, 'INV-12345'],
    ['purchase_invoice', 7, 'PI-0007'],
    ['purchase_order', 100, 'PO-0100'],
    ['receipt_voucher', 3, 'RV-0003'],
    ['disbursement_voucher', 55, 'DV-0055'],
    ['journal', 1, 'JE-0001'],
    ['quotation', 999, 'QT-0999'],
    ['credit_note', 1, 'CN-0001'],
    ['change_order', 2, 'CO-0002'],
    ['progress_billing', 10, 'PB-0010'],
    ['pos_sale', 5, 'POS-0005'],
    ['cash_transaction', 8, 'CT-0008'],
    ['inventory_transaction', 3, 'STK-0003'],
    ['bank_reconciliation', 1, 'BR-0001'],
  ])('formats %s number %d as %s', (type, value, expected) => {
    expect(formatDocumentNumber(type, value)).toBe(expected);
  });

  test('uses custom width', () => {
    expect(formatDocumentNumber('sales_invoice', 1, 6)).toBe('INV-000001');
    expect(formatDocumentNumber('journal', 42, 8)).toBe('JE-00000042');
  });

  test('unknown type uses uppercased type as prefix', () => {
    expect(formatDocumentNumber('custom_doc', 5)).toBe('CUSTOM_DOC-0005');
  });

  test('null/undefined/empty value produces zero-padded placeholder', () => {
    expect(formatDocumentNumber('sales_invoice', null)).toBe('INV-0000');
    expect(formatDocumentNumber('sales_invoice', undefined)).toBe('INV-0000');
    expect(formatDocumentNumber('sales_invoice', '')).toBe('INV-0000');
    expect(formatDocumentNumber('sales_invoice', '  ')).toBe('INV-0000');
  });

  test('value already prefixed is returned uppercased as-is', () => {
    expect(formatDocumentNumber('sales_invoice', 'inv-0042')).toBe('INV-0042');
    expect(formatDocumentNumber('sales_invoice', 'INV-1234')).toBe('INV-1234');
  });

  test('string numeric value is zero-padded', () => {
    expect(formatDocumentNumber('sales_invoice', '7')).toBe('INV-0007');
    expect(formatDocumentNumber('sales_invoice', '123')).toBe('INV-0123');
  });
});
