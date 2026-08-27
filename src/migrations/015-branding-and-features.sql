-- White-Label / Multi-Brand: Add branding columns to companies table
ALTER TABLE companies ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS primary_color TEXT DEFAULT '#2563eb';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS secondary_color TEXT DEFAULT '#64748b';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS accent_color TEXT DEFAULT '#f59e0b';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS invoice_template TEXT DEFAULT 'modern' CHECK(invoice_template IN ('modern', 'classic', 'minimal'));
ALTER TABLE companies ADD COLUMN IF NOT EXISTS footer_text TEXT DEFAULT '';

-- Bank reconciliation: Add columns for imported bank transactions
CREATE TABLE IF NOT EXISTS bank_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  bank_safe_id UUID REFERENCES banks_safes(id),
  file_name TEXT NOT NULL,
  file_format TEXT NOT NULL CHECK(file_format IN ('ofx', 'mt940', 'csv')),
  transactions_count INT NOT NULL DEFAULT 0,
  matched_count INT NOT NULL DEFAULT 0,
  imported_at TIMESTAMPTZ DEFAULT NOW(),
  imported_by UUID REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS bank_import_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id UUID NOT NULL REFERENCES bank_imports(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id),
  bank_date DATE NOT NULL,
  amount NUMERIC(15,2) NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('credit', 'debit')),
  description TEXT,
  reference TEXT,
  bank_ref TEXT,
  balance_after NUMERIC(15,2),
  matched_journal_entry_id UUID REFERENCES journal_entries(id),
  match_confidence INT DEFAULT 0,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'matched', 'ignored', 'created')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for bank import performance
CREATE INDEX IF NOT EXISTS idx_bank_imports_company ON bank_imports(company_id);
CREATE INDEX IF NOT EXISTS idx_bank_import_txns_import ON bank_import_transactions(import_id);
CREATE INDEX IF NOT EXISTS idx_bank_import_txns_company ON bank_import_transactions(company_id);
CREATE INDEX IF NOT EXISTS idx_bank_import_txns_date ON bank_import_transactions(bank_date);
