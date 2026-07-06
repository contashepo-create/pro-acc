SELECT run_migration('004-admin-sessions.sql', $$
  ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS telegram_code TEXT;
  ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS telegram_code_expires TIMESTAMPTZ;
  ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS master_verified BOOLEAN DEFAULT false;
  ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS login_session_data JSONB;
$$);
