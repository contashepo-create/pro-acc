-- 104: Dual operating country (SA | EG) frozen at first account creation
--
-- Country drives VAT, currency, tax authority (ZATCA vs ETA), and
-- social-insurance default rates. It cannot change after the company row exists.

CREATE OR REPLACE FUNCTION public.operating_country_si_rates(p_code TEXT)
RETURNS TABLE(employer_rate NUMERIC, employee_rate NUMERIC, label TEXT, tax_authority TEXT)
LANGUAGE sql IMMUTABLE AS $$
  SELECT *
  FROM (
    VALUES
      ('EG', 0.1875::NUMERIC, 0.1100::NUMERIC, 'التأمينات الاجتماعية المصرية', 'eta'),
      ('SA', 0.1175::NUMERIC, 0.0975::NUMERIC, 'التأمينات الاجتماعية (GOSI)', 'zatca')
  ) AS r(code, employer_rate, employee_rate, label, tax_authority)
  WHERE r.code = CASE WHEN p_code = 'EG' THEN 'EG' ELSE 'SA' END
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.seed_operating_country_profile(p_company_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_code TEXT;
  v_rates RECORD;
  v_parent UUID;
BEGIN
  SELECT COALESCE(NULLIF(BTRIM(country_code), ''), 'SA') INTO v_code
  FROM companies WHERE id = p_company_id;
  IF v_code IS NULL THEN RETURN; END IF;

  SELECT * INTO v_rates FROM operating_country_si_rates(v_code);

  INSERT INTO settings(company_id, key, value)
  SELECT p_company_id, k, v
  FROM (VALUES
    ('gosi_employer_rate', v_rates.employer_rate::TEXT),
    ('gosi_employee_rate', v_rates.employee_rate::TEXT),
    ('social_insurance_label', v_rates.label),
    ('tax_authority', v_rates.tax_authority),
    ('withholding_enabled', CASE WHEN v_code = 'EG' THEN 'true' ELSE 'false' END),
    ('operating_country', v_code)
  ) AS s(k, v)
  WHERE NOT EXISTS (
    SELECT 1 FROM settings x WHERE x.company_id = p_company_id AND x.key = s.k
  );

  IF v_code = 'EG' THEN
    SELECT id INTO v_parent FROM accounts WHERE company_id = p_company_id AND code = '2100' LIMIT 1;
    INSERT INTO accounts(company_id, code, name, name_en, type, parent_id, is_active, is_header)
    SELECT p_company_id, '2165', 'ضريبة خصم المنبع المستحقة', 'Withholding tax payable', 'liability', v_parent, TRUE, FALSE
    WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE company_id = p_company_id AND code = '2165');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_companies_operating_country()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.country_code IS NULL OR BTRIM(NEW.country_code) = '' THEN
      NEW.country_code := 'SA';
    END IF;
    NEW.country_code := UPPER(BTRIM(NEW.country_code));
    IF NEW.country_code NOT IN ('SA', 'EG') THEN
      RAISE EXCEPTION 'دولة التشغيل يجب أن تكون السعودية أو مصر عند إنشاء الحساب';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.country_code IS DISTINCT FROM NEW.country_code THEN
    RAISE EXCEPTION 'لا يمكن تغيير دولة التشغيل بعد إنشاء الحساب';
  END IF;
  NEW.currency_code := OLD.currency_code;
  NEW.currency_symbol := OLD.currency_symbol;
  NEW.locale := OLD.locale;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_companies_operating_country_ins ON companies;
CREATE TRIGGER trg_companies_operating_country_ins
  BEFORE INSERT ON companies
  FOR EACH ROW EXECUTE FUNCTION public.trg_companies_operating_country();

DROP TRIGGER IF EXISTS trg_companies_operating_country_upd ON companies;
CREATE TRIGGER trg_companies_operating_country_upd
  BEFORE UPDATE OF country_code, currency_code, currency_symbol, locale ON companies
  FOR EACH ROW EXECUTE FUNCTION public.trg_companies_operating_country();

