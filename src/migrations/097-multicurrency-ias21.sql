-- ============================================================
-- 097: العملات المتعددة — فواتير بعملة أجنبية وفروق عملة محققة (IAS 21)
-- ------------------------------------------------------------
-- الفجوة (4 من التدقيق العالمي): بنية العملات موجودة (جدول
-- currencies وأعمدة journal_lines) لكن لا تدفق مستندي.
-- الحل:
--  1) أعمدة currency_code/exchange_rate على invoices وvoucher_receipts
--     وحسابا 4210 أرباح فروق العملة و5450 خسائرها لكل شركة.
--  2) فاتورة المبيعات تقبل عملة وسعر صرف تاريخيًا: المبالغ تُسجل
--     بعملة الأساس، وتُوسم سطور القيد بالعملة والسعر.
--  3) سند القبض (الإنشاء والاعتماد): عند تسوية فاتورة أجنبية بسعر
--     أقدم، يُحسب الفرق المحقق = مبلغ × (سعر السند − سعر الفاتورة)/سعر
--     السند ويُرحّل ربحًا (4210) أو خسارة (5450)، ويُخصم من الذمم
--     بسعر الفاتورة ليظل القيد متوازنًا والذمم بمعدل التسجيل.
-- ============================================================

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS currency_code TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(15,6) DEFAULT 1;
ALTER TABLE voucher_receipts ADD COLUMN IF NOT EXISTS currency_code TEXT;
ALTER TABLE voucher_receipts ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(15,6) DEFAULT 1;

INSERT INTO accounts(company_id, code, name, type, is_active, is_header)
SELECT c.id, x.code, x.name, x.acc_type, TRUE, FALSE
FROM companies c
CROSS JOIN (VALUES
  ('4210', 'أرباح فروق العملة', 'revenue'),
  ('5450', 'خسائر فروق العملة', 'expense')
) AS x(code, name, acc_type)
WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.company_id = c.id AND a.code = x.code);

