-- ============================================================
-- Migration: Enhanced Advertisements System with Display Modes
-- Date: 2026-07-19
-- Description: Add display modes, tracking, and notification tables
-- ============================================================

-- 1. Update display_mode column to support new modes
ALTER TABLE advertisements 
ALTER COLUMN display_mode SET DEFAULT 'banner';

-- 2. Add tracking columns to advertisements table
ALTER TABLE advertisements 
ADD COLUMN IF NOT EXISTS views INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS clicks INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS notifications_sent INTEGER DEFAULT 0;

-- 3. Create table to track ad views by users
CREATE TABLE IF NOT EXISTS ad_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  advertisement_id UUID NOT NULL REFERENCES advertisements(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  viewed_at TIMESTAMPTZ DEFAULT NOW(),
  ip_address TEXT,
  user_agent TEXT,
  UNIQUE(advertisement_id, company_id, user_id)
);

-- 4. Create table to track ad clicks by users
CREATE TABLE IF NOT EXISTS ad_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  advertisement_id UUID NOT NULL REFERENCES advertisements(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  clicked_at TIMESTAMPTZ DEFAULT NOW(),
  ip_address TEXT,
  user_agent TEXT,
  UNIQUE(advertisement_id, company_id, user_id)
);

-- 5. Create table to track notifications sent to users
CREATE TABLE IF NOT EXISTS ad_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  advertisement_id UUID NOT NULL REFERENCES advertisements(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  delivery_method TEXT NOT NULL CHECK(delivery_method IN ('in_app', 'email', 'telegram', 'push')),
  delivered BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  UNIQUE(advertisement_id, company_id, user_id)
);

-- 6. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_ad_views_advertisement ON ad_views(advertisement_id);
CREATE INDEX IF NOT EXISTS idx_ad_views_company ON ad_views(company_id);
CREATE INDEX IF NOT EXISTS idx_ad_views_user ON ad_views(user_id);
CREATE INDEX IF NOT EXISTS idx_ad_views_date ON ad_views(viewed_at DESC);

CREATE INDEX IF NOT EXISTS idx_ad_clicks_advertisement ON ad_clicks(advertisement_id);
CREATE INDEX IF NOT EXISTS idx_ad_clicks_company ON ad_clicks(company_id);
CREATE INDEX IF NOT EXISTS idx_ad_clicks_user ON ad_clicks(user_id);
CREATE INDEX IF NOT EXISTS idx_ad_clicks_date ON ad_clicks(clicked_at DESC);

CREATE INDEX IF NOT EXISTS idx_ad_notifications_advertisement ON ad_notifications(advertisement_id);
CREATE INDEX IF NOT EXISTS idx_ad_notifications_company ON ad_notifications(company_id);
CREATE INDEX IF NOT EXISTS idx_ad_notifications_user ON ad_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_ad_notifications_date ON ad_notifications(sent_at DESC);

-- 7. Create function to update view count
CREATE OR REPLACE FUNCTION update_ad_view_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE advertisements 
  SET views = views + 1 
  WHERE id = NEW.advertisement_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 8. Create trigger for view count
DROP TRIGGER IF EXISTS tr_update_ad_view_count ON ad_views;
CREATE TRIGGER tr_update_ad_view_count
AFTER INSERT ON ad_views
FOR EACH ROW
EXECUTE FUNCTION update_ad_view_count();

-- 9. Create function to update click count
CREATE OR REPLACE FUNCTION update_ad_click_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE advertisements 
  SET clicks = clicks + 1 
  WHERE id = NEW.advertisement_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 10. Create trigger for click count
DROP TRIGGER IF EXISTS tr_update_ad_click_count ON ad_clicks;
CREATE TRIGGER tr_update_ad_click_count
AFTER INSERT ON ad_clicks
FOR EACH ROW
EXECUTE FUNCTION update_ad_click_count();

-- 11. Create function to update notifications sent count
CREATE OR REPLACE FUNCTION update_ad_notification_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE advertisements 
  SET notifications_sent = notifications_sent + 1 
  WHERE id = NEW.advertisement_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 12. Create trigger for notification count
DROP TRIGGER IF EXISTS tr_update_ad_notification_count ON ad_notifications;
CREATE TRIGGER tr_update_ad_notification_count
AFTER INSERT ON ad_notifications
FOR EACH ROW
EXECUTE FUNCTION update_ad_notification_count();

-- 13. Add comments for documentation
COMMENT ON COLUMN advertisements.display_mode IS 'Display mode: banner=AdBanner component, popup=AdPopup component, notification=in-app notification';
COMMENT ON COLUMN advertisements.views IS 'Total number of times this ad was viewed';
COMMENT ON COLUMN advertisements.clicks IS 'Total number of times users clicked on this ad';
COMMENT ON COLUMN advertisements.notifications_sent IS 'Total number of notifications sent for this ad';

COMMENT ON TABLE ad_views IS 'Track which companies/users viewed each advertisement';
COMMENT ON TABLE ad_clicks IS 'Track which companies/users clicked on each advertisement';
COMMENT ON TABLE ad_notifications IS 'Track which companies/users received notifications for each advertisement';