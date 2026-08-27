-- 100: Tender & Bond Accounting RPCs
--
-- Implements the Saudi/IFRS accounting cycle for tenders and bonds:
--   1. record_tender_expense_atomic  — record cost (karasa, fees) + journal entry
--   2. close_lost_tender_atomic      — close suspense → lost expense + release bond margin
--   3. convert_won_tender_with_accounting_atomic — convert to project + transfer costs
--   4. record_bond_issue_atomic      — record bond + margin + commission journal
--   5. release_bond_atomic            — release bond + return margin
--
-- All functions are SECURITY DEFINER, service_role only, tenant-isolated.

-- ============================================================================
-- Helper: resolve or auto-create a cost center for a tender
-- ============================================================================
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
    UPDATE tenders SET cost_center_id=v_cc_id WHERE id=p_tender_id AND company_id=p_company_id;
  END IF;

  RETURN v_cc_id;
END;
$$;

-- ============================================================================
-- 1. record_tender_expense_atomic
--    Records a tender expense and creates a balanced journal entry:
--      Dr  5410  مصاريف مناقصات تحت التسوية  (amount)
--      Dr  1180  ضريبة القيمة المضافة المدخلة  (vat_amount)
--      Cr  Bank/Safe                                (amount + vat_amount)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.record_tender_expense_atomic(
  p_company_id UUID,
  p_tender_id UUID,
  p_expense_type TEXT,
  p_amount NUMERIC(15,2),
  p_vat_amount NUMERIC(15,2) DEFAULT 0,
  p_bank_safe_id UUID DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_date DATE DEFAULT NULL,
  p_user_id UUID = NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_tender tenders%ROWTYPE;
  v_cc_id UUID;
  v_suspense_acc UUID;
  v_vat_acc UUID;
  v_bank_acc UUID;
  v_bank_safe RECORD;
  v_je JSONB;
  v_lines JSONB;
  v_expense_id UUID;
  v_date DATE;
  v_total NUMERIC;
BEGIN
  -- Validate tenant + user
  IF NOT EXISTS (SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=true) THEN
    RAISE EXCEPTION 'المستخدم غير صالح';
  END IF;

  SELECT * INTO v_tender FROM tenders WHERE id=p_tender_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المناقصة غير موجودة'; END IF;

  -- Validate amount
  IF p_amount <= 0 OR p_amount <> ROUND(p_amount, 2) THEN
    RAISE EXCEPTION 'المبلغ غير صالح';
  END IF;
  IF p_vat_amount < 0 OR p_vat_amount <> ROUND(p_vat_amount, 2) THEN
    RAISE EXCEPTION 'مبلغ الضريبة غير صالح';
  END IF;

  -- Resolve suspense account (5410)
  SELECT id INTO v_suspense_acc FROM accounts
  WHERE company_id=p_company_id AND code='5410' AND is_active=true LIMIT 1;
  IF v_suspense_acc IS NULL THEN
    RAISE EXCEPTION 'حساب مصاريف المناقصات تحت التسوية غير موجود. اطلب من المدير تحديث شجرة الحسابات';
  END IF;

  -- Resolve VAT input account (1180)
  SELECT id INTO v_vat_acc FROM accounts
  WHERE company_id=p_company_id AND code='1180' AND is_active=true LIMIT 1;

  -- Resolve bank account from bank_safe_id
  IF p_bank_safe_id IS NULL THEN
    RAISE EXCEPTION 'يجب تحديد البنك أو الخزينة';
  END IF;
  SELECT * INTO v_bank_safe FROM banks_safes WHERE id=p_bank_safe_id AND company_id=p_company_id AND is_active=true LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'البنك أو الخزينة غير موجودة'; END IF;

  v_bank_acc := v_bank_safe.account_id;
  IF v_bank_acc IS NULL THEN
    RAISE EXCEPTION 'البنك/الخزينة غير مرتبط بحساب محاسبي';
  END IF;

  -- Ensure cost center
  v_cc_id := ensure_tender_cost_center(p_company_id, p_tender_id);

  v_date := COALESCE(p_date, CURRENT_DATE);
  v_total := p_amount + p_vat_amount;

  -- Build journal lines
  v_lines := jsonb_build_array(
    jsonb_build_object('accountId', v_suspense_acc, 'debit', p_amount, 'credit', 0,
      'description', COALESCE(p_description, 'مصاريف مناقصة'), 'costCenterId', v_cc_id),
    CASE WHEN p_vat_amount > 0 AND v_vat_acc IS NOT NULL THEN
      jsonb_build_object('accountId', v_vat_acc, 'debit', p_vat_amount, 'credit', 0,
        'description', 'ضريبة القيمة المضافة', 'costCenterId', v_cc_id)
    END,
    jsonb_build_object('accountId', v_bank_acc, 'debit', 0, 'credit', v_total,
      'description', COALESCE(p_description, 'سداد مصاريف مناقصة'), 'bankSafeId', p_bank_safe_id)
  );

  -- Remove null elements (when VAT is 0 the CASE returns NULL)
  v_lines := (SELECT jsonb_agg(elem) FROM jsonb_array_elements(v_lines) AS elem WHERE elem IS NOT NULL AND elem::text <> 'null');

  -- Create journal entry
  v_je := create_journal_entry(
    p_company_id, v_date, 'general',
    COALESCE(p_description, 'مصاريف مناقصة: ' || v_tender.title),
    p_user_id, v_lines
  );

  -- Insert tender_expenses row
  INSERT INTO tender_expenses (
    company_id, tender_id, expense_type, amount, vat_amount,
    bank_safe_id, journal_entry_id, cost_center_id, description, date, created_by
  ) VALUES (
    p_company_id, p_tender_id, p_expense_type, p_amount, p_vat_amount,
    p_bank_safe_id, (v_je->>'id')::UUID, v_cc_id, p_description, v_date, p_user_id
  )
  RETURNING id INTO v_expense_id;

  -- Link cost center to tender if not already linked
  IF v_tender.cost_center_id IS NULL AND v_cc_id IS NOT NULL THEN
    UPDATE tenders SET cost_center_id=v_cc_id WHERE id=p_tender_id AND company_id=p_company_id;
  END IF;

  -- Audit
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

-- ============================================================================
-- 2. close_lost_tender_atomic
--    Called when tender status transitions to 'lost':
--      a) Transfer suspense → lost tender expense (5420)
--      b) Release bid bond margins back to bank
-- ============================================================================
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
  v_bank_acc UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=true) THEN
    RAISE EXCEPTION 'المستخدم غير صالح';
  END IF;

  SELECT * INTO v_tender FROM tenders WHERE id=p_tender_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المناقصة غير موجودة'; END IF;
  IF v_tender.status <> 'lost' THEN RAISE EXCEPTION 'المناقصة ليست خاسرة'; END IF;

  v_cc_id := v_tender.cost_center_id;
  IF v_cc_id IS NULL THEN v_cc_id := ensure_tender_cost_center(p_company_id, p_tender_id); END IF;

  -- Resolve accounts
  SELECT id INTO v_suspense_acc FROM accounts WHERE company_id=p_company_id AND code='5410' LIMIT 1;
  SELECT id INTO v_lost_acc FROM accounts WHERE company_id=p_company_id AND code='5420' LIMIT 1;

  -- Calculate suspense balance from journal lines linked to tender_expenses
  SELECT COALESCE(SUM(jl.debit - jl.credit), 0) INTO v_suspense_balance
  FROM journal_lines jl
  JOIN journal_entries je ON je.id=jl.journal_entry_id
  JOIN tender_expenses te ON te.journal_entry_id=je.id
  WHERE te.tender_id=p_tender_id AND te.company_id=p_company_id
    AND jl.account_id=v_suspense_acc AND je.deleted_at IS NULL;

  -- a) Transfer suspense → lost expense
  IF v_suspense_balance > 0 AND v_lost_acc IS NOT NULL THEN
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
  END IF;

  -- b) Release bid bond margins
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

