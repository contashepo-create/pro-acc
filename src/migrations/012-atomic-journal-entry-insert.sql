-- FIX: Atomic journal entry creation with balance validation
-- This function ensures that a journal entry and its lines are inserted atomically,
-- and validates the balance BEFORE committing. If unbalanced, the entire transaction
-- is rolled back automatically - no manual cleanup needed.

CREATE OR REPLACE FUNCTION create_journal_entry(
  p_company_id UUID,
  p_date DATE,
  p_type TEXT,
  p_description TEXT,
  p_created_by UUID,
  p_lines JSONB  -- Array of {accountId, accountCode, debit, credit, description, contactId, projectId}
)
RETURNS JSONB AS $$
DECLARE
  v_entry_id UUID;
  v_number INT;
  v_year INT;
  v_total_debit NUMERIC := 0;
  v_total_credit NUMERIC;
  v_line JSONB;
  v_result JSONB;
BEGIN
  v_year := EXTRACT(YEAR FROM p_date);

  -- Get next journal number atomically
  INSERT INTO journal_sequences(company_id, year, last_number)
  VALUES (p_company_id, v_year, 1)
  ON CONFLICT (company_id, year)
  DO UPDATE SET last_number = journal_sequences.last_number + 1
  RETURNING last_number INTO v_number;

  -- Validate balance BEFORE inserting anything
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_total_debit := v_total_debit + COALESCE((v_line->>'debit')::NUMERIC, 0);
    v_total_credit := v_total_credit + COALESCE((v_line->>'credit')::NUMERIC, 0);
  END LOOP;

  IF ABS(v_total_debit - v_total_credit) > 0.01 THEN
    RAISE EXCEPTION 'خطأ في الموازنة: مجموع الديون (%) لا يساوي مجموع الدائنين (%)', v_total_debit, v_total_credit;
  END IF;

  -- Balance is valid, proceed with insertion (all in one transaction)
  INSERT INTO journal_entries (company_id, number, date, type, description, created_by)
  VALUES (p_company_id, v_number, p_date, p_type, p_description, p_created_by)
  RETURNING id INTO v_entry_id;

  -- Insert all lines
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    INSERT INTO journal_lines (
      journal_entry_id, account_id, account_code,
      debit, credit, description, contact_id, project_id
    ) VALUES (
      v_entry_id,
      (v_line->>'accountId')::UUID,
      v_line->>'accountCode',
      COALESCE((v_line->>'debit')::NUMERIC, 0),
      COALESCE((v_line->>'credit')::NUMERIC, 0),
      v_line->>'description',
      (v_line->>'contactId')::UUID,
      (v_line->>'projectId')::UUID
    );
  END LOOP;

  -- Build result
  SELECT jsonb_build_object(
    'id', v_entry_id,
    'number', v_number,
    'total_debit', v_total_debit,
    'total_credit', v_total_credit,
    'lines_count', jsonb_array_length(p_lines)
  ) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Row Level Security (RLS) - Defense in Depth
-- NOTE: RLS is bypassed when using Supabase service_role key (which this app uses).
-- These serve as documentation and backup if auth is ever changed to anon/authenticated roles.
-- ============================================

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'accounts', 'journal_entries', 'journal_lines', 'invoices', 'invoice_items',
    'clients', 'contacts', 'cash_transactions', 'banks_safes', 'projects',
    'employees', 'inventory_items', 'inventory_transactions', 'quotations',
    'purchase_invoices', 'purchase_orders', 'voucher_receipts', 'voucher_disbursements',
    'custodies', 'fixed_assets', 'subcontractors', 'boq_items', 'salary_sheets',
    'daily_workers'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXCEPTION WHEN undefined_table THEN
      NULL;
    END;
  END LOOP;
END $$;
