-- =====================================================
-- ترحيل: نظام الصلاحيات الديناميكي
-- يسمح للمدير بإضافة/حذف أقسام وعمليات مخصصة
-- =====================================================

-- جدول الأقسام/الوحدات المخصصة
CREATE TABLE IF NOT EXISTS custom_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_en TEXT,
  icon TEXT DEFAULT '📁',
  group_name TEXT DEFAULT 'custom', -- المجموعة التي ينتمي لها
  is_system BOOLEAN DEFAULT false, -- هل هو قسم نظامي (لا يمكن حذفه)
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, name)
);

CREATE INDEX IF NOT EXISTS idx_custom_modules_company ON custom_modules(company_id);

-- جدول العمليات/الصلاحيات المخصصة
CREATE TABLE IF NOT EXISTS custom_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_en TEXT,
  icon TEXT DEFAULT '⚡',
  code TEXT NOT NULL, -- كود فريد للعملية (مثل: approve_refund)
  is_system BOOLEAN DEFAULT false, -- هل هي عملية نظامية
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, code)
);

CREATE INDEX IF NOT EXISTS idx_custom_actions_company ON custom_actions(company_id);
CREATE INDEX IF NOT EXISTS idx_custom_actions_code ON custom_actions(code);

-- تحديث جدول user_permissions ليدعم الوحدات والعمليات المخصصة
-- (لا حاجة لتغيير - module و permissions TEXT[] يدعمان أي قيمة)

-- إدراج الأقسام النظامية الافتراضية (لن تُحذف)
-- هذه تُدرج مرة واحدة عند تشغيل الـ migration
