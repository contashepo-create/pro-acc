-- ============================================================
-- 037 - Plan features alignment & minor data fixes
--
-- 1) The Start plan must include 'purchases' (per the product spec:
--    "مبيعات، مشتريات، قيود يومية، تقارير أساسية"). It was added to the
--    plan description in 032 but missing from features_modules JSON,
--    which meant /api/purchases was module-gated off for Start users.
-- 2) Add 'backup' and 'telegram_integration' keys to Enterprise so
--    admin-side toggles don't show them as missing.
-- 3) Add missing 'purchase_orders'/'purchase_invoices' aliases for
--    fine-grained permission checks (both map to the 'purchases' module
--    at the guard level).
-- ============================================================

-- Re-apply Start features with 'purchases' included. Uses jsonb_set so
-- existing installations (where the key may already be true from manual
-- edits) keep their value. Safe to run repeatedly.
UPDATE subscription_plans
   SET features_modules = features_modules
                         || jsonb_build_object('purchases', true),
       updated_at = NOW()
 WHERE code = 'start'
   AND COALESCE(features_modules->>'purchases','') <> 'true';

-- Pro should also include employees/payroll flags explicitly (they were
-- already implicitly allowed on some Pro builds via fallback, but the
-- spec lists "employees" management for Pro. We keep them gated to true
-- here so UI doesn't disable them).
UPDATE subscription_plans
   SET features_modules = features_modules
                         || jsonb_build_object(
                             'employees',      true,
                             'payroll',        true,
                             'purchase_orders', true,
                             'purchase_invoices', true
                          ),
       updated_at = NOW()
 WHERE code IN ('pro', 'enterprise');

-- Enterprise: add any missing keys that the admin UI checks.
UPDATE subscription_plans
   SET features_modules = features_modules
                         || jsonb_build_object(
                             'backup', true,
                             'telegram_integration', true,
                             'consolidated_reports', true
                          ),
       updated_at = NOW()
 WHERE code = 'enterprise';

SELECT 'Migration 037 completed — plan features aligned' AS result;
