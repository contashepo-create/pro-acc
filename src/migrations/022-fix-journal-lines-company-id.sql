-- FIX: journal_lines.company_id is NOT NULL, but create_journal_entry /
-- create_invoice_with_journal omitted it, so every atomic journal insert
-- failed with:
--   null value in column "company_id" of relation "journal_lines" violates not-null constraint
--
-- This migration:
--   1. Recreates both RPCs so they write company_id (and account_name).
--   2. Adds a BEFORE INSERT trigger that backfills company_id / account
--      metadata if any leftover application path still omits them.

CREATE OR REPLACE FUNCTION create_journal_entry(
  p_company_id UUID,
  p_date DATE,
  p_type TEXT,
  p_description TEXT,
  p_created_by UUID,
  p_lines JSONB
)
RETURNS JSONB AS $$
DECLARE
  v_entry_id UUID;
  v_number INT;
  v_year INT;
  v_total_debit NUMERIC := 0;
  v_total_credit NUMERIC := 0;
  v_line JSONB;
  v_result JSONB;
BEGIN
  v_year := EXTRACT(YEAR FROM p_date);

  INSERT INTO journal_sequences(company_id, year, last_number)
  VALUES (p_company_id, v_year, 1)
  ON CONFLICT (company_id, year)
  DO UPDATE SET last_number = journal_sequences.last_number + 1
  RETURNING last_number INTO v_number;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_total_debit := v_total_debit + COALESCE((v_line->>'debit')::NUMERIC, 0);
    v_total_credit := v_total_credit + COALESCE((v_line->>'credit')::NUMERIC, 0);
  END LOOP;

  IF ABS(v_total_debit - v_total_credit) > 0.01 THEN
    RAISE EXCEPTION 'خطأ في الموازنة: مجموع الديون (%) لا يساوي مجموع الدائنين (%)', v_total_debit, v_total_credit;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT l->>'accountCode' AS code,
             SUM(COALESCE((l->>'debit')::NUMERIC, 0))  AS d,
             SUM(COALESCE((l->>'credit')::NUMERIC, 0)) AS c
      FROM jsonb_array_elements(p_lines) AS l
      GROUP BY 1
    ) t
    WHERE t.d > 0 AND t.c > 0
  ) THEN
    RAISE EXCEPTION 'لا يجوز أن يكون نفس الحساب مديناً ودائناً في القيد الواحد';
  END IF;

  INSERT INTO journal_entries (company_id, number, date, type, description, created_by)
  VALUES (p_company_id, v_number, p_date, p_type, p_description, p_created_by)
  RETURNING id INTO v_entry_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    INSERT INTO journal_lines (
      company_id, journal_entry_id, account_id, account_code, account_name,
      debit, credit, description, contact_id, project_id
    ) VALUES (
      p_company_id,
      v_entry_id,
      (v_line->>'accountId')::UUID,
      COALESCE(
        NULLIF(v_line->>'accountCode', ''),
        (SELECT code FROM accounts WHERE id = (v_line->>'accountId')::UUID AND company_id = p_company_id)
      ),
      COALESCE(
        NULLIF(v_line->>'accountName', ''),
        (SELECT name FROM accounts WHERE id = (v_line->>'accountId')::UUID AND company_id = p_company_id)
      ),
      COALESCE((v_line->>'debit')::NUMERIC, 0),
      COALESCE((v_line->>'credit')::NUMERIC, 0),
      v_line->>'description',
      (v_line->>'contactId')::UUID,
      (v_line->>'projectId')::UUID
    );
  END LOOP;

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

