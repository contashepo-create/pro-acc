-- Migration 009: Cost Centers, Branches, Multi-currency activation - Critical for all companies

-- 1. Cost Centers table
CREATE TABLE IF NOT EXISTS cost_centers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  parent_id UUID REFERENCES cost_centers(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, code)
);

CREATE INDEX IF NOT EXISTS idx_cost_centers_company ON cost_centers(company_id);
CREATE INDEX IF NOT EXISTS idx_cost_centers_parent ON cost_centers(parent_id);

-- 2. Branches table
CREATE TABLE IF NOT EXISTS branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  manager_id UUID REFERENCES users(id),
  is_active BOOLEAN DEFAULT true,
  is_main BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, code)
);

CREATE INDEX IF NOT EXISTS idx_branches_company ON branches(company_id);

-- Ensure at least one main branch per company
-- This will be handled in application logic

-- 3. Add cost_center_id and branch_id to journal_entries and journal_lines
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES cost_centers(id);
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);

ALTER TABLE journal_lines ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES cost_centers(id);
ALTER TABLE journal_lines ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);

-- 4. Add branch_id and cost_center_id to other critical tables
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES cost_centers(id);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES cost_centers(id);

ALTER TABLE employees ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES cost_centers(id);

ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);

-- 5. Multi-currency activation in journal_lines
ALTER TABLE journal_lines ADD COLUMN IF NOT EXISTS currency_id UUID REFERENCES currencies(id);
ALTER TABLE journal_lines ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(15,6) DEFAULT 1;
ALTER TABLE journal_lines ADD COLUMN IF NOT EXISTS amount_in_base_currency NUMERIC(15,2);

-- Add base currency to companies if not exists
ALTER TABLE companies ADD COLUMN IF NOT EXISTS base_currency_id UUID REFERENCES currencies(id);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS base_currency_code TEXT DEFAULT 'SAR';

-- 6. Update currencies table to have proper data
-- Ensure SAR exists as base for Saudi companies
INSERT INTO currencies (company_id, code, name, rate, is_base)
SELECT id, 'SAR', 'Saudi Riyal', 1, true FROM companies
ON CONFLICT (company_id, code) DO NOTHING;

-- 7. Withholding Tax table
CREATE TABLE IF NOT EXISTS withholding_taxes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  rate NUMERIC(5,2) NOT NULL,
  account_id UUID REFERENCES accounts(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, code)
);

-- 8. Budgets table (Budget vs Actual)
CREATE TABLE IF NOT EXISTS budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  fiscal_year_id UUID REFERENCES fiscal_years(id),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'closed')),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS budget_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id UUID NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id),
  cost_center_id UUID REFERENCES cost_centers(id),
  branch_id UUID REFERENCES branches(id),
  amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_budgets_company ON budgets(company_id);
CREATE INDEX IF NOT EXISTS idx_budget_lines_budget ON budget_lines(budget_id);

-- 9. Audit log for financial operations (detailed)
CREATE TABLE IF NOT EXISTS financial_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  action TEXT NOT NULL, -- create_invoice, update_invoice, delete_invoice, create_journal, etc.
  table_name TEXT NOT NULL,
  record_id UUID,
  old_values JSONB,
  new_values JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_financial_audit_company ON financial_audit_log(company_id);
CREATE INDEX IF NOT EXISTS idx_financial_audit_table ON financial_audit_log(table_name);
CREATE INDEX IF NOT EXISTS idx_financial_audit_date ON financial_audit_log(created_at DESC);

-- 10. Soft delete columns (add deleted_at to critical tables)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- 11. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_journal_lines_cost_center ON journal_lines(cost_center_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_branch ON journal_lines(branch_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_cost_center ON journal_entries(cost_center_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_branch ON journal_entries(branch_id);
CREATE INDEX IF NOT EXISTS idx_invoices_branch ON invoices(branch_id);
CREATE INDEX IF NOT EXISTS idx_invoices_deleted ON invoices(deleted_at) WHERE deleted_at IS NULL;

-- 12. Default cost center and branch for existing companies
-- Create default main branch and cost center for each company
DO $$
DECLARE
  comp RECORD;
BEGIN
  FOR comp IN SELECT id FROM companies LOOP
    -- Create main branch if not exists
    INSERT INTO branches (company_id, code, name, is_main, is_active)
    VALUES (comp.id, 'MAIN', 'الفرع الرئيسي', true, true)
    ON CONFLICT (company_id, code) DO NOTHING;

    -- Create default cost center if not exists
    INSERT INTO cost_centers (company_id, code, name, is_active)
    VALUES (comp.id, 'MAIN', 'مركز التكلفة الرئيسي', true)
    ON CONFLICT (company_id, code) DO NOTHING;
  END LOOP;
END $$;

SELECT 'Migration 009 completed - Cost Centers, Branches, Multi-currency, Budgets, Audit Logs' as result;
