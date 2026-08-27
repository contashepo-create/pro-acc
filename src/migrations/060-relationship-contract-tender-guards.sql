-- Migration 060: atomic CRM, contracts, tenders, bonds, Gantt and reminder lifecycles
BEGIN;

CREATE OR REPLACE FUNCTION public.assert_relationship_actor(p_company_id UUID,p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF p_company_id IS NULL OR p_user_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE
  ) THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
END;
$$;
CREATE OR REPLACE FUNCTION public.assert_relationship_payload(p_payload JSONB,p_allowed TEXT[])
RETURNS VOID LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR EXISTS(
    SELECT 1 FROM jsonb_object_keys(p_payload) key WHERE NOT (key=ANY(p_allowed))
  ) THEN RAISE EXCEPTION 'بيانات العملية غير صالحة'; END IF;
END;
$$;

-- CRM -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_crm_contact_atomic(p_company_id UUID,p_payload JSONB,p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_row crm_contacts%ROWTYPE; v_assignee UUID; v_value NUMERIC; v_name TEXT; v_type TEXT; v_stage TEXT; v_source TEXT;
BEGIN
  PERFORM assert_relationship_actor(p_company_id,p_user_id);
  PERFORM assert_relationship_payload(p_payload,ARRAY['name','type','email','phone','company_name','source','pipeline_stage','estimated_value','description','assigned_to']);
  v_name:=BTRIM(COALESCE(p_payload->>'name','')); v_type:=COALESCE(p_payload->>'type','');
  v_stage:=COALESCE(p_payload->>'pipeline_stage','new'); v_source:=COALESCE(p_payload->>'source','other');
  BEGIN
    v_assignee:=COALESCE(NULLIF(p_payload->>'assigned_to','')::UUID,p_user_id);
    v_value:=NULLIF(p_payload->>'estimated_value','')::NUMERIC;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'بيانات العميل المحتمل غير صالحة'; END;
  IF v_name='' OR LENGTH(v_name)>200 OR v_type NOT IN('lead','opportunity','customer')
    OR v_stage NOT IN('new','contacted','qualified','proposal','negotiation','won','lost')
    OR v_source NOT IN('website','referral','cold_call','tender','social','other')
    OR (v_value IS NOT NULL AND (v_value<0 OR v_value<>ROUND(v_value,2)))
    OR LENGTH(COALESCE(p_payload->>'email',''))>254 OR LENGTH(COALESCE(p_payload->>'phone',''))>50
    OR LENGTH(COALESCE(p_payload->>'company_name',''))>200 OR LENGTH(COALESCE(p_payload->>'description',''))>4000
    OR NOT EXISTS(SELECT 1 FROM users WHERE id=v_assignee AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'بيانات العميل المحتمل غير صالحة'; END IF;
  IF v_stage='won' THEN v_type:='customer'; END IF;
  PERFORM set_config('app.relationship_write_company',p_company_id::TEXT,TRUE);
  INSERT INTO crm_contacts(company_id,name,type,email,phone,company_name,source,pipeline_stage,estimated_value,description,assigned_to,created_by)
  VALUES(p_company_id,v_name,v_type,NULLIF(BTRIM(p_payload->>'email'),''),NULLIF(BTRIM(p_payload->>'phone'),''),
    NULLIF(BTRIM(p_payload->>'company_name'),''),v_source,v_stage,v_value,NULLIF(BTRIM(p_payload->>'description'),''),v_assignee,p_user_id)
  RETURNING * INTO v_row;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'create','crm_contact',v_row.id,to_jsonb(v_row));
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_crm_contact_atomic(p_company_id UUID,p_contact_id UUID,p_patch JSONB,p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old crm_contacts%ROWTYPE; v_new crm_contacts%ROWTYPE; v_assignee UUID; v_value NUMERIC; v_stage TEXT; v_type TEXT; v_source TEXT;
BEGIN
  PERFORM assert_relationship_actor(p_company_id,p_user_id);
  PERFORM assert_relationship_payload(p_patch,ARRAY['name','type','email','phone','company_name','source','pipeline_stage','estimated_value','description','assigned_to']);
  IF p_patch='{}'::JSONB THEN RAISE EXCEPTION 'لا توجد بيانات للتحديث'; END IF;
  SELECT * INTO v_old FROM crm_contacts WHERE id=p_contact_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'العميل المحتمل غير موجود'; END IF;
  BEGIN
    v_assignee:=CASE WHEN p_patch?'assigned_to' THEN NULLIF(p_patch->>'assigned_to','')::UUID ELSE v_old.assigned_to END;
    v_value:=CASE WHEN p_patch?'estimated_value' THEN NULLIF(p_patch->>'estimated_value','')::NUMERIC ELSE v_old.estimated_value END;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'بيانات العميل المحتمل غير صالحة'; END;
  v_stage:=CASE WHEN p_patch?'pipeline_stage' THEN p_patch->>'pipeline_stage' ELSE v_old.pipeline_stage END;
  v_type:=CASE WHEN p_patch?'type' THEN p_patch->>'type' ELSE v_old.type END;
  v_source:=CASE WHEN p_patch?'source' THEN p_patch->>'source' ELSE v_old.source END;
  IF p_patch?'pipeline_stage' AND v_stage IS DISTINCT FROM v_old.pipeline_stage AND NOT (
    (v_old.pipeline_stage='new' AND v_stage IN('contacted','lost')) OR
    (v_old.pipeline_stage='contacted' AND v_stage IN('qualified','lost')) OR
    (v_old.pipeline_stage='qualified' AND v_stage IN('proposal','lost')) OR
    (v_old.pipeline_stage='proposal' AND v_stage IN('negotiation','won','lost')) OR
    (v_old.pipeline_stage='negotiation' AND v_stage IN('won','lost'))
  ) THEN RAISE EXCEPTION 'انتقال مرحلة العميل غير صالح'; END IF;
  IF (p_patch?'name' AND (NULLIF(BTRIM(p_patch->>'name'),'') IS NULL OR LENGTH(p_patch->>'name')>200))
    OR v_type NOT IN('lead','opportunity','customer') OR v_source NOT IN('website','referral','cold_call','tender','social','other')
    OR (v_value IS NOT NULL AND (v_value<0 OR v_value<>ROUND(v_value,2)))
    OR LENGTH(COALESCE(p_patch->>'email',''))>254 OR LENGTH(COALESCE(p_patch->>'phone',''))>50
    OR LENGTH(COALESCE(p_patch->>'company_name',''))>200 OR LENGTH(COALESCE(p_patch->>'description',''))>4000
    OR v_assignee IS NULL OR NOT EXISTS(SELECT 1 FROM users WHERE id=v_assignee AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'بيانات العميل المحتمل غير صالحة'; END IF;
  IF v_stage='won' THEN v_type:='customer'; END IF;
  PERFORM set_config('app.relationship_write_company',p_company_id::TEXT,TRUE);
  UPDATE crm_contacts SET
    name=CASE WHEN p_patch?'name' THEN BTRIM(p_patch->>'name') ELSE name END,
    type=v_type,email=CASE WHEN p_patch?'email' THEN NULLIF(BTRIM(p_patch->>'email'),'') ELSE email END,
    phone=CASE WHEN p_patch?'phone' THEN NULLIF(BTRIM(p_patch->>'phone'),'') ELSE phone END,
    company_name=CASE WHEN p_patch?'company_name' THEN NULLIF(BTRIM(p_patch->>'company_name'),'') ELSE company_name END,
    source=v_source,pipeline_stage=v_stage,estimated_value=v_value,
    description=CASE WHEN p_patch?'description' THEN NULLIF(BTRIM(p_patch->>'description'),'') ELSE description END,
    assigned_to=v_assignee,updated_at=NOW()
  WHERE id=p_contact_id RETURNING * INTO v_new;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'update','crm_contact',p_contact_id,to_jsonb(v_old),to_jsonb(v_new));
  RETURN to_jsonb(v_new);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_crm_contact_atomic(p_company_id UUID,p_contact_id UUID,p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old crm_contacts%ROWTYPE;
BEGIN
  PERFORM assert_relationship_actor(p_company_id,p_user_id);
  SELECT * INTO v_old FROM crm_contacts WHERE id=p_contact_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'العميل المحتمل غير موجود'; END IF;
  IF v_old.pipeline_stage='won' OR v_old.type='customer' THEN RAISE EXCEPTION 'لا يمكن حذف سجل علاقة ناجحة'; END IF;
  PERFORM set_config('app.relationship_write_company',p_company_id::TEXT,TRUE);
  DELETE FROM crm_contacts WHERE id=p_contact_id;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values)
  VALUES(p_company_id,p_user_id,'delete','crm_contact',p_contact_id,to_jsonb(v_old));
  RETURN jsonb_build_object('id',p_contact_id,'deleted',TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_crm_followup_atomic(p_company_id UUID,p_contact_id UUID,p_payload JSONB,p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_row crm_followups%ROWTYPE; v_type TEXT; v_when TIMESTAMPTZ;
BEGIN
  PERFORM assert_relationship_actor(p_company_id,p_user_id);
  PERFORM assert_relationship_payload(p_payload,ARRAY['type','scheduled_at','notes']);
  v_type:=COALESCE(p_payload->>'type','call');
  PERFORM 1 FROM crm_contacts WHERE id=p_contact_id AND company_id=p_company_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'العميل المحتمل غير موجود'; END IF;
  BEGIN v_when:=(p_payload->>'scheduled_at')::TIMESTAMPTZ;
  EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow THEN RAISE EXCEPTION 'تاريخ المتابعة غير صالح'; END;
  IF v_type NOT IN('call','meeting','email','visit') OR v_when IS NULL OR LENGTH(COALESCE(p_payload->>'notes',''))>2000
  THEN RAISE EXCEPTION 'بيانات المتابعة غير صالحة'; END IF;
  PERFORM set_config('app.relationship_write_company',p_company_id::TEXT,TRUE);
  INSERT INTO crm_followups(crm_contact_id,company_id,type,scheduled_at,notes,status,created_by)
  VALUES(p_contact_id,p_company_id,v_type,v_when,NULLIF(BTRIM(p_payload->>'notes'),''),'scheduled',p_user_id) RETURNING * INTO v_row;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'create','crm_followup',v_row.id,to_jsonb(v_row));
  RETURN to_jsonb(v_row);
END;
$$;

-- Contracts -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_contract_atomic(p_company_id UUID,p_payload JSONB,p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_row contracts%ROWTYPE; v_project UUID; v_contact UUID; v_start DATE; v_end DATE; v_value NUMERIC; v_type TEXT; v_status TEXT; v_title TEXT;
BEGIN
  PERFORM assert_relationship_actor(p_company_id,p_user_id);
  PERFORM assert_relationship_payload(p_payload,ARRAY['title','type','project_id','contact_id','start_date','end_date','value','description','status']);
  v_title:=BTRIM(COALESCE(p_payload->>'title','')); v_type:=COALESCE(p_payload->>'type','general'); v_status:=COALESCE(p_payload->>'status','active');
  BEGIN
    v_project:=NULLIF(p_payload->>'project_id','')::UUID; v_contact:=NULLIF(p_payload->>'contact_id','')::UUID;
    v_start:=(p_payload->>'start_date')::DATE; v_end:=(p_payload->>'end_date')::DATE; v_value:=COALESCE((p_payload->>'value')::NUMERIC,0);
  EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR numeric_value_out_of_range THEN RAISE EXCEPTION 'بيانات العقد غير صالحة'; END;
  IF v_title='' OR LENGTH(v_title)>200 OR v_type NOT IN('general','client','subcontractor','supplier','employee','lease','insurance','bond')
    OR v_status NOT IN('draft','active') OR v_start IS NULL OR v_end IS NULL OR v_end<v_start OR v_value<0 OR v_value<>ROUND(v_value,2)
    OR LENGTH(COALESCE(p_payload->>'description',''))>4000
    OR (v_project IS NOT NULL AND NOT EXISTS(SELECT 1 FROM projects WHERE id=v_project AND company_id=p_company_id))
    OR (v_contact IS NOT NULL AND NOT EXISTS(SELECT 1 FROM contacts WHERE id=v_contact AND company_id=p_company_id))
  THEN RAISE EXCEPTION 'بيانات العقد غير صالحة'; END IF;
  PERFORM set_config('app.relationship_write_company',p_company_id::TEXT,TRUE);
  INSERT INTO contracts(company_id,title,type,project_id,contact_id,start_date,end_date,value,description,status,created_by)
  VALUES(p_company_id,v_title,v_type,v_project,v_contact,v_start,v_end,v_value,NULLIF(BTRIM(p_payload->>'description'),''),v_status,p_user_id)
  RETURNING * INTO v_row;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'create','contract',v_row.id,to_jsonb(v_row));
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_contract_atomic(p_company_id UUID,p_contract_id UUID,p_patch JSONB,p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old contracts%ROWTYPE; v_new contracts%ROWTYPE; v_project UUID; v_contact UUID; v_start DATE; v_end DATE; v_value NUMERIC; v_type TEXT; v_status TEXT;
BEGIN
  PERFORM assert_relationship_actor(p_company_id,p_user_id);
  PERFORM assert_relationship_payload(p_patch,ARRAY['title','type','project_id','contact_id','start_date','end_date','value','description','status']);
  IF p_patch='{}'::JSONB THEN RAISE EXCEPTION 'لا توجد بيانات للتحديث'; END IF;
  SELECT * INTO v_old FROM contracts WHERE id=p_contract_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'العقد غير موجود'; END IF;
  IF v_old.status IN('completed','terminated') OR (v_old.status='expired' AND NOT (p_patch?'status' AND p_patch->>'status'='terminated'))
  THEN RAISE EXCEPTION 'لا يمكن تعديل عقد منتهي'; END IF;
  IF v_old.status<>'draft' AND EXISTS(SELECT 1 FROM jsonb_object_keys(p_patch) key WHERE key NOT IN('status','description','end_date'))
  THEN RAISE EXCEPTION 'لا يمكن تعديل شروط عقد بعد تفعيله'; END IF;
  BEGIN
    v_project:=CASE WHEN p_patch?'project_id' THEN NULLIF(p_patch->>'project_id','')::UUID ELSE v_old.project_id END;
    v_contact:=CASE WHEN p_patch?'contact_id' THEN NULLIF(p_patch->>'contact_id','')::UUID ELSE v_old.contact_id END;
    v_start:=CASE WHEN p_patch?'start_date' THEN (p_patch->>'start_date')::DATE ELSE v_old.start_date END;
    v_end:=CASE WHEN p_patch?'end_date' THEN (p_patch->>'end_date')::DATE ELSE v_old.end_date END;
    v_value:=CASE WHEN p_patch?'value' THEN (p_patch->>'value')::NUMERIC ELSE v_old.value END;
  EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR numeric_value_out_of_range THEN RAISE EXCEPTION 'بيانات العقد غير صالحة'; END;
  v_type:=CASE WHEN p_patch?'type' THEN p_patch->>'type' ELSE v_old.type END;
  v_status:=CASE WHEN p_patch?'status' THEN p_patch->>'status' ELSE v_old.status END;
  IF p_patch?'status' AND v_status IS DISTINCT FROM v_old.status AND NOT (
    (v_old.status='draft' AND v_status IN('active','terminated')) OR
    (v_old.status='active' AND v_status IN('completed','expired','terminated')) OR
    (v_old.status='expired' AND v_status='terminated')
  ) THEN RAISE EXCEPTION 'انتقال حالة العقد غير صالح'; END IF;
  IF (p_patch?'title' AND (NULLIF(BTRIM(p_patch->>'title'),'') IS NULL OR LENGTH(p_patch->>'title')>200))
    OR v_type NOT IN('general','client','subcontractor','supplier','employee','lease','insurance','bond')
    OR v_start IS NULL OR v_end IS NULL OR v_end<v_start OR v_value<0 OR v_value<>ROUND(v_value,2)
    OR LENGTH(COALESCE(p_patch->>'description',''))>4000
    OR (v_project IS NOT NULL AND NOT EXISTS(SELECT 1 FROM projects WHERE id=v_project AND company_id=p_company_id))
    OR (v_contact IS NOT NULL AND NOT EXISTS(SELECT 1 FROM contacts WHERE id=v_contact AND company_id=p_company_id))
  THEN RAISE EXCEPTION 'بيانات العقد غير صالحة'; END IF;
  PERFORM set_config('app.relationship_write_company',p_company_id::TEXT,TRUE);
  UPDATE contracts SET
    title=CASE WHEN p_patch?'title' THEN BTRIM(p_patch->>'title') ELSE title END,type=v_type,project_id=v_project,contact_id=v_contact,
    start_date=v_start,end_date=v_end,value=v_value,
    description=CASE WHEN p_patch?'description' THEN NULLIF(BTRIM(p_patch->>'description'),'') ELSE description END,
    status=v_status,updated_at=NOW() WHERE id=p_contract_id RETURNING * INTO v_new;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'update','contract',p_contract_id,to_jsonb(v_old),to_jsonb(v_new));
  RETURN to_jsonb(v_new);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_draft_contract_atomic(p_company_id UUID,p_contract_id UUID,p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old contracts%ROWTYPE; v_paths JSONB;
BEGIN
  PERFORM assert_relationship_actor(p_company_id,p_user_id);
  SELECT * INTO v_old FROM contracts WHERE id=p_contract_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'العقد غير موجود'; END IF;
  IF v_old.status<>'draft' THEN RAISE EXCEPTION 'لا يمكن حذف عقد دخل دورة العمل'; END IF;
  SELECT COALESCE(jsonb_agg(SUBSTRING(file_data FROM LENGTH('storage:contract-documents/')+1)) FILTER(
    WHERE file_data LIKE 'storage:contract-documents/'||p_company_id::TEXT||'/'||p_contract_id::TEXT||'/%'
  ),'[]'::JSONB) INTO v_paths FROM contract_documents WHERE contract_id=p_contract_id AND company_id=p_company_id;
  PERFORM set_config('app.relationship_write_company',p_company_id::TEXT,TRUE);
  DELETE FROM contracts WHERE id=p_contract_id;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values)
  VALUES(p_company_id,p_user_id,'delete','contract',p_contract_id,to_jsonb(v_old));
  RETURN jsonb_build_object('id',p_contract_id,'deleted',TRUE,'storage_paths',v_paths);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_contract_document_atomic(
  p_company_id UUID,p_contract_id UUID,p_filename TEXT,p_content_type TEXT,p_storage_reference TEXT,p_file_size INT,p_description TEXT,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_row contract_documents%ROWTYPE;
BEGIN
  PERFORM assert_relationship_actor(p_company_id,p_user_id);
  PERFORM 1 FROM companies WHERE id=p_company_id FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM contracts WHERE id=p_contract_id AND company_id=p_company_id)
    OR NULLIF(BTRIM(p_filename),'') IS NULL OR LENGTH(p_filename)>255
    OR p_content_type NOT IN('image/jpeg','image/png','application/pdf') OR p_file_size<=0 OR p_file_size>10485760
    OR LENGTH(COALESCE(p_description,''))>1000 OR p_storage_reference NOT LIKE 'storage:contract-documents/'||p_company_id::TEXT||'/'||p_contract_id::TEXT||'/%'
    OR p_storage_reference LIKE '%..%'
  THEN RAISE EXCEPTION 'بيانات مستند العقد غير صالحة'; END IF;
  PERFORM set_config('app.relationship_write_company',p_company_id::TEXT,TRUE);
  INSERT INTO contract_documents(contract_id,company_id,filename,content_type,file_data,file_size,description,uploaded_by)
  VALUES(p_contract_id,p_company_id,BTRIM(p_filename),p_content_type,p_storage_reference,p_file_size,NULLIF(BTRIM(p_description),''),p_user_id)
  RETURNING * INTO v_row;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'upload','contract_document',v_row.id,to_jsonb(v_row)-'file_data');
  RETURN to_jsonb(v_row)-'file_data';
END;
$$;

-- Tenders -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_tender_atomic(p_company_id UUID,p_payload JSONB,p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_row tenders%ROWTYPE; v_contact UUID; v_value NUMERIC; v_bond NUMERIC; v_duration INT; v_probability INT; v_deadline DATE; v_opening DATE; v_status TEXT;
BEGIN
  PERFORM assert_relationship_actor(p_company_id,p_user_id);
  PERFORM assert_relationship_payload(p_payload,ARRAY['title','client_name','contact_id','reference_number','description','estimated_value','bid_bond_amount','submission_deadline','opening_date','project_location','project_duration_months','status','win_probability','notes']);
  v_status:=COALESCE(p_payload->>'status','draft');
  BEGIN
    v_contact:=NULLIF(p_payload->>'contact_id','')::UUID; v_value:=NULLIF(p_payload->>'estimated_value','')::NUMERIC;
    v_bond:=NULLIF(p_payload->>'bid_bond_amount','')::NUMERIC; v_duration:=NULLIF(p_payload->>'project_duration_months','')::INT;
    v_probability:=NULLIF(p_payload->>'win_probability','')::INT; v_deadline:=NULLIF(p_payload->>'submission_deadline','')::DATE;
    v_opening:=NULLIF(p_payload->>'opening_date','')::DATE;
  EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR numeric_value_out_of_range THEN RAISE EXCEPTION 'بيانات المناقصة غير صالحة'; END;
  IF NULLIF(BTRIM(p_payload->>'title'),'') IS NULL OR LENGTH(p_payload->>'title')>200
    OR NULLIF(BTRIM(p_payload->>'client_name'),'') IS NULL OR LENGTH(p_payload->>'client_name')>200 OR v_status NOT IN('draft','preparing')
    OR (v_value IS NOT NULL AND (v_value<0 OR v_value<>ROUND(v_value,2))) OR (v_bond IS NOT NULL AND (v_bond<0 OR v_bond<>ROUND(v_bond,2)))
    OR (v_duration IS NOT NULL AND (v_duration<0 OR v_duration>1200)) OR (v_probability IS NOT NULL AND (v_probability<0 OR v_probability>100))
    OR (v_deadline IS NOT NULL AND v_opening IS NOT NULL AND v_opening<v_deadline)
    OR (v_contact IS NOT NULL AND NOT EXISTS(SELECT 1 FROM contacts WHERE id=v_contact AND company_id=p_company_id))
    OR LENGTH(COALESCE(p_payload->>'reference_number',''))>120 OR LENGTH(COALESCE(p_payload->>'description',''))>4000
    OR LENGTH(COALESCE(p_payload->>'project_location',''))>500 OR LENGTH(COALESCE(p_payload->>'notes',''))>2000
  THEN RAISE EXCEPTION 'بيانات المناقصة غير صالحة'; END IF;
  PERFORM set_config('app.relationship_write_company',p_company_id::TEXT,TRUE);
  INSERT INTO tenders(company_id,title,client_name,contact_id,reference_number,description,estimated_value,bid_bond_amount,
    submission_deadline,opening_date,project_location,project_duration_months,status,win_probability,notes,created_by)
  VALUES(p_company_id,BTRIM(p_payload->>'title'),BTRIM(p_payload->>'client_name'),v_contact,NULLIF(BTRIM(p_payload->>'reference_number'),''),
    NULLIF(BTRIM(p_payload->>'description'),''),v_value,v_bond,v_deadline,v_opening,NULLIF(BTRIM(p_payload->>'project_location'),''),v_duration,
    v_status,v_probability,NULLIF(BTRIM(p_payload->>'notes'),''),p_user_id) RETURNING * INTO v_row;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'create','tender',v_row.id,to_jsonb(v_row));
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_tender_atomic(p_company_id UUID,p_tender_id UUID,p_patch JSONB,p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old tenders%ROWTYPE; v_new tenders%ROWTYPE; v_contact UUID; v_value NUMERIC; v_bond NUMERIC; v_duration INT; v_probability INT; v_deadline DATE; v_opening DATE;
BEGIN
  PERFORM assert_relationship_actor(p_company_id,p_user_id);
  PERFORM assert_relationship_payload(p_patch,ARRAY['title','client_name','contact_id','reference_number','description','estimated_value','bid_bond_amount','submission_deadline','opening_date','project_location','project_duration_months','win_probability','notes']);
  IF p_patch='{}'::JSONB THEN RAISE EXCEPTION 'لا توجد بيانات للتحديث'; END IF;
  SELECT * INTO v_old FROM tenders WHERE id=p_tender_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المناقصة غير موجودة'; END IF;
  IF v_old.status NOT IN('draft','preparing') THEN RAISE EXCEPTION 'لا يمكن تعديل مناقصة بعد تقديمها'; END IF;
  BEGIN
    v_contact:=CASE WHEN p_patch?'contact_id' THEN NULLIF(p_patch->>'contact_id','')::UUID ELSE v_old.contact_id END;
    v_value:=CASE WHEN p_patch?'estimated_value' THEN NULLIF(p_patch->>'estimated_value','')::NUMERIC ELSE v_old.estimated_value END;
    v_bond:=CASE WHEN p_patch?'bid_bond_amount' THEN NULLIF(p_patch->>'bid_bond_amount','')::NUMERIC ELSE v_old.bid_bond_amount END;
    v_duration:=CASE WHEN p_patch?'project_duration_months' THEN NULLIF(p_patch->>'project_duration_months','')::INT ELSE v_old.project_duration_months END;
    v_probability:=CASE WHEN p_patch?'win_probability' THEN NULLIF(p_patch->>'win_probability','')::INT ELSE v_old.win_probability END;
    v_deadline:=CASE WHEN p_patch?'submission_deadline' THEN NULLIF(p_patch->>'submission_deadline','')::DATE ELSE v_old.submission_deadline END;
    v_opening:=CASE WHEN p_patch?'opening_date' THEN NULLIF(p_patch->>'opening_date','')::DATE ELSE v_old.opening_date END;
  EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR numeric_value_out_of_range THEN RAISE EXCEPTION 'بيانات المناقصة غير صالحة'; END;
  IF (p_patch?'title' AND (NULLIF(BTRIM(p_patch->>'title'),'') IS NULL OR LENGTH(p_patch->>'title')>200))
    OR (p_patch?'client_name' AND (NULLIF(BTRIM(p_patch->>'client_name'),'') IS NULL OR LENGTH(p_patch->>'client_name')>200))
    OR (v_value IS NOT NULL AND (v_value<0 OR v_value<>ROUND(v_value,2))) OR (v_bond IS NOT NULL AND (v_bond<0 OR v_bond<>ROUND(v_bond,2)))
    OR (v_duration IS NOT NULL AND (v_duration<0 OR v_duration>1200)) OR (v_probability IS NOT NULL AND (v_probability<0 OR v_probability>100))
    OR (v_deadline IS NOT NULL AND v_opening IS NOT NULL AND v_opening<v_deadline)
    OR (v_contact IS NOT NULL AND NOT EXISTS(SELECT 1 FROM contacts WHERE id=v_contact AND company_id=p_company_id))
    OR LENGTH(COALESCE(p_patch->>'reference_number',''))>120 OR LENGTH(COALESCE(p_patch->>'description',''))>4000
    OR LENGTH(COALESCE(p_patch->>'project_location',''))>500 OR LENGTH(COALESCE(p_patch->>'notes',''))>2000
  THEN RAISE EXCEPTION 'بيانات المناقصة غير صالحة'; END IF;
  PERFORM set_config('app.relationship_write_company',p_company_id::TEXT,TRUE);
  UPDATE tenders SET
    title=CASE WHEN p_patch?'title' THEN BTRIM(p_patch->>'title') ELSE title END,
    client_name=CASE WHEN p_patch?'client_name' THEN BTRIM(p_patch->>'client_name') ELSE client_name END,
    contact_id=v_contact,reference_number=CASE WHEN p_patch?'reference_number' THEN NULLIF(BTRIM(p_patch->>'reference_number'),'') ELSE reference_number END,
    description=CASE WHEN p_patch?'description' THEN NULLIF(BTRIM(p_patch->>'description'),'') ELSE description END,
    estimated_value=v_value,bid_bond_amount=v_bond,submission_deadline=v_deadline,opening_date=v_opening,
    project_location=CASE WHEN p_patch?'project_location' THEN NULLIF(BTRIM(p_patch->>'project_location'),'') ELSE project_location END,
    project_duration_months=v_duration,win_probability=v_probability,
    notes=CASE WHEN p_patch?'notes' THEN NULLIF(BTRIM(p_patch->>'notes'),'') ELSE notes END,updated_at=NOW()
  WHERE id=p_tender_id RETURNING * INTO v_new;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'update','tender',p_tender_id,to_jsonb(v_old),to_jsonb(v_new));
  RETURN to_jsonb(v_new);
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_tender_atomic(p_company_id UUID,p_tender_id UUID,p_status TEXT,p_notes TEXT,p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old tenders%ROWTYPE; v_new tenders%ROWTYPE;
BEGIN
  PERFORM assert_relationship_actor(p_company_id,p_user_id);
  SELECT * INTO v_old FROM tenders WHERE id=p_tender_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المناقصة غير موجودة'; END IF;
  IF v_old.status=p_status THEN RETURN to_jsonb(v_old)||jsonb_build_object('already_processed',TRUE); END IF;
  IF NOT ((v_old.status='draft' AND p_status IN('preparing','submitted','cancelled')) OR
    (v_old.status='preparing' AND p_status IN('submitted','cancelled')) OR
    (v_old.status='submitted' AND p_status IN('won','lost','cancelled')))
  THEN RAISE EXCEPTION 'انتقال حالة المناقصة غير صالح'; END IF;
  IF p_status='won' AND COALESCE(v_old.estimated_value,0)<=0 THEN RAISE EXCEPTION 'قيمة المناقصة الرابحة غير صالحة'; END IF;
  IF LENGTH(COALESCE(p_notes,''))>2000 THEN RAISE EXCEPTION 'الملاحظات طويلة جداً'; END IF;
  PERFORM set_config('app.relationship_write_company',p_company_id::TEXT,TRUE);
  UPDATE tenders SET status=p_status,notes=COALESCE(NULLIF(BTRIM(p_notes),''),notes),updated_at=NOW() WHERE id=p_tender_id RETURNING * INTO v_new;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'transition','tender',p_tender_id,to_jsonb(v_old),to_jsonb(v_new));
  RETURN to_jsonb(v_new)||jsonb_build_object('already_processed',FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_tender_cost_item_atomic(p_company_id UUID,p_tender_id UUID,p_payload JSONB,p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_tender tenders%ROWTYPE; v_row tender_cost_items%ROWTYPE; v_amount NUMERIC; v_category TEXT;
BEGIN
  PERFORM assert_relationship_actor(p_company_id,p_user_id);
  PERFORM assert_relationship_payload(p_payload,ARRAY['category','description','amount','notes']);
  SELECT * INTO v_tender FROM tenders WHERE id=p_tender_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المناقصة غير موجودة'; END IF;
  IF v_tender.status NOT IN('draft','preparing') THEN RAISE EXCEPTION 'لا يمكن تعديل تكاليف مناقصة بعد تقديمها'; END IF;
  v_category:=COALESCE(p_payload->>'category','');
  BEGIN v_amount:=(p_payload->>'amount')::NUMERIC;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'بيانات بند التكلفة غير صالحة'; END;
  IF v_category NOT IN('materials','labor','equipment','subcontractor','overhead','other') OR v_amount<=0 OR v_amount<>ROUND(v_amount,2)
    OR LENGTH(COALESCE(p_payload->>'description',''))>1000 OR LENGTH(COALESCE(p_payload->>'notes',''))>2000
  THEN RAISE EXCEPTION 'بيانات بند التكلفة غير صالحة'; END IF;
  PERFORM set_config('app.relationship_write_company',p_company_id::TEXT,TRUE);
  INSERT INTO tender_cost_items(tender_id,company_id,category,description,amount,notes,created_by)
  VALUES(p_tender_id,p_company_id,v_category,NULLIF(BTRIM(p_payload->>'description'),''),v_amount,NULLIF(BTRIM(p_payload->>'notes'),''),p_user_id)
  RETURNING * INTO v_row;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'create','tender_cost_item',v_row.id,to_jsonb(v_row));
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_draft_tender_atomic(p_company_id UUID,p_tender_id UUID,p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_tender tenders%ROWTYPE;
BEGIN
  PERFORM assert_relationship_actor(p_company_id,p_user_id);
  SELECT * INTO v_tender FROM tenders WHERE id=p_tender_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المناقصة غير موجودة'; END IF;
  IF v_tender.status<>'draft' OR v_tender.project_id IS NOT NULL THEN RAISE EXCEPTION 'لا يمكن حذف مناقصة دخلت دورة العمل'; END IF;
  IF EXISTS(SELECT 1 FROM bonds WHERE tender_id=p_tender_id AND company_id=p_company_id) THEN RAISE EXCEPTION 'لا يمكن حذف مناقصة مرتبطة بضمان'; END IF;
  PERFORM set_config('app.relationship_write_company',p_company_id::TEXT,TRUE);
  DELETE FROM tenders WHERE id=p_tender_id;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values)
  VALUES(p_company_id,p_user_id,'delete','tender',p_tender_id,to_jsonb(v_tender));
  RETURN jsonb_build_object('id',p_tender_id,'deleted',TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.convert_won_tender_to_project_atomic(p_company_id UUID,p_tender_id UUID,p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_tender tenders%ROWTYPE; v_project JSONB; v_end DATE;
BEGIN
  PERFORM assert_relationship_actor(p_company_id,p_user_id);
  SELECT * INTO v_tender FROM tenders WHERE id=p_tender_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المناقصة غير موجودة'; END IF;
  IF v_tender.project_id IS NOT NULL THEN RETURN jsonb_build_object('project',jsonb_build_object('id',v_tender.project_id),'tender_id',p_tender_id,'already_processed',TRUE); END IF;
  IF v_tender.status<>'won' THEN RAISE EXCEPTION 'يمكن تحويل العطاءات الرابحة فقط إلى مشروع'; END IF;
  IF COALESCE(v_tender.estimated_value,0)<=0 THEN RAISE EXCEPTION 'قيمة المناقصة غير صالحة لإنشاء مشروع'; END IF;
  v_end:=CASE WHEN COALESCE(v_tender.project_duration_months,0)>0 THEN CURRENT_DATE+(v_tender.project_duration_months*30) ELSE NULL END;
  v_project:=create_project_atomic(p_company_id,v_tender.title,v_tender.contact_id,v_tender.estimated_value,
    CURRENT_DATE,v_end,'active',COALESCE(v_tender.description,''),COALESCE(v_tender.project_location,''),'[]'::JSONB,FALSE,p_user_id);
  UPDATE projects SET tender_id=p_tender_id WHERE id=(v_project->>'id')::UUID AND company_id=p_company_id RETURNING to_jsonb(projects.*) INTO v_project;
  PERFORM set_config('app.relationship_write_company',p_company_id::TEXT,TRUE);
  UPDATE tenders SET project_id=(v_project->>'id')::UUID,updated_at=NOW() WHERE id=p_tender_id;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'convert_to_project','tender',p_tender_id,jsonb_build_object('project_id',v_project->>'id'));
  RETURN jsonb_build_object('project',v_project,'tender_id',p_tender_id,'already_processed',FALSE);
END;
$$;

-- Bonds ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_bond_atomic(p_company_id UUID,p_payload JSONB,p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_row bonds%ROWTYPE; v_project UUID; v_tender UUID; v_contact UUID; v_bank UUID; v_amount NUMERIC; v_issue DATE; v_expiry DATE; v_type TEXT; v_currency TEXT;
BEGIN
  PERFORM assert_relationship_actor(p_company_id,p_user_id);
  PERFORM assert_relationship_payload(p_payload,ARRAY['title','type','amount','currency','issue_date','expiry_date','issuing_bank','bank_safe_id','beneficiary_name','project_id','tender_id','contact_id','reference_number','notes']);
  v_type:=COALESCE(p_payload->>'type',''); v_currency:=COALESCE(p_payload->>'currency','SAR');
  BEGIN
    v_project:=NULLIF(p_payload->>'project_id','')::UUID; v_tender:=NULLIF(p_payload->>'tender_id','')::UUID;
    v_contact:=NULLIF(p_payload->>'contact_id','')::UUID; v_bank:=NULLIF(p_payload->>'bank_safe_id','')::UUID;
    v_amount:=(p_payload->>'amount')::NUMERIC; v_issue:=(p_payload->>'issue_date')::DATE; v_expiry:=(p_payload->>'expiry_date')::DATE;
  EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR numeric_value_out_of_range THEN RAISE EXCEPTION 'بيانات الضمان غير صالحة'; END;
  IF NULLIF(BTRIM(p_payload->>'title'),'') IS NULL OR LENGTH(p_payload->>'title')>200
    OR v_type NOT IN('bid_bond','performance_bond','advance_payment','retention','warranty','insurance','other')
    OR v_currency !~ '^[A-Z]{3}$' OR v_amount<=0 OR v_amount<>ROUND(v_amount,2) OR v_issue IS NULL OR v_expiry IS NULL OR v_expiry<v_issue
    OR (v_project IS NOT NULL AND NOT EXISTS(SELECT 1 FROM projects WHERE id=v_project AND company_id=p_company_id))
    OR (v_tender IS NOT NULL AND NOT EXISTS(SELECT 1 FROM tenders WHERE id=v_tender AND company_id=p_company_id))
    OR (v_contact IS NOT NULL AND NOT EXISTS(SELECT 1 FROM contacts WHERE id=v_contact AND company_id=p_company_id))
    OR (v_bank IS NOT NULL AND NOT EXISTS(SELECT 1 FROM banks_safes WHERE id=v_bank AND company_id=p_company_id))
    OR LENGTH(COALESCE(p_payload->>'issuing_bank',''))>200 OR LENGTH(COALESCE(p_payload->>'beneficiary_name',''))>200
    OR LENGTH(COALESCE(p_payload->>'reference_number',''))>120 OR LENGTH(COALESCE(p_payload->>'notes',''))>2000
  THEN RAISE EXCEPTION 'بيانات الضمان غير صالحة'; END IF;
  PERFORM set_config('app.relationship_write_company',p_company_id::TEXT,TRUE);
  INSERT INTO bonds(company_id,title,type,amount,currency,issue_date,expiry_date,issuing_bank,bank_safe_id,beneficiary_name,
    project_id,tender_id,contact_id,reference_number,status,notes,created_by)
  VALUES(p_company_id,BTRIM(p_payload->>'title'),v_type,v_amount,v_currency,v_issue,v_expiry,NULLIF(BTRIM(p_payload->>'issuing_bank'),''),v_bank,
    NULLIF(BTRIM(p_payload->>'beneficiary_name'),''),v_project,v_tender,v_contact,NULLIF(BTRIM(p_payload->>'reference_number'),''),'active',
    NULLIF(BTRIM(p_payload->>'notes'),''),p_user_id) RETURNING * INTO v_row;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'create','bond',v_row.id,to_jsonb(v_row));
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_bond_atomic(p_company_id UUID,p_bond_id UUID,p_patch JSONB,p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old bonds%ROWTYPE; v_new bonds%ROWTYPE; v_amount NUMERIC; v_expiry DATE;
BEGIN
  PERFORM assert_relationship_actor(p_company_id,p_user_id);
  PERFORM assert_relationship_payload(p_patch,ARRAY['title','amount','expiry_date','notes','beneficiary_name']);
  IF p_patch='{}'::JSONB THEN RAISE EXCEPTION 'لا توجد بيانات للتحديث'; END IF;
  SELECT * INTO v_old FROM bonds WHERE id=p_bond_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الضمان غير موجود'; END IF;
  IF v_old.status<>'active' THEN RAISE EXCEPTION 'لا يمكن تعديل ضمان غير نشط'; END IF;
  BEGIN
    v_amount:=CASE WHEN p_patch?'amount' THEN (p_patch->>'amount')::NUMERIC ELSE v_old.amount END;
    v_expiry:=CASE WHEN p_patch?'expiry_date' THEN (p_patch->>'expiry_date')::DATE ELSE v_old.expiry_date END;
  EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR numeric_value_out_of_range THEN RAISE EXCEPTION 'بيانات الضمان غير صالحة'; END;
  IF (p_patch?'title' AND (NULLIF(BTRIM(p_patch->>'title'),'') IS NULL OR LENGTH(p_patch->>'title')>200))
    OR v_amount<=0 OR v_amount<>ROUND(v_amount,2) OR v_expiry<v_old.issue_date
    OR LENGTH(COALESCE(p_patch->>'notes',''))>2000 OR LENGTH(COALESCE(p_patch->>'beneficiary_name',''))>200
  THEN RAISE EXCEPTION 'بيانات الضمان غير صالحة'; END IF;
  PERFORM set_config('app.relationship_write_company',p_company_id::TEXT,TRUE);
  UPDATE bonds SET title=CASE WHEN p_patch?'title' THEN BTRIM(p_patch->>'title') ELSE title END,amount=v_amount,expiry_date=v_expiry,
    notes=CASE WHEN p_patch?'notes' THEN NULLIF(BTRIM(p_patch->>'notes'),'') ELSE notes END,
    beneficiary_name=CASE WHEN p_patch?'beneficiary_name' THEN NULLIF(BTRIM(p_patch->>'beneficiary_name'),'') ELSE beneficiary_name END,
    updated_at=NOW() WHERE id=p_bond_id RETURNING * INTO v_new;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'update','bond',p_bond_id,to_jsonb(v_old),to_jsonb(v_new));
  RETURN to_jsonb(v_new);
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_bond_atomic(p_company_id UUID,p_bond_id UUID,p_action TEXT,p_notes TEXT,p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old bonds%ROWTYPE; v_new bonds%ROWTYPE; v_status TEXT;
BEGIN
  PERFORM assert_relationship_actor(p_company_id,p_user_id);
  IF p_action NOT IN('release','cancel') OR LENGTH(COALESCE(p_notes,''))>2000 THEN RAISE EXCEPTION 'عملية الضمان غير صالحة'; END IF;
  v_status:=CASE WHEN p_action='release' THEN 'released' ELSE 'cancelled' END;
  SELECT * INTO v_old FROM bonds WHERE id=p_bond_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الضمان غير موجود'; END IF;
  IF v_old.status=v_status THEN RETURN to_jsonb(v_old)||jsonb_build_object('already_processed',TRUE); END IF;
  IF v_old.status<>'active' THEN RAISE EXCEPTION 'لا يمكن تغيير حالة ضمان غير نشط'; END IF;
  PERFORM set_config('app.relationship_write_company',p_company_id::TEXT,TRUE);
  UPDATE bonds SET status=v_status,released_at=CASE WHEN p_action='release' THEN NOW() ELSE released_at END,
    notes=COALESCE(NULLIF(BTRIM(p_notes),''),notes),updated_at=NOW() WHERE id=p_bond_id RETURNING * INTO v_new;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,p_action,'bond',p_bond_id,to_jsonb(v_old),to_jsonb(v_new));
  RETURN to_jsonb(v_new)||jsonb_build_object('already_processed',FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_bond_summary(p_company_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT jsonb_build_object(
    'total',COUNT(*),
    'active',COUNT(*) FILTER(WHERE status='active'),
    'expiringSoon',COUNT(*) FILTER(WHERE status='active' AND expiry_date>=CURRENT_DATE AND expiry_date<CURRENT_DATE+30),
    'expired',COUNT(*) FILTER(WHERE expiry_date<CURRENT_DATE),
    'totalValue',COALESCE(SUM(amount),0)
  ) FROM bonds WHERE company_id=p_company_id
$$;

-- Gantt tasks ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_project_task_atomic(p_company_id UUID,p_payload JSONB,p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_row project_tasks%ROWTYPE; v_project UUID; v_parent UUID; v_assignee UUID; v_start DATE; v_end DATE; v_progress NUMERIC; v_est NUMERIC; v_actual NUMERIC; v_status TEXT; v_priority TEXT;
BEGIN
  PERFORM assert_relationship_actor(p_company_id,p_user_id);
  PERFORM assert_relationship_payload(p_payload,ARRAY['project_id','name','description','start_date','end_date','progress','status','priority','parent_task_id','assigned_to','estimated_hours','actual_hours']);
  v_status:=COALESCE(p_payload->>'status','not_started'); v_priority:=COALESCE(p_payload->>'priority','medium');
  BEGIN
    v_project:=(p_payload->>'project_id')::UUID; v_parent:=NULLIF(p_payload->>'parent_task_id','')::UUID; v_assignee:=NULLIF(p_payload->>'assigned_to','')::UUID;
    v_start:=(p_payload->>'start_date')::DATE; v_end:=(p_payload->>'end_date')::DATE; v_progress:=COALESCE((p_payload->>'progress')::NUMERIC,0);
    v_est:=NULLIF(p_payload->>'estimated_hours','')::NUMERIC; v_actual:=NULLIF(p_payload->>'actual_hours','')::NUMERIC;
  EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR numeric_value_out_of_range THEN RAISE EXCEPTION 'بيانات المهمة غير صالحة'; END;
  IF v_status='completed' THEN v_progress:=100;
  ELSIF v_progress=100 THEN v_status:='completed';
  ELSIF v_progress>0 AND v_status NOT IN('blocked','on_hold') THEN v_status:='in_progress'; END IF;
  IF NULLIF(BTRIM(p_payload->>'name'),'') IS NULL OR LENGTH(p_payload->>'name')>200 OR v_start IS NULL OR v_end IS NULL OR v_end<v_start
    OR v_progress<0 OR v_progress>100 OR v_status NOT IN('not_started','in_progress','completed','blocked','on_hold')
    OR v_priority NOT IN('low','medium','high','critical') OR (v_est IS NOT NULL AND (v_est<0 OR v_est<>ROUND(v_est,2)))
    OR (v_actual IS NOT NULL AND (v_actual<0 OR v_actual<>ROUND(v_actual,2))) OR LENGTH(COALESCE(p_payload->>'description',''))>4000
    OR NOT EXISTS(SELECT 1 FROM projects WHERE id=v_project AND company_id=p_company_id)
    OR (v_parent IS NOT NULL AND NOT EXISTS(SELECT 1 FROM project_tasks WHERE id=v_parent AND project_id=v_project AND company_id=p_company_id))
    OR (v_assignee IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=v_assignee AND company_id=p_company_id AND is_active=TRUE))
  THEN RAISE EXCEPTION 'بيانات المهمة غير صالحة'; END IF;
  PERFORM set_config('app.relationship_write_company',p_company_id::TEXT,TRUE);
  INSERT INTO project_tasks(company_id,project_id,name,description,start_date,end_date,progress,status,priority,parent_task_id,assigned_to,estimated_hours,actual_hours,created_by)
  VALUES(p_company_id,v_project,BTRIM(p_payload->>'name'),NULLIF(BTRIM(p_payload->>'description'),''),v_start,v_end,v_progress,v_status,v_priority,v_parent,v_assignee,v_est,v_actual,p_user_id)
  RETURNING * INTO v_row;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'create','project_task',v_row.id,to_jsonb(v_row));
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_project_task_atomic(p_company_id UUID,p_task_id UUID,p_patch JSONB,p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old project_tasks%ROWTYPE; v_new project_tasks%ROWTYPE; v_parent UUID; v_assignee UUID; v_start DATE; v_end DATE; v_progress NUMERIC; v_est NUMERIC; v_actual NUMERIC; v_status TEXT; v_priority TEXT;
BEGIN
  PERFORM assert_relationship_actor(p_company_id,p_user_id);
  PERFORM assert_relationship_payload(p_patch,ARRAY['name','description','start_date','end_date','progress','status','priority','parent_task_id','assigned_to','estimated_hours','actual_hours']);
  IF p_patch='{}'::JSONB THEN RAISE EXCEPTION 'لا توجد بيانات للتحديث'; END IF;
  SELECT * INTO v_old FROM project_tasks WHERE id=p_task_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المهمة غير موجودة'; END IF;
  BEGIN
    v_parent:=CASE WHEN p_patch?'parent_task_id' THEN NULLIF(p_patch->>'parent_task_id','')::UUID ELSE v_old.parent_task_id END;
    v_assignee:=CASE WHEN p_patch?'assigned_to' THEN NULLIF(p_patch->>'assigned_to','')::UUID ELSE v_old.assigned_to END;
    v_start:=CASE WHEN p_patch?'start_date' THEN (p_patch->>'start_date')::DATE ELSE v_old.start_date END;
    v_end:=CASE WHEN p_patch?'end_date' THEN (p_patch->>'end_date')::DATE ELSE v_old.end_date END;
    v_progress:=CASE WHEN p_patch?'progress' THEN (p_patch->>'progress')::NUMERIC ELSE v_old.progress END;
    v_est:=CASE WHEN p_patch?'estimated_hours' THEN NULLIF(p_patch->>'estimated_hours','')::NUMERIC ELSE v_old.estimated_hours END;
    v_actual:=CASE WHEN p_patch?'actual_hours' THEN NULLIF(p_patch->>'actual_hours','')::NUMERIC ELSE v_old.actual_hours END;
  EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR numeric_value_out_of_range THEN RAISE EXCEPTION 'بيانات المهمة غير صالحة'; END;
  v_status:=CASE WHEN p_patch?'status' THEN p_patch->>'status' ELSE v_old.status END;
  v_priority:=CASE WHEN p_patch?'priority' THEN p_patch->>'priority' ELSE v_old.priority END;
  IF p_patch?'status' AND v_status='completed' THEN v_progress:=100;
  ELSIF p_patch?'status' AND v_status='not_started' THEN v_progress:=0;
  ELSIF p_patch?'progress' THEN
    IF v_progress=100 THEN v_status:='completed'; ELSIF v_progress>0 THEN v_status:='in_progress'; ELSIF v_status IN('completed','in_progress') THEN v_status:='not_started'; END IF;
  END IF;
  IF (p_patch?'name' AND (NULLIF(BTRIM(p_patch->>'name'),'') IS NULL OR LENGTH(p_patch->>'name')>200))
    OR v_start IS NULL OR v_end IS NULL OR v_end<v_start OR v_progress<0 OR v_progress>100
    OR v_status NOT IN('not_started','in_progress','completed','blocked','on_hold') OR v_priority NOT IN('low','medium','high','critical')
    OR (v_est IS NOT NULL AND (v_est<0 OR v_est<>ROUND(v_est,2))) OR (v_actual IS NOT NULL AND (v_actual<0 OR v_actual<>ROUND(v_actual,2)))
    OR LENGTH(COALESCE(p_patch->>'description',''))>4000
    OR v_parent=p_task_id OR (v_parent IS NOT NULL AND NOT EXISTS(SELECT 1 FROM project_tasks WHERE id=v_parent AND project_id=v_old.project_id AND company_id=p_company_id))
    OR (v_assignee IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=v_assignee AND company_id=p_company_id AND is_active=TRUE))
  THEN RAISE EXCEPTION 'بيانات المهمة غير صالحة'; END IF;
  IF v_parent IS NOT NULL AND EXISTS(
    WITH RECURSIVE ancestors AS (
      SELECT id,parent_task_id FROM project_tasks WHERE id=v_parent AND company_id=p_company_id AND project_id=v_old.project_id
      UNION ALL SELECT p.id,p.parent_task_id FROM project_tasks p JOIN ancestors a ON p.id=a.parent_task_id
        WHERE p.company_id=p_company_id AND p.project_id=v_old.project_id
    ) SELECT 1 FROM ancestors WHERE id=p_task_id
  ) THEN RAISE EXCEPTION 'لا يمكن إنشاء دورة في تبعيات المهام'; END IF;
  PERFORM set_config('app.relationship_write_company',p_company_id::TEXT,TRUE);
  UPDATE project_tasks SET name=CASE WHEN p_patch?'name' THEN BTRIM(p_patch->>'name') ELSE name END,
    description=CASE WHEN p_patch?'description' THEN NULLIF(BTRIM(p_patch->>'description'),'') ELSE description END,
    start_date=v_start,end_date=v_end,progress=v_progress,status=v_status,priority=v_priority,parent_task_id=v_parent,assigned_to=v_assignee,
    estimated_hours=v_est,actual_hours=v_actual,updated_at=NOW() WHERE id=p_task_id RETURNING * INTO v_new;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'update','project_task',p_task_id,to_jsonb(v_old),to_jsonb(v_new));
  RETURN to_jsonb(v_new);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_unstarted_project_task_atomic(p_company_id UUID,p_task_id UUID,p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_task project_tasks%ROWTYPE; v_count INT;
BEGIN
  PERFORM assert_relationship_actor(p_company_id,p_user_id);
  SELECT * INTO v_task FROM project_tasks WHERE id=p_task_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المهمة غير موجودة'; END IF;
  PERFORM 1 FROM project_tasks WHERE company_id=p_company_id AND project_id=v_task.project_id FOR UPDATE;
  IF EXISTS(WITH RECURSIVE tree AS (
    SELECT id,progress FROM project_tasks WHERE id=p_task_id AND company_id=p_company_id
    UNION ALL SELECT child.id,child.progress FROM project_tasks child JOIN tree parent ON child.parent_task_id=parent.id
      WHERE child.company_id=p_company_id AND child.project_id=v_task.project_id
  ) SELECT 1 FROM tree WHERE COALESCE(progress,0)>0) THEN RAISE EXCEPTION 'لا يمكن حذف مهمة أو مهمة فرعية بدأ تنفيذها'; END IF;
  PERFORM set_config('app.relationship_write_company',p_company_id::TEXT,TRUE);
  WITH RECURSIVE tree AS (
    SELECT id FROM project_tasks WHERE id=p_task_id AND company_id=p_company_id
    UNION ALL SELECT child.id FROM project_tasks child JOIN tree parent ON child.parent_task_id=parent.id
      WHERE child.company_id=p_company_id AND child.project_id=v_task.project_id
  ) DELETE FROM project_tasks WHERE id IN(SELECT id FROM tree) AND company_id=p_company_id;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values)
  VALUES(p_company_id,p_user_id,'delete','project_task',p_task_id,to_jsonb(v_task));
  RETURN jsonb_build_object('id',p_task_id,'deleted',TRUE,'deleted_tasks',v_count);
END;
$$;

-- Invoice reminders reserve an auditable attempt before any external send. ---
CREATE OR REPLACE FUNCTION public.begin_invoice_reminder_attempt_atomic(p_company_id UUID,p_invoice_id UUID,p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_invoice invoices%ROWTYPE; v_contact contacts%ROWTYPE; v_company TEXT; v_log reminder_log%ROWTYPE; v_channel TEXT;
BEGIN
  PERFORM assert_relationship_actor(p_company_id,p_user_id);
  SELECT * INTO v_invoice FROM invoices WHERE id=p_invoice_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الفاتورة غير موجودة'; END IF;
  IF v_invoice.status<>'unpaid' OR v_invoice.due_date>=CURRENT_DATE THEN RAISE EXCEPTION 'الفاتورة غير متأخرة وغير قابلة للتذكير'; END IF;
  SELECT * INTO v_contact FROM contacts WHERE id=v_invoice.contact_id AND company_id=p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'بيانات عميل الفاتورة غير صالحة'; END IF;
  v_channel:=CASE WHEN NULLIF(BTRIM(v_contact.phone),'') IS NOT NULL THEN 'whatsapp' WHEN NULLIF(BTRIM(v_contact.email),'') IS NOT NULL THEN 'email' ELSE NULL END;
  IF v_channel IS NULL THEN RAISE EXCEPTION 'لا توجد بيانات تواصل للعميل'; END IF;
  IF EXISTS(SELECT 1 FROM reminder_log WHERE company_id=p_company_id AND invoice_id=p_invoice_id
    AND status IN('pending','sent') AND sent_at>=CURRENT_DATE)
  THEN RAISE EXCEPTION 'تم إنشاء تذكير لهذه الفاتورة اليوم'; END IF;
  SELECT name INTO v_company FROM companies WHERE id=p_company_id;
  PERFORM set_config('app.relationship_write_company',p_company_id::TEXT,TRUE);
  INSERT INTO reminder_log(company_id,invoice_id,customer_name,channel,status,sent_by,sent_at)
  VALUES(p_company_id,p_invoice_id,v_contact.name,v_channel,'pending',p_user_id,NOW()) RETURNING * INTO v_log;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'begin','invoice_reminder',v_log.id,jsonb_build_object('invoice_id',p_invoice_id,'channel',v_channel));
  RETURN jsonb_build_object('reminder_id',v_log.id,'invoice_id',v_invoice.id,'invoice_number',v_invoice.number,'amount',v_invoice.total,
    'due_date',v_invoice.due_date,'customer_name',v_contact.name,'phone',v_contact.phone,'email',v_contact.email,
    'company_name',COALESCE(v_company,'شركتنا'),'channel',v_channel);
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_invoice_reminder_attempt_atomic(
  p_company_id UUID,p_reminder_id UUID,p_user_id UUID,p_sent BOOLEAN,p_message_url TEXT,p_error TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old reminder_log%ROWTYPE; v_new reminder_log%ROWTYPE; v_status TEXT;
BEGIN
  PERFORM assert_relationship_actor(p_company_id,p_user_id);
  IF p_sent IS NULL OR LENGTH(COALESCE(p_message_url,''))>4000 OR LENGTH(COALESCE(p_error,''))>2000 THEN RAISE EXCEPTION 'نتيجة التذكير غير صالحة'; END IF;
  v_status:=CASE WHEN p_sent THEN 'sent' ELSE 'failed' END;
  SELECT * INTO v_old FROM reminder_log WHERE id=p_reminder_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'محاولة التذكير غير موجودة'; END IF;
  IF v_old.status=v_status THEN RETURN to_jsonb(v_old)||jsonb_build_object('already_processed',TRUE); END IF;
  IF v_old.status<>'pending' THEN RAISE EXCEPTION 'تم إنهاء محاولة التذكير مسبقاً'; END IF;
  PERFORM set_config('app.relationship_write_company',p_company_id::TEXT,TRUE);
  UPDATE reminder_log SET status=v_status,message_url=NULLIF(p_message_url,''),error=NULLIF(p_error,'') WHERE id=p_reminder_id RETURNING * INTO v_new;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'finish','invoice_reminder',p_reminder_id,to_jsonb(v_old),to_jsonb(v_new));
  RETURN to_jsonb(v_new)||jsonb_build_object('already_processed',FALSE);
END;
$$;

-- Refuse to install write guards over legacy cross-tenant links: silently
-- preserving a poisoned relation would still leak embedded parent data.
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM crm_contacts c JOIN users u ON u.id=c.assigned_to WHERE u.company_id<>c.company_id)
    OR EXISTS(SELECT 1 FROM crm_contacts c JOIN users u ON u.id=c.created_by WHERE u.company_id<>c.company_id)
    OR EXISTS(SELECT 1 FROM crm_followups f JOIN crm_contacts c ON c.id=f.crm_contact_id WHERE c.company_id<>f.company_id)
    OR EXISTS(SELECT 1 FROM crm_followups f JOIN users u ON u.id=f.created_by WHERE u.company_id<>f.company_id)
    OR EXISTS(SELECT 1 FROM contracts c JOIN projects p ON p.id=c.project_id WHERE p.company_id<>c.company_id)
    OR EXISTS(SELECT 1 FROM contracts c JOIN contacts p ON p.id=c.contact_id WHERE p.company_id<>c.company_id)
    OR EXISTS(SELECT 1 FROM contracts c JOIN users u ON u.id=c.created_by WHERE u.company_id<>c.company_id)
    OR EXISTS(SELECT 1 FROM contract_documents d JOIN contracts c ON c.id=d.contract_id WHERE c.company_id<>d.company_id)
    OR EXISTS(SELECT 1 FROM contract_documents d JOIN users u ON u.id=d.uploaded_by WHERE u.company_id<>d.company_id)
    OR EXISTS(SELECT 1 FROM tenders t JOIN contacts c ON c.id=t.contact_id WHERE c.company_id<>t.company_id)
    OR EXISTS(SELECT 1 FROM tenders t JOIN projects p ON p.id=t.project_id WHERE p.company_id<>t.company_id)
    OR EXISTS(SELECT 1 FROM tenders t JOIN users u ON u.id=t.created_by WHERE u.company_id<>t.company_id)
    OR EXISTS(SELECT 1 FROM tender_cost_items i JOIN tenders t ON t.id=i.tender_id WHERE t.company_id<>i.company_id)
    OR EXISTS(SELECT 1 FROM tender_cost_items i JOIN users u ON u.id=i.created_by WHERE u.company_id<>i.company_id)
    OR EXISTS(SELECT 1 FROM bonds b JOIN projects p ON p.id=b.project_id WHERE p.company_id<>b.company_id)
    OR EXISTS(SELECT 1 FROM bonds b JOIN tenders t ON t.id=b.tender_id WHERE t.company_id<>b.company_id)
    OR EXISTS(SELECT 1 FROM bonds b JOIN contacts c ON c.id=b.contact_id WHERE c.company_id<>b.company_id)
    OR EXISTS(SELECT 1 FROM bonds b JOIN banks_safes s ON s.id=b.bank_safe_id WHERE s.company_id<>b.company_id)
    OR EXISTS(SELECT 1 FROM bonds b JOIN users u ON u.id=b.created_by WHERE u.company_id<>b.company_id)
    OR EXISTS(SELECT 1 FROM project_tasks t JOIN projects p ON p.id=t.project_id WHERE p.company_id<>t.company_id)
    OR EXISTS(SELECT 1 FROM project_tasks t JOIN project_tasks p ON p.id=t.parent_task_id WHERE p.company_id<>t.company_id OR p.project_id<>t.project_id)
    OR EXISTS(SELECT 1 FROM project_tasks t JOIN users u ON u.id=t.assigned_to WHERE u.company_id<>t.company_id)
    OR EXISTS(SELECT 1 FROM project_tasks t JOIN users u ON u.id=t.created_by WHERE u.company_id<>t.company_id)
    OR EXISTS(SELECT 1 FROM reminder_log r JOIN invoices i ON i.id=r.invoice_id WHERE i.company_id<>r.company_id)
    OR EXISTS(SELECT 1 FROM reminder_log r JOIN users u ON u.id=r.sent_by WHERE u.company_id<>r.company_id)
  THEN RAISE EXCEPTION 'cross-tenant CRM/contract/tender relation detected'; END IF;
END $$;

-- Last-line service-role write guards validate tenant-linked foreign keys even
-- when a caller bypasses application checks. All normal writes must use RPCs.
CREATE OR REPLACE FUNCTION public.guard_relationship_writes()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_company UUID:=CASE WHEN TG_OP='DELETE' THEN OLD.company_id ELSE NEW.company_id END;
BEGIN
  IF current_setting('app.business_data_reset',TRUE)=v_company::TEXT THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
  IF current_setting('app.relationship_write_company',TRUE) IS DISTINCT FROM v_company::TEXT THEN RAISE EXCEPTION 'relationship records require lifecycle functions'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF TG_OP='UPDATE' AND NEW.company_id IS DISTINCT FROM OLD.company_id THEN RAISE EXCEPTION 'relationship tenant cannot change'; END IF;
  IF TG_TABLE_NAME='crm_contacts' THEN
    IF NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.assigned_to AND company_id=NEW.company_id AND is_active=TRUE)
      OR (NEW.created_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.created_by AND company_id=NEW.company_id))
    THEN RAISE EXCEPTION 'invalid CRM tenant link'; END IF;
  ELSIF TG_TABLE_NAME='crm_followups' THEN
    IF NOT EXISTS(SELECT 1 FROM crm_contacts WHERE id=NEW.crm_contact_id AND company_id=NEW.company_id)
      OR (NEW.created_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.created_by AND company_id=NEW.company_id))
    THEN RAISE EXCEPTION 'invalid CRM follow-up tenant link'; END IF;
  ELSIF TG_TABLE_NAME='contracts' THEN
    IF (NEW.project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND company_id=NEW.company_id))
      OR (NEW.contact_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM contacts WHERE id=NEW.contact_id AND company_id=NEW.company_id))
      OR (NEW.created_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.created_by AND company_id=NEW.company_id))
    THEN RAISE EXCEPTION 'invalid contract tenant link'; END IF;
  ELSIF TG_TABLE_NAME='contract_documents' THEN
    IF NOT EXISTS(SELECT 1 FROM contracts WHERE id=NEW.contract_id AND company_id=NEW.company_id)
      OR (NEW.uploaded_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.uploaded_by AND company_id=NEW.company_id))
    THEN RAISE EXCEPTION 'invalid contract document tenant link'; END IF;
  ELSIF TG_TABLE_NAME='tenders' THEN
    IF (NEW.contact_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM contacts WHERE id=NEW.contact_id AND company_id=NEW.company_id))
      OR (NEW.project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND company_id=NEW.company_id))
      OR (NEW.created_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.created_by AND company_id=NEW.company_id))
    THEN RAISE EXCEPTION 'invalid tender tenant link'; END IF;
  ELSIF TG_TABLE_NAME='tender_cost_items' THEN
    IF NOT EXISTS(SELECT 1 FROM tenders WHERE id=NEW.tender_id AND company_id=NEW.company_id)
      OR (NEW.created_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.created_by AND company_id=NEW.company_id))
    THEN RAISE EXCEPTION 'invalid tender cost tenant link'; END IF;
  ELSIF TG_TABLE_NAME='bonds' THEN
    IF (NEW.project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND company_id=NEW.company_id))
      OR (NEW.tender_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM tenders WHERE id=NEW.tender_id AND company_id=NEW.company_id))
      OR (NEW.contact_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM contacts WHERE id=NEW.contact_id AND company_id=NEW.company_id))
      OR (NEW.bank_safe_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM banks_safes WHERE id=NEW.bank_safe_id AND company_id=NEW.company_id))
      OR (NEW.created_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.created_by AND company_id=NEW.company_id))
    THEN RAISE EXCEPTION 'invalid bond tenant link'; END IF;
  ELSIF TG_TABLE_NAME='project_tasks' THEN
    IF NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND company_id=NEW.company_id)
      OR (NEW.parent_task_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM project_tasks WHERE id=NEW.parent_task_id AND company_id=NEW.company_id AND project_id=NEW.project_id))
      OR (NEW.assigned_to IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.assigned_to AND company_id=NEW.company_id AND is_active=TRUE))
      OR (NEW.created_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.created_by AND company_id=NEW.company_id))
    THEN RAISE EXCEPTION 'invalid project task tenant link'; END IF;
  ELSIF TG_TABLE_NAME='reminder_log' THEN
    IF (NEW.invoice_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM invoices WHERE id=NEW.invoice_id AND company_id=NEW.company_id))
      OR (NEW.sent_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.sent_by AND company_id=NEW.company_id))
    THEN RAISE EXCEPTION 'invalid reminder tenant link'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

