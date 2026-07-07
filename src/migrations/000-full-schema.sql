-- ============================================================
-- AccWeb Full Database Schema
-- Combined migration for Supabase SQL Editor
-- IMPORTANT: Run this file ONCE in Supabase Dashboard > SQL Editor
-- ============================================================

-- 001: Core schema
CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  master_password_hash TEXT NOT NULL,
  telegram_chat_id TEXT NOT NULL,
  telegram_bot_token TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'Admin',
  is_active BOOLEAN DEFAULT true,
  last_login TIMESTAMPTZ,
  telegram_code TEXT,
  telegram_code_expires TIMESTAMPTZ,
  master_verified BOOLEAN DEFAULT false,
  login_session_data JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  commercial_registration TEXT,
  tax_number TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  currency_symbol TEXT DEFAULT 'ر.س',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin', 'accountant', 'manager', 'supervisor')),
  is_active BOOLEAN DEFAULT true,
  email_verified BOOLEAN DEFAULT false,
  email_verification_token TEXT,
  email_verification_expires TIMESTAMPTZ,
  last_activity TIMESTAMPTZ DEFAULT NOW(),
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, email)
);

CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  code VARCHAR(20) NOT NULL,
  name TEXT NOT NULL,
  name_en TEXT,
  type TEXT NOT NULL CHECK(type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  parent_id UUID REFERENCES accounts(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, code)
);

CREATE TABLE IF NOT EXISTS journal_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  year INTEGER NOT NULL,
  last_number INTEGER NOT NULL DEFAULT 0,
  UNIQUE(company_id, year)
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  number INTEGER NOT NULL,
  date DATE NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('general', 'opening_balance', 'accrual')),
  description TEXT NOT NULL DEFAULT '',
  reference_type TEXT,
  reference_id UUID,
  project_id UUID,
  created_by UUID NOT NULL REFERENCES users(id),
  reversal_of UUID REFERENCES journal_entries(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, number)
);

CREATE TABLE IF NOT EXISTS journal_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  journal_entry_id UUID NOT NULL REFERENCES journal_entries(id),
  account_id UUID NOT NULL REFERENCES accounts(id),
  account_code VARCHAR(20) NOT NULL,
  account_name TEXT NOT NULL,
  debit NUMERIC(15,2) NOT NULL DEFAULT 0,
  credit NUMERIC(15,2) NOT NULL DEFAULT 0,
  description TEXT,
  project_id UUID,
  contact_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('client', 'supplier', 'subcontractor', 'both')),
  phone TEXT,
  email TEXT,
  address TEXT,
  tax_number TEXT,
  commercial_registration TEXT,
  account_id UUID REFERENCES accounts(id),
  credit_limit NUMERIC(15,2),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, name)
);

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  client_id UUID REFERENCES contacts(id),
  contract_value NUMERIC(15,2) NOT NULL DEFAULT 0,
  start_date DATE NOT NULL,
  end_date DATE,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed', 'cancelled')),
  tax_enabled BOOLEAN DEFAULT false,
  tax_rate NUMERIC(5,2) DEFAULT 15.00,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, name)
);

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  number INTEGER NOT NULL,
  date DATE NOT NULL,
  due_date DATE NOT NULL,
  contact_id UUID NOT NULL REFERENCES contacts(id),
  project_id UUID REFERENCES projects(id),
  subtotal NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(5,2) DEFAULT 15.00,
  total NUMERIC(15,2) NOT NULL DEFAULT 0,
  paid_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK(status IN ('unpaid', 'partial', 'paid', 'cancelled')),
  journal_entry_id UUID REFERENCES journal_entries(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, number)
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  description TEXT NOT NULL,
  quantity NUMERIC(15,2) NOT NULL DEFAULT 1,
  unit_price NUMERIC(15,2) NOT NULL DEFAULT 0,
  total NUMERIC(15,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS banks_safes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('bank', 'safe')),
  account_number TEXT,
  account_id UUID REFERENCES accounts(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, name)
);

CREATE TABLE IF NOT EXISTS voucher_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  number INTEGER NOT NULL,
  date DATE NOT NULL,
  receipt_type TEXT NOT NULL CHECK(receipt_type IN ('client', 'supplier_refund', 'general', 'supplier_advance_return')),
  contact_id UUID REFERENCES contacts(id),
  amount NUMERIC(15,2) NOT NULL,
  bank_safe_id UUID NOT NULL REFERENCES banks_safes(id),
  reference_type TEXT,
  reference_id UUID,
  reason TEXT NOT NULL DEFAULT '',
  journal_entry_id UUID REFERENCES journal_entries(id),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, number)
);

