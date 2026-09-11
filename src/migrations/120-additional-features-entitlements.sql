-- 120 - Per-company developer controlled optional features.
-- Optional features are fail-closed: existing companies start disabled with no
-- manually granted extra users.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS optional_features JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS additional_users_limit INTEGER NOT NULL DEFAULT 0;
ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_additional_users_limit_check;
ALTER TABLE companies ADD CONSTRAINT companies_additional_users_limit_check CHECK (additional_users_limit BETWEEN 0 AND 10);

COMMENT ON COLUMN companies.optional_features IS 'Developer grants for optional features; keys are tax_barcode and additional_users';
COMMENT ON COLUMN companies.additional_users_limit IS 'Developer override for extra users, 0..10, only effective when additional_users is granted';

CREATE INDEX IF NOT EXISTS idx_companies_optional_features ON companies USING gin (optional_features);
