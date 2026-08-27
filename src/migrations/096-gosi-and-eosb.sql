-- ============================================================
-- 096: التأمينات الاجتماعية (GOSI) ومستحقات نهاية الخدمة (EOSB)
-- ------------------------------------------------------------
-- الفجوة (3 من التدقيق العالمي): الرواتب بلا حصة تأمينات (موظف/
-- صاحب عمل) وبلا استحقاق شهوري لنهاية الخدمة (معيار IAS 19).
-- الحل:
--  1) عمودا gosi_employer/gosi_employee على payroll.
--  2) post_payroll_batch (الداخلية): يقرأ نِسَب التأمينات من
--     settings (gosi_employer_rate افتراضي 0.1175، gosi_employee_rate
--     افتراضي 0.0975) ويوزّع القيد:
--       مدين: 5210 الرواتب + 5230 حصة صاحب العمل
--       دائن: 2140 الصافي + 2155 مستحقات التأمينات (الحصتان) + 1160 السلف
--  3) جدول eosb_accruals + accrue_eosb_batch: استحقاق شهري لكل
--       موظف = الراتب × (0.5 قبل خمس سنوات، 1.0 بعدها) / 12
--       القيد: مدين 5240 / دائن 2190، بلا تكرار لنفس الشهر (فريد).
--  4) حسابات 2155/5230/5240/2190 تُنشأ آليًا لأي شركة إن غابت.
-- ============================================================

ALTER TABLE payroll ADD COLUMN IF NOT EXISTS gosi_employer NUMERIC(15,2) NOT NULL DEFAULT 0;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS gosi_employee NUMERIC(15,2) NOT NULL DEFAULT 0;

-- حسابات التأمينات ونهاية الخدمة لكل الشركات إن غابت
INSERT INTO accounts(company_id, code, name, type, is_active, is_header)
SELECT c.id, x.code, x.name, x.acc_type, TRUE, FALSE
FROM companies c
CROSS JOIN (VALUES
  ('2155', 'مستحقات التأمينات الاجتماعية', 'liability'),
  ('5230', 'مصروف التأمينات الاجتماعية', 'expense'),
  ('5240', 'مصروف مستحقات نهاية الخدمة', 'expense'),
  ('2190', 'مستحقات نهاية الخدمة (مكافآت الموظفين)', 'liability')
) AS x(code, name, acc_type)
WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.company_id = c.id AND a.code = x.code);

-- ------------------------------------------------------------
-- 1) دفعة الرواتب بحصص التأمينات (نفس توقيع الدالة الداخلية)
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
  SELECT id INTO v_gosi_employer_account FROM accounts WHERE company_id=p_company_id AND code='5230' AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
  SELECT id INTO v_gosi_payable_account FROM accounts WHERE company_id=p_company_id AND code='2155' AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
  IF v_salary_account IS NULL OR v_accrued_account IS NULL THEN RAISE EXCEPTION 'حسابات الرواتب غير موجودة'; END IF;

  -- نِسَب التأمينات من الإعدادات مع الافتراض السعودي، وحماية من قيم غير منطقية
  SELECT COALESCE(NULLIF((SELECT value FROM settings WHERE company_id=p_company_id AND key='gosi_employer_rate'),'')::NUMERIC, 0.1175),
         COALESCE(NULLIF((SELECT value FROM settings WHERE company_id=p_company_id AND key='gosi_employee_rate'),'')::NUMERIC, 0.0975)
  INTO v_gosi_employer_rate, v_gosi_employee_rate;
  IF v_gosi_employer_rate<0 OR v_gosi_employer_rate>1 THEN v_gosi_employer_rate:=0.1175; END IF;
  IF v_gosi_employee_rate<0 OR v_gosi_employee_rate>1 THEN v_gosi_employee_rate:=0.0975; END IF;
  IF (v_gosi_employer_rate>0 OR v_gosi_employee_rate>0) AND (v_gosi_employer_account IS NULL OR v_gosi_payable_account IS NULL) THEN
    RAISE EXCEPTION 'حسابات التأمينات الاجتماعية (5230/2155) غير موجودة';
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

  -- مدين: الرواتب + حصة صاحب العمل | دائن: الصافي + مستحقات التأمينات (الحصتان) + السلف
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
-- 2) مستحقات نهاية الخدمة: جدول + استحقاق شهري IAS 19
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS eosb_accruals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  gross_salary NUMERIC(15,2) NOT NULL,
  service_years NUMERIC(8,2) NOT NULL,
  amount NUMERIC(15,2) NOT NULL,
  journal_entry_id UUID REFERENCES journal_entries(id),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, employee_id, date)
);

CREATE OR REPLACE FUNCTION public.accrue_eosb_batch(
  p_company_id UUID, p_month_date DATE, p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_expense UUID; v_liability UUID; v_month_end DATE;
  v_emp RECORD; v_years NUMERIC; v_factor NUMERIC; v_amount NUMERIC; v_total NUMERIC:=0; v_count INT:=0;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE) THEN
    RAISE EXCEPTION 'المستخدم غير صالح';
  END IF;
  IF p_month_date IS NULL OR p_month_date<>date_trunc('month',p_month_date)::DATE THEN
    RAISE EXCEPTION 'تاريخ الاستحقاق يجب أن يكون أول الشهر';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_company_id::TEXT||':eosb:'||TO_CHAR(p_month_date,'YYYY-MM'),0));
  SELECT id INTO v_expense FROM accounts WHERE company_id=p_company_id AND code='5240'
    AND COALESCE(is_active,TRUE)=TRUE AND NOT COALESCE(is_header,FALSE);
  SELECT id INTO v_liability FROM accounts WHERE company_id=p_company_id AND code='2190'
    AND COALESCE(is_active,TRUE)=TRUE AND NOT COALESCE(is_header,FALSE);
  IF v_expense IS NULL OR v_liability IS NULL THEN
    RAISE EXCEPTION 'حسابات مستحقات نهاية الخدمة (5240/2190) غير موجودة';
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
    -- استبعاد من استُحق له نفس الشهر مسبقاً (قيد فريد احتياطي)
    CONTINUE WHEN EXISTS(SELECT 1 FROM eosb_accruals WHERE company_id=p_company_id AND employee_id=v_emp.id AND date=p_month_date);
    -- النظام السعودي: نصف شهر عن كل سنة من الخمس الأولى، شهر كامل بعد ذلك
    v_factor:=CASE WHEN v_emp.years>=5 THEN 1.0 ELSE 0.5 END;
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
    jsonb_build_object('month',p_month_date,'total',v_total,'count',v_count));
  RETURN jsonb_build_object('status','created','month',p_month_date,'total',v_total,'count',v_count,
    'journal_entry_id',(v_journal->>'id'));
END;
$$;
REVOKE ALL ON FUNCTION public.accrue_eosb_batch(UUID,DATE,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accrue_eosb_batch(UUID,DATE,UUID) TO service_role;
