-- ============================================================
-- Pro Acc — التحقق من وجود جميع جداول المشروع في قاعدة Supabase
-- شغّل هذا الملف في SQL Editor داخل لوحة تحكم Supabase.
-- ============================================================

WITH required(schema_name, table_name, group_name) AS (
  VALUES
    ('accounting','accounts','accounting'),
    ('accounting','currencies','accounting'),
    ('accounting','fiscal_years','accounting'),
    ('accounting','journal_entries','accounting'),
    ('accounting','journal_lines','accounting'),
    ('accounting','journal_sequences','accounting'),
    ('accounting','settings','accounting'),
    ('ads','ad_clicks','ads'),
    ('ads','ad_views','ads'),
    ('ads','advertisements','ads'),
    ('ads','visitor_logs','ads'),
    ('ads','visitor_stats','ads'),
    ('approvals','approval_requests','approvals'),
    ('assets','depreciation_log','assets'),
    ('assets','equipment','assets'),
    ('assets','equipment_costs','assets'),
    ('assets','equipment_maintenance','assets'),
    ('assets','equipment_usage','assets'),
    ('assets','fixed_assets','assets'),
    ('audit','audit_log','audit'),
    ('audit','backup_logs','audit'),
    ('audit','financial_audit_log','audit'),
    ('audit','financial_audit_trails','audit'),
    ('audit','security_audit_log','audit'),
    ('auth','admin_sessions','auth'),
    ('auth','admin_users','auth'),
    ('auth','companies','auth'),
    ('auth','company_registration_tokens','auth'),
    ('auth','login_attempts','auth'),
    ('auth','password_reset_requests','auth'),
    ('auth','password_reset_tokens','auth'),
    ('auth','refresh_tokens','auth'),
    ('auth','users','auth'),
    ('billing','activation_codes','billing'),
    ('billing','addon_grant_audit','billing'),
    ('billing','addon_requests','billing'),
    ('billing','subscription_plans','billing'),
    ('billing','subscriptions','billing'),
    ('billing','upgrade_requests','billing'),
    ('budgets','budget_lines','budgets'),
    ('budgets','budgets','budgets'),
    ('contacts','contacts','contacts'),
    ('contracts','contract_documents','contracts'),
    ('contracts','contracts','contracts'),
    ('contracts','subcontractor_certificates','contracts'),
    ('contracts','subcontractor_contracts','contracts'),
    ('contracts','subcontractor_payments','contracts'),
    ('contracts','tender_cost_items','contracts'),
    ('contracts','tenders','contracts'),
    ('crm','complaints','crm'),
    ('crm','crm_contacts','crm'),
    ('crm','crm_followups','crm'),
    ('custody','custodies','custody'),
    ('custody','custody_deposits','custody'),
    ('custody','custody_invoices','custody'),
    ('custody','custody_settlements','custody'),
    ('custody','custody_transactions','custody'),
    ('hr','daily_worker_records','hr'),
    ('hr','daily_worker_settlements','hr'),
    ('hr','daily_workers','hr'),
    ('hr','employee_advances','hr'),
    ('hr','employees','hr'),
    ('hr','gosi_settings','hr'),
    ('hr','payroll','hr'),
    ('hr','salary_items','hr'),
    ('hr','salary_sheets','hr'),
    ('hr','timesheets','hr'),
    ('inventory','inventory_items','inventory'),
    ('inventory','inventory_transactions','inventory'),
    ('inventory','warehouses','inventory'),
    ('invoicing','credit_note_items','invoicing'),
    ('invoicing','credit_notes','invoicing'),
    ('invoicing','invoice_items','invoicing'),
    ('invoicing','invoice_sequences','invoicing'),
    ('invoicing','invoices','invoicing'),
    ('invoicing','quotation_items','invoicing'),
    ('invoicing','quotations','invoicing'),
    ('legacy','suppliers','legacy'),
    ('mfg','manufacturing_bom_lines','mfg'),
    ('mfg','manufacturing_boms','mfg'),
    ('mfg','manufacturing_order_materials','mfg'),
    ('mfg','manufacturing_orders','mfg'),
    ('notif','push_notification_log','notif'),
    ('notif','push_subscriptions','notif'),
    ('notif','reminder_log','notif'),
    ('org','branches','org'),
    ('org','cost_centers','org'),
    ('other','properties','other'),
    ('other','property_leases','other'),
    ('other','property_maintenance','other'),
    ('other','transaction_categories','other'),
    ('payments','payment_methods','payments'),
    ('payments','payment_records','payments'),
    ('payments','payment_transactions','payments'),
    ('portal','portal_access_log','portal'),
    ('pos','pos_sale_items','pos'),
    ('pos','pos_sales','pos'),
    ('pos','pos_terminals','pos'),
    ('projects','boq_items','projects'),
    ('projects','progress_claim_items','projects'),
    ('projects','progress_claims','projects'),
    ('projects','project_budgets','projects'),
    ('projects','project_tasks','projects'),
    ('projects','projects','projects'),
    ('projects_cash','project_expenses','projects_cash'),
    ('purchasing','purchase_invoice_items','purchasing'),
    ('purchasing','purchase_invoices','purchasing'),
    ('purchasing','purchase_order_items','purchasing'),
    ('purchasing','purchase_orders','purchasing'),
    ('support','company_data_exports','support'),
    ('support','company_messages','support'),
    ('support','messages','support'),
    ('support','notifications','support'),
    ('support','support_tickets','support'),
    ('system','_migrations','system'),
    ('tax','tax_returns','tax'),
    ('tax','vat_return_filings','tax'),
    ('tax','withholding_taxes','tax'),
    ('telegram','company_telegram_configs','telegram'),
    ('telegram','telegram_actions_log','telegram'),
    ('telegram','telegram_test_runs','telegram'),
    ('treasury','bank_import_transactions','treasury'),
    ('treasury','bank_imports','treasury'),
    ('treasury','bank_reconciliation','treasury'),
    ('treasury','bank_reconciliation_items','treasury'),
    ('treasury','banks_safes','treasury'),
    ('treasury','bonds','treasury'),
    ('treasury','cash_transactions','treasury'),
    ('treasury','disbursement_invoice_items','treasury'),
    ('treasury','petty_cash_boxes','treasury'),
    ('treasury','petty_cash_reconciliation','treasury'),
    ('treasury','petty_cash_transactions','treasury'),
    ('treasury','receipt_invoice_items','treasury'),
    ('treasury','voucher_disbursements','treasury'),
    ('treasury','voucher_receipts','treasury')
),
found AS (
  SELECT table_schema, table_name
    FROM information_schema.tables
   WHERE table_schema = 'public'
)
SELECT
  r.group_name                                              AS المجموعة,
  r.table_name                                              AS الجدول_المطلوب,
  CASE WHEN f.table_name IS NOT NULL
       THEN '✅ موجود'
       ELSE '❌ مفقود' END                                  AS الحالة
