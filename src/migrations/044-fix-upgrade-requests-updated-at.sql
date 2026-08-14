-- 044: Backfill columns that may be missing on live DBs whose tables were
-- created from an older snapshot (error seen in production:
--   "Could not find the 'updated_at' column of 'upgrade_requests' in the schema cache")
-- All statements are idempotent.

ALTER TABLE upgrade_requests ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE upgrade_requests ADD COLUMN IF NOT EXISTS admin_notes TEXT;
ALTER TABLE upgrade_requests ADD COLUMN IF NOT EXISTS reviewed_by UUID;
ALTER TABLE upgrade_requests ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

-- Same class of gap on sibling tables used by the same admin flows.
ALTER TABLE payment_methods  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE complaints       ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Ask PostgREST to reload its schema cache so the new columns are visible
-- immediately (no-op outside Supabase/PostgREST environments).
DO $$
BEGIN
  PERFORM pg_notify('pgrst', 'reload schema');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT 'Migration 044 completed — upgrade_requests.updated_at & friends backfilled' AS result;
