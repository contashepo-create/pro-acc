-- ============================================================
-- 054 - Atomic contact lifecycle and authoritative receivables
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.validate_contact_payload(p_data JSONB,p_require_name BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_key TEXT; v_credit NUMERIC; v_date DATE;
DECLARE v_text_fields CONSTANT TEXT[]:=ARRAY[
  'name','type','phone','email','address','tax_number','commercial_registration',
  'contact_person','contact_person_phone','contact_person_email','city','region','country',
  'postal_code','website','iban','bank_name','swift_code','payment_terms','notes',
  'date_of_birth','gender','national_id','category'
];
BEGIN
  IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' OR EXISTS(
    SELECT 1 FROM jsonb_object_keys(p_data) key
    WHERE key<>ALL(v_text_fields) AND key<>'credit_limit'
  ) THEN RAISE EXCEPTION 'بيانات الطرف غير صالحة'; END IF;
  FOREACH v_key IN ARRAY v_text_fields LOOP
    IF p_data?v_key AND jsonb_typeof(p_data->v_key) NOT IN('string','null')
    THEN RAISE EXCEPTION 'حقل الطرف % غير صالح',v_key; END IF;
  END LOOP;
  IF p_require_name AND NULLIF(BTRIM(p_data->>'name'),'') IS NULL THEN RAISE EXCEPTION 'اسم الطرف مطلوب'; END IF;
  IF p_data?'name' AND (NULLIF(BTRIM(p_data->>'name'),'') IS NULL OR length(p_data->>'name')>200)
  THEN RAISE EXCEPTION 'اسم الطرف غير صالح'; END IF;
  IF p_data?'type' AND COALESCE(p_data->>'type','') NOT IN('client','supplier','subcontractor','both')
  THEN RAISE EXCEPTION 'نوع الطرف غير صالح'; END IF;
  IF p_data?'email' AND NULLIF(BTRIM(p_data->>'email'),'') IS NOT NULL
    AND p_data->>'email'!~*'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  THEN RAISE EXCEPTION 'البريد الإلكتروني غير صالح'; END IF;
  IF p_data?'contact_person_email' AND NULLIF(BTRIM(p_data->>'contact_person_email'),'') IS NOT NULL
    AND p_data->>'contact_person_email'!~*'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  THEN RAISE EXCEPTION 'بريد مسؤول الاتصال غير صالح'; END IF;
  IF length(COALESCE(p_data->>'phone',''))>50 OR length(COALESCE(p_data->>'email',''))>254
    OR length(COALESCE(p_data->>'address',''))>500
    OR length(COALESCE(p_data->>'tax_number',''))>100 OR length(COALESCE(p_data->>'commercial_registration',''))>100
    OR length(COALESCE(p_data->>'contact_person',''))>200 OR length(COALESCE(p_data->>'contact_person_phone',''))>50
    OR length(COALESCE(p_data->>'contact_person_email',''))>254 OR length(COALESCE(p_data->>'city',''))>100
    OR length(COALESCE(p_data->>'region',''))>100 OR length(COALESCE(p_data->>'country',''))>100
    OR length(COALESCE(p_data->>'postal_code',''))>20 OR length(COALESCE(p_data->>'website',''))>300
    OR length(COALESCE(p_data->>'iban',''))>50 OR length(COALESCE(p_data->>'bank_name',''))>200
    OR length(COALESCE(p_data->>'swift_code',''))>20 OR length(COALESCE(p_data->>'payment_terms',''))>50
    OR length(COALESCE(p_data->>'notes',''))>2000 OR length(COALESCE(p_data->>'gender',''))>20
    OR length(COALESCE(p_data->>'national_id',''))>50 OR length(COALESCE(p_data->>'category',''))>100
  THEN RAISE EXCEPTION 'أحد حقول الطرف أطول من المسموح'; END IF;
  IF p_data?'credit_limit' THEN
    BEGIN v_credit:=COALESCE((p_data->>'credit_limit')::NUMERIC,0);
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'الحد الائتماني غير صالح'; END;
    IF v_credit<0 OR v_credit<>round(v_credit,2) THEN RAISE EXCEPTION 'الحد الائتماني غير صالح'; END IF;
  END IF;
  IF NULLIF(p_data->>'date_of_birth','') IS NOT NULL THEN
    IF p_data->>'date_of_birth'!~'^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'تاريخ الميلاد غير صالح'; END IF;
    BEGIN v_date:=(p_data->>'date_of_birth')::DATE;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'تاريخ الميلاد غير صالح'; END;
    IF to_char(v_date,'YYYY-MM-DD')<>p_data->>'date_of_birth'
      OR v_date>CURRENT_DATE OR v_date<DATE '1900-01-01' THEN RAISE EXCEPTION 'تاريخ الميلاد غير صالح'; END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_contact_plan_limit(
  p_company_id UUID,p_type TEXT,p_exclude_contact_id UUID DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_max_clients INTEGER; v_max_suppliers INTEGER; v_count INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('contact-limit:'||p_company_id::TEXT,0));
  SELECT sp.max_clients,sp.max_suppliers INTO v_max_clients,v_max_suppliers
  FROM subscriptions s JOIN subscription_plans sp ON sp.id=s.plan_id
  WHERE s.company_id=p_company_id ORDER BY s.created_at DESC LIMIT 1;
  IF p_type IN('client','both') AND v_max_clients IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM contacts
    WHERE company_id=p_company_id AND id IS DISTINCT FROM p_exclude_contact_id
      AND type IN('client','both') AND COALESCE(is_active,TRUE) AND deleted_at IS NULL;
    IF v_count>=v_max_clients THEN RAISE EXCEPTION 'contact plan limit: clients'; END IF;
  END IF;
  IF p_type IN('supplier','subcontractor','both') AND v_max_suppliers IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM contacts
    WHERE company_id=p_company_id AND id IS DISTINCT FROM p_exclude_contact_id
      AND type IN('supplier','subcontractor','both') AND COALESCE(is_active,TRUE) AND deleted_at IS NULL;
    IF v_count>=v_max_suppliers THEN RAISE EXCEPTION 'contact plan limit: suppliers'; END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_contact_atomic(
  p_company_id UUID,p_user_id UUID,p_data JSONB,p_opening_amount NUMERIC,p_opening_type TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_contact contacts%ROWTYPE; v_type TEXT; v_control UUID; v_capital UUID;
  v_journal JSONB; v_journal_id UUID; v_lines JSONB; v_amount NUMERIC:=COALESCE(p_opening_amount,0);
BEGIN
  PERFORM validate_contact_payload(p_data,TRUE);
  v_type:=p_data->>'type';
  IF v_type IS NULL THEN RAISE EXCEPTION 'نوع الطرف مطلوب'; END IF;
  IF v_amount<0 OR v_amount<>round(v_amount,2) OR p_opening_type NOT IN('debit','credit')
  THEN RAISE EXCEPTION 'الرصيد الافتتاحي غير صالح'; END IF;
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  PERFORM enforce_contact_plan_limit(p_company_id,v_type,NULL);
  IF EXISTS(SELECT 1 FROM contacts WHERE company_id=p_company_id AND lower(btrim(name))=lower(btrim(p_data->>'name')))
  THEN RAISE EXCEPTION 'اسم الطرف مستخدم مسبقاً'; END IF;

  INSERT INTO contacts(company_id,name,type,phone,email,address,tax_number,commercial_registration,
    contact_person,contact_person_phone,contact_person_email,city,region,country,postal_code,website,
    iban,bank_name,swift_code,payment_terms,notes,date_of_birth,gender,national_id,category,credit_limit,
    is_active,created_by,deleted_at)
  VALUES(p_company_id,btrim(p_data->>'name'),v_type,NULLIF(btrim(p_data->>'phone'),''),
    NULLIF(lower(btrim(p_data->>'email')),''),NULLIF(btrim(p_data->>'address'),''),
    NULLIF(btrim(p_data->>'tax_number'),''),NULLIF(btrim(p_data->>'commercial_registration'),''),
    NULLIF(btrim(p_data->>'contact_person'),''),NULLIF(btrim(p_data->>'contact_person_phone'),''),
    NULLIF(lower(btrim(p_data->>'contact_person_email')),''),NULLIF(btrim(p_data->>'city'),''),
    NULLIF(btrim(p_data->>'region'),''),NULLIF(btrim(p_data->>'country'),''),NULLIF(btrim(p_data->>'postal_code'),''),
    NULLIF(btrim(p_data->>'website'),''),NULLIF(btrim(p_data->>'iban'),''),NULLIF(btrim(p_data->>'bank_name'),''),
    NULLIF(btrim(p_data->>'swift_code'),''),NULLIF(btrim(p_data->>'payment_terms'),''),NULLIF(btrim(p_data->>'notes'),''),
    NULLIF(p_data->>'date_of_birth','')::DATE,NULLIF(btrim(p_data->>'gender'),''),
    NULLIF(btrim(p_data->>'national_id'),''),NULLIF(btrim(p_data->>'category'),''),
    COALESCE((p_data->>'credit_limit')::NUMERIC,0),TRUE,p_user_id,NULL)
  RETURNING * INTO v_contact;

  IF v_amount>0 THEN
    SELECT id INTO v_control FROM accounts WHERE company_id=p_company_id
      AND code=CASE WHEN v_type IN('supplier','subcontractor') THEN '2110' ELSE '1130' END
      AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
    SELECT id INTO v_capital FROM accounts WHERE company_id=p_company_id AND code='3100'
      AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
    IF v_control IS NULL OR v_capital IS NULL THEN RAISE EXCEPTION 'حسابات الرصيد الافتتاحي غير مكتملة'; END IF;
    v_lines:=CASE WHEN p_opening_type='debit' THEN jsonb_build_array(
      jsonb_build_object('accountId',v_control,'debit',v_amount,'credit',0,'contactId',v_contact.id),
      jsonb_build_object('accountId',v_capital,'debit',0,'credit',v_amount)) ELSE jsonb_build_array(
      jsonb_build_object('accountId',v_control,'debit',0,'credit',v_amount,'contactId',v_contact.id),
      jsonb_build_object('accountId',v_capital,'debit',v_amount,'credit',0)) END;
    v_journal:=create_journal_entry(p_company_id,CURRENT_DATE,'opening_balance','رصيد افتتاحي - '||v_contact.name,p_user_id,v_lines);
    v_journal_id:=(v_journal->>'id')::UUID;
    UPDATE journal_entries SET reference_type='contact_opening_balance',reference_id=v_contact.id
      WHERE id=v_journal_id AND company_id=p_company_id;
  END IF;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'create','contact',v_contact.id,to_jsonb(v_contact)||jsonb_build_object('opening_journal_id',v_journal_id));
  RETURN to_jsonb(v_contact)||jsonb_build_object('opening_journal_id',v_journal_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_contact_atomic(
  p_company_id UUID,p_contact_id UUID,p_patch JSONB,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old contacts%ROWTYPE; v_new contacts%ROWTYPE; v_type TEXT;
BEGIN
  IF p_patch IS NULL OR p_patch='{}'::JSONB THEN RAISE EXCEPTION 'لا توجد بيانات للتحديث'; END IF;
  PERFORM validate_contact_payload(p_patch,FALSE);
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  SELECT * INTO v_old FROM contacts WHERE id=p_contact_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND OR NOT COALESCE(v_old.is_active,TRUE) OR v_old.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'الطرف غير موجود'; END IF;
  v_type:=CASE WHEN p_patch?'type' THEN p_patch->>'type' ELSE v_old.type END;
  IF v_type<>v_old.type AND (
    EXISTS(SELECT 1 FROM journal_lines WHERE company_id=p_company_id AND contact_id=p_contact_id)
    OR EXISTS(SELECT 1 FROM invoices WHERE company_id=p_company_id AND contact_id=p_contact_id)
    OR EXISTS(SELECT 1 FROM purchase_invoices WHERE company_id=p_company_id AND supplier_id=p_contact_id)
    OR EXISTS(SELECT 1 FROM projects WHERE company_id=p_company_id AND client_id=p_contact_id)
    OR EXISTS(SELECT 1 FROM quotations WHERE company_id=p_company_id AND contact_id=p_contact_id)
  ) THEN RAISE EXCEPTION 'لا يمكن تغيير نوع طرف مرتبط بمعاملات'; END IF;
  PERFORM enforce_contact_plan_limit(p_company_id,v_type,p_contact_id);
  IF p_patch?'name' AND EXISTS(SELECT 1 FROM contacts WHERE company_id=p_company_id AND id<>p_contact_id
    AND lower(btrim(name))=lower(btrim(p_patch->>'name')))
  THEN RAISE EXCEPTION 'اسم الطرف مستخدم مسبقاً'; END IF;

  UPDATE contacts SET
    name=CASE WHEN p_patch?'name' THEN btrim(p_patch->>'name') ELSE name END,
    type=v_type,
    phone=CASE WHEN p_patch?'phone' THEN NULLIF(btrim(p_patch->>'phone'),'') ELSE phone END,
    email=CASE WHEN p_patch?'email' THEN NULLIF(lower(btrim(p_patch->>'email')),'') ELSE email END,
    address=CASE WHEN p_patch?'address' THEN NULLIF(btrim(p_patch->>'address'),'') ELSE address END,
    tax_number=CASE WHEN p_patch?'tax_number' THEN NULLIF(btrim(p_patch->>'tax_number'),'') ELSE tax_number END,
    commercial_registration=CASE WHEN p_patch?'commercial_registration' THEN NULLIF(btrim(p_patch->>'commercial_registration'),'') ELSE commercial_registration END,
    contact_person=CASE WHEN p_patch?'contact_person' THEN NULLIF(btrim(p_patch->>'contact_person'),'') ELSE contact_person END,
    contact_person_phone=CASE WHEN p_patch?'contact_person_phone' THEN NULLIF(btrim(p_patch->>'contact_person_phone'),'') ELSE contact_person_phone END,
    contact_person_email=CASE WHEN p_patch?'contact_person_email' THEN NULLIF(lower(btrim(p_patch->>'contact_person_email')),'') ELSE contact_person_email END,
    city=CASE WHEN p_patch?'city' THEN NULLIF(btrim(p_patch->>'city'),'') ELSE city END,
    region=CASE WHEN p_patch?'region' THEN NULLIF(btrim(p_patch->>'region'),'') ELSE region END,
    country=CASE WHEN p_patch?'country' THEN NULLIF(btrim(p_patch->>'country'),'') ELSE country END,
    postal_code=CASE WHEN p_patch?'postal_code' THEN NULLIF(btrim(p_patch->>'postal_code'),'') ELSE postal_code END,
    website=CASE WHEN p_patch?'website' THEN NULLIF(btrim(p_patch->>'website'),'') ELSE website END,
    iban=CASE WHEN p_patch?'iban' THEN NULLIF(btrim(p_patch->>'iban'),'') ELSE iban END,
    bank_name=CASE WHEN p_patch?'bank_name' THEN NULLIF(btrim(p_patch->>'bank_name'),'') ELSE bank_name END,
    swift_code=CASE WHEN p_patch?'swift_code' THEN NULLIF(btrim(p_patch->>'swift_code'),'') ELSE swift_code END,
    payment_terms=CASE WHEN p_patch?'payment_terms' THEN NULLIF(btrim(p_patch->>'payment_terms'),'') ELSE payment_terms END,
    notes=CASE WHEN p_patch?'notes' THEN NULLIF(btrim(p_patch->>'notes'),'') ELSE notes END,
    date_of_birth=CASE WHEN p_patch?'date_of_birth' THEN NULLIF(p_patch->>'date_of_birth','')::DATE ELSE date_of_birth END,
    gender=CASE WHEN p_patch?'gender' THEN NULLIF(btrim(p_patch->>'gender'),'') ELSE gender END,
    national_id=CASE WHEN p_patch?'national_id' THEN NULLIF(btrim(p_patch->>'national_id'),'') ELSE national_id END,
    category=CASE WHEN p_patch?'category' THEN NULLIF(btrim(p_patch->>'category'),'') ELSE category END,
    credit_limit=CASE WHEN p_patch?'credit_limit' THEN COALESCE((p_patch->>'credit_limit')::NUMERIC,0) ELSE credit_limit END
  WHERE id=p_contact_id AND company_id=p_company_id RETURNING * INTO v_new;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'update','contact',p_contact_id,to_jsonb(v_old),to_jsonb(v_new));
  RETURN to_jsonb(v_new);
END;
$$;

CREATE OR REPLACE FUNCTION public.deactivate_contact_atomic(
  p_company_id UUID,p_contact_id UUID,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old contacts%ROWTYPE; v_new contacts%ROWTYPE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  SELECT * INTO v_old FROM contacts WHERE id=p_contact_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الطرف غير موجود'; END IF;
  IF NOT COALESCE(v_old.is_active,TRUE) OR v_old.deleted_at IS NOT NULL
  THEN RETURN jsonb_build_object('id',p_contact_id,'is_active',FALSE,'already_processed',TRUE); END IF;
  UPDATE contacts SET is_active=FALSE,deleted_at=now() WHERE id=p_contact_id RETURNING * INTO v_new;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'deactivate','contact',p_contact_id,to_jsonb(v_old),to_jsonb(v_new));
  RETURN to_jsonb(v_new)||jsonb_build_object('already_processed',FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_subcontractor_atomic(
  p_company_id UUID,p_contact_id UUID,p_patch JSONB,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM 1 FROM contacts WHERE id=p_contact_id AND company_id=p_company_id
    AND type='subcontractor' AND COALESCE(is_active,TRUE) AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المقاول غير موجود'; END IF;
  RETURN update_contact_atomic(p_company_id,p_contact_id,p_patch,p_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.deactivate_subcontractor_atomic(
  p_company_id UUID,p_contact_id UUID,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM 1 FROM contacts WHERE id=p_contact_id AND company_id=p_company_id
    AND type='subcontractor' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المقاول غير موجود'; END IF;
  RETURN deactivate_contact_atomic(p_company_id,p_contact_id,p_user_id);
END;
$$;

-- Only control-account movements belong in an auxiliary contact ledger. Revenue,
-- expense, cash and bank counterpart lines may carry contact_id for analytics,
-- but including them would make every balanced transaction net to zero.
CREATE OR REPLACE FUNCTION public.get_contact_balance(
  p_company_id UUID,p_contact_id UUID,p_as_of DATE DEFAULT NULL
) RETURNS NUMERIC LANGUAGE sql SECURITY DEFINER SET search_path=public STABLE AS $$
  SELECT COALESCE(sum(jl.debit-jl.credit),0)
  FROM contacts c JOIN journal_lines jl ON jl.contact_id=c.id AND jl.company_id=c.company_id
  JOIN journal_entries je ON je.id=jl.journal_entry_id AND je.company_id=c.company_id AND je.status='posted'
  JOIN accounts a ON a.id=jl.account_id AND a.company_id=c.company_id
  WHERE c.id=p_contact_id AND c.company_id=p_company_id AND (p_as_of IS NULL OR je.date<=p_as_of)
    AND ((c.type='client' AND a.code IN('1130','2180'))
      OR (c.type='supplier' AND a.code='2110')
      OR (c.type='subcontractor' AND a.code IN('2110','2150'))
      OR (c.type='both' AND a.code IN('1130','2110','2180')));
$$;

CREATE OR REPLACE FUNCTION public.get_contact_balance_batch(p_company_id UUID,p_contact_ids UUID[])
RETURNS TABLE(contact_id UUID,balance NUMERIC)
LANGUAGE sql SECURITY DEFINER SET search_path=public STABLE AS $$
  SELECT c.id,COALESCE(sum(CASE WHEN a.id IS NOT NULL THEN jl.debit-jl.credit ELSE 0 END),0)
  FROM contacts c LEFT JOIN journal_lines jl ON jl.contact_id=c.id AND jl.company_id=c.company_id
  LEFT JOIN journal_entries je ON je.id=jl.journal_entry_id AND je.company_id=c.company_id AND je.status='posted'
  LEFT JOIN accounts a ON a.id=jl.account_id AND a.company_id=c.company_id AND je.id IS NOT NULL
    AND ((c.type='client' AND a.code IN('1130','2180'))
      OR (c.type='supplier' AND a.code='2110')
      OR (c.type='subcontractor' AND a.code IN('2110','2150'))
      OR (c.type='both' AND a.code IN('1130','2110','2180')))
  WHERE c.company_id=p_company_id AND c.id=ANY(COALESCE(p_contact_ids,'{}'::UUID[]))
  GROUP BY c.id;
$$;

CREATE OR REPLACE FUNCTION public.get_contact_balances(
  p_company_id UUID,p_type TEXT DEFAULT 'all',p_from DATE DEFAULT NULL,p_to DATE DEFAULT NULL
) RETURNS TABLE(contact_id UUID,name TEXT,contact_type TEXT,phone TEXT,tax_number TEXT,
  opening NUMERIC,period_debit NUMERIC,period_credit NUMERIC,closing NUMERIC)
LANGUAGE sql SECURITY DEFINER SET search_path=public STABLE AS $$
  SELECT c.id,c.name,c.type,c.phone,c.tax_number,
    COALESCE(sum(jl.debit-jl.credit) FILTER(WHERE p_from IS NOT NULL AND je.date<p_from AND a.id IS NOT NULL),0),
    COALESCE(sum(jl.debit) FILTER(WHERE (p_from IS NULL OR je.date>=p_from) AND (p_to IS NULL OR je.date<=p_to) AND a.id IS NOT NULL),0),
    COALESCE(sum(jl.credit) FILTER(WHERE (p_from IS NULL OR je.date>=p_from) AND (p_to IS NULL OR je.date<=p_to) AND a.id IS NOT NULL),0),
    COALESCE(sum(jl.debit-jl.credit) FILTER(WHERE (p_to IS NULL OR je.date<=p_to) AND a.id IS NOT NULL),0)
  FROM contacts c LEFT JOIN journal_lines jl ON jl.contact_id=c.id AND jl.company_id=p_company_id
  LEFT JOIN journal_entries je ON je.id=jl.journal_entry_id AND je.company_id=p_company_id AND je.status='posted'
  LEFT JOIN accounts a ON a.id=jl.account_id AND a.company_id=p_company_id AND je.id IS NOT NULL
    AND ((c.type='client' AND a.code IN('1130','2180')) OR (c.type='supplier' AND a.code='2110')
      OR (c.type='subcontractor' AND a.code IN('2110','2150')) OR (c.type='both' AND a.code IN('1130','2110','2180')))
  WHERE c.company_id=p_company_id AND (p_type='all' OR (p_type='client' AND c.type IN('client','both'))
    OR (p_type='supplier' AND c.type IN('supplier','subcontractor','both')))
  GROUP BY c.id,c.name,c.type,c.phone,c.tax_number
  HAVING COALESCE(sum(abs(jl.debit)+abs(jl.credit)) FILTER(WHERE (p_to IS NULL OR je.date<=p_to) AND a.id IS NOT NULL),0)>0
  ORDER BY c.name;
$$;

CREATE OR REPLACE FUNCTION public.get_contact_statement_summary(
  p_company_id UUID,p_contact_id UUID,p_from DATE DEFAULT NULL,p_to DATE DEFAULT NULL
) RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path=public STABLE AS $$
  WITH movements AS (
    SELECT je.date,jl.debit,jl.credit
    FROM contacts c JOIN journal_lines jl ON jl.contact_id=c.id AND jl.company_id=c.company_id
    JOIN journal_entries je ON je.id=jl.journal_entry_id AND je.company_id=c.company_id AND je.status='posted'
    JOIN accounts a ON a.id=jl.account_id AND a.company_id=c.company_id
    WHERE c.id=p_contact_id AND c.company_id=p_company_id AND (p_to IS NULL OR je.date<=p_to)
      AND ((c.type='client' AND a.code IN('1130','2180')) OR (c.type='supplier' AND a.code='2110')
        OR (c.type='subcontractor' AND a.code IN('2110','2150')) OR (c.type='both' AND a.code IN('1130','2110','2180')))
  ) SELECT jsonb_build_object(
    'opening_balance',COALESCE(sum(debit-credit) FILTER(WHERE p_from IS NOT NULL AND date<p_from),0),
    'period_debit',COALESCE(sum(debit) FILTER(WHERE p_from IS NULL OR date>=p_from),0),
    'period_credit',COALESCE(sum(credit) FILTER(WHERE p_from IS NULL OR date>=p_from),0),
    'closing_balance',COALESCE(sum(debit-credit),0),
    'total_count',count(*) FILTER(WHERE p_from IS NULL OR date>=p_from)
  ) FROM movements;
$$;

CREATE OR REPLACE FUNCTION public.get_contact_statement_lines(
  p_company_id UUID,p_contact_id UUID,p_from DATE DEFAULT NULL,p_to DATE DEFAULT NULL,
  p_limit INTEGER DEFAULT 100,p_offset INTEGER DEFAULT 0
) RETURNS TABLE(line_id UUID,entry_id UUID,entry_number INTEGER,entry_date DATE,entry_type TEXT,
  reference_type TEXT,reference_id UUID,description TEXT,debit NUMERIC,credit NUMERIC,created_by UUID,created_by_name TEXT,
  running_balance NUMERIC)
LANGUAGE sql SECURITY DEFINER SET search_path=public STABLE AS $$
  SELECT jl.id,je.id,je.number,je.date,je.type,je.reference_type,je.reference_id,
    COALESCE(jl.description,je.description,''),jl.debit,jl.credit,je.created_by,u.name,
    CASE WHEN p_from IS NULL THEN 0 ELSE get_contact_balance(p_company_id,p_contact_id,p_from-1) END
      +sum(jl.debit-jl.credit) OVER(ORDER BY je.date,je.number,jl.id)
  FROM contacts c JOIN journal_lines jl ON jl.contact_id=c.id AND jl.company_id=c.company_id
  JOIN journal_entries je ON je.id=jl.journal_entry_id AND je.company_id=c.company_id AND je.status='posted'
  JOIN accounts a ON a.id=jl.account_id AND a.company_id=c.company_id
  LEFT JOIN users u ON u.id=je.created_by AND u.company_id=c.company_id
  WHERE c.id=p_contact_id AND c.company_id=p_company_id
    AND (p_from IS NULL OR je.date>=p_from) AND (p_to IS NULL OR je.date<=p_to)
    AND ((c.type='client' AND a.code IN('1130','2180')) OR (c.type='supplier' AND a.code='2110')
      OR (c.type='subcontractor' AND a.code IN('2110','2150')) OR (c.type='both' AND a.code IN('1130','2110','2180')))
  ORDER BY je.date,je.number,jl.id LIMIT LEAST(GREATEST(p_limit,1),500) OFFSET GREATEST(p_offset,0);
$$;

CREATE OR REPLACE FUNCTION public.get_customer_advances(
  p_company_id UUID,p_contact_id UUID DEFAULT NULL,p_as_of DATE DEFAULT NULL
) RETURNS TABLE(contact_id UUID,contact_name TEXT,balance NUMERIC)
LANGUAGE sql SECURITY DEFINER SET search_path=public STABLE AS $$
  SELECT c.id,c.name,COALESCE(sum(jl.credit-jl.debit),0)
  FROM contacts c JOIN journal_lines jl ON jl.contact_id=c.id AND jl.company_id=c.company_id
  JOIN journal_entries je ON je.id=jl.journal_entry_id AND je.company_id=c.company_id AND je.status='posted'
  JOIN accounts a ON a.id=jl.account_id AND a.company_id=c.company_id AND a.code='2180'
  WHERE c.company_id=p_company_id AND (p_contact_id IS NULL OR c.id=p_contact_id)
    AND (p_as_of IS NULL OR je.date<=p_as_of)
  GROUP BY c.id,c.name HAVING COALESCE(sum(jl.credit-jl.debit),0)>0.01 ORDER BY c.name;
$$;

-- Historical aging only recognizes posted/approved allocations as of the cutoff.
CREATE OR REPLACE FUNCTION public.get_aging_by_contact(p_company_id UUID,p_type TEXT,p_as_of DATE)
RETURNS TABLE(contact_id UUID,contact_name TEXT,open_amount NUMERIC,unapplied NUMERIC,
  bucket_0_30 NUMERIC,bucket_31_60 NUMERIC,bucket_61_90 NUMERIC,bucket_90_plus NUMERIC,
  max_days_overdue INTEGER,last_invoice_date DATE)
LANGUAGE sql SECURITY DEFINER SET search_path=public STABLE AS $$
  WITH posted_receipts AS (
    SELECT vr.* FROM voucher_receipts vr
    JOIN journal_entries je ON je.id=vr.journal_entry_id AND je.company_id=p_company_id
      AND je.status='posted' AND je.created_at::DATE<=p_as_of
    LEFT JOIN journal_entries rev ON rev.id=je.reversed_by AND rev.company_id=p_company_id
    WHERE vr.company_id=p_company_id AND vr.date<=p_as_of
      AND (rev.id IS NULL OR rev.created_at::DATE>p_as_of)
  ), receipt_paid AS (
    SELECT rii.invoice_id,sum(rii.amount) paid FROM receipt_invoice_items rii
    JOIN posted_receipts vr ON vr.id=rii.voucher_receipt_id
    WHERE rii.company_id=p_company_id GROUP BY rii.invoice_id
  ), gateway_paid AS (
    SELECT pr.invoice_id,sum(GREATEST(jl.credit-jl.debit,0)) paid
    FROM payment_records pr JOIN journal_entries je ON je.reference_type='payment' AND je.reference_id=pr.id
      AND je.company_id=p_company_id AND je.date<=p_as_of AND je.status='posted' AND je.created_at::DATE<=p_as_of
    LEFT JOIN journal_entries rev ON rev.id=je.reversed_by AND rev.company_id=p_company_id
    JOIN journal_lines jl ON jl.journal_entry_id=je.id AND jl.company_id=p_company_id
    JOIN accounts a ON a.id=jl.account_id AND a.company_id=p_company_id AND a.code='1130'
    WHERE pr.company_id=p_company_id AND (rev.id IS NULL OR rev.created_at::DATE>p_as_of) GROUP BY pr.invoice_id
  ), invoice_credits AS (
    SELECT cn.invoice_id,sum(cn.total) credited FROM credit_notes cn
    JOIN journal_entries je ON je.id=cn.journal_entry_id AND je.company_id=p_company_id AND je.status='posted' AND je.created_at::DATE<=p_as_of
    LEFT JOIN journal_entries rev ON rev.id=je.reversed_by AND rev.company_id=p_company_id
    WHERE cn.company_id=p_company_id AND cn.date<=p_as_of AND cn.invoice_id IS NOT NULL
      AND (rev.id IS NULL OR rev.created_at::DATE>p_as_of) GROUP BY cn.invoice_id
  ), ar_invoice AS (
    SELECT i.contact_id,i.date,GREATEST(0,p_as_of-COALESCE(i.due_date,i.date)) days,
      GREATEST(i.total-COALESCE(rp.paid,0)-COALESCE(gp.paid,0)-COALESCE(ic.credited,0),0) remaining
    FROM invoices i
    JOIN journal_entries ije ON ije.id=i.journal_entry_id AND ije.company_id=p_company_id
      AND ije.status='posted' AND ije.date<=p_as_of AND ije.created_at::DATE<=p_as_of
    LEFT JOIN journal_entries irev ON irev.id=ije.reversed_by AND irev.company_id=p_company_id
    LEFT JOIN receipt_paid rp ON rp.invoice_id=i.id LEFT JOIN gateway_paid gp ON gp.invoice_id=i.id
    LEFT JOIN invoice_credits ic ON ic.invoice_id=i.id
    WHERE i.company_id=p_company_id AND i.date<=p_as_of
      AND (irev.id IS NULL OR irev.created_at::DATE>p_as_of)
  ), receipt_allocated AS (
    SELECT rii.voucher_receipt_id,sum(rii.amount) allocated FROM receipt_invoice_items rii
    JOIN posted_receipts vr ON vr.id=rii.voucher_receipt_id
    WHERE rii.company_id=p_company_id GROUP BY rii.voucher_receipt_id
  ), unapplied_receipts AS (
    SELECT vr.contact_id,sum(GREATEST(vr.amount-COALESCE(ra.allocated,0),0)) amount
    FROM posted_receipts vr LEFT JOIN receipt_allocated ra ON ra.voucher_receipt_id=vr.id
    WHERE vr.receipt_type='client' AND vr.contact_id IS NOT NULL GROUP BY vr.contact_id
  ), gateway_advances AS (
    SELECT jl.contact_id,sum(jl.credit-jl.debit) amount FROM journal_lines jl
    JOIN journal_entries je ON je.id=jl.journal_entry_id AND je.company_id=p_company_id AND je.status='posted' AND je.date<=p_as_of
    JOIN accounts a ON a.id=jl.account_id AND a.company_id=p_company_id AND a.code='2180'
    WHERE jl.company_id=p_company_id AND jl.contact_id IS NOT NULL GROUP BY jl.contact_id
  ), ar AS (
    SELECT c.id,c.name,COALESCE(sum(ai.remaining),0),GREATEST(COALESCE(ur.amount,0)+COALESCE(ga.amount,0),0),
      COALESCE(sum(ai.remaining) FILTER(WHERE ai.days<=30),0),COALESCE(sum(ai.remaining) FILTER(WHERE ai.days BETWEEN 31 AND 60),0),
      COALESCE(sum(ai.remaining) FILTER(WHERE ai.days BETWEEN 61 AND 90),0),COALESCE(sum(ai.remaining) FILTER(WHERE ai.days>90),0),
      COALESCE(max(ai.days),0)::INTEGER,max(ai.date)
    FROM contacts c LEFT JOIN ar_invoice ai ON ai.contact_id=c.id AND ai.remaining>0
    LEFT JOIN unapplied_receipts ur ON ur.contact_id=c.id LEFT JOIN gateway_advances ga ON ga.contact_id=c.id
    WHERE c.company_id=p_company_id AND c.type IN('client','both')
    GROUP BY c.id,c.name,ur.amount,ga.amount
    HAVING COALESCE(sum(ai.remaining),0)<>0 OR COALESCE(ur.amount,0)+COALESCE(ga.amount,0)<>0
  ), posted_disbursements AS (
    SELECT vd.* FROM voucher_disbursements vd
    JOIN journal_entries je ON je.id=vd.journal_entry_id AND je.company_id=p_company_id
      AND je.status='posted' AND je.created_at::DATE<=p_as_of
    LEFT JOIN journal_entries rev ON rev.id=je.reversed_by AND rev.company_id=p_company_id
    WHERE vd.company_id=p_company_id AND vd.date<=p_as_of
      AND (rev.id IS NULL OR rev.created_at::DATE>p_as_of)
  ), disbursement_paid AS (
    SELECT dii.purchase_invoice_id,sum(dii.amount) paid FROM disbursement_invoice_items dii
    JOIN posted_disbursements vd ON vd.id=dii.voucher_disbursement_id
    WHERE dii.company_id=p_company_id GROUP BY dii.purchase_invoice_id
  ), ap_invoice AS (
    SELECT i.supplier_id contact_id,i.date,GREATEST(0,p_as_of-COALESCE(i.due_date,i.date)) days,
      GREATEST(i.total-COALESCE(dp.paid,0),0) remaining
    FROM purchase_invoices i
    JOIN journal_entries ije ON ije.id=i.journal_entry_id AND ije.company_id=p_company_id
      AND ije.status='posted' AND ije.date<=p_as_of AND ije.created_at::DATE<=p_as_of
    LEFT JOIN journal_entries irev ON irev.id=ije.reversed_by AND irev.company_id=p_company_id
    LEFT JOIN disbursement_paid dp ON dp.purchase_invoice_id=i.id
    WHERE i.company_id=p_company_id AND i.date<=p_as_of
      AND (irev.id IS NULL OR irev.created_at::DATE>p_as_of)
  ), ap AS (
    SELECT c.id,c.name,COALESCE(sum(ai.remaining),0),0::NUMERIC,
      COALESCE(sum(ai.remaining) FILTER(WHERE ai.days<=30),0),COALESCE(sum(ai.remaining) FILTER(WHERE ai.days BETWEEN 31 AND 60),0),
      COALESCE(sum(ai.remaining) FILTER(WHERE ai.days BETWEEN 61 AND 90),0),COALESCE(sum(ai.remaining) FILTER(WHERE ai.days>90),0),
      COALESCE(max(ai.days),0)::INTEGER,max(ai.date)
    FROM contacts c JOIN ap_invoice ai ON ai.contact_id=c.id AND ai.remaining>0
    WHERE c.company_id=p_company_id AND c.type IN('supplier','subcontractor','both') GROUP BY c.id,c.name
  ) SELECT * FROM ar WHERE p_type='ar' UNION ALL SELECT * FROM ap WHERE p_type='ap';
$$;

CREATE OR REPLACE FUNCTION public.get_receivable_aging(p_company_id UUID,p_as_of DATE)
RETURNS TABLE(bucket TEXT,invoice_count BIGINT,amount NUMERIC)
LANGUAGE sql SECURITY DEFINER SET search_path=public STABLE AS $$
  WITH posted_receipts AS (
    SELECT vr.id FROM voucher_receipts vr JOIN journal_entries je ON je.id=vr.journal_entry_id
      AND je.company_id=p_company_id AND je.status='posted' AND je.created_at::DATE<=p_as_of
    LEFT JOIN journal_entries rev ON rev.id=je.reversed_by AND rev.company_id=p_company_id
    WHERE vr.company_id=p_company_id AND vr.date<=p_as_of AND (rev.id IS NULL OR rev.created_at::DATE>p_as_of)
  ), receipt_paid AS (
    SELECT rii.invoice_id,sum(rii.amount) paid FROM receipt_invoice_items rii
    JOIN posted_receipts vr ON vr.id=rii.voucher_receipt_id WHERE rii.company_id=p_company_id GROUP BY rii.invoice_id
  ), gateway_paid AS (
    SELECT pr.invoice_id,sum(GREATEST(jl.credit-jl.debit,0)) paid FROM payment_records pr
    JOIN journal_entries je ON je.reference_type='payment' AND je.reference_id=pr.id
      AND je.company_id=p_company_id AND je.date<=p_as_of AND je.status='posted' AND je.created_at::DATE<=p_as_of
    LEFT JOIN journal_entries rev ON rev.id=je.reversed_by AND rev.company_id=p_company_id
    JOIN journal_lines jl ON jl.journal_entry_id=je.id AND jl.company_id=p_company_id
    JOIN accounts a ON a.id=jl.account_id AND a.company_id=p_company_id AND a.code='1130'
    WHERE pr.company_id=p_company_id AND (rev.id IS NULL OR rev.created_at::DATE>p_as_of) GROUP BY pr.invoice_id
  ), credits AS (
    SELECT cn.invoice_id,sum(cn.total) amount FROM credit_notes cn
    JOIN journal_entries je ON je.id=cn.journal_entry_id AND je.company_id=p_company_id AND je.status='posted' AND je.created_at::DATE<=p_as_of
    LEFT JOIN journal_entries rev ON rev.id=je.reversed_by AND rev.company_id=p_company_id
    WHERE cn.company_id=p_company_id AND cn.invoice_id IS NOT NULL AND cn.date<=p_as_of
      AND (rev.id IS NULL OR rev.created_at::DATE>p_as_of) GROUP BY cn.invoice_id
  ), open_invoices AS (
    SELECT i.id,GREATEST(0,p_as_of-COALESCE(i.due_date,i.date)) days,
      GREATEST(i.total-COALESCE(rp.paid,0)-COALESCE(gp.paid,0)-COALESCE(c.amount,0),0) remaining
    FROM invoices i
    JOIN journal_entries ije ON ije.id=i.journal_entry_id AND ije.company_id=p_company_id
      AND ije.status='posted' AND ije.date<=p_as_of AND ije.created_at::DATE<=p_as_of
    LEFT JOIN journal_entries irev ON irev.id=ije.reversed_by AND irev.company_id=p_company_id
    LEFT JOIN receipt_paid rp ON rp.invoice_id=i.id
    LEFT JOIN gateway_paid gp ON gp.invoice_id=i.id LEFT JOIN credits c ON c.invoice_id=i.id
    WHERE i.company_id=p_company_id AND i.date<=p_as_of
      AND (irev.id IS NULL OR irev.created_at::DATE>p_as_of)
  ), ranges(bucket,min_days,max_days,ordering) AS (VALUES
    ('حالي (0-30 يوم)',0,30,1),('31-60 يوم',31,60,2),('61-90 يوم',61,90,3),('+90 يوم',91,1000000,4)
  ) SELECT r.bucket,count(i.id),COALESCE(sum(i.remaining),0)
  FROM ranges r LEFT JOIN open_invoices i ON i.days BETWEEN r.min_days AND r.max_days AND i.remaining>0
  GROUP BY r.bucket,r.ordering ORDER BY r.ordering;
$$;

CREATE OR REPLACE FUNCTION public.get_invoice_kpis(p_company_id UUID)
RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path=public STABLE AS $$
  WITH aging AS (
    SELECT * FROM get_aging_by_contact(p_company_id,'ar',CURRENT_DATE)
  ), payment_speed AS (
    SELECT COALESCE(avg(GREATEST(0,EXTRACT(EPOCH FROM (paid_at-date::TIMESTAMP))/86400))
      FILTER(WHERE status='paid' AND paid_at IS NOT NULL),0) days
    FROM invoices WHERE company_id=p_company_id
  ) SELECT jsonb_build_object(
    'outstanding',COALESCE((SELECT sum(GREATEST(open_amount-unapplied,0)) FROM aging),0),
    'avgPaymentDays',(SELECT days FROM payment_speed)
  );
$$;

CREATE OR REPLACE FUNCTION public.guard_contact_tenant_links()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    RAISE EXCEPTION 'Contact tenant cannot be changed';
  END IF;
  IF NEW.account_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM accounts WHERE id=NEW.account_id AND company_id=NEW.company_id)
  THEN RAISE EXCEPTION 'cross-tenant contact account'; END IF;
  IF NEW.created_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.created_by AND company_id=NEW.company_id)
  THEN RAISE EXCEPTION 'cross-tenant contact creator'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_contact_tenant_links ON contacts;
CREATE TRIGGER trg_guard_contact_tenant_links BEFORE INSERT OR UPDATE ON contacts
FOR EACH ROW EXECUTE FUNCTION guard_contact_tenant_links();

REVOKE ALL ON FUNCTION public.validate_contact_payload(JSONB,BOOLEAN) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.enforce_contact_plan_limit(UUID,TEXT,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.create_contact_atomic(UUID,UUID,JSONB,NUMERIC,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.update_contact_atomic(UUID,UUID,JSONB,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.deactivate_contact_atomic(UUID,UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.update_subcontractor_atomic(UUID,UUID,JSONB,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.deactivate_subcontractor_atomic(UUID,UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_contact_balance(UUID,UUID,DATE) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_contact_balance_batch(UUID,UUID[]) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_contact_balances(UUID,TEXT,DATE,DATE) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_contact_statement_summary(UUID,UUID,DATE,DATE) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_contact_statement_lines(UUID,UUID,DATE,DATE,INTEGER,INTEGER) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_customer_advances(UUID,UUID,DATE) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_aging_by_contact(UUID,TEXT,DATE) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_receivable_aging(UUID,DATE) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_invoice_kpis(UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guard_contact_tenant_links() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_contact_atomic(UUID,UUID,JSONB,NUMERIC,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_contact_atomic(UUID,UUID,JSONB,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.deactivate_contact_atomic(UUID,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_subcontractor_atomic(UUID,UUID,JSONB,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.deactivate_subcontractor_atomic(UUID,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_contact_balance(UUID,UUID,DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_contact_balance_batch(UUID,UUID[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_contact_balances(UUID,TEXT,DATE,DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_contact_statement_summary(UUID,UUID,DATE,DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_contact_statement_lines(UUID,UUID,DATE,DATE,INTEGER,INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_customer_advances(UUID,UUID,DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_aging_by_contact(UUID,TEXT,DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_receivable_aging(UUID,DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_invoice_kpis(UUID) TO service_role;

COMMIT;
