-- 079: Keep the public RPC surface server-only.
-- The browser never invokes PostgreSQL functions directly. API routes call
-- them with service_role after application authentication/authorization.
-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default, so revoke
-- both current and future grants from API roles and PUBLIC.

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO service_role;

-- RLS policy expressions execute as the querying API role. This SECURITY
-- INVOKER helper only reads that role's own request.jwt.claims GUC and is the
-- sole intentional API-role function grant.
GRANT EXECUTE ON FUNCTION public.tenant_company_id()
  TO anon, authenticated, service_role;
