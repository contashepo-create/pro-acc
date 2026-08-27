-- ============================================================================
-- 075: Purchase invoice — additional "other expenses" line
--
-- A purchase invoice can carry extra costs that are NOT owed to the supplier
-- (freight, fuel, car rental, labour, maintenance, etc.). These increase the
-- cost base of the purchase (they are debited to the cost/inventory account
-- alongside the line items) but are credited to a payment account rather than
-- to the supplier's payable, so the supplier balance stays clean.
--
--   Debit  cost account          = items subtotal + other expenses
--   Credit supplier payable      = items subtotal (+ VAT)
--   Credit payment account       = other expenses total
--
-- The per-item cost therefore rises above the supplier's unit price, matching
-- the requested behaviour.
-- ============================================================================

ALTER TABLE purchase_invoices
  ADD COLUMN IF NOT EXISTS other_expenses_total NUMERIC(15,2) NOT NULL DEFAULT 0;

-- Resolve an account by code/optional id for an "other expense" line.
CREATE OR REPLACE FUNCTION public.resolve_other_expense_account(
  p_company_id UUID, p_code TEXT, p_account_id UUID
) RETURNS UUID LANGUAGE sql SECURITY DEFINER SET search_path=public STABLE AS $$
  SELECT id FROM accounts
  WHERE company_id=p_company_id
    AND ((p_account_id IS NOT NULL AND id=p_account_id) OR (p_account_id IS NULL AND code=COALESCE(NULLIF(p_code,''),'5400')))
    AND type='expense' AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE)
  LIMIT 1;
$$;

DROP FUNCTION IF EXISTS public.create_purchase_invoice_atomic(
  UUID,UUID,UUID,UUID,UUID,BOOLEAN,DATE,JSONB,NUMERIC,TEXT,UUID
);

CREATE OR REPLACE FUNCTION public.create_purchase_invoice_atomic(
  p_company_id UUID,p_supplier_id UUID,p_purchase_order_id UUID,p_project_id UUID,
  p_custody_id UUID,p_link_to_project BOOLEAN,p_date DATE,p_items JSONB,
  p_tax_rate NUMERIC,p_notes TEXT,p_user_id UUID,
  p_other_expenses JSONB DEFAULT '[]'::JSONB,
  p_payment_account_id UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_result JSONB;
  v_invoice_id UUID;
  v_inv_number TEXT;
  v_oe JSONB;
  v_oe_desc TEXT;
  v_oe_amount NUMERIC;
  v_oe_code TEXT;
  v_oe_account_id UUID;
  v_oe_acc UUID;
  v_other_total NUMERIC:=0;
  v_pay_acc UUID;
  v_lines JSONB:='[]'::JSONB;
  v_journal JSONB;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  PERFORM set_config('app.custody_write_company',p_company_id::TEXT,TRUE);

  -- Validate other expenses first so nothing is partially committed.
  IF jsonb_typeof(COALESCE(p_other_expenses,'[]'::JSONB))<>'array' OR jsonb_array_length(p_other_expenses)>100
  THEN RAISE EXCEPTION 'بيانات المصروفات الإضافية غير صالحة'; END IF;
  FOR v_oe IN SELECT value FROM jsonb_array_elements(COALESCE(p_other_expenses,'[]'::JSONB)) LOOP
    BEGIN
      v_oe_amount:=(v_oe->>'amount')::NUMERIC;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'مبلغ مصروف إضافي غير صالح'; END;
    v_oe_desc:=COALESCE(BTRIM(v_oe->>'description'),'');
    v_oe_code:=COALESCE(v_oe->>'account_code','5400');
    IF NULLIF(v_oe_desc,'') IS NULL OR LENGTH(v_oe_desc)>200 OR v_oe_amount IS NULL OR v_oe_amount<=0
      OR v_oe_amount<>ROUND(v_oe_amount,2) THEN RAISE EXCEPTION 'بند مصروف إضافي غير صالح'; END IF;
    v_other_total:=v_other_total+v_oe_amount;
  END LOOP;

  v_result:=create_purchase_invoice_atomic_v55_internal(p_company_id,p_supplier_id,p_purchase_order_id,
    p_project_id,p_custody_id,p_link_to_project,p_date,p_items,p_tax_rate,p_notes,p_user_id);
  v_invoice_id:=(v_result->>'id')::UUID;
  v_inv_number:=COALESCE(v_result->>'invoice_number',v_result->>'number');

  IF v_other_total>0 THEN
    IF p_payment_account_id IS NOT NULL THEN
      SELECT id INTO v_pay_acc FROM accounts WHERE id=p_payment_account_id AND company_id=p_company_id
        AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
      IF v_pay_acc IS NULL THEN RAISE EXCEPTION 'حساب دفع المصروفات الإضافية غير صالح'; END IF;
    ELSE
      SELECT id INTO v_pay_acc FROM accounts WHERE company_id=p_company_id AND code='1110'
        AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
      IF v_pay_acc IS NULL THEN RAISE EXCEPTION 'حساب دفع المصروفات الإضافية غير موجود'; END IF;
    END IF;
    FOR v_oe IN SELECT value FROM jsonb_array_elements(p_other_expenses) LOOP
      v_oe_amount:=(v_oe->>'amount')::NUMERIC;
      v_oe_desc:=COALESCE(BTRIM(v_oe->>'description'),'');
      v_oe_code:=COALESCE(v_oe->>'account_code','5400');
      v_oe_account_id:=NULLIF(v_oe->>'account_id','')::UUID;
      v_oe_acc:=resolve_other_expense_account(p_company_id,v_oe_code,v_oe_account_id);
      IF v_oe_acc IS NULL THEN RAISE EXCEPTION 'حساب مصروف «%» غير موجود', v_oe_code; END IF;
      v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
        'accountId',v_oe_acc,'debit',v_oe_amount,'credit',0,'description',v_oe_desc,'projectId',(v_result->>'project_id')::UUID));
    END LOOP;
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
      'accountId',v_pay_acc,'debit',0,'credit',v_other_total,'description','مصاريف إضافية فاتورة '||v_inv_number));
    v_journal:=create_journal_entry(p_company_id,p_date,'general','مصاريف إضافية فاتورة '||v_inv_number,p_user_id,v_lines);
    UPDATE purchase_invoices SET other_expenses_total=v_other_total WHERE id=v_invoice_id AND company_id=p_company_id;
  END IF;

  RETURN v_result||jsonb_build_object('other_expenses_total',v_other_total,
    'other_expenses_journal_entry_id',CASE WHEN v_journal IS NULL THEN NULL ELSE v_journal->>'id' END);
END;
$$;

REVOKE ALL ON FUNCTION public.create_purchase_invoice_atomic(UUID,UUID,UUID,UUID,UUID,BOOLEAN,DATE,JSONB,NUMERIC,TEXT,UUID,JSONB,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_purchase_invoice_atomic(UUID,UUID,UUID,UUID,UUID,BOOLEAN,DATE,JSONB,NUMERIC,TEXT,UUID,JSONB,UUID) TO service_role;
