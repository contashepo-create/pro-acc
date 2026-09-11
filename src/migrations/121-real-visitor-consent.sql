-- 121 - Privacy-aware real visitor identity. The opaque device id is not an IP
-- address and is only used for aggregate visitor counts.
ALTER TABLE visitor_logs ADD COLUMN IF NOT EXISTS visitor_id TEXT;
ALTER TABLE visitor_logs ADD COLUMN IF NOT EXISTS country TEXT;
CREATE INDEX IF NOT EXISTS idx_visitor_logs_visitor_date ON visitor_logs(visitor_id, created_at);
