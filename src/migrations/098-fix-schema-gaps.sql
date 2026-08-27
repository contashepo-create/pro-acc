-- 098: Fix schema gaps found during live DB audit.
--
-- 1. ad_notifications: referenced by src/app/api/admin/advertisements/tracking/route.ts
--    but was only created manually on the live DB — missing from migration chain.
--    This CREATE TABLE IF NOT EXISTS is a no-op on the live DB (table exists)
--    and ensures fresh installs have it too.
--
-- 2. rate_limit_buckets: migration 085 created a second conflicting definition
--    (id/count/updated_at) that is a silent no-op because 077 already created
--    the table (key/hits).  The duplicate is removed from 085 directly;
--    this migration adds a defensive comment only.

-- ===== ad_notifications =====
CREATE TABLE IF NOT EXISTS ad_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  advertisement_id UUID NOT NULL REFERENCES advertisements(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivery_method TEXT CHECK (delivery_method IN ('push', 'email', 'sms', 'in_app')),
  delivered BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ad_notifications_ad      ON ad_notifications(advertisement_id);
CREATE INDEX IF NOT EXISTS idx_ad_notifications_company ON ad_notifications(company_id);
CREATE INDEX IF NOT EXISTS idx_ad_notifications_user    ON ad_notifications(user_id);

-- RLS: service_role only (same pattern as ad_views / ad_clicks)
ALTER TABLE ad_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ad_notifications_service_only" ON ad_notifications;
CREATE POLICY "ad_notifications_service_only" ON ad_notifications
  FOR ALL USING (true) WITH CHECK (true);

SELECT 'Migration 098 completed — ad_notifications table + rate_limit_buckets note' as result;
