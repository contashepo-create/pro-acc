import fs from 'fs';
import path from 'path';

describe('ميجريشن 107 — سنة مصر ونهاية الخدمة', () => {
  const sql = fs.readFileSync(
    path.join(process.cwd(), 'src', 'migrations', '107-eg-fiscal-eosb-step.sql'),
    'utf8',
  );

  test('مصر تبدأ من يوليو وتنتهي في يونيو', () => {
    expect(sql).toContain("IF v_code = 'EG'");
    expect(sql).toContain('make_date(v_year, 7, 1)');
    expect(sql).toContain('make_date(v_year + 1, 6, 30)');
    expect(sql).toContain("key, value)");
    expect(sql).toContain("'fiscal_start'");
  });

  test('نهاية الخدمة نصف شهر ثم شهر بعد خمس سنوات للدولتين', () => {
    expect(sql).toContain('v_factor:=CASE WHEN v_emp.years>=5 THEN 1.0 ELSE 0.5 END');
    expect(sql).not.toContain("WHEN v_code='EG' THEN 0.5");
    expect(sql).not.toMatch(/v_years NUMERIC/);
  });
});