CREATE OR REPLACE FUNCTION public.create_sales_invoice_atomic(
  p_company_id UUID,
  p_contact_id UUID,
  p_project_id UUID,
  p_date DATE,
  p_due_date DATE,
  p_items JSONB,
  p_vat_rate NUMERIC,
  p_vat_enabled BOOLEAN,
  p_notes TEXT,
  p_collected_amount NUMERIC,
  p_bank_safe_id UUID,
  p_user_id UUID,
  p_currency_code TEXT DEFAULT NULL,
  p_exchange_rate NUMERIC DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_invoice invoices%ROWTYPE;
  v_item JSONB;
  v_number INT;
  v_qty NUMERIC;
  v_price NUMERIC;
  v_discount NUMERIC;
  v_gross NUMERIC;
  v_subtotal NUMERIC(15, 2) := 0;
  v_vat NUMERIC(15, 2);
  v_total NUMERIC(15, 2);
  v_ar UUID;
  v_revenue UUID;
  v_vat_account UUID;
  v_journal JSONB;
  v_journal_id UUID;
  v_lines JSONB;
  v_receipt JSONB;
  v_currency_id UUID; v_rate NUMERIC; v_currency_code TEXT;
BEGIN
  IF p_date IS NULL OR p_due_date IS NULL OR p_due_date < p_date
    OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0
    OR jsonb_array_length(p_items) > 200 OR p_vat_rate < 0 OR p_vat_rate > 1
    OR p_collected_amount < 0 OR p_collected_amount <> round(p_collected_amount, 2)
  THEN RAISE EXCEPTION 'بيانات الفاتورة غير صالحة'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = p_user_id AND company_id = p_company_id AND is_active = TRUE
  ) THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM contacts
    WHERE id = p_contact_id AND company_id = p_company_id AND COALESCE(is_active, TRUE)
  ) THEN RAISE EXCEPTION 'العميل غير موجود'; END IF;

  IF p_project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM projects WHERE id = p_project_id AND company_id = p_company_id
  ) THEN RAISE EXCEPTION 'المشروع غير موجود'; END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    BEGIN
      v_qty := (v_item->>'quantity')::NUMERIC;
      v_price := (v_item->>'unitPrice')::NUMERIC;
      v_discount := COALESCE((v_item->>'discount')::NUMERIC, 0);
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'بند فاتورة غير صالح';
    END;
    v_gross := round(v_qty * v_price, 2);
    IF NULLIF(btrim(v_item->>'description'), '') IS NULL
      OR length(v_item->>'description') > 500 OR v_qty <= 0 OR v_price < 0
      OR v_discount < 0 OR v_discount > 100
    THEN RAISE EXCEPTION 'بند فاتورة غير صالح'; END IF;
    v_subtotal := v_subtotal + round(v_gross - round(v_gross * v_discount / 100, 2), 2);
  END LOOP;

  v_subtotal := round(v_subtotal, 2);
  v_vat := CASE WHEN COALESCE(p_vat_enabled, TRUE)
    THEN round(v_subtotal * p_vat_rate, 2) ELSE 0 END;
  v_total := round(v_subtotal + v_vat, 2);

  IF p_collected_amount > v_total + 0.005
    OR (p_collected_amount > 0 AND p_bank_safe_id IS NULL)
  THEN RAISE EXCEPTION 'مبلغ التحصيل غير صالح'; END IF;

  IF p_currency_code IS NOT NULL THEN
    v_currency_code := UPPER(BTRIM(p_currency_code));
    SELECT id INTO v_currency_id FROM currencies
    WHERE company_id = p_company_id AND code = v_currency_code;
    IF v_currency_id IS NULL THEN RAISE EXCEPTION 'العملة المحددة غير موجودة لهذه الشركة'; END IF;
    v_rate := COALESCE(p_exchange_rate, (SELECT rate FROM currencies WHERE id = v_currency_id));
    IF v_rate IS NULL OR v_rate <= 0 THEN RAISE EXCEPTION 'سعر الصرف غير صالح'; END IF;
  END IF;
  IF p_exchange_rate IS NOT NULL AND p_exchange_rate <= 0 THEN
    RAISE EXCEPTION 'سعر الصرف غير صالح';
  END IF;

  v_number := next_invoice_number(p_company_id, extract(year FROM p_date)::INT);
  INSERT INTO invoices(
    company_id, number, contact_id, project_id, date, due_date, subtotal,
    vat_rate, vat_amount, total, paid_amount, status, notes, created_by,
    currency_code, exchange_rate
  ) VALUES (
    p_company_id, v_number, p_contact_id, p_project_id, p_date, p_due_date,
    v_subtotal, p_vat_rate, v_vat, v_total, 0, 'unpaid',
    NULLIF(btrim(p_notes), ''), p_user_id,
    v_currency_code, COALESCE(v_rate, 1)
  ) RETURNING * INTO v_invoice;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'quantity')::NUMERIC;
    v_price := (v_item->>'unitPrice')::NUMERIC;
    v_discount := COALESCE((v_item->>'discount')::NUMERIC, 0);
    INSERT INTO invoice_items(
      company_id, invoice_id, description, quantity, unit_price, total, inventory_item_id
    ) VALUES (
      p_company_id, v_invoice.id, btrim(v_item->>'description'), v_qty,
      v_price, round(v_qty * v_price - round(v_qty * v_price * v_discount / 100, 2), 2),
      (NULLIF(COALESCE(v_item->>'inventory_item_id', ''), ''))::UUID
    );
  END LOOP;

  -- تكلفة البضاعة المباعة: خصم المستودع + قيد 5100/1170 بنفس المعاملة
  PERFORM consume_invoice_stock_internal(
    p_company_id, v_invoice.id, v_number, p_items, p_date, p_user_id
  );

  -- A zero-value invoice is a document but not an economic event.
  IF v_total > 0 THEN
    SELECT id INTO v_ar FROM accounts
    WHERE company_id = p_company_id AND code = '1130'
      AND COALESCE(is_active, TRUE) AND NOT COALESCE(is_header, FALSE);
    SELECT id INTO v_revenue FROM accounts
    WHERE company_id = p_company_id AND code = '4100'
      AND COALESCE(is_active, TRUE) AND NOT COALESCE(is_header, FALSE);
    IF v_ar IS NULL OR v_revenue IS NULL THEN
      RAISE EXCEPTION 'حسابات المبيعات غير مكتملة';
    END IF;

    v_lines := jsonb_build_array(
      jsonb_build_object(
        'accountId', v_ar, 'debit', v_total, 'credit', 0,
        'contactId', p_contact_id, 'projectId', p_project_id
      ),
      jsonb_build_object(
        'accountId', v_revenue, 'debit', 0, 'credit', v_subtotal,
        'contactId', p_contact_id, 'projectId', p_project_id
      )
    );
    IF v_vat > 0 THEN
      SELECT id INTO v_vat_account FROM accounts
      WHERE company_id = p_company_id AND code = '2120'
        AND COALESCE(is_active, TRUE) AND NOT COALESCE(is_header, FALSE);
      IF v_vat_account IS NULL THEN RAISE EXCEPTION 'حساب ضريبة المبيعات غير موجود'; END IF;
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'accountId', v_vat_account, 'debit', 0, 'credit', v_vat,
        'contactId', p_contact_id
      ));
    END IF;

    v_journal := create_journal_entry(
      p_company_id, p_date, 'general', 'فاتورة مبيعات رقم ' || v_number,
      p_user_id, v_lines
    );
    v_journal_id := (v_journal->>'id')::UUID;
    UPDATE journal_entries
      SET reference_type = 'invoice', reference_id = v_invoice.id
      WHERE id = v_journal_id AND company_id = p_company_id;
    UPDATE invoices SET journal_entry_id = v_journal_id
      WHERE id = v_invoice.id RETURNING * INTO v_invoice;
    -- وسم سطور القيد بالعملة وسعر الصرف التاريخي (IAS 21)
    IF v_currency_id IS NOT NULL THEN
      UPDATE journal_lines SET currency_id = v_currency_id, exchange_rate = v_rate,
        amount_in_base_currency = CASE WHEN debit > 0 THEN debit ELSE credit END
      WHERE journal_entry_id = v_journal_id AND company_id = p_company_id;
    END IF;
  END IF;

  -- Reuse the authoritative receipt writer so collection, allocation and its
  -- journal remain in this same outer transaction.
  IF p_collected_amount > 0 THEN
    v_receipt := create_voucher_receipt_atomic(
      p_company_id, p_date, 'client', p_contact_id, p_collected_amount,
      p_bank_safe_id, 'تحصيل فوري لفاتورة مبيعات رقم ' || v_number,
      jsonb_build_array(jsonb_build_object(
        'invoice_id', v_invoice.id, 'amount', p_collected_amount
      )), FALSE, FALSE, p_user_id
    );
    SELECT * INTO v_invoice FROM invoices WHERE id = v_invoice.id;
  END IF;

  INSERT INTO audit_log(company_id, user_id, action, entity_type, entity_id, new_values)
  VALUES(p_company_id, p_user_id, 'create', 'invoice', v_invoice.id, to_jsonb(v_invoice));

  RETURN to_jsonb(v_invoice) || jsonb_build_object(
    'journal_entry_id', v_journal_id,
    'voucher_receipt_id', v_receipt->>'id'
  );
