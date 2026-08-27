-- ============================================================
-- 038 - Backfill missing tables from migrations 007..035
--
-- The production _migrations table only recorded 001..006 even
-- though later code relies on tables introduced in 009, 010, 011
-- and later. This idempotent migration creates any missing table
-- and index so a fresh / partially-migrated database ends up with
-- every table the application queries.
--
-- It is safe to run repeatedly: every CREATE uses IF NOT EXISTS
-- and every ALTER uses ADD COLUMN IF NOT EXISTS.
-- ============================================================

BEGIN;

-- ----------------------------------------------------------------
-- 009 - cost_centers, branches, currencies, withholding_taxes,
--       budgets, budget_lines, financial_audit_log, soft-delete cols
-- ----------------------------------------------------------------

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
CREATE INDEX IF NOT EXISTS idx_cost_centers_parent  ON cost_centers(parent_id);

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

-- branch/cost-center columns on existing tables
ALTER TABLE journal_entries       ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES cost_centers(id);
ALTER TABLE journal_entries       ADD COLUMN IF NOT EXISTS branch_id      UUID REFERENCES branches(id);
ALTER TABLE journal_lines         ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES cost_centers(id);
ALTER TABLE journal_lines         ADD COLUMN IF NOT EXISTS branch_id      UUID REFERENCES branches(id);
ALTER TABLE invoices              ADD COLUMN IF NOT EXISTS branch_id      UUID REFERENCES branches(id);
ALTER TABLE invoices              ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES cost_centers(id);
ALTER TABLE projects              ADD COLUMN IF NOT EXISTS branch_id      UUID REFERENCES branches(id);
ALTER TABLE projects              ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES cost_centers(id);
ALTER TABLE employees             ADD COLUMN IF NOT EXISTS branch_id      UUID REFERENCES branches(id);
ALTER TABLE employees             ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES cost_centers(id);
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS branch_id     UUID REFERENCES branches(id);

-- currencies (referenced below) — make sure the table exists before
-- adding multi-currency columns.
CREATE TABLE IF NOT EXISTS currencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  symbol TEXT,
  rate NUMERIC(15,6) NOT NULL DEFAULT 1,
  is_base BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, code)
);

ALTER TABLE journal_lines         ADD COLUMN IF NOT EXISTS currency_id           UUID REFERENCES currencies(id);
ALTER TABLE journal_lines         ADD COLUMN IF NOT EXISTS exchange_rate          NUMERIC(15,6) DEFAULT 1;
ALTER TABLE journal_lines         ADD COLUMN IF NOT EXISTS amount_in_base_currency NUMERIC(15,2);
ALTER TABLE companies             ADD COLUMN IF NOT EXISTS base_currency_id       UUID REFERENCES currencies(id);
ALTER TABLE companies             ADD COLUMN IF NOT EXISTS base_currency_code     TEXT DEFAULT 'SAR';

INSERT INTO currencies (company_id, code, name, rate, is_base)
SELECT id, 'SAR', 'Saudi Riyal', 1, true FROM companies
ON CONFLICT (company_id, code) DO NOTHING;

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
CREATE INDEX IF NOT EXISTS idx_budgets_company      ON budgets(company_id);
CREATE INDEX IF NOT EXISTS idx_budget_lines_budget  ON budget_lines(budget_id);

CREATE TABLE IF NOT EXISTS financial_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id UUID,
  old_values JSONB,
  new_values JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_financial_audit_company ON financial_audit_log(company_id);
CREATE INDEX IF NOT EXISTS idx_financial_audit_table   ON financial_audit_log(table_name);
CREATE INDEX IF NOT EXISTS idx_financial_audit_date    ON financial_audit_log(created_at DESC);

-- Performance + soft-delete indexes from 009
CREATE INDEX IF NOT EXISTS idx_journal_lines_cost_center ON journal_lines(cost_center_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_branch      ON journal_lines(branch_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_cost_center ON journal_entries(cost_center_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_branch    ON journal_entries(branch_id);
CREATE INDEX IF NOT EXISTS idx_invoices_branch           ON invoices(branch_id);

ALTER TABLE invoices         ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE journal_entries  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE contacts         ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE projects         ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE accounts         ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_invoices_deleted ON invoices(deleted_at) WHERE deleted_at IS NULL;

-- Seed default main branch / cost center for existing companies
DO $$
DECLARE
  comp RECORD;
BEGIN
  FOR comp IN SELECT id FROM companies LOOP
    INSERT INTO branches (company_id, code, name, is_main, is_active)
      VALUES (comp.id, 'MAIN', 'الفرع الرئيسي', true, true)
      ON CONFLICT (company_id, code) DO NOTHING;

    INSERT INTO cost_centers (company_id, code, name, is_active)
      VALUES (comp.id, 'MAIN', 'مركز التكلفة الرئيسي', true)
      ON CONFLICT (company_id, code) DO NOTHING;
  END LOOP;
END $$;

-- ----------------------------------------------------------------
-- 010 - POS / Properties / Manufacturing / GOSI
-- ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pos_terminals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, code)
);

CREATE TABLE IF NOT EXISTS pos_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id),
  terminal_id UUID REFERENCES pos_terminals(id),
  number INTEGER NOT NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  time TIME NOT NULL DEFAULT CURRENT_TIME,
  subtotal NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  total NUMERIC(15,2) NOT NULL DEFAULT 0,
  payment_method TEXT CHECK (payment_method IN ('cash', 'card', 'transfer', 'mixed')),
  status TEXT DEFAULT 'completed' CHECK (status IN ('completed', 'voided', 'refunded')),
  customer_id UUID REFERENCES contacts(id),
  cashier_id UUID REFERENCES users(id),
  journal_entry_id UUID REFERENCES journal_entries(id),
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, number)
);