CREATE OR REPLACE FUNCTION create_invoice_with_journal(
  p_company_id UUID,
  p_number INT,
  p_date DATE,
  p_due_date DATE,
  p_contact_id UUID,
  p_project_id UUID,
  p_subtotal NUMERIC,
  p_vat_rate NUMERIC,
  p_vat_amount NUMERIC,
  p_total NUMERIC,
  p_status TEXT,
  p_notes TEXT,
  p_created_by UUID,
  p_items JSONB,
  p_ar_account_id UUID,
  p_revenue_account_id UUID,
  p_vat_account_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_invoice_id UUID;
  v_journal_id UUID;
  v_item JSONB;
  v_result JSONB;
BEGIN
  INSERT INTO invoices (
    company_id, number, date, due_date, contact_id, project_id,
    subtotal, vat_rate, vat_amount, total, status, notes, created_by
  ) VALUES (
    p_company_id, p_number, p_date, p_due_date, p_contact_id, p_project_id,
    p_subtotal, p_vat_rate, p_vat_amount, p_total, p_status, p_notes, p_created_by
  ) RETURNING id INTO v_invoice_id;

  INSERT INTO journal_entries (
    company_id, number, date, type, description, reference, created_by
  ) VALUES (
    p_company_id, p_number, p_date, 'general',
    'فاتورة مبيعات رقم ' || p_number,
    'INV-' || p_number,
    p_created_by
  ) RETURNING id INTO v_journal_id;

  INSERT INTO journal_lines (company_id, journal_entry_id, account_id, account_code, account_name, debit, credit, description)
  VALUES (p_company_id, v_journal_id, p_ar_account_id, '1130',
          COALESCE((SELECT name FROM accounts WHERE id = p_ar_account_id AND company_id = p_company_id), 'ذمم العملاء'),
          p_total, 0, 'فاتورة مبيعات رقم ' || p_number);

  INSERT INTO journal_lines (company_id, journal_entry_id, account_id, account_code, account_name, debit, credit, description)
  VALUES (p_company_id, v_journal_id, p_revenue_account_id, '4100',
          COALESCE((SELECT name FROM accounts WHERE id = p_revenue_account_id AND company_id = p_company_id), 'إيرادات'),
          0, p_subtotal, 'إيراد فاتورة رقم ' || p_number);

  IF p_vat_amount > 0 AND p_vat_account_id IS NOT NULL THEN
    INSERT INTO journal_lines (company_id, journal_entry_id, account_id, account_code, account_name, debit, credit, description)
    VALUES (p_company_id, v_journal_id, p_vat_account_id, '2120',
            COALESCE((SELECT name FROM accounts WHERE id = p_vat_account_id AND company_id = p_company_id), 'ضريبة المبيعات'),
            0, p_vat_amount, 'ضريبة فاتورة رقم ' || p_number);
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, total)
    VALUES (
      v_invoice_id,
      v_item->>'description',
      COALESCE((v_item->>'quantity')::NUMERIC, 0),
      COALESCE((v_item->>'unitPrice')::NUMERIC, 0),
      COALESCE((v_item->>'total')::NUMERIC, 0)
    );
  END LOOP;

  UPDATE invoices SET journal_entry_id = v_journal_id WHERE id = v_invoice_id;

  SELECT jsonb_build_object(
    'id', v_invoice_id,
    'number', p_number,
    'journalEntryId', v_journal_id,
    'total', p_total
  ) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fill_journal_line_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.company_id IS NULL AND NEW.journal_entry_id IS NOT NULL THEN
    SELECT je.company_id INTO NEW.company_id
    FROM journal_entries je
    WHERE je.id = NEW.journal_entry_id;
  END IF;

  IF NEW.account_id IS NOT NULL AND (
       NEW.account_code IS NULL OR btrim(NEW.account_code) = ''
    OR NEW.account_name IS NULL OR btrim(NEW.account_name) = ''
  ) THEN
    SELECT
      COALESCE(NULLIF(btrim(NEW.account_code), ''), a.code),
      COALESCE(NULLIF(btrim(NEW.account_name), ''), a.name)
    INTO NEW.account_code, NEW.account_name
    FROM accounts a
    WHERE a.id = NEW.account_id
      AND (NEW.company_id IS NULL OR a.company_id = NEW.company_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fill_journal_line_defaults ON journal_lines;
CREATE TRIGGER trg_fill_journal_line_defaults
  BEFORE INSERT ON journal_lines
  FOR EACH ROW
  EXECUTE FUNCTION fill_journal_line_defaults();