CREATE TABLE IF NOT EXISTS voucher_disbursements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  number INTEGER NOT NULL,
  date DATE NOT NULL,
  disbursement_type TEXT NOT NULL CHECK(disbursement_type IN ('supplier', 'client_refund', 'employee_advance', 'other', 'supplier_advance', 'subcontractor')),
  contact_id UUID REFERENCES contacts(id),
  employee_id UUID,
  amount NUMERIC(15,2) NOT NULL,
  bank_safe_id UUID NOT NULL REFERENCES banks_safes(id),
  reason TEXT NOT NULL DEFAULT '',
  journal_entry_id UUID REFERENCES journal_entries(id),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, number)
);

CREATE TABLE IF NOT EXISTS receipt_invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  voucher_receipt_id UUID NOT NULL REFERENCES voucher_receipts(id),
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  amount NUMERIC(15,2) NOT NULL,
  journal_entry_id UUID REFERENCES journal_entries(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cash_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  date DATE NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('revenue', 'expense')),
  amount NUMERIC(15,2) NOT NULL,
  account_id UUID NOT NULL REFERENCES accounts(id),
  bank_safe_id UUID REFERENCES banks_safes(id),
  contact_id UUID REFERENCES contacts(id),
  project_id UUID REFERENCES projects(id),
  category_id UUID,
  reason TEXT NOT NULL DEFAULT '',
  journal_entry_id UUID REFERENCES journal_entries(id),
  voucher_receipt_id UUID REFERENCES voucher_receipts(id),
  voucher_disbursement_id UUID REFERENCES voucher_disbursements(id),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transaction_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('revenue', 'expense')),
  is_active BOOLEAN DEFAULT true,
  UNIQUE(company_id, name)
);

CREATE TABLE IF NOT EXISTS warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  location TEXT,
  is_active BOOLEAN DEFAULT true,
  UNIQUE(company_id, name)
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  code VARCHAR(50) NOT NULL,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  quantity NUMERIC(15,2) NOT NULL DEFAULT 0,
  unit_price NUMERIC(15,2) NOT NULL DEFAULT 0,
  warehouse_id UUID NOT NULL REFERENCES warehouses(id),
  category TEXT,
  is_active BOOLEAN DEFAULT true,
  UNIQUE(company_id, code)
);

CREATE TABLE IF NOT EXISTS inventory_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  item_id UUID NOT NULL REFERENCES inventory_items(id),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id),
  type TEXT NOT NULL CHECK(type IN ('add', 'issue', 'adjustment', 'transfer', 'return')),
  quantity NUMERIC(15,2) NOT NULL,
  unit_price NUMERIC(15,2),
  total_value NUMERIC(15,2),
  reference_type TEXT,
  reference_id UUID,
  project_id UUID,
  notes TEXT,
  date DATE NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  salary NUMERIC(15,2) NOT NULL DEFAULT 0,
  department TEXT,
  position TEXT,
  hire_date DATE NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, name)
);

