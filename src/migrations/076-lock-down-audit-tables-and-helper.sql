-- 076: Lock down platform/audit tables and an internal SECURITY DEFINER helper.
--
-- Supabase applies broad default table grants to API roles when tables are
-- created. RLS blocks ordinary row operations, but TRUNCATE does not invoke
-- RLS, so platform-only tables must also have their table privileges revoked.
-- The expense-account resolver is an internal helper called only by the
-- service-role purchase-invoice RPC and must not be executable through the
-- public PostgREST roles.

REVOKE ALL PRIVILEGES ON TABLE public.global_backup_journal
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.registration_attempts
  FROM PUBLIC, anon, authenticated;

GRANT ALL PRIVILEGES ON TABLE public.global_backup_journal TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.registration_attempts TO service_role;

REVOKE ALL ON FUNCTION public.resolve_other_expense_account(UUID, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_other_expense_account(UUID, TEXT, UUID)
  TO service_role;
