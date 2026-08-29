-- 112: Every subscriber gets a unique, permanent subscriber_number.
--
-- 041 added subscriptions.subscriber_number (TEXT) and subscriber_number_seq
-- "used by admin companies endpoint" — but no code path ever assigned a value
-- (register_company, activation-code redemption and upgrade approval all
-- INSERT without it), so every subscription in production carries NULL: the
-- settings page fell back to an 8-char UUID fragment and the developer panel
-- showed "—" for every company. Fix in four layers:
--
--   0. Type normalization (production finding 2026-08): in some environments
--      the column pre-existed as INTEGER before 041, so 041's
--      ADD COLUMN IF NOT EXISTS ... TEXT was a silent no-op and every
--      btrim(subscriber_number) died with 42883 (btrim(integer)).
--      Coerce to TEXT first — the admin search (PostgREST ilike) and the
--      trigger both require a text column.
--   1. Collision-proof allocation: every assignment goes through
--      next_subscriber_number(), which advances the sequence past any value
--      already present in the table. A plain nextval() can collide with
--      manually assigned or legacy values (e.g. the sequence at 1000 backfills
--      a NULL to "1000" while "1001" exists twice, then the duplicate
--      renumber mints the second "1001" → the UNIQUE below fails).
--   2. Backfill every NULL/blank row in created_at order, so the earliest
--      subscribers get the lowest numbers; pre-existing duplicate values are
--      renumbered (the earliest-created row of each value keeps it).
--   3. BEFORE INSERT OR UPDATE trigger assigns the next number to any row
--      saved without one — covers every current and future creation path
--      (RPCs, admin routes, manual SQL), and re-assigns if a number is ever
--      cleared, so a subscriber always has exactly one number to send the
--      developer.
--   4. UNIQUE constraint so a number always identifies exactly one
--      subscriber.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'subscriptions' AND column_name = 'subscriber_number'
  ) THEN
    ALTER TABLE subscriptions ADD COLUMN subscriber_number TEXT;
  ELSIF (
    SELECT data_type FROM information_schema.columns
    WHERE table_name = 'subscriptions' AND column_name = 'subscriber_number'
  ) NOT IN ('text', 'character varying') THEN
    ALTER TABLE subscriptions
      ALTER COLUMN subscriber_number TYPE TEXT
      USING subscriber_number::text;
  END IF;
END $$;
CREATE SEQUENCE IF NOT EXISTS subscriber_number_seq START 1000;

CREATE OR REPLACE FUNCTION public.next_subscriber_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_next TEXT;
BEGIN
  LOOP
    v_next := nextval('public.subscriber_number_seq')::text;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM subscriptions WHERE subscriber_number = v_next);
  END LOOP;
  RETURN v_next;
END
$$;
REVOKE ALL ON FUNCTION public.next_subscriber_number() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_subscriber_number() TO service_role;

DO $$
DECLARE v_count INTEGER := 0; v_sub_id UUID;
BEGIN
  FOR v_sub_id IN
    SELECT id FROM subscriptions
    WHERE subscriber_number IS NULL OR btrim(subscriber_number) = ''
    ORDER BY created_at, id
  LOOP
    UPDATE subscriptions
    SET subscriber_number = public.next_subscriber_number()
    WHERE id = v_sub_id;
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE '112: assigned subscriber numbers to % subscription(s)', v_count;
END $$;

DO $$
DECLARE v_count INTEGER;
BEGIN
  WITH dupes AS (
    SELECT s.id,
           ROW_NUMBER() OVER (PARTITION BY s.subscriber_number ORDER BY s.created_at, s.id) AS rn
    FROM subscriptions s
    WHERE s.subscriber_number IS NOT NULL AND btrim(s.subscriber_number) <> ''
  )
  UPDATE subscriptions s
  SET subscriber_number = public.next_subscriber_number()
  FROM dupes d
  WHERE s.id = d.id AND d.rn > 1;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count > 0 THEN
    RAISE NOTICE '112: renumbered % duplicate subscriber_number value(s)', v_count;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.assign_subscriber_number()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public, extensions, pg_temp AS $$
BEGIN
  IF NEW.subscriber_number IS NULL OR btrim(NEW.subscriber_number) = '' THEN
    NEW.subscriber_number := public.next_subscriber_number();
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.assign_subscriber_number() FROM PUBLIC, anon, authenticated;

-- A direct service_role insert (future admin routes) must be able to drive
-- the allocator's nextval call. anon/authenticated stay out of this by design.
GRANT USAGE, UPDATE ON SEQUENCE subscriber_number_seq TO service_role;

DROP TRIGGER IF EXISTS trg_subscriptions_assign_subscriber_number ON subscriptions;
CREATE TRIGGER trg_subscriptions_assign_subscriber_number
  BEFORE INSERT OR UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.assign_subscriber_number();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_subscriber_number_key') THEN
    ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_subscriber_number_key UNIQUE (subscriber_number);
  END IF;
END $$;

COMMENT ON COLUMN subscriptions.subscriber_number IS 'رقم المشترك - فريد ولا يتكرر';

SELECT 'Migration 112 completed — unique subscriber numbers for every subscription' as result;
