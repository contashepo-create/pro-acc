-- Migration 008: Flexible Subscription System with Upgrade Requests, Payment Methods, and Limits

-- 1. Enhance subscription_plans with flexible features
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS description_ar TEXT;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS price_monthly NUMERIC(10,2) DEFAULT 0;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS price_yearly NUMERIC(10,2);
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS yearly_discount_percent INT DEFAULT 0;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS trial_days INT DEFAULT 7;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS max_users INT DEFAULT 1;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS max_clients INT DEFAULT 10;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS max_suppliers INT DEFAULT 10;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS max_employees INT DEFAULT 5;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS max_projects INT DEFAULT 2;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS max_invoices_per_month INT DEFAULT 50;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS max_storage_mb INT DEFAULT 100;

-- Flexible features as JSONB: which modules are enabled
-- Example: {"dashboard": true, "invoices": true, "projects": true, "inventory": false, ...}
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS features_modules JSONB DEFAULT '{}';
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS sort_order INT DEFAULT 0;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Update existing plans with sensible defaults
UPDATE subscription_plans SET 
  trial_days = 7,
  yearly_discount_percent = 20,
  features_modules = '{"dashboard": true, "accounts": true, "journal": true, "invoices": true, "clients": true, "reports": true, "settings": true}'::jsonb
WHERE trial_days IS NULL OR features_modules IS NULL;

-- 2. Payment Methods table (controlled via admin)
CREATE TABLE IF NOT EXISTS payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE, -- instapay, orange_cash, bank_transfer
  name_ar TEXT NOT NULL,
  name_en TEXT,
  description TEXT,
  account_number TEXT,
  account_name TEXT,
  instructions TEXT,
  is_active BOOLEAN DEFAULT true,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO payment_methods (code, name_ar, name_en, account_number, account_name, instructions, is_active)
VALUES 
  ('instapay', 'انستا باي', 'InstaPay', '', '', 'حول المبلغ ثم ارفق صورة الإيصال', true),
  ('orange_cash', 'أورنج كاش', 'Orange Cash', '', '', 'حول المبلغ ثم ارفق صورة الإيصال', true),
  ('bank_transfer', 'تحويل بنكي', 'Bank Transfer', '', '', 'حول المبلغ ثم ارفق صورة الإيصال', true)
ON CONFLICT (code) DO NOTHING;

-- 3. Upgrade Requests table
CREATE TABLE IF NOT EXISTS upgrade_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  current_plan_id UUID REFERENCES subscription_plans(id),
  requested_plan_id UUID NOT NULL REFERENCES subscription_plans(id),
  duration_type TEXT NOT NULL CHECK (duration_type IN ('monthly', 'yearly')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  payment_method_code TEXT REFERENCES payment_methods(code),
  payment_amount NUMERIC(10,2),
  payment_date DATE,
  payment_time TIME,
  receipt_image_url TEXT,
  receipt_text TEXT,
  notes TEXT,
  admin_notes TEXT,
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_upgrade_requests_company ON upgrade_requests(company_id);
CREATE INDEX IF NOT EXISTS idx_upgrade_requests_status ON upgrade_requests(status);
CREATE INDEX IF NOT EXISTS idx_upgrade_requests_created ON upgrade_requests(created_at DESC);

-- 4. Company limits tracking
CREATE TABLE IF NOT EXISTS company_usage_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE UNIQUE,
  current_users INT DEFAULT 1,
  current_clients INT DEFAULT 0,
  current_suppliers INT DEFAULT 0,
  current_employees INT DEFAULT 0,
  current_projects INT DEFAULT 0,
  invoices_this_month INT DEFAULT 0,
  last_reset_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Backup logs with HMAC verification
CREATE TABLE IF NOT EXISTS backup_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  backup_type TEXT NOT NULL CHECK (backup_type IN ('json', 'csv', 'excel')),
  file_hash TEXT NOT NULL, -- SHA256 of file
  hmac_signature TEXT NOT NULL, -- HMAC-SHA256 with server secret
  file_size INT,
  includes_tables TEXT[], -- list of tables included
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days'
);

