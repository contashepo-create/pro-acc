-- ============================================================
-- 055 - Atomic purchasing, warehouse and inventory lifecycle
-- ============================================================

BEGIN;

ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS max_branches INTEGER;

-- Inventory is stored per warehouse. The bootstrap constraint accidentally
-- made a code unique across the whole company, while transfer code expected a
-- destination row with the same code.
ALTER TABLE inventory_items DROP CONSTRAINT IF EXISTS inventory_items_company_id_code_key;
CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_company_warehouse_code_uq
  ON inventory_items(company_id,warehouse_id,lower(code));
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS to_warehouse_id UUID REFERENCES warehouses(id);
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS balance_before NUMERIC(15,2);
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS balance_after NUMERIC(15,2);

CREATE OR REPLACE FUNCTION public.create_warehouse_atomic(
  p_company_id UUID,p_name TEXT,p_location TEXT,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_warehouse warehouses%ROWTYPE; v_limit INTEGER; v_count INTEGER;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  IF NULLIF(btrim(p_name),'') IS NULL OR length(p_name)>200 OR length(COALESCE(p_location,''))>300
  THEN RAISE EXCEPTION 'بيانات المستودع غير صالحة'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('warehouse-limit:'||p_company_id::TEXT,0));
  SELECT CASE
      WHEN sp.max_branches IS NOT NULL THEN sp.max_branches+COALESCE(s.extra_branches,0)
      WHEN sp.features_modules?'warehouses' OR sp.features_modules?'branches' THEN
        CASE WHEN COALESCE((sp.features_modules->>'warehouses')::BOOLEAN,FALSE)
          OR COALESCE((sp.features_modules->>'branches')::BOOLEAN,FALSE)
          THEN 1+COALESCE(s.extra_branches,0) ELSE 0 END
      ELSE NULL END
    INTO v_limit
  FROM subscriptions s LEFT JOIN subscription_plans sp ON sp.id=s.plan_id
  WHERE s.company_id=p_company_id ORDER BY s.created_at DESC LIMIT 1;
  IF v_limit IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM warehouses WHERE company_id=p_company_id AND COALESCE(is_active,TRUE);
    IF v_count>=v_limit THEN RAISE EXCEPTION 'warehouse plan limit'; END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM warehouses WHERE company_id=p_company_id AND lower(btrim(name))=lower(btrim(p_name)))
  THEN RAISE EXCEPTION 'اسم المستودع مستخدم مسبقاً'; END IF;
  INSERT INTO warehouses(company_id,name,location,is_active)
  VALUES(p_company_id,btrim(p_name),NULLIF(btrim(p_location),''),TRUE) RETURNING * INTO v_warehouse;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'create','warehouse',v_warehouse.id,to_jsonb(v_warehouse));
  RETURN to_jsonb(v_warehouse);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_warehouse_atomic(
  p_company_id UUID,p_warehouse_id UUID,p_patch JSONB,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old warehouses%ROWTYPE; v_new warehouses%ROWTYPE; v_name TEXT; v_active BOOLEAN;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch)<>'object' OR p_patch='{}'::JSONB OR EXISTS(
    SELECT 1 FROM jsonb_object_keys(p_patch) key WHERE key NOT IN('name','location','is_active')
  ) THEN RAISE EXCEPTION 'بيانات التحديث غير صالحة'; END IF;
  SELECT * INTO v_old FROM warehouses WHERE id=p_warehouse_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المستودع غير موجود'; END IF;
  v_name:=CASE WHEN p_patch?'name' THEN btrim(p_patch->>'name') ELSE v_old.name END;
  IF NULLIF(v_name,'') IS NULL OR length(v_name)>200 OR length(COALESCE(p_patch->>'location',''))>300
    OR (p_patch?'is_active' AND jsonb_typeof(p_patch->'is_active')<>'boolean')
  THEN RAISE EXCEPTION 'بيانات المستودع غير صالحة'; END IF;
  v_active:=CASE WHEN p_patch?'is_active' THEN (p_patch->>'is_active')::BOOLEAN ELSE v_old.is_active END;
  IF NOT v_active AND EXISTS(
    SELECT 1 FROM inventory_items WHERE company_id=p_company_id AND warehouse_id=p_warehouse_id
      AND abs(COALESCE(quantity,0))>0.005
  ) THEN RAISE EXCEPTION 'لا يمكن تعطيل مستودع يحتوي على رصيد'; END IF;
  IF EXISTS(SELECT 1 FROM warehouses WHERE company_id=p_company_id AND id<>p_warehouse_id
    AND lower(btrim(name))=lower(v_name)) THEN RAISE EXCEPTION 'اسم المستودع مستخدم مسبقاً'; END IF;
  UPDATE warehouses SET name=v_name,
    location=CASE WHEN p_patch?'location' THEN NULLIF(btrim(p_patch->>'location'),'') ELSE location END,
    is_active=v_active WHERE id=p_warehouse_id RETURNING * INTO v_new;
  IF NOT v_active THEN UPDATE inventory_items SET is_active=FALSE,updated_at=now()
    WHERE company_id=p_company_id AND warehouse_id=p_warehouse_id AND abs(COALESCE(quantity,0))<=0.005; END IF;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,CASE WHEN v_old.is_active AND NOT v_active THEN 'deactivate' ELSE 'update' END,
    'warehouse',p_warehouse_id,to_jsonb(v_old),to_jsonb(v_new));
  RETURN to_jsonb(v_new);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_inventory_item_atomic(
  p_company_id UUID,p_code TEXT,p_name TEXT,p_unit TEXT,p_warehouse_id UUID,p_category TEXT,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_item inventory_items%ROWTYPE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  IF NULLIF(btrim(p_code),'') IS NULL OR length(p_code)>50 OR NULLIF(btrim(p_name),'') IS NULL
    OR length(p_name)>300 OR NULLIF(btrim(p_unit),'') IS NULL OR length(p_unit)>50
    OR length(COALESCE(p_category,''))>100 THEN RAISE EXCEPTION 'بيانات الصنف غير صالحة'; END IF;
  IF NOT EXISTS(SELECT 1 FROM warehouses WHERE id=p_warehouse_id AND company_id=p_company_id AND COALESCE(is_active,TRUE))
  THEN RAISE EXCEPTION 'المستودع غير موجود'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('inventory-code:'||p_company_id::TEXT||':'||lower(btrim(p_code)),0));
  IF EXISTS(SELECT 1 FROM inventory_items WHERE company_id=p_company_id AND warehouse_id=p_warehouse_id
    AND lower(code)=lower(btrim(p_code))) THEN RAISE EXCEPTION 'كود الصنف موجود في المستودع'; END IF;
  INSERT INTO inventory_items(company_id,code,name,unit,warehouse_id,category,quantity,unit_price,is_active)
  VALUES(p_company_id,btrim(p_code),btrim(p_name),btrim(p_unit),p_warehouse_id,NULLIF(btrim(p_category),''),0,0,TRUE)
  RETURNING * INTO v_item;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'create','inventory_item',v_item.id,to_jsonb(v_item));
  RETURN to_jsonb(v_item);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_inventory_item_atomic(
  p_company_id UUID,p_item_id UUID,p_patch JSONB,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old inventory_items%ROWTYPE; v_new inventory_items%ROWTYPE; v_warehouse UUID; v_active BOOLEAN;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch)<>'object' OR p_patch='{}'::JSONB OR EXISTS(
    SELECT 1 FROM jsonb_object_keys(p_patch) key WHERE key NOT IN('name','unit','category','is_active','warehouse_id')
  ) THEN RAISE EXCEPTION 'بيانات تحديث الصنف غير صالحة'; END IF;
  SELECT * INTO v_old FROM inventory_items WHERE id=p_item_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الصنف غير موجود'; END IF;
  IF (p_patch?'name' AND (NULLIF(btrim(p_patch->>'name'),'') IS NULL OR length(p_patch->>'name')>300))
    OR (p_patch?'unit' AND (NULLIF(btrim(p_patch->>'unit'),'') IS NULL OR length(p_patch->>'unit')>50))
    OR length(COALESCE(p_patch->>'category',''))>100
    OR (p_patch?'is_active' AND jsonb_typeof(p_patch->'is_active')<>'boolean')
  THEN RAISE EXCEPTION 'بيانات تحديث الصنف غير صالحة'; END IF;
  BEGIN v_warehouse:=CASE WHEN p_patch?'warehouse_id' THEN (p_patch->>'warehouse_id')::UUID ELSE v_old.warehouse_id END;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'المستودع غير صالح'; END;
  v_active:=CASE WHEN p_patch?'is_active' THEN (p_patch->>'is_active')::BOOLEAN ELSE v_old.is_active END;
  IF v_warehouse<>v_old.warehouse_id AND abs(COALESCE(v_old.quantity,0))>0.005
  THEN RAISE EXCEPTION 'لا يمكن نقل صنف عليه رصيد دون حركة تحويل'; END IF;
  IF NOT EXISTS(SELECT 1 FROM warehouses WHERE id=v_warehouse AND company_id=p_company_id AND COALESCE(is_active,TRUE))
  THEN RAISE EXCEPTION 'المستودع غير موجود'; END IF;
  IF NOT v_active AND abs(COALESCE(v_old.quantity,0))>0.005 THEN RAISE EXCEPTION 'لا يمكن تعطيل صنف عليه رصيد'; END IF;
  IF EXISTS(SELECT 1 FROM inventory_items WHERE company_id=p_company_id AND warehouse_id=v_warehouse
    AND id<>p_item_id AND lower(code)=lower(v_old.code)) THEN RAISE EXCEPTION 'كود الصنف موجود في المستودع'; END IF;
  UPDATE inventory_items SET
    name=CASE WHEN p_patch?'name' THEN btrim(p_patch->>'name') ELSE name END,
    unit=CASE WHEN p_patch?'unit' THEN btrim(p_patch->>'unit') ELSE unit END,
    category=CASE WHEN p_patch?'category' THEN NULLIF(btrim(p_patch->>'category'),'') ELSE category END,
    warehouse_id=v_warehouse,is_active=v_active,updated_at=now()
  WHERE id=p_item_id RETURNING * INTO v_new;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,CASE WHEN v_old.is_active AND NOT v_active THEN 'deactivate' ELSE 'update' END,
    'inventory_item',p_item_id,to_jsonb(v_old),to_jsonb(v_new));
  RETURN to_jsonb(v_new);
