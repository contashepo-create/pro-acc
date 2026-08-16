-- 057 - Audited, tenant-safe HR/payroll/fixed-asset lifecycle boundaries.
BEGIN;

-- Private prior implementations; only marker-setting wrappers remain callable
-- by the service role.
ALTER FUNCTION public.create_employee_advance(UUID,UUID,DATE,NUMERIC,TEXT,UUID,UUID)
  RENAME TO create_employee_advance_v49_internal;
ALTER FUNCTION public.post_payroll_batch(UUID,DATE,UUID[],UUID)
  RENAME TO post_payroll_batch_v49_internal;
ALTER FUNCTION public.create_fixed_asset(UUID,TEXT,TEXT,TEXT,DATE,NUMERIC,INTEGER,TEXT,TEXT,TEXT,UUID,UUID)
  RENAME TO create_fixed_asset_v49_internal;
ALTER FUNCTION public.depreciate_fixed_asset(UUID,UUID,DATE,UUID,UUID)
  RENAME TO depreciate_fixed_asset_v49_internal;
ALTER FUNCTION public.cancel_voucher_disbursement_atomic(UUID,UUID,UUID)
  RENAME TO cancel_voucher_disbursement_atomic_v50_internal;
ALTER FUNCTION public.settle_custody_file(UUID,UUID,DATE,NUMERIC,UUID,TEXT,UUID)
  RENAME TO settle_custody_file_v56_internal;

UPDATE employee_advances SET remaining_amount=0
WHERE status='cancelled' AND remaining_amount<>0;

