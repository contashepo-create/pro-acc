-- ============================================================
-- 081 — admin_users.telegram_bot_token: encryption at rest
--
-- This column held the per-admin Telegram bot token in PLAINTEXT.
-- A token of this shape was committed to the repository history
-- once (see .gitleaks.toml), and any database backup/dump carried
-- the credential in cleartext. The previously committed token has
-- already been revoked at the Telegram side.
--
-- Policy from this migration onward:
--   * the column stores ONLY the encrypted envelope:
--         enc:v1:<iv_b64>:<authtag_b64>:<ciphertext_b64>
--     (AES-256-GCM; key = server env var TELEGRAM_TOKEN_KEY,
--      64 hex chars; AAD "pro-acc/admin-telegram-bot-token/v1").
--   * the application writes/reads it through
--     src/lib/telegram-token-crypto.ts; the ops scripts use the
--     byte-identical format in scripts/lib/telegram-token-crypto.mjs
--     (both pinned by the same known-answer test vectors).
--   * NULL is the normal state when an admin has no dedicated bot —
--     the global TELEGRAM_BOT_TOKEN env var is the default path.
--
-- Steps:
--   1) DROP NOT NULL so admins without a dedicated bot are valid.
--   2) NULL out any remaining plaintext Telegram-token-shaped values.
--      Encrypted envelopes (enc:v1:...) never match the shape and are
--      left untouched. Because the leaked token is already revoked,
--      clearing the stale plaintext loses no working credential; the
--      value can be re-stored encrypted through the admin API
--      (/api/admin/admins/[id]/telegram-token) or the seed scripts.
-- ============================================================

ALTER TABLE public.admin_users ALTER COLUMN telegram_bot_token DROP NOT NULL;

UPDATE public.admin_users
   SET telegram_bot_token = NULL
 WHERE telegram_bot_token ~ '^[0-9]{8,10}:A[A-Za-z0-9_-]{30,100}$';

COMMENT ON COLUMN public.admin_users.telegram_bot_token IS
  'Encrypted per-admin Telegram bot token: enc:v1:<iv>:<authtag>:<ciphertext> (AES-256-GCM, key TELEGRAM_TOKEN_KEY, AAD pro-acc/admin-telegram-bot-token/v1). Plaintext tokens are forbidden; NULL means the global TELEGRAM_BOT_TOKEN applies.';
