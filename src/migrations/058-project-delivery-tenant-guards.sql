-- 058 - Project planning, billing, expense, equipment, and labour boundaries.
BEGIN;

ALTER TABLE daily_workers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER FUNCTION public.create_project_atomic(UUID,TEXT,UUID,NUMERIC,DATE,DATE,TEXT,TEXT,TEXT,JSONB,BOOLEAN,UUID)
  RENAME TO create_project_atomic_v50_internal;
ALTER FUNCTION public.convert_quotation_atomic(UUID,UUID,TEXT,DATE,DATE,UUID)
  RENAME TO convert_quotation_atomic_v50_internal;
ALTER FUNCTION public.update_project_atomic(UUID,UUID,JSONB,JSONB,UUID)
  RENAME TO update_project_atomic_v50_internal;
ALTER FUNCTION public.cancel_empty_project_atomic(UUID,UUID,UUID)
  RENAME TO cancel_empty_project_atomic_v50_internal;
ALTER FUNCTION public.close_project(UUID,UUID,DATE,TEXT,UUID)
  RENAME TO close_project_v49_internal;
ALTER FUNCTION public.create_progress_billing_atomic(UUID,UUID,DATE,TEXT,TEXT,NUMERIC,NUMERIC,NUMERIC,BOOLEAN,UUID)
  RENAME TO create_progress_billing_atomic_v50_internal;
ALTER FUNCTION public.update_progress_billing_metadata(UUID,UUID,TEXT,TEXT,BOOLEAN,UUID)
  RENAME TO update_progress_billing_metadata_v50_internal;
ALTER FUNCTION public.cancel_progress_billing_atomic(UUID,UUID,UUID)
  RENAME TO cancel_progress_billing_atomic_v50_internal;
ALTER FUNCTION public.post_project_expense(UUID,UUID,TEXT,TEXT,NUMERIC,DATE,UUID,UUID,UUID,TEXT,NUMERIC,UUID)
  RENAME TO post_project_expense_v49_internal;
ALTER FUNCTION public.cancel_project_expense(UUID,UUID,UUID)
  RENAME TO cancel_project_expense_v49_internal;
ALTER FUNCTION public.post_equipment_cost(UUID,UUID,UUID,DATE,TEXT,NUMERIC,NUMERIC,TEXT,UUID,UUID,UUID)
  RENAME TO post_equipment_cost_v49_internal;