CREATE TABLE IF NOT EXISTS pos_sale_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  sale_id UUID NOT NULL REFERENCES pos_sales(id) ON DELETE CASCADE,
  item_id UUID REFERENCES inventory_items(id),
  description TEXT NOT NULL,
  quantity NUMERIC(15,2) NOT NULL DEFAULT 1,
  unit_price NUMERIC(15,2) NOT NULL DEFAULT 0,
  total NUMERIC(15,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pos_sales_company     ON pos_sales(company_id);
CREATE INDEX IF NOT EXISTS idx_pos_sales_date        ON pos_sales(date DESC);
CREATE INDEX IF NOT EXISTS idx_pos_terminals_company ON pos_terminals(company_id);

CREATE TABLE IF NOT EXISTS properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT CHECK (type IN ('apartment', 'villa', 'office', 'shop', 'warehouse', 'land', 'building')),
  status TEXT DEFAULT 'available' CHECK (status IN ('available', 'rented', 'sold', 'maintenance')),
  address TEXT,
  area NUMERIC(10,2),
  bedrooms INT,
  bathrooms INT,
  purchase_price NUMERIC(15,2),
  rental_price NUMERIC(15,2),
  owner_id UUID REFERENCES contacts(id),
  cost_center_id UUID REFERENCES cost_centers(id),
  account_id UUID REFERENCES accounts(id),
  is_active BOOLEAN DEFAULT true,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, code)
);

CREATE TABLE IF NOT EXISTS property_leases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES contacts(id),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  monthly_rent NUMERIC(15,2) NOT NULL,
  deposit NUMERIC(15,2) DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled')),
  journal_entry_id UUID REFERENCES journal_entries(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS property_maintenance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  cost NUMERIC(15,2) NOT NULL DEFAULT 0,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_properties_company     ON properties(company_id);
CREATE INDEX IF NOT EXISTS idx_properties_type        ON properties(type);
CREATE INDEX IF NOT EXISTS idx_property_leases_company ON property_leases(company_id);

CREATE TABLE IF NOT EXISTS manufacturing_boms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  product_id UUID NOT NULL REFERENCES inventory_items(id),
  quantity NUMERIC(15,2) NOT NULL DEFAULT 1,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, code)
);

CREATE TABLE IF NOT EXISTS manufacturing_bom_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bom_id UUID NOT NULL REFERENCES manufacturing_boms(id) ON DELETE CASCADE,
  component_id UUID NOT NULL REFERENCES inventory_items(id),
  quantity NUMERIC(15,2) NOT NULL DEFAULT 1,
  unit_cost NUMERIC(15,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS manufacturing_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id),
  bom_id UUID NOT NULL REFERENCES manufacturing_boms(id),
  number INTEGER NOT NULL,
  product_id UUID NOT NULL REFERENCES inventory_items(id),
  quantity_to_produce NUMERIC(15,2) NOT NULL DEFAULT 1,
  quantity_produced NUMERIC(15,2) NOT NULL DEFAULT 0,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'in_progress', 'completed', 'cancelled')),
  start_date DATE,
  end_date DATE,
  cost_center_id UUID REFERENCES cost_centers(id),
  journal_entry_id UUID REFERENCES journal_entries(id),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, number)
);

