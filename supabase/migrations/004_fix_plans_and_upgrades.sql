-- =====================================================
-- ترحيل: إصلاح الباقات وطلبات الترقية
-- =====================================================

-- 1. إضافة الأعمدة الناقصة لجدول الباقات
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS description_ar TEXT DEFAULT '';
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS yearly_discount_percent INTEGER DEFAULT 20;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS trial_days INTEGER DEFAULT 7;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS max_clients INTEGER DEFAULT 10;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS max_suppliers INTEGER DEFAULT 10;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS max_employees INTEGER DEFAULT 5;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS max_invoices_per_month INTEGER DEFAULT 50;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS max_storage_mb INTEGER DEFAULT 100;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS features_modules JSONB DEFAULT '{}'::jsonb;

-- 2. إنشاء جدول طلبات الترقية
CREATE TABLE IF NOT EXISTS upgrade_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  requested_plan_id UUID REFERENCES subscription_plans(id),
  current_plan_code TEXT,
  requested_plan_code TEXT,
  duration_type TEXT DEFAULT 'monthly' CHECK(duration_type IN ('monthly', 'yearly')),
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'cancelled')),
  admin_notes TEXT,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_upgrade_requests_company ON upgrade_requests(company_id);
CREATE INDEX IF NOT EXISTS idx_upgrade_requests_status ON upgrade_requests(status);

-- 3. إنشاء جدول جدول الاشتراكات إذا لم يكن موجوداً بالكامل
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES subscription_plans(id),
  plan_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'trial', 'expired', 'cancelled')),
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE NOT NULL,
  trial_end_date DATE,
  auto_renew BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_company ON subscriptions(company_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

-- 4. التأكد من وجود الباقات الافتراضية
INSERT INTO subscription_plans (code, name, description, description_ar, price_monthly, price_yearly, max_users, max_clients, max_suppliers, max_employees, max_projects, max_invoices_per_month, max_storage_mb, trial_days, is_active, sort_order)
VALUES 
  ('basic', 'الأساسية', 'Basic Plan', 'الباقة الأساسية', 99, 990, 3, 50, 50, 10, 5, 100, 200, 7, true, 1),
  ('professional', 'الاحترافية', 'Professional Plan', 'الباقة الاحترافية', 199, 1990, 10, 200, 200, 50, 20, 500, 1000, 14, true, 2),
  ('enterprise', 'المؤسسية', 'Enterprise Plan', 'الباقة المؤسسية', 399, 3990, 999, 9999, 9999, 999, 999, 99999, 99999, 30, true, 3)
ON CONFLICT (code) DO NOTHING;