CREATE OR REPLACE FUNCTION public.create_employee_atomic(
  p_company_id UUID,p_name TEXT,p_phone TEXT,p_email TEXT,p_salary NUMERIC,
  p_department TEXT,p_position TEXT,p_hire_date DATE,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_employee employees%ROWTYPE; v_max INTEGER;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  IF NULLIF(BTRIM(p_name),'') IS NULL OR LENGTH(p_name)>200 OR p_hire_date IS NULL
    OR p_salary IS NULL OR p_salary<0 OR p_salary<>ROUND(p_salary,2)
    OR LENGTH(COALESCE(p_phone,''))>50 OR LENGTH(COALESCE(p_email,''))>320
    OR LENGTH(COALESCE(p_department,''))>200 OR LENGTH(COALESCE(p_position,''))>200
    OR (NULLIF(BTRIM(p_email),'') IS NOT NULL AND BTRIM(p_email)!~*'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
  THEN RAISE EXCEPTION 'بيانات الموظف غير صالحة'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_company_id::TEXT||':employee-limit',0));
  SELECT sp.max_employees INTO v_max FROM subscriptions s
  LEFT JOIN subscription_plans sp ON sp.id=s.plan_id
  WHERE s.company_id=p_company_id ORDER BY s.created_at DESC LIMIT 1;
  IF v_max IS NOT NULL AND (SELECT COUNT(*) FROM employees WHERE company_id=p_company_id)>=v_max
  THEN RAISE EXCEPTION 'تم الوصول للحد الأقصى من الموظفين في الباقة'; END IF;
  PERFORM set_config('app.hr_write_company',p_company_id::TEXT,TRUE);
  INSERT INTO employees(company_id,name,phone,email,salary,department,position,hire_date,is_active)
  VALUES(p_company_id,BTRIM(p_name),NULLIF(BTRIM(p_phone),''),LOWER(NULLIF(BTRIM(p_email),'')),p_salary,
    NULLIF(BTRIM(p_department),''),NULLIF(BTRIM(p_position),''),p_hire_date,TRUE)
  RETURNING * INTO v_employee;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'create','employee',v_employee.id,to_jsonb(v_employee));
  RETURN to_jsonb(v_employee);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_employee_atomic(
  p_company_id UUID,p_employee_id UUID,p_patch JSONB,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old employees%ROWTYPE; v_new employees%ROWTYPE; v_salary NUMERIC; v_hire DATE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch)<>'object' OR p_patch='{}'::JSONB OR EXISTS(
    SELECT 1 FROM jsonb_object_keys(p_patch) key
    WHERE key NOT IN('name','phone','email','salary','department','position','hire_date')
  ) THEN RAISE EXCEPTION 'بيانات الموظف غير صالحة'; END IF;
  SELECT * INTO v_old FROM employees WHERE id=p_employee_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الموظف غير موجود'; END IF;
  BEGIN
    v_salary:=CASE WHEN p_patch?'salary' THEN (p_patch->>'salary')::NUMERIC ELSE v_old.salary END;
    v_hire:=CASE WHEN p_patch?'hire_date' THEN (p_patch->>'hire_date')::DATE ELSE v_old.hire_date END;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow
    THEN RAISE EXCEPTION 'بيانات الموظف غير صالحة'; END;
  IF NULLIF(BTRIM(CASE WHEN p_patch?'name' THEN p_patch->>'name' ELSE v_old.name END),'') IS NULL
    OR LENGTH(CASE WHEN p_patch?'name' THEN p_patch->>'name' ELSE v_old.name END)>200
    OR v_salary<0 OR v_salary<>ROUND(v_salary,2)
    OR LENGTH(COALESCE(CASE WHEN p_patch?'phone' THEN p_patch->>'phone' ELSE v_old.phone END,''))>50
    OR LENGTH(COALESCE(CASE WHEN p_patch?'email' THEN p_patch->>'email' ELSE v_old.email END,''))>320
    OR LENGTH(COALESCE(CASE WHEN p_patch?'department' THEN p_patch->>'department' ELSE v_old.department END,''))>200
    OR LENGTH(COALESCE(CASE WHEN p_patch?'position' THEN p_patch->>'position' ELSE v_old.position END,''))>200
  THEN RAISE EXCEPTION 'بيانات الموظف غير صالحة'; END IF;
  IF p_patch?'email' AND NULLIF(BTRIM(p_patch->>'email'),'') IS NOT NULL
    AND BTRIM(p_patch->>'email')!~*'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  THEN RAISE EXCEPTION 'البريد الإلكتروني غير صالح'; END IF;
  PERFORM set_config('app.hr_write_company',p_company_id::TEXT,TRUE);
  UPDATE employees SET
    name=CASE WHEN p_patch?'name' THEN BTRIM(p_patch->>'name') ELSE name END,
    phone=CASE WHEN p_patch?'phone' THEN NULLIF(BTRIM(p_patch->>'phone'),'') ELSE phone END,
    email=CASE WHEN p_patch?'email' THEN LOWER(NULLIF(BTRIM(p_patch->>'email'),'')) ELSE email END,
    salary=v_salary,
    department=CASE WHEN p_patch?'department' THEN NULLIF(BTRIM(p_patch->>'department'),'') ELSE department END,
    position=CASE WHEN p_patch?'position' THEN NULLIF(BTRIM(p_patch->>'position'),'') ELSE position END,
    hire_date=v_hire
  WHERE id=p_employee_id RETURNING * INTO v_new;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'update','employee',p_employee_id,to_jsonb(v_old),to_jsonb(v_new));
  RETURN to_jsonb(v_new);
END;
$$;

