-- 047 - Harden the authoritative journal-entry writer.
-- The application validates input too, but financial invariants must remain true
-- when this RPC is called directly or a future route bypasses application code.

CREATE OR REPLACE FUNCTION create_journal_entry(
  p_company_id UUID,
  p_date DATE,
  p_type TEXT,
  p_description TEXT,
  p_created_by UUID,
  p_lines JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_entry_id UUID;
  v_number INT;
  v_total_debit NUMERIC := 0;
  v_total_credit NUMERIC := 0;
  v_line JSONB;
  v_account RECORD;
  v_debit NUMERIC;
  v_credit NUMERIC;
  v_contact_id UUID;
  v_project_id UUID;
  v_resolved_lines JSONB := '[]'::JSONB;
BEGIN
  IF p_company_id IS NULL OR p_created_by IS NULL OR p_date IS NULL THEN
    RAISE EXCEPTION 'بيانات القيد الأساسية غير مكتملة';
  END IF;
  IF p_type NOT IN ('general', 'opening_balance', 'accrual', 'closing', 'reversing') THEN
    RAISE EXCEPTION 'نوع القيد غير صالح';
  END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'يجب أن يحتوي القيد على سطرين على الأقل';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM users WHERE id = p_created_by AND company_id = p_company_id AND is_active = true
  ) THEN
    RAISE EXCEPTION 'المستخدم المنشئ لا ينتمي إلى الشركة أو غير نشط';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    BEGIN
      v_debit := COALESCE((v_line->>'debit')::NUMERIC, 0);
      v_credit := COALESCE((v_line->>'credit')::NUMERIC, 0);
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'مبلغ مدين أو دائن غير صالح';
    END;
    IF v_debit < 0 OR v_credit < 0 OR (v_debit = 0 AND v_credit = 0) OR (v_debit > 0 AND v_credit > 0) THEN
      RAISE EXCEPTION 'يجب أن يكون كل سطر مديناً أو دائناً موجباً فقط';
    END IF;
    -- journal_lines is NUMERIC(15,2); reject rather than silently round a
    -- valid-looking balanced payload into an unbalanced posted entry.
    IF v_debit <> ROUND(v_debit, 2) OR v_credit <> ROUND(v_credit, 2)
       OR v_debit > 9999999999999.99 OR v_credit > 9999999999999.99 THEN
      RAISE EXCEPTION 'المبالغ يجب ألا تتجاوز منزلتين عشريتين والحد المحاسبي المسموح';
    END IF;

    BEGIN
      SELECT id, code, name INTO STRICT v_account
      FROM accounts
      WHERE id = (v_line->>'accountId')::UUID
        AND company_id = p_company_id
        AND COALESCE(is_active, true) = true
        AND COALESCE(is_header, false) = false;
    EXCEPTION WHEN no_data_found THEN
      RAISE EXCEPTION 'الحساب المحدد غير موجود أو غير نشط أو حساب رئيسي';
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'معرف الحساب غير صالح';
    END;

    IF NULLIF(v_line->>'contactId', '') IS NOT NULL THEN
      BEGIN
        v_contact_id := (v_line->>'contactId')::UUID;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'معرف الطرف غير صالح';
      END;
      IF NOT EXISTS (SELECT 1 FROM contacts WHERE id = v_contact_id AND company_id = p_company_id) THEN
        RAISE EXCEPTION 'الطرف المحدد لا ينتمي إلى الشركة';
      END IF;
    ELSE
      v_contact_id := NULL;
    END IF;

    IF NULLIF(v_line->>'projectId', '') IS NOT NULL THEN
      BEGIN
        v_project_id := (v_line->>'projectId')::UUID;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'معرف المشروع غير صالح';
      END;
      IF NOT EXISTS (SELECT 1 FROM projects WHERE id = v_project_id AND company_id = p_company_id) THEN
        RAISE EXCEPTION 'المشروع المحدد لا ينتمي إلى الشركة';
      END IF;
    ELSE
      v_project_id := NULL;
    END IF;

    v_total_debit := v_total_debit + v_debit;
    v_total_credit := v_total_credit + v_credit;
    -- Canonical account metadata comes exclusively from the tenant-scoped
    -- chart, never from caller-controlled accountCode/accountName fields.
    v_resolved_lines := v_resolved_lines || jsonb_build_array(jsonb_build_object(
      'accountId', v_account.id, 'accountCode', v_account.code, 'accountName', v_account.name,
      'debit', v_debit, 'credit', v_credit, 'description', NULLIF(v_line->>'description', ''),
      'contactId', v_contact_id, 'projectId', v_project_id
    ));
  END LOOP;

  IF ABS(v_total_debit - v_total_credit) > 0.005 THEN
    RAISE EXCEPTION 'خطأ في الموازنة: مجموع المدين (%) لا يساوي مجموع الدائن (%)', v_total_debit, v_total_credit;
  END IF;
  IF EXISTS (
    SELECT 1 FROM (
      SELECT l->>'accountId' AS account_id,
             SUM((l->>'debit')::NUMERIC) AS debit,
             SUM((l->>'credit')::NUMERIC) AS credit
      FROM jsonb_array_elements(v_resolved_lines) AS l
      GROUP BY l->>'accountId'
    ) grouped WHERE debit > 0 AND credit > 0
  ) THEN
    RAISE EXCEPTION 'لا يجوز ترحيل الحساب نفسه مديناً ودائناً في القيد الواحد';
  END IF;

  v_number := next_journal_number(p_company_id, EXTRACT(YEAR FROM p_date)::INT);
  INSERT INTO journal_entries (company_id, number, date, type, description, created_by)
  VALUES (p_company_id, v_number, p_date, p_type, COALESCE(p_description, ''), p_created_by)
  RETURNING id INTO v_entry_id;

  INSERT INTO journal_lines (
    company_id, journal_entry_id, account_id, account_code, account_name,
    debit, credit, description, contact_id, project_id
  )
  SELECT p_company_id, v_entry_id,
         (line->>'accountId')::UUID, line->>'accountCode', line->>'accountName',
         (line->>'debit')::NUMERIC, (line->>'credit')::NUMERIC,
         NULLIF(line->>'description', ''),
         NULLIF(line->>'contactId', '')::UUID, NULLIF(line->>'projectId', '')::UUID
  FROM jsonb_array_elements(v_resolved_lines) AS line;

  RETURN jsonb_build_object(
    'id', v_entry_id, 'number', v_number,
    'total_debit', v_total_debit, 'total_credit', v_total_credit,
    'lines_count', jsonb_array_length(v_resolved_lines)
  );
END;
$$;
