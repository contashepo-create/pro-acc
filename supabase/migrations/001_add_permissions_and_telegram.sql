-- =====================================================
-- ترحيل: إضافة نظام الصلاحيات وإعدادات التيليجرام
-- =====================================================

-- 1. جدول إعدادات التيليجرام للشركة
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

CREATE INDEX IF NOT EXISTS idx_company_telegram_company ON company_telegram_configs(company_id);

-- 2. جدول الصلاحيات المخصصة لكل مستخدم
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

CREATE INDEX IF NOT EXISTS idx_user_permissions_user ON user_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_permissions_company ON user_permissions(company_id);
CREATE INDEX IF NOT EXISTS idx_user_permissions_module ON user_permissions(module);

-- 3. جدول طلبات الموافقة (إن لم يكن موجوداً)
CREATE TABLE IF NOT EXISTS approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  transaction_type TEXT NOT NULL,
  transaction_id UUID,
  amount NUMERIC(15,2),
  requester_id UUID REFERENCES users(id),
  approver_chat_id TEXT,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
  message TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_approval_requests_company ON approval_requests(company_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(status);

-- 4. جدول سجل المراجعة الأمنية
CREATE TABLE IF NOT EXISTS security_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  user_id UUID,
  action TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_audit_company ON security_audit_log(company_id);
CREATE INDEX IF NOT EXISTS idx_security_audit_user ON security_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_security_audit_action ON security_audit_log(action);

-- 5. إضافة عمود opening_balance للجدول banks_safes (اختياري - للتوافق)
-- الرصيد الافتتاحي يُحسب الآن من journal_lines لكن نحتفظ بالعمود للتوافق
ALTER TABLE banks_safes ADD COLUMN IF NOT EXISTS opening_balance NUMERIC(15,2) DEFAULT 0;

-- 6. إضافة عمود remaining_amount إن لم يكن موجوداً في custodies
ALTER TABLE custodies ADD COLUMN IF NOT EXISTS remaining_amount NUMERIC(15,2) NOT NULL DEFAULT 0;

-- 7. إضافة عمود reason إن لم يكن موجوداً في custodies
ALTER TABLE custodies ADD COLUMN IF NOT EXISTS reason TEXT DEFAULT 'عهدة موظف';

-- 8. إضافة عمود bank_safe_id للعهدة (اختياري)
ALTER TABLE custodies ADD COLUMN IF NOT EXISTS bank_safe_id UUID REFERENCES banks_safes(id);

-- 9. إضافة عمود created_by للعهدة إن لم يكن موجوداً
ALTER TABLE custodies ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);