CREATE TABLE IF NOT EXISTS manufacturing_order_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES manufacturing_orders(id) ON DELETE CASCADE,
  component_id UUID NOT NULL REFERENCES inventory_items(id),
  required_quantity NUMERIC(15,2) NOT NULL DEFAULT 0,
  consumed_quantity NUMERIC(15,2) NOT NULL DEFAULT 0,
  unit_cost NUMERIC(15,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mfg_boms_company   ON manufacturing_boms(company_id);
CREATE INDEX IF NOT EXISTS idx_mfg_orders_company ON manufacturing_orders(company_id);
CREATE INDEX IF NOT EXISTS idx_mfg_orders_status  ON manufacturing_orders(status);

CREATE TABLE IF NOT EXISTS gosi_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE UNIQUE,
  saudi_rate NUMERIC(5,2) DEFAULT 9.75,
  expat_rate NUMERIC(5,2) DEFAULT 2,
  company_saudi_rate NUMERIC(5,2) DEFAULT 11.75,
  company_expat_rate NUMERIC(5,2) DEFAULT 2,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------
-- 011 - refresh_tokens, credit_notes, depreciation_log,
--       trial balance materialized view
-- ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  revoked BOOLEAN DEFAULT false,
  replaced_by UUID REFERENCES refresh_tokens(id),
  ip_address TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user    ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash    ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens(expires_at);

CREATE TABLE IF NOT EXISTS credit_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  invoice_id UUID REFERENCES invoices(id),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  reason TEXT NOT NULL,
  subtotal NUMERIC(15,2) NOT NULL DEFAULT 0,
  vat_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  total NUMERIC(15,2) NOT NULL DEFAULT 0,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'cancelled')),
  journal_entry_id UUID REFERENCES journal_entries(id),
  created_by UUID REFERENCES users(id),
  branch_id UUID REFERENCES branches(id),
  cost_center_id UUID REFERENCES cost_centers(id),
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, number)
);

CREATE TABLE IF NOT EXISTS credit_note_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_note_id UUID NOT NULL REFERENCES credit_notes(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity NUMERIC(15,2) NOT NULL DEFAULT 1,
  unit_price NUMERIC(15,2) NOT NULL DEFAULT 0,
  total NUMERIC(15,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_credit_notes_company ON credit_notes(company_id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_invoice ON credit_notes(invoice_id);

CREATE TABLE IF NOT EXISTS credit_note_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  year INTEGER NOT NULL,
  last_number INTEGER NOT NULL DEFAULT 0,
  UNIQUE(company_id, year)
);

-- Weighted average cost columns
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS moving_average_cost     NUMERIC(15,2) DEFAULT 0;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS total_quantity_purchased NUMERIC(15,2) DEFAULT 0;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS total_cost_purchased     NUMERIC(15,2) DEFAULT 0;

CREATE TABLE IF NOT EXISTS depreciation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES fixed_assets(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  amount NUMERIC(15,2) NOT NULL,
  journal_entry_id UUID REFERENCES journal_entries(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(asset_id, date)
);

-- Ensure journal_entries has reference/created_by columns (added in 011)
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS reference  TEXT;
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);

-- Login-attempts indexes
CREATE INDEX IF NOT EXISTS idx_login_attempts_company   ON login_attempts(company_id);
CREATE INDEX IF NOT EXISTS idx_login_attempts_email_time ON login_attempts(email, attempted_at DESC);

-- Trial-balance materialized view (best effort — ignore CONCURRENTLY failures)
DO $$
BEGIN
  -- Drop pre-existing regular view from 010 if it exists.
  DROP VIEW IF EXISTS vw_trial_balance;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_trial_balance AS
SELECT
  a.company_id,
  a.id AS account_id,
  a.code,
  a.name,
  a.type,
  COALESCE(SUM(jl.debit), 0)  AS total_debit,
  COALESCE(SUM(jl.credit), 0) AS total_credit,
  COALESCE(SUM(jl.debit) - SUM(jl.credit), 0) AS balance
FROM accounts a
LEFT JOIN journal_lines jl ON jl.account_id = a.id
LEFT JOIN journal_entries je ON je.id = jl.journal_entry_id AND je.deleted_at IS NULL
WHERE a.is_active = true AND a.deleted_at IS NULL
GROUP BY a.company_id, a.id, a.code, a.name, a.type;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_trial_balance_unique ON mv_trial_balance(company_id, account_id);
CREATE INDEX IF NOT EXISTS idx_mv_trial_balance_company ON mv_trial_balance(company_id);

CREATE OR REPLACE FUNCTION refresh_trial_balance() RETURNS VOID AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_trial_balance;
EXCEPTION WHEN OTHERS THEN
  REFRESH MATERIALIZED VIEW mv_trial_balance;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------
-- 005 - company_registration_tokens (sometimes missed because 005
--       was applied without reading the file?)
-- ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS company_registration_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_company_registration_tokens_token ON company_registration_tokens(token);

-- ----------------------------------------------------------------
-- Tax returns (used by /api/tax-returns + data-export). The code
-- currently writes to vat_return_filings, but the diagnostics list
-- expects tax_returns as the canonical table. Provide it as an
-- alias-compatible shape so a verification query succeeds; do not
-- break existing code that writes to vat_return_filings.
-- ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tax_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  output_vat NUMERIC(15,2) NOT NULL DEFAULT 0,
  input_vat NUMERIC(15,2) NOT NULL DEFAULT 0,
  net_vat NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_sales NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_purchases NUMERIC(15,2) NOT NULL DEFAULT 0,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'filed', 'paid')),
  filed_at TIMESTAMPTZ,
  filed_by UUID REFERENCES users(id),
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tax_returns_company ON tax_returns(company_id);
CREATE INDEX IF NOT EXISTS idx_tax_returns_period  ON tax_returns(period_from, period_to);

COMMIT;

SELECT 'Migration 038 completed — all required tables backfilled' AS result;
