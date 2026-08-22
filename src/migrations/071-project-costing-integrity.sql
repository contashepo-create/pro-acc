-- ============================================================================
-- 071: Project costing integrity
--
-- 1. Inventory issue/return movements can now be allocated to a project.
--    Before this, material issued from stock was posted to the cost of sales
--    account (5100) WITHOUT a project_id, so direct material costs never
--    appeared in any project profitability / WIP report. Now the movement
--    accepts an optional p_project_id, validates it (tenant + active), tags
--    the cost journal line with projectId, and stores it on the transaction.
-- 2. This mirrors the tenant/active validation used by every other project
--    cost entry point (post_project_expense, post_equipment_cost, …).
-- ============================================================================

DROP FUNCTION IF EXISTS public.post_inventory_movement_atomic(
  UUID,UUID,UUID,TEXT,NUMERIC,NUMERIC,DATE,TEXT,UUID,UUID
);

CREATE OR REPLACE FUNCTION public.post_inventory_movement_atomic(
  p_company_id UUID,p_item_id UUID,p_warehouse_id UUID,p_type TEXT,p_quantity NUMERIC,
  p_unit_price NUMERIC,p_date DATE,p_notes TEXT,p_to_warehouse_id UUID,p_user_id UUID,
  p_project_id UUID DEFAULT NULL
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

  -- Project allocation is only meaningful for consumption (issue / return of
  -- material to a project). Reject it for stock-in, adjustment and transfer,
  -- and validate the project is an active tenant project like every other
  -- project-cost entry point.
  IF p_project_id IS NOT NULL THEN
    IF v_kind NOT IN ('issue','return') THEN
      RAISE EXCEPTION 'ربط المشروع مسموح فقط لحركات الصرف والإرجاع';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM projects WHERE id=p_project_id AND company_id=p_company_id AND status='active') THEN
      RAISE EXCEPTION 'المشروع غير صالح أو غير نشط';
    END IF;
  END IF;

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
  -- The cost line (inventory <-> cost of sales) is tagged with the project so
  -- the material cost flows into project profitability / WIP reports.
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
      jsonb_build_object('accountId',v_debit,'debit',v_value,'credit',0,'projectId',p_project_id),
      jsonb_build_object('accountId',v_credit,'debit',0,'credit',v_value,'projectId',p_project_id)
    );
    v_journal:=create_journal_entry(p_company_id,p_date,'general','حركة مخزون: '||v_item.name,p_user_id,v_lines);
    v_journal_id:=(v_journal->>'id')::UUID;
    UPDATE journal_entries SET reference_type='inventory_movement',reference_id=v_txn_id
      WHERE id=v_journal_id AND company_id=p_company_id;
  END IF;

  UPDATE inventory_items SET quantity=v_after,unit_price=v_cost,updated_at=now() WHERE id=v_item.id;
  INSERT INTO inventory_transactions(
    id,company_id,item_id,warehouse_id,to_warehouse_id,type,quantity,unit_price,total_value,
    balance_before,balance_after,date,notes,reference_type,reference_id,created_by,project_id
  ) VALUES(
    v_txn_id,p_company_id,v_item.id,p_warehouse_id,p_to_warehouse_id,v_kind,
    CASE WHEN v_kind='adjustment' THEN abs(v_diff) ELSE p_quantity END,
    v_cost,v_value,v_before,v_after,p_date,NULLIF(btrim(p_notes),''),
    CASE WHEN v_journal_id IS NULL THEN NULL ELSE 'journal_entry' END,v_journal_id,p_user_id,p_project_id
  ) RETURNING * INTO v_txn;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'create','inventory_transaction',v_txn.id,
    to_jsonb(v_txn)||CASE WHEN v_kind='transfer' THEN jsonb_build_object('target_item_id',v_target.id,
      'target_balance_before',v_target_before,'target_balance_after',v_target_after) ELSE '{}'::JSONB END);
  RETURN jsonb_build_object('transaction',to_jsonb(v_txn),'source_quantity',v_after,
    'target_quantity',CASE WHEN v_kind='transfer' THEN v_target_after ELSE NULL END,'journal_entry_id',v_journal_id);
END;
$$;

REVOKE ALL ON FUNCTION public.post_inventory_movement_atomic(UUID,UUID,UUID,TEXT,NUMERIC,NUMERIC,DATE,TEXT,UUID,UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.post_inventory_movement_atomic(UUID,UUID,UUID,TEXT,NUMERIC,NUMERIC,DATE,TEXT,UUID,UUID,UUID) TO service_role;
