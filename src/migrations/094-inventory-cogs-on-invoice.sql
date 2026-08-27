-- ============================================================
-- 094: ربط المخزون بفواتير المبيعات — تكلفة البضاعة المباعة تلقائيًا
-- ------------------------------------------------------------
-- الفجوة (1 من التدقيق العالمي): بنود الفاتورة من نوع «مخزون» لم
-- تكن تخصم من المستودع ولا تسجل COGS عند البيع.
-- الحل (محاذاة Odoo/QuickBooks):
--  1) invoice_items.inventory_item_id لربط بند الفاتورة بالصنف.
--  2) consume_invoice_stock_internal: خصم الكمية بالتكلفة المرجحة
--     (AVCO) بصفوف FOR UPDATE وقفل ذري بنفس مفتاح حركات المخزون،
--     قيد COGS واحد (5100 مدين / 1170 دائن) مرجعه 'invoice_cogs'،
--     وسجل حركة 'issue' مرجعه الفاتورة لكل بند.
--  3) create_sales_invoice_atomic: يخزن inventory_item_id في البنود
--     ويستدعي المستهلك داخل نفس المعاملة.
--  4) cancel_sales_invoice_atomic: يعكس قيد COGS ويعيد الكميات
--     بتكلفتها الأصلية من سجل الحركات (حركة 'return').
-- كل الدوال plpgsql — إعادة تعريف آمنة وقابلة للتكرار.
-- ============================================================