END;
$$;

CREATE OR REPLACE FUNCTION public.post_inventory_movement_atomic(
  p_company_id UUID,p_item_id UUID,p_warehouse_id UUID,p_type TEXT,p_quantity NUMERIC,
  p_unit_price NUMERIC,p_date DATE,p_notes TEXT,p_to_warehouse_id UUID,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_item inventory_items%ROWTYPE; v_target inventory_items%ROWTYPE; v_warehouse warehouses%ROWTYPE;
  v_before NUMERIC; v_after NUMERIC; v_target_before NUMERIC; v_target_after NUMERIC;
  v_cost NUMERIC; v_value NUMERIC; v_diff NUMERIC; v_kind TEXT; v_txn inventory_transactions%ROWTYPE;
  v_inventory UUID; v_income UUID; v_cost_account UUID; v_debit UUID; v_credit UUID;
  v_journal JSONB; v_journal_id UUID; v_txn_id UUID:=gen_random_uuid(); v_lines JSONB;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  v_kind:=CASE WHEN p_type='adjust' THEN 'adjustment' ELSE p_type END;
  IF v_kind NOT IN('add','issue','adjustment','transfer','return') OR p_date IS NULL
    OR p_quantity IS NULL OR p_quantity<0 OR p_quantity<>round(p_quantity,2)
    OR (v_kind<>'adjustment' AND p_quantity<=0)
    OR (p_unit_price IS NOT NULL AND (p_unit_price<0 OR p_unit_price<>round(p_unit_price,2)))
    OR length(COALESCE(p_notes,''))>500
  THEN RAISE EXCEPTION 'بيانات الحركة المخزنية غير صالحة'; END IF;

  SELECT * INTO v_item FROM inventory_items WHERE id=p_item_id AND company_id=p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'الصنف غير موجود'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('inventory-stock:'||p_company_id::TEXT||':'||lower(v_item.code),0));
  SELECT * INTO v_item FROM inventory_items WHERE id=p_item_id AND company_id=p_company_id FOR UPDATE;
  IF NOT COALESCE(v_item.is_active,TRUE) THEN RAISE EXCEPTION 'الصنف غير نشط'; END IF;
  IF v_item.warehouse_id<>p_warehouse_id THEN RAISE EXCEPTION 'الصنف لا ينتمي إلى مستودع المصدر'; END IF;
  SELECT * INTO v_warehouse FROM warehouses WHERE id=p_warehouse_id AND company_id=p_company_id AND COALESCE(is_active,TRUE);
  IF NOT FOUND THEN RAISE EXCEPTION 'مستودع المصدر غير موجود'; END IF;

  v_before:=COALESCE(v_item.quantity,0); v_after:=v_before; v_cost:=COALESCE(v_item.unit_price,0);
  IF v_kind='add' THEN
    v_cost:=COALESCE(p_unit_price,v_cost);
    IF v_cost<0 THEN RAISE EXCEPTION 'تكلفة الإضافة غير صالحة'; END IF;
    v_after:=round(v_before+p_quantity,2);
    IF v_after>0 THEN
      v_cost:=round(((v_before*COALESCE(v_item.unit_price,0))+(p_quantity*v_cost))/v_after,2);
    END IF;
    v_value:=round(p_quantity*COALESCE(p_unit_price,v_item.unit_price,0),2);
    v_debit:=NULL; v_credit:=NULL;
  ELSIF v_kind='issue' THEN
    IF v_before+0.005<p_quantity THEN RAISE EXCEPTION 'الكمية غير متوفرة في المخزون'; END IF;
    v_after:=round(v_before-p_quantity,2); v_value:=round(p_quantity*v_cost,2);
  ELSIF v_kind='return' THEN
    v_after:=round(v_before+p_quantity,2); v_value:=round(p_quantity*v_cost,2);
  ELSIF v_kind='adjustment' THEN
    v_diff:=round(p_quantity-v_before,2);
    IF abs(v_diff)<0.005 THEN RAISE EXCEPTION 'لا فرق عن الرصيد الحالي'; END IF;
    v_after:=p_quantity; v_value:=round(abs(v_diff)*v_cost,2);
  ELSE
    IF p_to_warehouse_id IS NULL OR p_to_warehouse_id=p_warehouse_id THEN RAISE EXCEPTION 'مستودع الوجهة غير صالح'; END IF;
    IF v_before+0.005<p_quantity THEN RAISE EXCEPTION 'الكمية غير متوفرة في المخزون'; END IF;
    IF NOT EXISTS(SELECT 1 FROM warehouses WHERE id=p_to_warehouse_id AND company_id=p_company_id AND COALESCE(is_active,TRUE))
    THEN RAISE EXCEPTION 'مستودع الوجهة غير موجود'; END IF;
    SELECT * INTO v_target FROM inventory_items WHERE company_id=p_company_id AND warehouse_id=p_to_warehouse_id
      AND lower(code)=lower(v_item.code) FOR UPDATE;
    IF v_target.id IS NULL THEN
      INSERT INTO inventory_items(company_id,code,name,unit,warehouse_id,quantity,unit_price,category,is_active)
      VALUES(p_company_id,v_item.code,v_item.name,v_item.unit,p_to_warehouse_id,0,v_cost,v_item.category,TRUE)
      RETURNING * INTO v_target;
    ELSIF NOT COALESCE(v_target.is_active,TRUE) THEN
      RAISE EXCEPTION 'صنف الوجهة غير نشط';
    END IF;
    v_target_before:=COALESCE(v_target.quantity,0); v_target_after:=round(v_target_before+p_quantity,2);
    UPDATE inventory_items SET quantity=v_target_after,
      unit_price=CASE WHEN v_target_after=0 THEN v_cost
        ELSE round(((v_target_before*COALESCE(v_target.unit_price,0))+(p_quantity*v_cost))/v_target_after,2) END,
      updated_at=now() WHERE id=v_target.id;
    v_after:=round(v_before-p_quantity,2); v_value:=round(p_quantity*v_cost,2);
  END IF;

  -- Financially effective stock movements are posted in the same transaction.
  IF v_kind<>'transfer' AND v_value>0 THEN
    SELECT id INTO v_inventory FROM accounts WHERE company_id=p_company_id AND code='1170'
      AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
    SELECT id INTO v_income FROM accounts WHERE company_id=p_company_id AND code='4200'
      AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
    SELECT id INTO v_cost_account FROM accounts WHERE company_id=p_company_id AND code='5100'
      AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
    IF v_inventory IS NULL THEN RAISE EXCEPTION 'حساب المخزون 1170 غير موجود'; END IF;
    IF v_kind='add' OR (v_kind='adjustment' AND v_diff>0) THEN v_debit:=v_inventory; v_credit:=v_income;
    ELSIF v_kind='return' THEN v_debit:=v_inventory; v_credit:=v_cost_account;
    ELSE v_debit:=v_cost_account; v_credit:=v_inventory; END IF;
    IF v_debit IS NULL OR v_credit IS NULL THEN RAISE EXCEPTION 'حساب مقابل حركة المخزون غير موجود'; END IF;
    v_lines:=jsonb_build_array(
      jsonb_build_object('accountId',v_debit,'debit',v_value,'credit',0),
      jsonb_build_object('accountId',v_credit,'debit',0,'credit',v_value)
    );
    v_journal:=create_journal_entry(p_company_id,p_date,'general','حركة مخزون: '||v_item.name,p_user_id,v_lines);
    v_journal_id:=(v_journal->>'id')::UUID;
    UPDATE journal_entries SET reference_type='inventory_movement',reference_id=v_txn_id
      WHERE id=v_journal_id AND company_id=p_company_id;
  END IF;

  UPDATE inventory_items SET quantity=v_after,unit_price=v_cost,updated_at=now() WHERE id=v_item.id;
  INSERT INTO inventory_transactions(
    id,company_id,item_id,warehouse_id,to_warehouse_id,type,quantity,unit_price,total_value,
    balance_before,balance_after,date,notes,reference_type,reference_id,created_by
  ) VALUES(
    v_txn_id,p_company_id,v_item.id,p_warehouse_id,p_to_warehouse_id,v_kind,
    CASE WHEN v_kind='adjustment' THEN abs(v_diff) ELSE p_quantity END,
    v_cost,v_value,v_before,v_after,p_date,NULLIF(btrim(p_notes),''),
    CASE WHEN v_journal_id IS NULL THEN NULL ELSE 'journal_entry' END,v_journal_id,p_user_id
  ) RETURNING * INTO v_txn;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'create','inventory_transaction',v_txn.id,
    to_jsonb(v_txn)||CASE WHEN v_kind='transfer' THEN jsonb_build_object('target_item_id',v_target.id,
      'target_balance_before',v_target_before,'target_balance_after',v_target_after) ELSE '{}'::JSONB END);
  RETURN jsonb_build_object('transaction',to_jsonb(v_txn),'source_quantity',v_after,
    'target_quantity',CASE WHEN v_kind='transfer' THEN v_target_after ELSE NULL END,'journal_entry_id',v_journal_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_inventory_transaction_note_atomic(
  p_company_id UUID,p_transaction_id UUID,p_notes TEXT,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old inventory_transactions%ROWTYPE; v_new inventory_transactions%ROWTYPE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  IF length(COALESCE(p_notes,''))>500 THEN RAISE EXCEPTION 'الملاحظات غير صالحة'; END IF;
  SELECT * INTO v_old FROM inventory_transactions WHERE id=p_transaction_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الحركة غير موجودة'; END IF;
  UPDATE inventory_transactions SET notes=NULLIF(btrim(p_notes),'') WHERE id=p_transaction_id RETURNING * INTO v_new;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'update_note','inventory_transaction',p_transaction_id,to_jsonb(v_old),to_jsonb(v_new));
  RETURN to_jsonb(v_new);
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_inventory_tenant_links()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.company_id IS DISTINCT FROM OLD.company_id THEN RAISE EXCEPTION 'Inventory tenant cannot change'; END IF;
  IF TG_TABLE_NAME='inventory_items' THEN
    IF NOT EXISTS(SELECT 1 FROM warehouses WHERE id=NEW.warehouse_id AND company_id=NEW.company_id)
    THEN RAISE EXCEPTION 'cross-tenant inventory warehouse'; END IF;
  ELSIF TG_TABLE_NAME='inventory_transactions' THEN
    IF NOT EXISTS(SELECT 1 FROM inventory_items WHERE id=NEW.item_id AND company_id=NEW.company_id)
      OR NOT EXISTS(SELECT 1 FROM warehouses WHERE id=NEW.warehouse_id AND company_id=NEW.company_id)
      OR (NEW.to_warehouse_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM warehouses WHERE id=NEW.to_warehouse_id AND company_id=NEW.company_id))
      OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.created_by AND company_id=NEW.company_id)
    THEN RAISE EXCEPTION 'cross-tenant inventory transaction link'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_inventory_item_links ON inventory_items;