CREATE OR REPLACE FUNCTION public.deactivate_employee_atomic(
  p_company_id UUID,p_employee_id UUID,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old employees%ROWTYPE; v_new employees%ROWTYPE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  SELECT * INTO v_old FROM employees WHERE id=p_employee_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الموظف غير موجود'; END IF;
  IF NOT COALESCE(v_old.is_active,TRUE) THEN RAISE EXCEPTION 'الموظف غير نشط بالفعل'; END IF;
  PERFORM set_config('app.hr_write_company',p_company_id::TEXT,TRUE);
  UPDATE employees SET is_active=FALSE WHERE id=p_employee_id RETURNING * INTO v_new;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'deactivate','employee',p_employee_id,to_jsonb(v_old),to_jsonb(v_new));
  RETURN to_jsonb(v_new);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_employee_advance(
  p_company_id UUID,p_employee_id UUID,p_date DATE,p_amount NUMERIC,p_reason TEXT,
  p_bank_safe_id UUID,p_created_by UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_result JSONB;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_created_by AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  PERFORM set_config('app.hr_write_company',p_company_id::TEXT,TRUE);
  v_result:=create_employee_advance_v49_internal(p_company_id,p_employee_id,p_date,p_amount,p_reason,
    p_bank_safe_id,p_created_by);
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_created_by,'create','employee_advance',(v_result->>'id')::UUID,v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_employee_advance_note_atomic(
  p_company_id UUID,p_advance_id UUID,p_reason TEXT,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old employee_advances%ROWTYPE; v_new employee_advances%ROWTYPE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  IF LENGTH(COALESCE(p_reason,''))>2000 THEN RAISE EXCEPTION 'السبب غير صالح'; END IF;
  SELECT * INTO v_old FROM employee_advances WHERE id=p_advance_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'السلفة غير موجودة'; END IF;
  IF v_old.status='cancelled' THEN RAISE EXCEPTION 'السلفة ملغاة'; END IF;
  PERFORM set_config('app.hr_write_company',p_company_id::TEXT,TRUE);
  UPDATE employee_advances SET reason=NULLIF(BTRIM(p_reason),'') WHERE id=p_advance_id RETURNING * INTO v_new;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'update','employee_advance',p_advance_id,to_jsonb(v_old),to_jsonb(v_new));
  RETURN to_jsonb(v_new);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_employee_advance_atomic(
  p_company_id UUID,p_advance_id UUID,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old employee_advances%ROWTYPE; v_new employee_advances%ROWTYPE; v_reversal UUID;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  SELECT * INTO v_old FROM employee_advances WHERE id=p_advance_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'السلفة غير موجودة'; END IF;
  IF v_old.status='cancelled' THEN RETURN jsonb_build_object('id',p_advance_id,'status','cancelled','already_processed',TRUE); END IF;
  IF v_old.voucher_disbursement_id IS NOT NULL THEN RAISE EXCEPTION 'ألغِ سند الصرف المرتبط بالسلفة'; END IF;
  IF v_old.custody_id IS NOT NULL THEN RAISE EXCEPTION 'لا يمكن إلغاء عجز عهدة من مسار السلف'; END IF;
  IF v_old.remaining_amount<v_old.amount-0.005 THEN RAISE EXCEPTION 'لا يمكن إلغاء سلفة سُوّي جزء منها في الرواتب'; END IF;
  PERFORM set_config('app.hr_write_company',p_company_id::TEXT,TRUE);
  IF v_old.journal_entry_id IS NOT NULL THEN
    v_reversal:=post_journal_reversal(p_company_id,v_old.journal_entry_id,'employee_advance_reversal',p_advance_id,
      'عكس سلفة موظف',p_user_id);
  END IF;
  UPDATE employee_advances SET status='cancelled',remaining_amount=0
  WHERE id=p_advance_id RETURNING * INTO v_new;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'cancel','employee_advance',p_advance_id,to_jsonb(v_old),
    to_jsonb(v_new)||jsonb_build_object('reversal_journal_id',v_reversal));
  RETURN to_jsonb(v_new)||jsonb_build_object('reversal_journal_id',v_reversal);
END;
$$;

CREATE OR REPLACE FUNCTION public.post_payroll_batch(
  p_company_id UUID,p_date DATE,p_employee_ids UUID[],p_created_by UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_result JSONB;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_created_by AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  PERFORM set_config('app.hr_write_company',p_company_id::TEXT,TRUE);
  v_result:=post_payroll_batch_v49_internal(p_company_id,p_date,p_employee_ids,p_created_by);
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_created_by,'post_batch','payroll',(v_result->>'journal_entry_id')::UUID,v_result);
  RETURN v_result;
END;
$$;

-- Custody opening requires an active employee; later settlement remains allowed
-- after deactivation so an existing file can still be closed correctly.
CREATE OR REPLACE FUNCTION public.open_custody_file(
  p_company_id UUID,p_employee_id UUID,p_date DATE,p_amount NUMERIC,p_reason TEXT,
  p_bank_safe_id UUID,p_project_id UUID,p_created_by UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_result JSONB;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_created_by AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  IF NOT EXISTS(SELECT 1 FROM employees WHERE id=p_employee_id AND company_id=p_company_id AND COALESCE(is_active,TRUE))
  THEN RAISE EXCEPTION 'الموظف غير موجود أو غير نشط'; END IF;
  PERFORM set_config('app.custody_write_company',p_company_id::TEXT,TRUE);
  v_result:=open_custody_file_v49_internal(p_company_id,p_employee_id,p_date,p_amount,p_reason,
    p_bank_safe_id,p_project_id,p_created_by);
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_created_by,'open','custody',(v_result->>'id')::UUID,v_result);
  RETURN v_result;
END;
$$;

-- Voucher cancellation and custody settlement also mutate employee advances.
CREATE OR REPLACE FUNCTION public.cancel_voucher_disbursement_atomic(
  p_company_id UUID,p_voucher_id UUID,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_result JSONB;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  PERFORM set_config('app.hr_write_company',p_company_id::TEXT,TRUE);
  v_result:=cancel_voucher_disbursement_atomic_v50_internal(p_company_id,p_voucher_id,p_user_id);
  UPDATE employee_advances SET remaining_amount=0
  WHERE company_id=p_company_id AND status='cancelled' AND remaining_amount<>0;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_custody_file(
  p_company_id UUID,p_custody_id UUID,p_date DATE,p_returned_cash NUMERIC,p_bank_safe_id UUID,
  p_description TEXT,p_created_by UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_created_by AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  PERFORM set_config('app.hr_write_company',p_company_id::TEXT,TRUE);
  RETURN settle_custody_file_v56_internal(p_company_id,p_custody_id,p_date,p_returned_cash,
    p_bank_safe_id,p_description,p_created_by);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_fixed_asset(
  p_company_id UUID,p_name TEXT,p_code TEXT,p_category TEXT,p_purchase_date DATE,
  p_purchase_cost NUMERIC,p_useful_life_years INTEGER,p_depreciation_method TEXT,
  p_location TEXT,p_notes TEXT,p_bank_safe_id UUID,p_created_by UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_result JSONB;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_created_by AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  PERFORM set_config('app.asset_write_company',p_company_id::TEXT,TRUE);
  v_result:=create_fixed_asset_v49_internal(p_company_id,p_name,p_code,p_category,p_purchase_date,
    p_purchase_cost,p_useful_life_years,p_depreciation_method,p_location,p_notes,p_bank_safe_id,p_created_by);
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_created_by,'create','fixed_asset',(v_result->>'id')::UUID,v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.depreciate_fixed_asset(
  p_company_id UUID,p_asset_id UUID,p_date DATE,p_expense_account_id UUID,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_result JSONB;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  IF NOT EXISTS(SELECT 1 FROM accounts WHERE id=p_expense_account_id AND company_id=p_company_id
    AND type='expense' AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE))
  THEN RAISE EXCEPTION 'حساب مصروف الإهلاك غير صالح'; END IF;
  PERFORM set_config('app.asset_write_company',p_company_id::TEXT,TRUE);
  v_result:=depreciate_fixed_asset_v49_internal(p_company_id,p_asset_id,p_date,p_expense_account_id,p_user_id);
  IF v_result->>'status'='created' THEN
    INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
    VALUES(p_company_id,p_user_id,'depreciate','fixed_asset',p_asset_id,v_result);
  END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.depreciate_fixed_assets_batch(
  p_company_id UUID,p_date DATE,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_expense UUID; v_asset RECORD; v_result JSONB; v_entries JSONB:='[]'::JSONB; v_total NUMERIC:=0;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  IF p_date IS NULL OR p_date<>date_trunc('month',p_date)::DATE THEN RAISE EXCEPTION 'تاريخ الإهلاك غير صالح'; END IF;
  SELECT id INTO v_expense FROM accounts WHERE company_id=p_company_id AND code='5260'
    AND type='expense' AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
  IF v_expense IS NULL THEN RAISE EXCEPTION 'حساب مصروف الإهلاك غير موجود'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_company_id::TEXT||':depreciation:'||p_date::TEXT,0));
  FOR v_asset IN SELECT id,code FROM fixed_assets WHERE company_id=p_company_id AND status='active'
    AND purchase_date<=p_date ORDER BY id FOR UPDATE LOOP
    v_result:=depreciate_fixed_asset(p_company_id,v_asset.id,p_date,v_expense,p_user_id);
    IF v_result->>'status'='created' THEN
      v_total:=v_total+COALESCE((v_result->>'amount')::NUMERIC,0);
      v_entries:=v_entries||jsonb_build_array(jsonb_build_object(
        'asset',v_asset.code,'amount',(v_result->>'amount')::NUMERIC,'journal_id',v_result->>'journal_id'));
    END IF;
  END LOOP;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,new_values)
  VALUES(p_company_id,p_user_id,'depreciate_batch','fixed_assets',jsonb_build_object(
    'date',p_date,'total',v_total,'count',jsonb_array_length(v_entries)));
  RETURN jsonb_build_object('date',p_date,'totalDepreciation',v_total,
    'count',jsonb_array_length(v_entries),'entries',v_entries);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_fixed_asset_metadata_atomic(
  p_company_id UUID,p_asset_id UUID,p_patch JSONB,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old fixed_assets%ROWTYPE; v_new fixed_assets%ROWTYPE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch)<>'object' OR p_patch='{}'::JSONB OR EXISTS(
    SELECT 1 FROM jsonb_object_keys(p_patch) key WHERE key NOT IN('name','location','notes')
  ) OR p_patch?'name' AND NULLIF(BTRIM(p_patch->>'name'),'') IS NULL
    OR LENGTH(COALESCE(p_patch->>'name',''))>200 OR LENGTH(COALESCE(p_patch->>'location',''))>500
    OR LENGTH(COALESCE(p_patch->>'notes',''))>2000
  THEN RAISE EXCEPTION 'بيانات الأصل غير صالحة'; END IF;
  SELECT * INTO v_old FROM fixed_assets WHERE id=p_asset_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الأصل غير موجود'; END IF;
  IF v_old.status='disposed' THEN RAISE EXCEPTION 'لا يمكن تعديل أصل مستبعد'; END IF;
  PERFORM set_config('app.asset_write_company',p_company_id::TEXT,TRUE);
  UPDATE fixed_assets SET
    name=CASE WHEN p_patch?'name' THEN BTRIM(p_patch->>'name') ELSE name END,
    location=CASE WHEN p_patch?'location' THEN NULLIF(BTRIM(p_patch->>'location'),'') ELSE location END,
    notes=CASE WHEN p_patch?'notes' THEN NULLIF(BTRIM(p_patch->>'notes'),'') ELSE notes END
  WHERE id=p_asset_id RETURNING * INTO v_new;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'update','fixed_asset',p_asset_id,to_jsonb(v_old),to_jsonb(v_new));
  RETURN to_jsonb(v_new);
END;
$$;

CREATE OR REPLACE FUNCTION public.dispose_fixed_asset_atomic(
  p_company_id UUID,p_asset_id UUID,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old fixed_assets%ROWTYPE; v_new fixed_assets%ROWTYPE; v_reversal UUID;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  SELECT * INTO v_old FROM fixed_assets WHERE id=p_asset_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الأصل غير موجود'; END IF;
  IF v_old.status='disposed' THEN RETURN jsonb_build_object('id',p_asset_id,'status','disposed','already_processed',TRUE); END IF;
  IF COALESCE(v_old.accumulated_depreciation,0)>0.005 OR EXISTS(
    SELECT 1 FROM depreciation_log WHERE asset_id=p_asset_id AND company_id=p_company_id)
  THEN RAISE EXCEPTION 'لا يمكن استبعاد أصل له إهلاك من هذا المسار'; END IF;
  IF v_old.journal_entry_id IS NULL THEN RAISE EXCEPTION 'قيد شراء الأصل غير موجود'; END IF;
  PERFORM set_config('app.asset_write_company',p_company_id::TEXT,TRUE);
  v_reversal:=post_journal_reversal(p_company_id,v_old.journal_entry_id,'fixed_asset_disposal_reversal',p_asset_id,
    'عكس قيد شراء أصل ثابت عند استبعاده',p_user_id);
  UPDATE fixed_assets SET status='disposed' WHERE id=p_asset_id RETURNING * INTO v_new;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'dispose','fixed_asset',p_asset_id,to_jsonb(v_old),
    to_jsonb(v_new)||jsonb_build_object('reversal_journal_id',v_reversal));
  RETURN to_jsonb(v_new)||jsonb_build_object('reversal_journal_id',v_reversal);
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_employee_writes()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_company UUID:=CASE WHEN TG_OP='DELETE' THEN OLD.company_id ELSE NEW.company_id END;
BEGIN
  IF current_setting('app.business_data_reset',TRUE)=v_company::TEXT THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF current_setting('app.hr_write_company',TRUE) IS DISTINCT FROM v_company::TEXT
  THEN RAISE EXCEPTION 'employees are writable only through audited functions'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF TG_OP='UPDATE' AND NEW.company_id IS DISTINCT FROM OLD.company_id THEN RAISE EXCEPTION 'employee tenant cannot change'; END IF;
  IF NEW.salary<0 OR NEW.salary<>ROUND(NEW.salary,2) OR NULLIF(BTRIM(NEW.name),'') IS NULL
    OR LENGTH(NEW.name)>200 OR LENGTH(COALESCE(NEW.phone,''))>50 OR LENGTH(COALESCE(NEW.email,''))>320
    OR (NEW.branch_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM branches WHERE id=NEW.branch_id AND company_id=NEW.company_id))
    OR (NEW.cost_center_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cost_centers WHERE id=NEW.cost_center_id AND company_id=NEW.company_id))
  THEN RAISE EXCEPTION 'invalid employee values or tenant link'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_hr_financial_writes()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_company UUID:=CASE WHEN TG_OP='DELETE' THEN OLD.company_id ELSE NEW.company_id END;
