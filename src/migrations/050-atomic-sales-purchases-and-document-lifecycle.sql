-- 050 - Atomic sales, purchase, and document lifecycle operations.
-- Service-role API calls bypass RLS, so every function validates the tenant
-- and every related entity explicitly before writing.

CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_invoice_journal
  ON invoices(journal_entry_id) WHERE journal_entry_id IS NOT NULL;

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
  p_user_id UUID
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
  v_subtotal NUMERIC(15,2) := 0;
  v_vat NUMERIC(15,2);
  v_total NUMERIC(15,2);
  v_ar UUID;
  v_revenue UUID;
  v_vat_account UUID;
  v_journal JSONB;
  v_journal_id UUID;
  v_lines JSONB;
  v_receipt JSONB;
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
      OR v_discount < 0 OR v_discount > v_gross
    THEN RAISE EXCEPTION 'بند فاتورة غير صالح'; END IF;
    v_subtotal := v_subtotal + round(v_gross - v_discount, 2);
  END LOOP;

  v_subtotal := round(v_subtotal, 2);
  v_vat := CASE WHEN COALESCE(p_vat_enabled, TRUE)
    THEN round(v_subtotal * p_vat_rate, 2) ELSE 0 END;
  v_total := round(v_subtotal + v_vat, 2);

  IF p_collected_amount > v_total + 0.005
    OR (p_collected_amount > 0 AND p_bank_safe_id IS NULL)
  THEN RAISE EXCEPTION 'مبلغ التحصيل غير صالح'; END IF;

  v_number := next_invoice_number(p_company_id, extract(year FROM p_date)::INT);
  INSERT INTO invoices(
    company_id, number, contact_id, project_id, date, due_date, subtotal,
    vat_rate, vat_amount, total, paid_amount, status, notes, created_by
  ) VALUES (
    p_company_id, v_number, p_contact_id, p_project_id, p_date, p_due_date,
    v_subtotal, p_vat_rate, v_vat, v_total, 0, 'unpaid',
    NULLIF(btrim(p_notes), ''), p_user_id
  ) RETURNING * INTO v_invoice;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'quantity')::NUMERIC;
    v_price := (v_item->>'unitPrice')::NUMERIC;
    v_discount := COALESCE((v_item->>'discount')::NUMERIC, 0);
    INSERT INTO invoice_items(
      company_id, invoice_id, description, quantity, unit_price, total
    ) VALUES (
      p_company_id, v_invoice.id, btrim(v_item->>'description'), v_qty,
      v_price, round(v_qty * v_price - v_discount, 2)
    );
  END LOOP;

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

REVOKE ALL ON FUNCTION public.create_sales_invoice_atomic(
  UUID,UUID,UUID,DATE,DATE,JSONB,NUMERIC,BOOLEAN,TEXT,NUMERIC,UUID,UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_sales_invoice_atomic(
  UUID,UUID,UUID,DATE,DATE,JSONB,NUMERIC,BOOLEAN,TEXT,NUMERIC,UUID,UUID
) TO service_role;

CREATE OR REPLACE FUNCTION public.update_sales_invoice_metadata(
  p_company_id UUID, p_invoice_id UUID, p_due_date DATE,
  p_notes TEXT, p_notes_set BOOLEAN, p_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old invoices%ROWTYPE; v_invoice invoices%ROWTYPE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE) THEN
    RAISE EXCEPTION 'المستخدم غير صالح';
  END IF;
  SELECT * INTO v_old FROM invoices
  WHERE id = p_invoice_id AND company_id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الفاتورة غير موجودة'; END IF;
  IF v_old.status = 'cancelled' THEN RAISE EXCEPTION 'لا يمكن تعديل فاتورة ملغاة'; END IF;
  IF p_due_date IS NOT NULL AND p_due_date < v_old.date THEN
    RAISE EXCEPTION 'تاريخ الاستحقاق يسبق تاريخ الفاتورة';
  END IF;
  UPDATE invoices SET
    due_date = COALESCE(p_due_date, v_old.due_date),
    notes = CASE WHEN p_notes_set THEN NULLIF(btrim(p_notes), '') ELSE v_old.notes END,
    updated_at = now()
  WHERE id = p_invoice_id RETURNING * INTO v_invoice;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'update','invoice',p_invoice_id,to_jsonb(v_old),to_jsonb(v_invoice));
  RETURN to_jsonb(v_invoice);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_sales_invoice_atomic(
  p_company_id UUID, p_invoice_id UUID, p_notes TEXT, p_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old invoices%ROWTYPE; v_invoice invoices%ROWTYPE; v_reversal UUID;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE) THEN
    RAISE EXCEPTION 'المستخدم غير صالح';
  END IF;
  SELECT * INTO v_old FROM invoices
  WHERE id = p_invoice_id AND company_id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الفاتورة غير موجودة'; END IF;
  IF v_old.status = 'cancelled' THEN
    RETURN jsonb_build_object('id',p_invoice_id,'status','cancelled','already_processed',TRUE);
  END IF;
  IF v_old.paid_amount > 0.005 OR v_old.status IN ('paid','partial') THEN
    RAISE EXCEPTION 'لا يمكن إلغاء فاتورة عليها تحصيل';
  END IF;
  IF EXISTS(
    SELECT 1 FROM credit_notes
    WHERE company_id=p_company_id AND invoice_id=p_invoice_id
      AND status='approved' AND deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'لا يمكن إلغاء فاتورة لها إشعارات دائنة معتمدة'; END IF;
  IF v_old.journal_entry_id IS NOT NULL THEN
    v_reversal := post_journal_reversal(
      p_company_id,v_old.journal_entry_id,'invoice_reversal',p_invoice_id,
      'قيد عكسي لفاتورة رقم '||v_old.number,p_user_id
    );
  END IF;
  UPDATE invoices SET status='cancelled',
    notes=COALESCE(NULLIF(btrim(p_notes),''),v_old.notes),updated_at=now()
  WHERE id=p_invoice_id RETURNING * INTO v_invoice;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'cancel','invoice',p_invoice_id,to_jsonb(v_old),
    to_jsonb(v_invoice)||jsonb_build_object('reversal_journal_id',v_reversal));
  RETURN to_jsonb(v_invoice)||jsonb_build_object('reversal_journal_id',v_reversal);
END;
$$;

REVOKE ALL ON FUNCTION public.update_sales_invoice_metadata(UUID,UUID,DATE,TEXT,BOOLEAN,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cancel_sales_invoice_atomic(UUID,UUID,TEXT,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.update_sales_invoice_metadata(UUID,UUID,DATE,TEXT,BOOLEAN,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_sales_invoice_atomic(UUID,UUID,TEXT,UUID) TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_note_journal
  ON credit_notes(journal_entry_id) WHERE journal_entry_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_credit_note_atomic(
  p_company_id UUID, p_invoice_id UUID, p_project_id UUID, p_contact_id UUID,
  p_date DATE, p_reason TEXT, p_items JSONB, p_tax_rate NUMERIC, p_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_invoice invoices%ROWTYPE;
  v_note credit_notes%ROWTYPE;
  v_item JSONB;
  v_qty NUMERIC;
  v_price NUMERIC;
  v_subtotal NUMERIC(15,2):=0;
  v_tax NUMERIC(15,2);
  v_total NUMERIC(15,2);
  v_credited NUMERIC(15,2);
  v_contact UUID:=p_contact_id;
  v_project UUID:=p_project_id;
  v_rate NUMERIC:=p_tax_rate;
  v_number INT;
  v_ar UUID;
  v_revenue UUID;
  v_vat UUID;
  v_lines JSONB;
  v_journal JSONB;
  v_journal_id UUID;
BEGIN
  IF p_date IS NULL OR NULLIF(btrim(p_reason),'') IS NULL OR length(p_reason)>1000
    OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)=0
    OR jsonb_array_length(p_items)>200
  THEN RAISE EXCEPTION 'بيانات الإشعار الدائن غير صالحة'; END IF;
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;

  IF p_invoice_id IS NOT NULL THEN
    SELECT * INTO v_invoice FROM invoices
    WHERE id=p_invoice_id AND company_id=p_company_id FOR UPDATE;
    IF NOT FOUND OR v_invoice.status='cancelled' THEN RAISE EXCEPTION 'الفاتورة غير صالحة'; END IF;
    v_contact:=v_invoice.contact_id;
    v_project:=v_invoice.project_id;
    v_rate:=COALESCE(v_invoice.vat_rate,v_invoice.tax_rate,0);
  ELSE
    IF v_contact IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM contacts WHERE id=v_contact AND company_id=p_company_id
    ) THEN RAISE EXCEPTION 'الطرف غير موجود'; END IF;
    IF v_project IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM projects WHERE id=v_project AND company_id=p_company_id
    ) THEN RAISE EXCEPTION 'المشروع غير موجود'; END IF;
  END IF;
  IF v_rate<0 OR v_rate>1 THEN RAISE EXCEPTION 'نسبة الضريبة غير صالحة'; END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    BEGIN
      v_qty:=(v_item->>'quantity')::NUMERIC;
      v_price:=(v_item->>'unit_price')::NUMERIC;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'بند إشعار غير صالح'; END;
    IF NULLIF(btrim(v_item->>'description'),'') IS NULL
      OR length(v_item->>'description')>500 OR v_qty<=0 OR v_price<0
    THEN RAISE EXCEPTION 'بند إشعار غير صالح'; END IF;
    v_subtotal:=v_subtotal+round(v_qty*v_price,2);
  END LOOP;
  v_subtotal:=round(v_subtotal,2);
  v_tax:=round(v_subtotal*v_rate,2);
  v_total:=round(v_subtotal+v_tax,2);
  IF v_total<=0 THEN RAISE EXCEPTION 'إجمالي الإشعار يجب أن يكون موجباً'; END IF;

  IF p_invoice_id IS NOT NULL THEN
    SELECT COALESCE(sum(total),0) INTO v_credited FROM credit_notes
    WHERE company_id=p_company_id AND invoice_id=p_invoice_id
      AND status='approved' AND deleted_at IS NULL;
    IF v_credited+v_total>v_invoice.total+0.005 THEN
      RAISE EXCEPTION 'يتجاوز الإشعار الرصيد المتبقي للفاتورة';
    END IF;
  END IF;

  SELECT id INTO v_ar FROM accounts WHERE company_id=p_company_id AND code='1130'
    AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
  SELECT id INTO v_revenue FROM accounts WHERE company_id=p_company_id AND code='4100'
    AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
  IF v_ar IS NULL OR v_revenue IS NULL THEN RAISE EXCEPTION 'حسابات الإشعار غير مكتملة'; END IF;
  IF v_tax>0 THEN
    SELECT id INTO v_vat FROM accounts WHERE company_id=p_company_id AND code='2120'
      AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
    IF v_vat IS NULL THEN RAISE EXCEPTION 'حساب ضريبة المبيعات غير موجود'; END IF;
  END IF;

  v_number:=next_credit_note_number(p_company_id,extract(year FROM p_date)::INT);
  INSERT INTO credit_notes(
    company_id,number,invoice_id,project_id,contact_id,date,reason,subtotal,
    vat_amount,tax_amount,tax_rate,total,status,created_by
  ) VALUES(
    p_company_id,v_number,p_invoice_id,v_project,v_contact,p_date,btrim(p_reason),
    v_subtotal,v_tax,v_tax,v_rate,v_total,'approved',p_user_id
  ) RETURNING * INTO v_note;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_qty:=(v_item->>'quantity')::NUMERIC;
    v_price:=(v_item->>'unit_price')::NUMERIC;
    INSERT INTO credit_note_items(company_id,credit_note_id,description,quantity,unit_price,total)
    VALUES(p_company_id,v_note.id,btrim(v_item->>'description'),v_qty,v_price,round(v_qty*v_price,2));
  END LOOP;

  v_lines:=jsonb_build_array(
    jsonb_build_object('accountId',v_revenue,'debit',v_subtotal,'credit',0,'projectId',v_project,'contactId',v_contact),
    jsonb_build_object('accountId',v_ar,'debit',0,'credit',v_total,'contactId',v_contact)
  );
  IF v_tax>0 THEN
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
      'accountId',v_vat,'debit',v_tax,'credit',0,'contactId',v_contact
    ));
  END IF;
  v_journal:=create_journal_entry(
    p_company_id,p_date,'general','إشعار دائن '||v_number||' - '||btrim(p_reason),
    p_user_id,v_lines
  );
  v_journal_id:=(v_journal->>'id')::UUID;
  UPDATE journal_entries SET reference_type='credit_note',reference_id=v_note.id
  WHERE id=v_journal_id AND company_id=p_company_id;
  UPDATE credit_notes SET journal_entry_id=v_journal_id
  WHERE id=v_note.id RETURNING * INTO v_note;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'create','credit_note',v_note.id,to_jsonb(v_note));
  RETURN to_jsonb(v_note);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_credit_note_atomic(
  p_company_id UUID,p_credit_note_id UUID,p_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old credit_notes%ROWTYPE; v_note credit_notes%ROWTYPE; v_reversal UUID;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  SELECT * INTO v_old FROM credit_notes
  WHERE id=p_credit_note_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الإشعار غير موجود'; END IF;
  IF v_old.status='cancelled' THEN
    RETURN jsonb_build_object('id',p_credit_note_id,'status','cancelled','already_processed',TRUE);
  END IF;
  IF v_old.status='approved' AND v_old.journal_entry_id IS NULL THEN
    RAISE EXCEPTION 'الإشعار المعتمد بلا قيد محاسبي';
  END IF;
  IF v_old.journal_entry_id IS NOT NULL THEN
    v_reversal:=post_journal_reversal(
      p_company_id,v_old.journal_entry_id,'credit_note_cancellation',p_credit_note_id,
      'إلغاء الإشعار الدائن '||v_old.number,p_user_id
    );
  END IF;
  UPDATE credit_notes SET status='cancelled',deleted_at=now()
  WHERE id=p_credit_note_id RETURNING * INTO v_note;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'cancel','credit_note',p_credit_note_id,to_jsonb(v_old),
    to_jsonb(v_note)||jsonb_build_object('reversal_journal_id',v_reversal));
  RETURN to_jsonb(v_note)||jsonb_build_object('reversal_journal_id',v_reversal);
