-- FIX: Atomic sequence generation for ALL remaining tables that used MAX+1
-- This migration adds RPC functions for quotations, purchase_invoices, and purchase_orders
-- to prevent race conditions under concurrent requests.

-- Quotation numbering (uses advisory lock for atomic MAX+1)
CREATE OR REPLACE FUNCTION next_quotation_number(p_company_id UUID)
RETURNS INT AS $$
DECLARE next_num INT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_company_id::text || 'quotations'));
  SELECT COALESCE(MAX(number), 0) + 1 INTO next_num FROM quotations WHERE company_id = p_company_id;
  RETURN next_num;
END;
$$ LANGUAGE plpgsql;

-- Purchase invoice numbering (uses advisory lock for atomic MAX+1)
CREATE OR REPLACE FUNCTION next_purchase_invoice_number(p_company_id UUID)
RETURNS INT AS $$
DECLARE next_num INT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_company_id::text || 'purchase_invoices'));
  SELECT COALESCE(MAX(number), 0) + 1 INTO next_num FROM purchase_invoices WHERE company_id = p_company_id;
  RETURN next_num;
END;
$$ LANGUAGE plpgsql;

-- Purchase order numbering (uses advisory lock for atomic MAX+1)
CREATE OR REPLACE FUNCTION next_purchase_order_number(p_company_id UUID)
RETURNS INT AS $$
DECLARE next_num INT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_company_id::text || 'purchase_orders'));
  SELECT COALESCE(MAX(number), 0) + 1 INTO next_num FROM purchase_orders WHERE company_id = p_company_id;
  RETURN next_num;
END;
$$ LANGUAGE plpgsql;

-- Add unique constraints to prevent duplicate numbers even if race condition occurs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'quotations_company_number_unique'
  ) THEN
    ALTER TABLE quotations ADD CONSTRAINT quotations_company_number_unique UNIQUE (company_id, number);
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_invoices_company_number_unique'
  ) THEN
    ALTER TABLE purchase_invoices ADD CONSTRAINT purchase_invoices_company_number_unique UNIQUE (company_id, number);
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_company_number_unique'
  ) THEN
    ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_company_number_unique UNIQUE (company_id, number);
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add journal_entries number unique constraint (company_id, number)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'journal_entries_company_number_unique'
  ) THEN
    ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_company_number_unique UNIQUE (company_id, number);
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add cash_transactions CHECK constraint for amount > 0
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cash_transactions_amount_positive'
  ) THEN
    ALTER TABLE cash_transactions ADD CONSTRAINT cash_transactions_amount_positive CHECK (amount > 0);
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add journal_entries CHECK constraint for balance (defense in depth)
-- This ensures no unbalanced journal entry can exist even if application logic fails
-- NOTE: This is a DEFERRABLE constraint that can be checked at transaction end
-- Since we insert lines before checking balance, we use a trigger-based approach instead

-- Create a function to validate journal entry balance
CREATE OR REPLACE FUNCTION validate_journal_balance()
RETURNS TRIGGER AS $$
DECLARE
  total_debit NUMERIC;
  total_credit NUMERIC;
BEGIN
  -- Calculate totals for this journal entry
  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
  INTO total_debit, total_credit
  FROM journal_lines
  WHERE journal_entry_id = NEW.journal_entry_id;

  -- Only check if the difference is more than tolerance
  IF ABS(total_debit - total_credit) > 0.01 THEN
    RAISE EXCEPTION 'Journal entry is not balanced: debit (%) != credit (%)', total_debit, total_credit;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Note: The trigger approach would need careful consideration because lines are inserted one by one.
-- Instead, we add a CHECK that can be enforced via application logic or a deferred constraint.
-- For now, we document this as a recommended enhancement.
