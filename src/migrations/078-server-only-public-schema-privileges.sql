-- 078: The application is server-only with respect to PostgreSQL/Supabase.
-- Browser code never queries public tables directly; every request passes
-- through authenticated API routes using service_role. Remove Supabase's broad
-- API-role grants (including TRUNCATE, which bypasses RLS) and prevent them
-- from returning on objects created by later migrations.

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public
  FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public
  FROM anon, authenticated;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO service_role;
