-- ============================================================
-- 039 - Fix mv_trial_balance dependency order
--
-- Migration 011 created mv_trial_balance referencing a.deleted_at
-- BEFORE adding the deleted_at column to accounts. On a fresh
-- database this causes:
--   ERROR: 42703 column a.deleted_at does not exist
--
-- Fix is idempotent:
--   1. Ensure deleted_at exists on every table the view needs.
--   2. Drop+recreate mv_trial_balance (and refresh_trial_balance).
-- ============================================================

BEGIN;

-- 1) Guarantee the soft-delete columns exist (they're added in 009/011
--    but on partially-migrated DBs 011's view may be built first).
ALTER TABLE accounts        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE contacts        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE invoices        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE projects        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- 2) Drop and (re)create mv_trial_balance now that columns exist.
DROP MATERIALIZED VIEW IF EXISTS mv_trial_balance CASCADE;
DROP VIEW IF EXISTS vw_trial_balance;

CREATE MATERIALIZED VIEW mv_trial_balance AS
SELECT
  a.company_id,
  a.id AS account_id,
  a.code,
  a.name,
  a.type,
  COALESCE(SUM(jl.debit), 0)  AS total_debit,
  COALESCE(SUM(jl.credit), 0) AS total_credit,
  COALESCE(SUM(jl.debit) - SUM(jl.credit), 0) AS balance
FROM accounts a
LEFT JOIN journal_lines jl ON jl.account_id = a.id
LEFT JOIN journal_entries je ON je.id = jl.journal_entry_id AND je.deleted_at IS NULL
WHERE a.is_active = true AND a.deleted_at IS NULL
GROUP BY a.company_id, a.id, a.code, a.name, a.type;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_trial_balance_unique ON mv_trial_balance(company_id, account_id);
CREATE INDEX IF NOT EXISTS idx_mv_trial_balance_company ON mv_trial_balance(company_id);

-- 3) Refresh helper (CONCURRENTLY needs the unique index, which now exists).
CREATE OR REPLACE FUNCTION refresh_trial_balance() RETURNS VOID AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_trial_balance;
EXCEPTION WHEN OTHERS THEN
  REFRESH MATERIALIZED VIEW mv_trial_balance;
END;
$$ LANGUAGE plpgsql;

COMMIT;

SELECT 'Migration 039 completed — mv_trial_balance recreated safely' AS result;
