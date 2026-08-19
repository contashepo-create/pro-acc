const PREFIXES: Record<string, string> = {
  sales_invoice: 'INV', purchase_invoice: 'PI', purchase_order: 'PO',
  receipt_voucher: 'RV', disbursement_voucher: 'DV', journal: 'JE', quotation: 'QT',
  credit_note: 'CN', change_order: 'CO', progress_billing: 'PB', pos_sale: 'POS',
  cash_transaction: 'CT', inventory_transaction: 'STK', bank_reconciliation: 'BR',
};

/** Consistent human-readable document number while retaining numeric DB sequences. */
export function formatDocumentNumber(type: keyof typeof PREFIXES | string, value: unknown, width = 4): string {
  const prefix = PREFIXES[type] || String(type).toUpperCase();
  const raw = String(value ?? '').trim();
  if (!raw) return `${prefix}-${'0'.repeat(width)}`;
  if (new RegExp(`^${prefix}-`, 'i').test(raw)) return raw.toUpperCase();
  return `${prefix}-${raw.padStart(width, '0')}`;
}
