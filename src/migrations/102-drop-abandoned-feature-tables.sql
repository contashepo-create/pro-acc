-- 102 - Drop empty tables that belong to cancelled / superseded features.
--
-- Live inventory (2026-08-27, project vmzcejtatkgmemwlbhtk) showed these
-- relations exist, have 0 rows, and are not queried by the application.
-- Objects that are unused in the UI but still written by live RPCs are
-- intentionally kept (notably custody_invoices, used by
-- create_purchase_invoice_atomic_v55_internal).
--
-- Safety: each table is counted first. Any non-zero count aborts the
-- migration so production data cannot be deleted by accident.
--
-- Does not replace 101. Apply 101 first (tender/bond accounting fixes).

BEGIN;

-- delete_boq_item_atomic (058) still probes progress_claim_items. Rewrite
-- that check out before the table goes away.
CREATE OR REPLACE FUNCTION public.delete_boq_item_atomic(
  p_company_id UUID, p_item_id UUID, p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old boq_items%ROWTYPE; v_status TEXT;
BEGIN
  PERFORM assert_project_actor(p_company_id, p_user_id);
  SELECT * INTO v_old FROM boq_items WHERE id=p_item_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'بند المقايسة غير موجود'; END IF;
  SELECT status INTO v_status FROM projects WHERE id=v_old.project_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND OR v_status IN ('completed','cancelled') THEN RAISE EXCEPTION 'المشروع مغلق'; END IF;
  IF EXISTS(SELECT 1 FROM boq_items WHERE parent_id=p_item_id AND company_id=p_company_id) THEN
    RAISE EXCEPTION 'لا يمكن حذف بند مستخدم';
  END IF;
  PERFORM set_config('app.project_write_company', p_company_id::TEXT, TRUE);
  DELETE FROM boq_items WHERE id=p_item_id;
  INSERT INTO audit_log(company_id, user_id, action, entity_type, entity_id, old_values)
  VALUES(p_company_id, p_user_id, 'delete', 'boq_item', p_item_id, to_jsonb(v_old));
  RETURN jsonb_build_object('id', p_item_id, 'deleted', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_boq_item_atomic(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_boq_item_atomic(UUID, UUID, UUID) TO service_role;

DO $$
DECLARE
  t TEXT;
  n BIGINT;
  drop_list TEXT[] := ARRAY[
    'manufacturing_order_materials',
    'manufacturing_orders',
    'manufacturing_bom_lines',
    'manufacturing_boms',
    'property_maintenance',
    'property_leases',
    'properties',
    'bank_import_transactions',
    'bank_imports',
    'progress_claim_items',
    'progress_claims',
    'custody_deposits',
    'custody_settlements',
    'withholding_taxes',
    'portal_access_log',
    'telegram_actions_log'
  ];
BEGIN
  FOREACH t IN ARRAY drop_list LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'رفض حذف public.%: الجدول يحتوي على % صف', t, n;
    END IF;
  END LOOP;

  FOREACH t IN ARRAY drop_list LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('DROP TABLE public.%I', t);
    RAISE NOTICE 'dropped public.%', t;
  END LOOP;
END $$;

COMMIT;

SELECT 'Migration 102 completed — abandoned empty feature tables dropped' AS result;