CREATE OR REPLACE FUNCTION public.assert_project_actor(p_company_id UUID,p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_project_atomic(
  p_company_id UUID,p_name TEXT,p_client_id UUID,p_contract_value NUMERIC,
  p_start_date DATE,p_end_date DATE,p_status TEXT,p_description TEXT,p_location TEXT,
  p_items JSONB,p_auto_invoice BOOLEAN,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM assert_project_actor(p_company_id,p_user_id);
  PERFORM set_config('app.project_write_company',p_company_id::TEXT,TRUE);
  RETURN create_project_atomic_v50_internal(p_company_id,p_name,p_client_id,p_contract_value,p_start_date,
    p_end_date,p_status,p_description,p_location,p_items,p_auto_invoice,p_user_id);
END;
$$;
CREATE OR REPLACE FUNCTION public.convert_quotation_atomic(
  p_company_id UUID,p_quotation_id UUID,p_project_name TEXT,p_start_date DATE,p_end_date DATE,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM assert_project_actor(p_company_id,p_user_id);
  PERFORM set_config('app.project_write_company',p_company_id::TEXT,TRUE);
  RETURN convert_quotation_atomic_v50_internal(p_company_id,p_quotation_id,p_project_name,p_start_date,p_end_date,p_user_id);
END;
$$;
CREATE OR REPLACE FUNCTION public.update_project_atomic(
  p_company_id UUID,p_project_id UUID,p_payload JSONB,p_items JSONB,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM assert_project_actor(p_company_id,p_user_id);
  PERFORM set_config('app.project_write_company',p_company_id::TEXT,TRUE);
  RETURN update_project_atomic_v50_internal(p_company_id,p_project_id,p_payload,p_items,p_user_id);
END;
$$;
CREATE OR REPLACE FUNCTION public.cancel_empty_project_atomic(
  p_company_id UUID,p_project_id UUID,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM assert_project_actor(p_company_id,p_user_id);
  PERFORM set_config('app.project_write_company',p_company_id::TEXT,TRUE);
  RETURN cancel_empty_project_atomic_v50_internal(p_company_id,p_project_id,p_user_id);
END;
$$;
CREATE OR REPLACE FUNCTION public.close_project(
  p_company_id UUID,p_project_id UUID,p_close_date DATE,p_notes TEXT,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM assert_project_actor(p_company_id,p_user_id);
  PERFORM set_config('app.project_write_company',p_company_id::TEXT,TRUE);
  RETURN close_project_v49_internal(p_company_id,p_project_id,p_close_date,p_notes,p_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_progress_billing_atomic(
  p_company_id UUID,p_project_id UUID,p_date DATE,p_claim_number TEXT,p_description TEXT,
  p_gross_amount NUMERIC,p_retention_rate NUMERIC,p_tax_rate NUMERIC,p_is_final BOOLEAN,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM assert_project_actor(p_company_id,p_user_id);
  PERFORM set_config('app.project_write_company',p_company_id::TEXT,TRUE);
  RETURN create_progress_billing_atomic_v50_internal(p_company_id,p_project_id,p_date,p_claim_number,
    p_description,p_gross_amount,p_retention_rate,p_tax_rate,p_is_final,p_user_id);
END;
$$;
CREATE OR REPLACE FUNCTION public.update_progress_billing_metadata(
  p_company_id UUID,p_claim_id UUID,p_claim_number TEXT,p_description TEXT,p_is_final BOOLEAN,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM assert_project_actor(p_company_id,p_user_id);
  PERFORM set_config('app.project_write_company',p_company_id::TEXT,TRUE);
  RETURN update_progress_billing_metadata_v50_internal(p_company_id,p_claim_id,p_claim_number,p_description,p_is_final,p_user_id);
END;
$$;
CREATE OR REPLACE FUNCTION public.cancel_progress_billing_atomic(
  p_company_id UUID,p_claim_id UUID,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM assert_project_actor(p_company_id,p_user_id);
  PERFORM set_config('app.project_write_company',p_company_id::TEXT,TRUE);
  RETURN cancel_progress_billing_atomic_v50_internal(p_company_id,p_claim_id,p_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.post_project_expense(
  p_company_id UUID,p_project_id UUID,p_expense_type TEXT,p_description TEXT,p_amount NUMERIC,
  p_date DATE,p_contact_id UUID,p_bank_safe_id UUID,p_expense_account_id UUID,p_notes TEXT,
  p_tax_rate NUMERIC,p_created_by UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_result JSONB;
BEGIN
  PERFORM assert_project_actor(p_company_id,p_created_by);
  PERFORM set_config('app.project_write_company',p_company_id::TEXT,TRUE);
  v_result:=post_project_expense_v49_internal(p_company_id,p_project_id,p_expense_type,p_description,
    p_amount,p_date,p_contact_id,p_bank_safe_id,p_expense_account_id,p_notes,p_tax_rate,p_created_by);
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_created_by,'post','project_expense',(v_result->>'id')::UUID,v_result);
  RETURN v_result;
END;
$$;
CREATE OR REPLACE FUNCTION public.cancel_project_expense(
  p_company_id UUID,p_expense_id UUID,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_result JSONB; v_old project_expenses%ROWTYPE; v_new project_expenses%ROWTYPE;
BEGIN
  PERFORM assert_project_actor(p_company_id,p_user_id);
  SELECT * INTO v_old FROM project_expenses WHERE id=p_expense_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المصروف غير موجود'; END IF;
  IF v_old.status='rejected' THEN RETURN jsonb_build_object('id',p_expense_id,'status','rejected','already_processed',TRUE); END IF;
  PERFORM set_config('app.project_write_company',p_company_id::TEXT,TRUE);
  IF v_old.journal_entry_id IS NULL THEN
    IF v_old.status<>'draft' THEN RAISE EXCEPTION 'لا يمكن إلغاء مصروف دخل دورة الموافقة'; END IF;
    UPDATE project_expenses SET status='rejected',updated_at=NOW() WHERE id=p_expense_id RETURNING * INTO v_new;
    v_result:=to_jsonb(v_new)||jsonb_build_object('cancelled',TRUE);
  ELSE
    v_result:=cancel_project_expense_v49_internal(p_company_id,p_expense_id,p_user_id);
  END IF;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'cancel','project_expense',p_expense_id,to_jsonb(v_old),v_result);
  RETURN v_result;
END;
$$;
CREATE OR REPLACE FUNCTION public.update_project_expense_note_atomic(
  p_company_id UUID,p_expense_id UUID,p_notes TEXT,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old project_expenses%ROWTYPE; v_new project_expenses%ROWTYPE;
BEGIN
  PERFORM assert_project_actor(p_company_id,p_user_id);
  IF LENGTH(COALESCE(p_notes,''))>2000 THEN RAISE EXCEPTION 'الملاحظات غير صالحة'; END IF;
  SELECT * INTO v_old FROM project_expenses WHERE id=p_expense_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المصروف غير موجود'; END IF;
  IF v_old.status='rejected' THEN RAISE EXCEPTION 'المصروف ملغى'; END IF;
  PERFORM set_config('app.project_write_company',p_company_id::TEXT,TRUE);
  UPDATE project_expenses SET notes=NULLIF(BTRIM(p_notes),''),updated_at=NOW()
  WHERE id=p_expense_id RETURNING * INTO v_new;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'update','project_expense',p_expense_id,to_jsonb(v_old),to_jsonb(v_new));
  RETURN to_jsonb(v_new);
END;
$$;

CREATE OR REPLACE FUNCTION public.post_equipment_cost(
  p_company_id UUID,p_equipment_id UUID,p_project_id UUID,p_date DATE,p_cost_type TEXT,p_amount NUMERIC,
  p_usage_hours NUMERIC,p_notes TEXT,p_expense_account_id UUID,p_payment_account_id UUID,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM assert_project_actor(p_company_id,p_user_id);
  PERFORM set_config('app.project_write_company',p_company_id::TEXT,TRUE);
  RETURN post_equipment_cost_v49_internal(p_company_id,p_equipment_id,p_project_id,p_date,p_cost_type,
    p_amount,p_usage_hours,p_notes,p_expense_account_id,p_payment_account_id,p_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_boq_item_atomic(
  p_company_id UUID,p_project_id UUID,p_item_code TEXT,p_description TEXT,p_unit TEXT,
  p_quantity NUMERIC,p_unit_price NUMERIC,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_project projects%ROWTYPE; v_item boq_items%ROWTYPE;
BEGIN
  PERFORM assert_project_actor(p_company_id,p_user_id);
  IF NULLIF(BTRIM(p_item_code),'') IS NULL OR LENGTH(p_item_code)>80
    OR NULLIF(BTRIM(p_description),'') IS NULL OR LENGTH(p_description)>1000
    OR NULLIF(BTRIM(p_unit),'') IS NULL OR LENGTH(p_unit)>40
    OR p_quantity<=0 OR p_quantity<>ROUND(p_quantity,2) OR p_unit_price<0 OR p_unit_price<>ROUND(p_unit_price,2)
  THEN RAISE EXCEPTION 'بيانات بند المقايسة غير صالحة'; END IF;
  SELECT * INTO v_project FROM projects WHERE id=p_project_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المشروع غير موجود'; END IF;
  IF v_project.status IN('completed','cancelled') THEN RAISE EXCEPTION 'المشروع مغلق'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_company_id::TEXT||':boq:'||p_project_id::TEXT||':'||LOWER(BTRIM(p_item_code)),0));
  IF EXISTS(SELECT 1 FROM boq_items WHERE company_id=p_company_id AND project_id=p_project_id
    AND LOWER(COALESCE(item_code,code,''))=LOWER(BTRIM(p_item_code))) THEN RAISE EXCEPTION 'كود البند مستخدم'; END IF;
  PERFORM set_config('app.project_write_company',p_company_id::TEXT,TRUE);
  INSERT INTO boq_items(company_id,project_id,item_code,code,description,unit,quantity,unit_price,total)
  VALUES(p_company_id,p_project_id,BTRIM(p_item_code),BTRIM(p_item_code),BTRIM(p_description),BTRIM(p_unit),
    p_quantity,p_unit_price,ROUND(p_quantity*p_unit_price,2)) RETURNING * INTO v_item;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'create','boq_item',v_item.id,to_jsonb(v_item));
  RETURN to_jsonb(v_item);
END;
$$;
CREATE OR REPLACE FUNCTION public.update_boq_item_atomic(
  p_company_id UUID,p_item_id UUID,p_patch JSONB,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old boq_items%ROWTYPE; v_new boq_items%ROWTYPE; v_code TEXT; v_description TEXT; v_unit TEXT; v_qty NUMERIC; v_price NUMERIC;
BEGIN
  PERFORM assert_project_actor(p_company_id,p_user_id);
  IF p_patch IS NULL OR jsonb_typeof(p_patch)<>'object' OR p_patch='{}'::JSONB OR EXISTS(
    SELECT 1 FROM jsonb_object_keys(p_patch) key WHERE key NOT IN('item_code','description','unit','quantity','unit_price')
  ) THEN RAISE EXCEPTION 'بيانات بند المقايسة غير صالحة'; END IF;
  SELECT b.* INTO v_old FROM boq_items b JOIN projects p ON p.id=b.project_id AND p.company_id=b.company_id
    WHERE b.id=p_item_id AND b.company_id=p_company_id AND p.status NOT IN('completed','cancelled') FOR UPDATE OF b;
  IF NOT FOUND THEN RAISE EXCEPTION 'بند المقايسة غير موجود أو المشروع مغلق'; END IF;
  BEGIN
    v_qty:=CASE WHEN p_patch?'quantity' THEN (p_patch->>'quantity')::NUMERIC ELSE v_old.quantity END;
    v_price:=CASE WHEN p_patch?'unit_price' THEN (p_patch->>'unit_price')::NUMERIC ELSE v_old.unit_price END;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'الكمية أو السعر غير صالح'; END;
  v_code:=CASE WHEN p_patch?'item_code' THEN BTRIM(p_patch->>'item_code') ELSE COALESCE(v_old.item_code,v_old.code) END;
  v_description:=CASE WHEN p_patch?'description' THEN BTRIM(p_patch->>'description') ELSE v_old.description END;
  v_unit:=CASE WHEN p_patch?'unit' THEN BTRIM(p_patch->>'unit') ELSE v_old.unit END;
  IF NULLIF(v_code,'') IS NULL OR LENGTH(v_code)>80 OR NULLIF(v_description,'') IS NULL OR LENGTH(v_description)>1000
    OR NULLIF(v_unit,'') IS NULL OR LENGTH(v_unit)>40 OR v_qty<=0 OR v_qty<>ROUND(v_qty,2) OR v_price<0 OR v_price<>ROUND(v_price,2)
  THEN RAISE EXCEPTION 'بيانات بند المقايسة غير صالحة'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_company_id::TEXT||':boq:'||v_old.project_id::TEXT||':'||LOWER(v_code),0));
  IF EXISTS(SELECT 1 FROM boq_items WHERE company_id=p_company_id AND project_id=v_old.project_id AND id<>p_item_id
    AND LOWER(COALESCE(item_code,code,''))=LOWER(v_code)) THEN RAISE EXCEPTION 'كود البند مستخدم'; END IF;
  PERFORM set_config('app.project_write_company',p_company_id::TEXT,TRUE);
  UPDATE boq_items SET item_code=v_code,code=v_code,description=v_description,unit=v_unit,
    quantity=v_qty,unit_price=v_price,total=ROUND(v_qty*v_price,2) WHERE id=p_item_id RETURNING * INTO v_new;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'update','boq_item',p_item_id,to_jsonb(v_old),to_jsonb(v_new));
  RETURN to_jsonb(v_new);
END;
$$;
CREATE OR REPLACE FUNCTION public.delete_boq_item_atomic(
  p_company_id UUID,p_item_id UUID,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old boq_items%ROWTYPE; v_status TEXT;
BEGIN
  PERFORM assert_project_actor(p_company_id,p_user_id);
  SELECT * INTO v_old FROM boq_items WHERE id=p_item_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'بند المقايسة غير موجود'; END IF;
  SELECT status INTO v_status FROM projects WHERE id=v_old.project_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND OR v_status IN('completed','cancelled') THEN RAISE EXCEPTION 'المشروع مغلق'; END IF;
  IF EXISTS(SELECT 1 FROM boq_items WHERE parent_id=p_item_id AND company_id=p_company_id)
    OR EXISTS(SELECT 1 FROM progress_claim_items WHERE boq_item_id=p_item_id AND company_id=p_company_id)
  THEN RAISE EXCEPTION 'لا يمكن حذف بند مستخدم'; END IF;
  PERFORM set_config('app.project_write_company',p_company_id::TEXT,TRUE);
  DELETE FROM boq_items WHERE id=p_item_id;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values)
  VALUES(p_company_id,p_user_id,'delete','boq_item',p_item_id,to_jsonb(v_old));
  RETURN jsonb_build_object('id',p_item_id,'deleted',TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_change_order_atomic(
  p_company_id UUID,p_project_id UUID,p_title TEXT,p_description TEXT,p_change_amount NUMERIC,p_status TEXT,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_project projects%ROWTYPE; v_order change_orders%ROWTYPE; v_base NUMERIC; v_number TEXT; v_seq INTEGER;
BEGIN
  PERFORM assert_project_actor(p_company_id,p_user_id);
  IF NULLIF(BTRIM(p_title),'') IS NULL OR LENGTH(p_title)>300 OR LENGTH(COALESCE(p_description,''))>1000
    OR p_change_amount IS NULL OR p_change_amount<>ROUND(p_change_amount,2) OR p_status NOT IN('draft','submitted')
  THEN RAISE EXCEPTION 'بيانات أمر التغيير غير صالحة'; END IF;
  SELECT * INTO v_project FROM projects WHERE id=p_project_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND OR v_project.status<>'active' THEN RAISE EXCEPTION 'المشروع غير صالح أو مغلق'; END IF;
  SELECT v_project.contract_value+COALESCE(SUM(change_amount) FILTER(WHERE status IN('approved','invoiced')),0)
    INTO v_base FROM change_orders WHERE company_id=p_company_id AND project_id=p_project_id;
  IF v_base+p_change_amount<0 THEN RAISE EXCEPTION 'قيمة العقد المعدلة لا يمكن أن تكون سالبة'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_company_id::TEXT||':change-order-number',0));
  SELECT COALESCE(MAX((regexp_match(number,'([0-9]+)$'))[1]::INTEGER),0)+1 INTO v_seq
    FROM change_orders WHERE company_id=p_company_id AND number~'[0-9]+$';
  v_number:='CO-'||LPAD(v_seq::TEXT,4,'0');
  PERFORM set_config('app.project_write_company',p_company_id::TEXT,TRUE);
  INSERT INTO change_orders(company_id,project_id,number,title,description,status,change_amount,
    base_contract_amount,new_contract_amount,created_by)
  VALUES(p_company_id,p_project_id,v_number,BTRIM(p_title),NULLIF(BTRIM(p_description),''),p_status,
    p_change_amount,v_base,v_base+p_change_amount,p_user_id) RETURNING * INTO v_order;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'create','change_order',v_order.id,to_jsonb(v_order));
  RETURN to_jsonb(v_order);
END;
$$;
CREATE OR REPLACE FUNCTION public.update_change_order_atomic(
  p_company_id UUID,p_order_id UUID,p_patch JSONB,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old change_orders%ROWTYPE; v_new change_orders%ROWTYPE; v_status TEXT; v_amount NUMERIC; v_title TEXT; v_description TEXT;
BEGIN
  PERFORM assert_project_actor(p_company_id,p_user_id);
  IF p_patch IS NULL OR jsonb_typeof(p_patch)<>'object' OR p_patch='{}'::JSONB OR EXISTS(
    SELECT 1 FROM jsonb_object_keys(p_patch) key WHERE key NOT IN('title','description','change_amount','status')
  ) THEN RAISE EXCEPTION 'بيانات أمر التغيير غير صالحة'; END IF;
  SELECT co.* INTO v_old FROM change_orders co JOIN projects p ON p.id=co.project_id AND p.company_id=co.company_id
    WHERE co.id=p_order_id AND co.company_id=p_company_id AND p.status='active' FOR UPDATE OF co;
  IF NOT FOUND THEN RAISE EXCEPTION 'أمر التغيير غير موجود أو المشروع مغلق'; END IF;
  v_status:=CASE WHEN p_patch?'status' THEN p_patch->>'status' ELSE v_old.status END;
  IF NOT ((v_old.status='draft' AND v_status IN('draft','submitted','rejected'))
    OR (v_old.status='submitted' AND v_status IN('draft','submitted','approved','rejected'))
    OR (v_old.status='approved' AND v_status IN('approved','invoiced'))
    OR (v_old.status=v_status AND v_old.status IN('rejected','invoiced')))
  THEN RAISE EXCEPTION 'انتقال حالة أمر التغيير غير صالح'; END IF;
  IF v_old.status IN('approved','rejected','invoiced') AND EXISTS(
    SELECT 1 FROM jsonb_object_keys(p_patch) key WHERE key<>'status')
  THEN RAISE EXCEPTION 'لا يمكن تعديل أمر تغيير معتمد أو مغلق'; END IF;
  BEGIN v_amount:=CASE WHEN p_patch?'change_amount' THEN (p_patch->>'change_amount')::NUMERIC ELSE v_old.change_amount END;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'مبلغ أمر التغيير غير صالح'; END;
  v_title:=CASE WHEN p_patch?'title' THEN BTRIM(p_patch->>'title') ELSE v_old.title END;
  v_description:=CASE WHEN p_patch?'description' THEN NULLIF(BTRIM(p_patch->>'description'),'') ELSE v_old.description END;
  IF NULLIF(v_title,'') IS NULL OR LENGTH(v_title)>300 OR LENGTH(COALESCE(v_description,''))>1000
    OR v_amount<>ROUND(v_amount,2) OR v_old.base_contract_amount+v_amount<0
  THEN RAISE EXCEPTION 'بيانات أمر التغيير غير صالحة'; END IF;
  PERFORM set_config('app.project_write_company',p_company_id::TEXT,TRUE);
  UPDATE change_orders SET title=v_title,description=v_description,change_amount=v_amount,
    new_contract_amount=v_old.base_contract_amount+v_amount,status=v_status,
    approved_by=CASE WHEN v_status='approved' AND v_old.status<>'approved' THEN p_user_id ELSE approved_by END,
    approved_at=CASE WHEN v_status='approved' AND v_old.status<>'approved' THEN NOW() ELSE approved_at END,
    updated_at=NOW() WHERE id=p_order_id RETURNING * INTO v_new;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'update','change_order',p_order_id,to_jsonb(v_old),to_jsonb(v_new));
  RETURN to_jsonb(v_new);
END;
$$;
CREATE OR REPLACE FUNCTION public.cancel_change_order_atomic(
  p_company_id UUID,p_order_id UUID,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old change_orders%ROWTYPE; v_new change_orders%ROWTYPE;
BEGIN
  PERFORM assert_project_actor(p_company_id,p_user_id);
  SELECT * INTO v_old FROM change_orders WHERE id=p_order_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'أمر التغيير غير موجود'; END IF;
  IF v_old.status='rejected' THEN RETURN jsonb_build_object('id',p_order_id,'status','rejected','already_processed',TRUE); END IF;
  IF v_old.status NOT IN('draft','submitted') THEN RAISE EXCEPTION 'لا يمكن إلغاء أمر تغيير معتمد أو مفوتر'; END IF;
  PERFORM set_config('app.project_write_company',p_company_id::TEXT,TRUE);
  UPDATE change_orders SET status='rejected',updated_at=NOW() WHERE id=p_order_id RETURNING * INTO v_new;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'cancel','change_order',p_order_id,to_jsonb(v_old),to_jsonb(v_new));
  RETURN to_jsonb(v_new);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_equipment_atomic(p_company_id UUID,p_payload JSONB,p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_row equipment%ROWTYPE; v_project UUID; v_operator UUID; v_year INTEGER; v_cost NUMERIC; v_life INTEGER; v_rate NUMERIC; v_interval INTEGER;
BEGIN
  PERFORM assert_project_actor(p_company_id,p_user_id);
  IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) key WHERE key NOT IN(
    'name','type','model','manufacturer','year_of_manufacture','serial_number','plate_number','purchase_date','purchase_cost',
    'depreciation_method','useful_life_years','hourly_rate','assigned_project_id','assigned_operator_id','status','location','notes',
    'last_maintenance_date','maintenance_interval_days')) THEN RAISE EXCEPTION 'بيانات المعدة غير صالحة'; END IF;
  BEGIN
    v_project:=NULLIF(p_payload->>'assigned_project_id','')::UUID; v_operator:=NULLIF(p_payload->>'assigned_operator_id','')::UUID;
    v_year:=NULLIF(p_payload->>'year_of_manufacture','')::INTEGER; v_cost:=COALESCE(NULLIF(p_payload->>'purchase_cost','')::NUMERIC,0);
    v_life:=COALESCE(NULLIF(p_payload->>'useful_life_years','')::INTEGER,10); v_rate:=COALESCE(NULLIF(p_payload->>'hourly_rate','')::NUMERIC,0);
    v_interval:=COALESCE(NULLIF(p_payload->>'maintenance_interval_days','')::INTEGER,90);
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'بيانات المعدة غير صالحة'; END;
  IF NULLIF(BTRIM(p_payload->>'name'),'') IS NULL OR LENGTH(p_payload->>'name')>300
    OR NULLIF(BTRIM(p_payload->>'type'),'') IS NULL OR LENGTH(p_payload->>'type')>100
    OR v_year IS NOT NULL AND v_year NOT BETWEEN 1900 AND 2200 OR v_cost<0 OR v_cost<>ROUND(v_cost,2)
    OR v_life NOT BETWEEN 1 AND 100 OR v_rate<0 OR v_rate<>ROUND(v_rate,2) OR v_interval<1 OR v_interval>36500
    OR COALESCE(p_payload->>'depreciation_method','straight_line') NOT IN('straight_line','declining_balance','units_of_production')
    OR COALESCE(p_payload->>'status','available') NOT IN('available','in_use','maintenance')
    OR LENGTH(COALESCE(p_payload->>'notes',''))>2000 OR LENGTH(COALESCE(p_payload->>'location',''))>500
  THEN RAISE EXCEPTION 'بيانات المعدة غير صالحة'; END IF;
  IF v_project IS NOT NULL AND NOT EXISTS(SELECT 1 FROM projects WHERE id=v_project AND company_id=p_company_id AND status='active')
  THEN RAISE EXCEPTION 'المشروع غير صالح'; END IF;
  IF v_operator IS NOT NULL AND NOT EXISTS(SELECT 1 FROM employees WHERE id=v_operator AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المشغل غير صالح'; END IF;
  PERFORM set_config('app.project_write_company',p_company_id::TEXT,TRUE);
  INSERT INTO equipment(company_id,name,type,model,manufacturer,year_of_manufacture,serial_number,plate_number,
    purchase_date,purchase_cost,depreciation_method,useful_life_years,hourly_rate,assigned_project_id,
    assigned_operator_id,status,location,notes,last_maintenance_date,maintenance_interval_days,created_by)
  VALUES(p_company_id,BTRIM(p_payload->>'name'),BTRIM(p_payload->>'type'),NULLIF(BTRIM(p_payload->>'model'),''),
    NULLIF(BTRIM(p_payload->>'manufacturer'),''),v_year,NULLIF(BTRIM(p_payload->>'serial_number'),''),NULLIF(BTRIM(p_payload->>'plate_number'),''),
    NULLIF(p_payload->>'purchase_date','')::DATE,v_cost,COALESCE(p_payload->>'depreciation_method','straight_line'),v_life,v_rate,
    v_project,v_operator,COALESCE(p_payload->>'status','available'),NULLIF(BTRIM(p_payload->>'location'),''),
    NULLIF(BTRIM(p_payload->>'notes'),''),NULLIF(p_payload->>'last_maintenance_date','')::DATE,v_interval,p_user_id)
  RETURNING * INTO v_row;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'create','equipment',v_row.id,to_jsonb(v_row));
  RETURN to_jsonb(v_row);
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RAISE EXCEPTION 'تاريخ المعدة غير صالح';
END;
$$;

CREATE OR REPLACE FUNCTION public.update_equipment_atomic(p_company_id UUID,p_equipment_id UUID,p_patch JSONB,p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old equipment%ROWTYPE; v_new equipment%ROWTYPE; v_project UUID; v_operator UUID; v_year INTEGER; v_rate NUMERIC; v_interval INTEGER; v_status TEXT;
BEGIN
  PERFORM assert_project_actor(p_company_id,p_user_id);
  IF p_patch IS NULL OR jsonb_typeof(p_patch)<>'object' OR p_patch='{}'::JSONB OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_patch) key WHERE key NOT IN(
    'name','type','model','manufacturer','year_of_manufacture','serial_number','plate_number','hourly_rate','assigned_project_id',
    'assigned_operator_id','status','location','notes','last_maintenance_date','maintenance_interval_days'))
  THEN RAISE EXCEPTION 'بيانات المعدة غير صالحة'; END IF;
  SELECT * INTO v_old FROM equipment WHERE id=p_equipment_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المعدة غير موجودة'; END IF;
  IF v_old.status IN('decommissioned','sold') THEN RAISE EXCEPTION 'المعدة مستبعدة'; END IF;
  BEGIN
    v_project:=CASE WHEN p_patch?'assigned_project_id' THEN NULLIF(p_patch->>'assigned_project_id','')::UUID ELSE v_old.assigned_project_id END;
    v_operator:=CASE WHEN p_patch?'assigned_operator_id' THEN NULLIF(p_patch->>'assigned_operator_id','')::UUID ELSE v_old.assigned_operator_id END;
    v_year:=CASE WHEN p_patch?'year_of_manufacture' THEN NULLIF(p_patch->>'year_of_manufacture','')::INTEGER ELSE v_old.year_of_manufacture END;
    v_rate:=CASE WHEN p_patch?'hourly_rate' THEN (p_patch->>'hourly_rate')::NUMERIC ELSE v_old.hourly_rate END;
    v_interval:=CASE WHEN p_patch?'maintenance_interval_days' THEN (p_patch->>'maintenance_interval_days')::INTEGER ELSE v_old.maintenance_interval_days END;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'بيانات المعدة غير صالحة'; END;
  v_status:=CASE WHEN p_patch?'status' THEN p_patch->>'status' ELSE v_old.status END;
  IF p_patch?'name' AND NULLIF(BTRIM(p_patch->>'name'),'') IS NULL OR LENGTH(COALESCE(p_patch->>'name',''))>300
    OR p_patch?'type' AND NULLIF(BTRIM(p_patch->>'type'),'') IS NULL OR LENGTH(COALESCE(p_patch->>'type',''))>100
    OR v_year IS NOT NULL AND v_year NOT BETWEEN 1900 AND 2200 OR v_rate<0 OR v_rate<>ROUND(v_rate,2)
    OR v_interval<1 OR v_interval>36500 OR v_status NOT IN('available','in_use','maintenance')
    OR LENGTH(COALESCE(p_patch->>'notes',''))>2000 OR LENGTH(COALESCE(p_patch->>'location',''))>500
  THEN RAISE EXCEPTION 'بيانات المعدة غير صالحة'; END IF;
  IF v_project IS NOT NULL AND NOT EXISTS(SELECT 1 FROM projects WHERE id=v_project AND company_id=p_company_id AND status='active')
  THEN RAISE EXCEPTION 'المشروع غير صالح'; END IF;
  IF v_operator IS NOT NULL AND NOT EXISTS(SELECT 1 FROM employees WHERE id=v_operator AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المشغل غير صالح'; END IF;
  PERFORM set_config('app.project_write_company',p_company_id::TEXT,TRUE);
  UPDATE equipment SET
    name=CASE WHEN p_patch?'name' THEN BTRIM(p_patch->>'name') ELSE name END,
    type=CASE WHEN p_patch?'type' THEN BTRIM(p_patch->>'type') ELSE type END,
    model=CASE WHEN p_patch?'model' THEN NULLIF(BTRIM(p_patch->>'model'),'') ELSE model END,
    manufacturer=CASE WHEN p_patch?'manufacturer' THEN NULLIF(BTRIM(p_patch->>'manufacturer'),'') ELSE manufacturer END,
    year_of_manufacture=v_year,serial_number=CASE WHEN p_patch?'serial_number' THEN NULLIF(BTRIM(p_patch->>'serial_number'),'') ELSE serial_number END,
    plate_number=CASE WHEN p_patch?'plate_number' THEN NULLIF(BTRIM(p_patch->>'plate_number'),'') ELSE plate_number END,
    hourly_rate=v_rate,assigned_project_id=v_project,assigned_operator_id=v_operator,status=v_status,
    location=CASE WHEN p_patch?'location' THEN NULLIF(BTRIM(p_patch->>'location'),'') ELSE location END,
    notes=CASE WHEN p_patch?'notes' THEN NULLIF(BTRIM(p_patch->>'notes'),'') ELSE notes END,
    last_maintenance_date=CASE WHEN p_patch?'last_maintenance_date' THEN NULLIF(p_patch->>'last_maintenance_date','')::DATE ELSE last_maintenance_date END,
    maintenance_interval_days=v_interval,updated_at=NOW() WHERE id=p_equipment_id RETURNING * INTO v_new;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'update','equipment',p_equipment_id,to_jsonb(v_old),to_jsonb(v_new));
  RETURN to_jsonb(v_new);
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RAISE EXCEPTION 'تاريخ المعدة غير صالح';
END;
$$;

CREATE OR REPLACE FUNCTION public.decommission_equipment_atomic(p_company_id UUID,p_equipment_id UUID,p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old equipment%ROWTYPE; v_new equipment%ROWTYPE;
BEGIN
  PERFORM assert_project_actor(p_company_id,p_user_id);
  SELECT * INTO v_old FROM equipment WHERE id=p_equipment_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المعدة غير موجودة'; END IF;
  IF v_old.status='decommissioned' THEN RETURN jsonb_build_object('id',p_equipment_id,'status','decommissioned','already_processed',TRUE); END IF;
  IF v_old.status='sold' THEN RAISE EXCEPTION 'المعدة مباعة بالفعل'; END IF;
  PERFORM set_config('app.project_write_company',p_company_id::TEXT,TRUE);
  UPDATE equipment SET status='decommissioned',assigned_project_id=NULL,assigned_operator_id=NULL,updated_at=NOW()
    WHERE id=p_equipment_id RETURNING * INTO v_new;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'decommission','equipment',p_equipment_id,to_jsonb(v_old),to_jsonb(v_new));
  RETURN to_jsonb(v_new);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_equipment_maintenance_atomic(
  p_company_id UUID,p_equipment_id UUID,p_date DATE,p_type TEXT,p_description TEXT,p_cost NUMERIC,
  p_performed_by TEXT,p_next_date DATE,p_parts TEXT,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_equipment equipment%ROWTYPE; v_log equipment_maintenance%ROWTYPE;
BEGIN
  PERFORM assert_project_actor(p_company_id,p_user_id);
  IF p_date IS NULL OR p_type NOT IN('routine','repair','inspection','overhaul','emergency')
    OR NULLIF(BTRIM(p_description),'') IS NULL OR LENGTH(p_description)>2000
    OR p_cost<0 OR p_cost<>ROUND(p_cost,2) OR LENGTH(COALESCE(p_performed_by,''))>300 OR LENGTH(COALESCE(p_parts,''))>4000
    OR p_next_date IS NOT NULL AND p_next_date<p_date
  THEN RAISE EXCEPTION 'بيانات صيانة المعدة غير صالحة'; END IF;
  SELECT * INTO v_equipment FROM equipment WHERE id=p_equipment_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المعدة غير موجودة'; END IF;
  IF v_equipment.status IN('sold','decommissioned') THEN RAISE EXCEPTION 'المعدة مستبعدة'; END IF;
  PERFORM set_config('app.project_write_company',p_company_id::TEXT,TRUE);
  INSERT INTO equipment_maintenance(equipment_id,company_id,maintenance_date,type,description,cost,
    performed_by,next_maintenance_date,parts_replaced,created_by)
  VALUES(p_equipment_id,p_company_id,p_date,p_type,BTRIM(p_description),p_cost,NULLIF(BTRIM(p_performed_by),''),
    p_next_date,NULLIF(BTRIM(p_parts),''),p_user_id) RETURNING * INTO v_log;
  UPDATE equipment SET last_maintenance_date=p_date,next_maintenance_date=p_next_date,updated_at=NOW() WHERE id=p_equipment_id;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'maintenance','equipment',p_equipment_id,to_jsonb(v_log));
  RETURN to_jsonb(v_log);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_daily_worker_atomic(
  p_company_id UUID,p_name TEXT,p_phone TEXT,p_daily_wage NUMERIC,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_worker daily_workers%ROWTYPE;
BEGIN
  PERFORM assert_project_actor(p_company_id,p_user_id);
  IF NULLIF(BTRIM(p_name),'') IS NULL OR LENGTH(p_name)>200 OR LENGTH(COALESCE(p_phone,''))>50
    OR p_daily_wage<0 OR p_daily_wage<>ROUND(p_daily_wage,2) THEN RAISE EXCEPTION 'بيانات العامل غير صالحة'; END IF;
  PERFORM set_config('app.project_write_company',p_company_id::TEXT,TRUE);
  INSERT INTO daily_workers(company_id,name,phone,daily_wage,is_active)
  VALUES(p_company_id,BTRIM(p_name),NULLIF(BTRIM(p_phone),''),p_daily_wage,TRUE) RETURNING * INTO v_worker;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'create','daily_worker',v_worker.id,to_jsonb(v_worker));
  RETURN to_jsonb(v_worker);
END;
$$;
CREATE OR REPLACE FUNCTION public.update_daily_worker_atomic(
  p_company_id UUID,p_worker_id UUID,p_patch JSONB,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old daily_workers%ROWTYPE; v_new daily_workers%ROWTYPE; v_wage NUMERIC;
BEGIN
  PERFORM assert_project_actor(p_company_id,p_user_id);
  IF p_patch IS NULL OR jsonb_typeof(p_patch)<>'object' OR p_patch='{}'::JSONB OR EXISTS(
    SELECT 1 FROM jsonb_object_keys(p_patch) key WHERE key NOT IN('name','phone','daily_wage'))
  THEN RAISE EXCEPTION 'بيانات العامل غير صالحة'; END IF;
  SELECT * INTO v_old FROM daily_workers WHERE id=p_worker_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'العامل غير موجود'; END IF;
  BEGIN v_wage:=CASE WHEN p_patch?'daily_wage' THEN (p_patch->>'daily_wage')::NUMERIC ELSE v_old.daily_wage END;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'الأجر غير صالح'; END;
  IF p_patch?'name' AND NULLIF(BTRIM(p_patch->>'name'),'') IS NULL OR LENGTH(COALESCE(p_patch->>'name',''))>200
    OR LENGTH(COALESCE(p_patch->>'phone',''))>50 OR v_wage<0 OR v_wage<>ROUND(v_wage,2)
  THEN RAISE EXCEPTION 'بيانات العامل غير صالحة'; END IF;
  PERFORM set_config('app.project_write_company',p_company_id::TEXT,TRUE);
  UPDATE daily_workers SET name=CASE WHEN p_patch?'name' THEN BTRIM(p_patch->>'name') ELSE name END,
    phone=CASE WHEN p_patch?'phone' THEN NULLIF(BTRIM(p_patch->>'phone'),'') ELSE phone END,
    daily_wage=v_wage,updated_at=NOW() WHERE id=p_worker_id RETURNING * INTO v_new;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'update','daily_worker',p_worker_id,to_jsonb(v_old),to_jsonb(v_new));
  RETURN to_jsonb(v_new);
END;
$$;
CREATE OR REPLACE FUNCTION public.deactivate_daily_worker_atomic(
  p_company_id UUID,p_worker_id UUID,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old daily_workers%ROWTYPE; v_new daily_workers%ROWTYPE;
BEGIN
  PERFORM assert_project_actor(p_company_id,p_user_id);
  SELECT * INTO v_old FROM daily_workers WHERE id=p_worker_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'العامل غير موجود'; END IF;
  IF NOT v_old.is_active THEN RETURN jsonb_build_object('id',p_worker_id,'is_active',FALSE,'already_processed',TRUE); END IF;
  PERFORM set_config('app.project_write_company',p_company_id::TEXT,TRUE);
  UPDATE daily_workers SET is_active=FALSE,updated_at=NOW() WHERE id=p_worker_id RETURNING * INTO v_new;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'deactivate','daily_worker',p_worker_id,to_jsonb(v_old),to_jsonb(v_new));
  RETURN to_jsonb(v_new);
END;
$$;

-- Last-line service-role guards.
CREATE OR REPLACE FUNCTION public.guard_project_master_writes()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_company UUID:=CASE WHEN TG_OP='DELETE' THEN OLD.company_id ELSE NEW.company_id END;
BEGIN
  IF current_setting('app.business_data_reset',TRUE)=v_company::TEXT THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
  IF current_setting('app.project_write_company',TRUE) IS DISTINCT FROM v_company::TEXT THEN RAISE EXCEPTION 'project records require lifecycle functions'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF TG_OP='UPDATE' AND NEW.company_id IS DISTINCT FROM OLD.company_id THEN RAISE EXCEPTION 'project tenant cannot change'; END IF;
  IF NEW.contract_value<0 OR NEW.contract_value<>ROUND(NEW.contract_value,2) OR NULLIF(BTRIM(NEW.name),'') IS NULL
    OR (NEW.client_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM contacts WHERE id=NEW.client_id AND company_id=NEW.company_id))
    OR (NEW.created_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.created_by AND company_id=NEW.company_id))
    OR (NEW.closed_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.closed_by AND company_id=NEW.company_id))
    OR (NEW.closure_journal_entry_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM journal_entries WHERE id=NEW.closure_journal_entry_id AND company_id=NEW.company_id))
    OR (NEW.tender_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM tenders WHERE id=NEW.tender_id AND company_id=NEW.company_id))
  THEN RAISE EXCEPTION 'invalid project values or tenant link'; END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.guard_project_child_writes()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_company UUID:=CASE WHEN TG_OP='DELETE' THEN OLD.company_id ELSE NEW.company_id END;
BEGIN
  IF current_setting('app.business_data_reset',TRUE)=v_company::TEXT THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
  IF current_setting('app.project_write_company',TRUE) IS DISTINCT FROM v_company::TEXT THEN RAISE EXCEPTION 'project child records require lifecycle functions'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF TG_OP='UPDATE' AND NEW.company_id IS DISTINCT FROM OLD.company_id THEN RAISE EXCEPTION 'project child tenant cannot change'; END IF;
  IF TG_TABLE_NAME='boq_items' THEN
    IF NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND company_id=NEW.company_id)
      OR NEW.quantity<=0 OR NEW.unit_price<0 OR NEW.total<>ROUND(NEW.quantity*NEW.unit_price,2)
      OR (NEW.parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM boq_items WHERE id=NEW.parent_id AND company_id=NEW.company_id AND project_id=NEW.project_id))
    THEN RAISE EXCEPTION 'invalid BOQ item'; END IF;
  ELSIF TG_TABLE_NAME='change_orders' THEN
    IF NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND company_id=NEW.company_id)
      OR (NEW.created_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.created_by AND company_id=NEW.company_id))
      OR (NEW.approved_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.approved_by AND company_id=NEW.company_id))
      OR NEW.change_amount<>ROUND(NEW.change_amount,2) OR NEW.new_contract_amount<>NEW.base_contract_amount+NEW.change_amount
    THEN RAISE EXCEPTION 'invalid change order'; END IF;
  ELSIF TG_TABLE_NAME='project_expenses' THEN
    IF NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND company_id=NEW.company_id)
      OR (NEW.contact_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM contacts WHERE id=NEW.contact_id AND company_id=NEW.company_id))
      OR (NEW.journal_entry_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM journal_entries WHERE id=NEW.journal_entry_id AND company_id=NEW.company_id))
      OR (NEW.created_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.created_by AND company_id=NEW.company_id))
      OR NEW.amount<=0 OR NEW.amount<>ROUND(NEW.amount,2)
    THEN RAISE EXCEPTION 'invalid project expense'; END IF;
  ELSIF TG_TABLE_NAME='progress_billing' THEN
    IF NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND company_id=NEW.company_id)
      OR (NEW.journal_entry_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM journal_entries WHERE id=NEW.journal_entry_id AND company_id=NEW.company_id))
      OR (NEW.created_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.created_by AND company_id=NEW.company_id))
      OR NEW.gross_amount<=0 OR NEW.net_amount<0
    THEN RAISE EXCEPTION 'invalid progress billing'; END IF;
  ELSIF TG_TABLE_NAME='equipment_costs' THEN
    IF (NEW.project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND company_id=NEW.company_id))
      OR (NEW.equipment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM fixed_assets WHERE id=NEW.equipment_id AND company_id=NEW.company_id))
      OR (NEW.expense_account_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM accounts WHERE id=NEW.expense_account_id AND company_id=NEW.company_id))
      OR (NEW.payment_account_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM accounts WHERE id=NEW.payment_account_id AND company_id=NEW.company_id))
      OR (NEW.journal_entry_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM journal_entries WHERE id=NEW.journal_entry_id AND company_id=NEW.company_id))
      OR (NEW.created_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.created_by AND company_id=NEW.company_id))
    THEN RAISE EXCEPTION 'invalid equipment cost'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.guard_operational_equipment_writes()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_company UUID:=CASE WHEN TG_OP='DELETE' THEN OLD.company_id ELSE NEW.company_id END;