CREATE TABLE IF NOT EXISTS employee_advances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  employee_id UUID NOT NULL REFERENCES employees(id),
  amount NUMERIC(15,2) NOT NULL,
  remaining_amount NUMERIC(15,2) NOT NULL,
  date DATE NOT NULL,
  reason TEXT,
  journal_entry_id UUID REFERENCES journal_entries(id),
  voucher_disbursement_id UUID REFERENCES voucher_disbursements(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payroll (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  employee_id UUID NOT NULL REFERENCES employees(id),
  date DATE NOT NULL,
  basic_salary NUMERIC(15,2) NOT NULL DEFAULT 0,
  allowances NUMERIC(15,2) NOT NULL DEFAULT 0,
  deductions NUMERIC(15,2) NOT NULL DEFAULT 0,
  advance_deduction NUMERIC(15,2) NOT NULL DEFAULT 0,
  net_pay NUMERIC(15,2) NOT NULL DEFAULT 0,
  journal_entry_id UUID REFERENCES journal_entries(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS salary_sheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  month INTEGER NOT NULL,
  year INTEGER NOT NULL,
  date DATE NOT NULL,
  status TEXT DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, name)
);

CREATE TABLE IF NOT EXISTS salary_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  sheet_id UUID NOT NULL REFERENCES salary_sheets(id),
  employee_id UUID NOT NULL REFERENCES employees(id),
  basic_salary NUMERIC(15,2) DEFAULT 0,
  allowances NUMERIC(15,2) DEFAULT 0,
  deductions NUMERIC(15,2) DEFAULT 0,
  net_pay NUMERIC(15,2) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS daily_workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  phone TEXT,
  daily_wage NUMERIC(15,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS daily_worker_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  worker_id UUID NOT NULL REFERENCES daily_workers(id),
  project_id UUID REFERENCES projects(id),
  date DATE NOT NULL,
  days INTEGER NOT NULL DEFAULT 1,
  wage NUMERIC(15,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS daily_worker_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  worker_id UUID NOT NULL REFERENCES daily_workers(id),
  amount NUMERIC(15,2) NOT NULL,
  date DATE NOT NULL,
  journal_entry_id UUID REFERENCES journal_entries(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS custodies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  employee_id UUID NOT NULL REFERENCES employees(id),
  amount NUMERIC(15,2) NOT NULL,
  remaining_amount NUMERIC(15,2) NOT NULL,
  date DATE NOT NULL,
  reason TEXT,
  journal_entry_id UUID REFERENCES journal_entries(id),
  status TEXT DEFAULT 'open' CHECK(status IN ('open', 'settled', 'shortage')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS custody_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  custody_id UUID NOT NULL REFERENCES custodies(id),
  amount NUMERIC(15,2) NOT NULL,
  date DATE NOT NULL,
  journal_entry_id UUID REFERENCES journal_entries(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS custody_deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  custody_id UUID NOT NULL REFERENCES custodies(id),
  amount NUMERIC(15,2) NOT NULL,
  date DATE NOT NULL,
  bank_safe_id UUID REFERENCES banks_safes(id),
  journal_entry_id UUID REFERENCES journal_entries(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subcontractor_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  contact_id UUID NOT NULL REFERENCES contacts(id),
  project_id UUID REFERENCES projects(id),
  contract_number TEXT NOT NULL,
  contract_value NUMERIC(15,2) NOT NULL DEFAULT 0,
  start_date DATE NOT NULL,
  end_date DATE,
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'completed', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, contract_number)
);

CREATE TABLE IF NOT EXISTS subcontractor_certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  contract_id UUID NOT NULL REFERENCES subcontractor_contracts(id),
  number INTEGER NOT NULL,
  amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  retention NUMERIC(15,2) NOT NULL DEFAULT 0,
  net_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  date DATE NOT NULL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'paid')),
  journal_entry_id UUID REFERENCES journal_entries(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, contract_id, number)
);

CREATE TABLE IF NOT EXISTS subcontractor_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  certificate_id UUID REFERENCES subcontractor_certificates(id),
  contract_id UUID NOT NULL REFERENCES subcontractor_contracts(id),
  amount NUMERIC(15,2) NOT NULL,
  date DATE NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('payment', 'advance', 'retention_release')),
  journal_entry_id UUID REFERENCES journal_entries(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  number INTEGER NOT NULL,
  date DATE NOT NULL,
  supplier_id UUID NOT NULL REFERENCES contacts(id),
  project_id UUID REFERENCES projects(id),
  subtotal NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  total NUMERIC(15,2) NOT NULL DEFAULT 0,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'partial', 'received', 'cancelled')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, number)
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id),
  description TEXT NOT NULL,
  quantity NUMERIC(15,2) NOT NULL DEFAULT 1,
  received_quantity NUMERIC(15,2) NOT NULL DEFAULT 0,
  unit_price NUMERIC(15,2) NOT NULL DEFAULT 0,
  total NUMERIC(15,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS purchase_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  number INTEGER NOT NULL,
  date DATE NOT NULL,
  supplier_id UUID NOT NULL REFERENCES contacts(id),
  purchase_order_id UUID REFERENCES purchase_orders(id),
  subtotal NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  total NUMERIC(15,2) NOT NULL DEFAULT 0,
  paid_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  status TEXT DEFAULT 'unpaid' CHECK(status IN ('unpaid', 'partial', 'paid', 'cancelled')),
  journal_entry_id UUID REFERENCES journal_entries(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, number)
);

