-- 101: Tender & Bond accounting correctness
--
-- Fixes production-breaking issues in 100:
--   1. Writes to tenders/bonds must set app.relationship_write_company (060 guard)
--   2. Cash cover (margin) is distinct from LG face value — do not debit the bank
--      for the full guarantee amount
--   3. Never drop VAT/commission lines while still crediting them (unbalanced JE)
--   4. close_lost is idempotent (actual 5410 cost-center balance, not original JEs)
--   5. convert_won retries still transfer remaining suspense; do not mutate bid→perf
--   6. tender_expenses writes go through the relationship write guard

ALTER TABLE bonds ADD COLUMN IF NOT EXISTS margin_amount NUMERIC(15,2) NOT NULL DEFAULT 0;
ALTER TABLE bonds ADD COLUMN IF NOT EXISTS commission_amount NUMERIC(15,2) NOT NULL DEFAULT 0;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS lost_close_journal_id UUID REFERENCES journal_entries(id);
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS convert_journal_id UUID REFERENCES journal_entries(id);

-- Persist cost_center_id (047 dropped caller-supplied costCenterId silently)
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
SET search_path=public
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
  v_cost_center_id UUID;
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

    v_cost_center_id := NULL;
    IF NULLIF(v_line->>'costCenterId', '') IS NOT NULL THEN
      BEGIN
        v_cost_center_id := (v_line->>'costCenterId')::UUID;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'معرف مركز التكلفة غير صالح';
      END;
      IF NOT EXISTS (SELECT 1 FROM cost_centers WHERE id = v_cost_center_id AND company_id = p_company_id) THEN
        RAISE EXCEPTION 'مركز التكلفة المحدد لا ينتمي إلى الشركة';
      END IF;
    END IF;

    v_total_debit := v_total_debit + v_debit;
    v_total_credit := v_total_credit + v_credit;
    v_resolved_lines := v_resolved_lines || jsonb_build_array(jsonb_build_object(
      'accountId', v_account.id, 'accountCode', v_account.code, 'accountName', v_account.name,
      'debit', v_debit, 'credit', v_credit, 'description', NULLIF(v_line->>'description', ''),
      'contactId', v_contact_id, 'projectId', v_project_id, 'costCenterId', v_cost_center_id
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
    debit, credit, description, contact_id, project_id, cost_center_id
  )
  SELECT p_company_id, v_entry_id,
         (line->>'accountId')::UUID, line->>'accountCode', line->>'accountName',
         (line->>'debit')::NUMERIC, (line->>'credit')::NUMERIC,
         NULLIF(line->>'description', ''),
         NULLIF(line->>'contactId', '')::UUID, NULLIF(line->>'projectId', '')::UUID,
         NULLIF(line->>'costCenterId', '')::UUID
  FROM jsonb_array_elements(v_resolved_lines) AS line;

  RETURN jsonb_build_object(
    'id', v_entry_id, 'number', v_number,
    'total_debit', v_total_debit, 'total_credit', v_total_credit,
    'lines_count', jsonb_array_length(v_resolved_lines)
  );
END;
$$;

-- Dedicated posting account for pre-contract costs transferred onto a won project
DO $$
DECLARE
  comp RECORD;
  v_parent UUID;
BEGIN
  FOR comp IN SELECT id FROM companies LOOP
    SELECT id INTO v_parent FROM accounts WHERE company_id=comp.id AND code='5100' LIMIT 1;
    INSERT INTO accounts (company_id, code, name, name_en, type, parent_id, is_active, is_header)
    VALUES (comp.id, '5195', 'تكاليف ما قبل التعاقد', 'Pre-contract Tender Costs', 'expense', v_parent, true, false)
    ON CONFLICT (company_id, code) DO NOTHING;

    UPDATE accounts SET parent_id = (SELECT id FROM accounts WHERE company_id=comp.id AND code='5200' LIMIT 1)
    WHERE company_id=comp.id AND code='5291'
      AND parent_id IS DISTINCT FROM (SELECT id FROM accounts WHERE company_id=comp.id AND code='5200' LIMIT 1);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.ensure_tender_cost_center(
  p_company_id UUID, p_tender_id UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_tender tenders%ROWTYPE;
  v_cc_id UUID;
  v_code TEXT;
BEGIN
  SELECT * INTO v_tender FROM tenders WHERE id=p_tender_id AND company_id=p_company_id LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF v_tender.cost_center_id IS NOT NULL THEN
    RETURN v_tender.cost_center_id;
  END IF;

  v_code := 'TND-' || UPPER(LEFT(p_tender_id::TEXT, 8));

  INSERT INTO cost_centers (company_id, code, name, description, is_active)
  VALUES (p_company_id, v_code, 'مناقصة: ' || v_tender.title, 'مركز تكلفة تلقائي للمناقصة', true)
  ON CONFLICT (company_id, code) DO NOTHING
  RETURNING id INTO v_cc_id;

  IF v_cc_id IS NULL THEN
    SELECT id INTO v_cc_id FROM cost_centers WHERE company_id=p_company_id AND code=v_code LIMIT 1;
  END IF;

  IF v_cc_id IS NOT NULL THEN
    PERFORM set_config('app.relationship_write_company', p_company_id::TEXT, TRUE);
    UPDATE tenders SET cost_center_id=v_cc_id WHERE id=p_tender_id AND company_id=p_company_id;
  END IF;

  RETURN v_cc_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_tender_expense_atomic(
  p_company_id UUID,
  p_tender_id UUID,
  p_expense_type TEXT,
  p_amount NUMERIC(15,2),
  p_vat_amount NUMERIC(15,2) DEFAULT 0,
  p_bank_safe_id UUID DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_date DATE DEFAULT NULL,
  p_user_id UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_tender tenders%ROWTYPE;
  v_cc_id UUID;
  v_debit_acc UUID;
  v_debit_code TEXT;
  v_vat_acc UUID;
  v_bank_acc UUID;
  v_bank_safe RECORD;
  v_je JSONB;
  v_lines JSONB := '[]'::JSONB;
  v_expense_id UUID;
  v_date DATE;
  v_total NUMERIC;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=true) THEN
    RAISE EXCEPTION 'المستخدم غير صالح';
  END IF;

  IF p_expense_type NOT IN ('karasa','platform_fee','bid_bond_margin','bid_bond_commission','consulting','other') THEN
    RAISE EXCEPTION 'نوع المصروف غير صالح';
  END IF;

  SELECT * INTO v_tender FROM tenders WHERE id=p_tender_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المناقصة غير موجودة'; END IF;
  IF v_tender.status IN ('lost','cancelled') THEN
    RAISE EXCEPTION 'لا يمكن تسجيل مصروف على مناقصة مغلقة';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 OR p_amount <> ROUND(p_amount, 2) THEN
    RAISE EXCEPTION 'المبلغ غير صالح';
  END IF;
  IF p_vat_amount IS NULL OR p_vat_amount < 0 OR p_vat_amount <> ROUND(p_vat_amount, 2) THEN
    RAISE EXCEPTION 'مبلغ الضريبة غير صالح';
  END IF;

  v_debit_code := CASE
    WHEN p_expense_type = 'bid_bond_margin' THEN '1185'
    WHEN p_expense_type = 'bid_bond_commission' THEN '5291'
    ELSE '5410'
  END;

  SELECT id INTO v_debit_acc FROM accounts
  WHERE company_id=p_company_id AND code=v_debit_code AND is_active=true AND NOT COALESCE(is_header, false) LIMIT 1;
  IF v_debit_acc IS NULL THEN
    RAISE EXCEPTION 'الحساب المحاسبي % غير موجود', v_debit_code;
  END IF;

  IF p_vat_amount > 0 THEN
    SELECT id INTO v_vat_acc FROM accounts
    WHERE company_id=p_company_id AND code='1180' AND is_active=true AND NOT COALESCE(is_header, false) LIMIT 1;
    IF v_vat_acc IS NULL THEN
      RAISE EXCEPTION 'حساب ضريبة القيمة المضافة المدخلة غير موجود';
    END IF;
  END IF;

  IF p_bank_safe_id IS NULL THEN
    RAISE EXCEPTION 'يجب تحديد البنك أو الخزينة';
  END IF;
  SELECT * INTO v_bank_safe FROM banks_safes WHERE id=p_bank_safe_id AND company_id=p_company_id AND is_active=true LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'البنك أو الخزينة غير موجودة'; END IF;
  v_bank_acc := v_bank_safe.account_id;
  IF v_bank_acc IS NULL THEN
    RAISE EXCEPTION 'البنك/الخزينة غير مرتبط بحساب محاسبي';
  END IF;

  v_cc_id := ensure_tender_cost_center(p_company_id, p_tender_id);
  v_date := COALESCE(p_date, CURRENT_DATE);
  v_total := p_amount + p_vat_amount;

  v_lines := v_lines || jsonb_build_array(jsonb_build_object(
    'accountId', v_debit_acc, 'debit', p_amount, 'credit', 0,
    'description', COALESCE(p_description, 'مصاريف مناقصة'), 'costCenterId', v_cc_id
  ));
  IF p_vat_amount > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'accountId', v_vat_acc, 'debit', p_vat_amount, 'credit', 0,
      'description', 'ضريبة القيمة المضافة', 'costCenterId', v_cc_id
    ));
  END IF;
  v_lines := v_lines || jsonb_build_array(jsonb_build_object(
    'accountId', v_bank_acc, 'debit', 0, 'credit', v_total,
    'description', COALESCE(p_description, 'سداد مصاريف مناقصة'), 'bankSafeId', p_bank_safe_id
  ));

  v_je := create_journal_entry(
    p_company_id, v_date, 'general',
    COALESCE(p_description, 'مصاريف مناقصة: ' || v_tender.title),
    p_user_id, v_lines
  );

  PERFORM set_config('app.relationship_write_company', p_company_id::TEXT, TRUE);

  INSERT INTO tender_expenses (
    company_id, tender_id, expense_type, amount, vat_amount,
    bank_safe_id, journal_entry_id, cost_center_id, description, date, created_by
  ) VALUES (
    p_company_id, p_tender_id, p_expense_type, p_amount, p_vat_amount,
    p_bank_safe_id, (v_je->>'id')::UUID, v_cc_id, p_description, v_date, p_user_id
  )
  RETURNING id INTO v_expense_id;

  INSERT INTO audit_log(company_id, user_id, action, entity_type, entity_id, new_values)
  VALUES(p_company_id, p_user_id, 'create', 'tender_expense', v_expense_id,
    jsonb_build_object('tender_id', p_tender_id, 'amount', p_amount, 'vat', p_vat_amount, 'journal_entry_id', v_je->>'id'));

  RETURN jsonb_build_object(
    'expense_id', v_expense_id,
    'journal_entry', v_je,
    'cost_center_id', v_cc_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.close_lost_tender_atomic(
  p_company_id UUID,
  p_tender_id UUID,
  p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_tender tenders%ROWTYPE;
  v_cc_id UUID;
  v_suspense_acc UUID;
  v_lost_acc UUID;
  v_suspense_balance NUMERIC := 0;
  v_je_id UUID;
  v_je JSONB;
  v_lines JSONB;
  v_bond RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=true) THEN
    RAISE EXCEPTION 'المستخدم غير صالح';
  END IF;

  SELECT * INTO v_tender FROM tenders WHERE id=p_tender_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المناقصة غير موجودة'; END IF;
  IF v_tender.status <> 'lost' THEN RAISE EXCEPTION 'المناقصة ليست خاسرة'; END IF;

  v_cc_id := v_tender.cost_center_id;
  IF v_cc_id IS NULL THEN v_cc_id := ensure_tender_cost_center(p_company_id, p_tender_id); END IF;

  SELECT id INTO v_suspense_acc FROM accounts WHERE company_id=p_company_id AND code='5410' AND NOT COALESCE(is_header, false) LIMIT 1;
  SELECT id INTO v_lost_acc FROM accounts WHERE company_id=p_company_id AND code='5420' AND NOT COALESCE(is_header, false) LIMIT 1;

  IF v_tender.lost_close_journal_id IS NOT NULL THEN
    v_suspense_balance := 0;
  ELSIF v_suspense_acc IS NOT NULL THEN
    SELECT COALESCE(SUM(te.amount), 0) INTO v_suspense_balance
    FROM tender_expenses te
    WHERE te.tender_id=p_tender_id AND te.company_id=p_company_id
      AND te.expense_type NOT IN ('bid_bond_margin','bid_bond_commission');
  END IF;

  IF v_suspense_balance > 0 THEN
    IF v_lost_acc IS NULL THEN RAISE EXCEPTION 'حساب مصاريف المناقصات الخاسرة غير موجود'; END IF;
    v_lines := jsonb_build_array(
      jsonb_build_object('accountId', v_lost_acc, 'debit', v_suspense_balance, 'credit', 0,
        'description', 'إقفال مصاريف مناقصة خاسرة', 'costCenterId', v_cc_id),
      jsonb_build_object('accountId', v_suspense_acc, 'debit', 0, 'credit', v_suspense_balance,
        'description', 'إقفال مصاريف مناقصة خاسرة', 'costCenterId', v_cc_id)
    );

    v_je := create_journal_entry(
      p_company_id, CURRENT_DATE, 'closing',
      'إقفال مصاريف مناقصة خاسرة: ' || v_tender.title,
      p_user_id, v_lines
    );
    v_je_id := (v_je->>'id')::UUID;
    PERFORM set_config('app.relationship_write_company', p_company_id::TEXT, TRUE);
    UPDATE tenders SET lost_close_journal_id=v_je_id, updated_at=NOW()
    WHERE id=p_tender_id AND company_id=p_company_id;
  END IF;

  FOR v_bond IN
    SELECT * FROM bonds
    WHERE tender_id=p_tender_id AND company_id=p_company_id
      AND type='bid_bond' AND status='active'
  LOOP
    PERFORM release_bond_atomic(p_company_id, v_bond.id, p_user_id);
  END LOOP;

  INSERT INTO audit_log(company_id, user_id, action, entity_type, entity_id, new_values)
  VALUES(p_company_id, p_user_id, 'close_lost', 'tender', p_tender_id,
    jsonb_build_object('suspense_closed', v_suspense_balance, 'journal_entry_id', v_je_id));

  RETURN jsonb_build_object(
    'tender_id', p_tender_id,
    'suspense_closed', v_suspense_balance,
    'journal_entry_id', v_je_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.convert_won_tender_with_accounting_atomic(
  p_company_id UUID,
  p_tender_id UUID,
  p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_tender tenders%ROWTYPE;
  v_result JSONB;
  v_project_id UUID;
  v_cc_id UUID;
  v_suspense_acc UUID;
  v_project_cost_acc UUID;
  v_suspense_balance NUMERIC := 0;
  v_lines JSONB;
  v_je JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=true) THEN
    RAISE EXCEPTION 'المستخدم غير صالح';
  END IF;

  SELECT * INTO v_tender FROM tenders WHERE id=p_tender_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المناقصة غير موجودة'; END IF;
  IF v_tender.status <> 'won' THEN RAISE EXCEPTION 'يمكن تحويل العطاءات الرابحة فقط'; END IF;

  IF v_tender.project_id IS NOT NULL THEN
    v_project_id := v_tender.project_id;
  ELSE
    v_result := convert_won_tender_to_project_atomic(p_company_id, p_tender_id, p_user_id);
    v_project_id := COALESCE((v_result->'project'->>'id')::UUID, (v_result->>'project_id')::UUID);
    IF v_project_id IS NULL THEN
      RAISE EXCEPTION 'فشل إنشاء المشروع';
    END IF;
  END IF;

  v_cc_id := v_tender.cost_center_id;
  IF v_cc_id IS NULL THEN v_cc_id := ensure_tender_cost_center(p_company_id, p_tender_id); END IF;

  PERFORM set_config('app.project_write_company', p_company_id::TEXT, TRUE);
  UPDATE projects SET cost_center_id=v_cc_id WHERE id=v_project_id AND company_id=p_company_id
    AND (cost_center_id IS NULL OR cost_center_id IS DISTINCT FROM v_cc_id);

  PERFORM set_config('app.relationship_write_company', p_company_id::TEXT, TRUE);
  UPDATE bonds SET project_id=v_project_id, updated_at=NOW()
  WHERE tender_id=p_tender_id AND company_id=p_company_id AND project_id IS NULL;

  SELECT id INTO v_suspense_acc FROM accounts WHERE company_id=p_company_id AND code='5410' AND NOT COALESCE(is_header, false) LIMIT 1;
  SELECT id INTO v_project_cost_acc FROM accounts
  WHERE company_id=p_company_id AND code='5195' AND is_active=true AND NOT COALESCE(is_header, false) LIMIT 1;
  IF v_project_cost_acc IS NULL THEN
    SELECT id INTO v_project_cost_acc FROM accounts
    WHERE company_id=p_company_id AND code='5110' AND is_active=true AND NOT COALESCE(is_header, false) LIMIT 1;
  END IF;

  IF v_tender.convert_journal_id IS NOT NULL THEN
    v_suspense_balance := 0;
  ELSIF v_suspense_acc IS NOT NULL THEN
    SELECT COALESCE(SUM(te.amount), 0) INTO v_suspense_balance
    FROM tender_expenses te
    WHERE te.tender_id=p_tender_id AND te.company_id=p_company_id
      AND te.expense_type NOT IN ('bid_bond_margin','bid_bond_commission');
  END IF;

  IF v_suspense_balance > 0 THEN
    IF v_project_cost_acc IS NULL THEN
      RAISE EXCEPTION 'حساب تكاليف ما قبل التعاقد غير موجود';
    END IF;
    v_lines := jsonb_build_array(
      jsonb_build_object('accountId', v_project_cost_acc, 'debit', v_suspense_balance, 'credit', 0,
        'description', 'تحويل مصاريف مناقصة إلى تكاليف المشروع', 'costCenterId', v_cc_id, 'projectId', v_project_id),
      jsonb_build_object('accountId', v_suspense_acc, 'debit', 0, 'credit', v_suspense_balance,
        'description', 'تحويل مصاريف مناقصة إلى تكاليف المشروع', 'costCenterId', v_cc_id)
    );

    v_je := create_journal_entry(
      p_company_id, CURRENT_DATE, 'general',
      'تحويل مصاريف مناقصة إلى مشروع: ' || v_tender.title,
      p_user_id, v_lines
    );
  END IF;

  INSERT INTO audit_log(company_id, user_id, action, entity_type, entity_id, new_values)
  VALUES(p_company_id, p_user_id, 'convert_with_accounting', 'tender', p_tender_id,
    jsonb_build_object('project_id', v_project_id, 'costs_transferred', v_suspense_balance));

  RETURN jsonb_build_object(
    'project_id', v_project_id,
    'tender_id', p_tender_id,
    'costs_transferred', v_suspense_balance,
    'already_processed', v_tender.project_id IS NOT NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_bond_issue_atomic(
  p_company_id UUID,
  p_payload JSONB,
  p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_bond_id UUID;
  v_margin_acc UUID;
  v_comm_acc UUID;
  v_vat_acc UUID;
  v_bank_acc UUID;
  v_bank_safe RECORD;
  v_lines JSONB := '[]'::JSONB;
  v_je JSONB;
  v_type TEXT;
  v_amount NUMERIC;
  v_margin NUMERIC := 0;
  v_commission NUMERIC := 0;
  v_vat_amount NUMERIC := 0;
  v_bank_safe_id UUID;
  v_cash_out NUMERIC;
  v_tender UUID;
  v_project UUID;
  v_contact UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=true) THEN
    RAISE EXCEPTION 'المستخدم غير صالح';
  END IF;

  v_type := p_payload->>'type';
  BEGIN
    v_amount := NULLIF(p_payload->>'amount','')::NUMERIC;
    v_margin := COALESCE(NULLIF(p_payload->>'margin_amount','')::NUMERIC, 0);
    v_commission := COALESCE(NULLIF(p_payload->>'commission','')::NUMERIC, 0);
    v_vat_amount := COALESCE(NULLIF(p_payload->>'vat_amount','')::NUMERIC, 0);
    v_bank_safe_id := NULLIF(p_payload->>'bank_safe_id','')::UUID;
    v_tender := NULLIF(p_payload->>'tender_id','')::UUID;
    v_project := NULLIF(p_payload->>'project_id','')::UUID;
    v_contact := NULLIF(p_payload->>'contact_id','')::UUID;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'بيانات الضمان غير صالحة';
  END;

  IF v_type NOT IN ('bid_bond','performance_bond','advance_payment','retention','warranty','insurance','other') THEN
    RAISE EXCEPTION 'نوع الضمان غير صالح';
  END IF;
  IF v_amount IS NULL OR v_amount <= 0 OR v_amount <> ROUND(v_amount, 2) THEN RAISE EXCEPTION 'المبلغ غير صالح'; END IF;
  IF v_margin < 0 OR v_margin <> ROUND(v_margin, 2) OR v_margin > v_amount THEN
    RAISE EXCEPTION 'الغطاء النقدي غير صالح';
  END IF;
  IF v_commission < 0 OR v_commission <> ROUND(v_commission, 2) THEN RAISE EXCEPTION 'العمولة غير صالحة'; END IF;
  IF v_vat_amount < 0 OR v_vat_amount <> ROUND(v_vat_amount, 2) THEN RAISE EXCEPTION 'مبلغ الضريبة غير صالح'; END IF;
  IF (p_payload->>'issue_date')::DATE > (p_payload->>'expiry_date')::DATE THEN
    RAISE EXCEPTION 'تاريخ انتهاء الضمان يسبق تاريخ الإصدار';
  END IF;
  IF v_tender IS NOT NULL AND NOT EXISTS(SELECT 1 FROM tenders WHERE id=v_tender AND company_id=p_company_id) THEN
    RAISE EXCEPTION 'المناقصة غير موجودة';
  END IF;
  IF v_project IS NOT NULL AND NOT EXISTS(SELECT 1 FROM projects WHERE id=v_project AND company_id=p_company_id) THEN
    RAISE EXCEPTION 'المشروع غير موجود';
  END IF;
  IF v_contact IS NOT NULL AND NOT EXISTS(SELECT 1 FROM contacts WHERE id=v_contact AND company_id=p_company_id) THEN
    RAISE EXCEPTION 'جهة الاتصال غير موجودة';
  END IF;

  IF v_type = 'bid_bond' THEN
    SELECT id INTO v_margin_acc FROM accounts WHERE company_id=p_company_id AND code='1185' AND is_active=true AND NOT COALESCE(is_header, false) LIMIT 1;
  ELSE
    SELECT id INTO v_margin_acc FROM accounts WHERE company_id=p_company_id AND code='1186' AND is_active=true AND NOT COALESCE(is_header, false) LIMIT 1;
  END IF;

  IF v_bank_safe_id IS NULL THEN RAISE EXCEPTION 'يجب تحديد البنك'; END IF;
  SELECT * INTO v_bank_safe FROM banks_safes WHERE id=v_bank_safe_id AND company_id=p_company_id AND is_active=true LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'البنك غير موجود'; END IF;
  v_bank_acc := v_bank_safe.account_id;
  IF v_bank_acc IS NULL THEN RAISE EXCEPTION 'البنك غير مرتبط بحساب محاسبي'; END IF;

  v_cash_out := v_margin + v_commission + v_vat_amount;

  IF v_margin > 0 AND v_margin_acc IS NULL THEN RAISE EXCEPTION 'حساب خطابات الضمان غير موجود'; END IF;
  IF v_commission > 0 THEN
    SELECT id INTO v_comm_acc FROM accounts WHERE company_id=p_company_id AND code='5291' AND is_active=true AND NOT COALESCE(is_header, false) LIMIT 1;
    IF v_comm_acc IS NULL THEN RAISE EXCEPTION 'حساب عمولات الضمانات غير موجود'; END IF;
  END IF;
  IF v_vat_amount > 0 THEN
    SELECT id INTO v_vat_acc FROM accounts WHERE company_id=p_company_id AND code='1180' AND is_active=true AND NOT COALESCE(is_header, false) LIMIT 1;
    IF v_vat_acc IS NULL THEN RAISE EXCEPTION 'حساب ضريبة القيمة المضافة المدخلة غير موجود'; END IF;
  END IF;

  PERFORM set_config('app.relationship_write_company', p_company_id::TEXT, TRUE);

  INSERT INTO bonds (
    company_id, title, type, amount, currency, issue_date, expiry_date,
    issuing_bank, bank_safe_id, beneficiary_name, project_id, tender_id,
    contact_id, reference_number, status, notes, created_by,
    margin_account_id, commission_account_id, margin_amount, commission_amount
  ) VALUES (
    p_company_id,
    BTRIM(p_payload->>'title'),
    v_type,
    v_amount,
    COALESCE(NULLIF(p_payload->>'currency',''), 'SAR'),
    (p_payload->>'issue_date')::DATE,
    (p_payload->>'expiry_date')::DATE,
    NULLIF(BTRIM(p_payload->>'issuing_bank'),''),
    v_bank_safe_id,
    NULLIF(BTRIM(p_payload->>'beneficiary_name'),''),
    v_project,
    v_tender,
    v_contact,
    NULLIF(BTRIM(p_payload->>'reference_number'),''),
    'active',
    NULLIF(BTRIM(p_payload->>'notes'),''),
    p_user_id,
    v_margin_acc,
    v_comm_acc,
    v_margin,
    v_commission
  )
  RETURNING id INTO v_bond_id;

  IF v_cash_out > 0 THEN
    IF v_margin > 0 THEN
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'accountId', v_margin_acc, 'debit', v_margin, 'credit', 0,
        'description', 'غطاء نقدي لخطاب ضمان'));
    END IF;
    IF v_commission > 0 THEN
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'accountId', v_comm_acc, 'debit', v_commission, 'credit', 0,
        'description', 'عمولة إصدار خطاب ضمان'));
    END IF;
    IF v_vat_amount > 0 THEN
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'accountId', v_vat_acc, 'debit', v_vat_amount, 'credit', 0,
        'description', 'ضريبة القيمة المضافة'));
    END IF;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'accountId', v_bank_acc, 'debit', 0, 'credit', v_cash_out,
      'description', 'سداد غطاء/عمولة خطاب ضمان', 'bankSafeId', v_bank_safe_id));

    v_je := create_journal_entry(
      p_company_id, (p_payload->>'issue_date')::DATE, 'general',
      'إصدار خطاب ضمان: ' || (p_payload->>'title'),
      p_user_id, v_lines
    );

    UPDATE bonds SET journal_entry_id=(v_je->>'id')::UUID WHERE id=v_bond_id AND company_id=p_company_id;
  END IF;

  INSERT INTO audit_log(company_id, user_id, action, entity_type, entity_id, new_values)
  VALUES(p_company_id, p_user_id, 'create', 'bond', v_bond_id,
    jsonb_build_object('amount', v_amount, 'margin_amount', v_margin, 'type', v_type, 'journal_entry_id', v_je->>'id'));

  RETURN jsonb_build_object('bond_id', v_bond_id, 'journal_entry', v_je);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_bond_atomic(
  p_company_id UUID,
  p_bond_id UUID,
  p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_bond bonds%ROWTYPE;
  v_bank_acc UUID;
  v_margin_acc UUID;
  v_margin NUMERIC;
  v_lines JSONB;
  v_je JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=true) THEN
    RAISE EXCEPTION 'المستخدم غير صالح';
  END IF;

  SELECT * INTO v_bond FROM bonds WHERE id=p_bond_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الضمان غير موجود'; END IF;
  IF v_bond.status IN ('released', 'cancelled') THEN
    RETURN jsonb_build_object('bond_id', p_bond_id, 'already_processed', true);
  END IF;

  v_margin := COALESCE(v_bond.margin_amount, 0);
  v_margin_acc := v_bond.margin_account_id;

  IF v_margin > 0 THEN
    SELECT account_id INTO v_bank_acc FROM banks_safes WHERE id=v_bond.bank_safe_id AND company_id=p_company_id LIMIT 1;
    IF v_bank_acc IS NULL THEN RAISE EXCEPTION 'البنك غير مرتبط بحساب'; END IF;
    IF v_margin_acc IS NULL THEN RAISE EXCEPTION 'حساب غطاء الضمان غير مرتبط'; END IF;

    v_lines := jsonb_build_array(
      jsonb_build_object('accountId', v_bank_acc, 'debit', v_margin, 'credit', 0,
        'description', 'استرداد غطاء خطاب ضمان', 'bankSafeId', v_bond.bank_safe_id),
      jsonb_build_object('accountId', v_margin_acc, 'debit', 0, 'credit', v_margin,
        'description', 'إلغاء غطاء خطاب ضمان')
    );

    v_je := create_journal_entry(
      p_company_id, CURRENT_DATE, 'general',
      'إلغاء/استرداد خطاب ضمان: ' || v_bond.title,
      p_user_id, v_lines
    );
  END IF;

  PERFORM set_config('app.relationship_write_company', p_company_id::TEXT, TRUE);
  UPDATE bonds SET status='released', released_at=NOW(),
    release_journal_entry_id=COALESCE((v_je->>'id')::UUID, release_journal_entry_id),
    updated_at=NOW()
  WHERE id=p_bond_id AND company_id=p_company_id;

  INSERT INTO audit_log(company_id, user_id, action, entity_type, entity_id, new_values)
  VALUES(p_company_id, p_user_id, 'release', 'bond', p_bond_id,
    jsonb_build_object('journal_entry_id', v_je->>'id', 'margin_returned', v_margin));

  RETURN jsonb_build_object('bond_id', p_bond_id, 'journal_entry', v_je);
