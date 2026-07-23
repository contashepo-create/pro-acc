-- ============================================================
-- Migration 020: Dynamic App Settings with Custom Fields
-- Date: 2026-07-23
-- Description: Upgrade app_settings to support custom fields with icons,
-- labels, types, and sort order
-- ============================================================

-- Add new columns to app_settings
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS label TEXT;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS icon TEXT DEFAULT 'Info';
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS field_type TEXT DEFAULT 'text' CHECK(field_type IN ('text', 'link', 'email', 'phone', 'textarea'));
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS is_custom BOOLEAN DEFAULT false;

-- Update existing seed data with labels and icons
UPDATE app_settings SET label = 'اسم البرنامج (عربي)', icon = 'Building2', sort_order = 1, field_type = 'text' WHERE key = 'app_name';
UPDATE app_settings SET label = 'اسم البرنامج (إنجليزي)', icon = 'Building2', sort_order = 2, field_type = 'text' WHERE key = 'app_name_en';
UPDATE app_settings SET label = 'إصدار البرنامج', icon = 'Info', sort_order = 3, field_type = 'text' WHERE key = 'app_version';
UPDATE app_settings SET label = 'اسم المطور', icon = 'Code', sort_order = 4, field_type = 'text' WHERE key = 'developer_name';
UPDATE app_settings SET label = 'البريد الإلكتروني', icon = 'Mail', sort_order = 1, field_type = 'email' WHERE key = 'support_email';
UPDATE app_settings SET label = 'رقم الهاتف', icon = 'Phone', sort_order = 2, field_type = 'phone' WHERE key = 'support_phone';
UPDATE app_settings SET label = 'واتساب', icon = 'MessageSquare', sort_order = 3, field_type = 'link' WHERE key = 'support_whatsapp';
UPDATE app_settings SET label = 'تيليجرام', icon = 'Send', sort_order = 4, field_type = 'link' WHERE key = 'support_telegram';
UPDATE app_settings SET label = 'الموقع الإلكتروني', icon = 'Globe', sort_order = 5, field_type = 'link' WHERE key = 'support_website';
UPDATE app_settings SET label = 'ملاحظات الدفع', icon = 'CreditCard', sort_order = 1, field_type = 'textarea' WHERE key = 'payment_info';
UPDATE app_settings SET label = 'اسم البنك', icon = 'Building2', sort_order = 2, field_type = 'text' WHERE key = 'payment_bank_name';
UPDATE app_settings SET label = 'رقم الآيبان (IBAN)', icon = 'CreditCard', sort_order = 3, field_type = 'text' WHERE key = 'payment_iban';
UPDATE app_settings SET label = 'STC Pay', icon = 'Smartphone', sort_order = 4, field_type = 'phone' WHERE key = 'payment_stc_pay';
UPDATE app_settings SET label = 'نص التذييل', icon = 'FileText', sort_order = 1, field_type = 'textarea' WHERE key = 'footer_text';

COMMENT ON COLUMN app_settings.label IS 'الاسم المعروض للحقل';
COMMENT ON COLUMN app_settings.icon IS 'اسم الأيقونة من مكتبة lucide-react';
COMMENT ON COLUMN app_settings.field_type IS 'نوع الحقل: text, link, email, phone, textarea';
COMMENT ON COLUMN app_settings.sort_order IS 'ترتيب العرض داخل القسم';
COMMENT ON COLUMN app_settings.is_custom IS 'حقل مخصص أضافه المدير';