BEGIN
  IF current_setting('app.business_data_reset',TRUE)=v_company::TEXT THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
  IF current_setting('app.project_write_company',TRUE) IS DISTINCT FROM v_company::TEXT THEN RAISE EXCEPTION 'equipment records require lifecycle functions'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF TG_OP='UPDATE' AND NEW.company_id IS DISTINCT FROM OLD.company_id THEN RAISE EXCEPTION 'equipment tenant cannot change'; END IF;
  IF TG_TABLE_NAME='equipment' THEN
    IF (NEW.assigned_project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.assigned_project_id AND company_id=NEW.company_id))
      OR (NEW.assigned_operator_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM employees WHERE id=NEW.assigned_operator_id AND company_id=NEW.company_id))
      OR (NEW.created_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.created_by AND company_id=NEW.company_id))
      OR NEW.purchase_cost<0 OR NEW.hourly_rate<0 OR NEW.maintenance_interval_days<1
    THEN RAISE EXCEPTION 'invalid equipment values or tenant link'; END IF;
  ELSIF TG_TABLE_NAME='equipment_maintenance' THEN
    IF NOT EXISTS(SELECT 1 FROM equipment WHERE id=NEW.equipment_id AND company_id=NEW.company_id)
      OR (NEW.created_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.created_by AND company_id=NEW.company_id))
      OR NEW.cost<0
    THEN RAISE EXCEPTION 'invalid equipment maintenance'; END IF;
  ELSE
    IF NOT EXISTS(SELECT 1 FROM equipment WHERE id=NEW.equipment_id AND company_id=NEW.company_id)
      OR (NEW.project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND company_id=NEW.company_id))
      OR (NEW.operator_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM employees WHERE id=NEW.operator_id AND company_id=NEW.company_id))
      OR (NEW.created_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.created_by AND company_id=NEW.company_id))
    THEN RAISE EXCEPTION 'invalid equipment usage'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.guard_daily_worker_writes()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_company UUID:=CASE WHEN TG_OP='DELETE' THEN OLD.company_id ELSE NEW.company_id END;