END;
$$;
CREATE OR REPLACE FUNCTION public.create_voucher_receipt_atomic(
  p_company_id UUID,p_date DATE,p_receipt_type TEXT,p_contact_id UUID,p_amount NUMERIC,
  p_bank_safe_id UUID,p_reason TEXT,p_allocations JSONB,p_auto_fifo BOOLEAN,
  p_request_approval BOOLEAN,p_user_id UUID,
  p_project_id UUID DEFAULT NULL,
  p_currency_code TEXT DEFAULT NULL,p_exchange_rate NUMERIC DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_bank banks_safes%ROWTYPE; v_receipt voucher_receipts%ROWTYPE; v_number INTEGER; v_counterpart UUID;
 v_journal JSONB; v_journal_id UUID; v_item JSONB; v_invoice invoices%ROWTYPE; v_alloc NUMERIC;
 v_alloc_total NUMERIC:=0; v_applied NUMERIC:=0; v_remaining NUMERIC; v_new_paid NUMERIC; v_approval approval_requests%ROWTYPE;
 v_fx NUMERIC; v_fx_total NUMERIC:=0; v_relief_total NUMERIC:=0; v_relief NUMERIC;
 v_currency_id UUID; v_fx_gain UUID; v_fx_loss UUID; v_lines JSONB;
BEGIN
 IF p_date IS NULL OR p_receipt_type NOT IN ('client','supplier_refund','general') OR p_amount<=0 OR p_amount<>ROUND(p_amount,2)
  OR NULLIF(BTRIM(p_reason),'') IS NULL OR LENGTH(p_reason)>500 OR jsonb_typeof(p_allocations)<>'array' OR jsonb_array_length(p_allocations)>100 THEN RAISE EXCEPTION 'بيانات سند القبض غير صالحة'; END IF;
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE) THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
 IF p_contact_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM contacts WHERE id=p_contact_id AND company_id=p_company_id) THEN RAISE EXCEPTION 'الطرف غير موجود'; END IF;
 IF p_project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM projects WHERE id=p_project_id AND company_id=p_company_id) THEN RAISE EXCEPTION 'المشروع غير موجود'; END IF;
 SELECT * INTO v_bank FROM banks_safes WHERE id=p_bank_safe_id AND company_id=p_company_id AND is_active=TRUE FOR UPDATE;
 IF NOT FOUND OR v_bank.account_id IS NULL THEN RAISE EXCEPTION 'البنك أو الخزينة غير موجود'; END IF;
 SELECT id INTO v_counterpart FROM accounts WHERE company_id=p_company_id AND code=CASE p_receipt_type WHEN 'client' THEN '1130' WHEN 'supplier_refund' THEN '2110' ELSE '4200' END
  AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
 IF v_counterpart IS NULL OR v_counterpart=v_bank.account_id THEN RAISE EXCEPTION 'الحساب المقابل غير صالح'; END IF;
 IF p_currency_code IS NOT NULL THEN
  SELECT id INTO v_currency_id FROM currencies WHERE company_id=p_company_id AND code=UPPER(BTRIM(p_currency_code));
  IF v_currency_id IS NULL THEN RAISE EXCEPTION 'العملة المحددة غير موجودة لهذه الشركة'; END IF;
  IF p_exchange_rate IS NULL THEN
   SELECT rate INTO p_exchange_rate FROM currencies WHERE id=v_currency_id;
  END IF;
 END IF;
 IF p_exchange_rate IS NOT NULL AND p_exchange_rate<=0 THEN RAISE EXCEPTION 'سعر الصرف غير صالح'; END IF;
 FOR v_item IN SELECT value FROM jsonb_array_elements(p_allocations) LOOP
  BEGIN v_alloc:=(v_item->>'amount')::NUMERIC; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'مبلغ التخصيص غير صالح'; END;
  IF NULLIF(v_item->>'invoice_id','') IS NULL OR v_alloc<=0 OR v_alloc<>ROUND(v_alloc,2) THEN RAISE EXCEPTION 'بيانات التخصيص غير صالحة'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_allocations) x WHERE x->>'invoice_id'=v_item->>'invoice_id' GROUP BY x->>'invoice_id' HAVING COUNT(*)>1) THEN RAISE EXCEPTION 'تخصيص فاتورة مكرر'; END IF;
  SELECT * INTO v_invoice FROM invoices WHERE id=(v_item->>'invoice_id')::UUID AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND OR v_invoice.status IN ('cancelled','paid') OR (p_contact_id IS NOT NULL AND v_invoice.contact_id<>p_contact_id)
    OR v_invoice.paid_amount+v_alloc>v_invoice.total+0.005 THEN RAISE EXCEPTION 'فاتورة البيع غير صالحة للتخصيص'; END IF;
  v_alloc_total:=v_alloc_total+v_alloc;
  -- IAS 21: فروق العملة المحققة عند تسوية فاتورة مُسجّلة بسعر أقدم
  v_relief:=v_alloc;
  IF v_invoice.currency_code IS NOT NULL AND p_exchange_rate IS NOT NULL
    AND p_exchange_rate<>COALESCE(v_invoice.exchange_rate,1) THEN
   v_fx:=ROUND(v_alloc*(p_exchange_rate-COALESCE(v_invoice.exchange_rate,1))/p_exchange_rate,2);
   v_relief:=ROUND(v_alloc-v_fx,2);
   v_fx_total:=v_fx_total+v_fx;
  END IF;
  v_relief_total:=v_relief_total+v_relief;
 END LOOP;
 IF v_alloc_total>p_amount+0.005 THEN RAISE EXCEPTION 'مجموع التخصيصات يتجاوز مبلغ السند'; END IF;
 v_number:=next_voucher_number(p_company_id,'voucher_receipts');
 INSERT INTO voucher_receipts(company_id,number,date,receipt_type,contact_id,amount,bank_safe_id,reason,created_by,status,auto_allocate_fifo,project_id,currency_code,exchange_rate)
 VALUES(p_company_id,v_number,p_date,p_receipt_type,p_contact_id,p_amount,p_bank_safe_id,BTRIM(p_reason),p_user_id,
   CASE WHEN p_request_approval THEN 'pending' ELSE 'approved' END,COALESCE(p_auto_fifo,FALSE),p_project_id,
   CASE WHEN v_currency_id IS NOT NULL THEN UPPER(BTRIM(p_currency_code)) END,p_exchange_rate) RETURNING * INTO v_receipt;

 IF p_request_approval THEN
  INSERT INTO approval_requests(company_id,transaction_type,transaction_id,entity_type,entity_id,amount,requester_id,status,message,description)
  VALUES(p_company_id,'voucher_receipt',v_receipt.id::TEXT,'voucher_receipt',v_receipt.id,p_amount,p_user_id,'pending',BTRIM(p_reason),BTRIM(p_reason)) RETURNING * INTO v_approval;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_allocations) LOOP
   INSERT INTO receipt_invoice_items(company_id,voucher_receipt_id,invoice_id,amount,journal_entry_id)
   VALUES(p_company_id,v_receipt.id,(v_item->>'invoice_id')::UUID,(v_item->>'amount')::NUMERIC,NULL);
  END LOOP;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'request_approval','voucher_receipt',v_receipt.id,jsonb_build_object('approval_id',v_approval.id,'amount',p_amount));
  RETURN to_jsonb(v_receipt)||jsonb_build_object('requires_approval',TRUE,'approval_id',v_approval.id);
 END IF;

 v_lines:=jsonb_build_array(
  jsonb_build_object('accountId',v_bank.account_id,'debit',p_amount,'credit',0,'projectId',p_project_id),
  jsonb_build_object('accountId',v_counterpart,'debit',0,'credit',ROUND((p_amount-v_alloc_total)+v_relief_total,2),'contactId',p_contact_id,'projectId',p_project_id));
 IF v_fx_total>0.005 THEN
  SELECT id INTO v_fx_gain FROM accounts WHERE company_id=p_company_id AND code='4210' AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
  IF v_fx_gain IS NULL THEN RAISE EXCEPTION 'حساب أرباح فروق العملة (4210) غير موجود'; END IF;
  v_lines:=v_lines||jsonb_build_array(jsonb_build_object('accountId',v_fx_gain,'debit',0,'credit',v_fx_total,'description','أرباح فروق عملة محققة'));
 ELSIF v_fx_total<-0.005 THEN
  SELECT id INTO v_fx_loss FROM accounts WHERE company_id=p_company_id AND code='5450' AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
  IF v_fx_loss IS NULL THEN RAISE EXCEPTION 'حساب خسائر فروق العملة (5450) غير موجود'; END IF;
  v_lines:=v_lines||jsonb_build_array(jsonb_build_object('accountId',v_fx_loss,'debit',-v_fx_total,'credit',0,'description','خسائر فروق عملة محققة'));
 END IF;
 v_journal:=create_journal_entry(p_company_id,p_date,'general','سند قبض رقم '||v_number||': '||BTRIM(p_reason),p_user_id,v_lines);
 v_journal_id:=(v_journal->>'id')::UUID;
 UPDATE journal_entries SET reference_type='voucher_receipt',reference_id=v_receipt.id WHERE id=v_journal_id AND company_id=p_company_id;
 IF v_currency_id IS NOT NULL THEN
  UPDATE journal_lines SET currency_id=v_currency_id,exchange_rate=p_exchange_rate,
   amount_in_base_currency=CASE WHEN debit>0 THEN debit ELSE credit END
  WHERE journal_entry_id=v_journal_id AND company_id=p_company_id;
 END IF;
 FOR v_item IN SELECT value FROM jsonb_array_elements(p_allocations) LOOP
  SELECT * INTO v_invoice FROM invoices WHERE id=(v_item->>'invoice_id')::UUID AND company_id=p_company_id FOR UPDATE;
  v_alloc:=(v_item->>'amount')::NUMERIC; v_new_paid:=ROUND(v_invoice.paid_amount+v_alloc,2);
  UPDATE invoices SET paid_amount=v_new_paid,status=CASE WHEN v_new_paid>=v_invoice.total-0.005 THEN 'paid' ELSE 'partial' END WHERE id=v_invoice.id;
  INSERT INTO receipt_invoice_items(company_id,voucher_receipt_id,invoice_id,amount,journal_entry_id) VALUES(p_company_id,v_receipt.id,v_invoice.id,v_alloc,v_journal_id);
  v_applied:=v_applied+v_alloc;
 END LOOP;
 IF jsonb_array_length(p_allocations)=0 AND p_auto_fifo AND p_receipt_type='client' AND p_contact_id IS NOT NULL THEN
  v_remaining:=p_amount;
  FOR v_invoice IN SELECT * FROM invoices WHERE company_id=p_company_id AND contact_id=p_contact_id AND status NOT IN ('cancelled','paid') ORDER BY date,number FOR UPDATE LOOP
   EXIT WHEN v_remaining<=0.005;
   v_alloc:=LEAST(v_remaining,ROUND(v_invoice.total-v_invoice.paid_amount,2)); CONTINUE WHEN v_alloc<=0;
   v_new_paid:=ROUND(v_invoice.paid_amount+v_alloc,2);
   UPDATE invoices SET paid_amount=v_new_paid,status=CASE WHEN v_new_paid>=v_invoice.total-0.005 THEN 'paid' ELSE 'partial' END WHERE id=v_invoice.id;
   INSERT INTO receipt_invoice_items(company_id,voucher_receipt_id,invoice_id,amount,journal_entry_id) VALUES(p_company_id,v_receipt.id,v_invoice.id,v_alloc,v_journal_id);
   v_applied:=v_applied+v_alloc; v_remaining:=v_remaining-v_alloc;
  END LOOP;
 END IF;
 UPDATE voucher_receipts SET journal_entry_id=v_journal_id WHERE id=v_receipt.id RETURNING * INTO v_receipt;
 INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values) VALUES(p_company_id,p_user_id,'post','voucher_receipt',v_receipt.id,to_jsonb(v_receipt));
 RETURN to_jsonb(v_receipt)||jsonb_build_object('requires_approval',FALSE,'allocated_amount',ROUND(v_applied,2),'unapplied_amount',ROUND(p_amount-v_applied,2));
