-- FIX: Atomic invoice creation with journal entry in a single transaction
-- Eliminates manual rollback in invoices/route.ts

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
  p_items JSONB,  -- [{description, quantity, unitPrice, total}]
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
  -- Create the invoice
  INSERT INTO invoices (
    company_id, number, date, due_date, contact_id, project_id,
    subtotal, vat_rate, vat_amount, total, status, notes, created_by
  ) VALUES (
    p_company_id, p_number, p_date, p_due_date, p_contact_id, p_project_id,
    p_subtotal, p_vat_rate, p_vat_amount, p_total, p_status, p_notes, p_created_by
  ) RETURNING id INTO v_invoice_id;

  -- Create journal entry for the invoice
  INSERT INTO journal_entries (
    company_id, number, date, type, description, reference, created_by
  ) VALUES (
    p_company_id, p_number, p_date, 'general',
    'فاتورة مبيعات رقم ' || p_number,
    'INV-' || p_number,
    p_created_by
  ) RETURNING id INTO v_journal_id;

  -- Insert journal lines
  -- Debit: Accounts Receivable
  INSERT INTO journal_lines (journal_entry_id, account_id, account_code, debit, credit, description)
  VALUES (v_journal_id, p_ar_account_id, '1130', p_total, 0, 'فاتورة مبيعات رقم ' || p_number);

  -- Credit: Revenue
  INSERT INTO journal_lines (journal_entry_id, account_id, account_code, debit, credit, description)
  VALUES (v_journal_id, p_revenue_account_id, '4100', 0, p_subtotal, 'إيراد فاتورة رقم ' || p_number);

  -- Credit: VAT (if applicable)
  IF p_vat_amount > 0 AND p_vat_account_id IS NOT NULL THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, account_code, debit, credit, description)
    VALUES (v_journal_id, p_vat_account_id, '2120', 0, p_vat_amount, 'ضريبة فاتورة رقم ' || p_number);
  END IF;

  -- Insert invoice items
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

  -- Update invoice with journal entry reference
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
