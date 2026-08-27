-- ============================================================
-- 028 — Password-reset request tracking (real rate limiting + delivery log)
--
-- Problem fixed:
--   checkRateLimit() counts rows in `login_attempts`, but the forgot/resend
--   endpoints never write there, so the count was always 0 and requests were
--   never throttled. This table gives those endpoints their own counter AND a
--   delivery log so we can diagnose when an email fails to send.
-- ============================================================

CREATE TABLE IF NOT EXISTS password_reset_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  ip_address TEXT NOT NULL DEFAULT 'unknown',
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'delivered', 'failed')),
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Rate-limit query: count recent requests for the same email OR IP.
CREATE INDEX IF NOT EXISTS idx_pw_reset_requests_email_time
  ON password_reset_requests (email, created_at);
CREATE INDEX IF NOT EXISTS idx_pw_reset_requests_ip_time
  ON password_reset_requests (ip_address, created_at);