END;
$$;

-- إزالة التوقيع القديم (12 وسيطاً + المشروع) لمنع الالتباس مع نسخة العملات
DROP FUNCTION IF EXISTS public.create_voucher_receipt_atomic(UUID,DATE,TEXT,UUID,NUMERIC,UUID,TEXT,JSONB,BOOLEAN,BOOLEAN,UUID,UUID);
REVOKE ALL ON FUNCTION public.create_voucher_receipt_atomic(UUID,DATE,TEXT,UUID,NUMERIC,UUID,TEXT,JSONB,BOOLEAN,BOOLEAN,UUID,UUID,TEXT,NUMERIC) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_voucher_receipt_atomic(UUID,DATE,TEXT,UUID,NUMERIC,UUID,TEXT,JSONB,BOOLEAN,BOOLEAN,UUID,UUID,TEXT,NUMERIC) TO service_role;

CREATE OR REPLACE FUNCTION public.respond_voucher_receipt_approval_v49_internal(
 p_company_id UUID,p_approval_id UUID,p_action TEXT,p_approver_user_id UUID,p_approver_chat_id TEXT,p_comments TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_request approval_requests%ROWTYPE; v_receipt voucher_receipts%ROWTYPE; v_bank banks_safes%ROWTYPE; v_counterpart UUID;
 v_journal JSONB; v_journal_id UUID; v_link receipt_invoice_items%ROWTYPE; v_invoice invoices%ROWTYPE;
 v_alloc NUMERIC; v_new_paid NUMERIC; v_remaining NUMERIC; v_actor UUID;
 v_fx NUMERIC; v_fx_total NUMERIC:=0; v_relief_total NUMERIC:=0; v_link_total NUMERIC:=0;
 v_fx_gain UUID; v_fx_loss UUID; v_lines JSONB;
BEGIN
 IF p_action NOT IN ('approve','reject') OR LENGTH(COALESCE(p_comments,''))>2000 THEN RAISE EXCEPTION 'قرار الاعتماد غير صالح'; END IF;
 SELECT * INTO v_request FROM approval_requests WHERE id=p_approval_id AND company_id=p_company_id FOR UPDATE;
 IF NOT FOUND OR v_request.status<>'pending' OR v_request.transaction_type<>'voucher_receipt' THEN RAISE EXCEPTION 'طلب الاعتماد غير موجود أو تمت معالجته'; END IF;
 IF p_approver_user_id IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_approver_user_id AND company_id=p_company_id AND is_active=TRUE
    AND (role='admin' OR p_approver_user_id=v_request.approver_id)) THEN RAISE EXCEPTION 'المستخدم غير مخول بالاعتماد'; END IF;
  v_actor:=p_approver_user_id;
 ELSIF NULLIF(p_approver_chat_id,'') IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM company_telegram_configs WHERE company_id=p_company_id AND approvals_enabled=TRUE AND chat_id=p_approver_chat_id) THEN RAISE EXCEPTION 'حساب تيليجرام غير مخول'; END IF;
  v_actor:=v_request.requester_id;
 ELSE RAISE EXCEPTION 'هوية المعتمد مطلوبة'; END IF;
 SELECT * INTO v_receipt FROM voucher_receipts WHERE id=COALESCE(v_request.entity_id,v_request.transaction_id::UUID) AND company_id=p_company_id FOR UPDATE;
 IF NOT FOUND OR v_receipt.status<>'pending' OR v_receipt.journal_entry_id IS NOT NULL THEN RAISE EXCEPTION 'سند القبض ليس معلقاً'; END IF;
 IF p_action='reject' THEN
  UPDATE voucher_receipts SET status='rejected' WHERE id=v_receipt.id;
  UPDATE approval_requests SET status='rejected',approved_by=p_approver_user_id,approver_chat_id=p_approver_chat_id,approved_at=NOW(),approval_comments=NULLIF(BTRIM(p_comments),''),updated_at=NOW() WHERE id=p_approval_id;
  INSERT INTO notifications(company_id,user_id,type,title,message,entity_type,entity_id) VALUES(p_company_id,v_request.requester_id,'warning','تم رفض طلبك','سند قبض - تم الرفض','approval_request',p_approval_id);
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values) VALUES(p_company_id,v_actor,'reject_approval','approval_request',p_approval_id,jsonb_build_object('voucher_id',v_receipt.id,'chat_id',p_approver_chat_id));
  RETURN jsonb_build_object('status','rejected','voucher_id',v_receipt.id,'requester_id',v_request.requester_id);
 END IF;
 SELECT * INTO v_bank FROM banks_safes WHERE id=v_receipt.bank_safe_id AND company_id=p_company_id AND is_active=TRUE FOR UPDATE;
 IF NOT FOUND OR v_bank.account_id IS NULL THEN RAISE EXCEPTION 'البنك أو الخزينة غير صالح'; END IF;
 SELECT id INTO v_counterpart FROM accounts WHERE company_id=p_company_id AND code=CASE v_receipt.receipt_type WHEN 'client' THEN '1130' WHEN 'supplier_refund' THEN '2110' ELSE '4200' END
  AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
 IF v_counterpart IS NULL OR v_counterpart=v_bank.account_id THEN RAISE EXCEPTION 'الحساب المقابل غير صالح'; END IF;
 FOR v_link IN SELECT * FROM receipt_invoice_items WHERE company_id=p_company_id AND voucher_receipt_id=v_receipt.id FOR UPDATE LOOP
  SELECT * INTO v_invoice FROM invoices WHERE id=v_link.invoice_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND OR v_invoice.status IN ('cancelled','paid') OR (v_receipt.contact_id IS NOT NULL AND v_invoice.contact_id<>v_receipt.contact_id)
    OR v_invoice.paid_amount+v_link.amount>invoice_net_total(p_company_id,v_invoice.id)+0.005 THEN RAISE EXCEPTION 'تعذر تطبيق تخصيص فاتورة البيع'; END IF;
  v_link_total:=v_link_total+v_link.amount;
  IF v_invoice.currency_code IS NOT NULL AND v_receipt.exchange_rate IS NOT NULL
    AND v_receipt.exchange_rate<>COALESCE(v_invoice.exchange_rate,1) THEN
   v_fx:=ROUND(v_link.amount*(v_receipt.exchange_rate-COALESCE(v_invoice.exchange_rate,1))/v_receipt.exchange_rate,2);
   v_fx_total:=v_fx_total+v_fx;
   v_relief_total:=v_relief_total+v_link.amount-v_fx;
  ELSE
   v_relief_total:=v_relief_total+v_link.amount;
  END IF;
 END LOOP;
 v_lines:=jsonb_build_array(
  jsonb_build_object('accountId',v_bank.account_id,'debit',v_receipt.amount,'credit',0),
  jsonb_build_object('accountId',v_counterpart,'debit',0,'credit',ROUND((v_receipt.amount-v_link_total)+v_relief_total,2),'contactId',v_receipt.contact_id));
 IF v_fx_total>0.005 THEN
  SELECT id INTO v_fx_gain FROM accounts WHERE company_id=p_company_id AND code='4210' AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
  IF v_fx_gain IS NULL THEN RAISE EXCEPTION 'حساب أرباح فروق العملة (4210) غير موجود'; END IF;
  v_lines:=v_lines||jsonb_build_array(jsonb_build_object('accountId',v_fx_gain,'debit',0,'credit',v_fx_total,'description','أرباح فروق عملة محققة'));
 ELSIF v_fx_total<-0.005 THEN
  SELECT id INTO v_fx_loss FROM accounts WHERE company_id=p_company_id AND code='5450' AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
  IF v_fx_loss IS NULL THEN RAISE EXCEPTION 'حساب خسائر فروق العملة (5450) غير موجود'; END IF;
  v_lines:=v_lines||jsonb_build_array(jsonb_build_object('accountId',v_fx_loss,'debit',-v_fx_total,'credit',0,'description','خسائر فروق عملة محققة'));
 END IF;
 v_journal:=create_journal_entry(p_company_id,v_receipt.date,'general','سند قبض رقم '||v_receipt.number||': '||v_receipt.reason,v_request.requester_id,v_lines);
 v_journal_id:=(v_journal->>'id')::UUID;
 UPDATE journal_entries SET reference_type='voucher_receipt',reference_id=v_receipt.id WHERE id=v_journal_id AND company_id=p_company_id;
 FOR v_link IN SELECT * FROM receipt_invoice_items WHERE company_id=p_company_id AND voucher_receipt_id=v_receipt.id FOR UPDATE LOOP
  SELECT * INTO v_invoice FROM invoices WHERE id=v_link.invoice_id AND company_id=p_company_id FOR UPDATE;
  v_new_paid:=ROUND(v_invoice.paid_amount+v_link.amount,2);
  UPDATE invoices SET paid_amount=v_new_paid,status=CASE WHEN v_new_paid>=invoice_net_total(p_company_id,v_invoice.id)-0.005 THEN 'paid' ELSE 'partial' END WHERE id=v_invoice.id;
  UPDATE receipt_invoice_items SET journal_entry_id=v_journal_id WHERE id=v_link.id;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM receipt_invoice_items WHERE company_id=p_company_id AND voucher_receipt_id=v_receipt.id)
   AND v_receipt.auto_allocate_fifo AND v_receipt.receipt_type='client' AND v_receipt.contact_id IS NOT NULL THEN
  v_remaining:=v_receipt.amount;
  FOR v_invoice IN SELECT * FROM invoices WHERE company_id=p_company_id AND contact_id=v_receipt.contact_id AND status NOT IN ('cancelled','paid') ORDER BY date,number FOR UPDATE LOOP
   EXIT WHEN v_remaining<=0.005; v_alloc:=LEAST(v_remaining,GREATEST(0,ROUND(invoice_net_total(p_company_id,v_invoice.id)-v_invoice.paid_amount,2))); CONTINUE WHEN v_alloc<=0;
   v_new_paid:=ROUND(v_invoice.paid_amount+v_alloc,2);
   UPDATE invoices SET paid_amount=v_new_paid,status=CASE WHEN v_new_paid>=invoice_net_total(p_company_id,v_invoice.id)-0.005 THEN 'paid' ELSE 'partial' END WHERE id=v_invoice.id;
   INSERT INTO receipt_invoice_items(company_id,voucher_receipt_id,invoice_id,amount,journal_entry_id) VALUES(p_company_id,v_receipt.id,v_invoice.id,v_alloc,v_journal_id);
   v_remaining:=v_remaining-v_alloc;
  END LOOP;
 END IF;
 UPDATE voucher_receipts SET status='approved',journal_entry_id=v_journal_id WHERE id=v_receipt.id RETURNING * INTO v_receipt;
 UPDATE approval_requests SET status='approved',approved_by=p_approver_user_id,approver_chat_id=p_approver_chat_id,approved_at=NOW(),approval_comments=NULLIF(BTRIM(p_comments),''),updated_at=NOW() WHERE id=p_approval_id;
 INSERT INTO notifications(company_id,user_id,type,title,message,entity_type,entity_id) VALUES(p_company_id,v_request.requester_id,'success','تم اعتماد طلبك','سند قبض - تم الاعتماد بنجاح','approval_request',p_approval_id);
 INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values) VALUES(p_company_id,v_actor,'approve_approval','approval_request',p_approval_id,jsonb_build_object('voucher_id',v_receipt.id,'journal_entry_id',v_journal_id,'chat_id',p_approver_chat_id));
 RETURN jsonb_build_object('status','approved','voucher_id',v_receipt.id,'journal_entry_id',v_journal_id,'requester_id',v_request.requester_id);
END;
$$;

-- إزالة التوقيع القديم (12 وسيطاً) لمنع الالتباس مع نسخة العملات
DROP FUNCTION IF EXISTS public.create_sales_invoice_atomic(UUID,UUID,UUID,DATE,DATE,JSONB,NUMERIC,BOOLEAN,TEXT,NUMERIC,UUID,UUID);
REVOKE ALL ON FUNCTION public.create_sales_invoice_atomic(UUID,UUID,UUID,DATE,DATE,JSONB,NUMERIC,BOOLEAN,TEXT,NUMERIC,UUID,UUID,TEXT,NUMERIC) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_sales_invoice_atomic(UUID,UUID,UUID,DATE,DATE,JSONB,NUMERIC,BOOLEAN,TEXT,NUMERIC,UUID,UUID,TEXT,NUMERIC) TO service_role;