FROM required r
LEFT JOIN found f
       ON f.table_name = r.table_name
ORDER BY
  CASE WHEN f.table_name IS NULL THEN 0 ELSE 1 END,
  r.group_name, r.table_name;

-- ============================================================
-- عدد المايجريشنز المطبقة
-- ============================================================
SELECT COUNT(*)                                        AS عدد_المايجريشنز_المطبقة,
       MIN(applied_at)                                 AS أول_مايجريشن,
       MAX(applied_at)                                 AS آخر_مايجريشن
FROM _migrations;

-- قائمة المايجريشنز المطبقة
SELECT id, filename, applied_at FROM _migrations ORDER BY id;

-- ============================================================
-- فهارس أمان/أداء حرجة
-- ============================================================
WITH required_idx(name) AS (
  VALUES
    ('idx_activation_codes_code_unique'),
    ('idx_subscriptions_company_created'),
    ('idx_addon_requests_company_status'),
    ('idx_cost_centers_company'),
    ('idx_branches_company'),
    ('idx_pos_sales_company'),
    ('idx_credit_notes_company'),
    ('idx_refresh_tokens_hash'),
    ('idx_login_attempts_email_time')
)
SELECT
  r.name AS الفهرس,
  CASE WHEN i.indexname IS NOT NULL THEN '✅ موجود' ELSE '❌ مفقود' END AS الحالة
FROM required_idx r
LEFT JOIN pg_indexes i
  ON i.indexname = r.name AND i.schemaname = 'public'
ORDER BY الحالة, r.name;

-- ============================================================
-- التأكد من وجود خطط الاشتراك الثلاثة بالأسعار الصحيحة
-- ============================================================
SELECT code, name_en, monthly_price_usd, yearly_price_usd, is_active
FROM subscription_plans
ORDER BY monthly_price_usd;
