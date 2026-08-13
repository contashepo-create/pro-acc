-- ============================================================
-- 042 - Remaining missing tables/columns after static audit
--
-- Adds tables/columns the API writes that were not captured in
-- previous migrations:
--   - ad_views / ad_clicks (authenticated ad tracking)
--   - project_expenses (project-cash expenses with JE)
--   - progress_billing (separate from legacy progress_claims)
--   - custom_modules / custom_actions (RBAC customizations)
--   - user_permissions (per-user permission overrides)
--   - invoice_payments / payment_disbursements (approval helper targets)
--   - minor missing columns (bonds.released, date aliases, etc.)
--
-- Idempotent.
-- ============================================================

BEGIN;

-- ---------------- ad tracking ----------------
CREATE TABLE IF NOT EXISTS ad_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  advertisement_id UUID NOT NULL REFERENCES advertisements(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ip_address TEXT,
  user_agent TEXT,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ad_views_ad      ON ad_views(advertisement_id);
CREATE INDEX IF NOT EXISTS idx_ad_views_company ON ad_views(company_id);
CREATE INDEX IF NOT EXISTS idx_ad_views_user    ON ad_views(user_id);

CREATE TABLE IF NOT EXISTS ad_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  advertisement_id UUID NOT NULL REFERENCES advertisements(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ip_address TEXT,
  user_agent TEXT,
  clicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ad_clicks_ad      ON ad_clicks(advertisement_id);
CREATE INDEX IF NOT EXISTS idx_ad_clicks_company ON ad_clicks(company_id);
CREATE INDEX IF NOT EXISTS idx_ad_clicks_user    ON ad_clicks(user_id);

-- ---------------- custom RBAC ----------------
CREATE TABLE IF NOT EXISTS custom_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_en TEXT,
  icon TEXT DEFAULT '📁',
  group_name TEXT NOT NULL DEFAULT 'custom',
  code TEXT NOT NULL,
  is_system BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  sort_order INT NOT NULL DEFAULT 100,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, code)
);
CREATE INDEX IF NOT EXISTS idx_custom_modules_company ON custom_modules(company_id);

CREATE TABLE IF NOT EXISTS custom_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  module_id UUID REFERENCES custom_modules(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_en TEXT,
  icon TEXT DEFAULT '⚡',
  code TEXT NOT NULL,
  is_system BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  sort_order INT NOT NULL DEFAULT 100,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, code)
);
CREATE INDEX IF NOT EXISTS idx_custom_actions_company ON custom_actions(company_id);
CREATE INDEX IF NOT EXISTS idx_custom_actions_module  ON custom_actions(module_id);

CREATE TABLE IF NOT EXISTS user_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module TEXT,
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  bypass_telegram_confirmation BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, user_id, module)
);
CREATE INDEX IF NOT EXISTS idx_user_permissions_company ON user_permissions(company_id);
CREATE INDEX IF NOT EXISTS idx_user_permissions_user    ON user_permissions(user_id);

-- ---------------- project_expenses ----------------
CREATE TABLE IF NOT EXISTS project_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  expense_type TEXT NOT NULL DEFAULT 'general',
  description TEXT,
  amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  contact_id UUID REFERENCES contacts(id),
  account_code TEXT,
  notes TEXT,
  tax_rate NUMERIC(5,2) DEFAULT 0,
  tax_amount NUMERIC(15,2) DEFAULT 0,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','pending','approved','posted','rejected')),
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES users(id),
  journal_entry_id UUID REFERENCES journal_entries(id),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_project_expenses_company ON project_expenses(company_id);
CREATE INDEX IF NOT EXISTS idx_project_expenses_project ON project_expenses(project_id);
CREATE INDEX IF NOT EXISTS idx_project_expenses_date    ON project_expenses(date);

