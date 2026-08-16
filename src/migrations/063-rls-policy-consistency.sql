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
-- 3) Guarantee the canonical isolation policy exists on every tenant table
--    that has RLS enabled, including any table (like `invoices`) whose only
--    policy was just dropped, and re-point 062's table at the 027 shape.
-- ------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname AS tbl, c.oid AS reloid
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity
      AND EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = c.oid AND a.attname = 'company_id' AND NOT a.attisdropped
      )
  LOOP
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
