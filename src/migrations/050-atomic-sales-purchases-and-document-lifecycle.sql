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
