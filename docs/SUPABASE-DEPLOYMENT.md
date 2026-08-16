# تطبيق الـ migrations على Supabase — Supabase Deployment Runbook

The migration suite has only ever run against a local PostgreSQL (18.4, native
`pgcrypto`) and against pglite. Supabase differs in three ways that this schema
actually touches: it ships the `anon` / `authenticated` / `service_role` roles,
it enforces RLS for those roles, and it owns the `auth`, `storage` and
`extensions` schemas. This document is the checklist for the first real apply.

Everything below was verified against a local engine with the three Supabase
roles created up front. What could not be verified here is anything that needs
live credentials — those steps are marked **[needs credentials]**.

---

## 0. Preflight — what the audit already settled

| Question | Answer | How it was checked |
|---|---|---|
| Do migrations use constructs Supabase rejects? | No. Only `gen_random_uuid()`, which Supabase provides. | `grep` across `001`–`063` |
| Does anything write to Supabase-owned schemas? | One place: `049` line 2521 seeds `storage.buckets`, guarded by `to_regclass('storage.buckets') IS NOT NULL`. Safe on both engines. | source read |
| `CREATE EXTENSION`? | `049` line 9, `pgcrypto` only, `IF NOT EXISTS`. Preinstalled on Supabase. | source read |
| Can `anon` / `authenticated` reach any table? | **No.** Zero table-level grants exist to those roles anywhere in the schema. | `information_schema.role_table_grants` |
| Is `users.password_hash` reachable by `authenticated`? | **No** — `permission denied for table users`, tested with a real `SET ROLE` + JWT claims. | live probe |
| Tenant tables with RLS off | **0 of 130** (was 51 before `063`) | `pg_class.relrowsecurity` |
| Distinct tenant policy shapes | **1** — `(company_id = tenant_company_id())` | `pg_policy` |
| SECURITY DEFINER functions without a pinned `search_path` | **0** | `pg_proc.proconfig` |

The important consequence: **RLS is defence in depth here, not the primary
control.** The application connects as the service role, and the privilege layer
(no grants at all to `anon`/`authenticated`) is what actually keeps those roles
out. That is why enabling RLS on the remaining 51 tables in `063` could not lock
the app out, and why it should not be treated as a substitute for the grants.

## 1. Apply **[needs credentials]**

```bash
export DATABASE_URL='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres'
npx tsx src/migrations/run.ts
```

Use the **session** pooler (port 5432), not the transaction pooler (6543):
the runner wraps each file in a transaction and several migrations create
functions and set session-level state, which the transaction pooler mangles.

`run.ts` records each file in `_migrations` and skips what is already applied,
so a partial failure is resumable — fix the offending file and re-run.

## 2. Verify — run this against the live database **[needs credentials]**

The migrations are idempotent; the verification is what matters. Paste into the
SQL editor:

```sql
-- (a) every tenant table is armed, and armed with the SAME policy shape
SELECT count(*) FILTER (WHERE NOT c.relrowsecurity)                    AS rls_off,
       count(DISTINCT pg_get_expr(p.polqual, p.polrelid))              AS policy_shapes
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policy p ON p.polrelid = c.oid
WHERE n.nspname = 'public' AND c.relkind = 'r'
  AND EXISTS (SELECT 1 FROM pg_attribute a
              WHERE a.attrelid = c.oid AND a.attname = 'company_id' AND NOT a.attisdropped);
-- expect: rls_off = 0, policy_shapes = 1

-- (b) anon/authenticated must hold NO table privileges. Supabase's default
--     grants are the classic way this schema would spring a leak.
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')
ORDER BY table_name;
-- expect: 0 rows. Any row here is a real exposure — revoke it.

-- (c) no SECURITY DEFINER function may float its search_path
SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prosecdef
  AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c
                  WHERE c LIKE 'search_path=%');
-- expect: 0 rows

-- (d) 062's table exists with the canonical policy, not its original broken one
SELECT polname, pg_get_expr(polqual, polrelid) FROM pg_policy
WHERE polrelid = 'public.project_task_dependencies'::regclass;
-- expect exactly one row: tenant_isolation_project_task_dependencies
--                         (company_id = tenant_company_id())
-- NOT current_setting('app.current_company', TRUE) — that was the 062 defect.
```

If (b) returns rows, Supabase's default `GRANT` to `anon`/`authenticated` has
been applied to those tables (usually by creating them through the dashboard
rather than through a migration). Revoke and re-check before going further:

```sql
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
```

## 3. Live tenant-isolation check **[needs credentials]**

