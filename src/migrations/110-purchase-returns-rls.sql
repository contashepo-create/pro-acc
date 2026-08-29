-- 110: RLS tenant isolation for the purchase-returns tables (migration 109).
--
-- 109 created three tenant tables — purchase_returns, purchase_return_items,
-- purchase_return_sequences — after 104's catalogue sweep had already run, so
-- they missed the RLS enrollment. This is the same drift class 027/063 fixed:
-- a table with a company_id that any role holding table privileges could read
-- across tenants. The CI smoke suite (smokeTenantIsolationUnderRls) discovers
-- such tables from the catalogue and fails the build; that is what caught
-- this.
--
-- Fix follows 063/104 exactly: enable RLS, then install the single canonical
-- isolation policy shape (company_id = tenant_company_id()). Enabling RLS
-- here cannot lock the application out, by the same reasoning 063 documented:
-- no table in this schema grants DML to anon/authenticated, the application
-- runs as the service role, and both the service role and the table owner
-- bypass RLS. For the roles RLS does bind, this converts silent cross-tenant
-- access into tenant-scoped access — defence in depth behind the existing
-- privilege layer.

ALTER TABLE purchase_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_return_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_return_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_purchase_returns ON purchase_returns;
CREATE POLICY tenant_isolation_purchase_returns ON purchase_returns
  FOR ALL
  USING (company_id = public.tenant_company_id())
  WITH CHECK (company_id = public.tenant_company_id());

DROP POLICY IF EXISTS tenant_isolation_purchase_return_items ON purchase_return_items;
CREATE POLICY tenant_isolation_purchase_return_items ON purchase_return_items
  FOR ALL
  USING (company_id = public.tenant_company_id())
  WITH CHECK (company_id = public.tenant_company_id());

DROP POLICY IF EXISTS tenant_isolation_purchase_return_sequences ON purchase_return_sequences;
CREATE POLICY tenant_isolation_purchase_return_sequences ON purchase_return_sequences
  FOR ALL
  USING (company_id = public.tenant_company_id())
  WITH CHECK (company_id = public.tenant_company_id());

SELECT 'Migration 110 completed — purchase-returns tables enrolled in RLS tenant isolation' as result;