BEGIN
  IF current_setting('app.business_data_reset',TRUE)=v_company::TEXT THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
  IF current_setting('app.project_write_company',TRUE) IS DISTINCT FROM v_company::TEXT THEN RAISE EXCEPTION 'daily workers require audited functions'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF TG_OP='UPDATE' AND NEW.company_id IS DISTINCT FROM OLD.company_id THEN RAISE EXCEPTION 'daily worker tenant cannot change'; END IF;
  IF NULLIF(BTRIM(NEW.name),'') IS NULL OR NEW.daily_wage<0 OR NEW.daily_wage<>ROUND(NEW.daily_wage,2)
  THEN RAISE EXCEPTION 'invalid daily worker'; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_project_master_writes ON projects;
CREATE TRIGGER trg_guard_project_master_writes BEFORE INSERT OR UPDATE OR DELETE ON projects FOR EACH ROW EXECUTE FUNCTION guard_project_master_writes();
DROP TRIGGER IF EXISTS trg_guard_boq_item_writes ON boq_items;
CREATE TRIGGER trg_guard_boq_item_writes BEFORE INSERT OR UPDATE OR DELETE ON boq_items FOR EACH ROW EXECUTE FUNCTION guard_project_child_writes();
DROP TRIGGER IF EXISTS trg_guard_change_order_writes ON change_orders;
CREATE TRIGGER trg_guard_change_order_writes BEFORE INSERT OR UPDATE OR DELETE ON change_orders FOR EACH ROW EXECUTE FUNCTION guard_project_child_writes();
DROP TRIGGER IF EXISTS trg_guard_project_expense_writes ON project_expenses;
CREATE TRIGGER trg_guard_project_expense_writes BEFORE INSERT OR UPDATE OR DELETE ON project_expenses FOR EACH ROW EXECUTE FUNCTION guard_project_child_writes();
DROP TRIGGER IF EXISTS trg_guard_progress_billing_writes ON progress_billing;
CREATE TRIGGER trg_guard_progress_billing_writes BEFORE INSERT OR UPDATE OR DELETE ON progress_billing FOR EACH ROW EXECUTE FUNCTION guard_project_child_writes();
DROP TRIGGER IF EXISTS trg_guard_equipment_cost_writes ON equipment_costs;
CREATE TRIGGER trg_guard_equipment_cost_writes BEFORE INSERT OR UPDATE OR DELETE ON equipment_costs FOR EACH ROW EXECUTE FUNCTION guard_project_child_writes();
DROP TRIGGER IF EXISTS trg_guard_equipment_writes ON equipment;
CREATE TRIGGER trg_guard_equipment_writes BEFORE INSERT OR UPDATE OR DELETE ON equipment FOR EACH ROW EXECUTE FUNCTION guard_operational_equipment_writes();
DROP TRIGGER IF EXISTS trg_guard_equipment_maintenance_writes ON equipment_maintenance;
CREATE TRIGGER trg_guard_equipment_maintenance_writes BEFORE INSERT OR UPDATE OR DELETE ON equipment_maintenance FOR EACH ROW EXECUTE FUNCTION guard_operational_equipment_writes();
DROP TRIGGER IF EXISTS trg_guard_equipment_usage_writes ON equipment_usage;
CREATE TRIGGER trg_guard_equipment_usage_writes BEFORE INSERT OR UPDATE OR DELETE ON equipment_usage FOR EACH ROW EXECUTE FUNCTION guard_operational_equipment_writes();
DROP TRIGGER IF EXISTS trg_guard_daily_worker_writes ON daily_workers;
CREATE TRIGGER trg_guard_daily_worker_writes BEFORE INSERT OR UPDATE OR DELETE ON daily_workers FOR EACH ROW EXECUTE FUNCTION guard_daily_worker_writes();

