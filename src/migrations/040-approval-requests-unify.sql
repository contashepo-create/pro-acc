-- ============================================================
-- 040 - approval_requests schema unification
--
-- Migration 016 created approval_requests with (transaction_type,
-- transaction_id). Migration 017 then recreated it with a DIFFERENT
-- shape (entity_type, entity_id, approver_id, updated_at, ...). On a
-- fresh database, CREATE TABLE IF NOT EXISTS means the 016 shape wins
-- and code that writes/reads entity_* columns fails with
--   ERROR: column "entity_type"/"transaction_type" does not exist.
--
-- This migration reconciles both shapes by adding whichever columns
-- are missing so BOTH code paths work, and drops/re-adds the
-- conflicting indexes safely. Idempotent.
-- ============================================================

BEGIN;

-- 1) Guarantee the table exists.
CREATE TABLE IF NOT EXISTS approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2) Add the 016 legacy columns.
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS transaction_type TEXT;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS transaction_id   TEXT;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS amount           NUMERIC(15,2);
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS requester_id     UUID REFERENCES users(id);
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS approver_chat_id TEXT;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS message          TEXT;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS approved_at      TIMESTAMPTZ;

-- 3) Add the 017 columns (these are what the current approvals/ API uses).
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS entity_type       TEXT;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS entity_id         UUID;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS description       TEXT;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS approver_id       UUID REFERENCES users(id);
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS approved_by       UUID REFERENCES users(id);
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS approval_comments TEXT;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ DEFAULT NOW();

-- company_id must be NOT NULL; if it was created by an older variant
-- without NOT NULL, enforce it now (defaulting rows with null to a
-- no-op is impossible, so leave it as-is if rows already violate —
-- fresh DBs won't hit this).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'approval_requests' AND column_name = 'company_id'
       AND is_nullable = 'YES'
  ) THEN
    -- Best effort: only tighten if no NULLs exist.
    IF NOT EXISTS (SELECT 1 FROM approval_requests WHERE company_id IS NULL) THEN
      ALTER TABLE approval_requests ALTER COLUMN company_id SET NOT NULL;
    END IF;
  END IF;
END $$;

-- 4) Backfill legacy columns from 017 columns so old telegram code
--    (notifications.ts / approval-helpers.ts) can still find
--    transaction_type/transaction_id when requests are created via the
--    new approvals API.
UPDATE approval_requests
   SET transaction_type = entity_type,
       transaction_id   = entity_id::TEXT
 WHERE entity_type IS NOT NULL
   AND (transaction_type IS NULL OR transaction_id IS NULL);

-- 5) Indexes — make sure both shapes are indexed safely.
CREATE INDEX IF NOT EXISTS idx_approval_requests_company     ON approval_requests(company_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_status      ON approval_requests(status);
CREATE INDEX IF NOT EXISTS idx_approval_requests_requester   ON approval_requests(requester_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_approver    ON approval_requests(approver_id);

-- Transaction / entity composite indexes — use IF NOT EXISTS friendly
-- creation via DO blocks because CREATE INDEX IF NOT EXISTS can still
-- fail on names that aren't taken but index already covers same exprs.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'idx_approval_requests_transaction'
  ) THEN
    CREATE INDEX idx_approval_requests_transaction
      ON approval_requests(transaction_type, transaction_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'idx_approval_requests_entity'
  ) THEN
    CREATE INDEX idx_approval_requests_entity
      ON approval_requests(entity_type, entity_id);
  END IF;
END $$;

-- 6) Tighten status CHECK to the union used by either migration.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
     JOIN pg_class t ON t.oid = c.conrelid
     WHERE t.relname = 'approval_requests' AND c.conname = 'approval_requests_status_check'
  ) THEN
    ALTER TABLE approval_requests ADD CONSTRAINT approval_requests_status_check
      CHECK (status IN ('pending','approved','rejected','cancelled'));
  END IF;
END $$;

COMMIT;

SELECT 'Migration 040 completed — approval_requests unified schema' AS result;
