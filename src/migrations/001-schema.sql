-- ============================================================
-- AccWeb PostgreSQL Schema — Migration 001
-- Multi-tenant accounting system
-- ============================================================

BEGIN;

-- 1. admin_users (global, no company_id)
CREATE TABLE admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  master_password_hash TEXT NOT NULL,
  telegram_chat_id TEXT NOT NULL,
  telegram_bot_token TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'Admin',
  is_active BOOLEAN DEFAULT true,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. companies
CREATE TABLE companies (
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

-- 3. users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin', 'accountant', 'manager', 'supervisor')),
  is_active BOOLEAN DEFAULT true,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, email)
);

-- 4. accounts
CREATE TABLE accounts (
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

-- 5. journal_sequences
CREATE TABLE journal_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  year INTEGER NOT NULL,
  last_number INTEGER NOT NULL DEFAULT 0,
  UNIQUE(company_id, year)
);

-- 6. journal_entries
CREATE TABLE journal_entries (
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

-- 7. journal_lines
CREATE TABLE journal_lines (
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

-- 8. contacts
CREATE TABLE contacts (
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

-- 9. projects
CREATE TABLE projects (
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

-- 10. invoices
CREATE TABLE invoices (
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

-- 11. invoice_items
CREATE TABLE invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  description TEXT NOT NULL,
  quantity NUMERIC(15,2) NOT NULL DEFAULT 1,
  unit_price NUMERIC(15,2) NOT NULL DEFAULT 0,
  total NUMERIC(15,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. banks_safes
CREATE TABLE banks_safes (
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

-- 13. voucher_receipts
CREATE TABLE voucher_receipts (
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

-- 14. voucher_disbursements
CREATE TABLE voucher_disbursements (
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

-- 15. receipt_invoice_items (references voucher_receipts + invoices — both already defined)
CREATE TABLE receipt_invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  voucher_receipt_id UUID NOT NULL REFERENCES voucher_receipts(id),
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  amount NUMERIC(15,2) NOT NULL,
  journal_entry_id UUID REFERENCES journal_entries(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 16. cash_transactions
CREATE TABLE cash_transactions (
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

-- 17. transaction_categories
CREATE TABLE transaction_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('revenue', 'expense')),
  is_active BOOLEAN DEFAULT true,
  UNIQUE(company_id, name)
);

-- 18. warehouses
CREATE TABLE warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  location TEXT,
  is_active BOOLEAN DEFAULT true,
  UNIQUE(company_id, name)
);

-- 19. inventory_items
CREATE TABLE inventory_items (
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

-- 20. inventory_transactions
CREATE TABLE inventory_transactions (
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

-- 21. employees
CREATE TABLE employees (
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

-- 22. employee_advances
CREATE TABLE employee_advances (
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

-- 23. payroll
CREATE TABLE payroll (
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

-- 24. salary_sheets
CREATE TABLE salary_sheets (
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

-- 25. salary_items
CREATE TABLE salary_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  sheet_id UUID NOT NULL REFERENCES salary_sheets(id),
  employee_id UUID NOT NULL REFERENCES employees(id),
  basic_salary NUMERIC(15,2) DEFAULT 0,
  allowances NUMERIC(15,2) DEFAULT 0,
  deductions NUMERIC(15,2) DEFAULT 0,
  net_pay NUMERIC(15,2) DEFAULT 0
);

-- 26. daily_workers
CREATE TABLE daily_workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  phone TEXT,
  daily_wage NUMERIC(15,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 27. daily_worker_records
CREATE TABLE daily_worker_records (
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

-- 28. daily_worker_settlements
CREATE TABLE daily_worker_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  worker_id UUID NOT NULL REFERENCES daily_workers(id),
  amount NUMERIC(15,2) NOT NULL,
  date DATE NOT NULL,
  journal_entry_id UUID REFERENCES journal_entries(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 29. custodies
CREATE TABLE custodies (
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

-- 30. custody_settlements
CREATE TABLE custody_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  custody_id UUID NOT NULL REFERENCES custodies(id),
  amount NUMERIC(15,2) NOT NULL,
  date DATE NOT NULL,
  journal_entry_id UUID REFERENCES journal_entries(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 31. custody_deposits
CREATE TABLE custody_deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  custody_id UUID NOT NULL REFERENCES custodies(id),
  amount NUMERIC(15,2) NOT NULL,
  date DATE NOT NULL,
  bank_safe_id UUID REFERENCES banks_safes(id),
  journal_entry_id UUID REFERENCES journal_entries(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 32. subcontractor_contracts
CREATE TABLE subcontractor_contracts (
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

-- 33. subcontractor_certificates
CREATE TABLE subcontractor_certificates (
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

-- 34. subcontractor_payments
CREATE TABLE subcontractor_payments (
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

-- 35. purchase_orders
CREATE TABLE purchase_orders (
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

-- 36. purchase_order_items
CREATE TABLE purchase_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id),
  description TEXT NOT NULL,
  quantity NUMERIC(15,2) NOT NULL DEFAULT 1,
  received_quantity NUMERIC(15,2) NOT NULL DEFAULT 0,
  unit_price NUMERIC(15,2) NOT NULL DEFAULT 0,
  total NUMERIC(15,2) NOT NULL DEFAULT 0
);

-- 37. purchase_invoices
CREATE TABLE purchase_invoices (
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

-- 38. purchase_invoice_items
CREATE TABLE purchase_invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  purchase_invoice_id UUID NOT NULL REFERENCES purchase_invoices(id),
  description TEXT NOT NULL,
  quantity NUMERIC(15,2) NOT NULL DEFAULT 1,
  unit_price NUMERIC(15,2) NOT NULL DEFAULT 0,
  total NUMERIC(15,2) NOT NULL DEFAULT 0
);

-- 39. disbursement_invoice_items (now after purchase_invoices + purchase_invoice_items)
CREATE TABLE disbursement_invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  voucher_disbursement_id UUID NOT NULL REFERENCES voucher_disbursements(id),
  purchase_invoice_id UUID REFERENCES purchase_invoices(id),
  amount NUMERIC(15,2) NOT NULL,
  journal_entry_id UUID REFERENCES journal_entries(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 40. quotations
CREATE TABLE quotations (
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

-- 41. quotation_items
CREATE TABLE quotation_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  quotation_id UUID NOT NULL REFERENCES quotations(id),
  description TEXT NOT NULL,
  quantity NUMERIC(15,2) NOT NULL DEFAULT 1,
  unit_price NUMERIC(15,2) NOT NULL DEFAULT 0,
  total NUMERIC(15,2) NOT NULL DEFAULT 0
);

-- 42. boq_items
CREATE TABLE boq_items (
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

-- 43. progress_claims
CREATE TABLE progress_claims (
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

-- 44. progress_claim_items
CREATE TABLE progress_claim_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  claim_id UUID NOT NULL REFERENCES progress_claims(id),
  boq_item_id UUID REFERENCES boq_items(id),
  description TEXT NOT NULL,
  quantity NUMERIC(15,2) NOT NULL DEFAULT 0,
  unit_price NUMERIC(15,2) NOT NULL DEFAULT 0,
  total NUMERIC(15,2) NOT NULL DEFAULT 0
);

-- 45. fixed_assets
CREATE TABLE fixed_assets (
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

-- 46. fiscal_years
CREATE TABLE fiscal_years (
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

-- 47. audit_log
CREATE TABLE audit_log (
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

-- 48. settings
CREATE TABLE settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  UNIQUE(company_id, key)
);

-- 49. currencies
CREATE TABLE currencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  rate NUMERIC(15,6) NOT NULL DEFAULT 1,
  is_base BOOLEAN DEFAULT false,
  UNIQUE(company_id, code)
);

-- 50. bank_reconciliation
CREATE TABLE bank_reconciliation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  bank_safe_id UUID NOT NULL REFERENCES banks_safes(id),
  date DATE NOT NULL,
  closing_balance NUMERIC(15,2) NOT NULL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'completed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 51. bank_reconciliation_items
CREATE TABLE bank_reconciliation_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  reconciliation_id UUID NOT NULL REFERENCES bank_reconciliation(id),
  transaction_type TEXT NOT NULL,
  amount NUMERIC(15,2) NOT NULL,
  date DATE NOT NULL,
  is_cleared BOOLEAN DEFAULT false
);

-- 52. login_attempts
CREATE TABLE login_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  email TEXT NOT NULL,
  ip_address TEXT,
  success BOOLEAN DEFAULT false,
  attempted_at TIMESTAMPTZ DEFAULT NOW()
);

-- 53. admin_audit_log (admin panel, no company_id)
CREATE TABLE admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID REFERENCES admin_users(id),
  action TEXT NOT NULL,
  details TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 54. admin_sessions
CREATE TABLE admin_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES admin_users(id),
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX idx_users_company ON users(company_id);
CREATE INDEX idx_accounts_company ON accounts(company_id);
CREATE INDEX idx_accounts_parent ON accounts(parent_id);
CREATE INDEX idx_journal_entries_company ON journal_entries(company_id);
CREATE INDEX idx_journal_entries_date ON journal_entries(date);
CREATE INDEX idx_journal_lines_entry ON journal_lines(journal_entry_id);
CREATE INDEX idx_journal_lines_account ON journal_lines(account_id);
CREATE INDEX idx_journal_lines_company ON journal_lines(company_id);
CREATE INDEX idx_contacts_company ON contacts(company_id);
CREATE INDEX idx_contacts_type ON contacts(type);
CREATE INDEX idx_projects_company ON projects(company_id);
CREATE INDEX idx_projects_client ON projects(client_id);
CREATE INDEX idx_invoices_company ON invoices(company_id);
CREATE INDEX idx_invoices_contact ON invoices(contact_id);
CREATE INDEX idx_invoice_items_invoice ON invoice_items(invoice_id);
CREATE INDEX idx_banks_company ON banks_safes(company_id);
CREATE INDEX idx_voucher_receipts_company ON voucher_receipts(company_id);
CREATE INDEX idx_voucher_disbursements_company ON voucher_disbursements(company_id);
CREATE INDEX idx_cash_transactions_company ON cash_transactions(company_id);
CREATE INDEX idx_inventory_items_company ON inventory_items(company_id);
CREATE INDEX idx_inventory_transactions_company ON inventory_transactions(company_id);
CREATE INDEX idx_employees_company ON employees(company_id);
CREATE INDEX idx_fiscal_years_company ON fiscal_years(company_id);
CREATE INDEX idx_audit_log_company ON audit_log(company_id);
CREATE INDEX idx_subcontractor_contracts_company ON subcontractor_contracts(company_id);
CREATE INDEX idx_fixed_assets_company ON fixed_assets(company_id);
CREATE INDEX idx_boq_items_project ON boq_items(project_id);
CREATE INDEX idx_progress_claims_project ON progress_claims(project_id);
CREATE INDEX idx_settings_company ON settings(company_id);
CREATE INDEX idx_currencies_company ON currencies(company_id);
CREATE INDEX idx_login_attempts_email ON login_attempts(email);
CREATE INDEX idx_bank_reconciliation_company ON bank_reconciliation(company_id);
CREATE INDEX idx_bank_reconciliation_items_recon ON bank_reconciliation_items(reconciliation_id);

-- ============================================================
-- Row-Level Security (RLS)
-- ============================================================

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE banks_safes ENABLE ROW LEVEL SECURITY;
ALTER TABLE voucher_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE voucher_disbursements ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE disbursement_invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_advances ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll ENABLE ROW LEVEL SECURITY;
ALTER TABLE salary_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE salary_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_worker_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_worker_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE custodies ENABLE ROW LEVEL SECURITY;
ALTER TABLE custody_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE custody_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE subcontractor_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE subcontractor_certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE subcontractor_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE boq_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE progress_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE progress_claim_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE fixed_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE currencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_reconciliation ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_reconciliation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Migration tracking
-- ============================================================

CREATE TABLE IF NOT EXISTS _migrations (
  id SERIAL PRIMARY KEY,
  filename TEXT NOT NULL UNIQUE,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- run_migration() function
-- ============================================================

CREATE OR REPLACE FUNCTION run_migration(
  p_filename TEXT,
  p_sql TEXT
) RETURNS TEXT AS $$
DECLARE
  v_exists BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM _migrations WHERE filename = p_filename) INTO v_exists;
  IF v_exists THEN
    RETURN 'skipped: ' || p_filename || ' already applied';
  END IF;
  EXECUTE p_sql;
  INSERT INTO _migrations (filename) VALUES (p_filename);
  RETURN 'applied: ' || p_filename;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- run_all_migrations() function
-- ============================================================

CREATE OR REPLACE FUNCTION run_all_migrations(
  p_migrations JSONB
) RETURNS TABLE(filename TEXT, status TEXT) AS $$
DECLARE
  v_migration JSONB;
BEGIN
  FOR v_migration IN SELECT * FROM jsonb_array_elements(p_migrations)
  LOOP
    SELECT run_migration(
      v_migration->>'filename',
      v_migration->>'sql'
    ) INTO status;
    filename := v_migration->>'filename';
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMIT;