-- Public API privileges.
REVOKE ALL ON FUNCTION public.assert_project_actor(UUID,UUID) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.guard_project_master_writes() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guard_project_child_writes() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guard_operational_equipment_writes() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guard_daily_worker_writes() FROM PUBLIC,anon,authenticated;

REVOKE ALL ON FUNCTION public.create_project_atomic_v50_internal(UUID,TEXT,UUID,NUMERIC,DATE,DATE,TEXT,TEXT,TEXT,JSONB,BOOLEAN,UUID) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.convert_quotation_atomic_v50_internal(UUID,UUID,TEXT,DATE,DATE,UUID) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.update_project_atomic_v50_internal(UUID,UUID,JSONB,JSONB,UUID) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.cancel_empty_project_atomic_v50_internal(UUID,UUID,UUID) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.close_project_v49_internal(UUID,UUID,DATE,TEXT,UUID) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.create_progress_billing_atomic_v50_internal(UUID,UUID,DATE,TEXT,TEXT,NUMERIC,NUMERIC,NUMERIC,BOOLEAN,UUID) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.update_progress_billing_metadata_v50_internal(UUID,UUID,TEXT,TEXT,BOOLEAN,UUID) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.cancel_progress_billing_atomic_v50_internal(UUID,UUID,UUID) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.post_project_expense_v49_internal(UUID,UUID,TEXT,TEXT,NUMERIC,DATE,UUID,UUID,UUID,TEXT,NUMERIC,UUID) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.cancel_project_expense_v49_internal(UUID,UUID,UUID) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.post_equipment_cost_v49_internal(UUID,UUID,UUID,DATE,TEXT,NUMERIC,NUMERIC,TEXT,UUID,UUID,UUID) FROM PUBLIC,anon,authenticated,service_role;

