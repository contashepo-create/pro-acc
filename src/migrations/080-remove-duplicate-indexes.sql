-- 080: Remove identical indexes/UNIQUE constraints reported by the live
-- Supabase performance advisor. Every removed object has an equivalent index
-- or constraint that remains in place; no uniqueness guarantee is weakened.

DROP INDEX IF EXISTS public.idx_activation_codes_code_unique;
DROP INDEX IF EXISTS public.idx_ad_clicks_advertisement;
DROP INDEX IF EXISTS public.idx_ad_views_advertisement;
DROP INDEX IF EXISTS public.idx_company_telegram_company;

ALTER TABLE public.custom_actions
  DROP CONSTRAINT IF EXISTS custom_actions_company_id_code_key;

DROP INDEX IF EXISTS public.idx_financial_audit_log_company;
DROP INDEX IF EXISTS public.idx_financial_audit_log_table;

ALTER TABLE public.invoice_sequences
  DROP CONSTRAINT IF EXISTS invoice_sequences_company_id_year_key;
ALTER TABLE public.journal_sequences
  DROP CONSTRAINT IF EXISTS journal_sequences_company_id_year_key;

DROP INDEX IF EXISTS public.idx_invoices_company_id;
DROP INDEX IF EXISTS public.idx_journal_entries_company_id;

ALTER TABLE public.journal_entries
  DROP CONSTRAINT IF EXISTS journal_entries_company_id_number_key;

DROP INDEX IF EXISTS public.idx_journal_lines_account_id;
DROP INDEX IF EXISTS public.idx_journal_lines_journal_entry_id;

ALTER TABLE public.purchase_invoices
  DROP CONSTRAINT IF EXISTS purchase_invoices_company_id_number_key;
ALTER TABLE public.purchase_orders
  DROP CONSTRAINT IF EXISTS purchase_orders_company_id_number_key;
ALTER TABLE public.quotations
  DROP CONSTRAINT IF EXISTS quotations_company_id_number_key;

DROP INDEX IF EXISTS public.idx_voucher_disbursements_company_id;
ALTER TABLE public.voucher_disbursements
  DROP CONSTRAINT IF EXISTS voucher_disbursements_company_id_number_key;

DROP INDEX IF EXISTS public.idx_voucher_receipts_company_id;
ALTER TABLE public.voucher_receipts
  DROP CONSTRAINT IF EXISTS voucher_receipts_company_id_number_key;
