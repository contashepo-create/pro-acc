-- ============================================================
-- 063 — RLS policy consistency across tenant tables
--
-- Migration 027 installed the tenant isolation layer:
--     USING (company_id = public.tenant_company_id())
-- where `tenant_company_id()` reads `company_id` from the request JWT claims.
--
-- Three defects survived it. None of them is visible on a local PostgreSQL
-- superuser session (which bypasses RLS entirely) and none is visible while
-- every query runs through the service role (which also bypasses RLS). They
-- only surface under Supabase's `anon` / `authenticated` roles — i.e. exactly
-- the layer the migration suite never exercised.
--
--   1) `invoices` still carries the legacy permissive policy `company_isolation`
--      from 011, created as `USING (true)` with the comment "permissive for now,
--      will be tightened when using anon key". 027 dropped `company_isolation_
--      invoices` and `tenant_isolation_invoices` but never the bare
--      `company_isolation` name, so the policy stayed.
--
--      PostgreSQL OR-combines PERMISSIVE policies. `true OR (company_id = ...)`
--      is `true`, so the isolation policy on the ledger's most sensitive table
--      was dead on arrival: any `authenticated` request read EVERY tenant's
--      invoices. Reproduced against a real engine before writing this fix.
--
--   2) `project_task_dependencies` (062) claims in its own comment to "mirror
--      the tenant policy shape used by 027", but matches on
--      `current_setting('app.current_company', TRUE)` — a GUC that nothing in
--      this repository ever sets. It therefore evaluates to NULL and denies all
--      rows for any RLS-bound role: fail-closed, but permanently broken, and
--      inconsistent with the other 74 tenant tables.
--
--   3) `public.tenant_company_id()` is SECURITY DEFINER without a pinned
--      `search_path`. It is the only such function left in the schema, and it
--      is the one function granted to `anon` and `authenticated` — the exact
--      combination a search_path hijack needs. Every other SECURITY DEFINER
--      function in the schema already pins `search_path=public`.
--
--   4) 027 drove its enrolment loop from a hardcoded `tenant_tables[]` array,
--      so it only ever covered the tables that existed when it was written.
--      51 of the 130 tables that carry a `company_id` were added by later
--      migrations and had RLS switched off altogether — no policy to get wrong,
--      because the row filter was never armed. Part 4 below enrols the table
--      set discovered from the catalogue rather than a literal list, so tenant
--      tables added in future are covered automatically.
--
-- Idempotent and safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Pin search_path on the tenant claim helper.
--    Recreated with the identical body plus `SET search_path`; policies that
--    reference it keep working because the signature is unchanged.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tenant_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT NULLIF(
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'company_id',
    ''
  )::uuid;
$$;

-- ------------------------------------------------------------
-- 2) Remove every legacy permissive policy that neutralises tenant isolation.
--
--    Scanned generically rather than by name: any PERMISSIVE policy whose USING
--    expression is literally `true` on a table that owns a `company_id` column
--    defeats that table's isolation policy the same way, so the sweep also
--    catches equivalents that predate this migration on other tables.
-- ------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname AS tbl, pol.polname AS pol
    FROM pg_policy pol
    JOIN pg_class c      ON c.oid = pol.polrelid
    JOIN pg_namespace n  ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND pol.polpermissive
      AND coalesce(pg_get_expr(pol.polqual, pol.polrelid), 'true') = 'true'
      AND EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = c.oid AND a.attname = 'company_id' AND NOT a.attisdropped
      )
      -- Never drop the real isolation policy itself.
      AND pol.polname <> 'tenant_isolation_' || c.relname
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.pol, r.tbl);
    RAISE NOTICE '063: dropped permissive policy %.%', r.tbl, r.pol;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 3+4) Enable RLS and install the canonical isolation policy on EVERY table that
--    owns a `company_id`, not just the ones 027 happened to list.
--
--    027 drove its loop from a hardcoded `tenant_tables[]` array, so the 51
--    tenant tables added by later migrations were never enrolled and still had
--    RLS switched off entirely. Discovering the table set from the catalogue
--    instead of a literal list is what stops that drift from recurring: any
--    future table with a `company_id` is covered the moment this runs.
--
--    Enabling RLS here cannot lock the application out. No table in this schema
--    grants SELECT/INSERT/UPDATE/DELETE to `anon` or `authenticated` (verified
--    against the catalogue), the application connects through the service role,
--    and both the service role and the table owner bypass RLS. For the roles
--    that RLS does bind, this converts silent full access into tenant-scoped
--    access — defence in depth behind the existing privilege layer.
-- ------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname AS tbl, c.oid AS reloid, c.relrowsecurity AS rls_on
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = c.oid AND a.attname = 'company_id' AND NOT a.attisdropped
      )
  LOOP
    IF NOT r.rls_on THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.tbl);
      RAISE NOTICE '063: enabled RLS on %', r.tbl;
    END IF;

    -- Drop a stale isolation policy only when its expression is not already the
    -- canonical one, so re-runs do not churn healthy tables.
    IF EXISTS (
      SELECT 1 FROM pg_policy p
      WHERE p.polrelid = r.reloid
        AND p.polname = 'tenant_isolation_' || r.tbl
        AND pg_get_expr(p.polqual, p.polrelid) IS DISTINCT FROM '(company_id = tenant_company_id())'
    ) THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'tenant_isolation_' || r.tbl, r.tbl);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policy p
      WHERE p.polrelid = r.reloid AND p.polname = 'tenant_isolation_' || r.tbl
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I
           FOR ALL
           USING (company_id = public.tenant_company_id())
           WITH CHECK (company_id = public.tenant_company_id())',
        'tenant_isolation_' || r.tbl, r.tbl
      );
      RAISE NOTICE '063: installed canonical isolation policy on %', r.tbl;
    END IF;
  END LOOP;
END $$;

-- 062's policy name differs from the canonical one, so the block above added
-- the correct policy alongside it. Remove the GUC-based duplicate: leaving it
-- in place would OR a permanently-NULL predicate into the table's ACL, which is
-- harmless today but misleading to read.
DROP POLICY IF EXISTS project_task_dependencies_tenant_isolation ON project_task_dependencies;
