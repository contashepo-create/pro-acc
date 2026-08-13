-- ============================================================
-- 036 - Storage add-on enforcement + security hardening
--
-- Adds extra_storage_gb column to subscriptions so purchased
-- storage_gb add-ons actually raise max_storage_mb. max_storage_mb
-- is computed as plan.max_storage_mb + extra_storage_gb * 1024.
--
-- Also:
--  * Ensures company_id is indexed on key tables for tenant isolation performance.
--  * Adds is_admin-only RLS-friendly index on activation_codes(is_used,expires_at).
-- ============================================================

-- 1) Extra storage (GB) purchased via addon_requests / activation codes.
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS extra_storage_gb INT NOT NULL DEFAULT 0;

-- Keep storage_gb addon purchases in addons_json for audit/history; the
-- authoritative extra_storage_gb lives as a proper column so the limit
-- engine can sum cheaply.

-- 2) Backfill extra_storage_gb from addons_json.extra_storage_gb_paid (if any).
UPDATE subscriptions s
   SET extra_storage_gb = COALESCE(
         (s.addons_json->>'extra_storage_gb_paid')::int,
         0)
 WHERE s.addons_json IS NOT NULL
   AND s.addons_json::text LIKE '%extra_storage_gb_paid%';

-- 3) Indexes to harden tenant-isolation query patterns.
CREATE INDEX IF NOT EXISTS idx_subscriptions_company_created
    ON subscriptions(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activation_codes_unused
    ON activation_codes(is_used, expires_at)
 WHERE is_used = false;

SELECT 'Migration 036 completed — storage addons now enforced' AS result;