CREATE OR REPLACE FUNCTION public.trg_companies_seed_country_profile()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  PERFORM seed_operating_country_profile(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_companies_seed_country_profile ON companies;
CREATE TRIGGER trg_companies_seed_country_profile
  AFTER INSERT ON companies
  FOR EACH ROW EXECUTE FUNCTION public.trg_companies_seed_country_profile();

-- Existing tenants keep their country (including any legacy non-SA/EG rows)
-- and receive SI defaults only when the keys are missing.
DO $$
DECLARE rec RECORD;
BEGIN
  FOR rec IN SELECT id FROM companies LOOP
    PERFORM seed_operating_country_profile(rec.id);
  END LOOP;
END $$;

-- Payroll fallback follows the company country when settings are absent.
CREATE OR REPLACE FUNCTION public.payroll_si_rates_for_company(p_company_id UUID)
RETURNS TABLE(employer_rate NUMERIC, employee_rate NUMERIC)
LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE
  v_code TEXT;
  v_er NUMERIC;
  v_ee NUMERIC;
  v_defaults RECORD;
BEGIN
  SELECT country_code INTO v_code FROM companies WHERE id = p_company_id;
  SELECT * INTO v_defaults FROM operating_country_si_rates(v_code);
  BEGIN
    v_er := NULLIF((SELECT value FROM settings WHERE company_id = p_company_id AND key = 'gosi_employer_rate'), '')::NUMERIC;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    v_er := NULL;
  END;
  BEGIN
    v_ee := NULLIF((SELECT value FROM settings WHERE company_id = p_company_id AND key = 'gosi_employee_rate'), '')::NUMERIC;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    v_ee := NULL;
  END;
  IF v_er IS NULL OR v_er < 0 OR v_er > 1 THEN v_er := v_defaults.employer_rate; END IF;
  IF v_ee IS NULL OR v_ee < 0 OR v_ee > 1 THEN v_ee := v_defaults.employee_rate; END IF;
  employer_rate := v_er;
  employee_rate := v_ee;
  RETURN NEXT;
END;
$$;

DO $$
BEGIN
  REVOKE ALL ON FUNCTION public.operating_country_si_rates(TEXT) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.operating_country_si_rates(TEXT) TO service_role;
  REVOKE ALL ON FUNCTION public.seed_operating_country_profile(UUID) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.seed_operating_country_profile(UUID) TO service_role;
  REVOKE ALL ON FUNCTION public.payroll_si_rates_for_company(UUID) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.payroll_si_rates_for_company(UUID) TO service_role;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'privilege grant: %', SQLERRM;
END $$;

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

  SELECT employer_rate, employee_rate INTO v_gosi_employer_rate, v_gosi_employee_rate
  FROM payroll_si_rates_for_company(p_company_id);
  IF v_gosi_employer_account IS NULL THEN
    INSERT INTO accounts(company_id,code,name,type,is_active,is_header)
    SELECT p_company_id,'5230','مصروف التأمينات الاجتماعية','expense',TRUE,FALSE
    WHERE NOT EXISTS(SELECT 1 FROM accounts WHERE company_id=p_company_id AND code='5230');
    SELECT id INTO v_gosi_employer_account FROM accounts WHERE company_id=p_company_id AND code='5230' AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
  END IF;
  IF v_gosi_payable_account IS NULL THEN
    INSERT INTO accounts(company_id,code,name,type,is_active,is_header)
    SELECT p_company_id,'2155','مستحقات التأمينات الاجتماعية','liability',TRUE,FALSE
    WHERE NOT EXISTS(SELECT 1 FROM accounts WHERE company_id=p_company_id AND code='2155');
    SELECT id INTO v_gosi_payable_account FROM accounts WHERE company_id=p_company_id AND code='2155' AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
  END IF;
  IF (v_gosi_employer_rate>0 OR v_gosi_employee_rate>0) AND (v_gosi_employer_account IS NULL OR v_gosi_payable_account IS NULL) THEN
    RAISE EXCEPTION 'تعذر تهيئة حسابات التأمينات الاجتماعية (5230/2155)';
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

SELECT 'Migration 104 completed — SA/EG operating country freeze' as result;
