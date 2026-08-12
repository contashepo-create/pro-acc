-- ============================================================
-- 025 - token_version session invalidation
-- Enables server-side revocation of JWTs (logout / password change)
-- by bumping a per-user counter. Tokens embed this version and are
-- rejected when they no longer match the stored value.
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

-- Existing sessions are issued before this column existed; they carry no
-- version (treated as 0), which matches the DEFAULT 0 for current users.
-- Index not strictly required (lookup is by user id), but helpful.
CREATE INDEX IF NOT EXISTS idx_users_token_version ON users (token_version);
