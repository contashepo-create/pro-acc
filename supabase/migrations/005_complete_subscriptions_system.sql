-- =====================================================
-- ترحيل شامل: إصلاح نظام الاشتراكات والأكواد والترقيات
-- =====================================================

-- 1. جدول طلبات الترقية (الشامل)
CREATE TABLE IF NOT EXISTS upgrade_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  current_plan_id UUID REFERENCES subscription_plans(id),
  requested_plan_id UUID REFERENCES subscription_plans(id),
  duration_type TEXT DEFAULT 'monthly',
  payment_method_code TEXT,
  payment_amount NUMERIC(15,2),
  payment_date TEXT,
  payment_time TEXT,
  receipt_image_url TEXT,
  notes TEXT,
  status TEXT DEFAULT 'pending',
  admin_notes TEXT,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_upgrade_requests_company ON upgrade_requests(company_id);
CREATE INDEX IF NOT EXISTS idx_upgrade_requests_status ON upgrade_requests(status);

-- 2. جدول أكواد التفعيل
CREATE TABLE IF NOT EXISTS activation_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  plan_code TEXT NOT NULL,
  duration_months INTEGER NOT NULL DEFAULT 1,
  is_used BOOLEAN DEFAULT false,
  used_by UUID REFERENCES companies(id),
  used_at TIMESTAMPTZ,
  expires_at DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activation_codes_code ON activation_codes(code);
CREATE INDEX IF NOT EXISTS idx_activation_codes_used ON activation_codes(is_used);

-- 3. جدول الاشتراكات
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES subscription_plans(id),
  plan_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE NOT NULL,
  trial_end_date DATE,
  auto_renew BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_company ON subscriptions(company_id);

-- 4. جدول طرق الدفع
CREATE TABLE IF NOT EXISTS payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  name_ar TEXT DEFAULT '',
  account_number TEXT DEFAULT '',
  instructions TEXT DEFAULT '',
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. جدول رسائل الشركة
CREATE TABLE IF NOT EXISTS company_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  user_id UUID,
  subject TEXT DEFAULT '',
  body TEXT DEFAULT '',
  type TEXT DEFAULT 'general',
  status TEXT DEFAULT 'open',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. جدول معاملات الدفع
CREATE TABLE IF NOT EXISTS payment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  subscription_id UUID REFERENCES subscriptions(id),
  amount NUMERIC(15,2),
  payment_method TEXT,
  status TEXT DEFAULT 'pending',
  receipt_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. إضافة الأعمدة الناقصة لجدول الباقات
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS description_ar TEXT DEFAULT '';
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS yearly_discount_percent INTEGER DEFAULT 20;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS trial_days INTEGER DEFAULT 7;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS max_clients INTEGER DEFAULT 10;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS max_suppliers INTEGER DEFAULT 10;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS max_employees INTEGER DEFAULT 5;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS max_invoices_per_month INTEGER DEFAULT 50;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS max_storage_mb INTEGER DEFAULT 100;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS features_modules JSONB DEFAULT '{}'::jsonb;

-- 8. إضافة أعمدة users الناقصة
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS city TEXT;

-- 9. إضافة جداول الصلاحيات
CREATE TABLE IF NOT EXISTS company_telegram_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) UNIQUE,
  chat_id TEXT NOT NULL DEFAULT '',
  is_enabled BOOLEAN DEFAULT false,
  notify_invoices BOOLEAN DEFAULT true,
  notify_cash_transactions BOOLEAN DEFAULT true,
  notify_user_logins BOOLEAN DEFAULT true,
  approvals_enabled BOOLEAN DEFAULT false,
  approval_threshold NUMERIC(15,2) DEFAULT 5000.00,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  module TEXT NOT NULL DEFAULT 'general',
  permissions TEXT[] DEFAULT '{}',
  bypass_telegram_confirmation BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, company_id, module)
);

CREATE TABLE IF NOT EXISTS custom_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_en TEXT,
  icon TEXT DEFAULT '📁',
  group_name TEXT DEFAULT 'custom',
  is_system BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, name)
);

CREATE TABLE IF NOT EXISTS custom_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_en TEXT,
  icon TEXT DEFAULT '⚡',
  code TEXT NOT NULL,
  is_system BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, code)
);

-- 10. الباقات الافتراضية
INSERT INTO subscription_plans (code, name, description, description_ar, price_monthly, price_yearly, max_users, max_clients, max_suppliers, max_employees, max_projects, max_invoices_per_month, max_storage_mb, trial_days, is_active, sort_order)
VALUES 
  ('basic', 'الأساسية', 'Basic Plan', 'الباقة الأساسية', 99, 990, 3, 50, 50, 10, 5, 100, 200, 7, true, 1),
  ('professional', 'الاحترافية', 'Professional Plan', 'الباقة الاحترافية', 199, 1990, 10, 200, 200, 50, 20, 500, 1000, 14, true, 2),
  ('enterprise', 'المؤسسية', 'Enterprise Plan', 'الباقة المؤسسية', 399, 3990, 999, 9999, 9999, 999, 999, 99999, 99999, 30, true, 3)
ON CONFLICT (code) DO NOTHING;

-- 11. طرق الدفع الافتراضية
INSERT INTO payment_methods (code, name, name_ar, account_number, instructions, is_active, sort_order)
VALUES 
  ('bank_transfer', 'Bank Transfer', 'تحويل بنكي', 'SA00 0000 0000 0000 0000 0000', 'حوّل المبلغ ثم أرسل صورة الإيصال', true, 1),
  ('cash', 'Cash', 'نقداً', '', 'ادفع نقداً في المكتب', true, 2)
ON CONFLICT (code) DO NOTHING;