BEGIN
  IF current_setting('app.business_data_reset',TRUE)=v_company::TEXT THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF current_setting('app.hr_write_company',TRUE) IS DISTINCT FROM v_company::TEXT
  THEN RAISE EXCEPTION 'HR financial records are writable only through lifecycle functions'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF TG_OP='UPDATE' AND NEW.company_id IS DISTINCT FROM OLD.company_id THEN RAISE EXCEPTION 'HR financial tenant cannot change'; END IF;
  IF NOT EXISTS(SELECT 1 FROM employees WHERE id=NEW.employee_id AND company_id=NEW.company_id)
    OR (NEW.journal_entry_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM journal_entries WHERE id=NEW.journal_entry_id AND company_id=NEW.company_id))
  THEN RAISE EXCEPTION 'cross-tenant HR financial link'; END IF;
  IF TG_TABLE_NAME='employee_advances' THEN
    IF NEW.amount<=0 OR NEW.amount<>ROUND(NEW.amount,2) OR NEW.remaining_amount<0
      OR NEW.remaining_amount>NEW.amount OR NEW.remaining_amount<>ROUND(NEW.remaining_amount,2)
      OR LENGTH(COALESCE(NEW.reason,''))>2000
      OR (NEW.custody_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM custodies WHERE id=NEW.custody_id AND company_id=NEW.company_id))
      OR (NEW.voucher_disbursement_id IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM voucher_disbursements WHERE id=NEW.voucher_disbursement_id AND company_id=NEW.company_id))
    THEN RAISE EXCEPTION 'invalid employee advance'; END IF;
  ELSE
    IF NEW.basic_salary<0 OR NEW.allowances<0 OR NEW.deductions<0 OR NEW.advance_deduction<0 OR NEW.net_pay<0
      OR NEW.basic_salary<>ROUND(NEW.basic_salary,2) OR NEW.allowances<>ROUND(NEW.allowances,2)
      OR NEW.deductions<>ROUND(NEW.deductions,2) OR NEW.advance_deduction<>ROUND(NEW.advance_deduction,2)
      OR NEW.net_pay<>ROUND(NEW.net_pay,2)
    THEN RAISE EXCEPTION 'invalid payroll values'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_fixed_asset_writes()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_company UUID:=CASE WHEN TG_OP='DELETE' THEN OLD.company_id ELSE NEW.company_id END;
