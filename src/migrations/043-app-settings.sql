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

-- Idempotently ensure any columns missing on pre-existing copies of
-- app_settings (e.g. created by an older migration) exist before we try
-- to INSERT into them.
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS value       TEXT NOT NULL DEFAULT '';
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS category    TEXT DEFAULT 'general';
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS updated_by  UUID REFERENCES admin_users(id) ON DELETE SET NULL;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ DEFAULT NOW();

-- Ensure the PRIMARY KEY on `key` exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
     JOIN pg_class t ON t.oid = c.conrelid
     WHERE t.relname = 'app_settings' AND c.contype = 'p'
  ) THEN
    -- Can't directly add PK on a nullable column; guarantee NOT NULL first.
    UPDATE app_settings SET key = '' WHERE key IS NULL;
    DELETE FROM app_settings WHERE key = '';  -- shouldn't happen
    ALTER TABLE app_settings ALTER COLUMN key SET NOT NULL;
    ALTER TABLE app_settings ADD CONSTRAINT app_settings_pkey PRIMARY KEY (key);
  END IF;
END $$;

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
DECLARE r RECORD;
BEGIN
  -- Drop EVERY check constraint that involves column `type`, regardless of
  -- how pg_get_constraintdef formats it (spaces, newlines, auto-generated
  -- names, etc.), so we can safely re-add our widened whitelist.
  FOR r IN
    SELECT c.conname AS conname
      FROM pg_constraint c
      JOIN pg_class      t ON t.oid = c.conrelid
      JOIN pg_namespace  n ON n.oid = t.relnamespace
      JOIN pg_attribute  a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
     WHERE t.relname = 'notifications'
       AND n.nspname = 'public'
       AND c.contype = 'c'
       AND a.attname = 'type'
  LOOP
    EXECUTE 'ALTER TABLE notifications DROP CONSTRAINT IF EXISTS ' || quote_ident(r.conname);
  END LOOP;
END $$;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'info','warning','success','error',
    'subscription','upgrade','addon_granted',
    'approval_request','approval_response','approval_approved','approval_rejected',
    'push','support_update','closing'
  ));

COMMIT;

SELECT 'Migration 043 completed — app_settings + notifications CHECK hardened' AS result;
