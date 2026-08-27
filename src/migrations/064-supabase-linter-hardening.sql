-- ============================================================
-- 064 — Supabase linter hardening
--
-- Driven by the Supabase database linter output captured from the LIVE
-- project (2026-08-17). Four finding classes, and the same lesson as 027/063
-- applies: every fix below is discovered from the catalogue, never from a
-- hand-written list, so functions added later are covered automatically.
--
--   1) `function_search_path_mutable` (19 hits): legacy functions from
--      007/011/012/015/022/023/027/029/031/038 predate the repo convention of
--      pinning `search_path`. An unpinned function resolves table and function
--      names through the CALLER's search_path, so a role that can create
--      objects in an earlier schema can shadow `invoices` or `digest()` and
--      have privileged code execute against the impostor. Everything from 049
--      onwards already pins; this sweeps every remaining unpinned function.
--
--      The pin is `public, extensions, pg_temp` — not bare `public` — because
--      on hosted Supabase pgcrypto lives in the `extensions` schema, so a
--      function pinned to `public` alone cannot see `digest()` there. On CI /
--      local PostgreSQL no `extensions` schema exists and PostgreSQL simply
--      ignores the missing entry, so the same pin is valid everywhere.
--
--   2) The same pgcrypto placement breaks functions that 049+ ALREADY pinned
--      to `search_path=public` and that call `digest()`: correct on CI (where
--      CREATE EXTENSION installs into public), broken on hosted Supabase.
--      Those get their pin widened to include `extensions` too.
--
--   3) `materialized_view_in_api`: `mv_trial_balance` is selectable by
--      `anon`/`authenticated`. Materialized views are NOT subject to RLS, so
--      unlike the tables around it this is a live cross-tenant read of every
--      company's trial balance for anyone holding the anon key. The
--      application reads it exclusively through the service role; nothing
--      legitimate loses access by revoking the API roles.
--
--   4) `anon_security_definer_function_executable`:
--      - `tenant_company_id()`: flagged because it is SECURITY DEFINER and
--        callable by anon/authenticated (the EXECUTE grant is required — RLS
--        policy expressions evaluate as the querying role). But the function
--        only reads `request.jwt.claims`, a GUC every role can already read
--        about its own request: DEFINER buys nothing and is pure lint
--        surface. Recreated as SECURITY INVOKER — same signature, same body,
--        same behaviour under RLS.
--      - `rls_auto_enable()`: exists on the live project but in NO migration
--        in this repository — it was created directly on the instance
--        (dashboard / Supabase assistant). Unknown SECURITY DEFINER plpgsql
--        reachable by `anon` over `/rest/v1/rpc/` is an unacceptable surface,
--        so its EXECUTE is revoked here defensively. It is deliberately NOT
--        dropped: it is not this repository's object, and 063 already covers
--        (better, and idempotently) what its name suggests it does. Drop it
--        manually after confirming no event trigger depends on it:
--          SELECT evtname FROM pg_event_trigger
--          WHERE evtfoid = 'public.rls_auto_enable()'::regprocedure;
--          DROP FUNCTION public.rls_auto_enable();
--
-- Idempotent and safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1) tenant_company_id: SECURITY INVOKER, pinned. CREATE OR REPLACE keeps the
--    OID, so every tenant_isolation_* policy referencing it is untouched.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tenant_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT NULLIF(
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'company_id',
    ''
  )::uuid;
$$;

-- ------------------------------------------------------------
-- 2) Pin search_path on every remaining unpinned function in public.
--    Catalogue-driven; skips extension-owned members (pg_depend deptype 'e')
--    so a locally-installed pgcrypto is not rewritten, and covers both
--    functions and procedures via ALTER ROUTINE.
-- ------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l  ON l.oid = p.prolang
    WHERE n.nspname = 'public'
      AND p.prokind IN ('f', 'p')
      AND l.lanname IN ('sql', 'plpgsql')
      AND NOT EXISTS (
        SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) cfg
        WHERE cfg LIKE 'search_path=%'
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.objid = p.oid AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format('ALTER ROUTINE %s SET search_path = public, extensions, pg_temp', r.sig);
    RAISE NOTICE '064: pinned search_path on %', r.sig;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 3) Widen the pin on already-pinned functions that call digest():
--    `search_path=public` cannot resolve pgcrypto on hosted Supabase, where
--    the extension lives in `extensions`. Only exact `public`-pinned bodies
--    that reference digest( are touched; everything else keeps its pin.
-- ------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind IN ('f', 'p')
      AND p.prosrc LIKE '%digest(%'
      AND EXISTS (
        SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) cfg
        WHERE cfg IN ('search_path=public', 'search_path="public"')
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.objid = p.oid AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format('ALTER ROUTINE %s SET search_path = public, extensions, pg_temp', r.sig);
    RAISE NOTICE '064: widened search_path (digest caller) on %', r.sig;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 4) Materialized views are not covered by RLS: no API role may read them.
--    Applied to every MV in public, not just mv_trial_balance, and to future
--    ones via default privileges — MVs and tables share the relation
--    privilege machinery, and the app touches MVs through the service role
--    only.
-- ------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname AS mv
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'm'
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', r.mv);
    RAISE NOTICE '064: revoked API-role access on materialized view %', r.mv;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 5) rls_auto_enable(): out-of-repo SECURITY DEFINER function on the live
--    instance. Revoke API-role EXECUTE if present (guarded — it does not
--    exist in CI databases built purely from these migrations).
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'rls_auto_enable' AND p.pronargs = 0
  ) THEN
    REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
    RAISE NOTICE '064: revoked API-role EXECUTE on out-of-repo rls_auto_enable()';
  END IF;
END $$;