CREATE TRIGGER trg_guard_inventory_item_links BEFORE INSERT OR UPDATE ON inventory_items
FOR EACH ROW EXECUTE FUNCTION guard_inventory_tenant_links();
DROP TRIGGER IF EXISTS trg_guard_inventory_transaction_links ON inventory_transactions;
CREATE TRIGGER trg_guard_inventory_transaction_links BEFORE INSERT OR UPDATE ON inventory_transactions
FOR EACH ROW EXECUTE FUNCTION guard_inventory_tenant_links();

CREATE OR REPLACE FUNCTION public.purchase_items_total(p_items JSONB)
RETURNS NUMERIC LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_item JSONB; v_qty NUMERIC; v_price NUMERIC; v_total NUMERIC:=0;
BEGIN
  IF jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)=0 OR jsonb_array_length(p_items)>200
  THEN RAISE EXCEPTION 'بنود الشراء غير صالحة'; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF jsonb_typeof(v_item)<>'object' OR EXISTS(
      SELECT 1 FROM jsonb_object_keys(v_item) key WHERE key NOT IN('description','quantity','unit_price','total')
    ) THEN RAISE EXCEPTION 'بند شراء غير صالح'; END IF;
    BEGIN v_qty:=(v_item->>'quantity')::NUMERIC; v_price:=(v_item->>'unit_price')::NUMERIC;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'بند شراء غير صالح'; END;
    IF NULLIF(btrim(v_item->>'description'),'') IS NULL OR length(v_item->>'description')>50
      OR v_qty<=0 OR v_price<0 OR v_qty<>round(v_qty,2) OR v_price<>round(v_price,2)
    THEN RAISE EXCEPTION 'بند شراء غير صالح'; END IF;
    v_total:=v_total+round(v_qty*v_price,2);
  END LOOP;
  IF v_total<=0 OR v_total>9999999999999.99 THEN RAISE EXCEPTION 'إجمالي الشراء غير صالح'; END IF;
  RETURN round(v_total,2);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_purchase_order_atomic(
  p_company_id UUID,p_supplier_id UUID,p_date DATE,p_items JSONB,p_notes TEXT,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_order purchase_orders%ROWTYPE; v_item JSONB; v_number INTEGER; v_total NUMERIC; v_qty NUMERIC; v_price NUMERIC;
BEGIN
  IF p_date IS NULL OR length(COALESCE(p_notes,''))>2000 THEN RAISE EXCEPTION 'بيانات أمر الشراء غير صالحة'; END IF;
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  IF NOT EXISTS(SELECT 1 FROM contacts WHERE id=p_supplier_id AND company_id=p_company_id
    AND type IN('supplier','both') AND COALESCE(is_active,TRUE) AND deleted_at IS NULL)
  THEN RAISE EXCEPTION 'المورد غير موجود'; END IF;
  v_total:=purchase_items_total(p_items);
  PERFORM pg_advisory_xact_lock(hashtextextended('purchase-order-number:'||p_company_id::TEXT,0));
  SELECT COALESCE(max(number),0)+1 INTO v_number FROM purchase_orders WHERE company_id=p_company_id;
  INSERT INTO purchase_orders(company_id,number,po_number,date,supplier_id,total,status,notes,created_by)
  VALUES(p_company_id,v_number,v_number::TEXT,p_date,p_supplier_id,v_total,'pending',NULLIF(btrim(p_notes),''),p_user_id)
  RETURNING * INTO v_order;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_qty:=(v_item->>'quantity')::NUMERIC; v_price:=(v_item->>'unit_price')::NUMERIC;
    INSERT INTO purchase_order_items(company_id,purchase_order_id,description,quantity,received_quantity,unit_price,total)
    VALUES(p_company_id,v_order.id,btrim(v_item->>'description'),v_qty,0,v_price,round(v_qty*v_price,2));
  END LOOP;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'create','purchase_order',v_order.id,to_jsonb(v_order));
  RETURN to_jsonb(v_order);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_purchase_order_atomic(
  p_company_id UUID,p_order_id UUID,p_supplier_id UUID,p_date DATE,p_items JSONB,p_notes TEXT,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old purchase_orders%ROWTYPE; v_new purchase_orders%ROWTYPE; v_item JSONB; v_total NUMERIC; v_qty NUMERIC; v_price NUMERIC;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  SELECT * INTO v_old FROM purchase_orders WHERE id=p_order_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'أمر الشراء غير موجود'; END IF;
  IF v_old.status<>'pending' THEN RAISE EXCEPTION 'لا يمكن تعديل إلا أمر شراء معلق'; END IF;
  IF length(COALESCE(p_notes,''))>2000 THEN RAISE EXCEPTION 'الملاحظات غير صالحة'; END IF;
  IF NOT EXISTS(SELECT 1 FROM contacts WHERE id=COALESCE(p_supplier_id,v_old.supplier_id) AND company_id=p_company_id
    AND type IN('supplier','both') AND COALESCE(is_active,TRUE) AND deleted_at IS NULL)
  THEN RAISE EXCEPTION 'المورد غير موجود'; END IF;
  IF p_items IS NOT NULL THEN
    v_total:=purchase_items_total(p_items);
    DELETE FROM purchase_order_items WHERE purchase_order_id=p_order_id AND company_id=p_company_id;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
      v_qty:=(v_item->>'quantity')::NUMERIC; v_price:=(v_item->>'unit_price')::NUMERIC;
      INSERT INTO purchase_order_items(company_id,purchase_order_id,description,quantity,received_quantity,unit_price,total)
      VALUES(p_company_id,p_order_id,btrim(v_item->>'description'),v_qty,0,v_price,round(v_qty*v_price,2));
    END LOOP;
  ELSE v_total:=v_old.total; END IF;
  UPDATE purchase_orders SET supplier_id=COALESCE(p_supplier_id,v_old.supplier_id),date=COALESCE(p_date,v_old.date),
    total=v_total,notes=CASE WHEN p_notes IS NULL THEN v_old.notes ELSE NULLIF(btrim(p_notes),'') END,updated_at=now()
  WHERE id=p_order_id RETURNING * INTO v_new;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'update','purchase_order',p_order_id,to_jsonb(v_old),to_jsonb(v_new));
  RETURN to_jsonb(v_new);
