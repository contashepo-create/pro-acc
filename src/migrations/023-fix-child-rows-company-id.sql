-- FIX: child line tables (invoice_items, quotation_items, purchase_*_items, …)
-- have company_id NOT NULL, but several app/RPC inserts omitted it — same
-- class of bug as journal_lines (022).
--
-- This migration:
--   1. Recreates create_invoice_with_journal so invoice_items get company_id.
--   2. Adds a BEFORE INSERT trigger that backfills company_id from the parent
--      row for every known child table (defense in depth).

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
    INSERT INTO invoice_items (company_id, invoice_id, description, quantity, unit_price, total)
    VALUES (
      p_company_id,
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

-- Generic backfill: if a child row is inserted without company_id, copy it
-- from the parent document. Safe no-op when the parent/table is missing.
CREATE OR REPLACE FUNCTION fill_child_company_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_parent TEXT;
  v_fk TEXT;
  v_id UUID;
BEGIN
  IF NEW.company_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  CASE TG_TABLE_NAME
    WHEN 'invoice_items' THEN
      v_parent := 'invoices'; v_fk := 'invoice_id'; v_id := NEW.invoice_id;
    WHEN 'quotation_items' THEN
      v_parent := 'quotations'; v_fk := 'quotation_id'; v_id := NEW.quotation_id;
    WHEN 'purchase_invoice_items' THEN
      v_parent := 'purchase_invoices'; v_fk := 'purchase_invoice_id'; v_id := NEW.purchase_invoice_id;
    WHEN 'purchase_order_items' THEN
      v_parent := 'purchase_orders'; v_fk := 'purchase_order_id'; v_id := NEW.purchase_order_id;
    WHEN 'salary_items' THEN
      v_parent := 'salary_sheets'; v_fk := 'sheet_id'; v_id := NEW.sheet_id;
    WHEN 'receipt_invoice_items' THEN
      v_parent := 'voucher_receipts'; v_fk := 'id'; v_id := NEW.voucher_receipt_id;
    WHEN 'disbursement_invoice_items' THEN
      v_parent := 'voucher_disbursements'; v_fk := 'id'; v_id := NEW.voucher_disbursement_id;
    WHEN 'progress_claim_items' THEN
      v_parent := 'progress_claims'; v_fk := 'id'; v_id := NEW.claim_id;
    WHEN 'pos_sale_items' THEN
      v_parent := 'pos_sales'; v_fk := 'id'; v_id := NEW.sale_id;
    WHEN 'credit_note_items' THEN
      v_parent := 'credit_notes'; v_fk := 'id'; v_id := NEW.credit_note_id;
    WHEN 'boq_items' THEN
      v_parent := 'projects'; v_fk := 'id'; v_id := NEW.project_id;
    WHEN 'journal_lines' THEN
      v_parent := 'journal_entries'; v_fk := 'id'; v_id := NEW.journal_entry_id;
    ELSE
      RETURN NEW;
  END CASE;

  IF v_id IS NULL THEN
    RETURN NEW;
  END IF;

  EXECUTE format('SELECT company_id FROM %I WHERE %I = $1', v_parent, v_fk)
    INTO NEW.company_id
    USING v_id;

  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t TEXT;
  child_tables TEXT[] := ARRAY[
    'invoice_items',
    'quotation_items',
    'purchase_invoice_items',
    'purchase_order_items',
    'salary_items',
    'receipt_invoice_items',
    'disbursement_invoice_items',
    'progress_claim_items',
    'pos_sale_items',
    'credit_note_items',
    'boq_items'
  ];
BEGIN
  FOREACH t IN ARRAY child_tables LOOP
    BEGIN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_fill_child_company_id ON %I', t);
      EXECUTE format(
        'CREATE TRIGGER trg_fill_child_company_id BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION fill_child_company_id()',
        t
      );
    EXCEPTION WHEN undefined_table THEN
      NULL;
    END;
  END LOOP;
END $$;
