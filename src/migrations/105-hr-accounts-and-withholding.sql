-- 105: فك تصادم دليل الرواتب + خصم المنبع على فواتير المشتريات
--
-- 5230 كهرباء ومياه و 5240 اتصالات في الدليل الافتراضي، بينما ترحيل
-- التأمينات ونهاية الخدمة كان يكتب على نفس الرقمين. الحسابات الصحيحة:
--   2155 مستحقات التأمينات الاجتماعية
--   5215 مصروف التأمينات الاجتماعية
--   5216 مصروف مستحقات نهاية الخدمة
--   2190 التزام نهاية الخدمة (موجود)
--   2165 خصم المنبع (مصر)
--
-- خصم المنبع: عمودان على فاتورة المشتريات + ترحيل يخفض ذمة المورد.

ALTER TABLE purchase_invoices
  ADD COLUMN IF NOT EXISTS withholding_rate NUMERIC(7,4) NOT NULL DEFAULT 0;
ALTER TABLE purchase_invoices
  ADD COLUMN IF NOT EXISTS withholding_amount NUMERIC(15,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_invoices_withholding_rate_check'
  ) THEN
    ALTER TABLE purchase_invoices
      ADD CONSTRAINT purchase_invoices_withholding_rate_check
      CHECK (withholding_rate >= 0 AND withholding_rate <= 0.2);
  END IF;
END $$;

-- دليل الحسابات لكل الشركات القائمة
INSERT INTO accounts(company_id, code, name, name_en, type, parent_id, is_active, is_header)
SELECT c.id, x.code, x.name, x.name_en, x.acc_type,
  (SELECT a.id FROM accounts a WHERE a.company_id = c.id AND a.code = x.parent_code LIMIT 1),
  TRUE, FALSE
FROM companies c
CROSS JOIN (VALUES
  ('2155', 'مستحقات التأمينات الاجتماعية', 'Social insurance payable', 'liability', '2100'),
  ('5215', 'مصروف التأمينات الاجتماعية', 'Social insurance expense', 'expense', '5200'),
  ('5216', 'مصروف مستحقات نهاية الخدمة', 'End of service expense', 'expense', '5200')
) AS x(code, name, name_en, acc_type, parent_code)
WHERE NOT EXISTS (
  SELECT 1 FROM accounts a WHERE a.company_id = c.id AND a.code = x.code
);

-- خصم المنبع للشركات المصرية إن غاب
INSERT INTO accounts(company_id, code, name, name_en, type, parent_id, is_active, is_header)
SELECT c.id, '2165', 'ضريبة خصم المنبع المستحقة', 'Withholding tax payable', 'liability',
  (SELECT a.id FROM accounts a WHERE a.company_id = c.id AND a.code = '2100' LIMIT 1),
  TRUE, FALSE
FROM companies c
WHERE COALESCE(NULLIF(BTRIM(c.country_code), ''), 'SA') = 'EG'
  AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.company_id = c.id AND a.code = '2165');