BEGIN
  IF current_setting('app.business_data_reset',TRUE)=v_company::TEXT THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF current_setting('app.asset_write_company',TRUE) IS DISTINCT FROM v_company::TEXT
  THEN RAISE EXCEPTION 'fixed assets are writable only through lifecycle functions'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF TG_OP='UPDATE' AND NEW.company_id IS DISTINCT FROM OLD.company_id THEN RAISE EXCEPTION 'asset tenant cannot change'; END IF;
  IF NEW.purchase_cost<=0 OR NEW.purchase_cost<>ROUND(NEW.purchase_cost,2)
    OR NEW.accumulated_depreciation<0 OR NEW.accumulated_depreciation>NEW.purchase_cost
    OR NEW.accumulated_depreciation<>ROUND(NEW.accumulated_depreciation,2)
    OR NEW.net_book_value<>ROUND(NEW.net_book_value,2)
    OR NEW.net_book_value<>NEW.purchase_cost-NEW.accumulated_depreciation
    OR (NEW.asset_account_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM accounts WHERE id=NEW.asset_account_id AND company_id=NEW.company_id))
    OR (NEW.depreciation_account_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM accounts WHERE id=NEW.depreciation_account_id AND company_id=NEW.company_id))
    OR (NEW.journal_entry_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM journal_entries WHERE id=NEW.journal_entry_id AND company_id=NEW.company_id))
  THEN RAISE EXCEPTION 'invalid fixed asset values or tenant link'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_depreciation_log_writes()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_company UUID:=CASE WHEN TG_OP='DELETE' THEN OLD.company_id ELSE NEW.company_id END;