DO $$ DECLARE sig REGPROCEDURE; BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'create_project_atomic(uuid,text,uuid,numeric,date,date,text,text,text,jsonb,boolean,uuid)'::REGPROCEDURE,
    'convert_quotation_atomic(uuid,uuid,text,date,date,uuid)'::REGPROCEDURE,
    'update_project_atomic(uuid,uuid,jsonb,jsonb,uuid)'::REGPROCEDURE,
    'cancel_empty_project_atomic(uuid,uuid,uuid)'::REGPROCEDURE,
    'close_project(uuid,uuid,date,text,uuid)'::REGPROCEDURE,
    'create_progress_billing_atomic(uuid,uuid,date,text,text,numeric,numeric,numeric,boolean,uuid)'::REGPROCEDURE,
    'update_progress_billing_metadata(uuid,uuid,text,text,boolean,uuid)'::REGPROCEDURE,
    'cancel_progress_billing_atomic(uuid,uuid,uuid)'::REGPROCEDURE,
    'post_project_expense(uuid,uuid,text,text,numeric,date,uuid,uuid,uuid,text,numeric,uuid)'::REGPROCEDURE,
    'cancel_project_expense(uuid,uuid,uuid)'::REGPROCEDURE,
    'update_project_expense_note_atomic(uuid,uuid,text,uuid)'::REGPROCEDURE,
    'post_equipment_cost(uuid,uuid,uuid,date,text,numeric,numeric,text,uuid,uuid,uuid)'::REGPROCEDURE,
    'create_boq_item_atomic(uuid,uuid,text,text,text,numeric,numeric,uuid)'::REGPROCEDURE,
    'update_boq_item_atomic(uuid,uuid,jsonb,uuid)'::REGPROCEDURE,
    'delete_boq_item_atomic(uuid,uuid,uuid)'::REGPROCEDURE,
    'create_change_order_atomic(uuid,uuid,text,text,numeric,text,uuid)'::REGPROCEDURE,
    'update_change_order_atomic(uuid,uuid,jsonb,uuid)'::REGPROCEDURE,
    'cancel_change_order_atomic(uuid,uuid,uuid)'::REGPROCEDURE,
    'create_equipment_atomic(uuid,jsonb,uuid)'::REGPROCEDURE,
    'update_equipment_atomic(uuid,uuid,jsonb,uuid)'::REGPROCEDURE,
    'decommission_equipment_atomic(uuid,uuid,uuid)'::REGPROCEDURE,
    'record_equipment_maintenance_atomic(uuid,uuid,date,text,text,numeric,text,date,text,uuid)'::REGPROCEDURE,
    'create_daily_worker_atomic(uuid,text,text,numeric,uuid)'::REGPROCEDURE,
    'update_daily_worker_atomic(uuid,uuid,jsonb,uuid)'::REGPROCEDURE,
    'deactivate_daily_worker_atomic(uuid,uuid,uuid)'::REGPROCEDURE
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',sig);
  END LOOP;
END $$;

COMMIT;