-- ------------------------------------------------------------
-- الرواتب: مصروف التأمينات على 5215 لا على 5230
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_payroll_batch_v49_internal(
  p_company_id UUID, p_date DATE, p_employee_ids UUID[], p_created_by UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_employee_count INTEGER; v_emp RECORD; v_adv RECORD; v_row JSONB;
  v_rows JSONB:='[]'::JSONB; v_total_salary NUMERIC:=0; v_total_advance NUMERIC:=0;
  v_total_gosi_employer NUMERIC:=0; v_total_gosi_employee NUMERIC:=0;
  v_advance_balance NUMERIC; v_deduction NUMERIC; v_left NUMERIC; v_take NUMERIC;
  v_salary_account UUID; v_accrued_account UUID; v_advance_account UUID;
  v_gosi_employer_account UUID; v_gosi_payable_account UUID;
  v_gosi_employer_rate NUMERIC; v_gosi_employee_rate NUMERIC;
  v_gosi_employer_amount NUMERIC; v_gosi_employee_amount NUMERIC; v_net_pay NUMERIC;
  v_lines JSONB; v_journal JSONB; v_journal_id UUID; v_result JSONB;
  v_parent UUID;
BEGIN
  IF p_date IS NULL OR p_employee_ids IS NULL OR array_length(p_employee_ids,1) IS NULL OR array_length(p_employee_ids,1)>500 THEN
    RAISE EXCEPTION 'قائمة موظفي الرواتب غير صالحة';
  END IF;
  SELECT COUNT(DISTINCT item_id) INTO v_employee_count FROM unnest(p_employee_ids) AS ids(item_id);
  IF v_employee_count<>array_length(p_employee_ids,1) THEN RAISE EXCEPTION 'لا يمكن تكرار الموظف في دفعة الرواتب'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_company_id::TEXT||':payroll:'||TO_CHAR(p_date,'YYYY-MM'),0));
  IF EXISTS(SELECT 1 FROM payroll WHERE company_id=p_company_id
    AND date_trunc('month',date::timestamp)=date_trunc('month',p_date::timestamp)
    AND employee_id=ANY(p_employee_ids)) THEN
    RAISE EXCEPTION 'تم إنشاء راتب لأحد الموظفين في هذا التاريخ مسبقاً';
  END IF;
  SELECT COUNT(*) INTO v_employee_count FROM employees
    WHERE company_id=p_company_id AND id=ANY(p_employee_ids) AND COALESCE(is_active,TRUE)=TRUE;
  IF v_employee_count<>array_length(p_employee_ids,1) THEN RAISE EXCEPTION 'أحد الموظفين غير موجود أو غير نشط'; END IF;
  PERFORM id FROM employees WHERE company_id=p_company_id AND id=ANY(p_employee_ids) ORDER BY id FOR UPDATE;

  SELECT id INTO v_salary_account FROM accounts WHERE company_id=p_company_id AND code='5210' AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
  SELECT id INTO v_accrued_account FROM accounts WHERE company_id=p_company_id AND code='2140' AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
  SELECT id INTO v_advance_account FROM accounts WHERE company_id=p_company_id AND code='1160' AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
  SELECT id INTO v_gosi_employer_account FROM accounts WHERE company_id=p_company_id AND code='5215' AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
  SELECT id INTO v_gosi_payable_account FROM accounts WHERE company_id=p_company_id AND code='2155' AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
  IF v_salary_account IS NULL OR v_accrued_account IS NULL THEN RAISE EXCEPTION 'حسابات الرواتب غير موجودة'; END IF;

  SELECT employer_rate, employee_rate INTO v_gosi_employer_rate, v_gosi_employee_rate
  FROM payroll_si_rates_for_company(p_company_id);
  IF v_gosi_employer_account IS NULL THEN
    SELECT id INTO v_parent FROM accounts WHERE company_id=p_company_id AND code='5200' LIMIT 1;
    INSERT INTO accounts(company_id,code,name,name_en,type,parent_id,is_active,is_header)
    SELECT p_company_id,'5215','مصروف التأمينات الاجتماعية','Social insurance expense','expense',v_parent,TRUE,FALSE
    WHERE NOT EXISTS(SELECT 1 FROM accounts WHERE company_id=p_company_id AND code='5215');
    SELECT id INTO v_gosi_employer_account FROM accounts WHERE company_id=p_company_id AND code='5215' AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
  END IF;
  IF v_gosi_payable_account IS NULL THEN
    SELECT id INTO v_parent FROM accounts WHERE company_id=p_company_id AND code='2100' LIMIT 1;
    INSERT INTO accounts(company_id,code,name,name_en,type,parent_id,is_active,is_header)
    SELECT p_company_id,'2155','مستحقات التأمينات الاجتماعية','Social insurance payable','liability',v_parent,TRUE,FALSE
    WHERE NOT EXISTS(SELECT 1 FROM accounts WHERE company_id=p_company_id AND code='2155');
    SELECT id INTO v_gosi_payable_account FROM accounts WHERE company_id=p_company_id AND code='2155' AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
  END IF;
  IF (v_gosi_employer_rate>0 OR v_gosi_employee_rate>0) AND (v_gosi_employer_account IS NULL OR v_gosi_payable_account IS NULL) THEN
    RAISE EXCEPTION 'تعذر تهيئة حسابات التأمينات الاجتماعية (5215/2155)';
  END IF;

  FOR v_emp IN SELECT id,ROUND(COALESCE(salary,0),2) AS salary FROM employees
    WHERE company_id=p_company_id AND id=ANY(p_employee_ids) ORDER BY id
  LOOP
    IF v_emp.salary<=0 THEN RAISE EXCEPTION 'راتب أحد الموظفين غير صالح'; END IF;
    PERFORM id FROM employee_advances
      WHERE company_id=p_company_id AND employee_id=v_emp.id AND remaining_amount>0 ORDER BY date,id FOR UPDATE;
    SELECT COALESCE(SUM(remaining_amount),0) INTO v_advance_balance FROM employee_advances
      WHERE company_id=p_company_id AND employee_id=v_emp.id AND remaining_amount>0;
    v_deduction:=ROUND(LEAST(v_advance_balance,v_emp.salary*0.5),2);
    v_gosi_employer_amount:=ROUND(v_emp.salary*v_gosi_employer_rate,2);
    v_gosi_employee_amount:=ROUND(v_emp.salary*v_gosi_employee_rate,2);
    v_net_pay:=ROUND(v_emp.salary-v_deduction-v_gosi_employee_amount,2);
    v_rows:=v_rows||jsonb_build_array(jsonb_build_object(
      'employee_id',v_emp.id,'salary',v_emp.salary,'advance_deduction',v_deduction,
      'gosi_employer',v_gosi_employer_amount,'gosi_employee',v_gosi_employee_amount,
      'net_pay',v_net_pay));
    v_total_salary:=v_total_salary+v_emp.salary;
    v_total_advance:=v_total_advance+v_deduction;
    v_total_gosi_employer:=v_total_gosi_employer+v_gosi_employer_amount;
    v_total_gosi_employee:=v_total_gosi_employee+v_gosi_employee_amount;
  END LOOP;
  IF v_total_advance>0 AND v_advance_account IS NULL THEN RAISE EXCEPTION 'حساب سلف الموظفين غير موجود'; END IF;

  v_lines:=jsonb_build_array(
    jsonb_build_object('accountId',v_salary_account,'debit',v_total_salary,'credit',0,'description','مصروف الرواتب'),
    jsonb_build_object('accountId',v_accrued_account,'debit',0,'credit',ROUND(v_total_salary-v_total_advance-v_total_gosi_employee,2),'description','رواتب مستحقة'));
  IF v_total_advance>0 THEN
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
      'accountId',v_advance_account,'debit',0,'credit',v_total_advance,'description','تسوية سلف الموظفين'));
  END IF;
  IF v_total_gosi_employer+v_total_gosi_employee>0 THEN
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
      'accountId',v_gosi_payable_account,'debit',0,'credit',ROUND(v_total_gosi_employer+v_total_gosi_employee,2),
      'description','حصص التأمينات الاجتماعية (موظف + صاحب عمل)'));
    IF v_total_gosi_employer>0 THEN
      v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
        'accountId',v_gosi_employer_account,'debit',v_total_gosi_employer,'credit',0,
        'description','حصة صاحب العمل في التأمينات'));
    END IF;
  END IF;
  v_journal:=create_journal_entry(p_company_id,p_date,'general','رواتب شهر '||TO_CHAR(p_date,'YYYY-MM'),p_created_by,v_lines);
  v_journal_id:=(v_journal->>'id')::UUID;
  UPDATE journal_entries SET reference_type='payroll_batch',reference_id=v_journal_id WHERE id=v_journal_id AND company_id=p_company_id;

  FOR v_row IN SELECT value FROM jsonb_array_elements(v_rows)
  LOOP
    INSERT INTO payroll(company_id,employee_id,date,basic_salary,allowances,deductions,advance_deduction,net_pay,gosi_employer,gosi_employee,journal_entry_id)
    VALUES(p_company_id,(v_row->>'employee_id')::UUID,p_date,(v_row->>'salary')::NUMERIC,0,0,
      (v_row->>'advance_deduction')::NUMERIC,(v_row->>'net_pay')::NUMERIC,
      (v_row->>'gosi_employer')::NUMERIC,(v_row->>'gosi_employee')::NUMERIC,v_journal_id);
    v_left:=(v_row->>'advance_deduction')::NUMERIC;
    FOR v_adv IN SELECT id,remaining_amount FROM employee_advances
      WHERE company_id=p_company_id AND employee_id=(v_row->>'employee_id')::UUID AND remaining_amount>0
      ORDER BY date,id FOR UPDATE
    LOOP
      EXIT WHEN v_left<=0;
      v_take:=LEAST(v_adv.remaining_amount,v_left);
      UPDATE employee_advances SET remaining_amount=remaining_amount-v_take WHERE id=v_adv.id AND company_id=p_company_id;
      v_left:=v_left-v_take;
    END LOOP;
    IF v_left>0.005 THEN RAISE EXCEPTION 'تغير رصيد السلف أثناء ترحيل الرواتب'; END IF;
  END LOOP;
  SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.employee_id),'[]'::JSONB) INTO v_result
    FROM payroll p WHERE p.company_id=p_company_id AND p.journal_entry_id=v_journal_id;
  RETURN jsonb_build_object('journal_entry_id',v_journal_id,'records',v_result,
    'total_salary',v_total_salary,'total_advance_deduction',v_total_advance,
    'total_gosi_employer',v_total_gosi_employer,'total_gosi_employee',v_total_gosi_employee);
