-- ============================================================================
-- 073: Project is a reference record — it must never auto-create an invoice
--
-- Business rule (requested): creating a project must NOT create an invoice,
-- must NOT post a journal entry, and must NOT affect the client's balance.
-- The client link on the project is reference-only (for reviewing a client's
-- projects). Invoices are created manually and can be derived from the
-- project; only invoices move the client balance.
--
-- The previous create_project_atomic accepted p_auto_invoice and, when true,
-- created a sales invoice (and effectively touched the client). We remove
-- that path entirely while keeping the function signature stable so existing
-- callers and the wrapper continue to work.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_project_atomic(
  p_company_id UUID,p_name TEXT,p_client_id UUID,p_contract_value NUMERIC,
  p_start_date DATE,p_end_date DATE,p_status TEXT,p_description TEXT,p_location TEXT,
  p_items JSONB,p_auto_invoice BOOLEAN,p_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_project projects%ROWTYPE;
  v_client UUID:=p_client_id;
  v_contact contacts%ROWTYPE;
  v_item JSONB;
  v_qty NUMERIC;
  v_price NUMERIC;
  v_items_total NUMERIC:=0;
BEGIN
  IF NULLIF(btrim(p_name),'') IS NULL OR length(p_name)>300 OR p_contract_value<=0
    OR p_start_date IS NULL OR (p_end_date IS NOT NULL AND p_end_date<p_start_date)
    OR p_status NOT IN ('active','on_hold') OR jsonb_typeof(p_items)<>'array'
    OR jsonb_array_length(p_items)>1000 OR length(COALESCE(p_description,''))>5000
    OR length(COALESCE(p_location,''))>1000
  THEN RAISE EXCEPTION 'بيانات المشروع غير صالحة'; END IF;
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  PERFORM set_config('app.project_write_company',p_company_id::TEXT,TRUE);

  IF v_client IS NULL THEN
    -- A project without a chosen client stays reference-only (no cash-customer
    -- auto-creation, no invoice). The client link is optional for projects.
    v_client:=NULL;
  ELSIF NOT EXISTS(
    SELECT 1 FROM contacts WHERE id=v_client AND company_id=p_company_id AND COALESCE(is_active,TRUE)
  ) THEN RAISE EXCEPTION 'العميل غير موجود'; END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    BEGIN v_qty:=(v_item->>'quantity')::NUMERIC; v_price:=(v_item->>'unit_price')::NUMERIC;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'بند جدول كميات غير صالح'; END;
    IF NULLIF(btrim(v_item->>'description'),'') IS NULL OR v_qty<=0 OR v_price<0
    THEN RAISE EXCEPTION 'بند جدول كميات غير صالح'; END IF;
    v_items_total:=v_items_total+round(v_qty*v_price,2);
  END LOOP;
  IF jsonb_array_length(p_items)>0 AND abs(v_items_total-p_contract_value)>0.01 THEN
    RAISE EXCEPTION 'قيمة العقد لا تطابق إجمالي جدول الكميات';
  END IF;

  INSERT INTO projects(
    company_id,name,client_id,contract_value,start_date,end_date,status,
    description,location,created_by
  ) VALUES(
    p_company_id,btrim(p_name),v_client,p_contract_value,p_start_date,p_end_date,
    p_status,NULLIF(btrim(p_description),''),NULLIF(btrim(p_location),''),p_user_id
  ) RETURNING * INTO v_project;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_qty:=(v_item->>'quantity')::NUMERIC; v_price:=(v_item->>'unit_price')::NUMERIC;
    INSERT INTO boq_items(company_id,project_id,description,unit,quantity,unit_price,total)
    VALUES(p_company_id,v_project.id,btrim(v_item->>'description'),COALESCE(NULLIF(btrim(v_item->>'unit'),''),'واحدة'),v_qty,v_price,round(v_qty*v_price,2));
  END LOOP;

  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'create','project',v_project.id,to_jsonb(v_project));
  RETURN to_jsonb(v_project)||jsonb_build_object(
    'invoice',NULL,
    'boq_items_count',jsonb_array_length(p_items)
  );
END;
$$;