DO $$ DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['crm_contacts','crm_followups','contracts','contract_documents','tenders','tender_cost_items','bonds','project_tasks','reminder_log'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_guard_relationship_writes ON %I',t);
    EXECUTE format('CREATE TRIGGER trg_guard_relationship_writes BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION guard_relationship_writes()',t);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.assert_relationship_actor(UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.assert_relationship_payload(JSONB,TEXT[]) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guard_relationship_writes() FROM PUBLIC,anon,authenticated;
DO $$ DECLARE signature TEXT;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'create_crm_contact_atomic(UUID,JSONB,UUID)','update_crm_contact_atomic(UUID,UUID,JSONB,UUID)','delete_crm_contact_atomic(UUID,UUID,UUID)',
    'create_crm_followup_atomic(UUID,UUID,JSONB,UUID)','create_contract_atomic(UUID,JSONB,UUID)','update_contract_atomic(UUID,UUID,JSONB,UUID)',
    'delete_draft_contract_atomic(UUID,UUID,UUID)','create_contract_document_atomic(UUID,UUID,TEXT,TEXT,TEXT,INTEGER,TEXT,UUID)',
    'create_tender_atomic(UUID,JSONB,UUID)','update_tender_atomic(UUID,UUID,JSONB,UUID)','transition_tender_atomic(UUID,UUID,TEXT,TEXT,UUID)',
    'create_tender_cost_item_atomic(UUID,UUID,JSONB,UUID)','delete_draft_tender_atomic(UUID,UUID,UUID)','convert_won_tender_to_project_atomic(UUID,UUID,UUID)',
    'create_bond_atomic(UUID,JSONB,UUID)','update_bond_atomic(UUID,UUID,JSONB,UUID)','transition_bond_atomic(UUID,UUID,TEXT,TEXT,UUID)','get_bond_summary(UUID)',
    'create_project_task_atomic(UUID,JSONB,UUID)','update_project_task_atomic(UUID,UUID,JSONB,UUID)','delete_unstarted_project_task_atomic(UUID,UUID,UUID)',
    'begin_invoice_reminder_attempt_atomic(UUID,UUID,UUID)','finish_invoice_reminder_attempt_atomic(UUID,UUID,UUID,BOOLEAN,TEXT,TEXT)'
  ] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION public.'||signature||' FROM PUBLIC,anon,authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.'||signature||' TO service_role';
  END LOOP;
END $$;

COMMIT;
