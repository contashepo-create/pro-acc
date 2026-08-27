-- 077: Internal trigger functions must not be directly executable by API roles.
-- Revoking direct EXECUTE does not disable their attached triggers.

REVOKE ALL ON FUNCTION public.bootstrap_company_fiscal_year()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_salary_item_project_tenant()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.touch_overhead_allocation()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.bootstrap_company_fiscal_year() TO service_role;
GRANT EXECUTE ON FUNCTION public.guard_salary_item_project_tenant() TO service_role;
GRANT EXECUTE ON FUNCTION public.touch_overhead_allocation() TO service_role;