END;
$$;
REVOKE ALL ON FUNCTION public.post_payroll_batch_v49_internal(UUID,DATE,UUID[],UUID) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- نهاية الخدمة: مصروف 5216 لا 5240، ومصر نصف شهر لكل سنة
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accrue_eosb_batch(
  p_company_id UUID, p_month_date DATE, p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_expense UUID; v_liability UUID; v_month_end DATE;
  v_journal JSONB; v_journal_id UUID;
  v_emp RECORD; v_years NUMERIC; v_factor NUMERIC; v_amount NUMERIC; v_total NUMERIC:=0; v_count INT:=0;
  v_code TEXT; v_parent UUID;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE) THEN
    RAISE EXCEPTION 'المستخدم غير صالح';
  END IF;
  IF p_month_date IS NULL OR p_month_date<>date_trunc('month',p_month_date)::DATE THEN
    RAISE EXCEPTION 'تاريخ الاستحقاق يجب أن يكون أول الشهر';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_company_id::TEXT||':eosb:'||TO_CHAR(p_month_date,'YYYY-MM'),0));
  SELECT COALESCE(NULLIF(BTRIM(country_code),''),'SA') INTO v_code FROM companies WHERE id=p_company_id;
  SELECT id INTO v_expense FROM accounts WHERE company_id=p_company_id AND code='5216'
    AND COALESCE(is_active,TRUE)=TRUE AND NOT COALESCE(is_header,FALSE);
  SELECT id INTO v_liability FROM accounts WHERE company_id=p_company_id AND code='2190'
    AND COALESCE(is_active,TRUE)=TRUE AND NOT COALESCE(is_header,FALSE);
  IF v_expense IS NULL THEN
    SELECT id INTO v_parent FROM accounts WHERE company_id=p_company_id AND code='5200' LIMIT 1;
    INSERT INTO accounts(company_id,code,name,name_en,type,parent_id,is_active,is_header)
    SELECT p_company_id,'5216','مصروف مستحقات نهاية الخدمة','End of service expense','expense',v_parent,TRUE,FALSE
    WHERE NOT EXISTS(SELECT 1 FROM accounts WHERE company_id=p_company_id AND code='5216');
    SELECT id INTO v_expense FROM accounts WHERE company_id=p_company_id AND code='5216' AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
  END IF;
  IF v_liability IS NULL THEN
    SELECT id INTO v_parent FROM accounts WHERE company_id=p_company_id AND code='2100' LIMIT 1;
    INSERT INTO accounts(company_id,code,name,name_en,type,parent_id,is_active,is_header)
    SELECT p_company_id,'2190','مستحقات نهاية الخدمة (مكافآت الموظفين)','End of Service Benefits','liability',v_parent,TRUE,FALSE
    WHERE NOT EXISTS(SELECT 1 FROM accounts WHERE company_id=p_company_id AND code='2190');
    SELECT id INTO v_liability FROM accounts WHERE company_id=p_company_id AND code='2190' AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
  END IF;
  IF v_expense IS NULL OR v_liability IS NULL THEN
    RAISE EXCEPTION 'تعذر تهيئة حسابات مستحقات نهاية الخدمة (5216/2190)';
  END IF;
  v_month_end:=(date_trunc('month',p_month_date::TIMESTAMP)+INTERVAL '1 month -1 day')::DATE;

  FOR v_emp IN
    SELECT e.id, ROUND(COALESCE(e.salary,0),2) AS salary,
      ROUND(EXTRACT(EPOCH FROM (v_month_end-e.hire_date))/(86400*365.25),2) AS years
    FROM employees e
    WHERE e.company_id=p_company_id AND COALESCE(e.is_active,TRUE)=TRUE
      AND e.hire_date<=v_month_end AND COALESCE(e.salary,0)>0
    ORDER BY e.id FOR UPDATE
  LOOP
    CONTINUE WHEN EXISTS(SELECT 1 FROM eosb_accruals WHERE company_id=p_company_id AND employee_id=v_emp.id AND date=p_month_date);
    -- السعودية: نصف شهر للخمس الأولى ثم شهر كامل. مصر: نصف شهر لكل سنة خدمة.
    v_factor:=CASE
      WHEN v_code='EG' THEN 0.5
      WHEN v_emp.years>=5 THEN 1.0
      ELSE 0.5
    END;
    v_amount:=ROUND(v_emp.salary*v_factor/12,2);
    CONTINUE WHEN v_amount<=0;
    INSERT INTO eosb_accruals(company_id,employee_id,date,gross_salary,service_years,amount,created_by)
    VALUES(p_company_id,v_emp.id,p_month_date,v_emp.salary,v_emp.years,v_amount,p_user_id);
    v_total:=v_total+v_amount; v_count:=v_count+1;
  END LOOP;

  IF v_total<=0 THEN RETURN jsonb_build_object('status','nothing_to_accrue','month',p_month_date); END IF;

  v_journal:=create_journal_entry(p_company_id,p_month_date,'general',
    'استحقاق نهاية الخدمة لشهر '||TO_CHAR(p_month_date,'YYYY-MM'),p_user_id,
    jsonb_build_array(
      jsonb_build_object('accountId',v_expense,'debit',v_total,'credit',0,'description','مصروف مستحقات نهاية الخدمة'),
      jsonb_build_object('accountId',v_liability,'debit',0,'credit',v_total,'description','التزام مستحقات نهاية الخدمة')));
  UPDATE journal_entries SET reference_type='eosb_accrual',reference_id=(SELECT id FROM eosb_accruals
      WHERE company_id=p_company_id AND date=p_month_date ORDER BY id LIMIT 1)
  WHERE id=(v_journal->>'id')::UUID AND company_id=p_company_id;
  UPDATE eosb_accruals SET journal_entry_id=(v_journal->>'id')::UUID
  WHERE company_id=p_company_id AND date=p_month_date AND journal_entry_id IS NULL;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,new_values)
  VALUES(p_company_id,p_user_id,'eosb_accrual','employees',
    jsonb_build_object('month',p_month_date,'total',v_total,'count',v_count,'country',v_code));
  RETURN jsonb_build_object('status','created','month',p_month_date,'total',v_total,'count',v_count,
    'journal_entry_id',(v_journal->>'id'));
