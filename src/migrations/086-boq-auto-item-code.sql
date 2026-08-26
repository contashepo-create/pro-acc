-- ============================================================================
-- 086: Auto-generate BOQ item codes (BOQ-0001, BOQ-0002, ...) per project.
--
-- The standalone بنود الكميات (BOQ) section previously required a manual
-- item code, which was annoying and error-prone. This migration makes the
-- code optional: when the caller sends no (or a blank) code, the database
-- generates a project-scoped sequential code like BOQ-0001.
--
-- Sequence is computed from the largest numeric suffix already present among
-- the project's items, guarded by an advisory lock so concurrent inserts do
-- not collide. A caller-supplied non-blank code is still honoured and still
-- validated for uniqueness per project.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_boq_item_atomic(
  p_company_id UUID,p_project_id UUID,p_item_code TEXT,p_description TEXT,p_unit TEXT,
  p_quantity NUMERIC,p_unit_price NUMERIC,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_project projects%ROWTYPE; v_item boq_items%ROWTYPE; v_code TEXT; v_seq INTEGER;
BEGIN
  PERFORM assert_project_actor(p_company_id,p_user_id);
  IF NULLIF(BTRIM(p_description),'') IS NULL OR LENGTH(p_description)>1000
    OR NULLIF(BTRIM(p_unit),'') IS NULL OR LENGTH(p_unit)>40
    OR p_quantity<=0 OR p_quantity<>ROUND(p_quantity,2) OR p_unit_price<0 OR p_unit_price<>ROUND(p_unit_price,2)
  THEN RAISE EXCEPTION 'بيانات بند المقايسة غير صالحة'; END IF;
  SELECT * INTO v_project FROM projects WHERE id=p_project_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المشروع غير موجود'; END IF;
  IF v_project.status IN('completed','cancelled') THEN RAISE EXCEPTION 'المشروع مغلق'; END IF;

  -- Auto-generate a project-scoped code when none was supplied.
  v_code := COALESCE(NULLIF(BTRIM(p_item_code),''),'');
  IF v_code = '' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_company_id::TEXT||':boq-code:'||p_project_id::TEXT,0));
    SELECT COALESCE(MAX((regexp_match(COALESCE(item_code,code,''),'([0-9]+)$'))[1]::INTEGER),0)+1
      INTO v_seq FROM boq_items
      WHERE company_id=p_company_id AND project_id=p_project_id
        AND COALESCE(item_code,code,'') ~ '[0-9]+$';
    v_code := 'BOQ-'||LPAD(v_seq::TEXT,4,'0');
  END IF;
  IF NULLIF(v_code,'') IS NULL OR LENGTH(v_code)>80 THEN RAISE EXCEPTION 'بيانات بند المقايسة غير صالحة'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_company_id::TEXT||':boq:'||p_project_id::TEXT||':'||LOWER(v_code),0));
  IF EXISTS(SELECT 1 FROM boq_items WHERE company_id=p_company_id AND project_id=p_project_id
    AND LOWER(COALESCE(item_code,code,''))=LOWER(v_code)) THEN RAISE EXCEPTION 'كود البند مستخدم'; END IF;
  PERFORM set_config('app.project_write_company',p_company_id::TEXT,TRUE);
  INSERT INTO boq_items(company_id,project_id,item_code,code,description,unit,quantity,unit_price,total)
  VALUES(p_company_id,p_project_id,BTRIM(v_code),BTRIM(v_code),BTRIM(p_description),BTRIM(p_unit),
    p_quantity,p_unit_price,ROUND(p_quantity*p_unit_price,2)) RETURNING * INTO v_item;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'create','boq_item',v_item.id,to_jsonb(v_item));
  RETURN to_jsonb(v_item);
END;
$$;

-- Keep a blank code in an update from wiping an existing one; the item keeps
-- its previously generated (or manually assigned) code.
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
  v_code:=CASE WHEN p_patch?'item_code' THEN NULLIF(BTRIM(p_patch->>'item_code'),'') ELSE COALESCE(v_old.item_code,v_old.code) END;
  IF v_code IS NULL THEN v_code:=COALESCE(v_old.item_code,v_old.code); END IF;
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

-- Re-assert the security-grant posture so the updated functions stay
-- service_role-only, consistent with 058's privilege table.
DO $$
DECLARE sig TEXT;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'create_boq_item_atomic(uuid,uuid,text,text,text,numeric,numeric,uuid)'::REGPROCEDURE,
    'update_boq_item_atomic(uuid,uuid,jsonb,uuid)'::REGPROCEDURE
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',sig);
  END LOOP;
END $$;