BEGIN
  IF current_setting('app.business_data_reset',TRUE)=v_company::TEXT THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF current_setting('app.asset_write_company',TRUE) IS DISTINCT FROM v_company::TEXT
  THEN RAISE EXCEPTION 'depreciation logs are writable only through lifecycle functions'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF TG_OP='UPDATE' AND NEW.company_id IS DISTINCT FROM OLD.company_id THEN RAISE EXCEPTION 'depreciation tenant cannot change'; END IF;
  IF NEW.amount<=0 OR NEW.amount<>ROUND(NEW.amount,2)
    OR NOT EXISTS(SELECT 1 FROM fixed_assets WHERE id=NEW.asset_id AND company_id=NEW.company_id)
    OR NOT EXISTS(SELECT 1 FROM journal_entries WHERE id=NEW.journal_entry_id AND company_id=NEW.company_id)
  THEN RAISE EXCEPTION 'invalid depreciation log'; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_employee_writes ON employees;
CREATE TRIGGER trg_guard_employee_writes BEFORE INSERT OR UPDATE OR DELETE ON employees
FOR EACH ROW EXECUTE FUNCTION guard_employee_writes();
DROP TRIGGER IF EXISTS trg_guard_employee_advance_writes ON employee_advances;
CREATE TRIGGER trg_guard_employee_advance_writes BEFORE INSERT OR UPDATE OR DELETE ON employee_advances
FOR EACH ROW EXECUTE FUNCTION guard_hr_financial_writes();
DROP TRIGGER IF EXISTS trg_guard_payroll_writes ON payroll;
CREATE TRIGGER trg_guard_payroll_writes BEFORE INSERT OR UPDATE OR DELETE ON payroll
FOR EACH ROW EXECUTE FUNCTION guard_hr_financial_writes();
DROP TRIGGER IF EXISTS trg_guard_fixed_asset_writes ON fixed_assets;
CREATE TRIGGER trg_guard_fixed_asset_writes BEFORE INSERT OR UPDATE OR DELETE ON fixed_assets
FOR EACH ROW EXECUTE FUNCTION guard_fixed_asset_writes();
DROP TRIGGER IF EXISTS trg_guard_depreciation_log_writes ON depreciation_log;
CREATE TRIGGER trg_guard_depreciation_log_writes BEFORE INSERT OR UPDATE OR DELETE ON depreciation_log
FOR EACH ROW EXECUTE FUNCTION guard_depreciation_log_writes();

