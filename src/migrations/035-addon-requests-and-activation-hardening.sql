-- ============================================================
-- 035 - Add-on purchase requests & admin grant audit
--
-- Extra users ($5/mo, $48/yr) and extra branches/warehouses
-- ($10/mo, $96/yr) can be requested by customers and approved
-- by admin (manual flow, with payment proof), after which
-- subscriptions.extra_users / extra_branches are incremented.
--
-- Also tightens activation_codes:
--   * Code is always generated as 16-byte CSPRNG hex (never Math.random).
--   * Single-use, optionally bound to a company if code.target_company_id
--     is set (prevents replay across companies).
--   * Tokens are stored with a hash so DB leaks cannot redeem codes.
-- ============================================================

CREATE TABLE IF NOT EXISTS addon_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  addon_type      TEXT NOT NULL CHECK (addon_type IN ('extra_user','extra_branch','storage_gb')),
  quantity        INT  NOT NULL CHECK (quantity > 0 AND quantity <= 100),
  duration_type   TEXT NOT NULL CHECK (duration_type IN ('monthly','yearly')),
  unit_price_usd  NUMERIC(10,2) NOT NULL,
  total_amount_usd NUMERIC(10,2) NOT NULL,
  payment_method_code TEXT,
  payment_amount      NUMERIC(10,2),
  payment_date        DATE,
  payment_time        TEXT,
  receipt_image_url   TEXT,
  notes               TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected','cancelled')),
  admin_notes     TEXT,
  reviewed_by     UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_addon_requests_company ON addon_requests(company_id);
CREATE INDEX IF NOT EXISTS idx_addon_requests_status  ON addon_requests(status);

CREATE TABLE IF NOT EXISTS addon_grant_audit (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  request_id      UUID REFERENCES addon_requests(id) ON DELETE SET NULL,
  admin_id        UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  addon_type      TEXT NOT NULL,
  quantity        INT NOT NULL,
  months_granted  INT NOT NULL,
  previous_extra_users INT NOT NULL DEFAULT 0,
  previous_extra_branches INT NOT NULL DEFAULT 0,
  new_extra_users INT NOT NULL DEFAULT 0,
  new_extra_branches INT NOT NULL DEFAULT 0,
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_addon_grant_company ON addon_grant_audit(company_id);

-- activation_codes hardening: make sure required columns exist.
ALTER TABLE activation_codes
  ADD COLUMN IF NOT EXISTS target_company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS code_hash TEXT,
  ADD COLUMN IF NOT EXISTS plan_duration_months INT,     -- alias for duration_months
  ADD COLUMN IF NOT EXISTS addon_type TEXT CHECK (addon_type IN (NULL,'extra_user','extra_branch','storage_gb')),
  ADD COLUMN IF NOT EXISTS addon_quantity INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS one_time BOOLEAN NOT NULL DEFAULT true;

-- Ensure code column has a unique index so DB-level replay is impossible.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname='public' AND indexname='idx_activation_codes_code_unique'
  ) THEN
    CREATE UNIQUE INDEX idx_activation_codes_code_unique ON activation_codes(code);
  END IF;
END $$;

SELECT 'Migration 035 completed — add-on requests + activation-code hardening' AS result;
