import fs from 'fs';
import path from 'path';

describe('ميجريشن 105 — حسابات الرواتب وخصم المنبع', () => {
  const sql = fs.readFileSync(
    path.join(process.cwd(), 'src', 'migrations', '105-hr-accounts-and-withholding.sql'),
    'utf8',
  );

  test('ينشئ حسابات التأمينات ونهاية الخدمة بأرقام غير متصادمة مع الكهرباء والاتصالات', () => {
    expect(sql).toContain("('5215', 'مصروف التأمينات الاجتماعية'");
    expect(sql).toContain("('5216', 'مصروف مستحقات نهاية الخدمة'");
    expect(sql).toContain("('2155', 'مستحقات التأمينات الاجتماعية'");
    expect(sql).toContain("code='5215'");
    expect(sql).toContain("code='5216'");
    expect(sql).not.toMatch(/SELECT id INTO v_gosi_employer_account FROM accounts WHERE company_id=p_company_id AND code='5230'/);
    expect(sql).not.toMatch(/SELECT id INTO v_expense FROM accounts WHERE company_id=p_company_id AND code='5240'/);
  });

  test('خصم المنبع على فاتورة المشتريات يخفض ذمة المورد لمصر فقط', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS withholding_rate');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS withholding_amount');
    expect(sql).toContain('p_withholding_rate NUMERIC DEFAULT 0');
    expect(sql).toContain('خصم المنبع متاح للشركات المصرية فقط');
    expect(sql).toContain("code='2165'");
    expect(sql).toContain('total=ROUND(total-v_wh_amount,2)');
    expect(sql).not.toMatch(/^O service_role/m);
  });

  test('نهاية الخدمة في مصر نصف شهر لكل سنة', () => {
    expect(sql).toContain("WHEN v_code='EG' THEN 0.5");
  });
});
