-- 107: Egypt July–June fiscal bootstrap; EOSB 5-year step for SA and EG.
-- Does not rewrite existing fiscal years (journals may already sit in them).

CREATE OR REPLACE FUNCTION public.bootstrap_company_fiscal_year()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_today DATE := CURRENT_DATE;
  v_year INTEGER := EXTRACT(YEAR FROM v_today)::INTEGER;
  v_code TEXT := UPPER(COALESCE(NULLIF(BTRIM(NEW.country_code), ''), 'SA'));
  v_start DATE;
  v_end DATE;
  v_name TEXT;
BEGIN
  IF v_code = 'EG' THEN
    IF EXTRACT(MONTH FROM v_today) >= 7 THEN
      v_start := make_date(v_year, 7, 1);
      v_end := make_date(v_year + 1, 6, 30);
    ELSE
      v_start := make_date(v_year - 1, 7, 1);
      v_end := make_date(v_year, 6, 30);
    END IF;
    v_name := 'السنة المالية ' || TO_CHAR(v_start, 'YYYY') || '/' || TO_CHAR(v_end, 'YYYY');
  ELSE
    v_start := make_date(v_year, 1, 1);
    v_end := make_date(v_year, 12, 31);
    v_name := 'السنة المالية ' || v_year;
  END IF;
  INSERT INTO fiscal_years(company_id, name, start_date, end_date, status)
  VALUES (NEW.id, v_name, v_start, v_end, 'open')
  ON CONFLICT (company_id, name) DO NOTHING;
  INSERT INTO settings(company_id, key, value)
  VALUES (NEW.id, 'fiscal_start', v_start::TEXT)
  ON CONFLICT (company_id, key) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.bootstrap_company_fiscal_year() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_company_fiscal_year() TO service_role;

-- السعودية ومصر: نصف شهر لكل سنة من الخمس الأولى ثم شهر كامل (معيار 19).
CREATE OR REPLACE FUNCTION public.accrue_eosb_batch(
  p_company_id UUID, p_month_date DATE, p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_expense UUID; v_liability UUID; v_month_end DATE;
  v_journal JSONB;
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
    SELECT id INTO v_parent FROM accounts WHERE company_id=p_company_id AND code='2200' LIMIT 1;
    IF v_parent IS NULL THEN
      SELECT id INTO v_parent FROM accounts WHERE company_id=p_company_id AND code='2100' LIMIT 1;
    END IF;
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
    jsonb_build_object('month',p_month_date,'total',v_total,'count',v_count,'country',v_code));
  RETURN jsonb_build_object('status','created','month',p_month_date,'total',v_total,'count',v_count,
    'journal_entry_id',(v_journal->>'id'));
END;
$$;
REVOKE ALL ON FUNCTION public.accrue_eosb_batch(UUID,DATE,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accrue_eosb_batch(UUID,DATE,UUID) TO service_role;