-- ============================================================================
-- 3. convert_won_tender_with_accounting_atomic
--    Converts a won tender to a project AND transfers suspense → project costs
--    AND promotes bid bond → performance bond
-- ============================================================================
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
  v_direct_cost_acc UUID;
  v_suspense_balance NUMERIC := 0;
  v_lines JSONB;
  v_je JSONB;
  v_bond RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=true) THEN
    RAISE EXCEPTION 'المستخدم غير صالح';
  END IF;

  SELECT * INTO v_tender FROM tenders WHERE id=p_tender_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المناقصة غير موجودة'; END IF;
  IF v_tender.status <> 'won' THEN RAISE EXCEPTION 'يمكن تحويل العطاءات الرابحة فقط'; END IF;
  IF v_tender.project_id IS NOT NULL THEN
    RETURN jsonb_build_object('project_id', v_tender.project_id, 'already_processed', true);
  END IF;

  -- Step 1: Call the original conversion logic (creates project, links tender)
  v_result := convert_won_tender_to_project_atomic(p_company_id, p_tender_id, p_user_id);
  v_project_id := (v_result->>'project'->>'id')::UUID;
  IF v_project_id IS NULL THEN
    v_project_id := (v_result->'project'->>'id')::UUID;
  END IF;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'فشل إنشاء المشروع';
  END IF;

  -- Step 2: Transfer suspense → project direct costs (5100 parent or specific)
  v_cc_id := v_tender.cost_center_id;
  IF v_cc_id IS NULL THEN v_cc_id := ensure_tender_cost_center(p_company_id, p_tender_id); END IF;

  -- Link cost center to project
  UPDATE projects SET cost_center_id=v_cc_id WHERE id=v_project_id AND company_id=p_company_id;

  SELECT id INTO v_suspense_acc FROM accounts WHERE company_id=p_company_id AND code='5410' LIMIT 1;

  -- Calculate suspense balance
  SELECT COALESCE(SUM(jl.debit - jl.credit), 0) INTO v_suspense_balance
  FROM journal_lines jl
  JOIN journal_entries je ON je.id=jl.journal_entry_id
  JOIN tender_expenses te ON te.journal_entry_id=je.id
  WHERE te.tender_id=p_tender_id AND te.company_id=p_company_id
    AND jl.account_id=v_suspense_acc AND je.deleted_at IS NULL;

  IF v_suspense_balance > 0 THEN
    -- Find a direct cost account (use 5110 مواد خام as default, or 5100 header)
    SELECT id INTO v_direct_cost_acc FROM accounts
    WHERE company_id=p_company_id AND code='5110' AND is_active=true AND NOT COALESCE(is_header, false)
    LIMIT 1;

    IF v_direct_cost_acc IS NOT NULL THEN
      v_lines := jsonb_build_array(
        jsonb_build_object('accountId', v_direct_cost_acc, 'debit', v_suspense_balance, 'credit', 0,
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
  END IF;

  -- Step 3: Promote bid bonds → performance bonds (update type, keep margin)
  FOR v_bond IN
    SELECT * FROM bonds
    WHERE tender_id=p_tender_id AND company_id=p_company_id
      AND type='bid_bond' AND status='active'
  LOOP
    UPDATE bonds SET type='performance_bond', updated_at=NOW()
    WHERE id=v_bond.id AND company_id=p_company_id;
  END LOOP;

  INSERT INTO audit_log(company_id, user_id, action, entity_type, entity_id, new_values)
  VALUES(p_company_id, p_user_id, 'convert_with_accounting', 'tender', p_tender_id,
    jsonb_build_object('project_id', v_project_id, 'costs_transferred', v_suspense_balance));

  RETURN jsonb_build_object(
    'project_id', v_project_id,
    'tender_id', p_tender_id,
    'costs_transferred', v_suspense_balance,
    'already_processed', false
  );
END;
$$;

-- ============================================================================
-- 4. record_bond_issue_atomic
--    Records bond issuance with full accounting:
--      Dr  1185/1186  margin (cash held by bank)
--      Dr  5291       commission (bank fee)
--      Dr  1180       VAT input (on commission)
--      Cr  Bank       (total cash out)
-- ============================================================================
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
  v_lines JSONB;
  v_je JSONB;
  v_type TEXT;
  v_amount NUMERIC;
  v_commission NUMERIC := 0;
  v_vat_amount NUMERIC := 0;
  v_bank_safe_id UUID;
  v_total NUMERIC;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=true) THEN
    RAISE EXCEPTION 'المستخدم غير صالح';
  END IF;

  v_type := p_payload->>'type';
  v_amount := NULLIF(p_payload->>'amount','')::NUMERIC;
  v_commission := COALESCE(NULLIF(p_payload->>'commission','')::NUMERIC, 0);
  v_vat_amount := COALESCE(NULLIF(p_payload->>'vat_amount','')::NUMERIC, 0);
  v_bank_safe_id := NULLIF(p_payload->>'bank_safe_id','')::UUID;

  IF v_type NOT IN ('bid_bond','performance_bond','advance_payment','retention','warranty','insurance','other') THEN
    RAISE EXCEPTION 'نوع الضمان غير صالح';
  END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'المبلغ غير صالح'; END IF;

  -- Resolve accounts
  IF v_type = 'bid_bond' THEN
    SELECT id INTO v_margin_acc FROM accounts WHERE company_id=p_company_id AND code='1185' LIMIT 1;
  ELSE
    SELECT id INTO v_margin_acc FROM accounts WHERE company_id=p_company_id AND code='1186' LIMIT 1;
  END IF;
  IF v_margin_acc IS NULL THEN RAISE EXCEPTION 'حساب خطابات الضمان غير موجود'; END IF;

  SELECT id INTO v_comm_acc FROM accounts WHERE company_id=p_company_id AND code='5291' LIMIT 1;
  SELECT id INTO v_vat_acc FROM accounts WHERE company_id=p_company_id AND code='1180' LIMIT 1;

  -- Resolve bank
  IF v_bank_safe_id IS NULL THEN RAISE EXCEPTION 'يجب تحديد البنك'; END IF;
  SELECT * INTO v_bank_safe FROM banks_safes WHERE id=v_bank_safe_id AND company_id=p_company_id AND is_active=true LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'البنك غير موجود'; END IF;
  v_bank_acc := v_bank_safe.account_id;
  IF v_bank_acc IS NULL THEN RAISE EXCEPTION 'البنك غير مرتبط بحساب محاسبي'; END IF;

  v_total := v_amount + v_commission + v_vat_amount;

  -- Insert bond record
  INSERT INTO bonds (
    company_id, title, type, amount, currency, issue_date, expiry_date,
    issuing_bank, bank_safe_id, beneficiary_name, project_id, tender_id,
    contact_id, reference_number, status, notes, created_by,
    margin_account_id, commission_account_id
  ) VALUES (
    p_company_id,
    p_payload->>'title',
    v_type,
    v_amount,
    COALESCE(p_payload->>'currency', 'SAR'),
    (p_payload->>'issue_date')::DATE,
    (p_payload->>'expiry_date')::DATE,
    p_payload->>'issuing_bank',
    v_bank_safe_id,
    p_payload->>'beneficiary_name',
    NULLIF(p_payload->>'project_id','')::UUID,
    NULLIF(p_payload->>'tender_id','')::UUID,
    NULLIF(p_payload->>'contact_id','')::UUID,
    p_payload->>'reference_number',
    'active',
    p_payload->>'notes',
    p_user_id,
    v_margin_acc,
    v_comm_acc
  )
  RETURNING id INTO v_bond_id;

  -- Build journal lines
  v_lines := jsonb_build_array(
    jsonb_build_object('accountId', v_margin_acc, 'debit', v_amount, 'credit', 0,
      'description', 'غطاء خطاب ضمان'),
    CASE WHEN v_commission > 0 AND v_comm_acc IS NOT NULL THEN
      jsonb_build_object('accountId', v_comm_acc, 'debit', v_commission, 'credit', 0,
        'description', 'عمولة إصدار خطاب ضمان')
    END,
    CASE WHEN v_vat_amount > 0 AND v_vat_acc IS NOT NULL THEN
      jsonb_build_object('accountId', v_vat_acc, 'debit', v_vat_amount, 'credit', 0,
        'description', 'ضريبة القيمة المضافة')
    END,
    jsonb_build_object('accountId', v_bank_acc, 'debit', 0, 'credit', v_total,
      'description', 'سداد غطاء وعمولة خطاب ضمان', 'bankSafeId', v_bank_safe_id)
  );
  v_lines := (SELECT jsonb_agg(elem) FROM jsonb_array_elements(v_lines) AS elem WHERE elem IS NOT NULL AND elem::text <> 'null');

  v_je := create_journal_entry(
    p_company_id, (p_payload->>'issue_date')::DATE, 'general',
    'إصدار خطاب ضمان: ' || (p_payload->>'title'),
    p_user_id, v_lines
  );

  -- Link journal entry to bond
  UPDATE bonds SET journal_entry_id=(v_je->>'id')::UUID WHERE id=v_bond_id AND company_id=p_company_id;

  INSERT INTO audit_log(company_id, user_id, action, entity_type, entity_id, new_values)
  VALUES(p_company_id, p_user_id, 'create', 'bond', v_bond_id,
    jsonb_build_object('amount', v_amount, 'type', v_type, 'journal_entry_id', v_je->>'id'));

  RETURN jsonb_build_object('bond_id', v_bond_id, 'journal_entry', v_je);
END;
$$;

-- ============================================================================
-- 5. release_bond_atomic
--    Releases a bond and returns the margin to the bank:
--      Dr  Bank       (margin returned)
--      Cr  1185/1186  margin (reverse)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.release_bond_atomic(
  p_company_id UUID,
  p_bond_id UUID,
  p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_bond bonds%ROWTYPE;
  v_bank_acc UUID;
  v_lines JSONB;
  v_je JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=true) THEN
    RAISE EXCEPTION 'المستخدم غير صالح';
  END IF;

  SELECT * INTO v_bond FROM bonds WHERE id=p_bond_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الضمان غير موجود'; END IF;
  IF v_bond.status = 'released' OR v_bond.status = 'cancelled' THEN
    RETURN jsonb_build_object('bond_id', p_bond_id, 'already_processed', true);
  END IF;

  -- Resolve bank account
  SELECT account_id INTO v_bank_acc FROM banks_safes WHERE id=v_bond.bank_safe_id AND company_id=p_company_id LIMIT 1;
  IF v_bank_acc IS NULL THEN RAISE EXCEPTION 'البنك غير مرتبط بحساب'; END IF;

  -- Create reversal journal entry
  v_lines := jsonb_build_array(
    jsonb_build_object('accountId', v_bank_acc, 'debit', v_bond.amount, 'credit', 0,
      'description', 'استرداد غطاء خطاب ضمان', 'bankSafeId', v_bond.bank_safe_id),
    jsonb_build_object('accountId', v_bond.margin_account_id, 'debit', 0, 'credit', v_bond.amount,
      'description', 'إلغاء غطاء خطاب ضمان')
  );

  v_je := create_journal_entry(
    p_company_id, CURRENT_DATE, 'general',
    'إلغاء/استرداد خطاب ضمان: ' || v_bond.title,
    p_user_id, v_lines
  );

  -- Update bond status
  UPDATE bonds SET status='released', released_at=NOW(), release_journal_entry_id=(v_je->>'id')::UUID, updated_at=NOW()
  WHERE id=p_bond_id AND company_id=p_company_id;

  INSERT INTO audit_log(company_id, user_id, action, entity_type, entity_id, new_values)
  VALUES(p_company_id, p_user_id, 'release', 'bond', p_bond_id,
    jsonb_build_object('journal_entry_id', v_je->>'id'));

  RETURN jsonb_build_object('bond_id', p_bond_id, 'journal_entry', v_je);
END;
$$;

-- ============================================================================
-- Privileges
-- ============================================================================
DO $$
BEGIN
  PERFORM 1;
  REVOKE ALL ON FUNCTION public.ensure_tender_cost_center(UUID, UUID) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.ensure_tender_cost_center(UUID, UUID) TO service_role;

  REVOKE ALL ON FUNCTION public.record_tender_expense_atomic(UUID,UUID,TEXT,NUMERIC(15,2),NUMERIC(15,2),UUID,TEXT,DATE,UUID) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.record_tender_expense_atomic(UUID,UUID,TEXT,NUMERIC(15,2),NUMERIC(15,2),UUID,TEXT,DATE,UUID) TO service_role;

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

SELECT 'Migration 100 completed — tender/bond accounting RPCs' as result;