CREATE TABLE IF NOT EXISTS purchase_invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  purchase_invoice_id UUID NOT NULL REFERENCES purchase_invoices(id),
  description TEXT NOT NULL,
  quantity NUMERIC(15,2) NOT NULL DEFAULT 1,
  unit_price NUMERIC(15,2) NOT NULL DEFAULT 0,
  total NUMERIC(15,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS disbursement_invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  voucher_disbursement_id UUID NOT NULL REFERENCES voucher_disbursements(id),
  purchase_invoice_id UUID REFERENCES purchase_invoices(id),
  amount NUMERIC(15,2) NOT NULL,
  journal_entry_id UUID REFERENCES journal_entries(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  number INTEGER NOT NULL,
  date DATE NOT NULL,
  contact_id UUID REFERENCES contacts(id),
  project_id UUID REFERENCES projects(id),
  subtotal NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  total NUMERIC(15,2) NOT NULL DEFAULT 0,
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'sent', 'accepted', 'rejected', 'converted')),
  notes TEXT,
  terms TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, number)
);

CREATE TABLE IF NOT EXISTS quotation_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  quotation_id UUID NOT NULL REFERENCES quotations(id),
  description TEXT NOT NULL,
  quantity NUMERIC(15,2) NOT NULL DEFAULT 1,
  unit_price NUMERIC(15,2) NOT NULL DEFAULT 0,
  total NUMERIC(15,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS boq_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  project_id UUID NOT NULL REFERENCES projects(id),
  code VARCHAR(50),
  description TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'واحدة',
  quantity NUMERIC(15,2) NOT NULL DEFAULT 1,
  unit_price NUMERIC(15,2) NOT NULL DEFAULT 0,
  total NUMERIC(15,2) NOT NULL DEFAULT 0,
  parent_id UUID REFERENCES boq_items(id),
  level INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS progress_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  project_id UUID NOT NULL REFERENCES projects(id),
  number INTEGER NOT NULL,
  date DATE NOT NULL,
  amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  retention NUMERIC(15,2) NOT NULL DEFAULT 0,
  net_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'submitted', 'approved', 'paid')),
  journal_entry_id UUID REFERENCES journal_entries(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, project_id, number)
);

CREATE TABLE IF NOT EXISTS progress_claim_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  claim_id UUID NOT NULL REFERENCES progress_claims(id),
  boq_item_id UUID REFERENCES boq_items(id),
  description TEXT NOT NULL,
  quantity NUMERIC(15,2) NOT NULL DEFAULT 0,
  unit_price NUMERIC(15,2) NOT NULL DEFAULT 0,
  total NUMERIC(15,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS fixed_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  code VARCHAR(50) NOT NULL,
  category TEXT NOT NULL,
  purchase_date DATE NOT NULL,
  purchase_cost NUMERIC(15,2) NOT NULL DEFAULT 0,
  useful_life_years INTEGER NOT NULL DEFAULT 5,
  depreciation_rate NUMERIC(5,2) NOT NULL DEFAULT 20,
  depreciation_method TEXT DEFAULT 'straight_line' CHECK(depreciation_method IN ('straight_line', 'declining_balance')),
  accumulated_depreciation NUMERIC(15,2) NOT NULL DEFAULT 0,
  net_book_value NUMERIC(15,2) NOT NULL DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'disposed', 'fully_depreciated')),
  location TEXT,
  notes TEXT,
  journal_entry_id UUID REFERENCES journal_entries(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, code)
);

CREATE TABLE IF NOT EXISTS fiscal_years (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT DEFAULT 'open' CHECK(status IN ('open', 'closed')),
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, name)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  user_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  old_values JSONB,
  new_values JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  UNIQUE(company_id, key)
);

CREATE TABLE IF NOT EXISTS currencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  rate NUMERIC(15,6) NOT NULL DEFAULT 1,
  is_base BOOLEAN DEFAULT false,
  UNIQUE(company_id, code)
);

