-- ============================================================
-- 052 - Atomic plan administration and customer communications
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_manage_subscription_plan(
  p_admin_id UUID,
  p_action TEXT,
  p_plan_id UUID DEFAULT NULL,
  p_payload JSONB DEFAULT '{}'::JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_plan subscription_plans%ROWTYPE; v_code TEXT; v_name TEXT;
BEGIN
  PERFORM assert_active_admin(p_admin_id);
  IF p_action NOT IN ('create','update') OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
    RAISE EXCEPTION 'invalid plan action';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_payload) field
    WHERE field NOT IN (
      'code','name','description','description_ar','currency','price_monthly','price_yearly',
      'yearly_discount_percent','trial_days','max_users','max_clients','max_suppliers',
      'max_employees','max_projects','max_invoices_per_month','max_quotations_per_month',
      'max_storage_mb','features','features_modules','is_active','sort_order'
    )
  ) THEN RAISE EXCEPTION 'unexpected plan field'; END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_each(p_payload) field
    WHERE field.key IN ('code','name','description','description_ar','currency')
      AND jsonb_typeof(field.value)<>'string'
  ) THEN RAISE EXCEPTION 'invalid plan text field'; END IF;
  IF p_payload ? 'price_monthly' AND (
    jsonb_typeof(p_payload->'price_monthly')<>'number'
    OR (p_payload->>'price_monthly')::NUMERIC<0
    OR (p_payload->>'price_monthly')::NUMERIC>1000000000
    OR mod((p_payload->>'price_monthly')::NUMERIC*100,1)<>0
  ) THEN RAISE EXCEPTION 'invalid monthly price'; END IF;
  IF p_payload ? 'price_yearly' AND jsonb_typeof(p_payload->'price_yearly') NOT IN ('number','null')
  THEN RAISE EXCEPTION 'invalid yearly price'; END IF;
  IF p_payload ? 'price_yearly' AND jsonb_typeof(p_payload->'price_yearly')='number' AND (
    (p_payload->>'price_yearly')::NUMERIC<0 OR (p_payload->>'price_yearly')::NUMERIC>1000000000
    OR mod((p_payload->>'price_yearly')::NUMERIC*100,1)<>0
  ) THEN RAISE EXCEPTION 'invalid yearly price'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_each(p_payload) field
    WHERE field.key IN (
      'yearly_discount_percent','trial_days','max_users','max_clients','max_suppliers',
      'max_employees','max_projects','max_invoices_per_month','max_quotations_per_month',
      'max_storage_mb','sort_order'
    ) AND CASE
      WHEN jsonb_typeof(field.value)='null' THEN field.key IN (
        'yearly_discount_percent','trial_days','max_users','max_storage_mb','sort_order'
      )
      WHEN jsonb_typeof(field.value)<>'number' THEN TRUE
      WHEN field.value#>>'{}' !~ '^[0-9]+$' THEN TRUE
      ELSE (field.value#>>'{}')::NUMERIC>1000000000
    END
  ) THEN RAISE EXCEPTION 'invalid plan integer limit'; END IF;

  v_code:=p_payload->>'code'; v_name:=trim(COALESCE(p_payload->>'name',''));
  IF (p_action='create' OR p_payload ? 'code') AND COALESCE(v_code,'') !~ '^[a-z0-9][a-z0-9_-]{1,31}$' THEN RAISE EXCEPTION 'invalid plan code'; END IF;
  IF (p_action='create' OR p_payload ? 'name') AND length(v_name) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'invalid plan name'; END IF;
  IF p_payload ? 'currency' AND COALESCE(p_payload->>'currency','') !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'invalid plan currency'; END IF;
  IF length(COALESCE(p_payload->>'description',''))>500 OR length(COALESCE(p_payload->>'description_ar',''))>500 THEN RAISE EXCEPTION 'plan description too long'; END IF;
  IF p_payload ? 'yearly_discount_percent' AND ((p_payload->>'yearly_discount_percent')::INT NOT BETWEEN 0 AND 100) THEN RAISE EXCEPTION 'invalid yearly discount'; END IF;
  IF p_payload ? 'trial_days' AND ((p_payload->>'trial_days')::INT NOT BETWEEN 0 AND 3650) THEN RAISE EXCEPTION 'invalid trial days'; END IF;
  IF p_payload ? 'max_users' AND ((p_payload->>'max_users')::INT < 1) THEN RAISE EXCEPTION 'invalid user limit'; END IF;
  IF p_payload ? 'sort_order' AND ((p_payload->>'sort_order')::INT NOT BETWEEN 0 AND 10000) THEN RAISE EXCEPTION 'invalid plan order'; END IF;
  IF p_payload ? 'features_modules' AND (
    jsonb_typeof(p_payload->'features_modules')<>'object' OR EXISTS(
      SELECT 1 FROM jsonb_each(p_payload->'features_modules') feature
      WHERE jsonb_typeof(feature.value)<>'boolean' OR feature.key NOT IN (
        'dashboard','accounts','journal','invoices','quotations','clients','contacts',
        'reports_basic','reports_advanced','reports_consolidated','settings','subscription',
        'messages','inventory','purchases','purchase_invoices','purchase_orders','cost_centers',
        'banks','cash','custody','warehouses','branches','employees','payroll','projects',
        'budgets','tax_reports','fixed_assets','pos','workflows','approvals','crm','contracts',
        'tenders','boq','progress_billing','subcontractors','backup','telegram_integration'
      )
    )
  ) THEN RAISE EXCEPTION 'invalid plan modules'; END IF;
  IF p_payload ? 'features' AND (
    jsonb_typeof(p_payload->'features')<>'array'
    OR jsonb_array_length(p_payload->'features')>46
    OR EXISTS(
      SELECT 1 FROM jsonb_array_elements(p_payload->'features') feature
      WHERE jsonb_typeof(feature)<>'string' OR feature#>>'{}' NOT IN (
        'dashboard','accounts','journal','invoices','quotations','clients','contacts',
        'reports_basic','reports_advanced','reports_consolidated','settings','subscription',
        'messages','inventory','purchases','purchase_invoices','purchase_orders','cost_centers',
        'banks','cash','custody','warehouses','branches','employees','payroll','projects',
        'budgets','tax_reports','fixed_assets','pos','workflows','approvals','crm','contracts',
        'tenders','boq','progress_billing','subcontractors','backup','telegram_integration'
      )
    )
  ) THEN RAISE EXCEPTION 'invalid plan features'; END IF;
  IF p_payload ? 'is_active' AND jsonb_typeof(p_payload->'is_active')<>'boolean' THEN RAISE EXCEPTION 'invalid plan status'; END IF;

  IF p_action='create' THEN
    INSERT INTO subscription_plans(
      code,name,description,description_ar,currency,price_monthly,price_yearly,
      yearly_discount_percent,trial_days,max_users,max_clients,max_suppliers,max_employees,
      max_projects,max_invoices_per_month,max_quotations_per_month,max_storage_mb,
      features,features_modules,is_active,sort_order
    ) VALUES(
      v_code,v_name,COALESCE(p_payload->>'description',''),COALESCE(p_payload->>'description_ar',''),
      COALESCE(p_payload->>'currency','USD'),COALESCE((p_payload->>'price_monthly')::NUMERIC,0),
      CASE WHEN jsonb_typeof(p_payload->'price_yearly')='number' THEN (p_payload->>'price_yearly')::NUMERIC ELSE NULL END,
      COALESCE((p_payload->>'yearly_discount_percent')::INT,20),COALESCE((p_payload->>'trial_days')::INT,7),
      COALESCE((p_payload->>'max_users')::INT,1),
      CASE WHEN jsonb_typeof(p_payload->'max_clients')='number' THEN (p_payload->>'max_clients')::INT ELSE NULL END,
      CASE WHEN jsonb_typeof(p_payload->'max_suppliers')='number' THEN (p_payload->>'max_suppliers')::INT ELSE NULL END,
      CASE WHEN jsonb_typeof(p_payload->'max_employees')='number' THEN (p_payload->>'max_employees')::INT ELSE NULL END,
      CASE WHEN jsonb_typeof(p_payload->'max_projects')='number' THEN (p_payload->>'max_projects')::INT ELSE NULL END,
      CASE WHEN jsonb_typeof(p_payload->'max_invoices_per_month')='number' THEN (p_payload->>'max_invoices_per_month')::INT ELSE NULL END,
      CASE WHEN jsonb_typeof(p_payload->'max_quotations_per_month')='number' THEN (p_payload->>'max_quotations_per_month')::INT ELSE NULL END,
      COALESCE((p_payload->>'max_storage_mb')::INT,0),COALESCE(p_payload->'features','[]'::JSONB),
      COALESCE(p_payload->'features_modules','{}'::JSONB),COALESCE((p_payload->>'is_active')::BOOLEAN,TRUE),
      COALESCE((p_payload->>'sort_order')::INT,0)
    ) RETURNING * INTO v_plan;
  ELSE
    IF p_plan_id IS NULL THEN RAISE EXCEPTION 'plan id required'; END IF;
    SELECT * INTO v_plan FROM subscription_plans WHERE id=p_plan_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('not_found',TRUE); END IF;
    IF p_payload ? 'code' AND v_code<>v_plan.code AND EXISTS(SELECT 1 FROM subscriptions WHERE plan_id=p_plan_id) THEN
      RAISE EXCEPTION 'cannot change code of a used plan';
    END IF;
    UPDATE subscription_plans SET
      code=CASE WHEN p_payload ? 'code' THEN v_code ELSE code END,
      name=CASE WHEN p_payload ? 'name' THEN v_name ELSE name END,
      description=CASE WHEN p_payload ? 'description' THEN p_payload->>'description' ELSE description END,
      description_ar=CASE WHEN p_payload ? 'description_ar' THEN p_payload->>'description_ar' ELSE description_ar END,
      currency=CASE WHEN p_payload ? 'currency' THEN p_payload->>'currency' ELSE currency END,
      price_monthly=CASE WHEN p_payload ? 'price_monthly' THEN (p_payload->>'price_monthly')::NUMERIC ELSE price_monthly END,
      price_yearly=CASE WHEN p_payload ? 'price_yearly' THEN CASE WHEN jsonb_typeof(p_payload->'price_yearly')='number' THEN (p_payload->>'price_yearly')::NUMERIC ELSE NULL END ELSE price_yearly END,
      yearly_discount_percent=CASE WHEN p_payload ? 'yearly_discount_percent' THEN (p_payload->>'yearly_discount_percent')::INT ELSE yearly_discount_percent END,
      trial_days=CASE WHEN p_payload ? 'trial_days' THEN (p_payload->>'trial_days')::INT ELSE trial_days END,
      max_users=CASE WHEN p_payload ? 'max_users' THEN (p_payload->>'max_users')::INT ELSE max_users END,
      max_clients=CASE WHEN p_payload ? 'max_clients' THEN CASE WHEN jsonb_typeof(p_payload->'max_clients')='number' THEN (p_payload->>'max_clients')::INT ELSE NULL END ELSE max_clients END,
      max_suppliers=CASE WHEN p_payload ? 'max_suppliers' THEN CASE WHEN jsonb_typeof(p_payload->'max_suppliers')='number' THEN (p_payload->>'max_suppliers')::INT ELSE NULL END ELSE max_suppliers END,
      max_employees=CASE WHEN p_payload ? 'max_employees' THEN CASE WHEN jsonb_typeof(p_payload->'max_employees')='number' THEN (p_payload->>'max_employees')::INT ELSE NULL END ELSE max_employees END,
      max_projects=CASE WHEN p_payload ? 'max_projects' THEN CASE WHEN jsonb_typeof(p_payload->'max_projects')='number' THEN (p_payload->>'max_projects')::INT ELSE NULL END ELSE max_projects END,
      max_invoices_per_month=CASE WHEN p_payload ? 'max_invoices_per_month' THEN CASE WHEN jsonb_typeof(p_payload->'max_invoices_per_month')='number' THEN (p_payload->>'max_invoices_per_month')::INT ELSE NULL END ELSE max_invoices_per_month END,
      max_quotations_per_month=CASE WHEN p_payload ? 'max_quotations_per_month' THEN CASE WHEN jsonb_typeof(p_payload->'max_quotations_per_month')='number' THEN (p_payload->>'max_quotations_per_month')::INT ELSE NULL END ELSE max_quotations_per_month END,
      max_storage_mb=CASE WHEN p_payload ? 'max_storage_mb' THEN (p_payload->>'max_storage_mb')::INT ELSE max_storage_mb END,
      features=CASE WHEN p_payload ? 'features' THEN p_payload->'features' ELSE features END,
      features_modules=CASE WHEN p_payload ? 'features_modules' THEN p_payload->'features_modules' ELSE features_modules END,
      is_active=CASE WHEN p_payload ? 'is_active' THEN (p_payload->>'is_active')::BOOLEAN ELSE is_active END,
      sort_order=CASE WHEN p_payload ? 'sort_order' THEN (p_payload->>'sort_order')::INT ELSE sort_order END,
      updated_at=now()
    WHERE id=p_plan_id RETURNING * INTO v_plan;
  END IF;
  INSERT INTO admin_audit_log(admin_id,action,details,target_type,target_id)
  VALUES(p_admin_id,p_action || '_subscription_plan',format('code=%s name=%s',v_plan.code,v_plan.name),'subscription_plan',v_plan.id::TEXT);
  RETURN to_jsonb(v_plan);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_company_profile(
  p_admin_id UUID,p_company_id UUID,p_patch JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_company companies%ROWTYPE;
BEGIN
  PERFORM assert_active_admin(p_admin_id);
  IF p_company_id IS NULL OR p_patch IS NULL OR jsonb_typeof(p_patch)<>'object'
    OR (SELECT count(*) FROM jsonb_object_keys(p_patch))=0
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_patch) f WHERE f NOT IN('name','commercial_registration','tax_number','phone','email','address','country','vat_rate'))
  THEN RAISE EXCEPTION 'invalid company patch'; END IF;
  IF EXISTS(
    SELECT 1 FROM jsonb_each(p_patch) field
    WHERE field.key IN('name','commercial_registration','tax_number','phone','email','address','country')
      AND jsonb_typeof(field.value)<>'string'
  ) THEN RAISE EXCEPTION 'invalid company text field'; END IF;
  IF p_patch ? 'name' AND length(trim(COALESCE(p_patch->>'name',''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid company name'; END IF;
  IF p_patch ? 'email' AND COALESCE(p_patch->>'email','')<>'' AND p_patch->>'email' !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'invalid company email'; END IF;
  IF p_patch ? 'vat_rate' AND (jsonb_typeof(p_patch->'vat_rate')<>'number' OR (p_patch->>'vat_rate')::NUMERIC NOT BETWEEN 0 AND 1) THEN RAISE EXCEPTION 'invalid vat rate'; END IF;
  IF length(COALESCE(p_patch->>'commercial_registration',''))>100 OR length(COALESCE(p_patch->>'tax_number',''))>100
    OR length(COALESCE(p_patch->>'phone',''))>50 OR length(COALESCE(p_patch->>'email',''))>254
    OR length(COALESCE(p_patch->>'address',''))>1000 OR length(COALESCE(p_patch->>'country',''))>100
  THEN RAISE EXCEPTION 'company field too long'; END IF;
  UPDATE companies SET
    name=CASE WHEN p_patch ? 'name' THEN trim(p_patch->>'name') ELSE name END,
    commercial_registration=CASE WHEN p_patch ? 'commercial_registration' THEN NULLIF(p_patch->>'commercial_registration','') ELSE commercial_registration END,
    tax_number=CASE WHEN p_patch ? 'tax_number' THEN NULLIF(p_patch->>'tax_number','') ELSE tax_number END,
    phone=CASE WHEN p_patch ? 'phone' THEN NULLIF(p_patch->>'phone','') ELSE phone END,
    email=CASE WHEN p_patch ? 'email' THEN NULLIF(lower(p_patch->>'email'),'') ELSE email END,
    address=CASE WHEN p_patch ? 'address' THEN NULLIF(p_patch->>'address','') ELSE address END,
    country=CASE WHEN p_patch ? 'country' THEN NULLIF(p_patch->>'country','') ELSE country END,
    vat_rate=CASE WHEN p_patch ? 'vat_rate' THEN (p_patch->>'vat_rate')::NUMERIC ELSE vat_rate END,
    updated_at=now()
  WHERE id=p_company_id RETURNING * INTO v_company;
  IF NOT FOUND THEN RETURN jsonb_build_object('not_found',TRUE); END IF;
  INSERT INTO admin_audit_log(admin_id,action,details,target_type,target_id)
  VALUES(p_admin_id,'edit_company','updated fields: '||array_to_string(ARRAY(SELECT jsonb_object_keys(p_patch)),','),'company',p_company_id::TEXT);
  RETURN jsonb_build_object('id',v_company.id,'name',v_company.name,'updated_at',v_company.updated_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_complaint(
  p_admin_id UUID,p_complaint_id UUID,p_status TEXT,p_reply TEXT,p_reply_set BOOLEAN
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_row complaints%ROWTYPE;
BEGIN
  PERFORM assert_active_admin(p_admin_id);
  IF p_complaint_id IS NULL OR p_reply_set IS NULL
    OR (p_status IS NOT NULL AND p_status NOT IN('pending','read','replied','closed'))
    OR length(COALESCE(p_reply,''))>5000 OR (p_status IS NULL AND NOT p_reply_set) THEN RAISE EXCEPTION 'invalid complaint update'; END IF;
  SELECT * INTO v_row FROM complaints WHERE id=p_complaint_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('not_found',TRUE); END IF;
  UPDATE complaints SET
    status=COALESCE(p_status,CASE WHEN p_reply_set THEN 'replied' ELSE status END),
    admin_reply=CASE WHEN p_reply_set THEN p_reply ELSE admin_reply END,
    replied_by=CASE WHEN p_reply_set THEN p_admin_id ELSE replied_by END,
    replied_at=CASE WHEN p_reply_set THEN now() ELSE replied_at END,
    updated_at=now()
  WHERE id=p_complaint_id RETURNING * INTO v_row;
  INSERT INTO admin_audit_log(admin_id,action,details,target_type,target_id)
  VALUES(p_admin_id,'update_complaint',format('company=%s status=%s',v_row.company_id,v_row.status),'complaint',v_row.id::TEXT);
  RETURN jsonb_build_object('id',v_row.id,'status',v_row.status);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_send_company_message(
  p_admin_id UUID,p_company_id UUID,p_subject TEXT,p_body TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id UUID;
BEGIN
  PERFORM assert_active_admin(p_admin_id);
  IF p_company_id IS NULL OR NOT EXISTS(SELECT 1 FROM companies WHERE id=p_company_id)
    OR length(trim(COALESCE(p_subject,''))) NOT BETWEEN 1 AND 200
    OR length(trim(COALESCE(p_body,''))) NOT BETWEEN 1 AND 5000 THEN RAISE EXCEPTION 'invalid company message'; END IF;
  INSERT INTO messages(company_id,admin_id,subject,body,direction)
  VALUES(p_company_id,p_admin_id,trim(p_subject),trim(p_body),'admin_to_company') RETURNING id INTO v_id;
  INSERT INTO admin_audit_log(admin_id,action,details,target_type,target_id)
  VALUES(p_admin_id,'send_company_message',left(trim(p_subject),200),'company',p_company_id::TEXT);
  RETURN jsonb_build_object('id',v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_support_ticket_atomic(
  p_company_id UUID,p_user_id UUID,p_subject TEXT,p_message TEXT,p_category TEXT,p_attachment_url TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_ticket support_tickets%ROWTYPE;
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM users u JOIN companies c ON c.id=u.company_id
    WHERE u.id=p_user_id AND u.company_id=p_company_id AND u.is_active=TRUE AND c.is_active=TRUE
  ) THEN RAISE EXCEPTION 'invalid tenant actor'; END IF;
  IF length(trim(COALESCE(p_subject,''))) NOT BETWEEN 3 AND 200
    OR length(trim(COALESCE(p_message,''))) NOT BETWEEN 10 AND 5000
    OR p_category IS NULL OR p_category NOT IN('billing','payment','technical','account','data_request','other')
    OR (p_attachment_url IS NOT NULL AND (
      length(p_attachment_url)>2048
      OR (p_attachment_url ~ '[[:cntrl:]]' OR strpos(p_attachment_url,chr(92))>0)
      OR p_attachment_url LIKE '%..%'
      OR NOT (p_attachment_url LIKE p_company_id::TEXT||'/%' OR p_attachment_url LIKE '%/'||p_company_id::TEXT||'/%')
    ))
  THEN RAISE EXCEPTION 'invalid support ticket'; END IF;
  INSERT INTO support_tickets(company_id,user_id,subject,message,category,attachment_url,status)
  VALUES(p_company_id,p_user_id,trim(p_subject),trim(p_message),p_category,p_attachment_url,'open')
  RETURNING * INTO v_ticket;
  INSERT INTO company_messages(company_id,user_id,subject,body,type,status)
  VALUES(p_company_id,p_user_id,format('[دعم/%s] %s',p_category,trim(p_subject)),trim(p_message),'support','open');
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'create','support_ticket',v_ticket.id::TEXT,
    jsonb_build_object('category',p_category,'has_attachment',p_attachment_url IS NOT NULL));
  RETURN jsonb_build_object('id',v_ticket.id,'subject',v_ticket.subject,'category',v_ticket.category,
    'status',v_ticket.status,'created_at',v_ticket.created_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_addon_request_atomic(
  p_company_id UUID,p_user_id UUID,p_addon_type TEXT,p_quantity INTEGER,p_duration_type TEXT,
  p_payment_method_code TEXT,p_payment_date DATE,p_payment_time TEXT,p_receipt_image_url TEXT,p_notes TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_unit NUMERIC(10,2); v_total NUMERIC(10,2); v_request addon_requests%ROWTYPE;
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM users u JOIN companies c ON c.id=u.company_id
    WHERE u.id=p_user_id AND u.company_id=p_company_id AND u.is_active=TRUE AND c.is_active=TRUE
  ) THEN RAISE EXCEPTION 'invalid tenant actor'; END IF;
  IF p_addon_type IS NULL OR p_addon_type NOT IN('extra_user','extra_branch','storage_gb')
    OR p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 100
    OR p_duration_type IS NULL OR p_duration_type NOT IN('monthly','yearly')
    OR p_payment_date IS NULL OR p_payment_date>CURRENT_DATE OR p_payment_date<CURRENT_DATE-3650
    OR (p_payment_time IS NOT NULL AND p_payment_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9])?$')
    OR length(COALESCE(p_notes,''))>2000
    OR p_receipt_image_url IS NULL OR length(p_receipt_image_url)>2048
    OR (p_receipt_image_url ~ '[[:cntrl:]]' OR strpos(p_receipt_image_url,chr(92))>0) OR p_receipt_image_url LIKE '%..%'
    OR NOT (p_receipt_image_url LIKE p_company_id::TEXT||'/%' OR p_receipt_image_url LIKE '%/'||p_company_id::TEXT||'/%')
    OR NOT EXISTS(SELECT 1 FROM payment_methods WHERE code=p_payment_method_code AND is_active=TRUE)
  THEN RAISE EXCEPTION 'invalid addon request'; END IF;
  v_unit:=CASE p_addon_type
    WHEN 'extra_user' THEN CASE WHEN p_duration_type='monthly' THEN 5 ELSE 48 END
    WHEN 'extra_branch' THEN CASE WHEN p_duration_type='monthly' THEN 10 ELSE 96 END
    WHEN 'storage_gb' THEN CASE WHEN p_duration_type='monthly' THEN 3 ELSE 30 END
  END;
  v_total:=v_unit*p_quantity;
  INSERT INTO addon_requests(company_id,user_id,addon_type,quantity,duration_type,unit_price_usd,
    total_amount_usd,payment_method_code,payment_amount,payment_date,payment_time,receipt_image_url,notes,status)
  VALUES(p_company_id,p_user_id,p_addon_type,p_quantity,p_duration_type,v_unit,v_total,
    p_payment_method_code,v_total,p_payment_date,p_payment_time,p_receipt_image_url,NULLIF(trim(p_notes),''),'pending')
  RETURNING * INTO v_request;
  INSERT INTO company_messages(company_id,user_id,subject,body,type,status)
  VALUES(p_company_id,p_user_id,format('طلب إضافة: %s ×%s',p_addon_type,p_quantity),
    format('النوع: %s، الكمية: %s، المدة: %s، المبلغ: $%s، طريقة الدفع: %s',
      p_addon_type,p_quantity,p_duration_type,v_total,p_payment_method_code),'addon_request','open');
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'create','addon_request',v_request.id::TEXT,
    jsonb_build_object('addon_type',p_addon_type,'quantity',p_quantity,'duration_type',p_duration_type,'amount',v_total));
  RETURN jsonb_build_object('id',v_request.id,'status',v_request.status,'total_amount_usd',v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_upgrade_request_atomic(
  p_company_id UUID,p_user_id UUID,p_requested_plan_id UUID,p_duration_type TEXT,
  p_payment_method_code TEXT,p_payment_amount NUMERIC,p_payment_date DATE,p_payment_time TEXT,
  p_receipt_image_url TEXT,p_notes TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_plan subscription_plans%ROWTYPE; v_current_plan UUID; v_expected NUMERIC(15,2); v_request upgrade_requests%ROWTYPE;
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM users u JOIN companies c ON c.id=u.company_id
    WHERE u.id=p_user_id AND u.company_id=p_company_id AND u.is_active=TRUE AND c.is_active=TRUE
  ) THEN RAISE EXCEPTION 'invalid tenant actor'; END IF;
  SELECT * INTO v_plan FROM subscription_plans WHERE id=p_requested_plan_id AND is_active=TRUE;
  v_expected:=CASE WHEN p_duration_type='monthly' THEN v_plan.price_monthly
    WHEN p_duration_type='yearly' THEN v_plan.price_yearly ELSE NULL END;
  IF v_plan.id IS NULL OR v_expected IS NULL OR v_expected<=0 OR p_payment_amount IS DISTINCT FROM v_expected
    OR p_payment_date IS NULL OR p_payment_date>CURRENT_DATE OR p_payment_date<CURRENT_DATE-3650
    OR (p_payment_time IS NOT NULL AND p_payment_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9])?$')
    OR length(COALESCE(p_notes,''))>2000
    OR p_receipt_image_url IS NULL OR length(p_receipt_image_url)>2048
    OR (p_receipt_image_url ~ '[[:cntrl:]]' OR strpos(p_receipt_image_url,chr(92))>0) OR p_receipt_image_url LIKE '%..%'
    OR NOT (p_receipt_image_url LIKE p_company_id::TEXT||'/%' OR p_receipt_image_url LIKE '%/'||p_company_id::TEXT||'/%')
    OR NOT EXISTS(SELECT 1 FROM payment_methods WHERE code=p_payment_method_code AND is_active=TRUE)
  THEN RAISE EXCEPTION 'invalid upgrade request'; END IF;
  SELECT plan_id INTO v_current_plan FROM subscriptions WHERE company_id=p_company_id
    ORDER BY created_at DESC LIMIT 1;
  INSERT INTO upgrade_requests(company_id,user_id,current_plan_id,requested_plan_id,duration_type,
    payment_method_code,payment_amount,payment_date,payment_time,receipt_image_url,notes,status)
  VALUES(p_company_id,p_user_id,v_current_plan,p_requested_plan_id,p_duration_type,p_payment_method_code,
    v_expected,p_payment_date,p_payment_time::TIME,p_receipt_image_url,NULLIF(trim(p_notes),''),'pending')
  RETURNING * INTO v_request;
  INSERT INTO company_messages(company_id,user_id,subject,body,type,status)
  VALUES(p_company_id,p_user_id,format('طلب ترقية إلى %s',v_plan.code),
    format('الباقة: %s، المدة: %s، المبلغ: %s %s، طريقة الدفع: %s',
      v_plan.code,p_duration_type,v_expected,v_plan.currency,p_payment_method_code),'upgrade','open');
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'create','upgrade_request',v_request.id::TEXT,
    jsonb_build_object('plan_id',p_requested_plan_id,'duration_type',p_duration_type,'amount',v_expected));
  RETURN jsonb_build_object('id',v_request.id,'status',v_request.status,'plan_code',v_plan.code,
    'payment_amount',v_expected,'created_at',v_request.created_at);
END;
$$;

-- Existing route-level notifications lacked user_id and used enum values that
-- older schemas rejected. Generate them inside the reviewed-request transaction.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname FROM pg_constraint c
    JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=ANY(c.conkey)
    WHERE n.nspname='public' AND t.relname='company_messages' AND c.contype='c' AND a.attname='type'
  LOOP EXECUTE 'ALTER TABLE company_messages DROP CONSTRAINT IF EXISTS '||quote_ident(r.conname); END LOOP;
END $$;
ALTER TABLE company_messages ADD CONSTRAINT company_messages_type_check
  CHECK(type IN('complaint','support','upgrade','payment','addon_request','addon_granted','addon_update','support_update'));

CREATE OR REPLACE FUNCTION public.notify_admin_request_decision()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_subject TEXT; v_body TEXT; v_type TEXT;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.status NOT IN('approved','rejected') OR NEW.user_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND company_id=NEW.company_id) THEN
    RAISE EXCEPTION 'request recipient tenant mismatch';
  END IF;
  IF TG_TABLE_NAME='addon_requests' THEN
    v_type:=CASE WHEN NEW.status='approved' THEN 'addon_granted' ELSE 'addon_update' END;
    v_subject:=CASE WHEN NEW.status='approved' THEN 'تمت الموافقة على طلب الإضافة' ELSE 'تم رفض طلب الإضافة' END;
    v_body:=CASE WHEN NEW.status='approved' THEN format('تم تفعيل الإضافة %s بكمية %s.',NEW.addon_type,NEW.quantity)
      ELSE 'تم رفض طلب الإضافة. راجع ملاحظات الإدارة أو تواصل مع الدعم.' END;
  ELSE
    v_type:='upgrade';
    v_subject:=CASE WHEN NEW.status='approved' THEN 'تمت الموافقة على طلب الترقية' ELSE 'تم رفض طلب الترقية' END;
    v_body:=CASE WHEN NEW.status='approved' THEN 'تم تفعيل الباقة المطلوبة بنجاح.'
      ELSE 'تم رفض طلب الترقية. راجع ملاحظات الإدارة أو تواصل مع الدعم.' END;
  END IF;
  INSERT INTO company_messages(company_id,user_id,subject,body,type,status)
  VALUES(NEW.company_id,NEW.user_id,v_subject,v_body,v_type,'open');
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_notify_addon_request_decision ON addon_requests;
CREATE TRIGGER trg_notify_addon_request_decision AFTER UPDATE OF status ON addon_requests
FOR EACH ROW EXECUTE FUNCTION notify_admin_request_decision();
DROP TRIGGER IF EXISTS trg_notify_upgrade_request_decision ON upgrade_requests;
CREATE TRIGGER trg_notify_upgrade_request_decision AFTER UPDATE OF status ON upgrade_requests
FOR EACH ROW EXECUTE FUNCTION notify_admin_request_decision();

CREATE OR REPLACE FUNCTION public.notify_subscription_cancellation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.status='cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    INSERT INTO notifications(company_id,type,title,message,is_read)
    VALUES(NEW.company_id,'warning','تم إلغاء اشتراكك','تم إلغاء اشتراكك. يرجى التواصل مع الدعم لإعادة التفعيل.',FALSE);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_notify_subscription_cancellation ON subscriptions;
CREATE TRIGGER trg_notify_subscription_cancellation AFTER UPDATE OF status ON subscriptions
FOR EACH ROW EXECUTE FUNCTION notify_subscription_cancellation();

REVOKE ALL ON FUNCTION public.notify_admin_request_decision() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.notify_subscription_cancellation() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_manage_subscription_plan(UUID,TEXT,UUID,JSONB) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_update_company_profile(UUID,UUID,JSONB) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_update_complaint(UUID,UUID,TEXT,TEXT,BOOLEAN) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_send_company_message(UUID,UUID,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.create_support_ticket_atomic(UUID,UUID,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.create_addon_request_atomic(UUID,UUID,TEXT,INTEGER,TEXT,TEXT,DATE,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.create_upgrade_request_atomic(UUID,UUID,UUID,TEXT,TEXT,NUMERIC,DATE,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_manage_subscription_plan(UUID,TEXT,UUID,JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_company_profile(UUID,UUID,JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_complaint(UUID,UUID,TEXT,TEXT,BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_send_company_message(UUID,UUID,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_support_ticket_atomic(UUID,UUID,TEXT,TEXT,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_addon_request_atomic(UUID,UUID,TEXT,INTEGER,TEXT,TEXT,DATE,TEXT,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_upgrade_request_atomic(UUID,UUID,UUID,TEXT,TEXT,NUMERIC,DATE,TEXT,TEXT,TEXT) TO service_role;

COMMIT;