Catalogue checks prove the policies exist; this proves they *work*. It is the
one test that a superuser or service-role session cannot perform, because both
bypass RLS:

```sql
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('company_id','<COMPANY_A_UUID>')::text, false);
SELECT count(*) FROM invoices;   -- expect: only company A's invoices
SELECT count(*) FROM users;      -- expect: permission denied (no grant)
RESET ROLE;
```

`invoices` is the one to watch: before `063` it carried a leftover
`USING (true)` policy from `011`, which OR-combined with the isolation policy
and exposed every tenant's invoices to any `authenticated` request.

## 3.5 Reading the live linter report (captured 2026-08-17)

The Supabase database linter output from the live project settled several open
questions. Read it as **evidence about the live state**, not just as warnings:

- **`invoices` still carries `company_isolation` with `USING (true)`** — the
  exact policy `063` deletes as its first act. Its presence PROVES `063` has
  not been applied to the live database yet. Until it is, any RLS-bound
  request can read every tenant's invoices. Applying the migrations (section 1)
  is what fixes this; do not hand-delete the policy from the dashboard, or the
  linter report and the migration history will disagree about what happened.
- **`public.rls_auto_enable()` exists on the live instance but in NO migration
  in this repository.** It was created directly on the instance (dashboard SQL
  editor or the Supabase assistant), it is SECURITY DEFINER, and `anon` can
  call it over `/rest/v1/rpc/`. `064` revokes API-role EXECUTE on it
  defensively but deliberately does not drop an object it doesn't own — drop
  it manually after confirming nothing references it (query in `064`'s
  header). Its existence also means someone attempted an RLS enablement
  outside the migration flow; expect the live catalogue to differ from a
  CI-built one until `063`/`064` run.
- **`mv_trial_balance` selectable by `anon`/`authenticated`** — the single
  worst finding, because materialized views BYPASS RLS: this is a live
  cross-tenant read of every company's trial balance for anyone with the anon
  key, today, regardless of policies. `064` revokes it (and every other MV,
  and future ones via the same sweep). This also confirms the earlier warning
  in this document: the live instance DOES have grants to API roles that the
  CI-built schema never had.
- **19 `function_search_path_mutable` warnings** — all legacy functions from
  `007`–`038`, before the repo convention of pinning `search_path`. `064` pins
  the entire catalogue generically and the migration test now asserts no
  function regresses to unpinned, so this class cannot reappear.

After applying `063` + `064`, re-run the linter: every finding above should
clear except anything created outside the repo since this capture.

## 3.6 Post-apply linter state (verified live, 2026-08-17)

`000` + `044`–`064` were applied to the live project on 2026-08-17 (69 rows in
`_migrations`, all 9 verification checks green: 0 tenant tables without RLS,
0 deny-all tenant tables, 1 policy shape, 0 `USING (true)` policies, 0 unpinned
functions, 122 atomic RPCs present).

The re-run linter reports **zero WARN findings**. What remains is INFO-level
`rls_enabled_no_policy` on ~16 tables — and that is deliberate, not debt:

- They are all **system tables without `company_id`** (`_migrations`,
  `admin_users`, `admin_sessions`, `refresh_tokens`, `password_reset_*`,
  `companies`, `subscription_plans`, `app_settings`, ...), so they are outside
  063's tenant-isolation scope by definition.
- RLS was switched on for them by the out-of-repo `rls_auto_enable()` run.
  With no policies that means **deny-all for `anon`/`authenticated`** — the
  correct posture for auth secrets and admin tables, and a safety net given
  the ~2058 default table grants Supabase hands to API roles.
- The service role bypasses RLS, so the application is unaffected.

**Do not "fix" these INFO findings by adding policies.** A policy would only
widen access. If a table here ever needs API-role reads (none does today),
grant it deliberately with a scoped policy in a migration.

## 4. Known divergence to keep in mind

`src/migrations/` (68 files, the live suite run by `run.ts`) and
`supabase/migrations/` (22 legacy files) are **different sets**. Only
`src/migrations/` is authoritative. Do not run `supabase db push`, which would
pick up the legacy directory.

`company_telegram_configs` is created twice with different shapes —
`016-approval-system.sql:99` (`company_id` as PK, no `id`) and
`020-telegram-system.sql:5` (`id UUID` PK + `company_id` FK). Both use
`CREATE TABLE IF NOT EXISTS`, so **016 wins** and 020's definition is silently a
no-op. The live shape is 016's. Worth reconciling, but it is pre-existing and
not a blocker for deployment.
