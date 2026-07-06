-- Migration 003: Subscription & billing tables (consolidated)
-- Combines 003-subscriptions.sql and 003-admin-tables.sql

-- 1. subscription_plans
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

-- 2. subscriptions
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

-- 3. payment_transactions
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

-- 4. activation_codes
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

-- 5. Add updated_at to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 6. Add target_type and target_id to admin_audit_log
ALTER TABLE admin_audit_log ADD COLUMN IF NOT EXISTS target_type TEXT;
ALTER TABLE admin_audit_log ADD COLUMN IF NOT EXISTS target_id TEXT;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_subscription_plans_code ON subscription_plans(code);
CREATE INDEX IF NOT EXISTS idx_subscriptions_company ON subscriptions(company_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_activation_codes_code ON activation_codes(code);
CREATE INDEX IF NOT EXISTS idx_activation_codes_used ON activation_codes(is_used);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_subscription ON payment_transactions(subscription_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_target ON admin_audit_log(target_type, target_id);

-- Seed data
INSERT INTO subscription_plans (code, name, description, duration_days, price, currency)
SELECT * FROM (
  VALUES
    ('trial', 'تجريبي', 'نسخة تجريبية لمدة 30 يوماً', 30, 0, 'SAR'),
    ('starter', 'مبتدئ', 'للمحلات التجارية الصغيرة والمهنيين', 30, 99, 'SAR'),
    ('professional', 'احترافي', 'للشركات المتوسطة', 30, 199, 'SAR'),
    ('enterprise', 'مؤسسات', 'للشركات الكبيرة والمؤسسات', 30, 499, 'SAR')
) AS s(code, name, description, duration_days, price, currency)
WHERE NOT EXISTS (SELECT 1 FROM subscription_plans WHERE code = s.code);
