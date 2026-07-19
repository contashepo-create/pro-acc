-- =====================================================
-- ترحيل شامل: إصلاح نظام الاشتراكات والأكواد والترقيات
-- (نسخة آمنة - لا تفشل حتى لو كانت بعض الأعمدة موجودة)
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

-- 4. جدول طرق الدفع (إن لم يكن موجوداً)
CREATE TABLE IF NOT EXISTS payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name_ar TEXT NOT NULL DEFAULT '',
  account_number TEXT DEFAULT '',
  account_name TEXT DEFAULT '',
  instructions TEXT DEFAULT '',
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
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

-- 7. إضافة الأعمدة الناقصة لجدول الباقات (بأمان)
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS description_ar TEXT DEFAULT '';
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS yearly_discount_percent INTEGER DEFAULT 20;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS trial_days INTEGER DEFAULT 7;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS max_clients INTEGER DEFAULT 10;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS max_suppliers INTEGER DEFAULT 10;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS max_employees INTEGER DEFAULT 5;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS max_invoices_per_month INTEGER DEFAULT 50;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS max_storage_mb INTEGER DEFAULT 100;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS features_modules JSONB DEFAULT '{}'::jsonb;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS price_monthly NUMERIC(15,2);
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS price_yearly NUMERIC(15,2);
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS max_users INTEGER DEFAULT 1;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS max_projects INTEGER;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS features JSONB DEFAULT '[]'::jsonb;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

-- 8. إضافة أعمدة users الناقصة
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS city TEXT;

-- 9. إضافة عمود show_until للإعلانات
ALTER TABLE advertisements ADD COLUMN IF NOT EXISTS show_until DATE;

-- 10. إضافة جداول الصلاحيات
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
  icon TEXT DEFAULT '',
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

-- =====================================================
-- إدراج البيانات الافتراضية (بأمان - لا تتكرر)
-- =====================================================

-- 11. الباقات الافتراضية (فقط الأعمدة المؤكدة وجودها)
INSERT INTO subscription_plans (code, name, description, is_active, sort_order)
VALUES 
  ('basic', 'الأساسية', 'الباقة الأساسية - 3 مستخدمين', true, 1),
  ('professional', 'الاحترافية', 'الباقة الاحترافية - 10 مستخدمين', true, 2),
  ('enterprise', 'المؤسسية', 'الباقة المؤسسية - مستخدمين غير محدود', true, 3)
ON CONFLICT (code) DO NOTHING;

-- تحديث الباقات الموجودة بالأعمدة الجديدة (إذا كانت موجودة)
-- نستخدم DO $$ ... $$ لتشغيل UPDATE بأمان
DO $$
BEGIN
  -- تحديث الباقة الأساسية
  UPDATE subscription_plans SET 
    description_ar = 'الباقة الأساسية',
    price_monthly = 99,
    price_yearly = 990,
    max_users = 3,
    max_clients = 50,
    max_suppliers = 50,
    max_employees = 10,
    max_projects = 5,
    max_invoices_per_month = 100,
    max_storage_mb = 200,
    trial_days = 7
  WHERE code = 'basic';

  -- تحديث الباقة الاحترافية
  UPDATE subscription_plans SET 
    description_ar = 'الباقة الاحترافية',
    price_monthly = 199,
    price_yearly = 1990,
    max_users = 10,
    max_clients = 200,
    max_suppliers = 200,
    max_employees = 50,
    max_projects = 20,
    max_invoices_per_month = 500,
    max_storage_mb = 1000,
    trial_days = 14
  WHERE code = 'professional';

  -- تحديث الباقة المؤسسية
  UPDATE subscription_plans SET 
    description_ar = 'الباقة المؤسسية',
    price_monthly = 399,
    price_yearly = 3990,
    max_users = 999,
    max_clients = 9999,
    max_suppliers = 9999,
    max_employees = 999,
    max_projects = 999,
    max_invoices_per_month = 99999,
    max_storage_mb = 99999,
    trial_days = 30
  WHERE code = 'enterprise';
END $$;

-- 12. طرق الدفع الافتراضية
INSERT INTO payment_methods (code, name_ar, account_number, instructions, is_active, sort_order)
VALUES 
  ('bank_transfer', 'تحويل بنكي', 'SA00 0000 0000 0000 0000 0000', 'حوّل المبلغ ثم أرسل صورة الإيصال', true, 1),
  ('cash', 'نقداً', '', 'ادفع نقداً في المكتب', true, 2)
ON CONFLICT (code) DO NOTHING;
