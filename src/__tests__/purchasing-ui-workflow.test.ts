import fs from 'fs';
import path from 'path';
import { formatDocumentNumber } from '@/lib/document-number';

const root = path.resolve(__dirname, '..');
const source = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('document number presentation', () => {
  test('uses stable prefixes and zero-padded automatic sequences', () => {
    expect(formatDocumentNumber('purchase_order', 1)).toBe('PO-0001');
    expect(formatDocumentNumber('purchase_invoice', '27')).toBe('PI-0027');
    expect(formatDocumentNumber('sales_invoice', 18)).toBe('INV-0018');
    expect(formatDocumentNumber('receipt_voucher', 3)).toBe('RV-0003');
    expect(formatDocumentNumber('progress_billing', 'PB-000014')).toBe('PB-000014');
  });
});

describe('purchasing and stock UI wiring', () => {
  test('inventory creation loads and requires an active warehouse', () => {
    const inventory = source('app/(dashboard)/inventory/page.tsx');
    expect(inventory).toContain("fetch('/api/warehouses')");
    expect(inventory).toContain('label="المستودع *"');
    expect(inventory).toContain("!form.warehouse_id");
  });

  test('sidebar exposes warehouses and stock adjustments', () => {
    const sidebar = source('components/layout/Sidebar.tsx');
    expect(sidebar).toContain("{ id: 'warehouses', label: 'المستودعات' }");
    expect(sidebar).toContain("{ id: 'inventory-transactions', label: 'حركات وتسوية المخزون' }");
  });

  test('selecting a received PO copies its supplier and lines into the invoice', () => {
    const invoices = source('app/(dashboard)/purchases/invoices/page.tsx');
    expect(invoices).toContain('const applyPurchaseOrder');
    expect(invoices).toContain('supplier_id: order.supplier_id');
    expect(invoices).toContain("order.status === 'received'");
    expect(invoices).toContain('items: (order.items || []).map');
  });

  test('supplier form and print contain business, address, bank, and notes fields', () => {
    const suppliers = source('app/(dashboard)/suppliers/page.tsx');
    for (const field of ['commercial_registration', 'address', 'contact_person', 'iban', 'payment_terms', 'notes']) {
      expect(suppliers).toContain(field);
    }
    expect(suppliers).toContain('بطاقة بيانات مورد');
    expect(suppliers).toContain('onPrint={handlePrint}');
  });
});
