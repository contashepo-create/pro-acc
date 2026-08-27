-- 103: Tender/bond lifecycle integrity
--
-- 1. Persist convert_journal_id so a retry cannot re-post 5410→5195
-- 2. Cancelled tenders close 5410→5420 the same way as lost
-- 3. Draft delete is blocked when posted tender_expenses exist
-- 4. Bond cancel reverses cash cover (1185/1186) like release
-- 5. Single margin path: bond issue XOR tender expense bid_bond_margin

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

  IF p_expense_type NOT IN ('karasa','platform_fee','bid_bond_commission','consulting','other') THEN
    RAISE EXCEPTION 'نوع المصروف غير صالح';
  END IF;
  IF p_expense_type = 'bid_bond_margin' THEN
    RAISE EXCEPTION 'غطاء خطاب الضمان يُرحَّل عند إصدار الضمان وليس كمصروف مناقصة';
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
  IF v_tender.status NOT IN ('lost','cancelled') THEN RAISE EXCEPTION 'المناقصة ليست خاسرة أو ملغاة'; END IF;

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
        'description', CASE WHEN v_tender.status='cancelled' THEN 'إقفال مصاريف مناقصة ملغاة' ELSE 'إقفال مصاريف مناقصة خاسرة' END, 'costCenterId', v_cc_id),
      jsonb_build_object('accountId', v_suspense_acc, 'debit', 0, 'credit', v_suspense_balance,
        'description', CASE WHEN v_tender.status='cancelled' THEN 'إقفال مصاريف مناقصة ملغاة' ELSE 'إقفال مصاريف مناقصة خاسرة' END, 'costCenterId', v_cc_id)
    );

    v_je := create_journal_entry(
      p_company_id, CURRENT_DATE, 'closing',
      (CASE WHEN v_tender.status='cancelled' THEN 'إقفال مصاريف مناقصة ملغاة: ' ELSE 'إقفال مصاريف مناقصة خاسرة: ' END) || v_tender.title,
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
    PERFORM set_config('app.relationship_write_company', p_company_id::TEXT, TRUE);
    UPDATE tenders SET convert_journal_id=(v_je->>'id')::UUID, updated_at=NOW()
    WHERE id=p_tender_id AND company_id=p_company_id;
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
  IF v_type = 'bid_bond' AND v_margin > 0 AND v_tender IS NOT NULL AND EXISTS(
    SELECT 1 FROM tender_expenses
    WHERE tender_id=v_tender AND company_id=p_company_id AND expense_type='bid_bond_margin'
  ) THEN
    RAISE EXCEPTION 'غطاء خطاب الضمان مسجّل مسبقاً كمصروف مناقصة — لا يمكن ترحيله مرتين';
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

  RETURN jsonb_build_object('bond_id', p_bond_id, 'journal_entry', v_je, 'already_processed', FALSE, 'status', 'released');
END;
$$;


CREATE OR REPLACE FUNCTION public.cancel_bond_atomic(
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
    RETURN jsonb_build_object('bond_id', p_bond_id, 'already_processed', true, 'status', v_bond.status);
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
      'إلغاء خطاب ضمان: ' || v_bond.title,
      p_user_id, v_lines
    );
  END IF;

  PERFORM set_config('app.relationship_write_company', p_company_id::TEXT, TRUE);
  UPDATE bonds SET status='cancelled',
    release_journal_entry_id=COALESCE((v_je->>'id')::UUID, release_journal_entry_id),
    updated_at=NOW()
  WHERE id=p_bond_id AND company_id=p_company_id;

  INSERT INTO audit_log(company_id, user_id, action, entity_type, entity_id, new_values)
  VALUES(p_company_id, p_user_id, 'cancel', 'bond', p_bond_id,
    jsonb_build_object('journal_entry_id', v_je->>'id', 'margin_returned', v_margin));

  RETURN jsonb_build_object('bond_id', p_bond_id, 'journal_entry', v_je, 'already_processed', FALSE, 'status', 'cancelled');
END;
$$;


CREATE OR REPLACE FUNCTION public.delete_draft_tender_atomic(p_company_id UUID,p_tender_id UUID,p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_tender tenders%ROWTYPE;
BEGIN
  PERFORM assert_relationship_actor(p_company_id,p_user_id);
  SELECT * INTO v_tender FROM tenders WHERE id=p_tender_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المناقصة غير موجودة'; END IF;
  IF v_tender.status<>'draft' OR v_tender.project_id IS NOT NULL THEN RAISE EXCEPTION 'لا يمكن حذف مناقصة دخلت دورة العمل'; END IF;
  IF EXISTS(SELECT 1 FROM bonds WHERE tender_id=p_tender_id AND company_id=p_company_id) THEN RAISE EXCEPTION 'لا يمكن حذف مناقصة مرتبطة بضمان'; END IF;
  IF EXISTS(SELECT 1 FROM tender_expenses WHERE tender_id=p_tender_id AND company_id=p_company_id) THEN
    RAISE EXCEPTION 'لا يمكن حذف مناقصة عليها مصاريف مُرحَّلة';
  END IF;
  PERFORM set_config('app.relationship_write_company',p_company_id::TEXT,TRUE);
  DELETE FROM tenders WHERE id=p_tender_id;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values)
  VALUES(p_company_id,p_user_id,'delete','tender',p_tender_id,to_jsonb(v_tender));
  RETURN jsonb_build_object('id',p_tender_id,'deleted',TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_bond_atomic(p_company_id UUID,p_bond_id UUID,p_action TEXT,p_notes TEXT,p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM assert_relationship_actor(p_company_id,p_user_id);
  IF p_action NOT IN('release','cancel') OR LENGTH(COALESCE(p_notes,''))>2000 THEN RAISE EXCEPTION 'عملية الضمان غير صالحة'; END IF;
  IF p_action='release' THEN
    RETURN release_bond_atomic(p_company_id,p_bond_id,p_user_id);
  END IF;
  RETURN cancel_bond_atomic(p_company_id,p_bond_id,p_user_id);
END;
$$;

DO $$
BEGIN
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
  REVOKE ALL ON FUNCTION public.cancel_bond_atomic(UUID,UUID,UUID) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.cancel_bond_atomic(UUID,UUID,UUID) TO service_role;
  REVOKE ALL ON FUNCTION public.delete_draft_tender_atomic(UUID,UUID,UUID) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.delete_draft_tender_atomic(UUID,UUID,UUID) TO service_role;
  REVOKE ALL ON FUNCTION public.transition_bond_atomic(UUID,UUID,TEXT,TEXT,UUID) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.transition_bond_atomic(UUID,UUID,TEXT,TEXT,UUID) TO service_role;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'privilege grant: %', SQLERRM;
END $$;

SELECT 'Migration 103 completed — tender/bond lifecycle integrity' as result;