CREATE INDEX IF NOT EXISTS idx_backup_logs_company ON backup_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_backup_logs_hash ON backup_logs(file_hash);

-- 6. Extend subscriptions table for trial extension
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS trial_extended BOOLEAN DEFAULT false;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS trial_extended_by UUID REFERENCES users(id);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS trial_extended_at TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS original_end_date DATE;

-- 7. Advertisements verification (ensure it works)
ALTER TABLE advertisements ADD COLUMN IF NOT EXISTS view_count INT DEFAULT 0;
ALTER TABLE advertisements ADD COLUMN IF NOT EXISTS click_count INT DEFAULT 0;

-- 8. Messages system check - ensure table exists
CREATE TABLE IF NOT EXISTS company_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  subject TEXT,
  body TEXT NOT NULL,
  type TEXT DEFAULT 'complaint' CHECK (type IN ('complaint', 'support', 'upgrade', 'payment')),
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'replied', 'closed')),
  admin_reply TEXT,
  replied_by UUID REFERENCES users(id),
  replied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_company_messages_company ON company_messages(company_id);
CREATE INDEX IF NOT EXISTS idx_company_messages_status ON company_messages(status);

-- 9. Ensure companies have phone for backup verification
ALTER TABLE companies ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT false;

-- 10. Security: Add audit log for sensitive operations
CREATE TABLE IF NOT EXISTS security_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  user_id UUID REFERENCES users(id),
  action TEXT NOT NULL, -- backup_download, backup_upload, upgrade_request, plan_change, etc.
  details JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_audit_company ON security_audit_log(company_id);
CREATE INDEX IF NOT EXISTS idx_security_audit_action ON security_audit_log(action);

-- 11. Update trial to 7 days (was 30)
-- This will be handled in application logic, but we set default for new plans

-- 12. Insert default plans if not exist
INSERT INTO subscription_plans (code, name, description_ar, price_monthly, price_yearly, yearly_discount_percent, trial_days, max_users, max_clients, max_suppliers, max_employees, max_projects, max_invoices_per_month, features_modules, is_active, sort_order)
VALUES 
  ('trial', 'تجريبي', 'باقة تجريبية لمدة 7 أيام', 0, 0, 0, 7, 1, 10, 10, 5, 2, 20, '{"dashboard": true, "accounts": true, "journal": true, "invoices": true, "clients": true, "reports": true, "settings": true, "subscription": true}'::jsonb, true, 0),
  ('basic', 'أساسية', 'الباقة الأساسية للشركات الصغيرة', 199, 1990, 20, 0, 3, 50, 50, 20, 10, 200, '{"dashboard": true, "accounts": true, "journal": true, "invoices": true, "clients": true, "contacts": true, "banks": true, "reports": true, "settings": true, "subscription": true}'::jsonb, true, 1),
  ('pro', 'احترافية', 'الباقة الاحترافية للشركات المتوسطة', 399, 3990, 20, 0, 10, 200, 200, 100, 50, 1000, '{"dashboard": true, "accounts": true, "journal": true, "invoices": true, "clients": true, "contacts": true, "banks": true, "cash": true, "projects": true, "reports": true, "inventory": true, "purchases": true, "employees": true, "settings": true, "subscription": true}'::jsonb, true, 2),
  ('enterprise', 'مؤسسات', 'باقة المؤسسات الكبيرة بدون قيود', 799, 7990, 20, 0, 999, 9999, 9999, 9999, 9999, 99999, '{"dashboard": true, "accounts": true, "journal": true, "invoices": true, "clients": true, "contacts": true, "banks": true, "cash": true, "projects": true, "reports": true, "inventory": true, "purchases": true, "employees": true, "payroll": true, "fixed-assets": true, "subcontractors": true, "boq": true, "progress-billing": true, "settings": true, "subscription": true, "backup": true}'::jsonb, true, 3)
ON CONFLICT (code) DO UPDATE SET
  description_ar = EXCLUDED.description_ar,
  yearly_discount_percent = EXCLUDED.yearly_discount_percent,
  features_modules = EXCLUDED.features_modules,
  updated_at = NOW();

-- Done
SELECT 'Migration 008 completed - Flexible subscription system' as result;