END;
$$;

CREATE OR REPLACE FUNCTION public.receive_purchase_order_atomic(
  p_company_id UUID,p_order_id UUID,p_quantities JSONB,p_received_date DATE,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_order purchase_orders%ROWTYPE; v_line purchase_order_items%ROWTYPE; v_stock inventory_items%ROWTYPE;
  v_warehouse UUID; v_remaining NUMERIC; v_receive NUMERIC; v_new_qty NUMERIC; v_status TEXT; v_key TEXT;
  v_received_count INTEGER:=0; v_received_value NUMERIC:=0; v_inventory UUID; v_grni UUID;
  v_journal JSONB; v_journal_id UUID; v_lines JSONB; v_receipt_date DATE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  SELECT * INTO v_order FROM purchase_orders WHERE id=p_order_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'أمر الشراء غير موجود'; END IF;
  IF v_order.status='cancelled' THEN RAISE EXCEPTION 'أمر الشراء ملغى'; END IF;
  IF v_order.status='received' THEN RETURN jsonb_build_object('id',p_order_id,'status','received','already_processed',TRUE); END IF;
  v_receipt_date:=COALESCE(p_received_date,CURRENT_DATE);
  IF v_receipt_date<v_order.date THEN RAISE EXCEPTION 'تاريخ الاستلام يسبق أمر الشراء'; END IF;
  IF p_quantities IS NOT NULL AND jsonb_typeof(p_quantities)<>'object' THEN RAISE EXCEPTION 'كميات الاستلام غير صالحة'; END IF;
  IF p_quantities IS NOT NULL THEN
    FOR v_key IN SELECT key FROM jsonb_each(p_quantities) LOOP
      IF NOT EXISTS(SELECT 1 FROM purchase_order_items WHERE purchase_order_id=p_order_id AND company_id=p_company_id AND id::TEXT=v_key)
      THEN RAISE EXCEPTION 'بند أمر شراء غير معروف'; END IF;
      BEGIN v_receive:=(p_quantities->>v_key)::NUMERIC; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'كمية الاستلام غير صالحة'; END;
      IF v_receive<=0 OR v_receive<>round(v_receive,2) THEN RAISE EXCEPTION 'كمية الاستلام غير صالحة'; END IF;
    END LOOP;
  END IF;
  SELECT id INTO v_warehouse FROM warehouses WHERE company_id=p_company_id AND COALESCE(is_active,TRUE)
    ORDER BY id LIMIT 1 FOR UPDATE;
  IF v_warehouse IS NULL THEN RAISE EXCEPTION 'يلزم مستودع نشط قبل الاستلام'; END IF;
  SELECT id INTO v_inventory FROM accounts WHERE company_id=p_company_id AND code='1170'
    AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
  SELECT id INTO v_grni FROM accounts WHERE company_id=p_company_id AND code='2145'
    AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
  IF v_inventory IS NULL OR v_grni IS NULL THEN RAISE EXCEPTION 'حسابا المخزون والمشتريات المستلمة غير المفوترة غير مكتملين'; END IF;

  FOR v_line IN SELECT * FROM purchase_order_items WHERE purchase_order_id=p_order_id AND company_id=p_company_id ORDER BY id FOR UPDATE LOOP
    v_remaining:=v_line.quantity-COALESCE(v_line.received_quantity,0);
    IF v_remaining<=0 THEN CONTINUE; END IF;
    IF p_quantities IS NULL THEN v_receive:=v_remaining;
    ELSIF p_quantities?v_line.id::TEXT THEN v_receive:=(p_quantities->>v_line.id::TEXT)::NUMERIC;
    ELSE CONTINUE; END IF;
    IF v_receive>v_remaining+0.005 THEN RAISE EXCEPTION 'كمية الاستلام تتجاوز المتبقي'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('inventory-code:'||p_company_id::TEXT||':'||lower(v_line.description),0));
    v_stock.id:=NULL;
    IF v_line.inventory_item_id IS NOT NULL THEN
      SELECT * INTO v_stock FROM inventory_items WHERE id=v_line.inventory_item_id AND company_id=p_company_id FOR UPDATE;
      IF v_stock.id IS NOT NULL AND v_stock.warehouse_id<>v_warehouse THEN RAISE EXCEPTION 'صنف أمر الشراء مرتبط بمستودع آخر'; END IF;
    END IF;
    IF v_stock.id IS NULL THEN
      SELECT * INTO v_stock FROM inventory_items WHERE company_id=p_company_id AND warehouse_id=v_warehouse
        AND lower(code)=lower(v_line.description) FOR UPDATE;
    END IF;
    IF v_stock.id IS NULL THEN
      INSERT INTO inventory_items(company_id,code,name,unit,warehouse_id,quantity,unit_price,is_active)
      VALUES(p_company_id,v_line.description,v_line.description,'وحدة',v_warehouse,0,v_line.unit_price,TRUE) RETURNING * INTO v_stock;
    ELSIF NOT COALESCE(v_stock.is_active,TRUE) THEN RAISE EXCEPTION 'صنف المخزون غير نشط'; END IF;
    v_new_qty:=round(COALESCE(v_stock.quantity,0)+v_receive,2);
    UPDATE inventory_items SET quantity=v_new_qty,
      unit_price=round(((COALESCE(v_stock.quantity,0)*COALESCE(v_stock.unit_price,0))+(v_receive*v_line.unit_price))/v_new_qty,2),
      updated_at=now() WHERE id=v_stock.id RETURNING * INTO v_stock;
    UPDATE purchase_order_items SET received_quantity=COALESCE(received_quantity,0)+v_receive,inventory_item_id=v_stock.id WHERE id=v_line.id;
    INSERT INTO inventory_transactions(company_id,item_id,warehouse_id,type,quantity,unit_price,total_value,
      balance_before,balance_after,date,reference_type,reference_id,created_by)
    VALUES(p_company_id,v_stock.id,v_warehouse,'add',v_receive,v_line.unit_price,round(v_receive*v_line.unit_price,2),
      v_new_qty-v_receive,v_new_qty,v_receipt_date,'purchase_order',p_order_id,p_user_id);
    v_received_value:=v_received_value+round(v_receive*v_line.unit_price,2); v_received_count:=v_received_count+1;
  END LOOP;
  IF v_received_count=0 THEN RAISE EXCEPTION 'لم تُستلم أي كمية'; END IF;
  v_received_value:=round(v_received_value,2);
  v_lines:=jsonb_build_array(
    jsonb_build_object('accountId',v_inventory,'debit',v_received_value,'credit',0),
    jsonb_build_object('accountId',v_grni,'debit',0,'credit',v_received_value)
  );
  v_journal:=create_journal_entry(p_company_id,v_receipt_date,'general','استلام أمر شراء '||v_order.number,p_user_id,v_lines);
  v_journal_id:=(v_journal->>'id')::UUID;
  UPDATE journal_entries SET reference_type='purchase_order_receipt',reference_id=p_order_id
    WHERE id=v_journal_id AND company_id=p_company_id;
  SELECT CASE WHEN bool_and(COALESCE(received_quantity,0)>=quantity) THEN 'received' ELSE 'partial' END INTO v_status
    FROM purchase_order_items WHERE purchase_order_id=p_order_id AND company_id=p_company_id;
  UPDATE purchase_orders SET status=v_status,updated_at=now() WHERE id=p_order_id RETURNING * INTO v_order;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'receive','purchase_order',p_order_id,
    jsonb_build_object('status',v_status,'line_count',v_received_count,'value',v_received_value,'journal_entry_id',v_journal_id));
  RETURN to_jsonb(v_order)||jsonb_build_object('received_line_count',v_received_count,'journal_entry_id',v_journal_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_purchase_order_atomic(p_company_id UUID,p_order_id UUID,p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old purchase_orders%ROWTYPE; v_new purchase_orders%ROWTYPE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  SELECT * INTO v_old FROM purchase_orders WHERE id=p_order_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'أمر الشراء غير موجود'; END IF;
  PERFORM 1 FROM purchase_order_items WHERE purchase_order_id=p_order_id AND company_id=p_company_id FOR UPDATE;
  IF v_old.status='cancelled' THEN RETURN jsonb_build_object('id',p_order_id,'status','cancelled','already_processed',TRUE); END IF;
  IF EXISTS(SELECT 1 FROM purchase_order_items WHERE purchase_order_id=p_order_id AND COALESCE(received_quantity,0)>0)
  THEN RAISE EXCEPTION 'لا يمكن إلغاء أمر شراء مستلم كلياً أو جزئياً'; END IF;
  UPDATE purchase_orders SET status='cancelled',updated_at=now() WHERE id=p_order_id RETURNING * INTO v_new;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'cancel','purchase_order',p_order_id,to_jsonb(v_old),to_jsonb(v_new));
  RETURN to_jsonb(v_new);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_purchase_invoice_atomic(
  p_company_id UUID,p_supplier_id UUID,p_purchase_order_id UUID,p_project_id UUID,
  p_custody_id UUID,p_link_to_project BOOLEAN,p_date DATE,p_items JSONB,
  p_tax_rate NUMERIC,p_notes TEXT,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_invoice purchase_invoices%ROWTYPE; v_order purchase_orders%ROWTYPE; v_custody custodies%ROWTYPE;
  v_project UUID; v_item JSONB; v_qty NUMERIC; v_price NUMERIC; v_subtotal NUMERIC; v_tax NUMERIC; v_total NUMERIC;
  v_number INTEGER; v_debit UUID; v_vat UUID; v_credit UUID; v_lines JSONB; v_journal JSONB; v_journal_id UUID;
  v_last_receipt DATE;
BEGIN
  IF p_date IS NULL OR p_tax_rate IS NULL OR p_tax_rate<0 OR p_tax_rate>1 OR p_tax_rate<>round(p_tax_rate,4)
    OR length(COALESCE(p_notes,''))>2000 THEN RAISE EXCEPTION 'بيانات فاتورة المشتريات غير صالحة'; END IF;
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  IF NOT EXISTS(SELECT 1 FROM contacts WHERE id=p_supplier_id AND company_id=p_company_id
    AND type IN('supplier','both') AND COALESCE(is_active,TRUE) AND deleted_at IS NULL)
  THEN RAISE EXCEPTION 'المورد غير موجود'; END IF;
  v_subtotal:=purchase_items_total(p_items);

  IF p_purchase_order_id IS NOT NULL THEN
    IF p_custody_id IS NOT NULL THEN RAISE EXCEPTION 'لا يمكن ربط أمر شراء مستلم بعهدة'; END IF;
    SELECT * INTO v_order FROM purchase_orders WHERE id=p_purchase_order_id AND company_id=p_company_id FOR UPDATE;
    IF NOT FOUND OR v_order.status<>'received' OR v_order.supplier_id<>p_supplier_id
    THEN RAISE EXCEPTION 'يجب أن يكون أمر الشراء مستلماً بالكامل وللمورد المحدد'; END IF;
    IF abs(v_subtotal-v_order.total)>0.005 THEN RAISE EXCEPTION 'إجمالي الفاتورة لا يطابق أمر الشراء'; END IF;
    IF EXISTS(SELECT 1 FROM purchase_invoices WHERE company_id=p_company_id AND purchase_order_id=p_purchase_order_id
      AND status<>'cancelled') THEN RAISE EXCEPTION 'تمت فوترة أمر الشراء مسبقاً'; END IF;
    SELECT max(date) INTO v_last_receipt FROM inventory_transactions
      WHERE company_id=p_company_id AND reference_type='purchase_order' AND reference_id=p_purchase_order_id;
    IF v_last_receipt IS NULL OR p_date<v_last_receipt THEN RAISE EXCEPTION 'تاريخ الفاتورة يسبق استلام أمر الشراء'; END IF;
  END IF;

  IF COALESCE(p_link_to_project,TRUE) AND p_project_id IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM projects WHERE id=p_project_id AND company_id=p_company_id)
    THEN RAISE EXCEPTION 'المشروع غير موجود'; END IF;
    v_project:=p_project_id;
  END IF;
  IF p_custody_id IS NOT NULL THEN
    SELECT * INTO v_custody FROM custodies WHERE id=p_custody_id AND company_id=p_company_id FOR UPDATE;
    IF NOT FOUND OR v_custody.status IN('settled','closed') OR v_custody.deleted_at IS NOT NULL
    THEN RAISE EXCEPTION 'ملف العهدة غير صالح'; END IF;
    IF COALESCE(p_link_to_project,TRUE) AND v_project IS NULL THEN v_project:=v_custody.project_id; END IF;
  END IF;

  v_tax:=round(v_subtotal*p_tax_rate,2); v_total:=round(v_subtotal+v_tax,2);
  IF p_custody_id IS NOT NULL AND v_total>v_custody.remaining_amount+0.005
  THEN RAISE EXCEPTION 'مبلغ الفاتورة أكبر من المتبقي في ملف العهدة'; END IF;
  SELECT id INTO v_debit FROM accounts WHERE company_id=p_company_id
    AND code=CASE WHEN p_purchase_order_id IS NOT NULL THEN '2145' ELSE '5100' END
    AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
  IF v_debit IS NULL AND p_purchase_order_id IS NULL THEN
    SELECT id INTO v_debit FROM accounts WHERE company_id=p_company_id AND code='1140'
      AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
  END IF;
  SELECT id INTO v_credit FROM accounts WHERE company_id=p_company_id
    AND code=CASE WHEN p_custody_id IS NULL THEN '2110' ELSE '1150' END
    AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
  IF v_debit IS NULL OR v_credit IS NULL THEN RAISE EXCEPTION 'حسابات المشتريات غير مكتملة'; END IF;
  IF v_tax>0 THEN
    SELECT id INTO v_vat FROM accounts WHERE company_id=p_company_id AND code='1180'
      AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
    IF v_vat IS NULL THEN RAISE EXCEPTION 'حساب ضريبة المشتريات غير موجود'; END IF;
  END IF;

  v_number:=next_purchase_invoice_number(p_company_id);
  INSERT INTO purchase_invoices(company_id,invoice_number,number,date,supplier_id,purchase_order_id,project_id,
    custody_id,payment_source,subtotal,tax_amount,tax_rate,total,paid_amount,status,notes,created_by)
  VALUES(p_company_id,v_number::TEXT,v_number,p_date,p_supplier_id,p_purchase_order_id,v_project,p_custody_id,
    CASE WHEN p_custody_id IS NULL THEN 'ap' ELSE 'custody' END,v_subtotal,v_tax,p_tax_rate,v_total,
    CASE WHEN p_custody_id IS NULL THEN 0 ELSE v_total END,CASE WHEN p_custody_id IS NULL THEN 'unpaid' ELSE 'paid' END,
    NULLIF(btrim(p_notes),''),p_user_id) RETURNING * INTO v_invoice;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_qty:=(v_item->>'quantity')::NUMERIC; v_price:=(v_item->>'unit_price')::NUMERIC;
    INSERT INTO purchase_invoice_items(company_id,purchase_invoice_id,description,quantity,unit_price,total)
    VALUES(p_company_id,v_invoice.id,btrim(v_item->>'description'),v_qty,v_price,round(v_qty*v_price,2));
  END LOOP;
  v_lines:=jsonb_build_array(
    jsonb_build_object('accountId',v_debit,'debit',v_subtotal,'credit',0,'projectId',v_project),
    jsonb_build_object('accountId',v_credit,'debit',0,'credit',v_total,
      'contactId',CASE WHEN p_custody_id IS NULL THEN p_supplier_id ELSE NULL END)
  );
  IF v_tax>0 THEN v_lines:=v_lines||jsonb_build_array(
    jsonb_build_object('accountId',v_vat,'debit',v_tax,'credit',0)
  ); END IF;
  v_journal:=create_journal_entry(p_company_id,p_date,'general','فاتورة مشتريات رقم '||v_number,p_user_id,v_lines);
  v_journal_id:=(v_journal->>'id')::UUID;
  UPDATE journal_entries SET reference_type='purchase_invoice',reference_id=v_invoice.id
    WHERE id=v_journal_id AND company_id=p_company_id;
  UPDATE purchase_invoices SET journal_entry_id=v_journal_id WHERE id=v_invoice.id RETURNING * INTO v_invoice;
  IF p_custody_id IS NOT NULL THEN
    INSERT INTO custody_transactions(company_id,custody_id,type,amount,description,reference_type,reference_id,created_by,journal_entry_id)
    VALUES(p_company_id,p_custody_id,'expense',v_total,'فاتورة مشتريات '||v_number,
      'purchase_invoice',v_invoice.id,p_user_id,v_journal_id);
    INSERT INTO custody_invoices(company_id,custody_id,purchase_invoice_id,amount,description)
    VALUES(p_company_id,p_custody_id,v_invoice.id,v_total,'فاتورة '||v_number);
  END IF;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'create','purchase_invoice',v_invoice.id,to_jsonb(v_invoice));
  RETURN to_jsonb(v_invoice);
