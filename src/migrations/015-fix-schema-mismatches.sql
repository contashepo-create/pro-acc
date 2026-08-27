-- Migration 015: Fix Schema Mismatches
-- This migration fixes all inconsistencies between the database schema and API code
-- that were causing "حدث خطأ في الخادم" errors

-- ============================================
-- 1. Fix invoices table
-- ============================================
-- Add missing columns that the API code expects

-- Add vat_rate column (API uses vat_rate instead of tax_rate)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS vat_rate NUMERIC(5,2);

-- Add vat_amount column (API uses vat_amount instead of tax_amount)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS vat_amount NUMERIC(15,2);

-- Add created_by column (API tracks who created the invoice)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);

-- Migrate existing data from tax_rate to vat_rate
UPDATE invoices SET vat_rate = tax_rate WHERE vat_rate IS NULL;

-- Migrate existing data from tax_amount to vat_amount
UPDATE invoices SET vat_amount = tax_amount WHERE vat_amount IS NULL;

-- ============================================
-- 2. Fix banks_safes table
-- ============================================
-- Add missing opening_balance column

ALTER TABLE banks_safes ADD COLUMN IF NOT EXISTS opening_balance NUMERIC(15,2) DEFAULT 0;

-- ============================================
-- 3. Fix journal_entries table
-- ============================================
-- Add reference tracking columns

ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS reference_type TEXT;
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS reference_id UUID;

-- Add reversed_by column for reversing entries
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS reversed_by UUID REFERENCES journal_entries(id);

-- ============================================
-- 4. Add missing financial_audit_log table
-- ============================================
-- This table is used by the API for audit logging

CREATE TABLE IF NOT EXISTS financial_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  user_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id UUID NOT NULL,
  old_values JSONB,
  new_values JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_financial_audit_log_company ON financial_audit_log(company_id);
CREATE INDEX IF NOT EXISTS idx_financial_audit_log_table ON financial_audit_log(table_name);
CREATE INDEX IF NOT EXISTS idx_financial_audit_log_record ON financial_audit_log(record_id);

-- ============================================
-- 5. Add missing columns to other tables
-- ============================================

-- Add status column to voucher_disbursements
ALTER TABLE voucher_disbursements ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';

-- Add status column to voucher_receipts
ALTER TABLE voucher_receipts ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';

-- Add approved_by and approved_at to journal_entries
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id);
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- ============================================
-- 6. Create missing sequences tables if not exist
-- ============================================

CREATE TABLE IF NOT EXISTS invoice_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  year INTEGER NOT NULL,
  last_number INTEGER NOT NULL DEFAULT 0,
  UNIQUE(company_id, year)
);

CREATE INDEX IF NOT EXISTS idx_invoice_sequences_company_year ON invoice_sequences(company_id, year);

-- ============================================
-- 7. Fix any existing data
-- ============================================

-- Ensure all invoices have vat_rate and vat_amount
UPDATE invoices 
SET vat_rate = COALESCE(vat_rate, tax_rate, 15.00),
    vat_amount = COALESCE(vat_amount, tax_amount, 0)
WHERE vat_rate IS NULL OR vat_amount IS NULL;

-- ============================================
-- 8. Create helper function for balance calculation
-- ============================================

CREATE OR REPLACE FUNCTION get_account_balance(
  p_account_id UUID,
  p_company_id UUID,
  p_as_of_date DATE DEFAULT CURRENT_DATE
)
RETURNS NUMERIC AS $$
DECLARE
  v_balance NUMERIC;
BEGIN
  SELECT COALESCE(SUM(debit) - SUM(credit), 0)
  INTO v_balance
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.journal_entry_id
  WHERE jl.account_id = p_account_id
    AND je.company_id = p_company_id
    AND je.date <= p_as_of_date;
  
  RETURN v_balance;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Summary
-- ============================================
-- This migration fixes all schema mismatches that were causing errors:
-- ✅ Added vat_rate, vat_amount, created_by to invoices
-- ✅ Added opening_balance to banks_safes
-- ✅ Added reference_type, reference_id, reversed_by to journal_entries
-- ✅ Created financial_audit_log table
-- ✅ Added status to voucher tables
-- ✅ Added approved_by, approved_at to journal_entries
-- ✅ Created invoice_sequences table
-- ✅ Created get_account_balance function