END;
$$;

-- Guard tender_expenses the same way as other relationship tables
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_guard_relationship_writes' AND tgrelid = 'tender_expenses'::regclass
  ) THEN
    CREATE TRIGGER trg_guard_relationship_writes
      BEFORE INSERT OR UPDATE OR DELETE ON tender_expenses
      FOR EACH ROW EXECUTE FUNCTION guard_relationship_writes();
  END IF;
EXCEPTION WHEN undefined_table OR undefined_function THEN
  RAISE NOTICE 'tender_expenses guard skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  PERFORM 1;
  REVOKE ALL ON FUNCTION public.ensure_tender_cost_center(UUID, UUID) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.ensure_tender_cost_center(UUID, UUID) TO service_role;

  REVOKE ALL ON FUNCTION public.record_tender_expense_atomic(UUID,UUID,TEXT,NUMERIC,NUMERIC,UUID,TEXT,DATE,UUID) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.record_tender_expense_atomic(UUID,UUID,TEXT,NUMERIC,NUMERIC,UUID,TEXT,DATE,UUID) TO service_role;

  REVOKE ALL ON FUNCTION public.close_lost_tender_atomic(UUID,UUID,UUID) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.close_lost_tender_atomic(UUID,UUID,UUID) TO service_role;

  REVOKE ALL ON FUNCTION public.convert_won_tender_with_accounting_atomic(UUID,UUID,UUID) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.convert_won_tender_with_accounting_atomic(UUID,UUID,UUID) TO service_role;

  REVOKE ALL ON FUNCTION public.record_bond_issue_atomic(UUID,JSONB,UUID) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.record_bond_issue_atomic(UUID,JSONB,UUID) TO service_role;

  REVOKE ALL ON FUNCTION public.release_bond_atomic(UUID,UUID,UUID) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.release_bond_atomic(UUID,UUID,UUID) TO service_role;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'privilege grant: %', SQLERRM;
END $$;

SELECT 'Migration 101 completed — tender/bond accounting fixes' as result;
 FUNCTION public.release_bond_atomic(UUID,UUID,UUID) TO service_role;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'privilege grant: %', SQLERRM;
END $$;

SELECT 'Migration 101 completed — tender/bond accounting fixes' as result;
