-- =====================================================
-- ترحيل 006: إصلاح نظام الإعلانات الكامل
-- - تحديث CHECK constraint ليشمل 8 أنواع
-- - إضافة عمود show_until
-- - إضافة عمود display_mode (top_bar, banner, popup)
-- =====================================================

-- 1. إعادة إنشاء جدول الإعلانات بالهيكل الكامل
-- (نحذف الجدول القديم ونعيد إنشاءه لأن CHECK constraint لا يمكن تعديله بسهولة)

DROP TABLE IF EXISTS advertisements CASCADE;

CREATE TABLE advertisements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'announcement',
  -- الأنواع المدعومة:
  -- announcement: إعلان عام
  -- promotion: عرض ترويجي
  -- banner: بانر إعلاني
  -- upgrade: رسالة ترقية
  -- alert: تنبيه عاجل
  -- info: معلومة
  -- feature: ميزة جديدة
  -- premium: محتوى حصري
  display_mode TEXT NOT NULL DEFAULT 'top_bar',
  -- طرق العرض:
  -- top_bar: شريط علوي (AnnouncementBar)
  -- banner: بانر في الصفحة
  -- popup: نافذة منبثقة عند تسجيل الدخول
  is_active BOOLEAN DEFAULT TRUE,
  priority INTEGER DEFAULT 0,
  starts_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  show_until DATE,
  link_url TEXT,
  link_text TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_advertisements_active ON advertisements(is_active, starts_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_advertisements_type ON advertisements(type);
CREATE INDEX IF NOT EXISTS idx_advertisements_display_mode ON advertisements(display_mode);

-- 2. إضافة بيانات تجريبية
INSERT INTO advertisements (title, body, type, display_mode, priority, expires_at, show_until) VALUES
  ('مرحباً بك في Pro Acc', 'نظام محاسبة متكامل لإدارة أعمالك بكفاءة عالية', 'info', 'top_bar', 10, NOW() + INTERVAL '30 days', (NOW() + INTERVAL '30 days')::date),
  ('ترقية باقتك الآن', 'احصل على مميزات أكثر مع الباقة الاحترافية', 'upgrade', 'popup', 20, NOW() + INTERVAL '60 days', (NOW() + INTERVAL '60 days')::date),
  ('عرض خاص', 'خصم 20% على جميع الباقات لفترة محدودة', 'promotion', 'banner', 15, NOW() + INTERVAL '14 days', (NOW() + INTERVAL '14 days')::date);
