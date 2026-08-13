-- ============================================================
-- 043 - Final safety net: app_settings table + notifications
-- type widening guard
--
-- Static audit discovered two real gaps after 042:
--   1. admin/app-settings route reads/writes an `app_settings`
--      key/value table that has no migration yet.
--   2. notifications.type code path writes 'approval_approved' /
--      'approval_rejected' as literal column values (already covered
--      by 041 CHECK widening). Guard re-applied here idempotently.
-- ============================================================

BEGIN;

-- ------------- app_settings (global admin key/value) -------------
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  category TEXT DEFAULT 'general',
  description TEXT,
  updated_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed sensible defaults (idempotent via ON CONFLICT)
INSERT INTO app_settings (key, value, category, description) VALUES
  ('app_name',          'برو أكاونت - Pro Acc',  'branding',  'اسم التطبيق الظاهر في الواجهة والتقارير'),
  ('app_name_en',       'Pro Acc',                'branding',  'English application name'),
  ('support_email',     'support@proacc.app',     'contact',   'بريد الدعم الفني'),
  ('support_phone',     '',                       'contact',   'هاتف الدعم الفني'),
  ('currency_default',  'SAR',                    'localization','العملة الافتراضية للشركات الجديدة'),
  ('locale_default',    'ar',                     'localization','اللغة الافتراضية (ar / en)'),
  ('trial_days',        '7',                      'billing',   'مدة التجربة المجانية بالأيام'),
  ('storage_quota_mb',  '0',                      'billing',   'مساحة التخزين الافتراضية ميجابايت (تُزاد عبر addon storage_gb)')
ON CONFLICT (key) DO NOTHING;

-- ------------- notifications.type CHECK (widen idempotently) -------------
DO $$
DECLARE c text;
BEGIN
  -- Drop existing constraint(s) on notifications.type so we can re-add
  -- the widened whitelist (covers all types the app writes).
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'notifications'::regclass AND contype='c'
       AND pg_get_constraintdef(oid) LIKE '%type%IN%'
  LOOP
    EXECUTE 'ALTER TABLE notifications DROP CONSTRAINT IF EXISTS ' || quote_ident(c);
  END LOOP;

  ALTER TABLE notifications
    ADD CONSTRAINT notifications_type_check
    CHECK (type IN (
      'info','warning','success','error',
      'subscription','upgrade','addon_granted',
      'approval_request','approval_response','approval_approved','approval_rejected',
      'push','support_update','closing'
    ));
END $$;

COMMIT;

SELECT 'Migration 043 completed — app_settings + notifications CHECK hardened' AS result;
