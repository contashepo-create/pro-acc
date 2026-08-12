-- ============================================================
-- 027 — Strengthen Row-Level Security for multi-tenant isolation
--
-- Defense-in-depth: the application uses the service_role key (which
-- bypasses RLS), so the effective isolation already lives in the app layer.
-- This migration turns RLS into a REAL second layer so that ANY access that
-- does NOT go through the service_role key (e.g. a leaked / future anon key,
-- a direct PostgREST call, a rogue API key) is restricted to the requesting
-- company's own rows.
--
-- Design:
--   * A helper reads the company_id from the authenticated JWT.
--   * Every tenant table that has a company_id column gets:
--       - RLS enabled
--       - the legacy permissive USING(true) policy dropped
--       - a company-scoped policy (USING + WITH CHECK)
--   * Tables without a company_id (global/reference tables) are left open to
--     authenticated anon reads as before.
--   * service_role continues to bypass everything → zero impact on the app.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Helper: extract company_id from the requesting JWT.
--    Returns NULL when the claim is absent/invalid, which makes any
--    policy that calls it deny all rows (safe default for anon access).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tenant_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT NULLIF(
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'company_id',
    ''
  )::uuid;
$$;

-- ------------------------------------------------------------
-- 2) Loop over tenant tables and apply company-scoped policies.
-- ------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
  tenant_tables TEXT[] := ARRAY[
    'accounts', 'journal_entries', 'journal_lines', 'invoices', 'invoice_items',
    'clients', 'contacts', 'cash_transactions', 'banks_safes', 'projects',
    'employees', 'inventory_items', 'inventory_transactions', 'quotations',
    'quotation_items', 'purchase_invoices', 'purchase_invoice_items',
    'purchase_orders', 'purchase_order_items', 'voucher_receipts',
    'receipt_invoice_items', 'voucher_disbursements', 'disbursement_invoice_items',
    'custodies', 'custody_deposits', 'custody_settlements', 'fixed_assets',
    'subcontractors', 'boq_items', 'salary_sheets', 'salary_items',
    'daily_workers', 'daily_worker_records', 'daily_worker_settlements',
    'employee_advances', 'payroll', 'warehouses', 'categories',
    'currencies', 'bank_reconciliation', 'bank_reconciliation_items',
    'bank_imports', 'bank_import_transactions', 'contracts', 'contract_documents',
    'tenders', 'tender_cost_items', 'bonds', 'equipment', 'equipment_maintenance',
    'equipment_usage', 'project_budgets', 'project_tasks', 'timesheets',
    'petty_cash_boxes', 'petty_cash_transactions', 'petty_cash_reconciliation',
    'approval_requests', 'progress_claims', 'progress_claim_items',
    'cost_centers', 'branches', 'project_expenses', 'crm_contacts', 'crm_followups',
    'vat_return_filings', 'fiscal_years', 'notifications', 'messages',
    'transaction_categories', 'user_permissions', 'audit_log', 'payment_records',
    'payment_transactions', 'subscriptions', 'portal_access_log',
    'change_orders', 'equipment_costs', 'financial_audit_trails',
    'inventory_transactions'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    BEGIN
      -- Guard: only act on tables that actually exist and have company_id.
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = t AND column_name = 'company_id'
      ) THEN
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

        -- Drop any previous permissive/duplicate isolation policy.
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'tenant_isolation_' || t, t);
        EXECUTE format('DROP POLICY IF EXISTS "company_isolation_%s" ON %I', t, t);

        -- Company-scoped policy: read/write only own rows.
        EXECUTE format(
          'CREATE POLICY %I ON %I
             FOR ALL
             USING (company_id = public.tenant_company_id())
             WITH CHECK (company_id = public.tenant_company_id())',
          'tenant_isolation_' || t, t
        );
      END IF;
    EXCEPTION WHEN undefined_table THEN NULL;
    END;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 3) Re-assert RLS on the two tables that originally had the
--    weak USING(true) policy, so they now carry the real one.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "company_isolation_invoices" ON invoices;
DROP POLICY IF EXISTS "company_isolation_journal_entries" ON journal_entries;

-- ------------------------------------------------------------
-- 4) Grant SELECT on tenant helper to the anon/authenticated roles
--    so the function itself can be evaluated by PostgREST.
-- ------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.tenant_company_id() TO anon, authenticated, service_role;