END;
$$;

-- Last-line tenant guards for service-role writers.
CREATE OR REPLACE FUNCTION public.guard_warehouse_tenant()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.company_id IS DISTINCT FROM OLD.company_id THEN RAISE EXCEPTION 'Warehouse tenant cannot change'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_warehouse_tenant ON warehouses;
CREATE TRIGGER trg_guard_warehouse_tenant BEFORE UPDATE ON warehouses FOR EACH ROW EXECUTE FUNCTION guard_warehouse_tenant();

CREATE OR REPLACE FUNCTION public.guard_purchase_tenant_links()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.company_id IS DISTINCT FROM OLD.company_id
  THEN RAISE EXCEPTION 'Purchase tenant cannot change'; END IF;
  IF TG_TABLE_NAME='purchase_orders' THEN
    IF NOT EXISTS(SELECT 1 FROM contacts WHERE id=NEW.supplier_id AND company_id=NEW.company_id)
      OR (NEW.project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND company_id=NEW.company_id))
      OR (NEW.created_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.created_by AND company_id=NEW.company_id))
    THEN RAISE EXCEPTION 'cross-tenant purchase order link'; END IF;
  ELSIF TG_TABLE_NAME='purchase_order_items' THEN
    IF NOT EXISTS(SELECT 1 FROM purchase_orders WHERE id=NEW.purchase_order_id AND company_id=NEW.company_id)
      OR (NEW.inventory_item_id IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM inventory_items WHERE id=NEW.inventory_item_id AND company_id=NEW.company_id))
    THEN RAISE EXCEPTION 'cross-tenant purchase order item link'; END IF;
  ELSIF TG_TABLE_NAME='purchase_invoices' THEN
    IF NOT EXISTS(SELECT 1 FROM contacts WHERE id=NEW.supplier_id AND company_id=NEW.company_id)
      OR (NEW.purchase_order_id IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM purchase_orders WHERE id=NEW.purchase_order_id AND company_id=NEW.company_id))
      OR (NEW.project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND company_id=NEW.company_id))
      OR (NEW.custody_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM custodies WHERE id=NEW.custody_id AND company_id=NEW.company_id))
      OR (NEW.journal_entry_id IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM journal_entries WHERE id=NEW.journal_entry_id AND company_id=NEW.company_id))
      OR (NEW.created_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.created_by AND company_id=NEW.company_id))
    THEN RAISE EXCEPTION 'cross-tenant purchase invoice link'; END IF;
  ELSIF TG_TABLE_NAME='purchase_invoice_items' THEN
    IF NOT EXISTS(SELECT 1 FROM purchase_invoices WHERE id=NEW.purchase_invoice_id AND company_id=NEW.company_id)
    THEN RAISE EXCEPTION 'cross-tenant purchase invoice item link'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_purchase_order_links ON purchase_orders;
