-- Migration 016: Payment Gateway, Reminders, Customer Portal, Contracts

-- ===== PAYMENT RECORDS =====
CREATE TABLE IF NOT EXISTS payment_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  invoice_id UUID REFERENCES invoices(id),
  payment_gateway_id TEXT,           -- Moyasar/Stripe payment ID
  amount NUMERIC(15,2) NOT NULL,
  currency TEXT DEFAULT 'SAR',
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'authorized', 'paid', 'refunded', 'failed', 'cancelled')),
  customer_name TEXT,
  customer_email TEXT,
  payment_url TEXT,
  gateway_response TEXT,             -- Raw JSON response from gateway
  journal_entry_id UUID REFERENCES journal_entries(id),
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payment_records_company ON payment_records(company_id);
CREATE INDEX IF NOT EXISTS idx_payment_records_invoice ON payment_records(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payment_records_status ON payment_records(status);

-- ===== REMINDER LOG =====
CREATE TABLE IF NOT EXISTS reminder_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  invoice_id UUID REFERENCES invoices(id),
  customer_name TEXT,
  channel TEXT CHECK(channel IN ('whatsapp', 'email', 'telegram', 'sms', 'auto')),
  status TEXT DEFAULT 'sent' CHECK(status IN ('sent', 'failed', 'pending')),
  message_url TEXT,
  error TEXT,
  sent_by UUID REFERENCES users(id),
  sent_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reminder_log_company ON reminder_log(company_id);
CREATE INDEX IF NOT EXISTS idx_reminder_log_invoice ON reminder_log(invoice_id);

-- ===== PORTAL ACCESS LOG =====
CREATE TABLE IF NOT EXISTS portal_access_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  contact_id UUID,
  email TEXT,
  accessed_at TIMESTAMPTZ DEFAULT NOW(),
  ip_address TEXT
);
CREATE INDEX IF NOT EXISTS idx_portal_access_company ON portal_access_log(company_id);
CREATE INDEX IF NOT EXISTS idx_portal_access_email ON portal_access_log(email);

-- ===== CONTRACTS =====
CREATE TABLE IF NOT EXISTS contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  title TEXT NOT NULL,
  type TEXT DEFAULT 'general' CHECK(type IN ('general', 'client', 'subcontractor', 'supplier', 'employee', 'lease', 'insurance', 'bond')),
  project_id UUID REFERENCES projects(id),
  contact_id UUID REFERENCES contacts(id),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  value NUMERIC(15,2) DEFAULT 0,
  description TEXT,
  status TEXT DEFAULT 'active' CHECK(status IN ('draft', 'active', 'expired', 'terminated', 'completed')),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contracts_company ON contracts(company_id);
CREATE INDEX IF NOT EXISTS idx_contracts_project ON contracts(project_id);
CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status);
CREATE INDEX IF NOT EXISTS idx_contracts_end_date ON contracts(end_date);

-- ===== CONTRACT DOCUMENTS =====
CREATE TABLE IF NOT EXISTS contract_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id),
  filename TEXT NOT NULL,
  content_type TEXT DEFAULT 'application/octet-stream',
  file_data TEXT,              -- Base64 encoded (for simplicity; use Storage for large files)
  file_size INTEGER DEFAULT 0,
  description TEXT,
  uploaded_by UUID REFERENCES users(id),
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contract_docs_contract ON contract_documents(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_docs_company ON contract_documents(company_id);

-- Add paid_at column to invoices for payment tracking
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'cash';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS contact_email TEXT;
