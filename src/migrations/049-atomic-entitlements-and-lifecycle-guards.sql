-- 049 - Atomic entitlement grants and lifecycle race guards.
--
-- Paid plans/add-ons and one-time activation codes are security boundaries.
-- Route-level read-then-write checks are not sufficient: two concurrent
-- requests can both observe `pending`/`unused` and grant twice. These RPCs
-- lock the authoritative row and commit the request transition together with
-- its entitlement change.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS due_date DATE;
UPDATE purchase_invoices SET due_date = date WHERE due_date IS NULL;

ALTER TABLE custodies ADD COLUMN IF NOT EXISTS bank_safe_id UUID REFERENCES banks_safes(id);
ALTER TABLE custodies ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);
ALTER TABLE custody_transactions ADD COLUMN IF NOT EXISTS journal_entry_id UUID REFERENCES journal_entries(id);
ALTER TABLE custody_invoices ADD COLUMN IF NOT EXISTS journal_entry_id UUID REFERENCES journal_entries(id);
ALTER TABLE cash_transactions ADD COLUMN IF NOT EXISTS status TEXT;
UPDATE cash_transactions SET status='active' WHERE status IS NULL OR status<>'cancelled';
ALTER TABLE cash_transactions ALTER COLUMN status SET DEFAULT 'active';
ALTER TABLE cash_transactions ALTER COLUMN status SET NOT NULL;
ALTER TABLE company_telegram_configs ADD COLUMN IF NOT EXISTS reset_session_data JSONB;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
CREATE OR REPLACE FUNCTION public.revoke_admin_sessions(p_admin_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE admin_users SET token_version=token_version+1, login_session_data=NULL,
    telegram_code=NULL, telegram_code_expires=NULL, master_verified=FALSE
  WHERE id=p_admin_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'admin not found'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_admin_sessions(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_admin_sessions(UUID) TO service_role;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(5,4) NOT NULL DEFAULT 0;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS valid_until DATE;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(15,2) NOT NULL DEFAULT 0;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);
DO $$ BEGIN
  ALTER TABLE cash_transactions ADD CONSTRAINT cash_transactions_status_check CHECK(status IN ('active','cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_custody_file_number
  ON custodies(company_id, file_number) WHERE file_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_custody_transaction_journal
  ON custody_transactions(journal_entry_id) WHERE journal_entry_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_employee_date
  ON payroll(company_id, employee_id, date);
CREATE UNIQUE INDEX IF NOT EXISTS uq_salary_item_employee
  ON salary_items(company_id, sheet_id, employee_id);

-- Gap-free under concurrency within each company/year. Permission is checked
-- inside the function because sequences are an authorization-sensitive write.
CREATE OR REPLACE FUNCTION next_credit_note_number(p_company_id UUID, p_year INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_number INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('credit-note-number:' || p_company_id::text));
  INSERT INTO credit_note_sequences(company_id, year, last_number)
  SELECT p_company_id, p_year, COALESCE(max(number), 0) + 1
  FROM credit_notes WHERE company_id = p_company_id
  ON CONFLICT (company_id, year)
  DO UPDATE SET last_number = credit_note_sequences.last_number + 1
  RETURNING last_number INTO v_number;
  RETURN v_number;
END;
$$;
REVOKE ALL ON FUNCTION next_credit_note_number(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION next_credit_note_number(UUID, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_open_fiscal_year()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM fiscal_years WHERE company_id=NEW.company_id AND status='closed'
    AND NEW.date BETWEEN start_date AND end_date) THEN
    RAISE EXCEPTION 'cannot post to a closed fiscal year';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_journal_open_fiscal_year ON journal_entries;
CREATE TRIGGER trg_journal_open_fiscal_year BEFORE INSERT OR UPDATE OF date ON journal_entries
FOR EACH ROW EXECUTE FUNCTION public.enforce_open_fiscal_year();

-- Ledger summaries must use journal entry dates (not line insertion timestamps)
-- and account classifications, and aggregate in PostgreSQL without row limits.
CREATE OR REPLACE FUNCTION public.get_financial_summary(
  p_company_id UUID,
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL
) RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT jsonb_build_object(
    'revenue', COALESCE(sum(CASE WHEN a.type = 'revenue' THEN jl.credit - jl.debit ELSE 0 END), 0),
    'expenses', COALESCE(sum(CASE WHEN a.type = 'expense' THEN jl.debit - jl.credit ELSE 0 END), 0),
    'accountsReceivable', COALESCE(sum(CASE WHEN a.code = '1130' THEN jl.debit - jl.credit ELSE 0 END), 0),
    'accountsPayable', COALESCE(sum(CASE WHEN a.code = '2110' THEN jl.credit - jl.debit ELSE 0 END), 0),
    'cashBalance', COALESCE(sum(CASE WHEN EXISTS (
      SELECT 1 FROM banks_safes bs WHERE bs.company_id = p_company_id AND bs.account_id = a.id
    ) THEN jl.debit - jl.credit ELSE 0 END), 0)
  )
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.journal_entry_id AND je.company_id = p_company_id
  JOIN accounts a ON a.id = jl.account_id AND a.company_id = p_company_id
  WHERE jl.company_id = p_company_id
    AND (p_from IS NULL OR je.date >= p_from)
    AND (p_to IS NULL OR je.date <= p_to);
$$;
REVOKE ALL ON FUNCTION public.get_financial_summary(UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_financial_summary(UUID, DATE, DATE) TO service_role;

CREATE OR REPLACE FUNCTION public.get_account_balance(
  p_company_id UUID, p_account_id UUID, p_journal_type TEXT DEFAULT NULL, p_as_of DATE DEFAULT NULL
) RETURNS NUMERIC LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT COALESCE(sum(jl.debit-jl.credit),0)
  FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_entry_id AND je.company_id=p_company_id
  WHERE jl.company_id=p_company_id AND jl.account_id=p_account_id
    AND (p_journal_type IS NULL OR je.type=p_journal_type) AND (p_as_of IS NULL OR je.date<=p_as_of);
$$;
REVOKE ALL ON FUNCTION public.get_account_balance(UUID, UUID, TEXT, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_account_balance(UUID, UUID, TEXT, DATE) TO service_role;

CREATE OR REPLACE FUNCTION public.get_account_opening_balance(
  p_company_id UUID, p_account_id UUID, p_before DATE,
  p_cost_center_id UUID DEFAULT NULL, p_branch_id UUID DEFAULT NULL
) RETURNS NUMERIC LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT COALESCE(sum(CASE WHEN a.type IN ('asset','expense') THEN jl.debit-jl.credit ELSE jl.credit-jl.debit END),0)
  FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_entry_id AND je.company_id=p_company_id
  JOIN accounts a ON a.id=jl.account_id AND a.company_id=p_company_id
  WHERE jl.company_id=p_company_id AND jl.account_id=p_account_id AND je.date<p_before
    AND (p_cost_center_id IS NULL OR jl.cost_center_id=p_cost_center_id)
    AND (p_branch_id IS NULL OR jl.branch_id=p_branch_id);
$$;
REVOKE ALL ON FUNCTION public.get_account_opening_balance(UUID, UUID, DATE, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_account_opening_balance(UUID, UUID, DATE, UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.get_general_ledger(
  p_company_id UUID, p_account_id UUID DEFAULT NULL, p_from DATE DEFAULT NULL, p_to DATE DEFAULT NULL,
  p_cost_center_id UUID DEFAULT NULL, p_branch_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 100, p_offset INTEGER DEFAULT 0
) RETURNS TABLE(
  line_id UUID, entry_date DATE, entry_number INTEGER, entry_description TEXT,
  reference_type TEXT, reference_id UUID, account_id UUID, account_code TEXT,
  account_name TEXT, debit NUMERIC, credit NUMERIC, line_description TEXT,
  cost_center_id UUID, branch_id UUID, opening_balance NUMERIC,
  running_balance NUMERIC, total_debit NUMERIC, total_credit NUMERIC, total_count BIGINT
)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  WITH selected_account AS (
    SELECT id, type FROM accounts WHERE id = p_account_id AND company_id = p_company_id
  ), opening AS (
    SELECT COALESCE(sum(CASE WHEN a.type IN ('asset','expense') THEN jl.debit-jl.credit ELSE jl.credit-jl.debit END), 0) balance
    FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_entry_id AND je.company_id=p_company_id
    JOIN accounts a ON a.id=jl.account_id AND a.company_id=p_company_id
    WHERE jl.company_id=p_company_id AND p_account_id IS NOT NULL AND jl.account_id=p_account_id
      AND p_from IS NOT NULL AND je.date < p_from
      AND (p_cost_center_id IS NULL OR jl.cost_center_id=p_cost_center_id)
      AND (p_branch_id IS NULL OR jl.branch_id=p_branch_id)
  ), base AS (
    SELECT jl.id line_id, je.date entry_date, je.number entry_number, je.description entry_description,
      je.reference_type, je.reference_id, jl.account_id, jl.account_code,
      COALESCE(a.name, jl.account_name) account_name, jl.debit, jl.credit,
      jl.description line_description, jl.cost_center_id, jl.branch_id,
      CASE WHEN p_account_id IS NULL OR a.type IN ('asset','expense') THEN jl.debit-jl.credit ELSE jl.credit-jl.debit END movement
    FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_entry_id AND je.company_id=p_company_id
    JOIN accounts a ON a.id=jl.account_id AND a.company_id=p_company_id
    WHERE jl.company_id=p_company_id
      AND (p_account_id IS NULL OR jl.account_id=p_account_id)
      AND (p_from IS NULL OR je.date>=p_from) AND (p_to IS NULL OR je.date<=p_to)
      AND (p_cost_center_id IS NULL OR jl.cost_center_id=p_cost_center_id)
      AND (p_branch_id IS NULL OR jl.branch_id=p_branch_id)
  ), calculated AS (
    SELECT b.*, (SELECT balance FROM opening) + sum(movement) OVER (ORDER BY entry_date, entry_number, line_id) running,
      sum(debit) OVER () all_debit, sum(credit) OVER () all_credit, count(*) OVER () all_count
    FROM base b
  )
  SELECT line_id,entry_date,entry_number,entry_description,reference_type,reference_id,
    account_id,account_code,account_name,debit,credit,line_description,cost_center_id,branch_id,
    (SELECT balance FROM opening),running,all_debit,all_credit,all_count
  FROM calculated ORDER BY entry_date,entry_number,line_id
  LIMIT LEAST(GREATEST(p_limit,1),500) OFFSET GREATEST(p_offset,0);
$$;
REVOKE ALL ON FUNCTION public.get_general_ledger(UUID, UUID, DATE, DATE, UUID, UUID, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_general_ledger(UUID, UUID, DATE, DATE, UUID, UUID, INTEGER, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.get_trial_balance_rows(p_company_id UUID, p_as_of DATE)
RETURNS TABLE(account_id UUID, account_code TEXT, account_name TEXT, account_type TEXT, debit NUMERIC, credit NUMERIC)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT a.id, a.code, a.name, a.type,
    COALESCE(sum(CASE WHEN je.id IS NOT NULL THEN jl.debit ELSE 0 END), 0),
    COALESCE(sum(CASE WHEN je.id IS NOT NULL THEN jl.credit ELSE 0 END), 0)
  FROM accounts a
  LEFT JOIN journal_lines jl ON jl.account_id = a.id AND jl.company_id = p_company_id
  LEFT JOIN journal_entries je ON je.id = jl.journal_entry_id AND je.company_id = p_company_id
    AND (p_as_of IS NULL OR je.date <= p_as_of)
  WHERE a.company_id = p_company_id AND a.is_active = TRUE
  GROUP BY a.id, a.code, a.name, a.type ORDER BY a.code;
$$;
REVOKE ALL ON FUNCTION public.get_trial_balance_rows(UUID, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_trial_balance_rows(UUID, DATE) TO service_role;

CREATE OR REPLACE FUNCTION public.get_monthly_profit_loss(p_company_id UUID, p_year INTEGER)
RETURNS TABLE(month_number INTEGER, revenue NUMERIC, expenses NUMERIC)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT m.month_number,
    COALESCE(sum(CASE WHEN a.type = 'revenue' THEN jl.credit - jl.debit ELSE 0 END), 0) AS revenue,
    COALESCE(sum(CASE WHEN a.type = 'expense' THEN jl.debit - jl.credit ELSE 0 END), 0) AS expenses
  FROM generate_series(1, 12) AS m(month_number)
  LEFT JOIN journal_entries je ON je.company_id = p_company_id
    AND EXTRACT(YEAR FROM je.date) = p_year AND EXTRACT(MONTH FROM je.date) = m.month_number
  LEFT JOIN journal_lines jl ON jl.journal_entry_id = je.id AND jl.company_id = p_company_id
  LEFT JOIN accounts a ON a.id = jl.account_id AND a.company_id = p_company_id
  GROUP BY m.month_number ORDER BY m.month_number;
$$;
REVOKE ALL ON FUNCTION public.get_monthly_profit_loss(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_monthly_profit_loss(UUID, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.get_top_clients_by_revenue(
  p_company_id UUID, p_from DATE, p_to DATE, p_limit INTEGER DEFAULT 5
) RETURNS TABLE(contact_id UUID, name TEXT, revenue NUMERIC, entry_count BIGINT)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT c.id, c.name, sum(jl.credit - jl.debit), count(DISTINCT je.id)
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.journal_entry_id AND je.company_id = p_company_id
  JOIN accounts a ON a.id = jl.account_id AND a.company_id = p_company_id AND a.type = 'revenue'
  JOIN contacts c ON c.id = jl.contact_id AND c.company_id = p_company_id
  WHERE jl.company_id = p_company_id AND je.date BETWEEN p_from AND p_to
  GROUP BY c.id, c.name HAVING sum(jl.credit - jl.debit) <> 0
  ORDER BY 3 DESC LIMIT LEAST(GREATEST(p_limit, 1), 100);
$$;
REVOKE ALL ON FUNCTION public.get_top_clients_by_revenue(UUID, DATE, DATE, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_top_clients_by_revenue(UUID, DATE, DATE, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.get_vat_ledger_lines(
  p_company_id UUID, p_from DATE, p_to DATE, p_limit INTEGER DEFAULT 500, p_offset INTEGER DEFAULT 0
) RETURNS TABLE(entry_date DATE, entry_number INTEGER, description TEXT, vat_type TEXT, amount NUMERIC, total_count BIGINT)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT je.date, je.number, COALESCE(jl.description, je.description),
    CASE a.code WHEN '2120' THEN 'sales' ELSE 'purchases' END,
    CASE a.code WHEN '2120' THEN jl.credit - jl.debit ELSE jl.debit - jl.credit END,
    count(*) OVER()
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.journal_entry_id AND je.company_id = p_company_id
  JOIN accounts a ON a.id = jl.account_id AND a.company_id = p_company_id AND a.code IN ('2120', '1180')
  WHERE jl.company_id = p_company_id AND je.date BETWEEN p_from AND p_to
  ORDER BY je.date, je.number, jl.id
  LIMIT LEAST(GREATEST(p_limit, 1), 500) OFFSET GREATEST(p_offset, 0);
$$;
REVOKE ALL ON FUNCTION public.get_vat_ledger_lines(UUID, DATE, DATE, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_vat_ledger_lines(UUID, DATE, DATE, INTEGER, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.get_vat_return_summary(p_company_id UUID, p_from DATE, p_to DATE)
RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  WITH vat AS (
    SELECT
      COALESCE(sum(CASE WHEN a.code = '2120' THEN jl.credit - jl.debit ELSE 0 END), 0) output_vat,
      COALESCE(sum(CASE WHEN a.code = '1180' THEN jl.debit - jl.credit ELSE 0 END), 0) input_vat
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id AND je.company_id = p_company_id
    JOIN accounts a ON a.id = jl.account_id AND a.company_id = p_company_id
    WHERE jl.company_id = p_company_id AND je.date BETWEEN p_from AND p_to
  ), sales AS (
    SELECT COALESCE(sum(subtotal), 0) total_sales,
      COALESCE(sum(subtotal) FILTER (WHERE COALESCE(tax_rate, 0) = 0), 0) zero_sales,
      count(*) invoice_count
    FROM invoices WHERE company_id = p_company_id AND date BETWEEN p_from AND p_to
      AND status <> 'cancelled' AND deleted_at IS NULL
  ), credits AS (
    SELECT COALESCE(sum(subtotal), 0) credit_sales
    FROM credit_notes WHERE company_id = p_company_id AND date BETWEEN p_from AND p_to
      AND status = 'approved' AND deleted_at IS NULL
  ), purchases AS (
    SELECT COALESCE(sum(subtotal), 0) total_purchases, count(*) purchase_count
    FROM purchase_invoices WHERE company_id = p_company_id AND date BETWEEN p_from AND p_to
      AND status <> 'cancelled'
  )
  SELECT jsonb_build_object(
    'outputVat', vat.output_vat, 'inputVat', vat.input_vat,
    'totalSales', GREATEST(sales.total_sales - credits.credit_sales, 0),
    'zeroRatedSales', sales.zero_sales,
    'totalPurchases', purchases.total_purchases,
    'invoiceCount', sales.invoice_count, 'purchaseCount', purchases.purchase_count
  ) FROM vat, sales, credits, purchases;
$$;
REVOKE ALL ON FUNCTION public.get_vat_return_summary(UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_vat_return_summary(UUID, DATE, DATE) TO service_role;

CREATE OR REPLACE FUNCTION public.get_equity_changes_summary(
  p_company_id UUID, p_from DATE DEFAULT NULL, p_to DATE DEFAULT NULL
) RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT jsonb_build_object(
    'openingCapital',COALESCE(sum(CASE WHEN a.code='3100' THEN jl.credit-jl.debit ELSE 0 END) FILTER(WHERE p_from IS NOT NULL AND je.date<p_from),0),
    'openingRetained',COALESCE(sum(CASE WHEN a.code='3200' THEN jl.credit-jl.debit ELSE 0 END) FILTER(WHERE p_from IS NOT NULL AND je.date<p_from),0),
    'openingOtherEquity',COALESCE(sum(CASE WHEN a.type='equity' AND a.code NOT IN ('3100','3200') THEN jl.credit-jl.debit ELSE 0 END) FILTER(WHERE p_from IS NOT NULL AND je.date<p_from),0),
    'openingPriorNetIncome',COALESCE(sum(CASE WHEN a.type='revenue' THEN jl.credit-jl.debit WHEN a.type='expense' THEN jl.credit-jl.debit ELSE 0 END) FILTER(WHERE p_from IS NOT NULL AND je.date<p_from),0),
    'periodCapitalChange',COALESCE(sum(CASE WHEN a.code='3100' THEN jl.credit-jl.debit ELSE 0 END) FILTER(WHERE (p_from IS NULL OR je.date>=p_from) AND (p_to IS NULL OR je.date<=p_to)),0),
    'periodRetainedChange',COALESCE(sum(CASE WHEN a.code='3200' THEN jl.credit-jl.debit ELSE 0 END) FILTER(WHERE (p_from IS NULL OR je.date>=p_from) AND (p_to IS NULL OR je.date<=p_to)),0),
    'periodRevenue',COALESCE(sum(CASE WHEN a.type='revenue' THEN jl.credit-jl.debit ELSE 0 END) FILTER(WHERE (p_from IS NULL OR je.date>=p_from) AND (p_to IS NULL OR je.date<=p_to)),0),
    'periodExpenses',COALESCE(sum(CASE WHEN a.type='expense' THEN jl.debit-jl.credit ELSE 0 END) FILTER(WHERE (p_from IS NULL OR je.date>=p_from) AND (p_to IS NULL OR je.date<=p_to)),0)
  )
  FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_entry_id AND je.company_id=p_company_id
  JOIN accounts a ON a.id=jl.account_id AND a.company_id=p_company_id
  WHERE jl.company_id=p_company_id AND (p_to IS NULL OR je.date<=p_to);
$$;
REVOKE ALL ON FUNCTION public.get_equity_changes_summary(UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_equity_changes_summary(UUID, DATE, DATE) TO service_role;

CREATE OR REPLACE FUNCTION public.get_cost_center_profitability(
  p_company_id UUID, p_from DATE DEFAULT NULL, p_to DATE DEFAULT NULL
) RETURNS TABLE(cost_center_id UUID, code TEXT, name TEXT, revenue NUMERIC, expenses NUMERIC)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT cc.id,cc.code,cc.name,
    COALESCE(sum(CASE WHEN a.type='revenue' THEN jl.credit-jl.debit ELSE 0 END),0),
    COALESCE(sum(CASE WHEN a.type='expense' THEN jl.debit-jl.credit ELSE 0 END),0)
  FROM cost_centers cc LEFT JOIN journal_lines jl ON jl.cost_center_id=cc.id AND jl.company_id=p_company_id
  LEFT JOIN journal_entries je ON je.id=jl.journal_entry_id AND je.company_id=p_company_id
    AND (p_from IS NULL OR je.date>=p_from) AND (p_to IS NULL OR je.date<=p_to)
  LEFT JOIN accounts a ON a.id=jl.account_id AND a.company_id=p_company_id AND je.id IS NOT NULL
  WHERE cc.company_id=p_company_id AND cc.is_active=TRUE
  GROUP BY cc.id,cc.code,cc.name ORDER BY cc.code;
$$;
REVOKE ALL ON FUNCTION public.get_cost_center_profitability(UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_cost_center_profitability(UUID, DATE, DATE) TO service_role;

CREATE OR REPLACE FUNCTION public.get_contact_balances(
  p_company_id UUID, p_type TEXT DEFAULT 'all', p_from DATE DEFAULT NULL, p_to DATE DEFAULT NULL
) RETURNS TABLE(contact_id UUID, name TEXT, contact_type TEXT, phone TEXT, tax_number TEXT,
  opening NUMERIC, period_debit NUMERIC, period_credit NUMERIC, closing NUMERIC)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT c.id,c.name,c.type,c.phone,c.tax_number,
    COALESCE(sum(jl.debit-jl.credit) FILTER(WHERE p_from IS NOT NULL AND je.date<p_from),0),
    COALESCE(sum(jl.debit) FILTER(WHERE (p_from IS NULL OR je.date>=p_from) AND (p_to IS NULL OR je.date<=p_to)),0),
    COALESCE(sum(jl.credit) FILTER(WHERE (p_from IS NULL OR je.date>=p_from) AND (p_to IS NULL OR je.date<=p_to)),0),
    COALESCE(sum(jl.debit-jl.credit) FILTER(WHERE p_to IS NULL OR je.date<=p_to),0)
  FROM contacts c LEFT JOIN journal_lines jl ON jl.contact_id=c.id AND jl.company_id=p_company_id
  LEFT JOIN journal_entries je ON je.id=jl.journal_entry_id AND je.company_id=p_company_id
  WHERE c.company_id=p_company_id AND c.is_active=TRUE
    AND (p_type='all' OR (p_type='client' AND c.type IN ('client','both'))
      OR (p_type='supplier' AND c.type IN ('supplier','both')))
  GROUP BY c.id,c.name,c.type,c.phone,c.tax_number
  HAVING COALESCE(sum(abs(jl.debit)+abs(jl.credit)) FILTER(WHERE p_to IS NULL OR je.date<=p_to),0)>0
  ORDER BY c.name;
$$;
REVOKE ALL ON FUNCTION public.get_contact_balances(UUID, TEXT, DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_contact_balances(UUID, TEXT, DATE, DATE) TO service_role;

CREATE OR REPLACE FUNCTION public.get_aging_by_contact(p_company_id UUID, p_type TEXT, p_as_of DATE)
RETURNS TABLE(
  contact_id UUID, contact_name TEXT, open_amount NUMERIC, unapplied NUMERIC,
  bucket_0_30 NUMERIC, bucket_31_60 NUMERIC, bucket_61_90 NUMERIC, bucket_90_plus NUMERIC,
  max_days_overdue INTEGER, last_invoice_date DATE
)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  WITH receipt_paid AS (
    SELECT rii.invoice_id, sum(rii.amount) paid
    FROM receipt_invoice_items rii JOIN voucher_receipts vr ON vr.id=rii.voucher_receipt_id
      AND vr.company_id=p_company_id AND vr.status<>'cancelled' AND vr.date<=p_as_of
    WHERE rii.company_id=p_company_id GROUP BY rii.invoice_id
  ), ar_invoice AS (
    SELECT i.contact_id, i.date, GREATEST(0, p_as_of-COALESCE(i.due_date,i.date)) days,
      GREATEST(i.total-COALESCE(rp.paid, CASE WHEN i.paid_at::date<=p_as_of THEN i.paid_amount ELSE 0 END),0) remaining
    FROM invoices i LEFT JOIN receipt_paid rp ON rp.invoice_id=i.id
    WHERE i.company_id=p_company_id AND i.date<=p_as_of AND i.status<>'cancelled' AND i.deleted_at IS NULL
  ), receipt_allocated AS (
    SELECT rii.voucher_receipt_id, sum(rii.amount) allocated
    FROM receipt_invoice_items rii WHERE rii.company_id=p_company_id GROUP BY rii.voucher_receipt_id
  ), unapplied_receipts AS (
    SELECT vr.contact_id, sum(GREATEST(vr.amount-COALESCE(ra.allocated,0),0)) amount
    FROM voucher_receipts vr LEFT JOIN receipt_allocated ra ON ra.voucher_receipt_id=vr.id
    WHERE vr.company_id=p_company_id AND vr.receipt_type='client' AND vr.status<>'cancelled'
      AND vr.date<=p_as_of AND vr.contact_id IS NOT NULL GROUP BY vr.contact_id
  ), ar AS (
    SELECT c.id, c.name, COALESCE(sum(ai.remaining),0) open_amount, COALESCE(ur.amount,0) unapplied,
      COALESCE(sum(ai.remaining) FILTER(WHERE ai.days<=30),0),
      COALESCE(sum(ai.remaining) FILTER(WHERE ai.days BETWEEN 31 AND 60),0),
      COALESCE(sum(ai.remaining) FILTER(WHERE ai.days BETWEEN 61 AND 90),0),
      COALESCE(sum(ai.remaining) FILTER(WHERE ai.days>90),0),
      COALESCE(max(ai.days),0)::integer, max(ai.date)
    FROM contacts c LEFT JOIN ar_invoice ai ON ai.contact_id=c.id AND ai.remaining>0
    LEFT JOIN unapplied_receipts ur ON ur.contact_id=c.id
    WHERE c.company_id=p_company_id
    GROUP BY c.id,c.name,ur.amount HAVING COALESCE(sum(ai.remaining),0)<>0 OR COALESCE(ur.amount,0)<>0
  ), disbursement_paid AS (
    SELECT dii.purchase_invoice_id, sum(dii.amount) paid
    FROM disbursement_invoice_items dii JOIN voucher_disbursements vd ON vd.id=dii.voucher_disbursement_id
      AND vd.company_id=p_company_id AND vd.status<>'cancelled' AND vd.date<=p_as_of
    WHERE dii.company_id=p_company_id GROUP BY dii.purchase_invoice_id
  ), ap_invoice AS (
    SELECT i.supplier_id contact_id, i.date, GREATEST(0,p_as_of-COALESCE(i.due_date,i.date)) days,
      GREATEST(i.total-COALESCE(dp.paid,0),0) remaining
    FROM purchase_invoices i LEFT JOIN disbursement_paid dp ON dp.purchase_invoice_id=i.id
    WHERE i.company_id=p_company_id AND i.date<=p_as_of AND i.status<>'cancelled'
  ), ap AS (
    SELECT c.id,c.name,COALESCE(sum(ai.remaining),0),0::numeric,
      COALESCE(sum(ai.remaining) FILTER(WHERE ai.days<=30),0),
      COALESCE(sum(ai.remaining) FILTER(WHERE ai.days BETWEEN 31 AND 60),0),
      COALESCE(sum(ai.remaining) FILTER(WHERE ai.days BETWEEN 61 AND 90),0),
      COALESCE(sum(ai.remaining) FILTER(WHERE ai.days>90),0),
      COALESCE(max(ai.days),0)::integer,max(ai.date)
    FROM contacts c JOIN ap_invoice ai ON ai.contact_id=c.id AND ai.remaining>0
    WHERE c.company_id=p_company_id GROUP BY c.id,c.name
  )
  SELECT * FROM ar WHERE p_type='ar' UNION ALL SELECT * FROM ap WHERE p_type='ap';
$$;
REVOKE ALL ON FUNCTION public.get_aging_by_contact(UUID, TEXT, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_aging_by_contact(UUID, TEXT, DATE) TO service_role;

CREATE OR REPLACE FUNCTION public.get_receivable_aging(p_company_id UUID, p_as_of DATE)
RETURNS TABLE(bucket TEXT, invoice_count BIGINT, amount NUMERIC)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  WITH ranges(bucket, min_days, max_days, ordering) AS (VALUES
    ('حالي (0-30 يوم)', 0, 30, 1), ('31-60 يوم', 31, 60, 2),
    ('61-90 يوم', 61, 90, 3), ('+90 يوم', 91, 1000000, 4)
  )
  SELECT r.bucket, count(i.id), COALESCE(sum(GREATEST(i.total - i.paid_amount, 0)), 0)
  FROM ranges r LEFT JOIN invoices i ON i.company_id = p_company_id
    AND i.status IN ('unpaid', 'partial')
    AND (p_as_of - i.due_date) BETWEEN r.min_days AND r.max_days
  GROUP BY r.bucket, r.ordering ORDER BY r.ordering;
$$;
REVOKE ALL ON FUNCTION public.get_receivable_aging(UUID, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_receivable_aging(UUID, DATE) TO service_role;

CREATE OR REPLACE FUNCTION public.get_invoice_kpis(p_company_id UUID)
RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT jsonb_build_object(
    'outstanding', COALESCE(sum(GREATEST(total - paid_amount, 0)) FILTER (WHERE status IN ('unpaid', 'partial')), 0),
    'avgPaymentDays', COALESCE(avg(GREATEST(0, EXTRACT(EPOCH FROM (paid_at - date::timestamp)) / 86400)) FILTER (WHERE status = 'paid' AND paid_at IS NOT NULL), 0)
  ) FROM invoices WHERE company_id = p_company_id;
$$;
REVOKE ALL ON FUNCTION public.get_invoice_kpis(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_invoice_kpis(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.get_account_period_totals(
  p_company_id UUID, p_account_type TEXT DEFAULT NULL, p_from DATE DEFAULT NULL, p_to DATE DEFAULT NULL
) RETURNS TABLE(account_id UUID, code TEXT, name TEXT, account_type TEXT, debit NUMERIC, credit NUMERIC)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT a.id,a.code,a.name,a.type,
    COALESCE(sum(CASE WHEN je.id IS NOT NULL THEN jl.debit ELSE 0 END),0),
    COALESCE(sum(CASE WHEN je.id IS NOT NULL THEN jl.credit ELSE 0 END),0)
  FROM accounts a LEFT JOIN journal_lines jl ON jl.account_id=a.id AND jl.company_id=p_company_id
  LEFT JOIN journal_entries je ON je.id=jl.journal_entry_id AND je.company_id=p_company_id
    AND (p_from IS NULL OR je.date>=p_from) AND (p_to IS NULL OR je.date<=p_to)
  WHERE a.company_id=p_company_id AND a.is_active=TRUE
    AND (p_account_type IS NULL OR a.type=p_account_type)
  GROUP BY a.id,a.code,a.name,a.type ORDER BY a.code;
$$;
REVOKE ALL ON FUNCTION public.get_account_period_totals(UUID, TEXT, DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_account_period_totals(UUID, TEXT, DATE, DATE) TO service_role;

CREATE OR REPLACE FUNCTION public.get_project_billing_totals(
  p_company_id UUID, p_project_ids UUID[] DEFAULT NULL, p_from DATE DEFAULT NULL, p_to DATE DEFAULT NULL
) RETURNS TABLE(project_id UUID, billed NUMERIC, credits NUMERIC, net_billed NUMERIC)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  WITH billed AS (
    SELECT i.project_id,sum(i.subtotal) amount FROM invoices i
    WHERE i.company_id=p_company_id AND i.project_id IS NOT NULL AND i.status<>'cancelled' AND i.deleted_at IS NULL
      AND (p_project_ids IS NULL OR i.project_id=ANY(p_project_ids))
      AND (p_from IS NULL OR i.date>=p_from) AND (p_to IS NULL OR i.date<=p_to)
    GROUP BY i.project_id
  ), credits AS (
    SELECT cn.project_id,sum(cn.subtotal) amount FROM credit_notes cn
    WHERE cn.company_id=p_company_id AND cn.project_id IS NOT NULL AND cn.status='approved' AND cn.deleted_at IS NULL
      AND (p_project_ids IS NULL OR cn.project_id=ANY(p_project_ids))
      AND (p_from IS NULL OR cn.date>=p_from) AND (p_to IS NULL OR cn.date<=p_to)
    GROUP BY cn.project_id
  )
  SELECT COALESCE(b.project_id,c.project_id),COALESCE(b.amount,0),COALESCE(c.amount,0),COALESCE(b.amount,0)-COALESCE(c.amount,0)
  FROM billed b FULL JOIN credits c ON c.project_id=b.project_id;
$$;
REVOKE ALL ON FUNCTION public.get_project_billing_totals(UUID, UUID[], DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_project_billing_totals(UUID, UUID[], DATE, DATE) TO service_role;

CREATE OR REPLACE FUNCTION public.get_project_account_totals(
  p_company_id UUID, p_project_ids UUID[] DEFAULT NULL, p_from DATE DEFAULT NULL, p_to DATE DEFAULT NULL
) RETURNS TABLE(project_id UUID, account_id UUID, code TEXT, name TEXT, account_type TEXT, debit NUMERIC, credit NUMERIC)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT jl.project_id,a.id,a.code,a.name,a.type,sum(jl.debit),sum(jl.credit)
  FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_entry_id AND je.company_id=p_company_id
  JOIN accounts a ON a.id=jl.account_id AND a.company_id=p_company_id
  JOIN projects p ON p.id=jl.project_id AND p.company_id=p_company_id
  WHERE jl.company_id=p_company_id AND jl.project_id IS NOT NULL
    AND (p_project_ids IS NULL OR jl.project_id=ANY(p_project_ids))
    AND (p_from IS NULL OR je.date>=p_from) AND (p_to IS NULL OR je.date<=p_to)
  GROUP BY jl.project_id,a.id,a.code,a.name,a.type ORDER BY jl.project_id,a.code;
$$;
REVOKE ALL ON FUNCTION public.get_project_account_totals(UUID, UUID[], DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_project_account_totals(UUID, UUID[], DATE, DATE) TO service_role;

CREATE OR REPLACE FUNCTION public.get_project_profitability(p_company_id UUID, p_limit INTEGER DEFAULT 10)
RETURNS TABLE(project_id UUID, name TEXT, revenue NUMERIC, expenses NUMERIC, margin NUMERIC)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT p.id, p.name,
    COALESCE(sum(CASE WHEN a.type = 'revenue' THEN jl.credit - jl.debit ELSE 0 END), 0) AS revenue,
    COALESCE(sum(CASE WHEN a.type = 'expense' THEN jl.debit - jl.credit ELSE 0 END), 0) AS expenses,
    CASE WHEN COALESCE(sum(CASE WHEN a.type = 'revenue' THEN jl.credit - jl.debit ELSE 0 END), 0) = 0 THEN 0
      ELSE (sum(CASE WHEN a.type = 'revenue' THEN jl.credit - jl.debit ELSE 0 END)
        - sum(CASE WHEN a.type = 'expense' THEN jl.debit - jl.credit ELSE 0 END)) * 100
        / NULLIF(sum(CASE WHEN a.type = 'revenue' THEN jl.credit - jl.debit ELSE 0 END), 0) END AS margin
  FROM projects p
  LEFT JOIN journal_lines jl ON jl.project_id = p.id AND jl.company_id = p_company_id
  LEFT JOIN accounts a ON a.id = jl.account_id AND a.company_id = p_company_id
  WHERE p.company_id = p_company_id AND p.status IN ('active', 'completed')
  GROUP BY p.id, p.name ORDER BY margin DESC NULLS LAST
  LIMIT LEAST(GREATEST(p_limit, 1), 100);
$$;
REVOKE ALL ON FUNCTION public.get_project_profitability(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_project_profitability(UUID, INTEGER) TO service_role;

-- One transaction for an immutable journal reversal. The source row lock and
-- unique index make retries/concurrent cancellation exactly-once.
CREATE OR REPLACE FUNCTION public.post_journal_reversal(
  p_company_id UUID,
  p_journal_entry_id UUID,
  p_reference_type TEXT,
  p_reference_id UUID,
  p_description TEXT,
  p_user_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing UUID;
  v_reversal UUID;
  v_number INTEGER;
  v_line_count INTEGER;
BEGIN
  SELECT reversed_by INTO v_existing
  FROM journal_entries
  WHERE id = p_journal_entry_id AND company_id = p_company_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'source journal not found'; END IF;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  SELECT id INTO v_existing FROM journal_entries
  WHERE company_id = p_company_id AND reversal_of = p_journal_entry_id
  LIMIT 1;
  IF v_existing IS NOT NULL THEN
    UPDATE journal_entries SET reversed_by = v_existing
    WHERE id = p_journal_entry_id AND company_id = p_company_id AND reversed_by IS NULL;
    RETURN v_existing;
  END IF;

  IF EXISTS (
    SELECT 1 FROM fiscal_years
    WHERE company_id = p_company_id AND status = 'closed'
      AND CURRENT_DATE BETWEEN start_date AND end_date
  ) THEN RAISE EXCEPTION 'fiscal period is closed'; END IF;

  SELECT count(*) INTO v_line_count FROM journal_lines
  WHERE journal_entry_id = p_journal_entry_id AND company_id = p_company_id;
  IF v_line_count < 2 THEN RAISE EXCEPTION 'source journal has incomplete lines'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('journal-number:' || p_company_id::text));
  SELECT COALESCE(max(number), 0) + 1 INTO v_number
  FROM journal_entries WHERE company_id = p_company_id;

  INSERT INTO journal_entries(
    company_id, number, date, type, description, reference_type,
    reference_id, created_by, reversal_of
  ) VALUES (
    p_company_id, v_number, CURRENT_DATE, 'general', p_description,
    p_reference_type, p_reference_id, p_user_id, p_journal_entry_id
  ) RETURNING id INTO v_reversal;

  INSERT INTO journal_lines(
    company_id, journal_entry_id, account_id, account_code, account_name,
    debit, credit, description, project_id, contact_id
  )
  SELECT company_id, v_reversal, account_id, account_code, account_name,
         credit, debit, description, project_id, contact_id
  FROM journal_lines
  WHERE journal_entry_id = p_journal_entry_id AND company_id = p_company_id;

  UPDATE journal_entries SET reversed_by = v_reversal
  WHERE id = p_journal_entry_id AND company_id = p_company_id;
  RETURN v_reversal;
END;
$$;
REVOKE ALL ON FUNCTION public.post_journal_reversal(UUID, UUID, TEXT, UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_journal_reversal(UUID, UUID, TEXT, UUID, TEXT, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.create_fixed_asset(
  p_company_id UUID, p_name TEXT, p_code TEXT, p_category TEXT, p_purchase_date DATE,
  p_purchase_cost NUMERIC, p_useful_life_years INTEGER, p_depreciation_method TEXT,
  p_location TEXT, p_notes TEXT, p_bank_safe_id UUID, p_created_by UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_bank_account UUID; v_asset_parent UUID; v_depreciation_parent UUID;
  v_asset_account UUID; v_depreciation_account UUID; v_asset fixed_assets%ROWTYPE;
  v_journal JSONB; v_journal_id UUID; v_rate NUMERIC; v_code TEXT;
BEGIN
  v_code:=UPPER(p_code);
  IF NULLIF(BTRIM(p_name),'') IS NULL OR LENGTH(p_name)>200 OR p_code IS NULL OR p_code!~'^[A-Za-z0-9_-]{1,20}$'
    OR NULLIF(BTRIM(p_category),'') IS NULL OR LENGTH(p_category)>100
    OR p_purchase_cost IS NULL OR p_purchase_cost<=0 OR p_purchase_cost<>ROUND(p_purchase_cost,2)
    OR p_useful_life_years IS NULL OR p_useful_life_years NOT BETWEEN 1 AND 100
    OR p_depreciation_method IS NULL OR p_depreciation_method NOT IN ('straight_line','declining_balance')
    OR LENGTH(COALESCE(p_location,''))>500 OR LENGTH(COALESCE(p_notes,''))>2000 THEN
    RAISE EXCEPTION 'بيانات الأصل غير صالحة';
  END IF;
  SELECT account_id INTO v_bank_account FROM banks_safes
    WHERE id=p_bank_safe_id AND company_id=p_company_id AND COALESCE(is_active,TRUE)=TRUE;
  IF v_bank_account IS NULL THEN RAISE EXCEPTION 'حساب الدفع غير موجود'; END IF;
  SELECT id INTO v_asset_parent FROM accounts WHERE company_id=p_company_id AND code='1230';
  SELECT id INTO v_depreciation_parent FROM accounts WHERE company_id=p_company_id AND code='1290';
  IF v_asset_parent IS NULL OR v_depreciation_parent IS NULL THEN RAISE EXCEPTION 'حسابا الأصل ومجمع الإهلاك الأب غير موجودين'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_company_id::TEXT||':fixed-asset:'||v_code,0));
  IF EXISTS(SELECT 1 FROM fixed_assets WHERE company_id=p_company_id AND code=v_code) THEN RAISE EXCEPTION 'كود الأصل مستخدم'; END IF;
  INSERT INTO accounts(company_id,code,name,type,parent_id,is_active,is_header)
  VALUES(p_company_id,'1230-'||v_code,BTRIM(p_name),'asset',v_asset_parent,TRUE,FALSE) RETURNING id INTO v_asset_account;
  INSERT INTO accounts(company_id,code,name,type,parent_id,is_active,is_header)
  VALUES(p_company_id,'1290-'||v_code,'مجمع إهلاك '||BTRIM(p_name),'asset',v_depreciation_parent,TRUE,FALSE) RETURNING id INTO v_depreciation_account;
  v_rate:=ROUND((CASE WHEN p_depreciation_method='declining_balance' THEN 200 ELSE 100 END)/p_useful_life_years::NUMERIC,2);
  INSERT INTO fixed_assets(company_id,name,code,category,purchase_date,purchase_cost,useful_life_years,
    depreciation_rate,depreciation_method,accumulated_depreciation,net_book_value,status,location,notes,
    asset_account_id,depreciation_account_id)
  VALUES(p_company_id,BTRIM(p_name),v_code,BTRIM(p_category),p_purchase_date,p_purchase_cost,p_useful_life_years,
    v_rate,p_depreciation_method,0,p_purchase_cost,'active',NULLIF(BTRIM(p_location),''),NULLIF(BTRIM(p_notes),''),
    v_asset_account,v_depreciation_account) RETURNING * INTO v_asset;
  v_journal:=create_journal_entry(p_company_id,p_purchase_date,'general','شراء أصل ثابت: '||BTRIM(p_name),p_created_by,
    jsonb_build_array(
      jsonb_build_object('accountId',v_asset_account,'debit',p_purchase_cost,'credit',0,'description','شراء أصل ثابت'),
      jsonb_build_object('accountId',v_bank_account,'debit',0,'credit',p_purchase_cost,'description','سداد شراء أصل ثابت')));
  v_journal_id:=(v_journal->>'id')::UUID;
  UPDATE journal_entries SET reference_type='fixed_asset',reference_id=v_asset.id WHERE id=v_journal_id AND company_id=p_company_id;
  UPDATE fixed_assets SET journal_entry_id=v_journal_id WHERE id=v_asset.id RETURNING * INTO v_asset;
  RETURN to_jsonb(v_asset);
END;
$$;
REVOKE ALL ON FUNCTION public.create_fixed_asset(UUID,TEXT,TEXT,TEXT,DATE,NUMERIC,INTEGER,TEXT,TEXT,TEXT,UUID,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_fixed_asset(UUID,TEXT,TEXT,TEXT,DATE,NUMERIC,INTEGER,TEXT,TEXT,TEXT,UUID,UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.depreciate_fixed_asset(
  p_company_id UUID, p_asset_id UUID, p_date DATE, p_expense_account_id UUID, p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_asset fixed_assets%ROWTYPE; v_remaining NUMERIC; v_amount NUMERIC; v_journal JSONB; v_journal_id UUID;
BEGIN
  SELECT * INTO v_asset FROM fixed_assets WHERE id=p_asset_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND OR v_asset.status<>'active' OR v_asset.purchase_date>p_date THEN RETURN jsonb_build_object('status','skipped'); END IF;
  IF EXISTS(SELECT 1 FROM depreciation_log WHERE company_id=p_company_id AND asset_id=p_asset_id AND date=p_date) THEN
    RETURN jsonb_build_object('status','exists');
  END IF;
  IF v_asset.depreciation_account_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM accounts WHERE id=v_asset.depreciation_account_id AND company_id=p_company_id AND COALESCE(is_header,FALSE)=FALSE
  ) OR NOT EXISTS(
    SELECT 1 FROM accounts WHERE id=p_expense_account_id AND company_id=p_company_id AND COALESCE(is_header,FALSE)=FALSE
  ) THEN RAISE EXCEPTION 'depreciation posting accounts are invalid'; END IF;
  v_remaining:=v_asset.purchase_cost-COALESCE(v_asset.accumulated_depreciation,0);
  IF v_remaining<=0 THEN UPDATE fixed_assets SET status='fully_depreciated' WHERE id=p_asset_id; RETURN jsonb_build_object('status','fully_depreciated'); END IF;
  IF v_asset.depreciation_method='declining_balance' THEN
    v_amount:=v_remaining*((2/NULLIF(v_asset.useful_life_years,0)::NUMERIC)/12);
  ELSE
    v_amount:=v_asset.purchase_cost/(NULLIF(v_asset.useful_life_years,0)*12);
  END IF;
  v_amount:=ROUND(LEAST(v_amount,v_remaining),2);
  IF v_amount<=0 THEN RETURN jsonb_build_object('status','skipped'); END IF;
  v_journal:=create_journal_entry(p_company_id,p_date,'general',
    'إهلاك أصل ثابت: '||v_asset.name||' ('||v_asset.code||')',p_user_id,
    jsonb_build_array(
      jsonb_build_object('accountId',p_expense_account_id,'debit',v_amount,'credit',0,'description','إهلاك '||v_asset.code),
      jsonb_build_object('accountId',v_asset.depreciation_account_id,'debit',0,'credit',v_amount,'description','مجمع إهلاك '||v_asset.code)
    ));
  v_journal_id:=(v_journal->>'id')::UUID;
  UPDATE fixed_assets SET accumulated_depreciation=COALESCE(accumulated_depreciation,0)+v_amount,
    net_book_value=v_asset.purchase_cost-(COALESCE(v_asset.accumulated_depreciation,0)+v_amount),
    status=CASE WHEN v_remaining-v_amount<=0.005 THEN 'fully_depreciated' ELSE status END
  WHERE id=p_asset_id AND company_id=p_company_id;
  INSERT INTO depreciation_log(company_id,asset_id,date,amount,journal_entry_id)
  VALUES(p_company_id,p_asset_id,p_date,v_amount,v_journal_id);
  RETURN jsonb_build_object('status','created','amount',v_amount,'journal_id',v_journal_id);
END;
$$;
REVOKE ALL ON FUNCTION public.depreciate_fixed_asset(UUID, UUID, DATE, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.depreciate_fixed_asset(UUID, UUID, DATE, UUID, UUID) TO service_role;

-- Custody lifecycle writers. Every operation locks the custody row and posts
-- its journal, movement rows, links, and balances in one database transaction.
CREATE OR REPLACE FUNCTION public.open_custody_file(
  p_company_id UUID, p_employee_id UUID, p_date DATE, p_amount NUMERIC,
  p_reason TEXT, p_bank_safe_id UUID, p_project_id UUID, p_created_by UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_bank_account UUID; v_custody_account UUID; v_file_number TEXT;
  v_journal JSONB; v_journal_id UUID; v_file custodies%ROWTYPE;
BEGIN
  IF p_amount IS NULL OR p_amount<=0 OR p_amount<>ROUND(p_amount,2) THEN RAISE EXCEPTION 'مبلغ العهدة غير صالح'; END IF;
  IF NOT EXISTS(SELECT 1 FROM employees WHERE id=p_employee_id AND company_id=p_company_id) THEN RAISE EXCEPTION 'الموظف غير موجود'; END IF;
  IF p_project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM projects WHERE id=p_project_id AND company_id=p_company_id) THEN RAISE EXCEPTION 'المشروع غير موجود'; END IF;
  SELECT account_id INTO v_bank_account FROM banks_safes WHERE id=p_bank_safe_id AND company_id=p_company_id;
  IF v_bank_account IS NULL THEN RAISE EXCEPTION 'الخزينة غير موجودة أو بلا حساب'; END IF;
  SELECT id INTO v_custody_account FROM accounts
    WHERE company_id=p_company_id AND code='1150' AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
  IF v_custody_account IS NULL THEN RAISE EXCEPTION 'حساب العهد غير موجود'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_company_id::TEXT||':custody-file',0));
  SELECT 'عهدة-'||EXTRACT(YEAR FROM p_date)::INT||'-'||LPAD((COUNT(*)+1)::TEXT,4,'0')
    INTO v_file_number FROM custodies WHERE company_id=p_company_id;
  INSERT INTO custodies(
    company_id,employee_id,date,amount,remaining_amount,total_received,total_expenses,
    reason,description,bank_safe_id,project_id,file_number,status,created_by
  ) VALUES (
    p_company_id,p_employee_id,p_date,0,0,0,0,
    COALESCE(NULLIF(BTRIM(p_reason),''),'عهدة موظف'),COALESCE(NULLIF(BTRIM(p_reason),''),'عهدة موظف'),
    p_bank_safe_id,p_project_id,v_file_number,'open',p_created_by
  ) RETURNING * INTO v_file;

  v_journal:=create_journal_entry(p_company_id,p_date,'general','صرف '||v_file_number,p_created_by,jsonb_build_array(
    jsonb_build_object('accountId',v_custody_account,'debit',p_amount,'credit',0,'description','صرف عهدة'),
    jsonb_build_object('accountId',v_bank_account,'debit',0,'credit',p_amount,'description','صرف عهدة')));
  v_journal_id:=(v_journal->>'id')::UUID;
  UPDATE journal_entries SET reference_type='custody',reference_id=v_file.id WHERE id=v_journal_id AND company_id=p_company_id;
  INSERT INTO custody_transactions(company_id,custody_id,type,amount,description,created_by,journal_entry_id)
  VALUES(p_company_id,v_file.id,'addition',p_amount,'افتتاح الملف '||v_file_number,p_created_by,v_journal_id);
  UPDATE custodies SET amount=total_received,journal_entry_id=v_journal_id,updated_at=NOW()
  WHERE id=v_file.id RETURNING * INTO v_file;
  RETURN to_jsonb(v_file)||jsonb_build_object('journal_entry_id',v_journal_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.add_custody_funds(
  p_company_id UUID, p_custody_id UUID, p_date DATE, p_amount NUMERIC,
  p_description TEXT, p_bank_safe_id UUID, p_created_by UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_file custodies%ROWTYPE; v_bank_account UUID; v_custody_account UUID;
  v_journal JSONB; v_journal_id UUID;
BEGIN
  IF p_amount IS NULL OR p_amount<=0 OR p_amount<>ROUND(p_amount,2) THEN RAISE EXCEPTION 'مبلغ التعزيز غير صالح'; END IF;
  SELECT * INTO v_file FROM custodies WHERE id=p_custody_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ملف العهدة غير موجود'; END IF;
  IF v_file.status<>'open' THEN RAISE EXCEPTION 'ملف العهدة مغلق'; END IF;
  SELECT account_id INTO v_bank_account FROM banks_safes WHERE id=p_bank_safe_id AND company_id=p_company_id;
  SELECT id INTO v_custody_account FROM accounts
    WHERE company_id=p_company_id AND code='1150' AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
  IF v_bank_account IS NULL OR v_custody_account IS NULL THEN RAISE EXCEPTION 'حساب الخزينة أو العهد غير موجود'; END IF;
  v_journal:=create_journal_entry(p_company_id,p_date,'general','تعزيز '||COALESCE(v_file.file_number,p_custody_id::TEXT),p_created_by,
    jsonb_build_array(
      jsonb_build_object('accountId',v_custody_account,'debit',p_amount,'credit',0,'description',p_description),
      jsonb_build_object('accountId',v_bank_account,'debit',0,'credit',p_amount,'description',p_description)));
  v_journal_id:=(v_journal->>'id')::UUID;
  UPDATE journal_entries SET reference_type='custody_add',reference_id=p_custody_id WHERE id=v_journal_id AND company_id=p_company_id;
  INSERT INTO custody_transactions(company_id,custody_id,type,amount,description,created_by,journal_entry_id)
  VALUES(p_company_id,p_custody_id,'addition',p_amount,COALESCE(NULLIF(BTRIM(p_description),''),'تعزيز عهدة'),p_created_by,v_journal_id);
  UPDATE custodies SET amount=total_received,updated_at=NOW() WHERE id=p_custody_id RETURNING * INTO v_file;
  RETURN to_jsonb(v_file)||jsonb_build_object('journal_entry_id',v_journal_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.post_custody_expense(
  p_company_id UUID, p_custody_id UUID, p_date DATE, p_amount NUMERIC,
  p_description TEXT, p_expense_account_id UUID, p_project_id UUID,
  p_allow_excess BOOLEAN, p_invoice_id UUID, p_purchase_invoice_id UUID, p_created_by UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_file custodies%ROWTYPE; v_custody_account UUID; v_accrued_account UUID;
  v_from_custody NUMERIC; v_excess NUMERIC; v_lines JSONB;
  v_journal JSONB; v_journal_id UUID;
BEGIN
  IF p_amount IS NULL OR p_amount<=0 OR p_amount<>ROUND(p_amount,2) THEN RAISE EXCEPTION 'مبلغ المصروف غير صالح'; END IF;
  IF NULLIF(BTRIM(p_description),'') IS NULL THEN RAISE EXCEPTION 'بيان المصروف مطلوب'; END IF;
  IF p_invoice_id IS NOT NULL AND p_purchase_invoice_id IS NOT NULL THEN RAISE EXCEPTION 'حدد مستنداً واحداً فقط'; END IF;
  SELECT * INTO v_file FROM custodies WHERE id=p_custody_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ملف العهدة غير موجود'; END IF;
  IF v_file.status<>'open' THEN RAISE EXCEPTION 'ملف العهدة مغلق'; END IF;
  IF p_project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM projects WHERE id=p_project_id AND company_id=p_company_id) THEN RAISE EXCEPTION 'المشروع غير موجود'; END IF;
  IF p_invoice_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM invoices WHERE id=p_invoice_id AND company_id=p_company_id) THEN RAISE EXCEPTION 'فاتورة المبيعات غير موجودة'; END IF;
  IF p_purchase_invoice_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM purchase_invoices WHERE id=p_purchase_invoice_id AND company_id=p_company_id) THEN RAISE EXCEPTION 'فاتورة المشتريات غير موجودة'; END IF;
  SELECT id INTO v_custody_account FROM accounts
    WHERE company_id=p_company_id AND code='1150' AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
  IF v_custody_account IS NULL THEN RAISE EXCEPTION 'حساب العهد غير موجود'; END IF;
  IF p_amount>v_file.remaining_amount+0.005 AND NOT COALESCE(p_allow_excess,FALSE) THEN RAISE EXCEPTION 'المبلغ أكبر من رصيد العهدة'; END IF;
  v_from_custody:=ROUND(LEAST(p_amount,v_file.remaining_amount),2);
  v_excess:=ROUND(GREATEST(0,p_amount-v_file.remaining_amount),2);
  v_lines:=jsonb_build_array(jsonb_build_object(
    'accountId',p_expense_account_id,'debit',p_amount,'credit',0,'description',p_description,'projectId',p_project_id));
  IF v_from_custody>0 THEN
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
      'accountId',v_custody_account,'debit',0,'credit',v_from_custody,'description','خصم من العهدة'));
  END IF;
  IF v_excess>0 THEN
    SELECT id INTO v_accrued_account FROM accounts
      WHERE company_id=p_company_id AND code='2140' AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
    IF v_accrued_account IS NULL THEN RAISE EXCEPTION 'حساب المستحقات غير موجود'; END IF;
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
      'accountId',v_accrued_account,'debit',0,'credit',v_excess,'description','زيادة عهدة مستحقة للموظف'));
  END IF;
  v_journal:=create_journal_entry(p_company_id,p_date,'general','مصروف عهدة: '||p_description,p_created_by,v_lines);
  v_journal_id:=(v_journal->>'id')::UUID;
  UPDATE journal_entries SET reference_type='custody_expense',reference_id=p_custody_id WHERE id=v_journal_id AND company_id=p_company_id;
  IF v_from_custody>0 THEN
    INSERT INTO custody_transactions(company_id,custody_id,type,amount,description,reference_type,reference_id,created_by,journal_entry_id)
    VALUES(p_company_id,p_custody_id,'expense',v_from_custody,p_description,
      CASE WHEN p_invoice_id IS NOT NULL OR p_purchase_invoice_id IS NOT NULL THEN 'invoice' ELSE 'general' END,
      COALESCE(p_invoice_id,p_purchase_invoice_id),p_created_by,v_journal_id);
  END IF;
  IF v_excess>0 THEN
    INSERT INTO custody_transactions(company_id,custody_id,type,amount,description,created_by,journal_entry_id)
    VALUES(p_company_id,p_custody_id,'adjustment',v_excess,'زيادة: '||p_description,p_created_by,v_journal_id);
  END IF;
  IF p_invoice_id IS NOT NULL OR p_purchase_invoice_id IS NOT NULL THEN
    INSERT INTO custody_invoices(company_id,custody_id,invoice_id,purchase_invoice_id,amount,description,journal_entry_id)
    VALUES(p_company_id,p_custody_id,p_invoice_id,p_purchase_invoice_id,p_amount,p_description,v_journal_id);
  END IF;
  SELECT * INTO v_file FROM custodies WHERE id=p_custody_id;
  RETURN to_jsonb(v_file)||jsonb_build_object('journal_entry_id',v_journal_id,'applied_from_custody',v_from_custody,'excess',v_excess);
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_custody_file(
  p_company_id UUID, p_custody_id UUID, p_date DATE, p_returned_cash NUMERIC,
  p_bank_safe_id UUID, p_description TEXT, p_created_by UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_file custodies%ROWTYPE; v_custody_account UUID; v_advance_account UUID; v_bank_account UUID;
  v_shortage NUMERIC; v_lines JSONB:='[]'::JSONB; v_journal JSONB; v_journal_id UUID;
BEGIN
  IF p_returned_cash IS NULL OR p_returned_cash<0 OR p_returned_cash<>ROUND(p_returned_cash,2) THEN RAISE EXCEPTION 'المرتجع غير صالح'; END IF;
  SELECT * INTO v_file FROM custodies WHERE id=p_custody_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ملف العهدة غير موجود'; END IF;
  IF v_file.status<>'open' THEN RAISE EXCEPTION 'ملف العهدة مغلق'; END IF;
  IF p_returned_cash>v_file.remaining_amount+0.005 THEN RAISE EXCEPTION 'المرتجع أكبر من رصيد العهدة'; END IF;
  v_shortage:=ROUND(v_file.remaining_amount-p_returned_cash,2);
  SELECT id INTO v_custody_account FROM accounts
    WHERE company_id=p_company_id AND code='1150' AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
  IF v_custody_account IS NULL THEN RAISE EXCEPTION 'حساب العهد غير موجود'; END IF;
  IF p_returned_cash>0 THEN
    SELECT account_id INTO v_bank_account FROM banks_safes WHERE id=p_bank_safe_id AND company_id=p_company_id;
    IF v_bank_account IS NULL THEN RAISE EXCEPTION 'حساب الخزينة غير موجود'; END IF;
    v_lines:=v_lines||jsonb_build_array(
      jsonb_build_object('accountId',v_bank_account,'debit',p_returned_cash,'credit',0,'description','مرتجع نقدي من العهدة'),
      jsonb_build_object('accountId',v_custody_account,'debit',0,'credit',p_returned_cash,'description','إقفال مرتجع عهدة'));
  END IF;
  IF v_shortage>0 THEN
    SELECT id INTO v_advance_account FROM accounts
      WHERE company_id=p_company_id AND code='1160' AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
    IF v_advance_account IS NULL THEN RAISE EXCEPTION 'حساب سلف الموظفين غير موجود'; END IF;
    v_lines:=v_lines||jsonb_build_array(
      jsonb_build_object('accountId',v_advance_account,'debit',v_shortage,'credit',0,'description','عجز عهدة'),
      jsonb_build_object('accountId',v_custody_account,'debit',0,'credit',v_shortage,'description','إقفال عجز عهدة'));
  END IF;
  IF jsonb_array_length(v_lines)>0 THEN
    v_journal:=create_journal_entry(p_company_id,p_date,'general','إغلاق عهدة '||COALESCE(v_file.file_number,p_custody_id::TEXT),p_created_by,v_lines);
    v_journal_id:=(v_journal->>'id')::UUID;
    UPDATE journal_entries SET reference_type='custody_close',reference_id=p_custody_id WHERE id=v_journal_id AND company_id=p_company_id;
  END IF;
  IF p_returned_cash>0 THEN
    INSERT INTO custody_transactions(company_id,custody_id,type,amount,description,created_by,journal_entry_id)
    VALUES(p_company_id,p_custody_id,'return',p_returned_cash,'مرتجع عند الإغلاق',p_created_by,v_journal_id);
  END IF;
  IF v_shortage>0 THEN
    INSERT INTO custody_transactions(company_id,custody_id,type,amount,description,created_by,journal_entry_id)
    VALUES(p_company_id,p_custody_id,'shortage',v_shortage,'عجز يخصم من الراتب',p_created_by,v_journal_id);
    INSERT INTO employee_advances(company_id,employee_id,date,amount,remaining_amount,reason,journal_entry_id,custody_id,type)
    VALUES(p_company_id,v_file.employee_id,p_date,v_shortage,v_shortage,
      'عجز عهدة '||COALESCE(v_file.file_number,p_custody_id::TEXT),v_journal_id,p_custody_id,'custody_shortage');
  END IF;
  UPDATE custodies SET status='settled',remaining_amount=0,settlement_amount=p_returned_cash,
    settlement_date=p_date,settlement_description=COALESCE(NULLIF(BTRIM(p_description),''),'إغلاق مؤكد'),updated_at=NOW()
  WHERE id=p_custody_id RETURNING * INTO v_file;
  RETURN to_jsonb(v_file)||jsonb_build_object('journal_entry_id',v_journal_id,'returned_cash',p_returned_cash,'shortage',v_shortage);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_custody_file(
  p_company_id UUID, p_custody_id UUID, p_created_by UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_file custodies%ROWTYPE; v_reversal UUID;
BEGIN
  SELECT * INTO v_file FROM custodies WHERE id=p_custody_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ملف العهدة غير موجود'; END IF;
  IF v_file.status<>'open' THEN RAISE EXCEPTION 'ملف العهدة مغلق'; END IF;
  IF COALESCE(v_file.total_expenses,0)>0.005 THEN RAISE EXCEPTION 'ملف العهدة عليه حركات ولا يمكن إلغاؤه'; END IF;
  IF v_file.journal_entry_id IS NULL THEN RAISE EXCEPTION 'قيد افتتاح العهدة غير موجود'; END IF;
  v_reversal:=post_journal_reversal(p_company_id,v_file.journal_entry_id,'custody_reversal',p_custody_id,
    'عكس افتتاح عهدة '||COALESCE(v_file.file_number,p_custody_id::TEXT),p_created_by);
  UPDATE custodies SET status='settled',remaining_amount=0,
    notes=BTRIM(COALESCE(notes,'')||' [ملغى]'),updated_at=NOW()
  WHERE id=p_custody_id RETURNING * INTO v_file;
  RETURN to_jsonb(v_file)||jsonb_build_object('reversal_journal_id',v_reversal,'cancelled',TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.open_custody_file(UUID,UUID,DATE,NUMERIC,TEXT,UUID,UUID,UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.add_custody_funds(UUID,UUID,DATE,NUMERIC,TEXT,UUID,UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.post_custody_expense(UUID,UUID,DATE,NUMERIC,TEXT,UUID,UUID,BOOLEAN,UUID,UUID,UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_custody_file(UUID,UUID,DATE,NUMERIC,UUID,TEXT,UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_custody_file(UUID,UUID,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.open_custody_file(UUID,UUID,DATE,NUMERIC,TEXT,UUID,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.add_custody_funds(UUID,UUID,DATE,NUMERIC,TEXT,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.post_custody_expense(UUID,UUID,DATE,NUMERIC,TEXT,UUID,UUID,BOOLEAN,UUID,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_custody_file(UUID,UUID,DATE,NUMERIC,UUID,TEXT,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_custody_file(UUID,UUID,UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_open_project_journal_line()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.project_id IS NOT NULL AND EXISTS(
    SELECT 1 FROM projects WHERE id=NEW.project_id AND company_id=NEW.company_id
      AND status IN ('completed','cancelled')
  ) THEN RAISE EXCEPTION 'لا يمكن الترحيل على مشروع مغلق أو ملغى'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_journal_line_open_project ON journal_lines;
CREATE TRIGGER trg_journal_line_open_project BEFORE INSERT OR UPDATE OF project_id,company_id ON journal_lines
FOR EACH ROW EXECUTE FUNCTION public.enforce_open_project_journal_line();

CREATE OR REPLACE FUNCTION public.close_project(
  p_company_id UUID, p_project_id UUID, p_close_date DATE, p_notes TEXT, p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_project projects%ROWTYPE; v_row RECORD; v_retained UUID; v_lines JSONB:='[]'::JSONB;
  v_journal JSONB; v_journal_id UUID; v_total_revenue NUMERIC:=0; v_total_expenses NUMERIC:=0;
  v_debits NUMERIC:=0; v_credits NUMERIC:=0; v_balance NUMERIC; v_description TEXT;
BEGIN
  IF p_close_date IS NULL OR LENGTH(COALESCE(p_notes,''))>1000 THEN RAISE EXCEPTION 'بيانات الإقفال غير صالحة'; END IF;
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE) THEN
    RAISE EXCEPTION 'المستخدم غير صالح';
  END IF;
  SELECT * INTO v_project FROM projects WHERE id=p_project_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المشروع غير موجود'; END IF;
  IF v_project.status='completed' THEN RAISE EXCEPTION 'المشروع مكتمل بالفعل'; END IF;
  IF v_project.status='cancelled' THEN RAISE EXCEPTION 'لا يمكن إقفال مشروع ملغى'; END IF;
  IF v_project.start_date IS NOT NULL AND p_close_date<v_project.start_date THEN RAISE EXCEPTION 'تاريخ الإقفال يسبق بداية المشروع'; END IF;

  FOR v_row IN
    SELECT jl.account_id,a.type,ROUND(SUM(jl.credit-jl.debit),2) revenue_balance,
      ROUND(SUM(jl.debit-jl.credit),2) expense_balance
    FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_entry_id AND je.company_id=p_company_id
    JOIN accounts a ON a.id=jl.account_id AND a.company_id=p_company_id
    WHERE jl.company_id=p_company_id AND jl.project_id=p_project_id AND je.date<=p_close_date
      AND a.type IN ('revenue','expense')
    GROUP BY jl.account_id,a.type
  LOOP
    IF v_row.type='revenue' THEN
      v_balance:=v_row.revenue_balance; v_total_revenue:=v_total_revenue+v_balance;
      IF ABS(v_balance)>0.005 THEN
        v_lines:=v_lines||jsonb_build_array(jsonb_build_object('accountId',v_row.account_id,
          'debit',CASE WHEN v_balance>0 THEN v_balance ELSE 0 END,
          'credit',CASE WHEN v_balance<0 THEN -v_balance ELSE 0 END,
          'description','إقفال إيرادات مشروع: '||v_project.name,'projectId',p_project_id));
        v_debits:=v_debits+GREATEST(v_balance,0); v_credits:=v_credits+GREATEST(-v_balance,0);
      END IF;
    ELSE
      v_balance:=v_row.expense_balance; v_total_expenses:=v_total_expenses+v_balance;
      IF ABS(v_balance)>0.005 THEN
        v_lines:=v_lines||jsonb_build_array(jsonb_build_object('accountId',v_row.account_id,
          'debit',CASE WHEN v_balance<0 THEN -v_balance ELSE 0 END,
          'credit',CASE WHEN v_balance>0 THEN v_balance ELSE 0 END,
          'description','إقفال مصروفات مشروع: '||v_project.name,'projectId',p_project_id));
        v_debits:=v_debits+GREATEST(-v_balance,0); v_credits:=v_credits+GREATEST(v_balance,0);
      END IF;
    END IF;
  END LOOP;

  IF jsonb_array_length(v_lines)>0 THEN
    v_balance:=ROUND(v_debits-v_credits,2);
    IF ABS(v_balance)>0.005 THEN
      SELECT id INTO v_retained FROM accounts WHERE company_id=p_company_id AND code='3200'
        AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
      IF v_retained IS NULL THEN RAISE EXCEPTION 'حساب الأرباح المحتجزة غير موجود'; END IF;
      v_lines:=v_lines||jsonb_build_array(jsonb_build_object('accountId',v_retained,
        'debit',CASE WHEN v_balance<0 THEN -v_balance ELSE 0 END,
        'credit',CASE WHEN v_balance>0 THEN v_balance ELSE 0 END,
        'description',CASE WHEN v_balance>0 THEN 'صافي ربح مشروع: ' ELSE 'صافي خسارة مشروع: ' END||v_project.name,
        'projectId',p_project_id));
    END IF;
    v_description:='قيد إقفال مشروع: '||v_project.name||CASE WHEN NULLIF(BTRIM(COALESCE(p_notes,'')),'') IS NULL THEN '' ELSE ' - '||BTRIM(p_notes) END;
    v_journal:=create_journal_entry(p_company_id,p_close_date,'general',v_description,p_user_id,v_lines);
    v_journal_id:=(v_journal->>'id')::UUID;
    UPDATE journal_entries SET reference_type='project_closure',reference_id=p_project_id
      WHERE id=v_journal_id AND company_id=p_company_id;
  END IF;

  UPDATE projects SET status='completed',end_date=p_close_date,closed_at=NOW(),closed_by=p_user_id,
    closure_journal_entry_id=v_journal_id WHERE id=p_project_id AND company_id=p_company_id;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'close','project',p_project_id,to_jsonb(v_project),
    jsonb_build_object('status','completed','end_date',p_close_date,'closure_journal_entry_id',v_journal_id));
  RETURN jsonb_build_object('project_id',p_project_id,'closure_journal_entry_id',v_journal_id,
    'total_revenue',v_total_revenue,'total_expenses',v_total_expenses,
    'net_profit',v_total_revenue-v_total_expenses);
END;
$$;
REVOKE ALL ON FUNCTION public.close_project(UUID,UUID,DATE,TEXT,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_project(UUID,UUID,DATE,TEXT,UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.consume_password_reset_token(p_token_hash TEXT,p_password_hash TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_token password_reset_tokens%ROWTYPE; v_user users%ROWTYPE;
BEGIN
  IF LENGTH(COALESCE(p_token_hash,''))<>64 OR NULLIF(p_password_hash,'') IS NULL THEN RAISE EXCEPTION 'الرمز غير صالح'; END IF;
  SELECT * INTO v_token FROM password_reset_tokens WHERE token=p_token_hash FOR UPDATE;
  IF NOT FOUND OR v_token.used THEN RAISE EXCEPTION 'الرمز غير صالح أو مستخدم'; END IF;
  IF v_token.expires_at<=NOW() THEN RAISE EXCEPTION 'انتهت صلاحية الرمز'; END IF;
  SELECT * INTO v_user FROM users WHERE id=v_token.user_id FOR UPDATE;
  IF NOT FOUND OR NOT v_user.is_active THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  UPDATE users SET password_hash=p_password_hash,token_version=token_version+1,updated_at=NOW() WHERE id=v_user.id;
  UPDATE password_reset_tokens SET used=TRUE WHERE user_id=v_user.id AND used=FALSE;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(v_user.company_id,v_user.id,'password_reset','user',v_user.id,jsonb_build_object('sessions_revoked',TRUE));
  RETURN jsonb_build_object('user_id',v_user.id);
END;
$$;
REVOKE ALL ON FUNCTION public.consume_password_reset_token(TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_password_reset_token(TEXT,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.consume_email_verification_token(p_token_hash TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_user users%ROWTYPE;
BEGIN
  IF LENGTH(COALESCE(p_token_hash,''))<>64 THEN RAISE EXCEPTION 'رمز التحقق غير صالح'; END IF;
  SELECT * INTO v_user FROM users WHERE email_verification_token=p_token_hash FOR UPDATE;
  IF NOT FOUND OR v_user.email_verification_expires IS NULL OR v_user.email_verification_expires<=NOW() THEN
    RAISE EXCEPTION 'رمز التحقق غير صالح أو منتهي الصلاحية';
  END IF;
  UPDATE users SET email_verified=TRUE,email_verification_token=NULL,email_verification_expires=NULL,updated_at=NOW()
    WHERE id=v_user.id;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(v_user.company_id,v_user.id,'verify_email','user',v_user.id,jsonb_build_object('email_verified',TRUE));
  RETURN jsonb_build_object('user_id',v_user.id,'email',v_user.email);
END;
$$;
REVOKE ALL ON FUNCTION public.consume_email_verification_token(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_email_verification_token(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.verify_admin_login_otp(
  p_admin_id UUID,p_session_id TEXT,p_email TEXT,p_code_hash TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_admin admin_users%ROWTYPE; v_session JSONB; v_attempts INTEGER;
BEGIN
  SELECT * INTO v_admin FROM admin_users WHERE id=p_admin_id AND is_active=TRUE FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','invalid_session'); END IF;
  v_session:=v_admin.login_session_data;
  IF v_session IS NULL OR COALESCE(v_session->>'sessionId','')<>p_session_id
    OR LOWER(COALESCE(v_session->>'email',''))<>LOWER(BTRIM(COALESCE(p_email,'')))
    OR COALESCE(v_session->>'step','')<>'code_sent' OR COALESCE((v_session->>'codeSent')::BOOLEAN,FALSE)<>TRUE
    OR COALESCE((v_session->>'expiresAt')::NUMERIC,0)<EXTRACT(EPOCH FROM clock_timestamp())*1000
    OR COALESCE((v_session->>'otpExpiresAt')::NUMERIC,0)<EXTRACT(EPOCH FROM clock_timestamp())*1000 THEN
    RETURN jsonb_build_object('status','invalid_session');
  END IF;
  v_attempts:=COALESCE((v_session->>'attempts')::INTEGER,0);
  IF v_attempts>=5 THEN RETURN jsonb_build_object('status','locked'); END IF;
  IF LENGTH(COALESCE(p_code_hash,''))<>64 OR COALESCE(v_session->>'codeHash','')<>p_code_hash THEN
    v_attempts:=v_attempts+1;
    IF v_attempts>=5 THEN
      UPDATE admin_users SET login_session_data=NULL,telegram_code=NULL,telegram_code_expires=NULL,master_verified=FALSE WHERE id=p_admin_id;
      RETURN jsonb_build_object('status','locked');
    END IF;
    v_session:=jsonb_set(v_session,'{attempts}',to_jsonb(v_attempts),TRUE);
    UPDATE admin_users SET login_session_data=v_session WHERE id=p_admin_id;
    RETURN jsonb_build_object('status','invalid_code','attempts',v_attempts);
  END IF;
  v_session:=jsonb_set(jsonb_set(jsonb_set(v_session,'{step}','"telegram_verified"'::JSONB,TRUE),
    '{codeHash}',to_jsonb(repeat('0',64)),TRUE),'{codeSent}','false'::JSONB,TRUE);
  UPDATE admin_users SET login_session_data=v_session,telegram_code=NULL,telegram_code_expires=NULL,master_verified=TRUE WHERE id=p_admin_id;
  RETURN jsonb_build_object('status','verified');
END;
$$;
REVOKE ALL ON FUNCTION public.verify_admin_login_otp(UUID,TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_admin_login_otp(UUID,TEXT,TEXT,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.prepare_admin_otp_resend(
  p_admin_id UUID,p_session_id TEXT,p_email TEXT,p_code_hash TEXT,p_now_ms BIGINT,p_otp_expires_ms BIGINT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_session JSONB;
BEGIN
  SELECT login_session_data INTO v_session FROM admin_users WHERE id=p_admin_id AND is_active=TRUE FOR UPDATE;
  IF NOT FOUND OR v_session IS NULL OR COALESCE(v_session->>'sessionId','')<>p_session_id
    OR LOWER(COALESCE(v_session->>'email',''))<>LOWER(BTRIM(COALESCE(p_email,'')))
    OR COALESCE(v_session->>'step','')<>'code_sent'
    OR COALESCE((v_session->>'expiresAt')::NUMERIC,0)<p_now_ms THEN RETURN jsonb_build_object('status','invalid_session'); END IF;
  IF p_now_ms-COALESCE((v_session->>'lastResendAt')::BIGINT,0)<60000 THEN RETURN jsonb_build_object('status','cooldown'); END IF;
  IF LENGTH(COALESCE(p_code_hash,''))<>64 OR p_otp_expires_ms<=p_now_ms OR p_otp_expires_ms>p_now_ms+300000 THEN
    RAISE EXCEPTION 'بيانات الرمز الجديد غير صالحة';
  END IF;
  v_session:=v_session||jsonb_build_object('codeHash',p_code_hash,'codeSent',FALSE,'attempts',0,
    'otpExpiresAt',p_otp_expires_ms,'lastResendAt',p_now_ms);
  UPDATE admin_users SET login_session_data=v_session,telegram_code=p_code_hash,
    telegram_code_expires=to_timestamp(p_otp_expires_ms/1000.0),master_verified=FALSE WHERE id=p_admin_id;
  RETURN jsonb_build_object('status','prepared');
END;
$$;
REVOKE ALL ON FUNCTION public.prepare_admin_otp_resend(UUID,TEXT,TEXT,TEXT,BIGINT,BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_admin_otp_resend(UUID,TEXT,TEXT,TEXT,BIGINT,BIGINT) TO service_role;

ALTER TABLE petty_cash_boxes ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id);
ALTER TABLE petty_cash_boxes ADD COLUMN IF NOT EXISTS opening_journal_entry_id UUID REFERENCES journal_entries(id);
ALTER TABLE petty_cash_transactions ADD COLUMN IF NOT EXISTS counterpart_account_id UUID REFERENCES accounts(id);
ALTER TABLE petty_cash_transactions ADD COLUMN IF NOT EXISTS journal_entry_id UUID REFERENCES journal_entries(id);
ALTER TABLE petty_cash_transactions ADD COLUMN IF NOT EXISTS status TEXT;
UPDATE petty_cash_transactions SET status='active' WHERE status IS NULL;
ALTER TABLE petty_cash_transactions ALTER COLUMN status SET DEFAULT 'active';
ALTER TABLE petty_cash_transactions ALTER COLUMN status SET NOT NULL;
DO $$ BEGIN ALTER TABLE petty_cash_transactions ADD CONSTRAINT petty_cash_transaction_status_check CHECK(status IN ('active','cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_petty_cash_transaction_journal ON petty_cash_transactions(journal_entry_id) WHERE journal_entry_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_petty_cash_balances(p_company_id UUID,p_box_id UUID DEFAULT NULL)
RETURNS TABLE(box_id UUID,current_balance NUMERIC) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT b.id,ROUND(COALESCE(b.initial_balance,0)+COALESCE(SUM(CASE WHEN t.status='active' AND t.type='deposit' THEN t.amount WHEN t.status='active' AND t.type='withdrawal' THEN -t.amount ELSE 0 END),0),2)
  FROM petty_cash_boxes b LEFT JOIN petty_cash_transactions t ON t.box_id=b.id AND t.company_id=p_company_id
  WHERE b.company_id=p_company_id AND (p_box_id IS NULL OR b.id=p_box_id) GROUP BY b.id,b.initial_balance;
$$;
REVOKE ALL ON FUNCTION public.get_petty_cash_balances(UUID,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_petty_cash_balances(UUID,UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.create_petty_cash_box(
 p_company_id UUID,p_name TEXT,p_initial_balance NUMERIC,p_daily_limit NUMERIC,p_currency TEXT,
 p_custodian_id UUID,p_notes TEXT,p_account_id UUID,p_funding_account_id UUID,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_box petty_cash_boxes%ROWTYPE; v_account UUID; v_funding UUID; v_journal JSONB; v_journal_id UUID;
BEGIN
 IF NULLIF(BTRIM(p_name),'') IS NULL OR LENGTH(p_name)>200 OR p_initial_balance<0 OR p_daily_limit<0
   OR p_initial_balance<>ROUND(p_initial_balance,2) OR p_daily_limit<>ROUND(p_daily_limit,2) THEN RAISE EXCEPTION 'بيانات الصندوق غير صالحة'; END IF;
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE) THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
 IF p_custodian_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM employees WHERE id=p_custodian_id AND company_id=p_company_id AND is_active=TRUE) THEN RAISE EXCEPTION 'أمين الصندوق غير صالح'; END IF;
 SELECT id INTO v_account FROM accounts WHERE company_id=p_company_id AND id=COALESCE(p_account_id,
   (SELECT id FROM accounts WHERE company_id=p_company_id AND code='1110' LIMIT 1))
   AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
 IF v_account IS NULL THEN RAISE EXCEPTION 'حساب الصندوق غير صالح'; END IF;
 IF p_initial_balance>0 THEN
   SELECT id INTO v_funding FROM accounts WHERE company_id=p_company_id AND id=COALESCE(p_funding_account_id,
     (SELECT id FROM accounts WHERE company_id=p_company_id AND code='3000' LIMIT 1))
     AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
   IF v_funding IS NULL OR v_funding=v_account THEN RAISE EXCEPTION 'حساب تمويل الرصيد الافتتاحي غير صالح'; END IF;
 END IF;
 INSERT INTO petty_cash_boxes(company_id,name,initial_balance,daily_limit,currency,custodian_id,notes,is_active,created_by,account_id)
 VALUES(p_company_id,BTRIM(p_name),p_initial_balance,p_daily_limit,COALESCE(NULLIF(BTRIM(p_currency),''),'SAR'),p_custodian_id,NULLIF(BTRIM(p_notes),''),TRUE,p_user_id,v_account) RETURNING * INTO v_box;
 IF p_initial_balance>0 THEN
   v_journal:=create_journal_entry(p_company_id,CURRENT_DATE,'opening_balance','رصيد افتتاحي لصندوق: '||v_box.name,p_user_id,jsonb_build_array(
    jsonb_build_object('accountId',v_account,'debit',p_initial_balance,'credit',0,'description','رصيد صندوق افتتاحي'),
    jsonb_build_object('accountId',v_funding,'debit',0,'credit',p_initial_balance,'description','مقابل رصيد صندوق افتتاحي')));
   v_journal_id:=(v_journal->>'id')::UUID;
   UPDATE journal_entries SET reference_type='petty_cash_box',reference_id=v_box.id WHERE id=v_journal_id AND company_id=p_company_id;
   UPDATE petty_cash_boxes SET opening_journal_entry_id=v_journal_id WHERE id=v_box.id RETURNING * INTO v_box;
 END IF;
 INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values) VALUES(p_company_id,p_user_id,'create','petty_cash_box',v_box.id,to_jsonb(v_box));
 RETURN to_jsonb(v_box);
END;
$$;

CREATE OR REPLACE FUNCTION public.post_petty_cash_transaction(
 p_company_id UUID,p_box_id UUID,p_type TEXT,p_amount NUMERIC,p_reason TEXT,p_category TEXT,p_project_id UUID,
 p_receipt_url TEXT,p_reference_number TEXT,p_date DATE,p_counterpart_account_id UUID,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_box petty_cash_boxes%ROWTYPE; v_tx petty_cash_transactions%ROWTYPE; v_counterpart UUID; v_balance NUMERIC; v_daily NUMERIC; v_lines JSONB; v_journal JSONB; v_journal_id UUID;
BEGIN
 IF p_type NOT IN ('deposit','withdrawal') OR p_amount<=0 OR p_amount<>ROUND(p_amount,2) OR p_date IS NULL
   OR NULLIF(BTRIM(p_reason),'') IS NULL OR LENGTH(p_reason)>1000 THEN RAISE EXCEPTION 'بيانات حركة الصندوق غير صالحة'; END IF;
 IF p_category NOT IN ('general','transport','supplies','meals','maintenance','misc') THEN RAISE EXCEPTION 'التصنيف غير صالح'; END IF;
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE) THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
 SELECT * INTO v_box FROM petty_cash_boxes WHERE id=p_box_id AND company_id=p_company_id FOR UPDATE;
 IF NOT FOUND OR NOT COALESCE(v_box.is_active,FALSE) THEN RAISE EXCEPTION 'الصندوق غير موجود أو مغلق'; END IF;
 IF v_box.account_id IS NULL THEN RAISE EXCEPTION 'الصندوق غير مربوط بحساب دفتر الأستاذ'; END IF;
 IF p_project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM projects WHERE id=p_project_id AND company_id=p_company_id AND status NOT IN ('completed','cancelled')) THEN RAISE EXCEPTION 'المشروع غير صالح أو مغلق'; END IF;
 SELECT id INTO v_counterpart FROM accounts WHERE company_id=p_company_id AND id=COALESCE(p_counterpart_account_id,
   (SELECT id FROM accounts WHERE company_id=p_company_id AND code=CASE WHEN p_type='deposit' THEN '1120' ELSE '5100' END LIMIT 1))
   AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
 IF v_counterpart IS NULL OR v_counterpart=v_box.account_id THEN RAISE EXCEPTION 'الحساب المقابل غير صالح'; END IF;
 SELECT ROUND(COALESCE(v_box.initial_balance,0)+COALESCE(SUM(CASE WHEN status='active' AND type='deposit' THEN amount WHEN status='active' AND type='withdrawal' THEN -amount ELSE 0 END),0),2)
   INTO v_balance FROM petty_cash_transactions WHERE box_id=p_box_id AND company_id=p_company_id;
 IF p_type='withdrawal' THEN
   SELECT COALESCE(SUM(amount),0) INTO v_daily FROM petty_cash_transactions WHERE box_id=p_box_id AND company_id=p_company_id AND type='withdrawal' AND status='active' AND date=p_date;
   IF COALESCE(v_box.daily_limit,0)>0 AND v_daily+p_amount>v_box.daily_limit THEN RAISE EXCEPTION 'تم تجاوز الحد اليومي للسحب'; END IF;
   IF v_balance+0.005<p_amount THEN RAISE EXCEPTION 'رصيد الصندوق غير كافٍ للسحب'; END IF;
   v_lines:=jsonb_build_array(
    jsonb_build_object('accountId',v_counterpart,'debit',p_amount,'credit',0,'description',BTRIM(p_reason),'projectId',p_project_id),
    jsonb_build_object('accountId',v_box.account_id,'debit',0,'credit',p_amount,'description',BTRIM(p_reason),'projectId',p_project_id));
 ELSE
   v_lines:=jsonb_build_array(
    jsonb_build_object('accountId',v_box.account_id,'debit',p_amount,'credit',0,'description',BTRIM(p_reason),'projectId',p_project_id),
    jsonb_build_object('accountId',v_counterpart,'debit',0,'credit',p_amount,'description',BTRIM(p_reason),'projectId',p_project_id));
 END IF;
 INSERT INTO petty_cash_transactions(company_id,box_id,type,amount,reason,category,project_id,receipt_url,reference_number,date,created_by,counterpart_account_id,status)
 VALUES(p_company_id,p_box_id,p_type,p_amount,BTRIM(p_reason),p_category,p_project_id,NULLIF(BTRIM(p_receipt_url),''),NULLIF(BTRIM(p_reference_number),''),p_date,p_user_id,v_counterpart,'active') RETURNING * INTO v_tx;
 v_journal:=create_journal_entry(p_company_id,p_date,'general',CASE WHEN p_type='deposit' THEN 'إيداع صندوق: ' ELSE 'سحب صندوق: ' END||BTRIM(p_reason),p_user_id,v_lines);
 v_journal_id:=(v_journal->>'id')::UUID;
 UPDATE journal_entries SET reference_type='petty_cash_transaction',reference_id=v_tx.id WHERE id=v_journal_id AND company_id=p_company_id;
 UPDATE petty_cash_transactions SET journal_entry_id=v_journal_id WHERE id=v_tx.id RETURNING * INTO v_tx;
 INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values) VALUES(p_company_id,p_user_id,'post','petty_cash_transaction',v_tx.id,to_jsonb(v_tx));
 RETURN to_jsonb(v_tx);
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_petty_cash_box(p_company_id UUID,p_box_id UUID,p_physical_count NUMERIC,p_notes TEXT,p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_box petty_cash_boxes%ROWTYPE; v_balance NUMERIC; v_difference NUMERIC; v_recon petty_cash_reconciliation%ROWTYPE;
BEGIN
 IF p_physical_count<0 OR p_physical_count<>ROUND(p_physical_count,2) OR LENGTH(COALESCE(p_notes,''))>1000 THEN RAISE EXCEPTION 'بيانات المطابقة غير صالحة'; END IF;
 SELECT * INTO v_box FROM petty_cash_boxes WHERE id=p_box_id AND company_id=p_company_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'الصندوق غير موجود'; END IF;
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE) THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
 SELECT ROUND(COALESCE(v_box.initial_balance,0)+COALESCE(SUM(CASE WHEN status='active' AND type='deposit' THEN amount WHEN status='active' AND type='withdrawal' THEN -amount ELSE 0 END),0),2)
   INTO v_balance FROM petty_cash_transactions WHERE box_id=p_box_id AND company_id=p_company_id;
 v_difference:=ROUND(p_physical_count-v_balance,2);
 INSERT INTO petty_cash_reconciliation(company_id,box_id,reconciliation_date,system_balance,physical_count,difference,status,notes,reconciled_by)
 VALUES(p_company_id,p_box_id,CURRENT_DATE,v_balance,p_physical_count,v_difference,CASE WHEN ABS(v_difference)<0.01 THEN 'balanced' ELSE 'discrepancy' END,NULLIF(BTRIM(p_notes),''),p_user_id) RETURNING * INTO v_recon;
 INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values) VALUES(p_company_id,p_user_id,'reconcile','petty_cash_box',p_box_id,to_jsonb(v_recon));
 RETURN to_jsonb(v_recon);
END;
$$;

CREATE OR REPLACE FUNCTION public.close_petty_cash_box(p_company_id UUID,p_box_id UUID,p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_box petty_cash_boxes%ROWTYPE; v_balance NUMERIC;
BEGIN
 SELECT * INTO v_box FROM petty_cash_boxes WHERE id=p_box_id AND company_id=p_company_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'الصندوق غير موجود'; END IF;
 IF NOT COALESCE(v_box.is_active,FALSE) THEN RETURN to_jsonb(v_box); END IF;
 SELECT ROUND(COALESCE(v_box.initial_balance,0)+COALESCE(SUM(CASE WHEN status='active' AND type='deposit' THEN amount WHEN status='active' AND type='withdrawal' THEN -amount ELSE 0 END),0),2)
   INTO v_balance FROM petty_cash_transactions WHERE box_id=p_box_id AND company_id=p_company_id;
 IF ABS(v_balance)>0.005 THEN RAISE EXCEPTION 'لا يمكن إغلاق صندوق برصيد غير صفري'; END IF;
 UPDATE petty_cash_boxes SET is_active=FALSE,updated_at=NOW() WHERE id=p_box_id RETURNING * INTO v_box;
 INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values) VALUES(p_company_id,p_user_id,'close','petty_cash_box',p_box_id,jsonb_build_object('is_active',TRUE),jsonb_build_object('is_active',FALSE));
 RETURN to_jsonb(v_box);
END;
$$;

REVOKE ALL ON FUNCTION public.create_petty_cash_box(UUID,TEXT,NUMERIC,NUMERIC,TEXT,UUID,TEXT,UUID,UUID,UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.post_petty_cash_transaction(UUID,UUID,TEXT,NUMERIC,TEXT,TEXT,UUID,TEXT,TEXT,DATE,UUID,UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_petty_cash_box(UUID,UUID,NUMERIC,TEXT,UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.close_petty_cash_box(UUID,UUID,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_petty_cash_box(UUID,TEXT,NUMERIC,NUMERIC,TEXT,UUID,TEXT,UUID,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.post_petty_cash_transaction(UUID,UUID,TEXT,NUMERIC,TEXT,TEXT,UUID,TEXT,TEXT,DATE,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_petty_cash_box(UUID,UUID,NUMERIC,TEXT,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.close_petty_cash_box(UUID,UUID,UUID) TO service_role;

ALTER TABLE equipment_costs ADD COLUMN IF NOT EXISTS expense_account_id UUID REFERENCES accounts(id);
ALTER TABLE equipment_costs ADD COLUMN IF NOT EXISTS payment_account_id UUID REFERENCES accounts(id);
ALTER TABLE equipment_costs ADD COLUMN IF NOT EXISTS journal_entry_id UUID REFERENCES journal_entries(id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_equipment_cost_journal ON equipment_costs(journal_entry_id) WHERE journal_entry_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.post_equipment_cost(
 p_company_id UUID,p_equipment_id UUID,p_project_id UUID,p_date DATE,p_cost_type TEXT,p_amount NUMERIC,
 p_usage_hours NUMERIC,p_notes TEXT,p_expense_account_id UUID,p_payment_account_id UUID,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_cost equipment_costs%ROWTYPE; v_expense UUID; v_credit UUID; v_journal JSONB; v_journal_id UUID; v_balance NUMERIC; v_expense_code TEXT;
BEGIN
 IF p_date IS NULL OR p_cost_type NOT IN ('rental','fuel','maintenance','labour','depreciation','other')
   OR p_amount<=0 OR p_amount<>ROUND(p_amount,2) OR p_usage_hours<0 OR p_usage_hours<>ROUND(p_usage_hours,2)
   OR LENGTH(COALESCE(p_notes,''))>500 THEN RAISE EXCEPTION 'بيانات تكلفة المعدة غير صالحة'; END IF;
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE) THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
 IF p_equipment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM fixed_assets WHERE id=p_equipment_id AND company_id=p_company_id FOR UPDATE) THEN RAISE EXCEPTION 'المعدة غير موجودة'; END IF;
 IF p_project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM projects WHERE id=p_project_id AND company_id=p_company_id AND status NOT IN ('completed','cancelled')) THEN RAISE EXCEPTION 'المشروع غير صالح أو مغلق'; END IF;
 v_expense_code:=CASE p_cost_type WHEN 'rental' THEN '5140' WHEN 'fuel' THEN '5270' WHEN 'maintenance' THEN '5250' WHEN 'labour' THEN '5120' WHEN 'depreciation' THEN '5260' ELSE '5400' END;
 SELECT id INTO v_expense FROM accounts WHERE company_id=p_company_id AND id=COALESCE(p_expense_account_id,
   (SELECT id FROM accounts WHERE company_id=p_company_id AND code=v_expense_code LIMIT 1))
   AND type='expense' AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
 SELECT id INTO v_credit FROM accounts WHERE company_id=p_company_id AND id=COALESCE(p_payment_account_id,
   (SELECT id FROM accounts WHERE company_id=p_company_id AND code=CASE WHEN p_cost_type='depreciation' THEN '1290' ELSE '1110' END LIMIT 1))
   AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
 IF v_expense IS NULL OR v_credit IS NULL OR v_expense=v_credit THEN RAISE EXCEPTION 'حسابات تكلفة المعدة غير صالحة'; END IF;
 IF p_cost_type<>'depreciation' AND EXISTS(SELECT 1 FROM accounts WHERE id=v_credit AND type='asset') THEN
   v_balance:=get_account_balance(p_company_id,v_credit,NULL,NULL);
   IF v_balance+0.005<p_amount THEN RAISE EXCEPTION 'رصيد حساب السداد غير كاف'; END IF;
 END IF;
 INSERT INTO equipment_costs(company_id,equipment_id,project_id,date,cost_type,amount,usage_hours,notes,created_by,expense_account_id,payment_account_id)
 VALUES(p_company_id,p_equipment_id,p_project_id,p_date,p_cost_type,p_amount,p_usage_hours,NULLIF(BTRIM(p_notes),''),p_user_id,v_expense,v_credit) RETURNING * INTO v_cost;
 v_journal:=create_journal_entry(p_company_id,p_date,'general','تكلفة معدة - '||p_cost_type,p_user_id,jsonb_build_array(
  jsonb_build_object('accountId',v_expense,'debit',p_amount,'credit',0,'description',COALESCE(NULLIF(BTRIM(p_notes),''),'تكلفة معدة'),'projectId',p_project_id),
  jsonb_build_object('accountId',v_credit,'debit',0,'credit',p_amount,'description',COALESCE(NULLIF(BTRIM(p_notes),''),'تكلفة معدة'),'projectId',p_project_id)));
 v_journal_id:=(v_journal->>'id')::UUID;
 UPDATE journal_entries SET reference_type='equipment_cost',reference_id=v_cost.id WHERE id=v_journal_id AND company_id=p_company_id;
 UPDATE equipment_costs SET journal_entry_id=v_journal_id WHERE id=v_cost.id RETURNING * INTO v_cost;
 INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values) VALUES(p_company_id,p_user_id,'post','equipment_cost',v_cost.id,to_jsonb(v_cost));
 RETURN to_jsonb(v_cost);
END;
$$;
REVOKE ALL ON FUNCTION public.post_equipment_cost(UUID,UUID,UUID,DATE,TEXT,NUMERIC,NUMERIC,TEXT,UUID,UUID,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_equipment_cost(UUID,UUID,UUID,DATE,TEXT,NUMERIC,NUMERIC,TEXT,UUID,UUID,UUID) TO service_role;

ALTER TABLE banks_safes ADD COLUMN IF NOT EXISTS opening_journal_entry_id UUID REFERENCES journal_entries(id);
ALTER TABLE banks_safes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE bank_reconciliation ADD COLUMN IF NOT EXISTS system_balance NUMERIC(15,2);
ALTER TABLE bank_reconciliation ADD COLUMN IF NOT EXISTS difference NUMERIC(15,2);
ALTER TABLE bank_reconciliation ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);
ALTER TABLE bank_reconciliation ADD COLUMN IF NOT EXISTS completed_by UUID REFERENCES users(id);
ALTER TABLE bank_reconciliation ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.create_bank_safe(
 p_company_id UUID,p_name TEXT,p_type TEXT,p_account_number TEXT,p_opening_balance NUMERIC,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_parent_code TEXT; v_parent UUID; v_code TEXT; v_suffix INTEGER; v_account accounts%ROWTYPE; v_bank banks_safes%ROWTYPE; v_capital UUID; v_journal JSONB; v_journal_id UUID; v_amount NUMERIC;
BEGIN
 IF NULLIF(BTRIM(p_name),'') IS NULL OR LENGTH(p_name)>200 OR p_type NOT IN ('bank','safe')
  OR p_opening_balance<>ROUND(p_opening_balance,2) OR LENGTH(COALESCE(p_account_number,''))>100 THEN RAISE EXCEPTION 'بيانات البنك أو الخزينة غير صالحة'; END IF;
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE) THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
 v_parent_code:=CASE WHEN p_type='bank' THEN '1120' ELSE '1110' END;
 PERFORM pg_advisory_xact_lock(hashtextextended('bank-account:'||p_company_id::TEXT||':'||v_parent_code,0));
 SELECT id INTO v_parent FROM accounts WHERE company_id=p_company_id AND code=v_parent_code AND COALESCE(is_active,TRUE)=TRUE FOR UPDATE;
 IF v_parent IS NULL THEN RAISE EXCEPTION 'الحساب الأب للبنك أو الخزينة غير موجود'; END IF;
 SELECT COALESCE(MAX(substring(code from '[0-9]+$')::INTEGER),0)+1 INTO v_suffix FROM accounts
  WHERE company_id=p_company_id AND code ~ ('^'||v_parent_code||'-[0-9]+$');
 v_code:=v_parent_code||'-'||LPAD(v_suffix::TEXT,4,'0');
 INSERT INTO accounts(company_id,code,name,type,parent_id,is_active,is_header)
 VALUES(p_company_id,v_code,BTRIM(p_name),'asset',v_parent,TRUE,FALSE) RETURNING * INTO v_account;
 INSERT INTO banks_safes(company_id,name,type,account_number,account_id,opening_balance,is_active)
 VALUES(p_company_id,BTRIM(p_name),p_type,NULLIF(BTRIM(p_account_number),''),v_account.id,p_opening_balance,TRUE) RETURNING * INTO v_bank;
 IF ABS(p_opening_balance)>0.005 THEN
  SELECT id INTO v_capital FROM accounts WHERE company_id=p_company_id AND code='3100' AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
  IF v_capital IS NULL THEN RAISE EXCEPTION 'حساب رأس المال غير موجود للرصيد الافتتاحي'; END IF;
  v_amount:=ABS(p_opening_balance);
  v_journal:=create_journal_entry(p_company_id,CURRENT_DATE,'opening_balance','رصيد افتتاحي - '||v_bank.name,p_user_id,
   CASE WHEN p_opening_balance>0 THEN jsonb_build_array(
    jsonb_build_object('accountId',v_account.id,'debit',v_amount,'credit',0),jsonb_build_object('accountId',v_capital,'debit',0,'credit',v_amount))
   ELSE jsonb_build_array(jsonb_build_object('accountId',v_account.id,'debit',0,'credit',v_amount),jsonb_build_object('accountId',v_capital,'debit',v_amount,'credit',0)) END);
  v_journal_id:=(v_journal->>'id')::UUID;
  UPDATE journal_entries SET reference_type='bank_safe_opening',reference_id=v_bank.id WHERE id=v_journal_id AND company_id=p_company_id;
  UPDATE banks_safes SET opening_journal_entry_id=v_journal_id WHERE id=v_bank.id RETURNING * INTO v_bank;
 END IF;
 INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values) VALUES(p_company_id,p_user_id,'create','bank_safe',v_bank.id,to_jsonb(v_bank));
 RETURN to_jsonb(v_bank)||jsonb_build_object('account_code',v_account.code,'account_name',v_account.name,'current_balance',p_opening_balance,'balance',p_opening_balance);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_bank_reconciliation(
 p_company_id UUID,p_bank_safe_id UUID,p_date DATE,p_closing_balance NUMERIC,p_items JSONB,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_bank banks_safes%ROWTYPE; v_rec bank_reconciliation%ROWTYPE; v_item JSONB; v_amount NUMERIC; v_system NUMERIC;
BEGIN
 IF p_date IS NULL OR p_closing_balance<>ROUND(p_closing_balance,2) OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)>1000 THEN RAISE EXCEPTION 'بيانات المطابقة غير صالحة'; END IF;
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE) THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
 SELECT * INTO v_bank FROM banks_safes WHERE id=p_bank_safe_id AND company_id=p_company_id FOR UPDATE;
 IF NOT FOUND OR v_bank.account_id IS NULL THEN RAISE EXCEPTION 'البنك أو الخزينة غير موجود'; END IF;
 IF EXISTS(SELECT 1 FROM bank_reconciliation WHERE company_id=p_company_id AND bank_safe_id=p_bank_safe_id AND date=p_date) THEN RAISE EXCEPTION 'توجد مطابقة لهذا البنك في التاريخ نفسه'; END IF;
 v_system:=get_account_balance(p_company_id,v_bank.account_id,NULL,p_date);
 INSERT INTO bank_reconciliation(company_id,bank_safe_id,date,closing_balance,status,system_balance,difference,created_by)
 VALUES(p_company_id,p_bank_safe_id,p_date,p_closing_balance,'pending',v_system,ROUND(p_closing_balance-v_system,2),p_user_id) RETURNING * INTO v_rec;
 FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  IF NULLIF(BTRIM(v_item->>'transactionType'),'') IS NULL OR LENGTH(v_item->>'transactionType')>100 THEN RAISE EXCEPTION 'نوع بند المطابقة غير صالح'; END IF;
  BEGIN v_amount:=(v_item->>'amount')::NUMERIC; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'مبلغ بند المطابقة غير صالح'; END;
  IF v_amount<0 OR v_amount<>ROUND(v_amount,2) THEN RAISE EXCEPTION 'مبلغ بند المطابقة غير صالح'; END IF;
  INSERT INTO bank_reconciliation_items(company_id,reconciliation_id,transaction_type,amount,date,is_cleared)
  VALUES(p_company_id,v_rec.id,BTRIM(v_item->>'transactionType'),v_amount,COALESCE(NULLIF(v_item->>'date','')::DATE,p_date),COALESCE((v_item->>'isCleared')::BOOLEAN,FALSE));
 END LOOP;
 INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values) VALUES(p_company_id,p_user_id,'create','bank_reconciliation',v_rec.id,to_jsonb(v_rec));
 RETURN to_jsonb(v_rec);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_bank_reconciliation(
 p_company_id UUID,p_reconciliation_id UUID,p_closing_balance NUMERIC,p_complete BOOLEAN,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old bank_reconciliation%ROWTYPE; v_new bank_reconciliation%ROWTYPE; v_account UUID; v_system NUMERIC;
BEGIN
 SELECT * INTO v_old FROM bank_reconciliation WHERE id=p_reconciliation_id AND company_id=p_company_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'المطابقة غير موجودة'; END IF;
 IF v_old.status='completed' THEN RAISE EXCEPTION 'المطابقة المكتملة غير قابلة للتعديل'; END IF;
 SELECT account_id INTO v_account FROM banks_safes WHERE id=v_old.bank_safe_id AND company_id=p_company_id;
 IF v_account IS NULL THEN RAISE EXCEPTION 'حساب البنك غير موجود'; END IF;
 v_system:=get_account_balance(p_company_id,v_account,NULL,v_old.date);
 UPDATE bank_reconciliation SET closing_balance=COALESCE(p_closing_balance,closing_balance),system_balance=v_system,
  difference=ROUND(COALESCE(p_closing_balance,closing_balance)-v_system,2),status=CASE WHEN p_complete THEN 'completed' ELSE status END,
  completed_by=CASE WHEN p_complete THEN p_user_id ELSE completed_by END,completed_at=CASE WHEN p_complete THEN NOW() ELSE completed_at END
 WHERE id=p_reconciliation_id RETURNING * INTO v_new;
 INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values) VALUES(p_company_id,p_user_id,CASE WHEN p_complete THEN 'complete' ELSE 'update' END,'bank_reconciliation',p_reconciliation_id,to_jsonb(v_old),to_jsonb(v_new));
 RETURN to_jsonb(v_new);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_pending_bank_reconciliation(p_company_id UUID,p_reconciliation_id UUID,p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old bank_reconciliation%ROWTYPE;
BEGIN
 SELECT * INTO v_old FROM bank_reconciliation WHERE id=p_reconciliation_id AND company_id=p_company_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'المطابقة غير موجودة'; END IF;
 IF v_old.status<>'pending' THEN RAISE EXCEPTION 'لا يمكن حذف مطابقة مكتملة'; END IF;
 DELETE FROM bank_reconciliation_items WHERE reconciliation_id=p_reconciliation_id AND company_id=p_company_id;
 DELETE FROM bank_reconciliation WHERE id=p_reconciliation_id AND company_id=p_company_id;
 INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values) VALUES(p_company_id,p_user_id,'delete','bank_reconciliation',p_reconciliation_id,to_jsonb(v_old));
END;
$$;

REVOKE ALL ON FUNCTION public.create_bank_safe(UUID,TEXT,TEXT,TEXT,NUMERIC,UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_bank_reconciliation(UUID,UUID,DATE,NUMERIC,JSONB,UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_bank_reconciliation(UUID,UUID,NUMERIC,BOOLEAN,UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_pending_bank_reconciliation(UUID,UUID,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_bank_safe(UUID,TEXT,TEXT,TEXT,NUMERIC,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_bank_reconciliation(UUID,UUID,DATE,NUMERIC,JSONB,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_bank_reconciliation(UUID,UUID,NUMERIC,BOOLEAN,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_pending_bank_reconciliation(UUID,UUID,UUID) TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS uq_disbursement_invoice_allocation
 ON disbursement_invoice_items(company_id,voucher_disbursement_id,purchase_invoice_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_voucher_disbursement_journal
 ON voucher_disbursements(journal_entry_id) WHERE journal_entry_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_voucher_disbursement_atomic(
 p_company_id UUID,p_date DATE,p_disbursement_type TEXT,p_contact_id UUID,p_employee_id UUID,p_amount NUMERIC,
 p_bank_safe_id UUID,p_reason TEXT,p_allocations JSONB,p_request_approval BOOLEAN,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_bank banks_safes%ROWTYPE; v_voucher voucher_disbursements%ROWTYPE; v_number INTEGER; v_counterpart UUID;
 v_journal JSONB; v_journal_id UUID; v_balance NUMERIC; v_item JSONB; v_invoice purchase_invoices%ROWTYPE;
 v_alloc NUMERIC; v_alloc_total NUMERIC:=0; v_new_paid NUMERIC; v_approval approval_requests%ROWTYPE;
BEGIN
 IF p_date IS NULL OR p_disbursement_type NOT IN ('supplier','employee_advance','subcontractor','client_refund','other')
  OR p_amount<=0 OR p_amount<>ROUND(p_amount,2) OR NULLIF(BTRIM(p_reason),'') IS NULL OR LENGTH(p_reason)>500
  OR jsonb_typeof(p_allocations)<>'array' OR jsonb_array_length(p_allocations)>100 THEN RAISE EXCEPTION 'بيانات سند الصرف غير صالحة'; END IF;
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE) THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
 IF p_contact_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM contacts WHERE id=p_contact_id AND company_id=p_company_id) THEN RAISE EXCEPTION 'الطرف غير موجود'; END IF;
 IF p_employee_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM employees WHERE id=p_employee_id AND company_id=p_company_id AND is_active=TRUE) THEN RAISE EXCEPTION 'الموظف غير موجود'; END IF;
 SELECT * INTO v_bank FROM banks_safes WHERE id=p_bank_safe_id AND company_id=p_company_id AND is_active=TRUE FOR UPDATE;
 IF NOT FOUND OR v_bank.account_id IS NULL THEN RAISE EXCEPTION 'البنك أو الخزينة غير موجود'; END IF;
 SELECT id INTO v_counterpart FROM accounts WHERE company_id=p_company_id AND code=CASE p_disbursement_type
  WHEN 'supplier' THEN '2110' WHEN 'employee_advance' THEN '1160' WHEN 'subcontractor' THEN '2150'
  WHEN 'client_refund' THEN '1130' ELSE '5400' END AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
 IF v_counterpart IS NULL OR v_counterpart=v_bank.account_id THEN RAISE EXCEPTION 'الحساب المقابل غير صالح'; END IF;

 FOR v_item IN SELECT value FROM jsonb_array_elements(p_allocations) LOOP
  BEGIN v_alloc:=(v_item->>'amount')::NUMERIC; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'مبلغ التخصيص غير صالح'; END;
  IF NULLIF(v_item->>'invoice_id','') IS NULL OR v_alloc<=0 OR v_alloc<>ROUND(v_alloc,2) THEN RAISE EXCEPTION 'بيانات تخصيص الفواتير غير صالحة'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_allocations) x WHERE x->>'invoice_id'=v_item->>'invoice_id' GROUP BY x->>'invoice_id' HAVING COUNT(*)>1) THEN RAISE EXCEPTION 'تخصيص فاتورة مكرر'; END IF;
  SELECT * INTO v_invoice FROM purchase_invoices WHERE id=(v_item->>'invoice_id')::UUID AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND OR v_invoice.status IN ('cancelled','paid') THEN RAISE EXCEPTION 'فاتورة الشراء غير صالحة للتخصيص'; END IF;
  IF p_contact_id IS NOT NULL AND v_invoice.supplier_id<>p_contact_id THEN RAISE EXCEPTION 'الفاتورة لا تخص الطرف المحدد'; END IF;
  IF v_invoice.paid_amount+v_alloc>v_invoice.total+0.005 THEN RAISE EXCEPTION 'التخصيص يتجاوز المتبقي على الفاتورة'; END IF;
  v_alloc_total:=v_alloc_total+v_alloc;
 END LOOP;
 IF v_alloc_total>p_amount+0.005 THEN RAISE EXCEPTION 'مجموع التخصيصات يتجاوز مبلغ السند'; END IF;

 v_number:=next_voucher_number(p_company_id,'voucher_disbursements');
 INSERT INTO voucher_disbursements(company_id,number,date,disbursement_type,contact_id,employee_id,amount,bank_safe_id,reason,created_by,status)
 VALUES(p_company_id,v_number,p_date,p_disbursement_type,p_contact_id,p_employee_id,p_amount,p_bank_safe_id,BTRIM(p_reason),p_user_id,
  CASE WHEN p_request_approval THEN 'pending' ELSE 'approved' END) RETURNING * INTO v_voucher;

 IF p_request_approval THEN
  INSERT INTO approval_requests(company_id,transaction_type,transaction_id,entity_type,entity_id,amount,requester_id,status,message,description)
  VALUES(p_company_id,'voucher_disbursement',v_voucher.id::TEXT,'voucher_disbursement',v_voucher.id,p_amount,p_user_id,'pending',BTRIM(p_reason),BTRIM(p_reason)) RETURNING * INTO v_approval;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_allocations) LOOP
   INSERT INTO disbursement_invoice_items(company_id,voucher_disbursement_id,purchase_invoice_id,amount,journal_entry_id)
   VALUES(p_company_id,v_voucher.id,(v_item->>'invoice_id')::UUID,(v_item->>'amount')::NUMERIC,NULL);
  END LOOP;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values) VALUES(p_company_id,p_user_id,'request_approval','voucher_disbursement',v_voucher.id,jsonb_build_object('approval_id',v_approval.id,'amount',p_amount));
  RETURN to_jsonb(v_voucher)||jsonb_build_object('requires_approval',TRUE,'approval_id',v_approval.id);
 END IF;

 v_balance:=get_account_balance(p_company_id,v_bank.account_id,NULL,NULL);
 IF v_balance+0.005<p_amount THEN RAISE EXCEPTION 'الرصيد غير كاف للصرف'; END IF;
 v_journal:=create_journal_entry(p_company_id,p_date,'general','سند صرف رقم '||v_number||': '||BTRIM(p_reason),p_user_id,jsonb_build_array(
  jsonb_build_object('accountId',v_counterpart,'debit',p_amount,'credit',0,'contactId',p_contact_id),
  jsonb_build_object('accountId',v_bank.account_id,'debit',0,'credit',p_amount)));
 v_journal_id:=(v_journal->>'id')::UUID;
 UPDATE journal_entries SET reference_type='voucher_disbursement',reference_id=v_voucher.id WHERE id=v_journal_id AND company_id=p_company_id;
 FOR v_item IN SELECT value FROM jsonb_array_elements(p_allocations) LOOP
  SELECT * INTO v_invoice FROM purchase_invoices WHERE id=(v_item->>'invoice_id')::UUID AND company_id=p_company_id FOR UPDATE;
  v_alloc:=(v_item->>'amount')::NUMERIC; v_new_paid:=ROUND(v_invoice.paid_amount+v_alloc,2);
  UPDATE purchase_invoices SET paid_amount=v_new_paid,status=CASE WHEN v_new_paid>=v_invoice.total-0.005 THEN 'paid' ELSE 'partial' END WHERE id=v_invoice.id;
  INSERT INTO disbursement_invoice_items(company_id,voucher_disbursement_id,purchase_invoice_id,amount,journal_entry_id)
  VALUES(p_company_id,v_voucher.id,v_invoice.id,v_alloc,v_journal_id);
 END LOOP;
 UPDATE voucher_disbursements SET journal_entry_id=v_journal_id WHERE id=v_voucher.id RETURNING * INTO v_voucher;
 INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values) VALUES(p_company_id,p_user_id,'post','voucher_disbursement',v_voucher.id,to_jsonb(v_voucher));
 RETURN to_jsonb(v_voucher)||jsonb_build_object('requires_approval',FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_voucher_disbursement_approval(
 p_company_id UUID,p_approval_id UUID,p_action TEXT,p_approver_user_id UUID,p_approver_chat_id TEXT,p_comments TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_request approval_requests%ROWTYPE; v_voucher voucher_disbursements%ROWTYPE; v_bank banks_safes%ROWTYPE;
 v_counterpart UUID; v_balance NUMERIC; v_journal JSONB; v_journal_id UUID; v_link disbursement_invoice_items%ROWTYPE;
 v_invoice purchase_invoices%ROWTYPE; v_new_paid NUMERIC; v_actor UUID;
BEGIN
 IF p_action NOT IN ('approve','reject') OR LENGTH(COALESCE(p_comments,''))>2000 THEN RAISE EXCEPTION 'قرار الاعتماد غير صالح'; END IF;
 SELECT * INTO v_request FROM approval_requests WHERE id=p_approval_id AND company_id=p_company_id FOR UPDATE;
 IF NOT FOUND OR v_request.status<>'pending' OR v_request.transaction_type<>'voucher_disbursement' THEN RAISE EXCEPTION 'طلب الاعتماد غير موجود أو تمت معالجته'; END IF;
 IF p_approver_user_id IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_approver_user_id AND company_id=p_company_id AND is_active=TRUE
   AND (role='admin' OR p_approver_user_id=v_request.approver_id)) THEN RAISE EXCEPTION 'المستخدم غير مخول بالاعتماد'; END IF;
  v_actor:=p_approver_user_id;
 ELSE
  IF NULLIF(p_approver_chat_id,'') IS NULL OR NOT EXISTS(SELECT 1 FROM company_telegram_configs WHERE company_id=p_company_id AND approvals_enabled=TRUE AND is_enabled=TRUE AND chat_id=p_approver_chat_id) THEN RAISE EXCEPTION 'حساب تيليجرام غير مخول بالاعتماد'; END IF;
  v_actor:=v_request.requester_id;
 END IF;
 SELECT * INTO v_voucher FROM voucher_disbursements WHERE id=v_request.entity_id AND company_id=p_company_id FOR UPDATE;
 IF NOT FOUND OR v_voucher.status<>'pending' OR v_voucher.journal_entry_id IS NOT NULL THEN RAISE EXCEPTION 'سند الصرف ليس في حالة انتظار سليمة'; END IF;
 IF p_action='reject' THEN
  UPDATE voucher_disbursements SET status='rejected' WHERE id=v_voucher.id;
  UPDATE approval_requests SET status='rejected',approved_by=p_approver_user_id,approver_chat_id=p_approver_chat_id,
   approved_at=NOW(),approval_comments=NULLIF(BTRIM(p_comments),''),updated_at=NOW() WHERE id=p_approval_id;
  INSERT INTO notifications(company_id,user_id,type,title,message,entity_type,entity_id)
   VALUES(p_company_id,v_request.requester_id,'warning','تم رفض طلبك','سند صرف - تم الرفض','approval_request',p_approval_id);
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values) VALUES(p_company_id,v_actor,'reject_approval','approval_request',p_approval_id,jsonb_build_object('voucher_id',v_voucher.id,'chat_id',p_approver_chat_id));
  RETURN jsonb_build_object('status','rejected','voucher_id',v_voucher.id,'requester_id',v_request.requester_id);
 END IF;
 SELECT * INTO v_bank FROM banks_safes WHERE id=v_voucher.bank_safe_id AND company_id=p_company_id AND is_active=TRUE FOR UPDATE;
 IF NOT FOUND OR v_bank.account_id IS NULL THEN RAISE EXCEPTION 'حساب السداد غير صالح'; END IF;
 v_balance:=get_account_balance(p_company_id,v_bank.account_id,NULL,NULL);
 IF v_balance+0.005<v_voucher.amount THEN RAISE EXCEPTION 'الرصيد غير كاف للصرف'; END IF;
 SELECT id INTO v_counterpart FROM accounts WHERE company_id=p_company_id AND code=CASE v_voucher.disbursement_type
  WHEN 'supplier' THEN '2110' WHEN 'employee_advance' THEN '1160' WHEN 'subcontractor' THEN '2150' WHEN 'client_refund' THEN '1130' ELSE '5400' END
  AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
 IF v_counterpart IS NULL THEN RAISE EXCEPTION 'الحساب المقابل غير موجود'; END IF;
 v_journal:=create_journal_entry(p_company_id,v_voucher.date,'general','اعتماد سند صرف رقم '||v_voucher.number||': '||v_voucher.reason,v_request.requester_id,jsonb_build_array(
  jsonb_build_object('accountId',v_counterpart,'debit',v_voucher.amount,'credit',0,'contactId',v_voucher.contact_id),
  jsonb_build_object('accountId',v_bank.account_id,'debit',0,'credit',v_voucher.amount)));
 v_journal_id:=(v_journal->>'id')::UUID;
 UPDATE journal_entries SET reference_type='voucher_disbursement',reference_id=v_voucher.id WHERE id=v_journal_id AND company_id=p_company_id;
 FOR v_link IN SELECT * FROM disbursement_invoice_items WHERE company_id=p_company_id AND voucher_disbursement_id=v_voucher.id FOR UPDATE LOOP
  SELECT * INTO v_invoice FROM purchase_invoices WHERE id=v_link.purchase_invoice_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND OR v_invoice.status='cancelled' OR (v_voucher.contact_id IS NOT NULL AND v_invoice.supplier_id<>v_voucher.contact_id)
    OR v_invoice.paid_amount+v_link.amount>v_invoice.total+0.005 THEN RAISE EXCEPTION 'تعذر تطبيق تخصيص فاتورة الشراء'; END IF;
  v_new_paid:=ROUND(v_invoice.paid_amount+v_link.amount,2);
  UPDATE purchase_invoices SET paid_amount=v_new_paid,status=CASE WHEN v_new_paid>=v_invoice.total-0.005 THEN 'paid' ELSE 'partial' END WHERE id=v_invoice.id;
  UPDATE disbursement_invoice_items SET journal_entry_id=v_journal_id WHERE id=v_link.id;
 END LOOP;
 UPDATE voucher_disbursements SET status='approved',journal_entry_id=v_journal_id WHERE id=v_voucher.id RETURNING * INTO v_voucher;
 UPDATE approval_requests SET status='approved',approved_by=p_approver_user_id,approver_chat_id=p_approver_chat_id,approved_at=NOW(),
  approval_comments=NULLIF(BTRIM(p_comments),''),updated_at=NOW() WHERE id=p_approval_id;
 INSERT INTO notifications(company_id,user_id,type,title,message,entity_type,entity_id)
 VALUES(p_company_id,v_request.requester_id,'success','تم اعتماد طلبك','سند صرف - تم الاعتماد بنجاح','approval_request',p_approval_id);
 INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values) VALUES(p_company_id,v_actor,'approve_approval','approval_request',p_approval_id,jsonb_build_object('voucher_id',v_voucher.id,'journal_entry_id',v_journal_id,'chat_id',p_approver_chat_id));
 RETURN jsonb_build_object('status','approved','voucher_id',v_voucher.id,'journal_entry_id',v_journal_id,'requester_id',v_request.requester_id);
END;
$$;

REVOKE ALL ON FUNCTION public.create_voucher_disbursement_atomic(UUID,DATE,TEXT,UUID,UUID,NUMERIC,UUID,TEXT,JSONB,BOOLEAN,UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.respond_voucher_disbursement_approval(UUID,UUID,TEXT,UUID,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_voucher_disbursement_atomic(UUID,DATE,TEXT,UUID,UUID,NUMERIC,UUID,TEXT,JSONB,BOOLEAN,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.respond_voucher_disbursement_approval(UUID,UUID,TEXT,UUID,TEXT,TEXT) TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS uq_receipt_invoice_allocation ON receipt_invoice_items(company_id,voucher_receipt_id,invoice_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_voucher_receipt_journal ON voucher_receipts(journal_entry_id) WHERE journal_entry_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_voucher_receipt_atomic(
 p_company_id UUID,p_date DATE,p_receipt_type TEXT,p_contact_id UUID,p_amount NUMERIC,p_bank_safe_id UUID,
 p_reason TEXT,p_allocations JSONB,p_auto_fifo BOOLEAN,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_bank banks_safes%ROWTYPE; v_receipt voucher_receipts%ROWTYPE; v_number INTEGER; v_counterpart UUID;
 v_journal JSONB; v_journal_id UUID; v_item JSONB; v_invoice invoices%ROWTYPE; v_alloc NUMERIC;
 v_alloc_total NUMERIC:=0; v_applied NUMERIC:=0; v_remaining NUMERIC; v_new_paid NUMERIC;
BEGIN
 IF p_date IS NULL OR p_receipt_type NOT IN ('client','supplier_refund','general') OR p_amount<=0 OR p_amount<>ROUND(p_amount,2)
  OR NULLIF(BTRIM(p_reason),'') IS NULL OR LENGTH(p_reason)>500 OR jsonb_typeof(p_allocations)<>'array' OR jsonb_array_length(p_allocations)>100 THEN RAISE EXCEPTION 'بيانات سند القبض غير صالحة'; END IF;
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE) THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
 IF p_contact_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM contacts WHERE id=p_contact_id AND company_id=p_company_id) THEN RAISE EXCEPTION 'الطرف غير موجود'; END IF;
 SELECT * INTO v_bank FROM banks_safes WHERE id=p_bank_safe_id AND company_id=p_company_id AND is_active=TRUE FOR UPDATE;
 IF NOT FOUND OR v_bank.account_id IS NULL THEN RAISE EXCEPTION 'البنك أو الخزينة غير موجود'; END IF;
 SELECT id INTO v_counterpart FROM accounts WHERE company_id=p_company_id AND code=CASE p_receipt_type WHEN 'client' THEN '1130' WHEN 'supplier_refund' THEN '2110' ELSE '4200' END
  AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
 IF v_counterpart IS NULL OR v_counterpart=v_bank.account_id THEN RAISE EXCEPTION 'الحساب المقابل غير صالح'; END IF;
 FOR v_item IN SELECT value FROM jsonb_array_elements(p_allocations) LOOP
  BEGIN v_alloc:=(v_item->>'amount')::NUMERIC; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'مبلغ التخصيص غير صالح'; END;
  IF NULLIF(v_item->>'invoice_id','') IS NULL OR v_alloc<=0 OR v_alloc<>ROUND(v_alloc,2) THEN RAISE EXCEPTION 'بيانات التخصيص غير صالحة'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_allocations) x WHERE x->>'invoice_id'=v_item->>'invoice_id' GROUP BY x->>'invoice_id' HAVING COUNT(*)>1) THEN RAISE EXCEPTION 'تخصيص فاتورة مكرر'; END IF;
  SELECT * INTO v_invoice FROM invoices WHERE id=(v_item->>'invoice_id')::UUID AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND OR v_invoice.status IN ('cancelled','paid') OR (p_contact_id IS NOT NULL AND v_invoice.contact_id<>p_contact_id)
    OR v_invoice.paid_amount+v_alloc>v_invoice.total+0.005 THEN RAISE EXCEPTION 'فاتورة البيع غير صالحة للتخصيص'; END IF;
  v_alloc_total:=v_alloc_total+v_alloc;
 END LOOP;
 IF v_alloc_total>p_amount+0.005 THEN RAISE EXCEPTION 'مجموع التخصيصات يتجاوز مبلغ السند'; END IF;
 v_number:=next_voucher_number(p_company_id,'voucher_receipts');
 INSERT INTO voucher_receipts(company_id,number,date,receipt_type,contact_id,amount,bank_safe_id,reason,created_by,status)
 VALUES(p_company_id,v_number,p_date,p_receipt_type,p_contact_id,p_amount,p_bank_safe_id,BTRIM(p_reason),p_user_id,'approved') RETURNING * INTO v_receipt;
 v_journal:=create_journal_entry(p_company_id,p_date,'general','سند قبض رقم '||v_number||': '||BTRIM(p_reason),p_user_id,jsonb_build_array(
  jsonb_build_object('accountId',v_bank.account_id,'debit',p_amount,'credit',0),
  jsonb_build_object('accountId',v_counterpart,'debit',0,'credit',p_amount,'contactId',p_contact_id)));
 v_journal_id:=(v_journal->>'id')::UUID;
 UPDATE journal_entries SET reference_type='voucher_receipt',reference_id=v_receipt.id WHERE id=v_journal_id AND company_id=p_company_id;
 FOR v_item IN SELECT value FROM jsonb_array_elements(p_allocations) LOOP
  SELECT * INTO v_invoice FROM invoices WHERE id=(v_item->>'invoice_id')::UUID AND company_id=p_company_id FOR UPDATE;
  v_alloc:=(v_item->>'amount')::NUMERIC; v_new_paid:=ROUND(v_invoice.paid_amount+v_alloc,2);
  UPDATE invoices SET paid_amount=v_new_paid,status=CASE WHEN v_new_paid>=v_invoice.total-0.005 THEN 'paid' ELSE 'partial' END WHERE id=v_invoice.id;
  INSERT INTO receipt_invoice_items(company_id,voucher_receipt_id,invoice_id,amount,journal_entry_id) VALUES(p_company_id,v_receipt.id,v_invoice.id,v_alloc,v_journal_id);
  v_applied:=v_applied+v_alloc;
 END LOOP;
 IF jsonb_array_length(p_allocations)=0 AND p_auto_fifo AND p_receipt_type='client' AND p_contact_id IS NOT NULL THEN
  v_remaining:=p_amount;
  FOR v_invoice IN SELECT * FROM invoices WHERE company_id=p_company_id AND contact_id=p_contact_id AND status NOT IN ('cancelled','paid') ORDER BY date,number FOR UPDATE LOOP
   EXIT WHEN v_remaining<=0.005;
   v_alloc:=LEAST(v_remaining,ROUND(v_invoice.total-v_invoice.paid_amount,2)); CONTINUE WHEN v_alloc<=0;
   v_new_paid:=ROUND(v_invoice.paid_amount+v_alloc,2);
   UPDATE invoices SET paid_amount=v_new_paid,status=CASE WHEN v_new_paid>=v_invoice.total-0.005 THEN 'paid' ELSE 'partial' END WHERE id=v_invoice.id;
   INSERT INTO receipt_invoice_items(company_id,voucher_receipt_id,invoice_id,amount,journal_entry_id) VALUES(p_company_id,v_receipt.id,v_invoice.id,v_alloc,v_journal_id);
   v_applied:=v_applied+v_alloc; v_remaining:=v_remaining-v_alloc;
  END LOOP;
 END IF;
 UPDATE voucher_receipts SET journal_entry_id=v_journal_id WHERE id=v_receipt.id RETURNING * INTO v_receipt;
 INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values) VALUES(p_company_id,p_user_id,'post','voucher_receipt',v_receipt.id,to_jsonb(v_receipt));
 RETURN to_jsonb(v_receipt)||jsonb_build_object('allocated_amount',ROUND(v_applied,2),'unapplied_amount',ROUND(p_amount-v_applied,2));
END;
$$;
REVOKE ALL ON FUNCTION public.create_voucher_receipt_atomic(UUID,DATE,TEXT,UUID,NUMERIC,UUID,TEXT,JSONB,BOOLEAN,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_voucher_receipt_atomic(UUID,DATE,TEXT,UUID,NUMERIC,UUID,TEXT,JSONB,BOOLEAN,UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.deactivate_bank_safe(p_company_id UUID,p_bank_safe_id UUID,p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_bank banks_safes%ROWTYPE; v_balance NUMERIC;
BEGIN
 SELECT * INTO v_bank FROM banks_safes WHERE id=p_bank_safe_id AND company_id=p_company_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'البنك أو الخزينة غير موجود'; END IF;
 IF v_bank.account_id IS NULL THEN RAISE EXCEPTION 'الحساب المحاسبي غير مربوط'; END IF;
 v_balance:=get_account_balance(p_company_id,v_bank.account_id,NULL,NULL);
 IF ABS(v_balance)>0.005 THEN RAISE EXCEPTION 'لا يمكن تعطيل بنك أو خزينة برصيد غير صفري'; END IF;
 UPDATE banks_safes SET is_active=FALSE,updated_at=NOW() WHERE id=p_bank_safe_id RETURNING * INTO v_bank;
 INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values) VALUES(p_company_id,p_user_id,'deactivate','bank_safe',p_bank_safe_id,jsonb_build_object('is_active',FALSE));
 RETURN to_jsonb(v_bank);
END;
$$;
REVOKE ALL ON FUNCTION public.deactivate_bank_safe(UUID,UUID,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deactivate_bank_safe(UUID,UUID,UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.register_company(
  p_company_name TEXT, p_email TEXT, p_phone TEXT, p_country TEXT, p_country_code TEXT,
  p_currency_code TEXT, p_currency_symbol TEXT, p_locale TEXT, p_vat_rate NUMERIC,
  p_user_name TEXT, p_password_hash TEXT, p_verification_hash TEXT,
  p_verification_expires TIMESTAMPTZ, p_accounts JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_company companies%ROWTYPE; v_user users%ROWTYPE; v_plan RECORD; v_item JSONB;
  v_account_id UUID; v_parent_id UUID; v_account_ids JSONB:='{}'::JSONB; v_cash_id UUID;
BEGIN
  IF NULLIF(BTRIM(p_company_name),'') IS NULL OR NULLIF(BTRIM(p_user_name),'') IS NULL
    OR NULLIF(BTRIM(LOWER(p_email)),'') IS NULL OR NULLIF(p_password_hash,'') IS NULL
    OR jsonb_typeof(p_accounts)<>'array' OR jsonb_array_length(p_accounts)<10 THEN
    RAISE EXCEPTION 'بيانات التسجيل غير مكتملة';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('register-email:'||LOWER(BTRIM(p_email)),0));
  PERFORM pg_advisory_xact_lock(hashtextextended('register-company:'||LOWER(BTRIM(p_company_name)),0));
  IF EXISTS(SELECT 1 FROM users WHERE LOWER(email)=LOWER(BTRIM(p_email))) THEN RAISE EXCEPTION 'البريد الإلكتروني مسجل مسبقاً'; END IF;
  IF EXISTS(SELECT 1 FROM companies WHERE LOWER(name)=LOWER(BTRIM(p_company_name))) THEN RAISE EXCEPTION 'اسم الشركة موجود مسبقاً'; END IF;
  IF NULLIF(BTRIM(p_phone),'') IS NOT NULL AND EXISTS(SELECT 1 FROM companies WHERE phone=BTRIM(p_phone)) THEN RAISE EXCEPTION 'رقم الهاتف مسجل مسبقاً'; END IF;
  SELECT id,code,COALESCE(NULLIF(trial_days,0),7) AS trial_days INTO v_plan
    FROM subscription_plans WHERE code='start' AND is_active=TRUE ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'باقة البداية غير مهيأة'; END IF;

  INSERT INTO companies(name,email,phone,is_active,country,country_code,currency_code,currency_symbol,locale,vat_rate)
  VALUES(BTRIM(p_company_name),LOWER(BTRIM(p_email)),NULLIF(BTRIM(p_phone),''),TRUE,p_country,p_country_code,
    p_currency_code,p_currency_symbol,p_locale,p_vat_rate) RETURNING * INTO v_company;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_accounts) LOOP
    IF NULLIF(v_item->>'code','') IS NULL OR NULLIF(v_item->>'name','') IS NULL
      OR v_item->>'type' NOT IN ('asset','liability','equity','revenue','expense') THEN RAISE EXCEPTION 'دليل الحسابات الافتراضي غير صالح'; END IF;
    INSERT INTO accounts(company_id,code,name,name_en,type,parent_id,is_active,is_header)
    VALUES(v_company.id,v_item->>'code',v_item->>'name',NULLIF(v_item->>'name_en',''),v_item->>'type',NULL,TRUE,
      COALESCE((v_item->>'is_header')::BOOLEAN,FALSE)) RETURNING id INTO v_account_id;
    v_account_ids:=jsonb_set(v_account_ids,ARRAY[v_item->>'code'],to_jsonb(v_account_id::TEXT),TRUE);
  END LOOP;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_accounts) LOOP
    IF NULLIF(v_item->>'parent_code','') IS NOT NULL THEN
      v_parent_id:=NULLIF(v_account_ids->>(v_item->>'parent_code'),'')::UUID;
      IF v_parent_id IS NULL THEN RAISE EXCEPTION 'الحساب الأب الافتراضي غير موجود'; END IF;
      UPDATE accounts SET parent_id=v_parent_id
        WHERE id=NULLIF(v_account_ids->>(v_item->>'code'),'')::UUID AND company_id=v_company.id;
    END IF;
  END LOOP;
  v_cash_id:=NULLIF(v_account_ids->>'1110','')::UUID;
  IF v_cash_id IS NULL THEN RAISE EXCEPTION 'حساب الخزينة الافتراضي غير موجود'; END IF;
  INSERT INTO banks_safes(company_id,name,type,account_id,opening_balance,is_active)
  VALUES(v_company.id,'الخزينة الرئيسية','safe',v_cash_id,0,TRUE);

  INSERT INTO users(company_id,name,email,password_hash,role,is_active,email_verified,email_verification_token,email_verification_expires)
  VALUES(v_company.id,BTRIM(p_user_name),LOWER(BTRIM(p_email)),p_password_hash,'admin',TRUE,FALSE,p_verification_hash,p_verification_expires)
  RETURNING * INTO v_user;
  INSERT INTO subscriptions(company_id,plan_id,plan_code,status,start_date,end_date,trial_end_date,auto_renew)
  VALUES(v_company.id,v_plan.id,v_plan.code,'trial',CURRENT_DATE,CURRENT_DATE+v_plan.trial_days,
    CURRENT_DATE+v_plan.trial_days,FALSE);
  INSERT INTO settings(company_id,key,value) VALUES
    (v_company.id,'currency',p_currency_code),(v_company.id,'language','ar'),
    (v_company.id,'date_format','YYYY-MM-DD'),(v_company.id,'vat_rate',p_vat_rate::TEXT);
  RETURN jsonb_build_object('company',jsonb_build_object('id',v_company.id,'name',v_company.name),
    'user',jsonb_build_object('id',v_user.id,'name',v_user.name,'email',v_user.email,'role',v_user.role));
END;
$$;
REVOKE ALL ON FUNCTION public.register_company(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,NUMERIC,TEXT,TEXT,TEXT,TIMESTAMPTZ,JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_company(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,NUMERIC,TEXT,TEXT,TEXT,TIMESTAMPTZ,JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.setup_initial_company(
  p_company_name TEXT, p_commercial_registration TEXT, p_tax_number TEXT,
  p_email TEXT, p_user_name TEXT, p_password_hash TEXT, p_accounts JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_result JSONB; v_company_id UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('initial-company-bootstrap',0));
  IF EXISTS(SELECT 1 FROM companies) THEN RAISE EXCEPTION 'تم إعداد النظام مسبقاً'; END IF;
  v_result:=register_company(p_company_name,p_email,'','المملكة العربية السعودية','SA','SAR','ر.س','ar-SA',0.15,
    p_user_name,p_password_hash,encode(digest(gen_random_uuid()::TEXT,'sha256'),'hex'),NOW()+INTERVAL '24 hours',p_accounts);
  v_company_id:=(v_result->'company'->>'id')::UUID;
  UPDATE companies SET commercial_registration=NULLIF(BTRIM(p_commercial_registration),''),
    tax_number=NULLIF(BTRIM(p_tax_number),'') WHERE id=v_company_id;
  UPDATE users SET email_verified=TRUE,email_verification_token=NULL,email_verification_expires=NULL
    WHERE id=(v_result->'user'->>'id')::UUID AND company_id=v_company_id;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.setup_initial_company(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.setup_initial_company(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.reset_company_business_data(
  p_company_id UUID, p_user_id UUID, p_code_hash TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_session JSONB; v_attempts INTEGER; v_tables TEXT[]; v_done TEXT[]:='{}';
  v_table TEXT; v_pass INTEGER; v_progress BOOLEAN; v_remaining INTEGER;
  v_preserve TEXT[]:=ARRAY[
    'companies','users','accounts','banks_safes','settings','company_telegram_configs',
    'subscriptions','company_usage_limits','user_permissions','audit_log','security_audit_log',
    'financial_audit_log','financial_audit_trails','company_data_exports','backup_logs',
    'support_tickets','complaints','upgrade_requests','addon_requests','addon_grant_audit',
    'company_messages','company_registration_tokens'
  ];
BEGIN
  SELECT reset_session_data INTO v_session FROM company_telegram_configs
    WHERE company_id=p_company_id FOR UPDATE;
  IF NOT FOUND OR v_session IS NULL OR v_session->>'step'<>'approved_and_code_sent' THEN
    RETURN jsonb_build_object('status','not_approved');
  END IF;
  IF COALESCE(v_session->>'requester_id','')<>p_user_id::TEXT THEN
    RETURN jsonb_build_object('status','wrong_requester');
  END IF;
  IF NULLIF(v_session->>'expires_at','') IS NULL OR (v_session->>'expires_at')::TIMESTAMPTZ<NOW() THEN
    UPDATE company_telegram_configs SET reset_session_data=NULL WHERE company_id=p_company_id;
    RETURN jsonb_build_object('status','expired');
  END IF;
  v_attempts:=COALESCE((v_session->>'attempts')::INTEGER,0);
  IF p_code_hash IS NULL OR LENGTH(p_code_hash)<>64 OR COALESCE(v_session->>'code_hash','')<>p_code_hash THEN
    v_attempts:=v_attempts+1;
    IF v_attempts>=5 THEN
      UPDATE company_telegram_configs SET reset_session_data=NULL WHERE company_id=p_company_id;
      RETURN jsonb_build_object('status','locked');
    END IF;
    UPDATE company_telegram_configs
      SET reset_session_data=jsonb_set(v_session,'{attempts}',to_jsonb(v_attempts),TRUE)
      WHERE company_id=p_company_id;
    RETURN jsonb_build_object('status','invalid_code','attempts_remaining',5-v_attempts);
  END IF;

  -- Consume the one-time capability inside this same transaction. Any purge
  -- failure rolls this change back together with all deletes.
  UPDATE company_telegram_configs SET reset_session_data=NULL WHERE company_id=p_company_id;
  -- Preserved cash-account configuration must release references to journals
  -- that are about to be purged.
  UPDATE banks_safes SET opening_balance=0,opening_journal_entry_id=NULL WHERE company_id=p_company_id;
  SELECT array_agg(c.table_name ORDER BY c.table_name) INTO v_tables
  FROM information_schema.columns c
  JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name
    AND t.table_type='BASE TABLE'
  WHERE c.table_schema='public' AND c.column_name='company_id'
    AND c.table_name<>ALL(v_preserve);

  -- Delete tenant rows in dependency-safe passes. A table blocked by a child
  -- foreign key is retried after that child has been emptied.
  FOR v_pass IN 1..COALESCE(array_length(v_tables,1),0)+1 LOOP
    v_progress:=FALSE;
    FOREACH v_table IN ARRAY COALESCE(v_tables,'{}') LOOP
      IF v_table=ANY(v_done) THEN CONTINUE; END IF;
      BEGIN
        EXECUTE format('DELETE FROM %I WHERE company_id=$1',v_table) USING p_company_id;
        v_done:=array_append(v_done,v_table); v_progress:=TRUE;
      EXCEPTION WHEN foreign_key_violation THEN
        NULL;
      END;
    END LOOP;
    EXIT WHEN COALESCE(array_length(v_done,1),0)=COALESCE(array_length(v_tables,1),0);
    EXIT WHEN NOT v_progress;
  END LOOP;
  v_remaining:=COALESCE(array_length(v_tables,1),0)-COALESCE(array_length(v_done,1),0);
  IF v_remaining<>0 THEN RAISE EXCEPTION 'تعذر تصفير بعض الجداول المرتبطة (% جدول)',v_remaining; END IF;

  UPDATE banks_safes SET opening_balance=0 WHERE company_id=p_company_id;
  INSERT INTO security_audit_log(company_id,user_id,action,details)
  VALUES(p_company_id,p_user_id,'company_database_hard_reset_success',jsonb_build_object('date',NOW(),'tables_reset',array_length(v_done,1)));
  RETURN jsonb_build_object('status','reset_success','tables_reset',COALESCE(array_length(v_done,1),0));
END;
$$;
REVOKE ALL ON FUNCTION public.reset_company_business_data(UUID,UUID,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_company_business_data(UUID,UUID,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.create_quotation(
  p_company_id UUID, p_date DATE, p_contact_id UUID, p_items JSONB,
  p_notes TEXT, p_tax_rate NUMERIC, p_valid_until DATE, p_created_by UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_number INTEGER; v_quote quotations%ROWTYPE; v_item JSONB;
  v_quantity NUMERIC; v_price NUMERIC; v_line_total NUMERIC; v_subtotal NUMERIC:=0;
BEGIN
  IF jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)<1 OR jsonb_array_length(p_items)>1000
    OR p_tax_rate IS NULL OR p_tax_rate<0 OR p_tax_rate>1 OR p_tax_rate<>ROUND(p_tax_rate,4)
    OR LENGTH(COALESCE(p_notes,''))>5000 OR (p_valid_until IS NOT NULL AND p_valid_until<p_date) THEN
    RAISE EXCEPTION 'بيانات عرض السعر غير صالحة';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM contacts WHERE id=p_contact_id AND company_id=p_company_id) THEN RAISE EXCEPTION 'العميل غير موجود'; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    BEGIN
      v_quantity:=(v_item->>'quantity')::NUMERIC; v_price:=(v_item->>'unit_price')::NUMERIC;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'بند عرض السعر غير صالح'; END;
    IF NULLIF(BTRIM(v_item->>'description'),'') IS NULL OR LENGTH(v_item->>'description')>1000
      OR v_quantity<=0 OR v_price<0 OR v_quantity<>ROUND(v_quantity,2) OR v_price<>ROUND(v_price,2) THEN
      RAISE EXCEPTION 'بند عرض السعر غير صالح';
    END IF;
    v_subtotal:=v_subtotal+ROUND(v_quantity*v_price,2);
  END LOOP;
  v_number:=next_quotation_number(p_company_id);
  INSERT INTO quotations(company_id,number,date,contact_id,subtotal,tax_amount,tax_rate,total,notes,valid_until,status,created_by)
  VALUES(p_company_id,v_number,p_date,p_contact_id,v_subtotal,ROUND(v_subtotal*p_tax_rate,2),p_tax_rate,
    v_subtotal+ROUND(v_subtotal*p_tax_rate,2),NULLIF(BTRIM(p_notes),''),p_valid_until,'draft',p_created_by)
  RETURNING * INTO v_quote;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_quantity:=(v_item->>'quantity')::NUMERIC; v_price:=(v_item->>'unit_price')::NUMERIC; v_line_total:=ROUND(v_quantity*v_price,2);
    INSERT INTO quotation_items(company_id,quotation_id,description,quantity,unit_price,total)
    VALUES(p_company_id,v_quote.id,BTRIM(v_item->>'description'),v_quantity,v_price,v_line_total);
  END LOOP;
  RETURN to_jsonb(v_quote)||jsonb_build_object('items',(SELECT jsonb_agg(to_jsonb(qi) ORDER BY qi.id) FROM quotation_items qi WHERE qi.quotation_id=v_quote.id));
END;
$$;

CREATE OR REPLACE FUNCTION public.update_draft_quotation(
  p_company_id UUID, p_quotation_id UUID, p_payload JSONB, p_items JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_quote quotations%ROWTYPE; v_item JSONB; v_contact UUID; v_date DATE; v_valid DATE;
  v_rate NUMERIC; v_discount NUMERIC; v_quantity NUMERIC; v_price NUMERIC; v_subtotal NUMERIC:=0;
BEGIN
  SELECT * INTO v_quote FROM quotations WHERE id=p_quotation_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'عرض السعر غير موجود'; END IF;
  IF v_quote.status<>'draft' THEN RAISE EXCEPTION 'لا يمكن تعديل عرض سعر غير مسودة'; END IF;
  IF jsonb_typeof(COALESCE(p_payload,'{}'::JSONB))<>'object' THEN RAISE EXCEPTION 'بيانات التعديل غير صالحة'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(COALESCE(p_payload,'{}'::JSONB)) key
    WHERE key NOT IN ('date','contact_id','valid_until','notes','terms','status','tax_rate','discount_amount')) THEN
    RAISE EXCEPTION 'حقل تعديل غير مسموح';
  END IF;
  v_date:=CASE WHEN p_payload?'date' THEN (p_payload->>'date')::DATE ELSE v_quote.date END;
  v_contact:=CASE WHEN p_payload?'contact_id' THEN (p_payload->>'contact_id')::UUID ELSE v_quote.contact_id END;
  v_valid:=CASE WHEN p_payload?'valid_until' AND NULLIF(p_payload->>'valid_until','') IS NOT NULL THEN (p_payload->>'valid_until')::DATE
    WHEN p_payload?'valid_until' THEN NULL ELSE v_quote.valid_until END;
  IF v_contact IS NULL OR NOT EXISTS(SELECT 1 FROM contacts WHERE id=v_contact AND company_id=p_company_id) THEN RAISE EXCEPTION 'العميل غير موجود'; END IF;
  IF v_valid IS NOT NULL AND v_valid<v_date THEN RAISE EXCEPTION 'تاريخ الصلاحية غير صالح'; END IF;
  IF p_payload?'status' AND p_payload->>'status'<>'sent' THEN RAISE EXCEPTION 'انتقال الحالة غير صالح'; END IF;
  IF p_items IS NULL AND (p_payload?'tax_rate' OR p_payload?'discount_amount') THEN RAISE EXCEPTION 'تعديل الضريبة أو الخصم يتطلب البنود'; END IF;
  IF LENGTH(COALESCE(p_payload->>'notes',v_quote.notes,''))>5000 OR LENGTH(COALESCE(p_payload->>'terms',v_quote.terms,''))>5000 THEN RAISE EXCEPTION 'النص طويل جداً'; END IF;

  IF p_items IS NOT NULL THEN
    IF jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)<1 OR jsonb_array_length(p_items)>1000 THEN RAISE EXCEPTION 'بنود عرض السعر غير صالحة'; END IF;
    v_rate:=CASE WHEN p_payload?'tax_rate' THEN (p_payload->>'tax_rate')::NUMERIC ELSE v_quote.tax_rate END;
    v_discount:=CASE WHEN p_payload?'discount_amount' THEN (p_payload->>'discount_amount')::NUMERIC ELSE v_quote.discount_amount END;
    IF v_rate<0 OR v_rate>1 OR v_rate<>ROUND(v_rate,4) OR v_discount<0 OR v_discount<>ROUND(v_discount,2) THEN RAISE EXCEPTION 'الضريبة أو الخصم غير صالح'; END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
      v_quantity:=(v_item->>'quantity')::NUMERIC; v_price:=(v_item->>'unit_price')::NUMERIC;
      IF NULLIF(BTRIM(v_item->>'description'),'') IS NULL OR LENGTH(v_item->>'description')>1000
        OR v_quantity<=0 OR v_price<0 OR v_quantity<>ROUND(v_quantity,2) OR v_price<>ROUND(v_price,2) THEN RAISE EXCEPTION 'بند عرض السعر غير صالح'; END IF;
      v_subtotal:=v_subtotal+ROUND(v_quantity*v_price,2);
    END LOOP;
    IF v_discount>v_subtotal+ROUND(v_subtotal*v_rate,2) THEN RAISE EXCEPTION 'الخصم أكبر من الإجمالي'; END IF;
    DELETE FROM quotation_items WHERE quotation_id=p_quotation_id AND company_id=p_company_id;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
      v_quantity:=(v_item->>'quantity')::NUMERIC; v_price:=(v_item->>'unit_price')::NUMERIC;
      INSERT INTO quotation_items(company_id,quotation_id,description,quantity,unit_price,total)
      VALUES(p_company_id,p_quotation_id,BTRIM(v_item->>'description'),v_quantity,v_price,ROUND(v_quantity*v_price,2));
    END LOOP;
  ELSE
    v_rate:=v_quote.tax_rate; v_discount:=v_quote.discount_amount; v_subtotal:=v_quote.subtotal;
  END IF;
  UPDATE quotations SET date=v_date,contact_id=v_contact,valid_until=v_valid,
    notes=CASE WHEN p_payload?'notes' THEN NULLIF(BTRIM(p_payload->>'notes'),'') ELSE notes END,
    terms=CASE WHEN p_payload?'terms' THEN NULLIF(BTRIM(p_payload->>'terms'),'') ELSE terms END,
    status=CASE WHEN p_payload?'status' THEN 'sent' ELSE status END,
    subtotal=v_subtotal,tax_rate=v_rate,tax_amount=ROUND(v_subtotal*v_rate,2),discount_amount=v_discount,
    total=v_subtotal+ROUND(v_subtotal*v_rate,2)-v_discount
  WHERE id=p_quotation_id RETURNING * INTO v_quote;
  RETURN to_jsonb(v_quote)||jsonb_build_object('items',(SELECT jsonb_agg(to_jsonb(qi) ORDER BY qi.id) FROM quotation_items qi WHERE qi.quotation_id=v_quote.id));
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_draft_quotation(p_company_id UUID,p_quotation_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM quotations WHERE id=p_quotation_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'عرض السعر غير موجود'; END IF;
  IF v_status<>'draft' THEN RAISE EXCEPTION 'لا يمكن حذف عرض سعر غير مسودة'; END IF;
  DELETE FROM quotation_items WHERE quotation_id=p_quotation_id AND company_id=p_company_id;
  DELETE FROM quotations WHERE id=p_quotation_id AND company_id=p_company_id;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.create_quotation(UUID,DATE,UUID,JSONB,TEXT,NUMERIC,DATE,UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_draft_quotation(UUID,UUID,JSONB,JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_draft_quotation(UUID,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_quotation(UUID,DATE,UUID,JSONB,TEXT,NUMERIC,DATE,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_draft_quotation(UUID,UUID,JSONB,JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_draft_quotation(UUID,UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.post_project_expense(
  p_company_id UUID, p_project_id UUID, p_expense_type TEXT, p_description TEXT,
  p_amount NUMERIC, p_date DATE, p_contact_id UUID, p_bank_safe_id UUID,
  p_expense_account_id UUID, p_notes TEXT, p_tax_rate NUMERIC, p_created_by UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_project projects%ROWTYPE; v_payment_account UUID; v_vat_account UUID;
  v_tax NUMERIC; v_total NUMERIC; v_balance NUMERIC; v_lines JSONB;
  v_expense project_expenses%ROWTYPE; v_journal JSONB; v_journal_id UUID;
BEGIN
  IF NULLIF(BTRIM(p_description),'') IS NULL OR LENGTH(p_description)>2000
    OR p_amount IS NULL OR p_amount<=0 OR p_amount<>ROUND(p_amount,2)
    OR p_tax_rate IS NULL OR p_tax_rate<0 OR p_tax_rate>1 OR p_tax_rate<>ROUND(p_tax_rate,4) THEN
    RAISE EXCEPTION 'بيانات المصروف غير صالحة';
  END IF;
  SELECT * INTO v_project FROM projects WHERE id=p_project_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المشروع غير موجود'; END IF;
  IF v_project.status<>'active' THEN RAISE EXCEPTION 'المشروع غير نشط'; END IF;
  IF p_contact_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM contacts WHERE id=p_contact_id AND company_id=p_company_id) THEN RAISE EXCEPTION 'الطرف غير موجود'; END IF;
  IF p_bank_safe_id IS NOT NULL THEN
    SELECT account_id INTO v_payment_account FROM banks_safes
      WHERE id=p_bank_safe_id AND company_id=p_company_id AND COALESCE(is_active,TRUE)=TRUE FOR UPDATE;
  ELSE
    SELECT id INTO v_payment_account FROM accounts
      WHERE company_id=p_company_id AND code='1110' AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE FOR UPDATE;
  END IF;
  IF v_payment_account IS NULL THEN RAISE EXCEPTION 'حساب الدفع غير موجود'; END IF;
  PERFORM 1 FROM accounts WHERE id=v_payment_account AND company_id=p_company_id FOR UPDATE;
  v_tax:=ROUND(p_amount*p_tax_rate,2); v_total:=p_amount+v_tax;
  v_balance:=get_account_balance(p_company_id,v_payment_account,NULL,NULL);
  IF v_balance+0.005<v_total THEN RAISE EXCEPTION 'رصيد حساب الدفع غير كاف'; END IF;
  v_lines:=jsonb_build_array(
    jsonb_build_object('accountId',p_expense_account_id,'debit',p_amount,'credit',0,'description',p_description,'projectId',p_project_id,'contactId',p_contact_id),
    jsonb_build_object('accountId',v_payment_account,'debit',0,'credit',v_total,'description','دفع مصروف مشروع: '||p_description,'projectId',p_project_id,'contactId',p_contact_id));
  IF v_tax>0 THEN
    SELECT id INTO v_vat_account FROM accounts WHERE company_id=p_company_id AND code='1180'
      AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
    IF v_vat_account IS NULL THEN RAISE EXCEPTION 'حساب ضريبة المشتريات غير موجود'; END IF;
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
      'accountId',v_vat_account,'debit',v_tax,'credit',0,'description','ضريبة مدخلات','projectId',p_project_id,'contactId',p_contact_id));
  END IF;
  INSERT INTO project_expenses(company_id,project_id,expense_type,description,amount,date,contact_id,account_code,
    notes,tax_rate,tax_amount,status,created_by)
  SELECT p_company_id,p_project_id,p_expense_type,BTRIM(p_description),p_amount,p_date,p_contact_id,a.code,
    NULLIF(BTRIM(p_notes),''),p_tax_rate,v_tax,'posted',p_created_by
  FROM accounts a WHERE a.id=p_expense_account_id AND a.company_id=p_company_id
    AND COALESCE(a.is_active,TRUE)=TRUE AND COALESCE(a.is_header,FALSE)=FALSE
  RETURNING * INTO v_expense;
  IF NOT FOUND THEN RAISE EXCEPTION 'حساب المصروف غير صالح'; END IF;
  v_journal:=create_journal_entry(p_company_id,p_date,'general','مصروف مشروع: '||BTRIM(p_description)||' - '||v_project.name,p_created_by,v_lines);
  v_journal_id:=(v_journal->>'id')::UUID;
  UPDATE journal_entries SET reference_type='project_expense',reference_id=v_expense.id WHERE id=v_journal_id AND company_id=p_company_id;
  UPDATE project_expenses SET journal_entry_id=v_journal_id WHERE id=v_expense.id RETURNING * INTO v_expense;
  RETURN to_jsonb(v_expense);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_project_expense(
  p_company_id UUID, p_expense_id UUID, p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_expense project_expenses%ROWTYPE; v_reversal UUID;
BEGIN
  SELECT * INTO v_expense FROM project_expenses WHERE id=p_expense_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المصروف غير موجود'; END IF;
  IF v_expense.status='rejected' THEN RAISE EXCEPTION 'المصروف ملغى بالفعل'; END IF;
  IF v_expense.journal_entry_id IS NULL THEN RAISE EXCEPTION 'قيد المصروف غير موجود'; END IF;
  v_reversal:=post_journal_reversal(p_company_id,v_expense.journal_entry_id,'project_expense_cancellation',p_expense_id,
    'إلغاء مصروف مشروع: '||COALESCE(v_expense.description,p_expense_id::TEXT),p_user_id);
  UPDATE project_expenses SET status='rejected',updated_at=NOW() WHERE id=p_expense_id RETURNING * INTO v_expense;
  RETURN to_jsonb(v_expense)||jsonb_build_object('reversal_journal_id',v_reversal,'cancelled',TRUE);
END;
$$;
REVOKE ALL ON FUNCTION public.post_project_expense(UUID,UUID,TEXT,TEXT,NUMERIC,DATE,UUID,UUID,UUID,TEXT,NUMERIC,UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_project_expense(UUID,UUID,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_project_expense(UUID,UUID,TEXT,TEXT,NUMERIC,DATE,UUID,UUID,UUID,TEXT,NUMERIC,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_project_expense(UUID,UUID,UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.post_cash_transaction(
  p_company_id UUID, p_date DATE, p_type TEXT, p_amount NUMERIC,
  p_account_id UUID, p_category_id UUID, p_bank_safe_id UUID,
  p_contact_id UUID, p_project_id UUID, p_reason TEXT, p_description TEXT,
  p_tax_rate NUMERIC, p_created_by UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_bank banks_safes%ROWTYPE; v_counterpart UUID; v_vat_account UUID;
  v_tax NUMERIC:=0; v_total NUMERIC; v_net NUMERIC; v_balance NUMERIC;
  v_lines JSONB; v_tx cash_transactions%ROWTYPE; v_journal JSONB; v_journal_id UUID;
BEGIN
  IF p_type NOT IN ('revenue','expense') OR p_amount IS NULL OR p_amount<=0 OR p_amount<>ROUND(p_amount,2)
    OR NULLIF(BTRIM(p_reason),'') IS NULL OR LENGTH(p_reason)>1000
    OR p_tax_rate IS NULL OR p_tax_rate<0 OR p_tax_rate>1 OR p_tax_rate<>ROUND(p_tax_rate,4) THEN
    RAISE EXCEPTION 'بيانات الحركة النقدية غير صالحة';
  END IF;
  SELECT * INTO v_bank FROM banks_safes
    WHERE id=p_bank_safe_id AND company_id=p_company_id AND COALESCE(is_active,TRUE)=TRUE FOR UPDATE;
  IF NOT FOUND OR v_bank.account_id IS NULL THEN RAISE EXCEPTION 'الخزينة غير موجودة أو بلا حساب'; END IF;
  PERFORM 1 FROM accounts WHERE id=v_bank.account_id AND company_id=p_company_id FOR UPDATE;
  IF p_contact_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM contacts WHERE id=p_contact_id AND company_id=p_company_id) THEN RAISE EXCEPTION 'الطرف غير موجود'; END IF;
  IF p_project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM projects WHERE id=p_project_id AND company_id=p_company_id) THEN RAISE EXCEPTION 'المشروع غير موجود'; END IF;
  IF p_category_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM transaction_categories WHERE id=p_category_id AND company_id=p_company_id AND type=p_type AND COALESCE(is_active,TRUE)=TRUE
  ) THEN RAISE EXCEPTION 'تصنيف الحركة غير صالح'; END IF;
  IF p_account_id IS NOT NULL THEN
    SELECT id INTO v_counterpart FROM accounts WHERE id=p_account_id AND company_id=p_company_id
      AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
  ELSE
    SELECT id INTO v_counterpart FROM accounts WHERE company_id=p_company_id
      AND code=CASE WHEN p_type='revenue' THEN '4100' ELSE '5100' END
      AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
  END IF;
  IF v_counterpart IS NULL OR v_counterpart=v_bank.account_id THEN RAISE EXCEPTION 'الحساب المقابل غير صالح'; END IF;

  IF p_type='revenue' THEN
    v_tax:=ROUND(p_amount*p_tax_rate/(1+p_tax_rate),2);
    v_total:=p_amount; v_net:=p_amount-v_tax;
    v_lines:=jsonb_build_array(
      jsonb_build_object('accountId',v_bank.account_id,'debit',p_amount,'credit',0,'description',COALESCE(NULLIF(BTRIM(p_description),''),p_reason),'projectId',p_project_id,'contactId',p_contact_id),
      jsonb_build_object('accountId',v_counterpart,'debit',0,'credit',v_net,'description',COALESCE(NULLIF(BTRIM(p_description),''),p_reason),'projectId',p_project_id,'contactId',p_contact_id));
    IF v_tax>0 THEN
      SELECT id INTO v_vat_account FROM accounts WHERE company_id=p_company_id AND code='2120' AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
      IF v_vat_account IS NULL THEN RAISE EXCEPTION 'حساب ضريبة المبيعات غير موجود'; END IF;
      v_lines:=v_lines||jsonb_build_array(jsonb_build_object('accountId',v_vat_account,'debit',0,'credit',v_tax,'description','ضريبة مخرجات','projectId',p_project_id,'contactId',p_contact_id));
    END IF;
  ELSE
    v_tax:=ROUND(p_amount*p_tax_rate,2); v_total:=p_amount+v_tax; v_net:=p_amount;
    v_balance:=get_account_balance(p_company_id,v_bank.account_id,NULL,NULL);
    IF v_balance+0.005<v_total THEN RAISE EXCEPTION 'الرصيد غير كاف للصرف'; END IF;
    v_lines:=jsonb_build_array(
      jsonb_build_object('accountId',v_counterpart,'debit',p_amount,'credit',0,'description',COALESCE(NULLIF(BTRIM(p_description),''),p_reason),'projectId',p_project_id,'contactId',p_contact_id),
      jsonb_build_object('accountId',v_bank.account_id,'debit',0,'credit',v_total,'description',COALESCE(NULLIF(BTRIM(p_description),''),p_reason),'projectId',p_project_id,'contactId',p_contact_id));
    IF v_tax>0 THEN
      SELECT id INTO v_vat_account FROM accounts WHERE company_id=p_company_id AND code='1180' AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
      IF v_vat_account IS NULL THEN RAISE EXCEPTION 'حساب ضريبة المشتريات غير موجود'; END IF;
      v_lines:=v_lines||jsonb_build_array(jsonb_build_object('accountId',v_vat_account,'debit',v_tax,'credit',0,'description','ضريبة مدخلات','projectId',p_project_id,'contactId',p_contact_id));
    END IF;
  END IF;

  INSERT INTO cash_transactions(company_id,date,type,amount,account_id,bank_safe_id,contact_id,project_id,category_id,
    reason,created_by,tax_rate,tax_amount,status)
  VALUES(p_company_id,p_date,p_type,p_amount,v_counterpart,p_bank_safe_id,p_contact_id,p_project_id,p_category_id,
    BTRIM(p_reason),p_created_by,p_tax_rate,v_tax,'active') RETURNING * INTO v_tx;
  v_journal:=create_journal_entry(p_company_id,p_date,'general',COALESCE(NULLIF(BTRIM(p_description),''),BTRIM(p_reason)),p_created_by,v_lines);
  v_journal_id:=(v_journal->>'id')::UUID;
  UPDATE journal_entries SET reference_type='cash_transaction',reference_id=v_tx.id WHERE id=v_journal_id AND company_id=p_company_id;
  UPDATE cash_transactions SET journal_entry_id=v_journal_id WHERE id=v_tx.id RETURNING * INTO v_tx;
  RETURN to_jsonb(v_tx)||jsonb_build_object('cash_total',v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_cash_transaction_note(
  p_company_id UUID, p_transaction_id UUID, p_reason TEXT, p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old cash_transactions%ROWTYPE; v_new cash_transactions%ROWTYPE;
BEGIN
  IF NULLIF(BTRIM(p_reason),'') IS NULL OR LENGTH(p_reason)>1000 THEN RAISE EXCEPTION 'السبب غير صالح'; END IF;
  SELECT * INTO v_old FROM cash_transactions WHERE id=p_transaction_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الحركة غير موجودة'; END IF;
  IF v_old.status='cancelled' THEN RAISE EXCEPTION 'لا يمكن تعديل حركة ملغاة'; END IF;
  UPDATE cash_transactions SET reason=BTRIM(p_reason) WHERE id=p_transaction_id RETURNING * INTO v_new;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'update','cash_transaction',p_transaction_id,to_jsonb(v_old),to_jsonb(v_new));
  RETURN to_jsonb(v_new);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_cash_transaction(
  p_company_id UUID, p_transaction_id UUID, p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_tx cash_transactions%ROWTYPE; v_reversal UUID;
BEGIN
  SELECT * INTO v_tx FROM cash_transactions WHERE id=p_transaction_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الحركة غير موجودة'; END IF;
  IF v_tx.status='cancelled' THEN RAISE EXCEPTION 'الحركة ملغاة مسبقاً'; END IF;
  IF v_tx.journal_entry_id IS NULL THEN RAISE EXCEPTION 'قيد الحركة غير موجود'; END IF;
  v_reversal:=post_journal_reversal(p_company_id,v_tx.journal_entry_id,'cash_transaction_reversal',p_transaction_id,
    'عكس حركة نقدية: '||COALESCE(v_tx.reason,p_transaction_id::TEXT),p_user_id);
  UPDATE cash_transactions SET status='cancelled' WHERE id=p_transaction_id RETURNING * INTO v_tx;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'delete','cash_transaction',p_transaction_id,
    to_jsonb(v_tx)||jsonb_build_object('status','active'),to_jsonb(v_tx));
  RETURN to_jsonb(v_tx)||jsonb_build_object('reversal_journal_id',v_reversal,'cancelled',TRUE);
END;
$$;
REVOKE ALL ON FUNCTION public.post_cash_transaction(UUID,DATE,TEXT,NUMERIC,UUID,UUID,UUID,UUID,UUID,TEXT,TEXT,NUMERIC,UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_cash_transaction_note(UUID,UUID,TEXT,UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_cash_transaction(UUID,UUID,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_cash_transaction(UUID,DATE,TEXT,NUMERIC,UUID,UUID,UUID,UUID,UUID,TEXT,TEXT,NUMERIC,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_cash_transaction_note(UUID,UUID,TEXT,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_cash_transaction(UUID,UUID,UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.create_salary_sheet(
  p_company_id UUID, p_name TEXT, p_month INTEGER, p_year INTEGER,
  p_date DATE, p_items JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_sheet salary_sheets%ROWTYPE; v_item JSONB; v_employee UUID;
  v_basic NUMERIC; v_allowances NUMERIC; v_deductions NUMERIC;
BEGIN
  IF NULLIF(BTRIM(p_name),'') IS NULL OR LENGTH(p_name)>200 OR p_month NOT BETWEEN 1 AND 12 OR p_year NOT BETWEEN 2000 AND 9999 THEN
    RAISE EXCEPTION 'بيانات كشف الرواتب غير صالحة';
  END IF;
  IF jsonb_typeof(COALESCE(p_items,'[]'::JSONB))<>'array' OR jsonb_array_length(COALESCE(p_items,'[]'::JSONB))>1000 THEN
    RAISE EXCEPTION 'بنود كشف الرواتب غير صالحة';
  END IF;
  INSERT INTO salary_sheets(company_id,name,month,year,date,status)
  VALUES(p_company_id,BTRIM(p_name),p_month,p_year,p_date,'draft') RETURNING * INTO v_sheet;
  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_items,'[]'::JSONB))
  LOOP
    BEGIN
      v_employee:=(v_item->>'employee_id')::UUID;
      v_basic:=COALESCE((v_item->>'basic_salary')::NUMERIC,0);
      v_allowances:=COALESCE((v_item->>'allowances')::NUMERIC,0);
      v_deductions:=COALESCE((v_item->>'deductions')::NUMERIC,0);
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'أحد بنود كشف الرواتب غير صالح';
    END;
    IF NOT EXISTS(SELECT 1 FROM employees WHERE id=v_employee AND company_id=p_company_id AND COALESCE(is_active,TRUE)=TRUE) THEN
      RAISE EXCEPTION 'أحد الموظفين غير موجود أو غير نشط';
    END IF;
    IF v_basic<0 OR v_allowances<0 OR v_deductions<0 OR v_basic<>ROUND(v_basic,2)
      OR v_allowances<>ROUND(v_allowances,2) OR v_deductions<>ROUND(v_deductions,2)
      OR v_basic+v_allowances-v_deductions<0 THEN RAISE EXCEPTION 'أحد بنود كشف الرواتب غير صالح'; END IF;
    INSERT INTO salary_items(company_id,sheet_id,employee_id,basic_salary,allowances,deductions,net_pay)
    VALUES(p_company_id,v_sheet.id,v_employee,v_basic,v_allowances,v_deductions,v_basic+v_allowances-v_deductions);
  END LOOP;
  RETURN to_jsonb(v_sheet);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_draft_salary_sheet(
  p_company_id UUID, p_sheet_id UUID
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM salary_sheets WHERE id=p_sheet_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'كشف الرواتب غير موجود'; END IF;
  IF v_status<>'draft' THEN RAISE EXCEPTION 'لا يمكن حذف كشف دخل دورة الموافقة'; END IF;
  DELETE FROM salary_items WHERE sheet_id=p_sheet_id AND company_id=p_company_id;
  DELETE FROM salary_sheets WHERE id=p_sheet_id AND company_id=p_company_id;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.create_salary_sheet(UUID,TEXT,INTEGER,INTEGER,DATE,JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_draft_salary_sheet(UUID,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_salary_sheet(UUID,TEXT,INTEGER,INTEGER,DATE,JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_draft_salary_sheet(UUID,UUID) TO service_role;

-- Employee advances and payroll are posted atomically with their journals and
-- FIFO advance balance changes.
CREATE OR REPLACE FUNCTION public.create_employee_advance(
  p_company_id UUID, p_employee_id UUID, p_date DATE, p_amount NUMERIC,
  p_reason TEXT, p_bank_safe_id UUID, p_created_by UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_bank_account UUID; v_advance_account UUID; v_advance employee_advances%ROWTYPE;
  v_journal JSONB; v_journal_id UUID;
BEGIN
  IF p_amount IS NULL OR p_amount<=0 OR p_amount<>ROUND(p_amount,2) THEN RAISE EXCEPTION 'مبلغ السلفة غير صالح'; END IF;
  IF NOT EXISTS(SELECT 1 FROM employees WHERE id=p_employee_id AND company_id=p_company_id AND COALESCE(is_active,TRUE)=TRUE) THEN RAISE EXCEPTION 'الموظف غير موجود أو غير نشط'; END IF;
  SELECT account_id INTO v_bank_account FROM banks_safes WHERE id=p_bank_safe_id AND company_id=p_company_id;
  SELECT id INTO v_advance_account FROM accounts
    WHERE company_id=p_company_id AND code='1160' AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
  IF v_bank_account IS NULL OR v_advance_account IS NULL THEN RAISE EXCEPTION 'حساب السلفة أو الخزينة غير موجود'; END IF;
  INSERT INTO employee_advances(company_id,employee_id,amount,remaining_amount,date,reason,type)
  VALUES(p_company_id,p_employee_id,p_amount,p_amount,p_date,NULLIF(BTRIM(p_reason),''),'advance') RETURNING * INTO v_advance;
  v_journal:=create_journal_entry(p_company_id,p_date,'general','سلفة موظف: '||COALESCE(NULLIF(BTRIM(p_reason),''),''),p_created_by,
    jsonb_build_array(
      jsonb_build_object('accountId',v_advance_account,'debit',p_amount,'credit',0,'description','سلفة موظف'),
      jsonb_build_object('accountId',v_bank_account,'debit',0,'credit',p_amount,'description','صرف سلفة موظف')));
  v_journal_id:=(v_journal->>'id')::UUID;
  UPDATE journal_entries SET reference_type='employee_advance',reference_id=v_advance.id WHERE id=v_journal_id AND company_id=p_company_id;
  UPDATE employee_advances SET journal_entry_id=v_journal_id WHERE id=v_advance.id RETURNING * INTO v_advance;
  RETURN to_jsonb(v_advance);
END;
$$;

CREATE OR REPLACE FUNCTION public.post_payroll_batch(
  p_company_id UUID, p_date DATE, p_employee_ids UUID[], p_created_by UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_employee_count INTEGER; v_emp RECORD; v_adv RECORD; v_row JSONB;
  v_rows JSONB:='[]'::JSONB; v_total_salary NUMERIC:=0; v_total_advance NUMERIC:=0;
  v_advance_balance NUMERIC; v_deduction NUMERIC; v_left NUMERIC; v_take NUMERIC;
  v_salary_account UUID; v_accrued_account UUID; v_advance_account UUID;
  v_lines JSONB; v_journal JSONB; v_journal_id UUID; v_result JSONB;
BEGIN
  IF p_date IS NULL OR p_employee_ids IS NULL OR array_length(p_employee_ids,1) IS NULL OR array_length(p_employee_ids,1)>500 THEN
    RAISE EXCEPTION 'قائمة موظفي الرواتب غير صالحة';
  END IF;
  SELECT COUNT(DISTINCT item_id) INTO v_employee_count FROM unnest(p_employee_ids) AS ids(item_id);
  IF v_employee_count<>array_length(p_employee_ids,1) THEN RAISE EXCEPTION 'لا يمكن تكرار الموظف في دفعة الرواتب'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_company_id::TEXT||':payroll:'||TO_CHAR(p_date,'YYYY-MM'),0));
  IF EXISTS(SELECT 1 FROM payroll WHERE company_id=p_company_id
    AND date_trunc('month',date::timestamp)=date_trunc('month',p_date::timestamp)
    AND employee_id=ANY(p_employee_ids)) THEN
    RAISE EXCEPTION 'تم إنشاء راتب لأحد الموظفين في هذا التاريخ مسبقاً';
  END IF;
  SELECT COUNT(*) INTO v_employee_count FROM employees
    WHERE company_id=p_company_id AND id=ANY(p_employee_ids) AND COALESCE(is_active,TRUE)=TRUE;
  IF v_employee_count<>array_length(p_employee_ids,1) THEN RAISE EXCEPTION 'أحد الموظفين غير موجود أو غير نشط'; END IF;
  PERFORM id FROM employees WHERE company_id=p_company_id AND id=ANY(p_employee_ids) ORDER BY id FOR UPDATE;

  SELECT id INTO v_salary_account FROM accounts WHERE company_id=p_company_id AND code='5210' AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
  SELECT id INTO v_accrued_account FROM accounts WHERE company_id=p_company_id AND code='2140' AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
  SELECT id INTO v_advance_account FROM accounts WHERE company_id=p_company_id AND code='1160' AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
  IF v_salary_account IS NULL OR v_accrued_account IS NULL THEN RAISE EXCEPTION 'حسابات الرواتب غير موجودة'; END IF;

  FOR v_emp IN SELECT id,ROUND(COALESCE(salary,0),2) AS salary FROM employees
    WHERE company_id=p_company_id AND id=ANY(p_employee_ids) ORDER BY id
  LOOP
    IF v_emp.salary<=0 THEN RAISE EXCEPTION 'راتب أحد الموظفين غير صالح'; END IF;
    PERFORM id FROM employee_advances
      WHERE company_id=p_company_id AND employee_id=v_emp.id AND remaining_amount>0 ORDER BY date,id FOR UPDATE;
    SELECT COALESCE(SUM(remaining_amount),0) INTO v_advance_balance FROM employee_advances
      WHERE company_id=p_company_id AND employee_id=v_emp.id AND remaining_amount>0;
    v_deduction:=ROUND(LEAST(v_advance_balance,v_emp.salary*0.5),2);
    v_rows:=v_rows||jsonb_build_array(jsonb_build_object(
      'employee_id',v_emp.id,'salary',v_emp.salary,'advance_deduction',v_deduction,'net_pay',v_emp.salary-v_deduction));
    v_total_salary:=v_total_salary+v_emp.salary;
    v_total_advance:=v_total_advance+v_deduction;
  END LOOP;
  IF v_total_advance>0 AND v_advance_account IS NULL THEN RAISE EXCEPTION 'حساب سلف الموظفين غير موجود'; END IF;
  v_lines:=jsonb_build_array(
    jsonb_build_object('accountId',v_salary_account,'debit',v_total_salary,'credit',0,'description','مصروف الرواتب'),
    jsonb_build_object('accountId',v_accrued_account,'debit',0,'credit',v_total_salary-v_total_advance,'description','رواتب مستحقة'));
  IF v_total_advance>0 THEN
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
      'accountId',v_advance_account,'debit',0,'credit',v_total_advance,'description','تسوية سلف الموظفين'));
  END IF;
  v_journal:=create_journal_entry(p_company_id,p_date,'general','رواتب شهر '||TO_CHAR(p_date,'YYYY-MM'),p_created_by,v_lines);
  v_journal_id:=(v_journal->>'id')::UUID;
  UPDATE journal_entries SET reference_type='payroll_batch',reference_id=v_journal_id WHERE id=v_journal_id AND company_id=p_company_id;

  FOR v_row IN SELECT value FROM jsonb_array_elements(v_rows)
  LOOP
    INSERT INTO payroll(company_id,employee_id,date,basic_salary,allowances,deductions,advance_deduction,net_pay,journal_entry_id)
    VALUES(p_company_id,(v_row->>'employee_id')::UUID,p_date,(v_row->>'salary')::NUMERIC,0,0,
      (v_row->>'advance_deduction')::NUMERIC,(v_row->>'net_pay')::NUMERIC,v_journal_id);
    v_left:=(v_row->>'advance_deduction')::NUMERIC;
    FOR v_adv IN SELECT id,remaining_amount FROM employee_advances
      WHERE company_id=p_company_id AND employee_id=(v_row->>'employee_id')::UUID AND remaining_amount>0
      ORDER BY date,id FOR UPDATE
    LOOP
      EXIT WHEN v_left<=0;
      v_take:=LEAST(v_adv.remaining_amount,v_left);
      UPDATE employee_advances SET remaining_amount=remaining_amount-v_take WHERE id=v_adv.id AND company_id=p_company_id;
      v_left:=v_left-v_take;
    END LOOP;
    IF v_left>0.005 THEN RAISE EXCEPTION 'تغير رصيد السلف أثناء ترحيل الرواتب'; END IF;
  END LOOP;
  SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.employee_id),'[]'::JSONB) INTO v_result
    FROM payroll p WHERE p.company_id=p_company_id AND p.journal_entry_id=v_journal_id;
  RETURN jsonb_build_object('journal_entry_id',v_journal_id,'records',v_result,
    'total_salary',v_total_salary,'total_advance_deduction',v_total_advance);
END;
$$;

REVOKE ALL ON FUNCTION public.create_employee_advance(UUID,UUID,DATE,NUMERIC,TEXT,UUID,UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.post_payroll_batch(UUID,DATE,UUID[],UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_employee_advance(UUID,UUID,DATE,NUMERIC,TEXT,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.post_payroll_batch(UUID,DATE,UUID[],UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.save_currency(
  p_company_id UUID, p_id UUID, p_code TEXT, p_name TEXT, p_rate NUMERIC, p_is_base BOOLEAN
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID; v_was_base BOOLEAN;
BEGIN
  IF p_rate<=0 OR p_code IS NULL OR p_name IS NULL THEN RAISE EXCEPTION 'invalid currency'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('currency:'||p_company_id::text));
  IF p_id IS NOT NULL THEN
    SELECT is_base INTO v_was_base FROM currencies WHERE id=p_id AND company_id=p_company_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'currency not found'; END IF;
    IF v_was_base AND NOT p_is_base AND NOT EXISTS(
      SELECT 1 FROM currencies WHERE company_id=p_company_id AND id<>p_id AND is_base=TRUE
    ) THEN RAISE EXCEPTION 'company requires a base currency'; END IF;
    IF p_is_base THEN UPDATE currencies SET is_base=FALSE WHERE company_id=p_company_id AND id<>p_id AND is_base=TRUE; END IF;
    UPDATE currencies SET code=p_code,name=p_name,rate=CASE WHEN p_is_base THEN 1 ELSE p_rate END,is_base=p_is_base
    WHERE id=p_id AND company_id=p_company_id RETURNING id INTO v_id;
  ELSE
    IF p_is_base THEN UPDATE currencies SET is_base=FALSE WHERE company_id=p_company_id AND is_base=TRUE; END IF;
    INSERT INTO currencies(company_id,code,name,rate,is_base)
    VALUES(p_company_id,p_code,p_name,CASE WHEN p_is_base THEN 1 ELSE p_rate END,p_is_base) RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.save_currency(UUID, UUID, TEXT, TEXT, NUMERIC, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_currency(UUID, UUID, TEXT, TEXT, NUMERIC, BOOLEAN) TO service_role;

CREATE OR REPLACE FUNCTION public.replace_user_permissions(
  p_company_id UUID, p_user_id UUID, p_permissions JSONB, p_bypass_telegram BOOLEAN
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF jsonb_typeof(p_permissions)<>'array' THEN RAISE EXCEPTION 'invalid permissions'; END IF;
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id) THEN
    RAISE EXCEPTION 'target user not found';
  END IF;
  DELETE FROM user_permissions WHERE company_id=p_company_id AND user_id=p_user_id;
  INSERT INTO user_permissions(company_id,user_id,module,permissions,bypass_telegram_confirmation)
  SELECT p_company_id,p_user_id,item->>'module',COALESCE(item->'actions','[]'::jsonb),p_bypass_telegram
  FROM jsonb_array_elements(p_permissions) item
  WHERE jsonb_array_length(COALESCE(item->'actions','[]'::jsonb))>0 OR p_bypass_telegram;
END;
$$;
REVOKE ALL ON FUNCTION public.replace_user_permissions(UUID, UUID, JSONB, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_user_permissions(UUID, UUID, JSONB, BOOLEAN) TO service_role;

-- Activation add-on codes intentionally have no plan.
ALTER TABLE activation_codes ALTER COLUMN plan_code DROP NOT NULL;
ALTER TABLE activation_codes ALTER COLUMN duration_months DROP NOT NULL;
ALTER TABLE activation_codes ADD COLUMN IF NOT EXISTS code_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_activation_codes_code_hash_unique
  ON activation_codes(code_hash) WHERE code_hash IS NOT NULL;

-- Backfill hashes for legacy plaintext codes. New codes only need code_hash;
-- plaintext is returned once by the creation endpoint and is not persisted.
UPDATE activation_codes
SET code_hash = encode(digest(upper(trim(code)), 'sha256'), 'hex')
WHERE code IS NOT NULL AND code_hash IS NULL;
ALTER TABLE activation_codes ALTER COLUMN code DROP NOT NULL;

-- Database-enforced race barriers for request creation and periodic jobs.
-- Older schemas pointed upgrade_requests.reviewed_by at users even though the
-- admin review route stores an admin_users id. Replace that incompatible FK.
DO $$
DECLARE v_constraint TEXT;
BEGIN
  SELECT c.conname INTO v_constraint
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
  WHERE t.relname = 'upgrade_requests' AND c.contype = 'f' AND a.attname = 'reviewed_by'
  LIMIT 1;
  IF v_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE upgrade_requests DROP CONSTRAINT %I', v_constraint);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'upgrade_requests_reviewed_by_admin_fk'
  ) THEN
    ALTER TABLE upgrade_requests
      ADD CONSTRAINT upgrade_requests_reviewed_by_admin_fk
      FOREIGN KEY (reviewed_by) REFERENCES admin_users(id) ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_upgrade_request_pending_company
  ON upgrade_requests(company_id) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS uq_addon_request_pending_type
  ON addon_requests(company_id, addon_type) WHERE status = 'pending';
ALTER TABLE approval_requests DROP CONSTRAINT IF EXISTS approval_requests_status_check;
ALTER TABLE approval_requests ADD CONSTRAINT approval_requests_status_check
  CHECK (status IN ('pending', 'processing', 'approved', 'rejected', 'cancelled'));
CREATE UNIQUE INDEX IF NOT EXISTS uq_approval_request_pending_entity
  ON approval_requests(company_id, entity_type, entity_id)
  WHERE status IN ('pending', 'processing');
ALTER TABLE progress_billing ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uq_salary_sheet_period
  ON salary_sheets(company_id, year, month);
WITH ranked_base_currency AS (
  SELECT id, row_number() OVER(PARTITION BY company_id ORDER BY id) AS rn
  FROM currencies WHERE is_base=TRUE
)
UPDATE currencies SET is_base=FALSE WHERE id IN (SELECT id FROM ranked_base_currency WHERE rn>1);
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_base_currency
  ON currencies(company_id) WHERE is_base=TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_reconciliation_per_day
  ON bank_reconciliation(company_id, bank_safe_id, date);
CREATE UNIQUE INDEX IF NOT EXISTS uq_journal_single_reversal
  ON journal_entries(company_id, reversal_of) WHERE reversal_of IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_tender_conversion
  ON projects(company_id, tender_id) WHERE tender_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_salary_item_employee
  ON salary_items(company_id, sheet_id, employee_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_depreciation_asset_period
  ON depreciation_log(company_id, asset_id, date);
CREATE UNIQUE INDEX IF NOT EXISTS uq_timesheet_employee_date
  ON timesheets(company_id, employee_id, date);

ALTER TABLE payroll ADD COLUMN IF NOT EXISTS payroll_period DATE
  GENERATED ALWAYS AS (date_trunc('month', date::timestamp without time zone)::date) STORED;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_employee_period
  ON payroll(company_id, employee_id, payroll_period);

-- Export payloads are financial files and must be held in a private bucket.
-- Keep the migration portable to non-Supabase PostgreSQL test databases where
-- the optional `storage` extension/schema is not installed.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit)
    VALUES ('company-exports', 'company-exports', false, 52428800)
    ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 52428800;
    UPDATE storage.buckets SET public = false, file_size_limit = 5242880
    WHERE id = 'receipts';
    INSERT INTO storage.buckets (id, name, public, file_size_limit)
    VALUES ('contract-documents', 'contract-documents', false, 10485760)
    ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 10485760;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.redeem_activation_code(
  p_company_id UUID,
  p_user_id UUID,
  p_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code activation_codes%ROWTYPE;
  v_plan subscription_plans%ROWTYPE;
  v_sub subscriptions%ROWTYPE;
  v_hash TEXT;
  v_qty INT;
  v_months INT;
  v_end DATE;
BEGIN
  IF p_company_id IS NULL OR p_user_id IS NULL OR trim(COALESCE(p_code, '')) = '' THEN
    RAISE EXCEPTION 'invalid activation request';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = p_user_id AND company_id = p_company_id AND is_active = true
  ) THEN
    RAISE EXCEPTION 'user does not belong to company';
  END IF;

  v_hash := encode(digest(upper(trim(p_code)), 'sha256'), 'hex');
  SELECT * INTO v_code
  FROM activation_codes
  WHERE (code_hash = v_hash OR (code_hash IS NULL AND upper(code) = upper(trim(p_code))))
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND OR COALESCE(v_code.is_used, false) THEN
    RAISE EXCEPTION 'activation code is invalid or already used';
  END IF;
  IF v_code.expires_at IS NOT NULL AND v_code.expires_at < CURRENT_DATE THEN
    RAISE EXCEPTION 'activation code has expired';
  END IF;
  IF COALESCE(v_code.target_company_id, v_code.company_id) IS NOT NULL
     AND COALESCE(v_code.target_company_id, v_code.company_id) <> p_company_id THEN
    RAISE EXCEPTION 'activation code belongs to another company';
  END IF;

  SELECT * INTO v_sub
  FROM subscriptions
  WHERE company_id = p_company_id
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_code.addon_type IS NOT NULL THEN
    IF NOT FOUND THEN RAISE EXCEPTION 'company has no subscription'; END IF;
    IF v_code.addon_type NOT IN ('extra_user', 'extra_branch', 'storage_gb') THEN
      RAISE EXCEPTION 'unsupported add-on type';
    END IF;
    v_qty := COALESCE(v_code.addon_quantity, 0);
    IF v_qty < 1 OR v_qty > 10000 THEN RAISE EXCEPTION 'invalid add-on quantity'; END IF;

    UPDATE subscriptions
    SET extra_users = COALESCE(extra_users, 0) + CASE WHEN v_code.addon_type = 'extra_user' THEN v_qty ELSE 0 END,
        extra_branches = COALESCE(extra_branches, 0) + CASE WHEN v_code.addon_type = 'extra_branch' THEN v_qty ELSE 0 END,
        extra_storage_gb = COALESCE(extra_storage_gb, 0) + CASE WHEN v_code.addon_type = 'storage_gb' THEN v_qty ELSE 0 END,
        addons_json = COALESCE(addons_json, '{}'::jsonb) || jsonb_build_object(
          CASE v_code.addon_type
            WHEN 'extra_user' THEN 'extra_users_total_paid'
            WHEN 'extra_branch' THEN 'extra_branches_total_paid'
            ELSE 'extra_storage_gb_paid'
          END,
          CASE v_code.addon_type
            WHEN 'extra_user' THEN COALESCE(extra_users, 0) + v_qty
            WHEN 'extra_branch' THEN COALESCE(extra_branches, 0) + v_qty
            ELSE COALESCE(extra_storage_gb, 0) + v_qty
          END,
          'last_addon_purchase_at', now()
        ),
        updated_at = now()
    WHERE id = v_sub.id;

    UPDATE activation_codes
    SET is_used = true, used_by = p_company_id, used_at = now(), code = NULL
    WHERE id = v_code.id;

    RETURN jsonb_build_object(
      'type', 'addon', 'addon_type', v_code.addon_type, 'quantity', v_qty
    );
  END IF;

  SELECT * INTO v_plan
  FROM subscription_plans
  WHERE code = v_code.plan_code AND is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'activation plan is unavailable'; END IF;

  v_months := COALESCE(v_code.duration_months, v_code.plan_duration_months, 0);
  IF v_months < 1 OR v_months > 120 THEN RAISE EXCEPTION 'invalid activation duration'; END IF;
  v_end := GREATEST(COALESCE(v_sub.end_date, CURRENT_DATE), CURRENT_DATE)
           + make_interval(months => v_months);

  IF v_sub.id IS NULL THEN
    INSERT INTO subscriptions (
      company_id, plan_id, plan_code, status, start_date, end_date, updated_at
    ) VALUES (
      p_company_id, v_plan.id, v_plan.code, 'active', CURRENT_DATE, v_end, now()
    );
  ELSE
    UPDATE subscriptions
    SET plan_id = v_plan.id,
        plan_code = v_plan.code,
        status = 'active',
        end_date = v_end,
        updated_at = now()
    WHERE id = v_sub.id;
  END IF;

  UPDATE activation_codes
  SET is_used = true, used_by = p_company_id, used_at = now(), code = NULL
  WHERE id = v_code.id;

  RETURN jsonb_build_object(
    'type', 'plan', 'plan_code', v_plan.code, 'plan_name', v_plan.name,
    'duration_months', v_months, 'end_date', v_end
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.review_addon_request(
  p_request_id UUID,
  p_admin_id UUID,
  p_decision TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req addon_requests%ROWTYPE;
  v_sub subscriptions%ROWTYPE;
  v_prev_users INT;
  v_prev_branches INT;
  v_new_users INT;
  v_new_branches INT;
  v_months INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE id = p_admin_id AND is_active = true) THEN
    RAISE EXCEPTION 'inactive admin';
  END IF;
  IF p_decision NOT IN ('approved', 'rejected') THEN RAISE EXCEPTION 'invalid decision'; END IF;

  SELECT * INTO v_req FROM addon_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request not found'; END IF;
  IF v_req.status <> 'pending' THEN RAISE EXCEPTION 'request was already reviewed'; END IF;

  IF p_decision = 'rejected' THEN
    UPDATE addon_requests SET status = 'rejected', admin_notes = left(p_notes, 2000),
      reviewed_by = p_admin_id, reviewed_at = now(), updated_at = now()
    WHERE id = p_request_id;
    INSERT INTO admin_audit_log(admin_id, action, details, target_type, target_id)
    VALUES (p_admin_id, 'reject_addon_request', left(p_notes, 2000), 'addon_request', p_request_id::text);
    RETURN jsonb_build_object('status', 'rejected', 'company_id', v_req.company_id);
  END IF;

  IF v_req.receipt_image_url IS NULL OR trim(v_req.receipt_image_url) = ''
     OR v_req.payment_date IS NULL
     OR COALESCE(v_req.payment_amount, 0) < v_req.total_amount_usd THEN
    RAISE EXCEPTION 'verified payment proof and full amount are required';
  END IF;

  SELECT * INTO v_sub FROM subscriptions
  WHERE company_id = v_req.company_id
  ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'company has no subscription'; END IF;

  v_prev_users := COALESCE(v_sub.extra_users, 0);
  v_prev_branches := COALESCE(v_sub.extra_branches, 0);
  v_new_users := v_prev_users + CASE WHEN v_req.addon_type = 'extra_user' THEN v_req.quantity ELSE 0 END;
  v_new_branches := v_prev_branches + CASE WHEN v_req.addon_type = 'extra_branch' THEN v_req.quantity ELSE 0 END;
  v_months := CASE WHEN v_req.duration_type = 'yearly' THEN 12 ELSE 1 END;

  UPDATE subscriptions
  SET extra_users = v_new_users,
      extra_branches = v_new_branches,
      extra_storage_gb = COALESCE(extra_storage_gb, 0)
        + CASE WHEN v_req.addon_type = 'storage_gb' THEN v_req.quantity ELSE 0 END,
      updated_at = now()
  WHERE id = v_sub.id;

  UPDATE addon_requests
  SET status = 'approved', admin_notes = left(p_notes, 2000),
      reviewed_by = p_admin_id, reviewed_at = now(), updated_at = now()
  WHERE id = p_request_id;

  INSERT INTO addon_grant_audit(
    company_id, request_id, admin_id, addon_type, quantity, months_granted,
    previous_extra_users, previous_extra_branches, new_extra_users, new_extra_branches, note
  ) VALUES (
    v_req.company_id, v_req.id, p_admin_id, v_req.addon_type, v_req.quantity, v_months,
    v_prev_users, v_prev_branches, v_new_users, v_new_branches, left(p_notes, 2000)
  );
  INSERT INTO admin_audit_log(admin_id, action, details, target_type, target_id)
  VALUES (p_admin_id, 'approve_addon_request',
    format('company=%s type=%s quantity=%s', v_req.company_id, v_req.addon_type, v_req.quantity),
    'addon_request', p_request_id::text);

  RETURN jsonb_build_object(
    'status', 'approved', 'company_id', v_req.company_id,
    'addon_type', v_req.addon_type, 'quantity', v_req.quantity,
    'extra_users', v_new_users, 'extra_branches', v_new_branches
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.review_upgrade_request(
  p_request_id UUID,
  p_admin_id UUID,
  p_decision TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req upgrade_requests%ROWTYPE;
  v_plan subscription_plans%ROWTYPE;
  v_sub subscriptions%ROWTYPE;
  v_expected NUMERIC;
  v_months INT;
  v_end DATE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE id = p_admin_id AND is_active = true) THEN
    RAISE EXCEPTION 'inactive admin';
  END IF;
  IF p_decision NOT IN ('approved', 'rejected') THEN RAISE EXCEPTION 'invalid decision'; END IF;

  SELECT * INTO v_req FROM upgrade_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request not found'; END IF;
  IF v_req.status <> 'pending' THEN RAISE EXCEPTION 'request was already reviewed'; END IF;

  IF p_decision = 'rejected' THEN
    UPDATE upgrade_requests SET status = 'rejected', admin_notes = left(p_notes, 2000),
      reviewed_by = p_admin_id, reviewed_at = now(), updated_at = now()
    WHERE id = p_request_id;
    INSERT INTO admin_audit_log(admin_id, action, details, target_type, target_id)
    VALUES (p_admin_id, 'reject_upgrade_request', left(p_notes, 2000), 'upgrade_request', p_request_id::text);
    RETURN jsonb_build_object('status', 'rejected', 'company_id', v_req.company_id);
  END IF;

  SELECT * INTO v_plan FROM subscription_plans
  WHERE id = v_req.requested_plan_id AND is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'requested plan is unavailable'; END IF;
  v_months := CASE WHEN v_req.duration_type = 'yearly' THEN 12 ELSE 1 END;
  v_expected := CASE WHEN v_req.duration_type = 'yearly'
    THEN COALESCE(v_plan.price_yearly, 0) ELSE COALESCE(v_plan.price_monthly, 0) END;

  IF v_req.receipt_image_url IS NULL OR trim(v_req.receipt_image_url) = ''
     OR v_req.payment_date IS NULL
     OR COALESCE(v_req.payment_amount, 0) < v_expected
     OR v_expected <= 0 THEN
    RAISE EXCEPTION 'verified payment proof and full plan amount are required';
  END IF;

  SELECT * INTO v_sub FROM subscriptions
  WHERE company_id = v_req.company_id
  ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  v_end := GREATEST(COALESCE(v_sub.end_date, CURRENT_DATE), CURRENT_DATE)
           + make_interval(months => v_months);

  IF v_sub.id IS NULL THEN
    INSERT INTO subscriptions(company_id, plan_id, plan_code, status, start_date, end_date, updated_at)
    VALUES(v_req.company_id, v_plan.id, v_plan.code, 'active', CURRENT_DATE, v_end, now());
  ELSE
    UPDATE subscriptions
    SET plan_id = v_plan.id, plan_code = v_plan.code, status = 'active',
        end_date = v_end, updated_at = now()
    WHERE id = v_sub.id;
  END IF;

  UPDATE upgrade_requests
  SET status = 'approved', admin_notes = left(p_notes, 2000),
      reviewed_by = p_admin_id, reviewed_at = now(), updated_at = now()
  WHERE id = p_request_id;
  INSERT INTO admin_audit_log(admin_id, action, details, target_type, target_id)
  VALUES (p_admin_id, 'approve_upgrade_request',
    format('company=%s plan=%s months=%s amount=%s', v_req.company_id, v_plan.code, v_months, v_req.payment_amount),
    'upgrade_request', p_request_id::text);

  RETURN jsonb_build_object(
    'status', 'approved', 'company_id', v_req.company_id,
    'plan_code', v_plan.code, 'plan_name', v_plan.name,
    'months', v_months, 'end_date', v_end
  );
END;
$$;

-- Exactly-once advertisement tracking and counter increment.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ad_view_company
  ON ad_views(advertisement_id, company_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ad_click_company
  ON ad_clicks(advertisement_id, company_id);

CREATE OR REPLACE FUNCTION public.record_ad_event(
  p_ad_id UUID,
  p_company_id UUID,
  p_user_id UUID,
  p_event TEXT,
  p_ip TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM advertisements WHERE id = p_ad_id AND is_active = true) THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM users WHERE id = p_user_id AND company_id = p_company_id AND is_active = true
  ) THEN
    RETURN false;
  END IF;

  IF p_event = 'view' THEN
    INSERT INTO ad_views(advertisement_id, company_id, user_id, ip_address, user_agent, viewed_at)
    VALUES(p_ad_id, p_company_id, p_user_id, left(p_ip, 64), left(p_user_agent, 512), now())
    ON CONFLICT (advertisement_id, company_id) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted = 1 THEN UPDATE advertisements SET views = COALESCE(views, 0) + 1 WHERE id = p_ad_id; END IF;
  ELSIF p_event = 'click' THEN
    INSERT INTO ad_clicks(advertisement_id, company_id, user_id, ip_address, user_agent, clicked_at)
    VALUES(p_ad_id, p_company_id, p_user_id, left(p_ip, 64), left(p_user_agent, 512), now())
    ON CONFLICT (advertisement_id, company_id) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted = 1 THEN UPDATE advertisements SET clicks = COALESCE(clicks, 0) + 1 WHERE id = p_ad_id; END IF;
  ELSE
    RETURN false;
  END IF;
  RETURN v_inserted = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_activation_code(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.review_addon_request(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.review_upgrade_request(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_ad_event(UUID, UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_activation_code(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.review_addon_request(UUID, UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.review_upgrade_request(UUID, UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_ad_event(UUID, UUID, UUID, TEXT, TEXT, TEXT) TO service_role;