CREATE TRIGGER trg_guard_purchase_order_links BEFORE INSERT OR UPDATE ON purchase_orders
FOR EACH ROW EXECUTE FUNCTION guard_purchase_tenant_links();
DROP TRIGGER IF EXISTS trg_guard_purchase_order_item_links ON purchase_order_items;
CREATE TRIGGER trg_guard_purchase_order_item_links BEFORE INSERT OR UPDATE ON purchase_order_items
FOR EACH ROW EXECUTE FUNCTION guard_purchase_tenant_links();
DROP TRIGGER IF EXISTS trg_guard_purchase_invoice_links ON purchase_invoices;
CREATE TRIGGER trg_guard_purchase_invoice_links BEFORE INSERT OR UPDATE ON purchase_invoices
FOR EACH ROW EXECUTE FUNCTION guard_purchase_tenant_links();
DROP TRIGGER IF EXISTS trg_guard_purchase_invoice_item_links ON purchase_invoice_items;
CREATE TRIGGER trg_guard_purchase_invoice_item_links BEFORE INSERT OR UPDATE ON purchase_invoice_items
FOR EACH ROW EXECUTE FUNCTION guard_purchase_tenant_links();

REVOKE ALL ON FUNCTION public.create_warehouse_atomic(UUID,TEXT,TEXT,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.update_warehouse_atomic(UUID,UUID,JSONB,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.create_inventory_item_atomic(UUID,TEXT,TEXT,TEXT,UUID,TEXT,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.update_inventory_item_atomic(UUID,UUID,JSONB,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.post_inventory_movement_atomic(UUID,UUID,UUID,TEXT,NUMERIC,NUMERIC,DATE,TEXT,UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.update_inventory_transaction_note_atomic(UUID,UUID,TEXT,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.purchase_items_total(JSONB) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.create_purchase_order_atomic(UUID,UUID,DATE,JSONB,TEXT,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.update_purchase_order_atomic(UUID,UUID,UUID,DATE,JSONB,TEXT,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.receive_purchase_order_atomic(UUID,UUID,JSONB,DATE,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cancel_purchase_order_atomic(UUID,UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.create_purchase_invoice_atomic(UUID,UUID,UUID,UUID,UUID,BOOLEAN,DATE,JSONB,NUMERIC,TEXT,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guard_inventory_tenant_links() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guard_warehouse_tenant() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guard_purchase_tenant_links() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_warehouse_atomic(UUID,TEXT,TEXT,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_warehouse_atomic(UUID,UUID,JSONB,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_inventory_item_atomic(UUID,TEXT,TEXT,TEXT,UUID,TEXT,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_inventory_item_atomic(UUID,UUID,JSONB,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.post_inventory_movement_atomic(UUID,UUID,UUID,TEXT,NUMERIC,NUMERIC,DATE,TEXT,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_inventory_transaction_note_atomic(UUID,UUID,TEXT,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_purchase_order_atomic(UUID,UUID,DATE,JSONB,TEXT,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_purchase_order_atomic(UUID,UUID,UUID,DATE,JSONB,TEXT,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.receive_purchase_order_atomic(UUID,UUID,JSONB,DATE,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_purchase_order_atomic(UUID,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_purchase_invoice_atomic(UUID,UUID,UUID,UUID,UUID,BOOLEAN,DATE,JSONB,NUMERIC,TEXT,UUID) TO service_role;

COMMIT;
