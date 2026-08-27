-- ============================================================
-- 093: توحيد دلالات خصم بند فاتورة المبيعات (نسبة مئوية)
-- ------------------------------------------------------------
-- الخطأ: الواجهة تحسب خصم البند كنسبة (gross × %) ويعرض للعميل
-- 1000 − 10% = 900، بينما دالة الإنشاء تطرح الخصم كمبلغ مطلق
-- (gross − 10 = 990) فتُسجَّل الفاتورة وقيد ضريبتها على رقم
-- لا يطابق ما ظهر للمستخدم — انعدام اتساق محاسبي حقيقي.
-- الحل: المعادلة في الخلفية تصبح نسبية مطابقة للواجهة
-- ومعَيار البرامج العالمية (QuickBooks/Daftra/Qoyod):
--   صافي البند = gross − round(gross × discount/100، 2)
-- ويصار الخصم 0..100 بدل 0..gross.
-- الدالة LANGUAGE plpgsql — إعادة تعريف آمنة وقابلة للتكرار.
-- ============================================================

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
      company_id, invoice_id, description, quantity, unit_price, total
    ) VALUES (
      p_company_id, v_invoice.id, btrim(v_item->>'description'), v_qty,
      v_price, round(v_qty * v_price - round(v_qty * v_price * v_discount / 100, 2), 2)
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

