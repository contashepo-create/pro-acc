-- 066 - Global backup journal for the developer's whole-database backups.
--
-- The scheduled global backup (scripts/global-backup.ts, driven by the
-- .github/workflows/global-backup.yml cron) keeps its operational state here:
-- what was dumped, where the artifact is stored, and the Telegram message id
-- so the retention policy ("keep the last N copies") can delete old artifacts
-- from storage AND from the Telegram chat.
--
-- This is a PLATFORM-LEVEL operational table: it carries no company_id by
-- design (it journals the whole database, not a tenant), it is never touched
-- by tenant API routes, and it is tiny (one row per backup).

CREATE TABLE IF NOT EXISTS global_backup_journal (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  filename TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
  sha256 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  storage_path TEXT,
  telegram_message_id TEXT,
  extra JSONB
);

CREATE INDEX IF NOT EXISTS idx_global_backup_journal_created
  ON global_backup_journal(created_at ASC);
