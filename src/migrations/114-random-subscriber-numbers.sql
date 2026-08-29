-- 114: Un-guessable subscriber numbers (حروف وأرقام، 12 خانة).
--
-- Production finding 2026-08: migration 112 allocated subscriber_number from
-- subscriber_number_seq (1000, 1001, 1002, …). A sequential number lets anyone
-- who knows one subscriber number enumerate the neighbours and use them in
-- support/social-engineering attacks against OTHER companies ("أنا المشترك
-- #1001 وأ فقدت الوصول"). The number is also displayed inside the product, so
-- it must not leak the population order or size.
--
-- Fix, without touching the trigger or the UNIQUE constraint from 112:
--   1. next_subscriber_number() is replaced with a random allocator:
--      12 characters from an unambiguous alphabet (no 0/O/1/I/L) grouped as
--      XXXX-XXXX-XXXX (~31^12 ≈ 8×10^17 combinations), retried on collision.
--      A caller would need to guess a specific 12-char string — as hard as
--      guessing a password of the same length, and each company keeps exactly
--      one permanent number to cite in support conversations.
--   2. Every EXISTING subscription is re-numbered once, in created_at order.
--      The previously issued numbers are all pure sequence digits, i.e. all
--      guessable, so keeping any of them would defeat the purpose. This is a
--      one-time change: the random numbers issued here are permanent and are
--      never re-issued again (the trigger only fills NULL/blank values).
--   3. subscriber_number_seq is dropped — the sequence allocator is gone so
--      no future code path can accidentally reintroduce sequential numbers.
--
-- The 112 trigger (assign_subscriber_number) and UNIQUE constraint stay: any
-- row inserted without a number still receives one, and duplicates remain
-- impossible.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.next_subscriber_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_alphabet CONSTANT TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- no 0/O/1/I/L
  v_code TEXT;
  v_i INT;
BEGIN
  LOOP
    v_code := '';
    FOR v_i IN 1..12 LOOP
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::INT, 1);
      IF v_i IN (4, 8) THEN
        v_code := v_code || '-';
      END IF;
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM subscriptions WHERE subscriber_number = v_code);
  END LOOP;
  RETURN v_code;
END
$$;
REVOKE ALL ON FUNCTION public.next_subscriber_number() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_subscriber_number() TO service_role;

-- One-time re-issue: every subscriber_number that is NULL/blank or a legacy
-- pure-digit (sequential) value is replaced with a random code. Rows keep
-- their history; only the displayed number changes.
DO $$
DECLARE
  v_sub_id UUID;
  v_count INTEGER := 0;
BEGIN
  FOR v_sub_id IN
    SELECT id FROM subscriptions
    WHERE subscriber_number IS NULL
       OR btrim(subscriber_number) = ''
       OR btrim(subscriber_number) ~ '^[0-9]+$'
    ORDER BY created_at, id
  LOOP
    UPDATE subscriptions
    SET subscriber_number = public.next_subscriber_number()
    WHERE id = v_sub_id;
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE '114: re-issued % subscriber number(s) as unguessable codes', v_count;
END $$;

-- Re-check duplicates after re-issue (defensive; the random allocator already
-- collision-checks, but a unique violation here must never block production).
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
    RAISE NOTICE '114: renumbered % duplicate subscriber_number value(s)', v_count;
  END IF;
END $$;

-- The sequential allocator is retired for good.
DROP SEQUENCE IF EXISTS public.subscriber_number_seq;

COMMENT ON COLUMN subscriptions.subscriber_number IS
  'رقم المشترك - عشوائي غير قابل للتخمين (12 خانة حروف وأرقام) وفريد ولا يتغير';

SELECT 'Migration 114 completed — subscriber numbers are now random, 12-char and unguessable' AS result;
