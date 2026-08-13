-- ============================================================
-- 032 - New pricing plans (Start / Pro / Enterprise)
--
-- Replaces previous duplicated/overlapping starter/basic/pro/enterprise
-- seeds with the new three-tier USD structure:
--   - Start      ($15/mo, $144/yr):  basic invoicing, no inventory
--   - Pro        ($35/mo, $336/yr):  + inventory, cost centers, banks
--   - Enterprise ($60/mo, $576/yr):  unlimited invoices, fixed assets, POS
--
-- All three plans include a single owner admin (1 user). Extra users and
-- extra warehouses/branches are purchased via add-ons and tracked on the
-- subscription row itself.
-- ============================================================

-- 1) Ensure subscription_plans has all columns we need.
ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS code          TEXT,
  ADD COLUMN IF NOT EXISTS description_ar TEXT,
  ADD COLUMN IF NOT EXISTS currency      TEXT NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS price_monthly NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS price_yearly  NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS yearly_discount_percent INT NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS trial_days    INT NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS max_users          INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS max_clients        INT,
  ADD COLUMN IF NOT EXISTS max_suppliers      INT,
  ADD COLUMN IF NOT EXISTS max_employees      INT,
  ADD COLUMN IF NOT EXISTS max_projects       INT,
  ADD COLUMN IF NOT EXISTS max_quotations_per_month INT,
  ADD COLUMN IF NOT EXISTS max_invoices_per_month   INT,
  ADD COLUMN IF NOT EXISTS max_storage_mb     INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS features_modules   JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS is_active         BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sort_order        INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Recreate unique constraint on code if missing (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscription_plans_code_key'
  ) THEN
    ALTER TABLE subscription_plans ADD CONSTRAINT subscription_plans_code_key UNIQUE (code);
  END IF;
END $$;

-- 2) Add-on tracking columns on subscriptions (extra users/branches billed monthly).
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS extra_users     INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extra_branches  INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS addons_json     JSONB NOT NULL DEFAULT '{}'::jsonb;

-- =====================================================================
-- 3) Upsert the three new plans.
--    - max_invoices_per_month NULL = unlimited
--    - max_clients/max_suppliers/max_employees/max_projects are NOT
--      hard-limited by the new model (invoices/quotations are), so we set
--      them to generous values / NULL to avoid breaking existing limit
--      checks for callers that still look at them.
--    - features_modules toggles which UI/API modules are reachable.
-- =====================================================================

-- Helper: delete plans whose codes are superseded so they stop showing
-- up in pricing. We deactivate them instead of dropping so historic
-- subscriptions don't break.
UPDATE subscription_plans
   SET is_active = false,
       updated_at = NOW()
 WHERE code IN ('trial','starter','basic','professional');

INSERT INTO subscription_plans
  (code, name, description_ar, currency,
   price_monthly, price_yearly, yearly_discount_percent, trial_days,
   max_users, max_clients, max_suppliers, max_employees, max_projects,
   max_quotations_per_month, max_invoices_per_month,
   max_storage_mb, features_modules, is_active, sort_order)
VALUES
  ('start', 'الأساسية - Start',
   'للأنشطة الصغيرة والتجارة الفردية: مبيعات، مشتريات، قيود يومية، تقارير أساسية.',
   'USD',
   15.00, 144.00, 20, 14,
   1, NULL, NULL, NULL, NULL,
   50, 100,
   0,
   jsonb_build_object(
     'dashboard', true,
     'accounts', true,
     'journal', true,
     'invoices', true,
     'quotations', true,
     'clients', true,
     'contacts', true,
     'reports_basic', true,
     'settings', true,
     'subscription', true
   ),
   true, 10),

  ('pro', 'الاحترافية - Pro',
   'للشركات الناشئة: كل ميزات الأساسية + مخزون، مراكز تكلفة، خزائن وبنوك، تقارير متقدمة.',
   'USD',
   35.00, 336.00, 20, 14,
   1, NULL, NULL, NULL, NULL,
   250, 500,
   0,
   jsonb_build_object(
     'dashboard', true,
     'accounts', true,
     'journal', true,
     'invoices', true,
     'quotations', true,
     'clients', true,
     'contacts', true,
     'reports_basic', true,
     'reports_advanced', true,
     'settings', true,
     'subscription', true,
     'inventory', true,
     'purchases', true,
     'cost_centers', true,
     'banks', true,
     'cash', true,
     'warehouses', true,
     'branches', true,
     'tax_reports', true
   ),
   true, 20),

  ('enterprise', 'الشاملة - Enterprise',
   'للشركات النشطة: فواتير وعروض غير محدودة + أصول ثابتة، POS، وأتمتة متقدمة.',
   'USD',
   60.00, 576.00, 20, 14,
   1, NULL, NULL, NULL, NULL,
     NULL, NULL,     -- NULL = unlimited quotations/invoices
   0,
   jsonb_build_object(
     'dashboard', true,
     'accounts', true,
     'journal', true,
     'invoices', true,
     'quotations', true,
     'clients', true,
     'contacts', true,
     'reports_basic', true,
     'reports_advanced', true,
     'reports_consolidated', true,
     'settings', true,
     'subscription', true,
     'inventory', true,
     'purchases', true,
     'cost_centers', true,
     'banks', true,
     'cash', true,
     'warehouses', true,
     'branches', true,
     'tax_reports', true,
     'fixed_assets', true,
     'pos', true,
     'workflows', true,
     'approvals', true
   ),
   true, 30)

ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description_ar = EXCLUDED.description_ar,
  currency = EXCLUDED.currency,
  price_monthly = EXCLUDED.price_monthly,
  price_yearly = EXCLUDED.price_yearly,
  yearly_discount_percent = EXCLUDED.yearly_discount_percent,
  trial_days = EXCLUDED.trial_days,
  max_users = EXCLUDED.max_users,
  max_clients = EXCLUDED.max_clients,
  max_suppliers = EXCLUDED.max_suppliers,
  max_employees = EXCLUDED.max_employees,
  max_projects = EXCLUDED.max_projects,
  max_quotations_per_month = EXCLUDED.max_quotations_per_month,
  max_invoices_per_month = EXCLUDED.max_invoices_per_month,
  max_storage_mb = EXCLUDED.max_storage_mb,
  features_modules = EXCLUDED.features_modules,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order,
  updated_at = NOW();

-- Backward-compat: keep 'enterprise' code pointing at the new Enterprise
-- (we already upserted it above). 'basic'/'starter'/'professional'/'trial'
-- are deactivated so they don't show as purchasable.

SELECT 'Migration 032 completed — Start/Pro/Enterprise pricing' AS result;
