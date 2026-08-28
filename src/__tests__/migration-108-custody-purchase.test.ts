import fs from 'fs';
import path from 'path';

describe('ميجريشن 108 — عهدة وفاتورة شراء وسداد مورد', () => {
  const sql = fs.readFileSync(
    path.join(process.cwd(), 'src', 'migrations', '108-custody-purchase-pay-and-cancel.sql'),
    'utf8',
  );

  test('فاتورة بلا أمر شراء لا ترحّل على رأس التكلفة', () => {
    expect(sql).toContain("THEN '5110' ELSE '5400'");
    expect(sql).not.toMatch(/ELSE '5100'/);
    expect(sql).toContain("THEN '5400' ELSE '5110'");
    expect(sql).toContain("'contactId',p_supplier_id");
  });

  test('إلغاء الملف يعكس كل تعزيز لا الافتتاح وحده', () => {
    expect(sql).toContain('cancel_custody_file_v49_internal');
    expect(sql).toContain("type IN ('addition','receipt')");
    expect(sql).toContain('عكس حركة عهدة');
    expect(sql).toContain("DELETE FROM custody_transactions");
  });

  test('سداد ذمة مورد قائمة من العهدة يخفض الموردين لا المصروف', () => {
    expect(sql).toContain('pay_purchase_invoice_from_custody');
    expect(sql).toContain("code='2110'");
    expect(sql).toContain("code='1150'");
    expect(sql).toContain("reference_type='custody_ap_payment'");
    expect(sql).toContain("COALESCE(v_inv.payment_source,'ap')='custody'");
  });
});
