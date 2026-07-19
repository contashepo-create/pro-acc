-- Fix for Critical Settings Security Issues

-- 1. Add constraint to settings table to only allow whitelisted keys
CREATE TABLE IF NOT EXISTS allowed_settings_keys (
  key_name TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  description TEXT,
  is_sensitive BOOLEAN DEFAULT false
);

-- Insert allowed settings keys
INSERT INTO allowed_settings_keys (key_name, category, description, is_sensitive) VALUES
-- General settings
('company_name', 'general', 'اسم الشركة', false),
('company_email', 'general', 'بريد الشركة', false),
('company_phone', 'general', 'رقم هاتف الشركة', false),
('company_address', 'general', 'عنوان الشركة', false),
('commercial_registration', 'general', 'السجل التجاري', false),
('tax_number', 'general', 'الرقم الضريبي', false),
-- Accounting settings
('decimal_places', 'accounting', 'عدد الأرقام العشرية', false),
('vat_rate', 'accounting', 'نسبة الضريبة', false),
('currency_code', 'accounting', 'رمز العملة', false),
('currency_symbol', 'accounting', 'رمز العملة', false),
-- Notification settings
('email_notifications', 'notifications', 'إشعارات البريد الإلكتروني', false),
('sms_notifications', 'notifications', 'إشعارات الرسائل النصية', false),
('push_notifications', 'notifications', 'إشعارات Push', false),
-- Telegram settings (stored in separate table, not here)
('telegram_enabled', 'notifications', 'تفعيل التيليغرام', false)
ON CONFLICT (key_name) DO NOTHING;

-- 2. Add validation trigger for settings
CREATE OR REPLACE FUNCTION validate_settings_key()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM allowed_settings_keys 
    WHERE key_name = NEW.key
  ) THEN
    RAISE EXCEPTION 'Invalid settings key: %', NEW.key;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_validate_settings_key ON settings;
CREATE TRIGGER tr_validate_settings_key
BEFORE INSERT OR UPDATE ON settings
FOR EACH ROW
EXECUTE FUNCTION validate_settings_key();

-- 3. Add function to clean up expired test runs
CREATE OR REPLACE FUNCTION cleanup_expired_test_runs()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM telegram_test_runs
  WHERE status = 'pending'
    AND created_at < NOW() - INTERVAL '5 minutes';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- 4. Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_settings_key_value ON settings(key, value);
CREATE INDEX IF NOT EXISTS idx_telegram_test_runs_status_created ON telegram_test_runs(status, created_at);

-- 5. Add comment
COMMENT ON FUNCTION cleanup_expired_test_runs IS 'Clean up expired Telegram test runs (older than 5 minutes)';