CREATE TABLE IF NOT EXISTS bank_reconciliation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  bank_safe_id UUID NOT NULL REFERENCES banks_safes(id),
  date DATE NOT NULL,
  closing_balance NUMERIC(15,2) NOT NULL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'completed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bank_reconciliation_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  reconciliation_id UUID NOT NULL REFERENCES bank_reconciliation(id),
  transaction_type TEXT NOT NULL,
  amount NUMERIC(15,2) NOT NULL,
  date DATE NOT NULL,
  is_cleared BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  email TEXT NOT NULL,
  ip_address TEXT,
  success BOOLEAN DEFAULT false,
  attempted_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID REFERENCES admin_users(id),
  action TEXT NOT NULL,
  details TEXT,
  ip_address TEXT,
  target_type TEXT,
  target_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES admin_users(id),
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id);
CREATE INDEX IF NOT EXISTS idx_accounts_company ON accounts(company_id);
CREATE INDEX IF NOT EXISTS idx_accounts_parent ON accounts(parent_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_company ON journal_entries(company_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries(date);
CREATE INDEX IF NOT EXISTS idx_journal_lines_entry ON journal_lines(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines(account_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_company ON journal_lines(company_id);
CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company_id);
CREATE INDEX IF NOT EXISTS idx_contacts_type ON contacts(type);
CREATE INDEX IF NOT EXISTS idx_projects_company ON projects(company_id);
CREATE INDEX IF NOT EXISTS idx_projects_client ON projects(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_company ON invoices(company_id);
CREATE INDEX IF NOT EXISTS idx_invoices_contact ON invoices(contact_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_banks_company ON banks_safes(company_id);
CREATE INDEX IF NOT EXISTS idx_voucher_receipts_company ON voucher_receipts(company_id);
CREATE INDEX IF NOT EXISTS idx_voucher_disbursements_company ON voucher_disbursements(company_id);
CREATE INDEX IF NOT EXISTS idx_cash_transactions_company ON cash_transactions(company_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_company ON inventory_items(company_id);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_company ON inventory_transactions(company_id);
CREATE INDEX IF NOT EXISTS idx_employees_company ON employees(company_id);
CREATE INDEX IF NOT EXISTS idx_fiscal_years_company ON fiscal_years(company_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_company ON audit_log(company_id);
CREATE INDEX IF NOT EXISTS idx_subcontractor_contracts_company ON subcontractor_contracts(company_id);
CREATE INDEX IF NOT EXISTS idx_fixed_assets_company ON fixed_assets(company_id);
CREATE INDEX IF NOT EXISTS idx_boq_items_project ON boq_items(project_id);
CREATE INDEX IF NOT EXISTS idx_progress_claims_project ON progress_claims(project_id);
CREATE INDEX IF NOT EXISTS idx_settings_company ON settings(company_id);
CREATE INDEX IF NOT EXISTS idx_currencies_company ON currencies(company_id);
CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts(email);
CREATE INDEX IF NOT EXISTS idx_bank_reconciliation_company ON bank_reconciliation(company_id);
CREATE INDEX IF NOT EXISTS idx_bank_reconciliation_items_recon ON bank_reconciliation_items(reconciliation_id);

-- 002: Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  user_id UUID REFERENCES users(id),
  type TEXT NOT NULL CHECK(type IN ('info', 'warning', 'success', 'error')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_company ON notifications(company_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(company_id, is_read) WHERE is_read = false;

-- 003: Subscriptions & billing
CREATE TABLE IF NOT EXISTS subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  duration_days INTEGER NOT NULL DEFAULT 30,
  price NUMERIC(15,2) NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'SAR',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add columns that may not exist in existing tables
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS price_monthly NUMERIC(15,2);
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS price_yearly NUMERIC(15,2);
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS max_users INTEGER DEFAULT 1;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS max_projects INTEGER;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS features JSONB DEFAULT '[]'::jsonb;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  plan_id UUID REFERENCES subscription_plans(id),
  plan_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'trial', 'expired', 'cancelled')),
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE NOT NULL,
  trial_end_date DATE,
  auto_renew BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id)
);

CREATE TABLE IF NOT EXISTS payment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  subscription_id UUID REFERENCES subscriptions(id),
  amount NUMERIC(15,2) NOT NULL,
  currency TEXT DEFAULT 'SAR',
  payment_method TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'failed', 'refunded')),
  transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activation_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  code TEXT UNIQUE NOT NULL,
  plan_code TEXT NOT NULL,
  duration_months INTEGER NOT NULL,
  is_used BOOLEAN DEFAULT false,
  used_by UUID REFERENCES companies(id),
  used_at TIMESTAMPTZ,
  expires_at DATE,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscription_plans_code ON subscription_plans(code);
CREATE INDEX IF NOT EXISTS idx_subscriptions_company ON subscriptions(company_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_activation_codes_code ON activation_codes(code);
CREATE INDEX IF NOT EXISTS idx_activation_codes_used ON activation_codes(is_used);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_subscription ON payment_transactions(subscription_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_target ON admin_audit_log(target_type, target_id);

-- Seed subscription plans
INSERT INTO subscription_plans (code, name, description, duration_days, price, price_monthly, price_yearly, currency, max_users, max_projects, features, sort_order)
SELECT * FROM (
  VALUES
    ('trial', 'تجريبي', 'نسخة تجريبية لمدة 30 يوماً', 30, 0, 0, 0, 'SAR', 1, 1, '["محاسبة متكاملة", "مستخدم واحد", "دعم فني"]'::jsonb, 1),
    ('starter', 'مبتدئ', 'للمحلات التجارية الصغيرة والمهنيين', 30, 99, 99, 990, 'SAR', 3, 5, '["محاسبة متكاملة", "3 مستخدمين", "5 مشاريع", "فواتير", "تقارير", "دعم فني"]'::jsonb, 2),
    ('professional', 'احترافي', 'للشركات المتوسطة', 30, 199, 199, 1990, 'SAR', 10, 50, '["محاسبة متكاملة", "10 مستخدمين", "50 مشروع", "فواتير ومشتريات", "تقارير مالية", "مخزون", "رواتب", "أصول ثابتة", "دعم فني"]'::jsonb, 3),
    ('enterprise', 'مؤسسات', 'للشركات الكبيرة والمؤسسات', 30, 499, 499, 4990, 'SAR', 50, -1, '["محاسبة متكاملة", "50+ مستخدم", "غير محدود مشاريع", "جميع الميزات", "دعم فني متميز", "استضافة خاصة"]'::jsonb, 4)
) AS s(code, name, description, duration_days, price, price_monthly, price_yearly, currency, max_users, max_projects, features, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM subscription_plans WHERE code = s.code);

-- 004: Admin sessions columns
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS telegram_code TEXT;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS telegram_code_expires TIMESTAMPTZ;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS master_verified BOOLEAN DEFAULT false;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS login_session_data JSONB;

-- 005: Auth extras (password reset)
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens(token);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);

-- 006: Features (messages, complaints, visitors, ads)
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  admin_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  direction TEXT CHECK (direction IN ('admin_to_company', 'company_to_admin')) NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_company ON messages(company_id);
CREATE INDEX IF NOT EXISTS idx_messages_admin ON messages(admin_id);
CREATE INDEX IF NOT EXISTS idx_messages_read ON messages(company_id, is_read);

CREATE TABLE IF NOT EXISTS complaints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  type TEXT CHECK (type IN ('complaint', 'suggestion')) NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT CHECK (status IN ('pending', 'read', 'replied', 'closed')) DEFAULT 'pending',
  admin_reply TEXT,
  replied_at TIMESTAMPTZ,
  replied_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_complaints_company ON complaints(company_id);
CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status);

CREATE TABLE IF NOT EXISTS visitor_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address TEXT,
  user_agent TEXT,
  path TEXT,
  referrer TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_visitor_logs_date ON visitor_logs(created_at);

CREATE TABLE IF NOT EXISTS visitor_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE UNIQUE NOT NULL,
  visits INTEGER DEFAULT 0,
  unique_visitors INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS advertisements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  type TEXT CHECK (type IN ('announcement', 'banner', 'promotion')) DEFAULT 'announcement',
  is_active BOOLEAN DEFAULT TRUE,
  starts_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  link_url TEXT,
  link_text TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_advertisements_active ON advertisements(is_active, starts_at, expires_at);

-- Migration tracking
CREATE TABLE IF NOT EXISTS _migrations (
  id SERIAL PRIMARY KEY,
  filename TEXT NOT NULL UNIQUE,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO _migrations (filename) VALUES
  ('001-schema.sql'),
  ('002-notifications.sql'),
  ('003-subscriptions.sql'),
  ('004-admin-sessions.sql'),
  ('005-auth-extras.sql'),
  ('006-features.sql')
ON CONFLICT (filename) DO NOTHING;
