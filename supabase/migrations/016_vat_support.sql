-- ============================================================
-- Migration 016: VAT Support Across All Modules
-- Date: 2026-07-22
-- Description: Add tax columns to all transaction tables for full VAT compliance
-- ============================================================

-- 1. Quotations: add tax_rate column (tax_amount already exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'quotations') THEN
    ALTER TABLE quotations ADD COLUMN IF NOT EXISTS tax_rate NUMERIC DEFAULT 0;
  END IF;
END $$;

-- 2. Progress billing: add tax_rate, tax_amount
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'progress_billing') THEN
    ALTER TABLE progress_billing ADD COLUMN IF NOT EXISTS tax_rate NUMERIC DEFAULT 0;
    ALTER TABLE progress_billing ADD COLUMN IF NOT EXISTS tax_amount NUMERIC DEFAULT 0;
  END IF;
END $$;

-- 3. Project expenses: add tax_rate, tax_amount
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'project_expenses') THEN
    ALTER TABLE project_expenses ADD COLUMN IF NOT EXISTS tax_rate NUMERIC DEFAULT 0;
    ALTER TABLE project_expenses ADD COLUMN IF NOT EXISTS tax_amount NUMERIC DEFAULT 0;
  END IF;
END $$;

-- 4. Cash transactions: add tax_rate, tax_amount
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'cash_transactions') THEN
    ALTER TABLE cash_transactions ADD COLUMN IF NOT EXISTS tax_rate NUMERIC DEFAULT 0;
    ALTER TABLE cash_transactions ADD COLUMN IF NOT EXISTS tax_amount NUMERIC DEFAULT 0;
  END IF;
END $$;

-- 5. Invoice items: add columns for inventory linkage and item types
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'invoice_items') THEN
    ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS item_type TEXT DEFAULT 'service' CHECK(item_type IN ('service', 'product', 'inventory'));
    ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS inventory_item_id UUID REFERENCES inventory_items(id) ON DELETE SET NULL;
    ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS unit TEXT DEFAULT 'وحدة';
  END IF;
END $$;

-- 6. Projects: ensure tax_enabled and tax_rate exist (they should from schema)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'projects') THEN
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS tax_enabled BOOLEAN DEFAULT false;
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS tax_rate NUMERIC DEFAULT 0;
  END IF;
END $$;