ALTER TABLE invoice_items
  ADD COLUMN IF NOT EXISTS inventory_item_id UUID REFERENCES inventory_items(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_invoice_items_inventory
  ON invoice_items(company_id, inventory_item_id) WHERE inventory_item_id IS NOT NULL;

-- ------------------------------------------------------------
-- مستهلك المخزون: يخصم الكميات ويرحل قيد التكلفة (يستدعى داخل معاملة الفاتورة)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consume_invoice_stock_internal(
  p_company_id UUID, p_invoice_id UUID, p_invoice_number INT,
  p_items JSONB, p_date DATE, p_user_id UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item JSONB; v_inv_item inventory_items%ROWTYPE;
  v_qty NUMERIC; v_cost NUMERIC; v_value NUMERIC; v_total NUMERIC := 0;
  v_inventory UUID; v_cogs UUID; v_lines JSONB;
  v_journal JSONB; v_journal_id UUID; v_txn_id UUID;
BEGIN
  IF jsonb_typeof(p_items) <> 'array' THEN RETURN NULL; END IF;

  SELECT id INTO v_inventory FROM accounts
    WHERE company_id = p_company_id AND code = '1170'
      AND COALESCE(is_active, TRUE) AND NOT COALESCE(is_header, FALSE);
  SELECT id INTO v_cogs FROM accounts
    WHERE company_id = p_company_id AND code = '5100'
      AND COALESCE(is_active, TRUE) AND NOT COALESCE(is_header, FALSE);
  IF v_inventory IS NULL OR v_cogs IS NULL THEN
    RAISE EXCEPTION 'حسابات المخزون (1170) أو التكلفة (5100) غير مكتملة';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_qty := COALESCE((v_item->>'quantity')::NUMERIC, 0);
    CONTINUE WHEN NULLIF(COALESCE(v_item->>'inventory_item_id', ''), '') IS NULL OR v_qty <= 0;

    SELECT * INTO v_inv_item FROM inventory_items
    WHERE id = (v_item->>'inventory_item_id')::UUID AND company_id = p_company_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'صنف مخزني غير موجود في بنود الفاتورة'; END IF;
    -- نفس قفل حركات المخزون الذري لمنع سباق الكميات مع الحركات اليدوية
    PERFORM pg_advisory_xact_lock(hashtextextended('inventory-stock:'||p_company_id::TEXT||':'||lower(v_inv_item.code),0));
    SELECT * INTO v_inv_item FROM inventory_items
    WHERE id = v_inv_item.id AND company_id = p_company_id FOR UPDATE;
    IF NOT COALESCE(v_inv_item.is_active, TRUE) THEN
      RAISE EXCEPTION 'الصنف المخزني % غير نشط', v_inv_item.name;
    END IF;
    IF COALESCE(v_inv_item.quantity, 0) + 0.005 < v_qty THEN
      RAISE EXCEPTION 'الكمية غير متوفرة في المخزون للصنف % (المتاح %)', v_inv_item.name, v_inv_item.quantity;
    END IF;

    v_cost := COALESCE(v_inv_item.unit_price, 0);
    v_value := ROUND(v_qty * v_cost, 2);

    UPDATE inventory_items
    SET quantity = ROUND(COALESCE(quantity, 0) - v_qty, 2), updated_at = now()
    WHERE id = v_inv_item.id;

    INSERT INTO inventory_transactions(
      id, company_id, item_id, warehouse_id, type, quantity, unit_price, total_value,
      balance_before, balance_after, date, reference_type, reference_id, created_by
    ) VALUES (
      gen_random_uuid(), p_company_id, v_inv_item.id, v_inv_item.warehouse_id, 'issue',
      v_qty, v_cost, v_value, COALESCE(v_inv_item.quantity, 0),
      ROUND(COALESCE(v_inv_item.quantity, 0) - v_qty, 2), p_date, 'invoice', p_invoice_id, p_user_id
    );

    v_lines := COALESCE(v_lines, '[]'::JSONB) || jsonb_build_array(jsonb_build_object(
      'accountId', v_inventory, 'debit', 0, 'credit', v_value,
      'description', 'تكلفة الصنف: ' || v_inv_item.name));
    v_total := v_total + v_value;
  END LOOP;

  IF v_total <= 0 THEN RETURN NULL; END IF;

  -- سطر مدين واحد للتكلفة يجمع بنود الفاتورة + أسطر دائن لكل صنف
  v_lines := jsonb_build_array(jsonb_build_object(
    'accountId', v_cogs, 'debit', v_total, 'credit', 0,
    'description', 'تكلفة بضاعة مباعة — فاتورة رقم ' || COALESCE(p_invoice_number::TEXT, '')
  )) || v_lines;
  v_journal := create_journal_entry(
    p_company_id, p_date, 'general',
    'تكلفة بضاعة مباعة لفاتورة رقم ' || COALESCE(p_invoice_number::TEXT, ''),
    p_user_id, v_lines
  );
  v_journal_id := (v_journal->>'id')::UUID;
  UPDATE journal_entries SET reference_type = 'invoice_cogs', reference_id = p_invoice_id
  WHERE id = v_journal_id AND company_id = p_company_id;
  UPDATE inventory_transactions SET journal_entry_id = v_journal_id
  WHERE company_id = p_company_id AND reference_type = 'invoice' AND reference_id = p_invoice_id
    AND type = 'issue' AND journal_entry_id IS NULL;
  RETURN v_journal_id;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_invoice_stock_internal(UUID,UUID,INT,JSONB,DATE,UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_invoice_stock_internal(UUID,UUID,INT,JSONB,DATE,UUID)
  TO service_role;

-- ------------------------------------------------------------
-- إنشاء فاتورة المبيعات: يخزن ربط الصنف ويستهلك المخزون بنفس المعاملة
-- ------------------------------------------------------------
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

REVOKE ALL ON FUNCTION public.create_sales_invoice_atomic(UUID,UUID,UUID,DATE,DATE,JSONB,NUMERIC,BOOLEAN,TEXT,NUMERIC,UUID,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_sales_invoice_atomic(UUID,UUID,UUID,DATE,DATE,JSONB,NUMERIC,BOOLEAN,TEXT,NUMERIC,UUID,UUID) TO service_role;

-- ------------------------------------------------------------
-- الإلغاء: يعكس قيد التكلفة ويعيد الكميات بتكلفتها الأصلية
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_sales_invoice_atomic(
  p_company_id UUID, p_invoice_id UUID, p_notes TEXT, p_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old invoices%ROWTYPE; v_invoice invoices%ROWTYPE; v_reversal UUID;
  v_cogs_je UUID; v_cogs_reversal UUID;
  v_rec RECORD; v_inv_item inventory_items%ROWTYPE; v_issue inventory_transactions%ROWTYPE;
  v_txn_id UUID; v_after NUMERIC;
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

  -- عكس قيد تكلفة البضاعة المباعة إن وُجد (مستقل عن قيد الإيراد)
  SELECT id INTO v_cogs_je FROM journal_entries
  WHERE company_id = p_company_id AND reference_type = 'invoice_cogs'
    AND reference_id = p_invoice_id AND status = 'posted' AND reversed_by IS NULL
  LIMIT 1;
  IF v_cogs_je IS NOT NULL THEN
    v_cogs_reversal := post_journal_reversal(
      p_company_id, v_cogs_je, 'invoice_cogs_reversal', p_invoice_id,
      'عكس قيد تكلفة بضاعة مباعة لفاتورة رقم ' || v_old.number, p_user_id
    );
  END IF;

  -- إرجاع الكميات للمستودعات بتكلفتها الأصلية من سجل حركات الصرف
  FOR v_rec IN
    SELECT ii.inventory_item_id, ii.quantity
    FROM invoice_items ii
    WHERE ii.company_id = p_company_id AND ii.invoice_id = p_invoice_id
      AND ii.inventory_item_id IS NOT NULL
  LOOP
    SELECT * INTO v_issue FROM inventory_transactions
    WHERE company_id = p_company_id AND reference_type = 'invoice'
      AND reference_id = p_invoice_id AND item_id = v_rec.inventory_item_id
      AND type = 'issue'
    ORDER BY id LIMIT 1;
    CONTINUE WHEN NOT FOUND;

    SELECT * INTO v_inv_item FROM inventory_items
    WHERE id = v_rec.inventory_item_id AND company_id = p_company_id FOR UPDATE;
    v_after := ROUND(COALESCE(v_inv_item.quantity, 0) + v_rec.quantity, 2);
    UPDATE inventory_items SET quantity = v_after, updated_at = now()
    WHERE id = v_rec.inventory_item_id;

    v_txn_id := gen_random_uuid();
    INSERT INTO inventory_transactions(
      id, company_id, item_id, warehouse_id, type, quantity, unit_price, total_value,
      balance_before, balance_after, date, reference_type, reference_id,
      journal_entry_id, created_by
    ) VALUES (
      v_txn_id, p_company_id, v_rec.inventory_item_id, v_issue.warehouse_id, 'return',
      v_rec.quantity, v_issue.unit_price, ROUND(v_rec.quantity * COALESCE(v_issue.unit_price, 0), 2),
      COALESCE(v_inv_item.quantity, 0), v_after, v_old.date, 'invoice_cancellation',
      p_invoice_id, v_cogs_reversal, p_user_id
    );
  END LOOP;

  UPDATE invoices SET status='cancelled',
    notes=COALESCE(NULLIF(btrim(p_notes),''),v_old.notes),updated_at=now()
  WHERE id=p_invoice_id RETURNING * INTO v_invoice;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'cancel','invoice',p_invoice_id,to_jsonb(v_old),
    to_jsonb(v_invoice)||jsonb_build_object('reversal_journal_id',v_reversal,
      'cogs_reversal_journal_id',v_cogs_reversal));
  RETURN to_jsonb(v_invoice)||jsonb_build_object('reversal_journal_id',v_reversal,
    'cogs_reversal_journal_id',v_cogs_reversal);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_sales_invoice_atomic(UUID,UUID,TEXT,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_sales_invoice_atomic(UUID,UUID,TEXT,UUID) TO service_role;