END;
$$;

REVOKE ALL ON FUNCTION public.create_credit_note_atomic(UUID,UUID,UUID,UUID,DATE,TEXT,JSONB,NUMERIC,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cancel_credit_note_atomic(UUID,UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_credit_note_atomic(UUID,UUID,UUID,UUID,DATE,TEXT,JSONB,NUMERIC,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_credit_note_atomic(UUID,UUID,UUID) TO service_role;

ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS invoice_number TEXT;
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(5,4) NOT NULL DEFAULT 0;
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_invoice_journal
  ON purchase_invoices(journal_entry_id) WHERE journal_entry_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_purchase_invoice_atomic(
  p_company_id UUID,p_supplier_id UUID,p_purchase_order_id UUID,p_project_id UUID,
  p_custody_id UUID,p_link_to_project BOOLEAN,p_date DATE,p_items JSONB,
  p_tax_rate NUMERIC,p_notes TEXT,p_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_invoice purchase_invoices%ROWTYPE;
  v_order purchase_orders%ROWTYPE;
  v_custody custodies%ROWTYPE;
  v_project UUID;
  v_item JSONB;
  v_qty NUMERIC;
  v_price NUMERIC;
  v_subtotal NUMERIC(15,2):=0;
  v_tax NUMERIC(15,2);
  v_total NUMERIC(15,2);
  v_number INT;
  v_debit UUID;
  v_vat UUID;
  v_credit UUID;
  v_lines JSONB;
  v_journal JSONB;
  v_journal_id UUID;
BEGIN
  IF p_date IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)=0
    OR jsonb_array_length(p_items)>200 OR p_tax_rate<0 OR p_tax_rate>1
  THEN RAISE EXCEPTION 'بيانات فاتورة المشتريات غير صالحة'; END IF;
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  IF NOT EXISTS(SELECT 1 FROM contacts WHERE id=p_supplier_id AND company_id=p_company_id AND COALESCE(is_active,TRUE))
  THEN RAISE EXCEPTION 'المورد غير موجود'; END IF;

  IF p_purchase_order_id IS NOT NULL THEN
    SELECT * INTO v_order FROM purchase_orders
    WHERE id=p_purchase_order_id AND company_id=p_company_id FOR UPDATE;
    IF NOT FOUND OR v_order.status='cancelled' OR v_order.supplier_id<>p_supplier_id
    THEN RAISE EXCEPTION 'أمر الشراء غير صالح للمورد المحدد'; END IF;
  END IF;

  IF COALESCE(p_link_to_project,TRUE) THEN
    IF p_project_id IS NOT NULL THEN
      IF NOT EXISTS(SELECT 1 FROM projects WHERE id=p_project_id AND company_id=p_company_id)
      THEN RAISE EXCEPTION 'المشروع غير موجود'; END IF;
      v_project:=p_project_id;
    END IF;
  END IF;

  IF p_custody_id IS NOT NULL THEN
    SELECT * INTO v_custody FROM custodies
    WHERE id=p_custody_id AND company_id=p_company_id FOR UPDATE;
    IF NOT FOUND OR v_custody.status IN ('settled','closed') OR v_custody.deleted_at IS NOT NULL
    THEN RAISE EXCEPTION 'ملف العهدة غير صالح'; END IF;
    IF COALESCE(p_link_to_project,TRUE) AND v_project IS NULL THEN
      v_project:=v_custody.project_id;
    END IF;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    BEGIN
      v_qty:=(v_item->>'quantity')::NUMERIC;
      v_price:=(v_item->>'unit_price')::NUMERIC;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'بند مشتريات غير صالح'; END;
    IF NULLIF(btrim(v_item->>'description'),'') IS NULL OR length(v_item->>'description')>500
      OR v_qty<=0 OR v_price<0 THEN RAISE EXCEPTION 'بند مشتريات غير صالح'; END IF;
    v_subtotal:=v_subtotal+round(v_qty*v_price,2);
  END LOOP;
  v_subtotal:=round(v_subtotal,2);
  v_tax:=round(v_subtotal*p_tax_rate,2);
  v_total:=round(v_subtotal+v_tax,2);
  IF v_total<=0 THEN RAISE EXCEPTION 'إجمالي فاتورة المشتريات يجب أن يكون موجباً'; END IF;
  IF p_custody_id IS NOT NULL AND v_total>v_custody.remaining_amount+0.005
  THEN RAISE EXCEPTION 'مبلغ الفاتورة أكبر من المتبقي في ملف العهدة'; END IF;

  SELECT id INTO v_debit FROM accounts WHERE company_id=p_company_id AND code='5100'
    AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
  IF v_debit IS NULL THEN
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
  INSERT INTO purchase_invoices(
    company_id,invoice_number,number,date,supplier_id,purchase_order_id,project_id,
    custody_id,payment_source,subtotal,tax_amount,tax_rate,total,paid_amount,status,notes,created_by
  ) VALUES(
    p_company_id,v_number::TEXT,v_number,p_date,p_supplier_id,p_purchase_order_id,v_project,
    p_custody_id,CASE WHEN p_custody_id IS NULL THEN 'ap' ELSE 'custody' END,
    v_subtotal,v_tax,p_tax_rate,v_total,CASE WHEN p_custody_id IS NULL THEN 0 ELSE v_total END,
    CASE WHEN p_custody_id IS NULL THEN 'unpaid' ELSE 'paid' END,NULLIF(btrim(p_notes),''),p_user_id
  ) RETURNING * INTO v_invoice;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_qty:=(v_item->>'quantity')::NUMERIC;
    v_price:=(v_item->>'unit_price')::NUMERIC;
    INSERT INTO purchase_invoice_items(company_id,purchase_invoice_id,description,quantity,unit_price,total)
    VALUES(p_company_id,v_invoice.id,btrim(v_item->>'description'),v_qty,v_price,round(v_qty*v_price,2));
  END LOOP;

  v_lines:=jsonb_build_array(
    jsonb_build_object('accountId',v_debit,'debit',v_subtotal,'credit',0,'projectId',v_project),
    jsonb_build_object('accountId',v_credit,'debit',0,'credit',v_total,
      'contactId',CASE WHEN p_custody_id IS NULL THEN p_supplier_id ELSE NULL END)
  );
  IF v_tax>0 THEN
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('accountId',v_vat,'debit',v_tax,'credit',0));
  END IF;
  v_journal:=create_journal_entry(
    p_company_id,p_date,'general','فاتورة مشتريات رقم '||v_number,p_user_id,v_lines
  );
  v_journal_id:=(v_journal->>'id')::UUID;
  UPDATE journal_entries SET reference_type='purchase_invoice',reference_id=v_invoice.id
  WHERE id=v_journal_id AND company_id=p_company_id;
  UPDATE purchase_invoices SET journal_entry_id=v_journal_id
  WHERE id=v_invoice.id RETURNING * INTO v_invoice;

  IF p_custody_id IS NOT NULL THEN
    INSERT INTO custody_transactions(
      company_id,custody_id,type,amount,description,reference_type,reference_id,created_by,journal_entry_id
    ) VALUES(
      p_company_id,p_custody_id,'expense',v_total,'فاتورة مشتريات '||v_number,
      'purchase_invoice',v_invoice.id,p_user_id,v_journal_id
    );
    INSERT INTO custody_invoices(company_id,custody_id,purchase_invoice_id,amount,description)
    VALUES(p_company_id,p_custody_id,v_invoice.id,v_total,'فاتورة '||v_number);
  END IF;

  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'create','purchase_invoice',v_invoice.id,to_jsonb(v_invoice));
  RETURN to_jsonb(v_invoice);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_purchase_invoice_metadata(
  p_company_id UUID,p_invoice_id UUID,p_notes TEXT,p_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old purchase_invoices%ROWTYPE; v_invoice purchase_invoices%ROWTYPE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  SELECT * INTO v_old FROM purchase_invoices
  WHERE id=p_invoice_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الفاتورة غير موجودة'; END IF;
  IF v_old.status='cancelled' THEN RAISE EXCEPTION 'الفاتورة ملغاة'; END IF;
  UPDATE purchase_invoices SET notes=NULLIF(btrim(p_notes),''),updated_at=now()
  WHERE id=p_invoice_id RETURNING * INTO v_invoice;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'update','purchase_invoice',p_invoice_id,to_jsonb(v_old),to_jsonb(v_invoice));
  RETURN to_jsonb(v_invoice);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_purchase_invoice_atomic(
  p_company_id UUID,p_invoice_id UUID,p_notes TEXT,p_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old purchase_invoices%ROWTYPE;
  v_invoice purchase_invoices%ROWTYPE;
  v_custody custodies%ROWTYPE;
  v_reversal UUID;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  SELECT * INTO v_old FROM purchase_invoices
  WHERE id=p_invoice_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الفاتورة غير موجودة'; END IF;
  IF v_old.status='cancelled' THEN
    RETURN jsonb_build_object('id',p_invoice_id,'status','cancelled','already_processed',TRUE);
  END IF;
  IF v_old.custody_id IS NULL AND (
    v_old.paid_amount>0.005 OR EXISTS(
      SELECT 1 FROM disbursement_invoice_items di
      JOIN voucher_disbursements vd ON vd.id=di.voucher_disbursement_id AND vd.company_id=p_company_id
      WHERE di.company_id=p_company_id AND di.purchase_invoice_id=p_invoice_id
        AND vd.status NOT IN ('cancelled','rejected')
    )
  ) THEN RAISE EXCEPTION 'لا يمكن إلغاء فاتورة عليها مدفوعات'; END IF;

  IF v_old.custody_id IS NOT NULL THEN
    SELECT * INTO v_custody FROM custodies
    WHERE id=v_old.custody_id AND company_id=p_company_id FOR UPDATE;
    IF NOT FOUND OR v_custody.status IN ('settled','closed') THEN
      RAISE EXCEPTION 'لا يمكن عكس فاتورة من عهدة مغلقة';
    END IF;
  END IF;
  IF v_old.journal_entry_id IS NULL THEN RAISE EXCEPTION 'فاتورة المشتريات بلا قيد محاسبي'; END IF;
  v_reversal:=post_journal_reversal(
    p_company_id,v_old.journal_entry_id,'purchase_invoice_reversal',p_invoice_id,
    'عكس فاتورة مشتريات رقم '||v_old.number,p_user_id
  );

  IF v_old.custody_id IS NOT NULL THEN
    INSERT INTO custody_transactions(
      company_id,custody_id,type,amount,description,reference_type,reference_id,created_by,journal_entry_id
    ) VALUES(
      p_company_id,v_old.custody_id,'addition',v_old.total,
      'عكس فاتورة مشتريات '||v_old.number,'purchase_invoice_cancellation',p_invoice_id,p_user_id,v_reversal
    );
  END IF;
  UPDATE purchase_invoices SET status='cancelled',paid_amount=0,
    notes=COALESCE(NULLIF(btrim(p_notes),''),v_old.notes),updated_at=now()
  WHERE id=p_invoice_id RETURNING * INTO v_invoice;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'cancel','purchase_invoice',p_invoice_id,to_jsonb(v_old),
    to_jsonb(v_invoice)||jsonb_build_object('reversal_journal_id',v_reversal));
  RETURN to_jsonb(v_invoice)||jsonb_build_object('reversal_journal_id',v_reversal);
END;
$$;

REVOKE ALL ON FUNCTION public.create_purchase_invoice_atomic(UUID,UUID,UUID,UUID,UUID,BOOLEAN,DATE,JSONB,NUMERIC,TEXT,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.update_purchase_invoice_metadata(UUID,UUID,TEXT,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cancel_purchase_invoice_atomic(UUID,UUID,TEXT,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_purchase_invoice_atomic(UUID,UUID,UUID,UUID,UUID,BOOLEAN,DATE,JSONB,NUMERIC,TEXT,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_purchase_invoice_metadata(UUID,UUID,TEXT,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_purchase_invoice_atomic(UUID,UUID,TEXT,UUID) TO service_role;

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_status_check;
ALTER TABLE projects ADD CONSTRAINT projects_status_check
  CHECK(status IN ('active','on_hold','completed','cancelled'));

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
  v_total NUMERIC;
  v_items_total NUMERIC:=0;
  v_invoice_items JSONB:='[]'::JSONB;
  v_invoice JSONB;
BEGIN
  IF NULLIF(btrim(p_name),'') IS NULL OR length(p_name)>300 OR p_contract_value<=0
    OR p_start_date IS NULL OR (p_end_date IS NOT NULL AND p_end_date<p_start_date)
    OR p_status NOT IN ('active','on_hold') OR jsonb_typeof(p_items)<>'array'
    OR jsonb_array_length(p_items)>1000 OR length(COALESCE(p_description,''))>5000
    OR length(COALESCE(p_location,''))>1000
  THEN RAISE EXCEPTION 'بيانات المشروع غير صالحة'; END IF;
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;

  IF v_client IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(p_company_id::TEXT||':cash-customer'));
    SELECT * INTO v_contact FROM contacts
    WHERE company_id=p_company_id AND name='عميل نقدي' LIMIT 1 FOR UPDATE;
    IF FOUND AND v_contact.type NOT IN ('client','both') THEN
      RAISE EXCEPTION 'اسم العميل النقدي مستخدم لطرف غير عميل';
    ELSIF FOUND THEN v_client:=v_contact.id;
    ELSE
      INSERT INTO contacts(company_id,name,type,is_active,created_by)
      VALUES(p_company_id,'عميل نقدي','client',TRUE,p_user_id) RETURNING id INTO v_client;
    END IF;
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
    v_invoice_items:=v_invoice_items||jsonb_build_array(jsonb_build_object(
      'description',btrim(v_item->>'description'),'quantity',v_qty,'unitPrice',v_price,'discount',0
    ));
  END LOOP;

  IF p_auto_invoice THEN
    IF jsonb_array_length(v_invoice_items)=0 THEN
      v_invoice_items:=jsonb_build_array(jsonb_build_object(
        'description','أعمال مشروع: '||btrim(p_name),'quantity',1,
        'unitPrice',p_contract_value,'discount',0
      ));
    END IF;
    v_invoice:=create_sales_invoice_atomic(
      p_company_id,v_client,v_project.id,p_start_date,p_start_date,v_invoice_items,
      0,FALSE,'فاتورة تلقائية للمشروع',0,NULL,p_user_id
    );
  END IF;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'create','project',v_project.id,to_jsonb(v_project));
  RETURN to_jsonb(v_project)||jsonb_build_object(
    'invoice',CASE WHEN v_invoice IS NULL THEN NULL ELSE jsonb_build_object('id',v_invoice->>'id','number',v_invoice->>'number') END,
    'boq_items_count',jsonb_array_length(p_items)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.convert_quotation_atomic(
  p_company_id UUID,p_quotation_id UUID,p_project_name TEXT,
  p_start_date DATE,p_end_date DATE,p_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_quote quotations%ROWTYPE;
  v_project projects%ROWTYPE;
  v_qi quotation_items%ROWTYPE;
  v_number INT;
  v_invoice invoices%ROWTYPE;
  v_ar UUID;
  v_revenue UUID;
  v_vat UUID;
  v_net_subtotal NUMERIC;
  v_discount_remaining NUMERIC;
  v_line_discount NUMERIC;
  v_line_total NUMERIC;
  v_lines JSONB;
  v_journal JSONB;
  v_journal_id UUID;
  v_count INT:=0;
BEGIN
  IF p_start_date IS NULL OR NULLIF(btrim(p_project_name),'') IS NULL
    OR length(p_project_name)>300 OR (p_end_date IS NOT NULL AND p_end_date<p_start_date)
  THEN RAISE EXCEPTION 'بيانات التحويل غير صالحة'; END IF;
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  SELECT * INTO v_quote FROM quotations
  WHERE id=p_quotation_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'عرض السعر غير موجود'; END IF;
  IF v_quote.status='converted' THEN
    RETURN jsonb_build_object('id',v_quote.project_id,'already_processed',TRUE);
  END IF;
  IF v_quote.status<>'accepted' THEN RAISE EXCEPTION 'يجب قبول عرض السعر قبل تحويله'; END IF;
  IF v_quote.contact_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM contacts WHERE id=v_quote.contact_id AND company_id=p_company_id
  ) THEN RAISE EXCEPTION 'عميل عرض السعر غير صالح'; END IF;
  IF NOT EXISTS(SELECT 1 FROM quotation_items WHERE quotation_id=p_quotation_id AND company_id=p_company_id)
  THEN RAISE EXCEPTION 'عرض السعر بلا بنود'; END IF;

  INSERT INTO projects(company_id,name,client_id,contract_value,start_date,end_date,status,description,created_by)
  VALUES(p_company_id,btrim(p_project_name),v_quote.contact_id,v_quote.total,p_start_date,p_end_date,
    'active','محول من عرض سعر رقم: '||v_quote.number,p_user_id) RETURNING * INTO v_project;
  FOR v_qi IN SELECT * FROM quotation_items
    WHERE quotation_id=p_quotation_id AND company_id=p_company_id ORDER BY id FOR UPDATE LOOP
    v_count:=v_count+1;
    INSERT INTO boq_items(company_id,project_id,item_code,description,unit,quantity,unit_price,total)
    VALUES(p_company_id,v_project.id,'BOQ-'||lpad(v_count::TEXT,3,'0'),v_qi.description,
      'وحدة',v_qi.quantity,v_qi.unit_price,v_qi.total);
  END LOOP;

  v_net_subtotal:=round(v_quote.subtotal-v_quote.discount_amount,2);
  IF v_net_subtotal<0 OR round(v_net_subtotal+v_quote.tax_amount,2)<>round(v_quote.total,2)
  THEN RAISE EXCEPTION 'إجماليات عرض السعر غير متسقة'; END IF;
  SELECT id INTO v_ar FROM accounts WHERE company_id=p_company_id AND code='1130'
    AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
  SELECT id INTO v_revenue FROM accounts WHERE company_id=p_company_id AND code='4100'
    AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
  IF v_ar IS NULL OR v_revenue IS NULL THEN RAISE EXCEPTION 'حسابات التحويل غير مكتملة'; END IF;
  IF v_quote.tax_amount>0 THEN
    SELECT id INTO v_vat FROM accounts WHERE company_id=p_company_id AND code='2120'
      AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
    IF v_vat IS NULL THEN RAISE EXCEPTION 'حساب ضريبة المبيعات غير موجود'; END IF;
  END IF;

  v_number:=next_invoice_number(p_company_id,extract(year FROM p_start_date)::INT);
  INSERT INTO invoices(
    company_id,number,contact_id,project_id,date,due_date,subtotal,vat_rate,vat_amount,
    total,paid_amount,status,created_by
  ) VALUES(
    p_company_id,v_number,v_quote.contact_id,v_project.id,p_start_date,p_start_date,
    v_net_subtotal,v_quote.tax_rate,v_quote.tax_amount,v_quote.total,0,'unpaid',p_user_id
  ) RETURNING * INTO v_invoice;
  v_discount_remaining:=v_quote.discount_amount;
  FOR v_qi IN SELECT * FROM quotation_items
    WHERE quotation_id=p_quotation_id AND company_id=p_company_id ORDER BY id LOOP
    v_line_discount:=LEAST(v_discount_remaining,v_qi.total);
    v_line_total:=round(v_qi.total-v_line_discount,2);
    v_discount_remaining:=v_discount_remaining-v_line_discount;
    INSERT INTO invoice_items(company_id,invoice_id,description,quantity,unit_price,total)
    VALUES(p_company_id,v_invoice.id,v_qi.description,v_qi.quantity,v_qi.unit_price,v_line_total);
  END LOOP;
  IF v_discount_remaining>0.005 THEN RAISE EXCEPTION 'تعذر توزيع خصم عرض السعر'; END IF;

  v_lines:=jsonb_build_array(
    jsonb_build_object('accountId',v_ar,'debit',v_quote.total,'credit',0,'contactId',v_quote.contact_id),
    jsonb_build_object('accountId',v_revenue,'debit',0,'credit',v_net_subtotal,'projectId',v_project.id,'contactId',v_quote.contact_id)
  );
  IF v_quote.tax_amount>0 THEN
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
      'accountId',v_vat,'debit',0,'credit',v_quote.tax_amount,'contactId',v_quote.contact_id
    ));
  END IF;
  v_journal:=create_journal_entry(
    p_company_id,p_start_date,'general','فاتورة مشروع محول من عرض سعر: '||v_quote.number,
    p_user_id,v_lines
  );
  v_journal_id:=(v_journal->>'id')::UUID;
  UPDATE journal_entries SET reference_type='quotation_conversion',reference_id=p_quotation_id
  WHERE id=v_journal_id AND company_id=p_company_id;
  UPDATE invoices SET journal_entry_id=v_journal_id WHERE id=v_invoice.id;
  UPDATE quotations SET status='converted',project_id=v_project.id WHERE id=p_quotation_id;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'convert','quotation',p_quotation_id,
    jsonb_build_object('project_id',v_project.id,'invoice_id',v_invoice.id,'journal_entry_id',v_journal_id));
  RETURN to_jsonb(v_project)||jsonb_build_object(
    'invoice',jsonb_build_object('id',v_invoice.id,'number',v_number),
    'boq_items_count',v_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_project_atomic(UUID,TEXT,UUID,NUMERIC,DATE,DATE,TEXT,TEXT,TEXT,JSONB,BOOLEAN,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.convert_quotation_atomic(UUID,UUID,TEXT,DATE,DATE,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_project_atomic(UUID,TEXT,UUID,NUMERIC,DATE,DATE,TEXT,TEXT,TEXT,JSONB,BOOLEAN,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.convert_quotation_atomic(UUID,UUID,TEXT,DATE,DATE,UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.update_project_atomic(
  p_company_id UUID,p_project_id UUID,p_payload JSONB,p_items JSONB,p_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old projects%ROWTYPE;
  v_project projects%ROWTYPE;
  v_item JSONB;
  v_client UUID;
  v_contract NUMERIC;
  v_start DATE;
  v_end DATE;
  v_status TEXT;
  v_qty NUMERIC;
  v_price NUMERIC;
  v_items_total NUMERIC:=0;
BEGIN
  IF jsonb_typeof(COALESCE(p_payload,'{}'::JSONB))<>'object' OR EXISTS(
    SELECT 1 FROM jsonb_object_keys(COALESCE(p_payload,'{}'::JSONB)) key
    WHERE key NOT IN ('name','client_id','contract_value','start_date','end_date','budget','status','description','location')
  ) THEN RAISE EXCEPTION 'بيانات تعديل المشروع غير صالحة'; END IF;
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  SELECT * INTO v_old FROM projects WHERE id=p_project_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المشروع غير موجود'; END IF;
  IF v_old.status IN ('completed','cancelled') THEN RAISE EXCEPTION 'لا يمكن تعديل مشروع مغلق أو ملغى'; END IF;

  v_client:=CASE WHEN p_payload?'client_id' AND NULLIF(p_payload->>'client_id','') IS NOT NULL
    THEN (p_payload->>'client_id')::UUID WHEN p_payload?'client_id' THEN NULL ELSE v_old.client_id END;
  IF v_client IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM contacts WHERE id=v_client AND company_id=p_company_id AND COALESCE(is_active,TRUE)
  ) THEN RAISE EXCEPTION 'العميل غير موجود'; END IF;
  v_contract:=CASE WHEN p_payload?'contract_value' THEN (p_payload->>'contract_value')::NUMERIC ELSE v_old.contract_value END;
  v_start:=CASE WHEN p_payload?'start_date' THEN (p_payload->>'start_date')::DATE ELSE v_old.start_date END;
  v_end:=CASE WHEN p_payload?'end_date' AND NULLIF(p_payload->>'end_date','') IS NOT NULL
    THEN (p_payload->>'end_date')::DATE WHEN p_payload?'end_date' THEN NULL ELSE v_old.end_date END;
  v_status:=CASE WHEN p_payload?'status' THEN p_payload->>'status' ELSE v_old.status END;
  IF v_contract<=0 OR (v_end IS NOT NULL AND v_end<v_start) OR v_status NOT IN ('active','on_hold')
    OR length(COALESCE(p_payload->>'name',v_old.name))>300
    OR NULLIF(btrim(COALESCE(p_payload->>'name',v_old.name)),'') IS NULL
  THEN RAISE EXCEPTION 'بيانات المشروع غير صالحة'; END IF;
  IF p_payload?'contract_value' AND EXISTS(
    SELECT 1 FROM invoices WHERE company_id=p_company_id AND project_id=p_project_id AND status<>'cancelled'
    UNION ALL SELECT 1 FROM progress_billing WHERE company_id=p_company_id AND project_id=p_project_id AND status<>'cancelled'
  ) THEN RAISE EXCEPTION 'لا يمكن تغيير قيمة عقد له فواتير أو مستخلصات'; END IF;

  IF p_items IS NOT NULL THEN
    IF jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)>1000 THEN RAISE EXCEPTION 'بنود جدول الكميات غير صالحة'; END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
      v_qty:=(v_item->>'quantity')::NUMERIC; v_price:=(v_item->>'unit_price')::NUMERIC;
      IF NULLIF(btrim(v_item->>'description'),'') IS NULL OR v_qty<=0 OR v_price<0
      THEN RAISE EXCEPTION 'بند جدول كميات غير صالح'; END IF;
      v_items_total:=v_items_total+round(v_qty*v_price,2);
    END LOOP;
    IF jsonb_array_length(p_items)>0 AND abs(v_items_total-v_contract)>0.01
    THEN RAISE EXCEPTION 'قيمة العقد لا تطابق جدول الكميات'; END IF;
    DELETE FROM boq_items WHERE project_id=p_project_id AND company_id=p_company_id;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
      v_qty:=(v_item->>'quantity')::NUMERIC; v_price:=(v_item->>'unit_price')::NUMERIC;
      INSERT INTO boq_items(company_id,project_id,description,unit,quantity,unit_price,total)
      VALUES(p_company_id,p_project_id,btrim(v_item->>'description'),COALESCE(NULLIF(btrim(v_item->>'unit'),''),'واحدة'),v_qty,v_price,round(v_qty*v_price,2));
    END LOOP;
  END IF;

  UPDATE projects SET
    name=CASE WHEN p_payload?'name' THEN btrim(p_payload->>'name') ELSE name END,
    client_id=v_client,contract_value=v_contract,start_date=v_start,end_date=v_end,status=v_status,
    budget=CASE WHEN p_payload?'budget' THEN (p_payload->>'budget')::NUMERIC ELSE budget END,
    description=CASE WHEN p_payload?'description' THEN NULLIF(btrim(p_payload->>'description'),'') ELSE description END,
    location=CASE WHEN p_payload?'location' THEN NULLIF(btrim(p_payload->>'location'),'') ELSE location END,
    updated_at=now()
  WHERE id=p_project_id RETURNING * INTO v_project;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'update','project',p_project_id,to_jsonb(v_old),to_jsonb(v_project));
  RETURN to_jsonb(v_project);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_empty_project_atomic(
  p_company_id UUID,p_project_id UUID,p_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old projects%ROWTYPE; v_project projects%ROWTYPE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  SELECT * INTO v_old FROM projects WHERE id=p_project_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المشروع غير موجود'; END IF;
  IF v_old.status='cancelled' THEN RETURN jsonb_build_object('id',p_project_id,'status','cancelled','already_processed',TRUE); END IF;
  IF v_old.status='completed' THEN RAISE EXCEPTION 'المشروع مكتمل ولا يمكن إلغاؤه'; END IF;
  IF EXISTS(SELECT 1 FROM invoices WHERE company_id=p_company_id AND project_id=p_project_id AND status<>'cancelled')
    OR EXISTS(SELECT 1 FROM purchase_invoices WHERE company_id=p_company_id AND project_id=p_project_id AND status<>'cancelled')
    OR EXISTS(SELECT 1 FROM progress_billing WHERE company_id=p_company_id AND project_id=p_project_id AND status<>'cancelled')
    OR EXISTS(SELECT 1 FROM project_expenses WHERE company_id=p_company_id AND project_id=p_project_id AND COALESCE(status,'active')<>'cancelled')
    OR EXISTS(SELECT 1 FROM journal_lines WHERE company_id=p_company_id AND project_id=p_project_id)
  THEN RAISE EXCEPTION 'لا يمكن إلغاء مشروع له آثار مالية؛ اعكس العمليات المرتبطة أولاً'; END IF;
  UPDATE projects SET status='cancelled',updated_at=now() WHERE id=p_project_id RETURNING * INTO v_project;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'cancel','project',p_project_id,to_jsonb(v_old),to_jsonb(v_project));
  RETURN to_jsonb(v_project);
END;
$$;

REVOKE ALL ON FUNCTION public.update_project_atomic(UUID,UUID,JSONB,JSONB,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cancel_empty_project_atomic(UUID,UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.update_project_atomic(UUID,UUID,JSONB,JSONB,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_empty_project_atomic(UUID,UUID,UUID) TO service_role;

ALTER TABLE progress_billing ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS uq_progress_billing_journal
  ON progress_billing(journal_entry_id) WHERE journal_entry_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_progress_billing_atomic(
  p_company_id UUID,p_project_id UUID,p_date DATE,p_claim_number TEXT,p_description TEXT,
  p_gross_amount NUMERIC,p_retention_rate NUMERIC,p_tax_rate NUMERIC,p_is_final BOOLEAN,p_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_project projects%ROWTYPE;
  v_claim progress_billing%ROWTYPE;
  v_adjusted NUMERIC;
  v_claimed NUMERIC;
  v_retention NUMERIC;
  v_net NUMERIC;
  v_tax NUMERIC;
  v_number TEXT;
  v_seq INT;
  v_ar UUID;
  v_revenue UUID;
  v_retention_account UUID;
  v_vat UUID;
  v_lines JSONB;
  v_journal JSONB;
  v_journal_id UUID;
BEGIN
  IF p_date IS NULL OR p_gross_amount<=0 OR p_gross_amount<>round(p_gross_amount,2)
    OR p_retention_rate<0 OR p_retention_rate>1 OR p_tax_rate<0 OR p_tax_rate>1
    OR length(COALESCE(p_claim_number,''))>80 OR length(COALESCE(p_description,''))>2000
  THEN RAISE EXCEPTION 'بيانات المستخلص غير صالحة'; END IF;
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  SELECT * INTO v_project FROM projects
  WHERE id=p_project_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND OR v_project.status<>'active' THEN RAISE EXCEPTION 'المشروع غير صالح للفوترة المرحلية'; END IF;
  IF EXISTS(SELECT 1 FROM progress_billing WHERE company_id=p_company_id AND project_id=p_project_id AND is_final=TRUE AND status<>'cancelled')
  THEN RAISE EXCEPTION 'تم إصدار مستخلص نهائي للمشروع'; END IF;

  SELECT v_project.contract_value+COALESCE(sum(change_amount) FILTER(WHERE status='approved'),0)
    INTO v_adjusted FROM change_orders WHERE company_id=p_company_id AND project_id=p_project_id;
  SELECT COALESCE(sum(gross_amount),0) INTO v_claimed FROM progress_billing
    WHERE company_id=p_company_id AND project_id=p_project_id AND status<>'cancelled';
  IF v_adjusted<=0 OR v_claimed+p_gross_amount>v_adjusted+0.005
  THEN RAISE EXCEPTION 'قيمة المستخلص تتجاوز العقد المعدل'; END IF;

  v_retention:=round(p_gross_amount*p_retention_rate,2);
  v_net:=round(p_gross_amount-v_retention,2);
  v_tax:=round(v_net*p_tax_rate,2);
  IF NULLIF(btrim(p_claim_number),'') IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(p_company_id::TEXT||':progress-billing-number'));
    SELECT COALESCE(max((regexp_match(claim_number,'([0-9]+)$'))[1]::INT),0)+1 INTO v_seq
    FROM progress_billing WHERE company_id=p_company_id AND claim_number~'[0-9]+$';
    v_number:='PB-'||lpad(v_seq::TEXT,6,'0');
  ELSE v_number:=btrim(p_claim_number); END IF;

  SELECT id INTO v_ar FROM accounts WHERE company_id=p_company_id AND code='1135'
    AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
  SELECT id INTO v_revenue FROM accounts WHERE company_id=p_company_id AND code='4100'
    AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
  IF v_ar IS NULL OR v_revenue IS NULL THEN RAISE EXCEPTION 'حسابات المستخلص غير مكتملة'; END IF;
  IF v_retention>0 THEN
    SELECT id INTO v_retention_account FROM accounts WHERE company_id=p_company_id AND code='2160'
      AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
    IF v_retention_account IS NULL THEN RAISE EXCEPTION 'حساب محجوزات الضمان غير موجود'; END IF;
  END IF;
  IF v_tax>0 THEN
    SELECT id INTO v_vat FROM accounts WHERE company_id=p_company_id AND code='2120'
      AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
    IF v_vat IS NULL THEN RAISE EXCEPTION 'حساب ضريبة المبيعات غير موجود'; END IF;
  END IF;

  INSERT INTO progress_billing(
    company_id,project_id,date,claim_number,description,gross_amount,retention_rate,
    retention_amount,net_amount,tax_rate,tax_amount,is_final,status,created_by
  ) VALUES(
    p_company_id,p_project_id,p_date,v_number,NULLIF(btrim(p_description),''),p_gross_amount,
    p_retention_rate,v_retention,v_net,p_tax_rate,v_tax,COALESCE(p_is_final,FALSE),'approved',p_user_id
  ) RETURNING * INTO v_claim;
  v_lines:=jsonb_build_array(
    jsonb_build_object('accountId',v_ar,'debit',p_gross_amount+v_tax,'credit',0,'projectId',p_project_id),
    jsonb_build_object('accountId',v_revenue,'debit',0,'credit',v_net,'projectId',p_project_id)
  );
  IF v_retention>0 THEN v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
    'accountId',v_retention_account,'debit',0,'credit',v_retention,'projectId',p_project_id)); END IF;
  IF v_tax>0 THEN v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
    'accountId',v_vat,'debit',0,'credit',v_tax)); END IF;
  v_journal:=create_journal_entry(p_company_id,p_date,'general','فاتورة مرحلية: '||v_number,p_user_id,v_lines);
  v_journal_id:=(v_journal->>'id')::UUID;
  UPDATE journal_entries SET reference_type='progress_billing',reference_id=v_claim.id
  WHERE id=v_journal_id AND company_id=p_company_id;
  UPDATE progress_billing SET journal_entry_id=v_journal_id WHERE id=v_claim.id RETURNING * INTO v_claim;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'create','progress_billing',v_claim.id,to_jsonb(v_claim));
  RETURN to_jsonb(v_claim);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_progress_billing_metadata(
  p_company_id UUID,p_claim_id UUID,p_claim_number TEXT,p_description TEXT,
  p_is_final BOOLEAN,p_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old progress_billing%ROWTYPE; v_claim progress_billing%ROWTYPE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  SELECT * INTO v_old FROM progress_billing WHERE id=p_claim_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND OR v_old.status='cancelled' THEN RAISE EXCEPTION 'المستخلص غير صالح'; END IF;
  IF p_claim_number IS NOT NULL AND (NULLIF(btrim(p_claim_number),'') IS NULL OR length(p_claim_number)>80)
    OR p_description IS NOT NULL AND length(p_description)>2000 THEN RAISE EXCEPTION 'بيانات التعديل غير صالحة'; END IF;
  IF p_is_final=TRUE AND EXISTS(
    SELECT 1 FROM progress_billing WHERE company_id=p_company_id AND project_id=v_old.project_id
      AND id<>p_claim_id AND is_final=TRUE AND status<>'cancelled'
  ) THEN RAISE EXCEPTION 'يوجد مستخلص نهائي آخر'; END IF;
  UPDATE progress_billing SET
    claim_number=COALESCE(NULLIF(btrim(p_claim_number),''),claim_number),
    description=CASE WHEN p_description IS NULL THEN description ELSE NULLIF(btrim(p_description),'') END,
    is_final=COALESCE(p_is_final,is_final),updated_at=now()
  WHERE id=p_claim_id RETURNING * INTO v_claim;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'update','progress_billing',p_claim_id,to_jsonb(v_old),to_jsonb(v_claim));
  RETURN to_jsonb(v_claim);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_progress_billing_atomic(
  p_company_id UUID,p_claim_id UUID,p_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old progress_billing%ROWTYPE; v_claim progress_billing%ROWTYPE; v_reversal UUID;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  SELECT * INTO v_old FROM progress_billing WHERE id=p_claim_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المستخلص غير موجود'; END IF;
  IF v_old.status='cancelled' THEN RETURN jsonb_build_object('id',p_claim_id,'status','cancelled','already_processed',TRUE); END IF;
  IF v_old.journal_entry_id IS NULL THEN RAISE EXCEPTION 'المستخلص المعتمد بلا قيد'; END IF;
  v_reversal:=post_journal_reversal(p_company_id,v_old.journal_entry_id,'progress_billing_reversal',p_claim_id,
    'عكس مستخلص '||v_old.claim_number,p_user_id);
  UPDATE progress_billing SET status='cancelled',cancelled_at=now(),updated_at=now()
  WHERE id=p_claim_id RETURNING * INTO v_claim;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'cancel','progress_billing',p_claim_id,to_jsonb(v_old),
    to_jsonb(v_claim)||jsonb_build_object('reversal_journal_id',v_reversal));
  RETURN to_jsonb(v_claim)||jsonb_build_object('reversal_journal_id',v_reversal);
END;
$$;

REVOKE ALL ON FUNCTION public.create_progress_billing_atomic(UUID,UUID,DATE,TEXT,TEXT,NUMERIC,NUMERIC,NUMERIC,BOOLEAN,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.update_progress_billing_metadata(UUID,UUID,TEXT,TEXT,BOOLEAN,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cancel_progress_billing_atomic(UUID,UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_progress_billing_atomic(UUID,UUID,DATE,TEXT,TEXT,NUMERIC,NUMERIC,NUMERIC,BOOLEAN,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_progress_billing_metadata(UUID,UUID,TEXT,TEXT,BOOLEAN,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_progress_billing_atomic(UUID,UUID,UUID) TO service_role;

ALTER TABLE pos_terminals ADD COLUMN IF NOT EXISTS bank_safe_id UUID REFERENCES banks_safes(id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_sale_journal
  ON pos_sales(journal_entry_id) WHERE journal_entry_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_pos_sale_atomic(
  p_company_id UUID,p_terminal_id UUID,p_total NUMERIC,p_payment_method TEXT,p_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_terminal pos_terminals%ROWTYPE;
  v_bank banks_safes%ROWTYPE;
  v_sale pos_sales%ROWTYPE;
  v_revenue UUID;
  v_number INT;
  v_journal JSONB;
  v_journal_id UUID;
BEGIN
  IF p_terminal_id IS NULL OR p_total<=0 OR p_total<>round(p_total,2)
    OR p_payment_method NOT IN ('cash','card','transfer')
  THEN RAISE EXCEPTION 'بيانات بيع نقطة البيع غير صالحة'; END IF;
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  SELECT * INTO v_terminal FROM pos_terminals
  WHERE id=p_terminal_id AND company_id=p_company_id AND is_active=TRUE FOR UPDATE;
  IF NOT FOUND OR v_terminal.bank_safe_id IS NULL THEN RAISE EXCEPTION 'طرفية نقطة البيع غير مربوطة بخزينة'; END IF;
  SELECT * INTO v_bank FROM banks_safes
  WHERE id=v_terminal.bank_safe_id AND company_id=p_company_id AND is_active=TRUE FOR UPDATE;
  IF NOT FOUND OR v_bank.account_id IS NULL THEN RAISE EXCEPTION 'خزينة تسوية نقطة البيع غير صالحة'; END IF;
  SELECT id INTO v_revenue FROM accounts WHERE company_id=p_company_id AND code='4100'
    AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
  IF v_revenue IS NULL THEN RAISE EXCEPTION 'حساب إيراد نقطة البيع غير موجود'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_company_id::TEXT||':pos-sales-number'));
  SELECT COALESCE(max(number),0)+1 INTO v_number FROM pos_sales WHERE company_id=p_company_id;
  INSERT INTO pos_sales(
    company_id,branch_id,terminal_id,number,date,subtotal,tax_amount,discount_amount,
    total,payment_method,status,cashier_id
  ) VALUES(
    p_company_id,v_terminal.branch_id,p_terminal_id,v_number,CURRENT_DATE,p_total,0,0,
    p_total,p_payment_method,'completed',p_user_id
  ) RETURNING * INTO v_sale;
  v_journal:=create_journal_entry(
    p_company_id,CURRENT_DATE,'general','مبيعات POS #'||v_number,p_user_id,
    jsonb_build_array(
      jsonb_build_object('accountId',v_bank.account_id,'debit',p_total,'credit',0),
      jsonb_build_object('accountId',v_revenue,'debit',0,'credit',p_total)
    )
  );
  v_journal_id:=(v_journal->>'id')::UUID;
  UPDATE journal_entries SET reference_type='pos_sale',reference_id=v_sale.id
  WHERE id=v_journal_id AND company_id=p_company_id;
  UPDATE pos_sales SET journal_entry_id=v_journal_id WHERE id=v_sale.id RETURNING * INTO v_sale;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'create','pos_sale',v_sale.id,to_jsonb(v_sale));
  RETURN to_jsonb(v_sale);
END;
$$;
REVOKE ALL ON FUNCTION public.create_pos_sale_atomic(UUID,UUID,NUMERIC,TEXT,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_pos_sale_atomic(UUID,UUID,NUMERIC,TEXT,UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.update_voucher_receipt_atomic(
  p_company_id UUID,p_voucher_id UUID,p_date DATE,p_contact_id UUID,p_contact_set BOOLEAN,
  p_amount NUMERIC,p_bank_safe_id UUID,p_reason TEXT,p_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old voucher_receipts%ROWTYPE; v_voucher voucher_receipts%ROWTYPE; v_bank banks_safes%ROWTYPE;
  v_contact UUID; v_amount NUMERIC; v_counterpart UUID; v_reversal UUID; v_journal JSONB; v_journal_id UUID;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  SELECT * INTO v_old FROM voucher_receipts WHERE id=p_voucher_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'السند غير موجود'; END IF;
  IF v_old.status<>'approved' OR v_old.journal_entry_id IS NULL THEN RAISE EXCEPTION 'لا يمكن تعديل سند غير مرحل'; END IF;
  IF EXISTS(SELECT 1 FROM cash_transactions WHERE company_id=p_company_id AND voucher_receipt_id=p_voucher_id)
  THEN RAISE EXCEPTION 'السند مرتبط بحركة نقدية'; END IF;
  IF EXISTS(SELECT 1 FROM receipt_invoice_items WHERE company_id=p_company_id AND voucher_receipt_id=p_voucher_id)
  THEN RAISE EXCEPTION 'لا يمكن تعديل سند مخصص على فواتير'; END IF;
  v_contact:=CASE WHEN p_contact_set THEN p_contact_id ELSE v_old.contact_id END;
  v_amount:=COALESCE(p_amount,v_old.amount);
  IF v_amount<=0 OR v_amount<>round(v_amount,2) OR length(COALESCE(p_reason,v_old.reason,''))>500
  THEN RAISE EXCEPTION 'بيانات السند غير صالحة'; END IF;
  IF v_contact IS NOT NULL AND NOT EXISTS(SELECT 1 FROM contacts WHERE id=v_contact AND company_id=p_company_id)
  THEN RAISE EXCEPTION 'الطرف غير موجود'; END IF;
  SELECT * INTO v_bank FROM banks_safes
  WHERE id=COALESCE(p_bank_safe_id,v_old.bank_safe_id) AND company_id=p_company_id AND is_active=TRUE FOR UPDATE;
  IF NOT FOUND OR v_bank.account_id IS NULL THEN RAISE EXCEPTION 'البنك أو الخزينة غير صالح'; END IF;
  SELECT id INTO v_counterpart FROM accounts WHERE company_id=p_company_id
    AND code=CASE v_old.receipt_type WHEN 'client' THEN '1130' WHEN 'supplier_refund' THEN '2110' ELSE '4200' END
    AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
  IF v_counterpart IS NULL OR v_counterpart=v_bank.account_id THEN RAISE EXCEPTION 'الحساب المقابل غير صالح'; END IF;
  v_reversal:=post_journal_reversal(p_company_id,v_old.journal_entry_id,'voucher_receipt_reversal',p_voucher_id,
    'عكس سند قبض رقم '||v_old.number||' (تعديل)',p_user_id);
  v_journal:=create_journal_entry(
    p_company_id,COALESCE(p_date,v_old.date),'general','سند قبض رقم '||v_old.number||': '||COALESCE(NULLIF(btrim(p_reason),''),v_old.reason),p_user_id,
    jsonb_build_array(
      jsonb_build_object('accountId',v_bank.account_id,'debit',v_amount,'credit',0),
      jsonb_build_object('accountId',v_counterpart,'debit',0,'credit',v_amount,'contactId',v_contact)
    )
  );
  v_journal_id:=(v_journal->>'id')::UUID;
  UPDATE journal_entries SET reference_type='voucher_receipt',reference_id=p_voucher_id WHERE id=v_journal_id AND company_id=p_company_id;
  UPDATE voucher_receipts SET date=COALESCE(p_date,v_old.date),contact_id=v_contact,amount=v_amount,
    bank_safe_id=v_bank.id,reason=COALESCE(NULLIF(btrim(p_reason),''),v_old.reason),journal_entry_id=v_journal_id,updated_at=now()
  WHERE id=p_voucher_id RETURNING * INTO v_voucher;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'update','voucher_receipt',p_voucher_id,to_jsonb(v_old),
    to_jsonb(v_voucher)||jsonb_build_object('reversal_journal_id',v_reversal));
  RETURN to_jsonb(v_voucher);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_voucher_receipt_atomic(
  p_company_id UUID,p_voucher_id UUID,p_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old voucher_receipts%ROWTYPE; v_voucher voucher_receipts%ROWTYPE; v_link receipt_invoice_items%ROWTYPE;
  v_invoice invoices%ROWTYPE; v_new_paid NUMERIC; v_reversal UUID;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  SELECT * INTO v_old FROM voucher_receipts WHERE id=p_voucher_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'السند غير موجود'; END IF;
  IF v_old.status='cancelled' THEN RETURN jsonb_build_object('id',p_voucher_id,'status','cancelled','already_processed',TRUE); END IF;
  IF EXISTS(SELECT 1 FROM cash_transactions WHERE company_id=p_company_id AND voucher_receipt_id=p_voucher_id)
  THEN RAISE EXCEPTION 'السند مرتبط بحركة نقدية'; END IF;
  IF v_old.status='pending' THEN
    UPDATE approval_requests SET status='cancelled',updated_at=now()
    WHERE company_id=p_company_id AND transaction_type='voucher_receipt' AND transaction_id=p_voucher_id::TEXT AND status='pending';
  ELSE
    IF v_old.journal_entry_id IS NULL THEN RAISE EXCEPTION 'السند المرحل بلا قيد'; END IF;
    FOR v_link IN SELECT * FROM receipt_invoice_items
      WHERE company_id=p_company_id AND voucher_receipt_id=p_voucher_id ORDER BY id FOR UPDATE LOOP
      SELECT * INTO v_invoice FROM invoices WHERE id=v_link.invoice_id AND company_id=p_company_id FOR UPDATE;
      IF NOT FOUND OR v_invoice.paid_amount+0.005<v_link.amount THEN RAISE EXCEPTION 'تعذر عكس تخصيص الفاتورة'; END IF;
      v_new_paid:=round(GREATEST(0,v_invoice.paid_amount-v_link.amount),2);
      UPDATE invoices SET paid_amount=v_new_paid,status=CASE WHEN v_new_paid<=0.005 THEN 'unpaid'
        WHEN v_new_paid>=total-0.005 THEN 'paid' ELSE 'partial' END WHERE id=v_invoice.id;
    END LOOP;
    v_reversal:=post_journal_reversal(p_company_id,v_old.journal_entry_id,'voucher_receipt_reversal',p_voucher_id,
      'عكس سند قبض رقم '||v_old.number||' (إلغاء)',p_user_id);
  END IF;
  UPDATE voucher_receipts SET status='cancelled',updated_at=now() WHERE id=p_voucher_id RETURNING * INTO v_voucher;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'cancel','voucher_receipt',p_voucher_id,to_jsonb(v_old),
    to_jsonb(v_voucher)||jsonb_build_object('reversal_journal_id',v_reversal));
  RETURN to_jsonb(v_voucher)||jsonb_build_object('reversal_journal_id',v_reversal);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_voucher_disbursement_atomic(
  p_company_id UUID,p_voucher_id UUID,p_date DATE,p_contact_id UUID,p_contact_set BOOLEAN,
  p_employee_id UUID,p_employee_set BOOLEAN,p_amount NUMERIC,p_bank_safe_id UUID,p_reason TEXT,p_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old voucher_disbursements%ROWTYPE; v_voucher voucher_disbursements%ROWTYPE; v_bank banks_safes%ROWTYPE;
  v_contact UUID; v_employee UUID; v_amount NUMERIC; v_counterpart UUID; v_reversal UUID;
  v_journal JSONB; v_journal_id UUID; v_balance NUMERIC;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  SELECT * INTO v_old FROM voucher_disbursements WHERE id=p_voucher_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'السند غير موجود'; END IF;
  IF v_old.status<>'approved' OR v_old.journal_entry_id IS NULL THEN RAISE EXCEPTION 'لا يمكن تعديل سند غير مرحل'; END IF;
  IF EXISTS(SELECT 1 FROM cash_transactions WHERE company_id=p_company_id AND voucher_disbursement_id=p_voucher_id)
  THEN RAISE EXCEPTION 'السند مرتبط بحركة نقدية'; END IF;
  IF EXISTS(SELECT 1 FROM disbursement_invoice_items WHERE company_id=p_company_id AND voucher_disbursement_id=p_voucher_id)
  THEN RAISE EXCEPTION 'لا يمكن تعديل سند مخصص على فواتير'; END IF;
  v_contact:=CASE WHEN p_contact_set THEN p_contact_id ELSE v_old.contact_id END;
  v_employee:=CASE WHEN p_employee_set THEN p_employee_id ELSE v_old.employee_id END;
  v_amount:=COALESCE(p_amount,v_old.amount);
  IF v_amount<=0 OR v_amount<>round(v_amount,2) OR length(COALESCE(p_reason,v_old.reason,''))>500
  THEN RAISE EXCEPTION 'بيانات السند غير صالحة'; END IF;
  IF v_contact IS NOT NULL AND NOT EXISTS(SELECT 1 FROM contacts WHERE id=v_contact AND company_id=p_company_id)
  THEN RAISE EXCEPTION 'الطرف غير موجود'; END IF;
  IF v_employee IS NOT NULL AND NOT EXISTS(SELECT 1 FROM employees WHERE id=v_employee AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'الموظف غير موجود'; END IF;
  SELECT * INTO v_bank FROM banks_safes
  WHERE id=COALESCE(p_bank_safe_id,v_old.bank_safe_id) AND company_id=p_company_id AND is_active=TRUE FOR UPDATE;
  IF NOT FOUND OR v_bank.account_id IS NULL THEN RAISE EXCEPTION 'البنك أو الخزينة غير صالح'; END IF;
  SELECT id INTO v_counterpart FROM accounts WHERE company_id=p_company_id
    AND code=CASE v_old.disbursement_type WHEN 'supplier' THEN '2110' WHEN 'employee_advance' THEN '1160'
      WHEN 'subcontractor' THEN '2150' WHEN 'client_refund' THEN '1130' ELSE '5400' END
    AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
  IF v_counterpart IS NULL OR v_counterpart=v_bank.account_id THEN RAISE EXCEPTION 'الحساب المقابل غير صالح'; END IF;
  v_reversal:=post_journal_reversal(p_company_id,v_old.journal_entry_id,'voucher_disbursement_reversal',p_voucher_id,
    'عكس سند صرف رقم '||v_old.number||' (تعديل)',p_user_id);
  v_balance:=get_account_balance(p_company_id,v_bank.account_id,NULL,NULL);
  IF v_balance+0.005<v_amount THEN RAISE EXCEPTION 'الرصيد غير كاف للصرف'; END IF;
  v_journal:=create_journal_entry(
    p_company_id,COALESCE(p_date,v_old.date),'general','سند صرف رقم '||v_old.number||': '||COALESCE(NULLIF(btrim(p_reason),''),v_old.reason),p_user_id,
    jsonb_build_array(
      jsonb_build_object('accountId',v_counterpart,'debit',v_amount,'credit',0,'contactId',v_contact),
      jsonb_build_object('accountId',v_bank.account_id,'debit',0,'credit',v_amount)
    )
  );
  v_journal_id:=(v_journal->>'id')::UUID;
  UPDATE journal_entries SET reference_type='voucher_disbursement',reference_id=p_voucher_id WHERE id=v_journal_id AND company_id=p_company_id;
  UPDATE voucher_disbursements SET date=COALESCE(p_date,v_old.date),contact_id=v_contact,employee_id=v_employee,
    amount=v_amount,bank_safe_id=v_bank.id,reason=COALESCE(NULLIF(btrim(p_reason),''),v_old.reason),journal_entry_id=v_journal_id,updated_at=now()
  WHERE id=p_voucher_id RETURNING * INTO v_voucher;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'update','voucher_disbursement',p_voucher_id,to_jsonb(v_old),
    to_jsonb(v_voucher)||jsonb_build_object('reversal_journal_id',v_reversal));
  RETURN to_jsonb(v_voucher);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_voucher_disbursement_atomic(
  p_company_id UUID,p_voucher_id UUID,p_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old voucher_disbursements%ROWTYPE; v_voucher voucher_disbursements%ROWTYPE;
  v_link disbursement_invoice_items%ROWTYPE; v_invoice purchase_invoices%ROWTYPE;
  v_new_paid NUMERIC; v_reversal UUID;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  SELECT * INTO v_old FROM voucher_disbursements WHERE id=p_voucher_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'السند غير موجود'; END IF;
  IF v_old.status='cancelled' THEN RETURN jsonb_build_object('id',p_voucher_id,'status','cancelled','already_processed',TRUE); END IF;
  IF EXISTS(SELECT 1 FROM cash_transactions WHERE company_id=p_company_id AND voucher_disbursement_id=p_voucher_id)
  THEN RAISE EXCEPTION 'السند مرتبط بحركة نقدية'; END IF;
  IF v_old.status='pending' THEN
    UPDATE approval_requests SET status='cancelled',updated_at=now()
    WHERE company_id=p_company_id AND transaction_type='voucher_disbursement' AND transaction_id=p_voucher_id::TEXT AND status='pending';
  ELSE
    IF v_old.journal_entry_id IS NULL THEN RAISE EXCEPTION 'السند المرحل بلا قيد'; END IF;
    FOR v_link IN SELECT * FROM disbursement_invoice_items
      WHERE company_id=p_company_id AND voucher_disbursement_id=p_voucher_id ORDER BY id FOR UPDATE LOOP
      SELECT * INTO v_invoice FROM purchase_invoices WHERE id=v_link.purchase_invoice_id AND company_id=p_company_id FOR UPDATE;
      IF NOT FOUND OR v_invoice.paid_amount+0.005<v_link.amount THEN RAISE EXCEPTION 'تعذر عكس تخصيص فاتورة الشراء'; END IF;
      v_new_paid:=round(GREATEST(0,v_invoice.paid_amount-v_link.amount),2);
      UPDATE purchase_invoices SET paid_amount=v_new_paid,status=CASE WHEN v_new_paid<=0.005 THEN 'unpaid'
        WHEN v_new_paid>=total-0.005 THEN 'paid' ELSE 'partial' END WHERE id=v_invoice.id;
    END LOOP;
    v_reversal:=post_journal_reversal(p_company_id,v_old.journal_entry_id,'voucher_disbursement_reversal',p_voucher_id,
      'عكس سند صرف رقم '||v_old.number||' (إلغاء)',p_user_id);
    UPDATE employee_advances SET status='cancelled'
    WHERE company_id=p_company_id AND journal_entry_id=v_old.journal_entry_id;
  END IF;
  UPDATE voucher_disbursements SET status='cancelled',updated_at=now() WHERE id=p_voucher_id RETURNING * INTO v_voucher;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'cancel','voucher_disbursement',p_voucher_id,to_jsonb(v_old),
    to_jsonb(v_voucher)||jsonb_build_object('reversal_journal_id',v_reversal));
  RETURN to_jsonb(v_voucher)||jsonb_build_object('reversal_journal_id',v_reversal);
END;
$$;

REVOKE ALL ON FUNCTION public.update_voucher_receipt_atomic(UUID,UUID,DATE,UUID,BOOLEAN,NUMERIC,UUID,TEXT,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cancel_voucher_receipt_atomic(UUID,UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.update_voucher_disbursement_atomic(UUID,UUID,DATE,UUID,BOOLEAN,UUID,BOOLEAN,NUMERIC,UUID,TEXT,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cancel_voucher_disbursement_atomic(UUID,UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.update_voucher_receipt_atomic(UUID,UUID,DATE,UUID,BOOLEAN,NUMERIC,UUID,TEXT,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_voucher_receipt_atomic(UUID,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_voucher_disbursement_atomic(UUID,UUID,DATE,UUID,BOOLEAN,UUID,BOOLEAN,NUMERIC,UUID,TEXT,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_voucher_disbursement_atomic(UUID,UUID,UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.deactivate_inactive_expired_companies(p_cutoff TIMESTAMPTZ)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sub subscriptions%ROWTYPE; v_companies INT:=0; v_users INT:=0; v_rows INT;
BEGIN
  IF p_cutoff IS NULL OR p_cutoff>now()-INTERVAL '14 days' THEN RAISE EXCEPTION 'فترة عدم النشاط غير صالحة'; END IF;
  FOR v_sub IN
    SELECT s.* FROM subscriptions s
    JOIN companies c ON c.id=s.company_id
    WHERE COALESCE(c.is_active,TRUE)=TRUE
      AND s.status IN ('trial','expired','cancelled')
      AND COALESCE(s.trial_end_date,s.end_date,s.updated_at::DATE)<p_cutoff::DATE
      AND NOT EXISTS(
        SELECT 1 FROM users u WHERE u.company_id=s.company_id AND u.is_active=TRUE
          AND COALESCE(u.last_activity,u.last_login,u.created_at)>=p_cutoff
      )
    ORDER BY s.company_id FOR UPDATE OF s
  LOOP
    UPDATE companies SET is_active=FALSE WHERE id=v_sub.company_id AND COALESCE(is_active,TRUE)=TRUE;
    GET DIAGNOSTICS v_rows=ROW_COUNT; v_companies:=v_companies+v_rows;
    UPDATE users SET is_active=FALSE WHERE company_id=v_sub.company_id AND is_active=TRUE;
    GET DIAGNOSTICS v_rows=ROW_COUNT; v_users:=v_users+v_rows;
    UPDATE subscriptions SET status='cancelled',auto_renew=FALSE,updated_at=now() WHERE id=v_sub.id;
    INSERT INTO security_audit_log(company_id,action,details)
    VALUES(v_sub.company_id,'inactive_company_deactivated',jsonb_build_object('cutoff',p_cutoff,'subscription_id',v_sub.id));
  END LOOP;
  RETURN jsonb_build_object('deactivated_companies',v_companies,'deactivated_users',v_users);
END;
$$;
REVOKE ALL ON FUNCTION public.deactivate_inactive_expired_companies(TIMESTAMPTZ) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.deactivate_inactive_expired_companies(TIMESTAMPTZ) TO service_role;

CREATE OR REPLACE FUNCTION public.restore_company_backup_atomic(
  p_company_id UUID, p_user_id UUID, p_hmac_signature TEXT, p_data JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_table TEXT; v_row JSONB; v_existing_company UUID; v_updates TEXT;
  v_restored INT:=0; v_table_count INT:=0;
  v_restore_tables CONSTANT TEXT[]:=ARRAY['accounts','contacts','projects','banks_safes','inventory_items','employees'];
  v_known_tables CONSTANT TEXT[]:=ARRAY['accounts','journal_entries','journal_lines','invoices','invoice_items','contacts','clients','projects','banks_safes','cash_transactions','inventory_items','employees','payroll'];
BEGIN
  IF NOT jsonb_typeof(p_data)='object' THEN RAISE EXCEPTION 'بيانات النسخة غير صالحة'; END IF;
  PERFORM 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE AND role='admin';
  IF NOT FOUND THEN RAISE EXCEPTION 'المستخدم غير مخول بالاستعادة'; END IF;
  PERFORM 1 FROM backup_logs WHERE company_id=p_company_id AND hmac_signature=p_hmac_signature;
  IF NOT FOUND THEN RAISE EXCEPTION 'توقيع النسخة غير صالح'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE NOT (k=ANY(v_known_tables))) THEN
    RAISE EXCEPTION 'النسخة تحتوي على جدول غير مسموح';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('backup:'||p_company_id::TEXT,0));

  FOREACH v_table IN ARRAY v_restore_tables LOOP
    IF p_data ? v_table THEN
      IF jsonb_typeof(p_data->v_table)<>'array' THEN RAISE EXCEPTION 'بيانات الجدول % غير صالحة',v_table; END IF;
      v_table_count:=v_table_count+1;
      SELECT string_agg(format('%1$I=EXCLUDED.%1$I',a.attname),',') INTO v_updates
      FROM pg_attribute a WHERE a.attrelid=format('public.%I',v_table)::regclass
        AND a.attnum>0 AND NOT a.attisdropped AND a.attname NOT IN('id','company_id','created_at');
      FOR v_row IN SELECT value FROM jsonb_array_elements(p_data->v_table) LOOP
        IF jsonb_typeof(v_row)<>'object' OR NOT(v_row?'id') THEN RAISE EXCEPTION 'سجل غير صالح في %',v_table; END IF;
        IF v_row?'company_id' AND v_row->>'company_id'<>p_company_id::TEXT THEN
          RAISE EXCEPTION 'سجل من شركة أخرى في %',v_table;
        END IF;
        EXECUTE format('SELECT company_id FROM public.%I WHERE id=$1 FOR UPDATE',v_table)
          INTO v_existing_company USING (v_row->>'id')::UUID;
        IF v_existing_company IS NOT NULL AND v_existing_company<>p_company_id THEN
          RAISE EXCEPTION 'المعرف مستخدم بواسطة شركة أخرى في %',v_table;
        END IF;
        v_row:=v_row||jsonb_build_object('company_id',p_company_id);
        EXECUTE format(
          'INSERT INTO public.%1$I SELECT (jsonb_populate_record(NULL::public.%1$I,$1)).* '
          'ON CONFLICT(id) DO UPDATE SET %2$s WHERE %1$I.company_id=$2',v_table,v_updates
        ) USING v_row,p_company_id;
        v_restored:=v_restored+1;
      END LOOP;
    END IF;
  END LOOP;
  INSERT INTO security_audit_log(company_id,user_id,action,details)
  VALUES(p_company_id,p_user_id,'backup_restore_atomic',jsonb_build_object('restored_records',v_restored,'restored_tables',v_table_count));
  RETURN jsonb_build_object('restored_records',v_restored,'restored_tables',v_table_count);
END;
$$;
REVOKE ALL ON FUNCTION public.restore_company_backup_atomic(UUID,UUID,TEXT,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.restore_company_backup_atomic(UUID,UUID,TEXT,JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.respond_approval_request_atomic(
  p_company_id UUID,p_approval_id UUID,p_action TEXT,p_approver_user_id UUID,p_comments TEXT DEFAULT ''
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_req approval_requests%ROWTYPE; v_role TEXT; v_type TEXT; v_final_status TEXT; v_entity_id UUID; v_now TIMESTAMPTZ:=now();
BEGIN
  IF p_action NOT IN('approve','reject') THEN RAISE EXCEPTION 'قرار الاعتماد غير صالح'; END IF;
  v_final_status:=CASE WHEN p_action='approve' THEN 'approved' ELSE 'rejected' END;
  IF length(COALESCE(p_comments,''))>2000 THEN RAISE EXCEPTION 'تعليق الاعتماد طويل جداً'; END IF;
  SELECT role INTO v_role FROM users WHERE id=p_approver_user_id AND company_id=p_company_id AND is_active=TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المعتمد لا ينتمي للشركة'; END IF;
  SELECT * INTO v_req FROM approval_requests WHERE id=p_approval_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'طلب الاعتماد غير موجود'; END IF;
  IF v_req.requester_id=p_approver_user_id THEN RAISE EXCEPTION 'لا يمكن اعتماد طلبك بنفسك'; END IF;
  IF v_req.approver_id IS DISTINCT FROM p_approver_user_id AND v_role<>'admin' THEN RAISE EXCEPTION 'لست المخول بالاعتماد على هذا الطلب'; END IF;
  IF v_req.status IN('approved','rejected') THEN
    IF v_req.status=v_final_status THEN
      RETURN jsonb_build_object('id',v_req.id,'status',v_req.status,'replayed',TRUE);
    END IF;
    RAISE EXCEPTION 'تمت معالجة طلب الاعتماد مسبقاً';
  END IF;
  IF v_req.status NOT IN('pending','processing') THEN RAISE EXCEPTION 'طلب الاعتماد غير قابل للمعالجة'; END IF;
  IF v_req.status='processing' AND v_req.approved_by IS DISTINCT FROM p_approver_user_id AND v_role<>'admin' THEN
    RAISE EXCEPTION 'طلب الاعتماد قيد المعالجة بواسطة مستخدم آخر';
  END IF;
  v_type:=COALESCE(v_req.entity_type,v_req.transaction_type);
  BEGIN v_entity_id:=COALESCE(v_req.entity_id,v_req.transaction_id::UUID); EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'معرف العنصر غير صالح'; END;
  IF v_type IN('voucher_receipt','voucher_disbursement') THEN RAISE EXCEPTION 'استخدم معاملة اعتماد السند المخصصة'; END IF;

  IF p_action='approve' THEN
    IF v_type='journal_entry' THEN
      UPDATE journal_entries SET status='posted',approved_by=p_approver_user_id,approved_at=v_now WHERE id=v_entity_id AND company_id=p_company_id;
    ELSIF v_type='purchase_invoice' THEN
      UPDATE purchase_invoices SET approved_by=p_approver_user_id,approved_at=v_now WHERE id=v_entity_id AND company_id=p_company_id;
    ELSIF v_type='payroll' THEN
      UPDATE salary_sheets SET status='approved',approved_by=p_approver_user_id,approved_at=v_now WHERE id=v_entity_id AND company_id=p_company_id;
    ELSIF v_type='cash_transaction' THEN
      UPDATE cash_transactions SET approved_by=p_approver_user_id,approved_at=v_now WHERE id=v_entity_id AND company_id=p_company_id AND status<>'cancelled';
    ELSE RAISE EXCEPTION 'نوع العنصر غير مدعوم للاعتماد';
    END IF;
    IF NOT FOUND THEN RAISE EXCEPTION 'العنصر المطلوب اعتماده غير موجود أو غير قابل للاعتماد'; END IF;
  END IF;

  UPDATE approval_requests SET status=v_final_status,
    approved_by=p_approver_user_id,approved_at=v_now,approval_comments=NULLIF(trim(COALESCE(p_comments,'')),''),updated_at=v_now
    WHERE id=p_approval_id;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_approver_user_id,p_action||'_approval','approval_request',p_approval_id,
    jsonb_build_object('status',v_req.status),jsonb_build_object('status',v_final_status,'entity_type',v_type,'entity_id',v_entity_id,'comments',p_comments));
  IF v_req.requester_id IS NOT NULL THEN
    INSERT INTO notifications(company_id,user_id,type,title,message,entity_type,entity_id)
    VALUES(p_company_id,v_req.requester_id,'approval_response',CASE WHEN p_action='approve' THEN 'تم اعتماد طلبك' ELSE 'تم رفض طلبك' END,
      left(COALESCE(NULLIF(trim(p_comments),''),CASE WHEN p_action='approve' THEN 'تم الاعتماد بنجاح' ELSE 'تم الرفض' END),1000),'approval_request',p_approval_id);
  END IF;
  RETURN jsonb_build_object('id',p_approval_id,'status',v_final_status,'approved_by',p_approver_user_id,'approved_at',v_now,'replayed',FALSE);
END;
$$;
REVOKE ALL ON FUNCTION public.respond_approval_request_atomic(UUID,UUID,TEXT,UUID,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.respond_approval_request_atomic(UUID,UUID,TEXT,UUID,TEXT) TO service_role;

UPDATE subscriptions s SET trial_extended_by=NULL
WHERE trial_extended_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM admin_users a WHERE a.id=s.trial_extended_by);
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_trial_extended_by_fkey;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_trial_extended_by_fkey
  FOREIGN KEY(trial_extended_by) REFERENCES admin_users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.extend_company_trial_atomic(
  p_company_id UUID,p_admin_id UUID,p_days INT,p_reason TEXT DEFAULT ''
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_sub subscriptions%ROWTYPE; v_old_end DATE; v_new_end DATE;
BEGIN
  IF p_days<>7 OR length(COALESCE(p_reason,''))>500 THEN RAISE EXCEPTION 'بيانات تمديد التجربة غير صالحة'; END IF;
  IF NOT EXISTS(SELECT 1 FROM admin_users WHERE id=p_admin_id AND is_active=TRUE) THEN RAISE EXCEPTION 'المدير غير صالح'; END IF;
  IF NOT EXISTS(SELECT 1 FROM companies WHERE id=p_company_id) THEN RAISE EXCEPTION 'الشركة غير موجودة'; END IF;
  SELECT * INTO v_sub FROM subscriptions WHERE company_id=p_company_id ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'لا يوجد اشتراك لهذه الشركة'; END IF;
  IF v_sub.status<>'trial' THEN RAISE EXCEPTION 'التمديد متاح فقط للباقات التجريبية'; END IF;
  IF COALESCE(v_sub.trial_extended,FALSE) THEN
    RETURN jsonb_build_object('id',v_sub.id,'end_date',v_sub.end_date,'trial_end_date',v_sub.trial_end_date,'already_extended',TRUE);
  END IF;
  v_old_end:=COALESCE(v_sub.trial_end_date,v_sub.end_date,CURRENT_DATE);
  v_new_end:=v_old_end+p_days;
  UPDATE subscriptions SET end_date=v_new_end,trial_end_date=v_new_end,trial_extended=TRUE,
    trial_extended_by=p_admin_id,trial_extended_at=now(),original_end_date=v_old_end,updated_at=now()
    WHERE id=v_sub.id RETURNING * INTO v_sub;
  INSERT INTO admin_audit_log(admin_id,action,details,target_type,target_id)
  VALUES(p_admin_id,'extend_trial',format('Extended trial by %s days. Reason: %s',p_days,COALESCE(NULLIF(trim(p_reason),''),'N/A')),'company',p_company_id);
  INSERT INTO notifications(company_id,type,title,message)
  VALUES(p_company_id,'subscription','تم تمديد الفترة التجريبية','تم تمديد فترتك التجريبية 7 أيام إضافية. تنتهي الآن في '||v_new_end::TEXT);
  RETURN jsonb_build_object('id',v_sub.id,'end_date',v_sub.end_date,'trial_end_date',v_sub.trial_end_date,'already_extended',FALSE);
END;
$$;
REVOKE ALL ON FUNCTION public.extend_company_trial_atomic(UUID,UUID,INT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.extend_company_trial_atomic(UUID,UUID,INT,TEXT) TO service_role;