REVOKE ALL ON FUNCTION public.guard_employee_writes() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guard_hr_financial_writes() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guard_fixed_asset_writes() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guard_depreciation_log_writes() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.create_employee_atomic(UUID,TEXT,TEXT,TEXT,NUMERIC,TEXT,TEXT,DATE,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.update_employee_atomic(UUID,UUID,JSONB,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.deactivate_employee_atomic(UUID,UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.create_employee_advance(UUID,UUID,DATE,NUMERIC,TEXT,UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.update_employee_advance_note_atomic(UUID,UUID,TEXT,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cancel_employee_advance_atomic(UUID,UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.post_payroll_batch(UUID,DATE,UUID[],UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cancel_voucher_disbursement_atomic(UUID,UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.settle_custody_file(UUID,UUID,DATE,NUMERIC,UUID,TEXT,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.create_fixed_asset(UUID,TEXT,TEXT,TEXT,DATE,NUMERIC,INTEGER,TEXT,TEXT,TEXT,UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.depreciate_fixed_asset(UUID,UUID,DATE,UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.depreciate_fixed_assets_batch(UUID,DATE,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.update_fixed_asset_metadata_atomic(UUID,UUID,JSONB,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.dispose_fixed_asset_atomic(UUID,UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.create_employee_advance_v49_internal(UUID,UUID,DATE,NUMERIC,TEXT,UUID,UUID) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.post_payroll_batch_v49_internal(UUID,DATE,UUID[],UUID) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.create_fixed_asset_v49_internal(UUID,TEXT,TEXT,TEXT,DATE,NUMERIC,INTEGER,TEXT,TEXT,TEXT,UUID,UUID) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.depreciate_fixed_asset_v49_internal(UUID,UUID,DATE,UUID,UUID) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.cancel_voucher_disbursement_atomic_v50_internal(UUID,UUID,UUID) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.settle_custody_file_v56_internal(UUID,UUID,DATE,NUMERIC,UUID,TEXT,UUID) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.create_employee_atomic(UUID,TEXT,TEXT,TEXT,NUMERIC,TEXT,TEXT,DATE,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_employee_atomic(UUID,UUID,JSONB,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.deactivate_employee_atomic(UUID,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_employee_advance(UUID,UUID,DATE,NUMERIC,TEXT,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_employee_advance_note_atomic(UUID,UUID,TEXT,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_employee_advance_atomic(UUID,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.post_payroll_batch(UUID,DATE,UUID[],UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_voucher_disbursement_atomic(UUID,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_custody_file(UUID,UUID,DATE,NUMERIC,UUID,TEXT,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_fixed_asset(UUID,TEXT,TEXT,TEXT,DATE,NUMERIC,INTEGER,TEXT,TEXT,TEXT,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.depreciate_fixed_asset(UUID,UUID,DATE,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.depreciate_fixed_assets_batch(UUID,DATE,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_fixed_asset_metadata_atomic(UUID,UUID,JSONB,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.dispose_fixed_asset_atomic(UUID,UUID,UUID) TO service_role;

COMMIT;
