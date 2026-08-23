-- ============================================================
-- 077 — Shared, atomic rate-limit store
--
-- The in-memory limiter (src/lib/memory-rate-limit.ts) keeps its buckets in a
-- per-process Map: on serverless every cold instance starts empty, so a
-- client can bypass the business-route budget by rotating instances. The
-- auth routes already count against real tables (login_attempts, etc.); this
-- migration gives the ~220 business routes the same guarantee with ONE
-- generic store:
--
--   rate_limit_buckets(key, window_start, hits)
--
-- `hit_rate_limit(p_key, p_window_ms, p_max)` is a SINGLE atomic statement
-- (INSERT ... ON CONFLICT DO UPDATE): concurrent hits on the same key are
-- serialized on the row and each one sees the previous increment, so the
-- distributed budget can never be over-allocated. The application keeps the
-- in-memory limiter as a cheap fast path (instant local rejection) and this
-- store as the authoritative cross-instance share.
--
-- Rows are bounded by the number of active (principal, read/write) keys and
-- are pruned by `prune_rate_limit_buckets` (call it from any maintenance
-- job; the window itself only recycles, never deletes, rows).
--
-- Idempotent by design (IF NOT EXISTS / CREATE OR REPLACE), matching the
-- rest of the chain.
-- ============================================================

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  key TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL,
  hits INTEGER NOT NULL DEFAULT 1 CHECK (hits >= 0)
);

-- The store is written exclusively through the service role (every API route
-- runs as service role); no API role may read or tamper with the counters.
ALTER TABLE rate_limit_buckets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rate_limit_buckets service only" ON public.rate_limit_buckets;
CREATE POLICY "rate_limit_buckets service only"
  ON public.rate_limit_buckets FOR ALL
  TO service_role USING (TRUE) WITH CHECK (TRUE);

CREATE OR REPLACE FUNCTION public.hit_rate_limit(
  p_key TEXT,
  p_window_ms INTEGER,
  p_max INTEGER
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_window INTERVAL := make_interval(secs => p_window_ms / 1000.0);
  v_row rate_limit_buckets%ROWTYPE;
BEGIN
  IF p_key IS NULL OR LENGTH(p_key) > 200 THEN
    RAISE EXCEPTION 'invalid rate limit key';
  END IF;
  IF p_window_ms IS NULL OR p_window_ms < 1000 THEN
    RAISE EXCEPTION 'invalid rate limit window';
  END IF;
  IF p_max IS NULL OR p_max < 1 THEN
    RAISE EXCEPTION 'invalid rate limit budget';
  END IF;

  -- Atomic read-modify-write: the ON CONFLICT target row is locked, so two
  -- concurrent hits on the same key can never both pass the budget.
  INSERT INTO rate_limit_buckets(key, window_start, hits)
  VALUES (p_key, v_now, 1)
  ON CONFLICT (key) DO UPDATE SET
    window_start = CASE WHEN rate_limit_buckets.window_start < v_now - v_window
                        THEN v_now ELSE rate_limit_buckets.window_start END,
    hits = CASE WHEN rate_limit_buckets.window_start < v_now - v_window
                THEN 1 ELSE rate_limit_buckets.hits + 1 END
  RETURNING * INTO v_row;

  IF v_row.hits > p_max THEN
    RETURN jsonb_build_object(
      'allowed', FALSE,
      'retry_after_seconds', GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_row.window_start + v_window - v_now)))::INTEGER)
    );
  END IF;
  RETURN jsonb_build_object('allowed', TRUE, 'retry_after_seconds', 0);
END;
$$;

-- Maintenance: drop buckets idle for longer than the given window so the
-- table does not accumulate keys of long-gone users.
CREATE OR REPLACE FUNCTION public.prune_rate_limit_buckets(p_max_age_ms INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_removed INTEGER;
BEGIN
  IF p_max_age_ms IS NULL OR p_max_age_ms < 1000 THEN
    RAISE EXCEPTION 'invalid prune window';
  END IF;
  DELETE FROM rate_limit_buckets
  WHERE window_start < NOW() - make_interval(secs => p_max_age_ms / 1000.0);
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  RETURN COALESCE(v_removed, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.hit_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prune_rate_limit_buckets(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hit_rate_limit(TEXT, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.prune_rate_limit_buckets(INTEGER) TO service_role;
REVOKE ALL ON TABLE rate_limit_buckets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE rate_limit_buckets TO service_role;
