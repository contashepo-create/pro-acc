-- ============================================================
-- Migration 018: Global App Settings + Subscriber Numbers
-- Date: 2026-07-23
-- Description: Create global app_settings table for admin-controllable
-- contact/payment/branding info. Add unique subscriber_number to subscriptions.
-- ============================================================

-- 1. Global app_settings table (admin-controlled, shared across all companies)
CREATE TABLE IF NOT EXISTS app_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  value TEXT,
  category TEXT DEFAULT 'general',
  is_public BOOLEAN DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID
);

-- 2. Seed default app settings
INSERT INTO app_settings (key, value, category, is_public) VALUES
  ('app_name', 'برو أكاونت', 'branding', true),
  ('app_name_en', 'ProAccount', 'branding', true),
  ('app_version', '1.0.0', 'branding', true),
  ('developer_name', 'ContaShepo', 'branding', true),
  ('support_email', 'contashepo@gmail.com', 'contact', true),
  ('support_phone', '+966500000000', 'contact', true),
  ('support_whatsapp', '+966500000000', 'contact', true),
  ('support_telegram', 'contashepo', 'contact', true),
  ('support_website', 'https://pro-acc.vercel.app', 'contact', true),
  ('payment_info', 'يمكن الدفع عبر التحويل البنكي أو الوسائل الإلكترونية', 'payment', true),
  ('payment_bank_name', '', 'payment', true),
  ('payment_iban', '', 'payment', true),
  ('payment_stc_pay', '', 'payment', true),
  ('footer_text', '© 2026 برو أكاونت - جميع الحقوق محفوظة', 'branding', true)
ON CONFLICT (key) DO NOTHING;

-- 3. Add unique subscriber_number to subscriptions
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS subscriber_number INTEGER;

-- 4. Backfill existing subscriptions with sequential numbers
DO $$
DECLARE
  sub RECORD;
  counter INTEGER := 1000;
BEGIN
  FOR sub IN SELECT id FROM subscriptions WHERE subscriber_number IS NULL ORDER BY created_at LOOP
    UPDATE subscriptions SET subscriber_number = counter WHERE id = sub.id;
    counter := counter + 1;
  END LOOP;
END $$;

-- 5. Create sequence for future subscriber numbers
CREATE SEQUENCE IF NOT EXISTS subscriber_number_seq START WITH 1000 INCREMENT BY 1;

-- 6. Set NOT NULL after backfill
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'subscriptions' AND column_name = 'subscriber_number') THEN
    -- Only set NOT NULL if all rows have values
    IF NOT EXISTS (SELECT 1 FROM subscriptions WHERE subscriber_number IS NULL) THEN
      ALTER TABLE subscriptions ALTER COLUMN subscriber_number SET NOT NULL;
    END IF;
    -- Add unique constraint
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_subscriber_number_key') THEN
      ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_subscriber_number_key UNIQUE (subscriber_number);
    END IF;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not set constraints on subscriber_number: %', SQLERRM;
END $$;

COMMENT ON TABLE app_settings IS 'إعدادات عامة يتحكم بها المدير (تواصل، دفع، علامة تجارية)';
COMMENT ON COLUMN subscriptions.subscriber_number IS 'رقم المشترك - فريد ولا يتكرر';
