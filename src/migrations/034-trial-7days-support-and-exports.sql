-- ============================================================
-- 034 - Trial period 7 days + subscriptions infrastructure
--
-- Business decision: the free trial is 7 DAYS (not 14). This
-- migration:
--   * Sets trial_days = 7 on all purchasable plans.
--   * Caps any in-flight 'trial' subscription end_date that was
--     previously issued with 14 days down to 7 days from start,
--     but only if it has not yet been converted to a paid plan
--     (status='trial'). Active paid subscriptions are untouched.
--   * Adds support_tickets table (users can contact admin even
--     after their subscription expires).
--   * Adds company_data_exports table (audit log for GDPR-style
--     "download my data" requests from expired users).
-- ============================================================

-- 1) Trial length is 7 days across the board.
UPDATE subscription_plans
   SET trial_days = 7,
       updated_at = NOW()
 WHERE trial_days IS DISTINCT FROM 7;

-- 2) Backfill legacy 'trial' subscriptions that were seeded at 14d
--    during the previous build. Clamp them to 7 days from start_date.
--    Paid/active/cancelled subscriptions are NOT touched.
UPDATE subscriptions
   SET end_date = GREATEST(
                     LEAST(
                       (start_date::date + INTERVAL '7 days')::date,
                       end_date::date
                     ),
                     CURRENT_DATE
                   ),
       trial_end_date = GREATEST(
                     LEAST(
                       (start_date::date + INTERVAL '7 days')::date,
                       COALESCE(trial_end_date::date, end_date::date)
                     ),
                     CURRENT_DATE
                   ),
       updated_at = NOW()
 WHERE status = 'trial'
   AND start_date IS NOT NULL;

-- 3) Support tickets — works for ALL users including expired/trial
CREATE TABLE IF NOT EXISTS support_tickets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  subject       TEXT NOT NULL,
  message       TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'general'
                CHECK (category IN ('billing','payment','technical','account','data_request','other')),
  attachment_url TEXT,
  status        TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','in_progress','resolved','closed')),
  admin_notes   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_company ON support_tickets(company_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status  ON support_tickets(status);

-- 4) Data export audit log
CREATE TABLE IF NOT EXISTS company_data_exports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','processing','ready','failed')),
  download_url  TEXT,
  expires_at    TIMESTAMPTZ,
  file_size_bytes BIGINT,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_company_exports_company ON company_data_exports(company_id);

SELECT 'Migration 034 completed — trial=7d, support tickets & data exports ready' AS result;