-- ---------------- progress_billing (new style) ----------------
CREATE TABLE IF NOT EXISTS progress_billing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  claim_number TEXT NOT NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  description TEXT,
  gross_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  retention_rate NUMERIC(5,4) DEFAULT 0,
  retention_amount NUMERIC(15,2) DEFAULT 0,
  net_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(5,4) DEFAULT 0,
  tax_amount NUMERIC(15,2) DEFAULT 0,
  is_final BOOLEAN DEFAULT false,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','approved','paid','cancelled')),
  journal_entry_id UUID REFERENCES journal_entries(id),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, claim_number)
);
CREATE INDEX IF NOT EXISTS idx_progress_billing_company ON progress_billing(company_id);
CREATE INDEX IF NOT EXISTS idx_progress_billing_project ON progress_billing(project_id);
CREATE INDEX IF NOT EXISTS idx_progress_billing_date    ON progress_billing(date);

-- ---------------- invoice_payments / payment_disbursements (approval targets) ----------------
CREATE TABLE IF NOT EXISTS invoice_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_method TEXT,
  reference TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','posted','rejected')),
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES users(id),
  journal_entry_id UUID REFERENCES journal_entries(id),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_company ON invoice_payments(company_id);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments(invoice_id);

CREATE TABLE IF NOT EXISTS payment_disbursements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  voucher_id UUID REFERENCES voucher_disbursements(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id),
  amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_method TEXT,
  reference TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','posted','rejected')),
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES users(id),
  journal_entry_id UUID REFERENCES journal_entries(id),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payment_disb_company ON payment_disbursements(company_id);
CREATE INDEX IF NOT EXISTS idx_payment_disb_voucher ON payment_disbursements(voucher_id);

-- ---------------- minor aliases/columns ----------------
-- bonds.released status
ALTER TABLE bonds ADD COLUMN IF NOT EXISTS is_released BOOLEAN DEFAULT false;
ALTER TABLE bonds ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ;

-- audit/security log date aliases (some code writes 'date' or 'timestamp'/'size'/'type')
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS event_date TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE security_audit_log ADD COLUMN IF NOT EXISTS event_date TIMESTAMPTZ DEFAULT NOW();
-- Aliases
ALTER TABLE security_audit_log ADD COLUMN IF NOT EXISTS upload_size BIGINT;
ALTER TABLE security_audit_log ADD COLUMN IF NOT EXISTS upload_type TEXT;
ALTER TABLE petty_cash_reconciliation ADD COLUMN IF NOT EXISTS is_balanced BOOLEAN
  GENERATED ALWAYS AS (status = 'balanced') STORED;
ALTER TABLE reminder_log ADD COLUMN IF NOT EXISTS sent BOOLEAN DEFAULT false;

-- Ensure visitors log exists (public ad tracking)
CREATE TABLE IF NOT EXISTS visitor_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  ip_address TEXT,
  user_agent TEXT,
  path TEXT,
  visited_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_visitor_logs_company ON visitor_logs(company_id);

CREATE TABLE IF NOT EXISTS visitor_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  stat_date DATE NOT NULL DEFAULT CURRENT_DATE,
  visits INT NOT NULL DEFAULT 0,
  unique_visitors INT NOT NULL DEFAULT 0,
  UNIQUE(company_id, stat_date)
);

COMMIT;

SELECT 'Migration 042 completed — remaining missing tables/columns added' AS result;


-- ---------------- final aliases (idempotent via DO) ----------------
DO $$
BEGIN
  -- 'date' / 'timestamp' columns used by some backup/depreciation audit inserts
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='financial_audit_log' AND column_name='event_date') THEN
    ALTER TABLE financial_audit_log ADD COLUMN event_date TIMESTAMPTZ DEFAULT NOW();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='audit_log' AND column_name='event_date') THEN
    ALTER TABLE audit_log ADD COLUMN event_date TIMESTAMPTZ DEFAULT NOW();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='security_audit_log' AND column_name='event_date') THEN
    ALTER TABLE security_audit_log ADD COLUMN event_date TIMESTAMPTZ DEFAULT NOW();
  END IF;

  -- 'released' status alias on bonds (boolean mirror of is_released)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bonds' AND column_name='released') THEN
    ALTER TABLE bonds ADD COLUMN released BOOLEAN DEFAULT false;
  END IF;

  -- 'balanced' alias (mirrors is_balanced)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='petty_cash_reconciliation' AND column_name='balanced') THEN
    ALTER TABLE petty_cash_reconciliation ADD COLUMN balanced BOOLEAN DEFAULT false;
  END IF;
END $$;