END;
$$;
REVOKE ALL ON FUNCTION public.accrue_eosb_batch(UUID,DATE,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accrue_eosb_batch(UUID,DATE,UUID) TO service_role;

-- ------------------------------------------------------------
-- فاتورة المشتريات: مصروفات أخرى + خصم منبع يخفض ذمة المورد
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_purchase_invoice_atomic(
  UUID,UUID,UUID,UUID,UUID,BOOLEAN,DATE,JSONB,NUMERIC,TEXT,UUID,JSONB,UUID
);

CREATE OR REPLACE FUNCTION public.create_purchase_invoice_atomic(
  p_company_id UUID,p_supplier_id UUID,p_purchase_order_id UUID,p_project_id UUID,
  p_custody_id UUID,p_link_to_project BOOLEAN,p_date DATE,p_items JSONB,
  p_tax_rate NUMERIC,p_notes TEXT,p_user_id UUID,
  p_other_expenses JSONB DEFAULT '[]'::JSONB,
  p_payment_account_id UUID DEFAULT NULL,
  p_withholding_rate NUMERIC DEFAULT 0
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_result JSONB;
  v_invoice_id UUID;
  v_inv_number TEXT;
  v_oe JSONB;
  v_oe_desc TEXT;
  v_oe_amount NUMERIC;
  v_oe_code TEXT;
  v_oe_account_id UUID;
  v_oe_acc UUID;
  v_other_total NUMERIC:=0;
  v_pay_acc UUID;
  v_lines JSONB:='[]'::JSONB;
  v_oe_journal JSONB;
  v_wh_journal JSONB;
  v_wh_rate NUMERIC:=COALESCE(p_withholding_rate,0);
  v_wh_amount NUMERIC:=0;
  v_subtotal NUMERIC;
  v_total NUMERIC;
  v_ap UUID;
  v_wh_acc UUID;
  v_country TEXT;
  v_parent UUID;
  v_payment_source TEXT;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  PERFORM set_config('app.custody_write_company',p_company_id::TEXT,TRUE);

  IF v_wh_rate IS NULL OR v_wh_rate<0 OR v_wh_rate>0.2 OR v_wh_rate<>ROUND(v_wh_rate,4)
  THEN RAISE EXCEPTION 'نسبة خصم المنبع غير صالحة'; END IF;
  SELECT COALESCE(NULLIF(BTRIM(country_code),''),'SA') INTO v_country FROM companies WHERE id=p_company_id;
  IF v_wh_rate>0 AND v_country<>'EG' THEN
    RAISE EXCEPTION 'خصم المنبع متاح للشركات المصرية فقط';
  END IF;

  IF jsonb_typeof(COALESCE(p_other_expenses,'[]'::JSONB))<>'array' OR jsonb_array_length(p_other_expenses)>100
  THEN RAISE EXCEPTION 'بيانات المصروفات الإضافية غير صالحة'; END IF;
  FOR v_oe IN SELECT value FROM jsonb_array_elements(COALESCE(p_other_expenses,'[]'::JSONB)) LOOP
    BEGIN
      v_oe_amount:=(v_oe->>'amount')::NUMERIC;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'مبلغ مصروف إضافي غير صالح'; END;
    v_oe_desc:=COALESCE(BTRIM(v_oe->>'description'),'');
    v_oe_code:=COALESCE(v_oe->>'account_code','5400');
    IF NULLIF(v_oe_desc,'') IS NULL OR LENGTH(v_oe_desc)>200 OR v_oe_amount IS NULL OR v_oe_amount<=0
      OR v_oe_amount<>ROUND(v_oe_amount,2) THEN RAISE EXCEPTION 'بند مصروف إضافي غير صالح'; END IF;
    v_other_total:=v_other_total+v_oe_amount;
  END LOOP;

  v_result:=create_purchase_invoice_atomic_v55_internal(p_company_id,p_supplier_id,p_purchase_order_id,
    p_project_id,p_custody_id,p_link_to_project,p_date,p_items,p_tax_rate,p_notes,p_user_id);
  v_invoice_id:=(v_result->>'id')::UUID;
  v_inv_number:=COALESCE(v_result->>'invoice_number',v_result->>'number');
  v_subtotal:=COALESCE((v_result->>'subtotal')::NUMERIC,0);
  v_total:=COALESCE((v_result->>'total')::NUMERIC,0);
  v_payment_source:=COALESCE(v_result->>'payment_source','ap');

  IF v_other_total>0 THEN
    IF p_payment_account_id IS NOT NULL THEN
      SELECT id INTO v_pay_acc FROM accounts WHERE id=p_payment_account_id AND company_id=p_company_id
        AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
      IF v_pay_acc IS NULL THEN RAISE EXCEPTION 'حساب دفع المصروفات الإضافية غير صالح'; END IF;
    ELSE
      SELECT id INTO v_pay_acc FROM accounts WHERE company_id=p_company_id AND code='1110'
        AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
      IF v_pay_acc IS NULL THEN RAISE EXCEPTION 'حساب دفع المصروفات الإضافية غير موجود'; END IF;
    END IF;
    v_lines:='[]'::JSONB;
    FOR v_oe IN SELECT value FROM jsonb_array_elements(p_other_expenses) LOOP
      v_oe_amount:=(v_oe->>'amount')::NUMERIC;
      v_oe_desc:=COALESCE(BTRIM(v_oe->>'description'),'');
      v_oe_code:=COALESCE(v_oe->>'account_code','5400');
      v_oe_account_id:=NULLIF(v_oe->>'account_id','')::UUID;
      v_oe_acc:=resolve_other_expense_account(p_company_id,v_oe_code,v_oe_account_id);
      IF v_oe_acc IS NULL THEN RAISE EXCEPTION 'حساب مصروف «%» غير موجود', v_oe_code; END IF;
      v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
        'accountId',v_oe_acc,'debit',v_oe_amount,'credit',0,'description',v_oe_desc,'projectId',(v_result->>'project_id')::UUID));
    END LOOP;
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
      'accountId',v_pay_acc,'debit',0,'credit',v_other_total,'description','مصاريف إضافية فاتورة '||v_inv_number));
    v_oe_journal:=create_journal_entry(p_company_id,p_date,'general','مصاريف إضافية فاتورة '||v_inv_number,p_user_id,v_lines);
    UPDATE purchase_invoices SET other_expenses_total=v_other_total WHERE id=v_invoice_id AND company_id=p_company_id;
  END IF;

  IF v_wh_rate>0 THEN
    IF v_payment_source<>'ap' THEN
      RAISE EXCEPTION 'لا يمكن تطبيق خصم المنبع على فاتورة مسددة من العهدة';
    END IF;
    v_wh_amount:=ROUND(v_subtotal*v_wh_rate,2);
    IF v_wh_amount<=0 THEN
      v_wh_amount:=0;
    ELSIF v_wh_amount>v_total THEN
      RAISE EXCEPTION 'خصم المنبع يتجاوز قيمة الفاتورة';
    ELSE
      SELECT id INTO v_ap FROM accounts WHERE company_id=p_company_id AND code='2110'
        AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
      SELECT id INTO v_wh_acc FROM accounts WHERE company_id=p_company_id AND code='2165'
        AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
      IF v_wh_acc IS NULL THEN
        SELECT id INTO v_parent FROM accounts WHERE company_id=p_company_id AND code='2100' LIMIT 1;
        INSERT INTO accounts(company_id,code,name,name_en,type,parent_id,is_active,is_header)
        SELECT p_company_id,'2165','ضريبة خصم المنبع المستحقة','Withholding tax payable','liability',v_parent,TRUE,FALSE
        WHERE NOT EXISTS(SELECT 1 FROM accounts WHERE company_id=p_company_id AND code='2165');
        SELECT id INTO v_wh_acc FROM accounts WHERE company_id=p_company_id AND code='2165'
          AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
      END IF;
      IF v_ap IS NULL OR v_wh_acc IS NULL THEN RAISE EXCEPTION 'حسابات خصم المنبع غير مكتملة'; END IF;
      v_wh_journal:=create_journal_entry(p_company_id,p_date,'general','خصم منبع فاتورة '||v_inv_number,p_user_id,
        jsonb_build_array(
          jsonb_build_object('accountId',v_ap,'debit',v_wh_amount,'credit',0,'description','خصم منبع','contactId',p_supplier_id),
          jsonb_build_object('accountId',v_wh_acc,'debit',0,'credit',v_wh_amount,'description','ضريبة خصم المنبع المستحقة')
        ));
      UPDATE purchase_invoices
        SET withholding_rate=v_wh_rate, withholding_amount=v_wh_amount, total=ROUND(total-v_wh_amount,2)
        WHERE id=v_invoice_id AND company_id=p_company_id;
      v_total:=ROUND(v_total-v_wh_amount,2);
    END IF;
  END IF;

  RETURN v_result||jsonb_build_object(
    'other_expenses_total',v_other_total,
    'other_expenses_journal_entry_id',CASE WHEN v_oe_journal IS NULL THEN NULL ELSE v_oe_journal->>'id' END,
    'withholding_journal_entry_id',CASE WHEN v_wh_journal IS NULL THEN NULL ELSE v_wh_journal->>'id' END,
    'withholding_rate',v_wh_rate,
    'withholding_amount',v_wh_amount,
    'total',v_total);
END;
$$;

DO $$
BEGIN
  REVOKE ALL ON FUNCTION public.create_purchase_invoice_atomic(
    UUID,UUID,UUID,UUID,UUID,BOOLEAN,DATE,JSONB,NUMERIC,TEXT,UUID,JSONB,UUID,NUMERIC
  ) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.create_purchase_invoice_atomic(
    UUID,UUID,UUID,UUID,UUID,BOOLEAN,DATE,JSONB,NUMERIC,TEXT,UUID,JSONB,UUID,NUMERIC
  ) TO service_role;
EXCEPTION WHEN undefined_function THEN
  NULL;
END $$;

SELECT 'Migration 105 completed' AS result;
