-- 061 - Posted-ledger reporting, historical account visibility, and atomic budgets.
-- A journal awaiting approval is not reportable. A source that has already been
-- reversed remains reportable together with its posted reversal so the pair nets
-- to zero even when the approval lifecycle marks the source as rejected.

CREATE OR REPLACE FUNCTION public.get_financial_summary(
  p_company_id UUID, p_from DATE DEFAULT NULL, p_to DATE DEFAULT NULL
) RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path=public STABLE AS $$
  SELECT jsonb_build_object(
    'revenue',COALESCE(sum(CASE WHEN a.type='revenue' THEN jl.credit-jl.debit ELSE 0 END),0),
    'expenses',COALESCE(sum(CASE WHEN a.type='expense' THEN jl.debit-jl.credit ELSE 0 END),0),
    'accountsReceivable',COALESCE(sum(CASE WHEN a.code='1130' OR a.code LIKE '1130-%' THEN jl.debit-jl.credit ELSE 0 END),0),
    'accountsPayable',COALESCE(sum(CASE WHEN a.code='2110' OR a.code LIKE '2110-%' THEN jl.credit-jl.debit ELSE 0 END),0),
    'cashBalance',COALESCE(sum(CASE WHEN EXISTS(
      SELECT 1 FROM banks_safes bs WHERE bs.company_id=p_company_id AND bs.account_id=a.id
    ) THEN jl.debit-jl.credit ELSE 0 END),0)
  )
  FROM journal_lines jl
  JOIN journal_entries je ON je.id=jl.journal_entry_id AND je.company_id=p_company_id
    AND je.deleted_at IS NULL AND (je.status='posted' OR je.reversed_by IS NOT NULL)
  JOIN accounts a ON a.id=jl.account_id AND a.company_id=p_company_id
  WHERE jl.company_id=p_company_id
    AND (p_from IS NULL OR je.date>=p_from) AND (p_to IS NULL OR je.date<=p_to);
$$;

CREATE OR REPLACE FUNCTION public.get_account_balance(
  p_company_id UUID,p_account_id UUID,p_journal_type TEXT DEFAULT NULL,p_as_of DATE DEFAULT NULL
) RETURNS NUMERIC LANGUAGE sql SECURITY DEFINER SET search_path=public STABLE AS $$
  SELECT COALESCE(sum(jl.debit-jl.credit),0)
  FROM journal_lines jl
  JOIN journal_entries je ON je.id=jl.journal_entry_id AND je.company_id=p_company_id
    AND je.deleted_at IS NULL AND (je.status='posted' OR je.reversed_by IS NOT NULL)
  JOIN accounts a ON a.id=jl.account_id AND a.company_id=p_company_id
  WHERE jl.company_id=p_company_id AND jl.account_id=p_account_id
    AND (p_journal_type IS NULL OR je.type=p_journal_type) AND (p_as_of IS NULL OR je.date<=p_as_of);
$$;

CREATE OR REPLACE FUNCTION public.get_account_opening_balance(
  p_company_id UUID,p_account_id UUID,p_before DATE,
  p_cost_center_id UUID DEFAULT NULL,p_branch_id UUID DEFAULT NULL
) RETURNS NUMERIC LANGUAGE sql SECURITY DEFINER SET search_path=public STABLE AS $$
  SELECT COALESCE(sum(CASE WHEN a.type IN('asset','expense') THEN jl.debit-jl.credit ELSE jl.credit-jl.debit END),0)
  FROM journal_lines jl
  JOIN journal_entries je ON je.id=jl.journal_entry_id AND je.company_id=p_company_id
    AND je.deleted_at IS NULL AND (je.status='posted' OR je.reversed_by IS NOT NULL)
  JOIN accounts a ON a.id=jl.account_id AND a.company_id=p_company_id
  WHERE jl.company_id=p_company_id AND jl.account_id=p_account_id AND je.date<p_before
    AND (p_cost_center_id IS NULL OR jl.cost_center_id=p_cost_center_id)
    AND (p_branch_id IS NULL OR jl.branch_id=p_branch_id);
$$;

CREATE OR REPLACE FUNCTION public.get_general_ledger(
  p_company_id UUID,p_account_id UUID DEFAULT NULL,p_from DATE DEFAULT NULL,p_to DATE DEFAULT NULL,
  p_cost_center_id UUID DEFAULT NULL,p_branch_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 100,p_offset INTEGER DEFAULT 0
) RETURNS TABLE(
  line_id UUID,entry_date DATE,entry_number INTEGER,entry_description TEXT,
  reference_type TEXT,reference_id UUID,account_id UUID,account_code TEXT,
  account_name TEXT,debit NUMERIC,credit NUMERIC,line_description TEXT,
  cost_center_id UUID,branch_id UUID,opening_balance NUMERIC,
  running_balance NUMERIC,total_debit NUMERIC,total_credit NUMERIC,total_count BIGINT
) LANGUAGE sql SECURITY DEFINER SET search_path=public STABLE AS $$
  WITH opening AS (
    SELECT COALESCE(sum(CASE WHEN a.type IN('asset','expense') THEN jl.debit-jl.credit ELSE jl.credit-jl.debit END),0) balance
    FROM journal_lines jl
    JOIN journal_entries je ON je.id=jl.journal_entry_id AND je.company_id=p_company_id
      AND je.deleted_at IS NULL AND (je.status='posted' OR je.reversed_by IS NOT NULL)
    JOIN accounts a ON a.id=jl.account_id AND a.company_id=p_company_id
    WHERE jl.company_id=p_company_id AND p_account_id IS NOT NULL AND jl.account_id=p_account_id
      AND p_from IS NOT NULL AND je.date<p_from
      AND (p_cost_center_id IS NULL OR jl.cost_center_id=p_cost_center_id)
      AND (p_branch_id IS NULL OR jl.branch_id=p_branch_id)
  ), base AS (
    SELECT jl.id line_id,je.date entry_date,je.number entry_number,je.description entry_description,
      je.reference_type,je.reference_id,jl.account_id,jl.account_code,COALESCE(a.name,jl.account_name) account_name,
      jl.debit,jl.credit,jl.description line_description,jl.cost_center_id,jl.branch_id,
      CASE WHEN p_account_id IS NULL OR a.type IN('asset','expense') THEN jl.debit-jl.credit ELSE jl.credit-jl.debit END movement
    FROM journal_lines jl
    JOIN journal_entries je ON je.id=jl.journal_entry_id AND je.company_id=p_company_id
      AND je.deleted_at IS NULL AND (je.status='posted' OR je.reversed_by IS NOT NULL)
    JOIN accounts a ON a.id=jl.account_id AND a.company_id=p_company_id
    WHERE jl.company_id=p_company_id AND (p_account_id IS NULL OR jl.account_id=p_account_id)
      AND (p_from IS NULL OR je.date>=p_from) AND (p_to IS NULL OR je.date<=p_to)
      AND (p_cost_center_id IS NULL OR jl.cost_center_id=p_cost_center_id)
      AND (p_branch_id IS NULL OR jl.branch_id=p_branch_id)
  ), calculated AS (
    SELECT b.*,(SELECT balance FROM opening)+sum(movement) OVER(ORDER BY entry_date,entry_number,line_id) running,
      sum(debit) OVER() all_debit,sum(credit) OVER() all_credit,count(*) OVER() all_count
    FROM base b
  )
  SELECT line_id,entry_date,entry_number,entry_description,reference_type,reference_id,
    account_id,account_code,account_name,debit,credit,line_description,cost_center_id,branch_id,
    (SELECT balance FROM opening),running,all_debit,all_credit,all_count
  FROM calculated ORDER BY entry_date,entry_number,line_id
  LIMIT LEAST(GREATEST(p_limit,1),500) OFFSET GREATEST(p_offset,0);
$$;

CREATE OR REPLACE FUNCTION public.get_trial_balance_rows(p_company_id UUID,p_as_of DATE)
RETURNS TABLE(account_id UUID,account_code TEXT,account_name TEXT,account_type TEXT,debit NUMERIC,credit NUMERIC)
LANGUAGE sql SECURITY DEFINER SET search_path=public STABLE AS $$
  SELECT a.id,a.code,a.name,a.type,
    COALESCE(sum(CASE WHEN je.id IS NOT NULL THEN jl.debit ELSE 0 END),0),
    COALESCE(sum(CASE WHEN je.id IS NOT NULL THEN jl.credit ELSE 0 END),0)
  FROM accounts a
  LEFT JOIN journal_lines jl ON jl.account_id=a.id AND jl.company_id=p_company_id
  LEFT JOIN journal_entries je ON je.id=jl.journal_entry_id AND je.company_id=p_company_id
    AND je.deleted_at IS NULL AND (je.status='posted' OR je.reversed_by IS NOT NULL)
    AND (p_as_of IS NULL OR je.date<=p_as_of)
  WHERE a.company_id=p_company_id
  GROUP BY a.id,a.code,a.name,a.type ORDER BY a.code;
$$;

CREATE OR REPLACE FUNCTION public.get_financial_statement_rows(
  p_company_id UUID,p_from DATE DEFAULT NULL,p_to DATE DEFAULT NULL
) RETURNS TABLE(
  account_id UUID,account_code TEXT,account_name TEXT,account_type TEXT,
  opening_debit NUMERIC,opening_credit NUMERIC,period_debit NUMERIC,period_credit NUMERIC,
  cumulative_debit NUMERIC,cumulative_credit NUMERIC
) LANGUAGE sql SECURITY DEFINER SET search_path=public STABLE AS $$
  SELECT a.id,a.code,a.name,a.type,
    COALESCE(sum(jl.debit) FILTER(WHERE je.id IS NOT NULL AND p_from IS NOT NULL AND je.date<p_from),0),
    COALESCE(sum(jl.credit) FILTER(WHERE je.id IS NOT NULL AND p_from IS NOT NULL AND je.date<p_from),0),
    COALESCE(sum(jl.debit) FILTER(WHERE je.id IS NOT NULL AND (p_from IS NULL OR je.date>=p_from) AND (p_to IS NULL OR je.date<=p_to)),0),
    COALESCE(sum(jl.credit) FILTER(WHERE je.id IS NOT NULL AND (p_from IS NULL OR je.date>=p_from) AND (p_to IS NULL OR je.date<=p_to)),0),
    COALESCE(sum(jl.debit) FILTER(WHERE je.id IS NOT NULL AND (p_to IS NULL OR je.date<=p_to)),0),
    COALESCE(sum(jl.credit) FILTER(WHERE je.id IS NOT NULL AND (p_to IS NULL OR je.date<=p_to)),0)
  FROM accounts a
  LEFT JOIN journal_lines jl ON jl.account_id=a.id AND jl.company_id=p_company_id
  LEFT JOIN journal_entries je ON je.id=jl.journal_entry_id AND je.company_id=p_company_id
    AND je.deleted_at IS NULL AND (je.status='posted' OR je.reversed_by IS NOT NULL)
    AND (p_to IS NULL OR je.date<=p_to)
  WHERE a.company_id=p_company_id
  GROUP BY a.id,a.code,a.name,a.type ORDER BY a.code;
$$;

CREATE OR REPLACE FUNCTION public.get_monthly_profit_loss(p_company_id UUID,p_year INTEGER)
RETURNS TABLE(month_number INTEGER,revenue NUMERIC,expenses NUMERIC)
LANGUAGE sql SECURITY DEFINER SET search_path=public STABLE AS $$
  SELECT m.month_number,
    COALESCE(sum(CASE WHEN a.type='revenue' THEN jl.credit-jl.debit ELSE 0 END),0),
    COALESCE(sum(CASE WHEN a.type='expense' THEN jl.debit-jl.credit ELSE 0 END),0)
  FROM generate_series(1,12) m(month_number)
  LEFT JOIN journal_entries je ON je.company_id=p_company_id
    AND je.deleted_at IS NULL AND (je.status='posted' OR je.reversed_by IS NOT NULL)
    AND EXTRACT(YEAR FROM je.date)=p_year AND EXTRACT(MONTH FROM je.date)=m.month_number
  LEFT JOIN journal_lines jl ON jl.journal_entry_id=je.id AND jl.company_id=p_company_id
  LEFT JOIN accounts a ON a.id=jl.account_id AND a.company_id=p_company_id
  GROUP BY m.month_number ORDER BY m.month_number;
$$;

CREATE OR REPLACE FUNCTION public.get_top_clients_by_revenue(
  p_company_id UUID,p_from DATE,p_to DATE,p_limit INTEGER DEFAULT 5
) RETURNS TABLE(contact_id UUID,name TEXT,revenue NUMERIC,entry_count BIGINT)
LANGUAGE sql SECURITY DEFINER SET search_path=public STABLE AS $$
  SELECT c.id,c.name,sum(jl.credit-jl.debit),count(DISTINCT je.id)
  FROM journal_lines jl
  JOIN journal_entries je ON je.id=jl.journal_entry_id AND je.company_id=p_company_id
    AND je.deleted_at IS NULL AND (je.status='posted' OR je.reversed_by IS NOT NULL)
  JOIN accounts a ON a.id=jl.account_id AND a.company_id=p_company_id AND a.type='revenue'
  JOIN contacts c ON c.id=jl.contact_id AND c.company_id=p_company_id
  WHERE jl.company_id=p_company_id AND je.date BETWEEN p_from AND p_to
  GROUP BY c.id,c.name HAVING sum(jl.credit-jl.debit)<>0
  ORDER BY 3 DESC LIMIT LEAST(GREATEST(p_limit,1),100);
$$;

CREATE OR REPLACE FUNCTION public.get_vat_ledger_lines(
  p_company_id UUID,p_from DATE,p_to DATE,p_limit INTEGER DEFAULT 500,p_offset INTEGER DEFAULT 0
) RETURNS TABLE(entry_date DATE,entry_number INTEGER,description TEXT,vat_type TEXT,amount NUMERIC,total_count BIGINT)
LANGUAGE sql SECURITY DEFINER SET search_path=public STABLE AS $$
  SELECT je.date,je.number,COALESCE(jl.description,je.description),
    CASE a.code WHEN '2120' THEN 'sales' ELSE 'purchases' END,
    CASE a.code WHEN '2120' THEN jl.credit-jl.debit ELSE jl.debit-jl.credit END,count(*) OVER()
  FROM journal_lines jl
  JOIN journal_entries je ON je.id=jl.journal_entry_id AND je.company_id=p_company_id
    AND je.deleted_at IS NULL AND (je.status='posted' OR je.reversed_by IS NOT NULL)
  JOIN accounts a ON a.id=jl.account_id AND a.company_id=p_company_id AND a.code IN('2120','1180')
  WHERE jl.company_id=p_company_id AND je.date BETWEEN p_from AND p_to
  ORDER BY je.date,je.number,jl.id
  LIMIT LEAST(GREATEST(p_limit,1),500) OFFSET GREATEST(p_offset,0);
$$;

CREATE OR REPLACE FUNCTION public.get_vat_return_summary(p_company_id UUID,p_from DATE,p_to DATE)
RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path=public STABLE AS $$
  WITH vat AS (
    SELECT COALESCE(sum(CASE WHEN a.code='2120' THEN jl.credit-jl.debit ELSE 0 END),0) output_vat,
      COALESCE(sum(CASE WHEN a.code='1180' THEN jl.debit-jl.credit ELSE 0 END),0) input_vat
    FROM journal_lines jl
    JOIN journal_entries je ON je.id=jl.journal_entry_id AND je.company_id=p_company_id
      AND je.deleted_at IS NULL AND (je.status='posted' OR je.reversed_by IS NOT NULL)
    JOIN accounts a ON a.id=jl.account_id AND a.company_id=p_company_id
    WHERE jl.company_id=p_company_id AND je.date BETWEEN p_from AND p_to
  ), sales AS (
    SELECT COALESCE(sum(i.subtotal),0) total_sales,
      COALESCE(sum(i.subtotal) FILTER(WHERE COALESCE(i.tax_rate,0)=0),0) zero_sales,count(*) invoice_count
    FROM invoices i JOIN journal_entries je ON je.id=i.journal_entry_id AND je.company_id=p_company_id
      AND je.status='posted' AND je.deleted_at IS NULL
    WHERE i.company_id=p_company_id AND i.date BETWEEN p_from AND p_to
      AND i.status<>'cancelled' AND i.deleted_at IS NULL
  ), credits AS (
    SELECT COALESCE(sum(cn.subtotal),0) credit_sales
    FROM credit_notes cn JOIN journal_entries je ON je.id=cn.journal_entry_id AND je.company_id=p_company_id
      AND je.status='posted' AND je.deleted_at IS NULL
    WHERE cn.company_id=p_company_id AND cn.date BETWEEN p_from AND p_to
      AND cn.status='approved' AND cn.deleted_at IS NULL
  ), purchases AS (
    SELECT COALESCE(sum(pi.subtotal),0) total_purchases,count(*) purchase_count
    FROM purchase_invoices pi JOIN journal_entries je ON je.id=pi.journal_entry_id AND je.company_id=p_company_id
      AND je.status='posted' AND je.deleted_at IS NULL
    WHERE pi.company_id=p_company_id AND pi.date BETWEEN p_from AND p_to AND pi.status<>'cancelled'
  )
  SELECT jsonb_build_object(
    'outputVat',vat.output_vat,'inputVat',vat.input_vat,
    'totalSales',GREATEST(sales.total_sales-credits.credit_sales,0),'zeroRatedSales',sales.zero_sales,
    'totalPurchases',purchases.total_purchases,'invoiceCount',sales.invoice_count,'purchaseCount',purchases.purchase_count
  ) FROM vat,sales,credits,purchases;
$$;

CREATE OR REPLACE FUNCTION public.get_equity_changes_summary(
  p_company_id UUID,p_from DATE DEFAULT NULL,p_to DATE DEFAULT NULL
) RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path=public STABLE AS $$
  SELECT jsonb_build_object(
    'openingCapital',COALESCE(sum(CASE WHEN a.code='3100' THEN jl.credit-jl.debit ELSE 0 END) FILTER(WHERE p_from IS NOT NULL AND je.date<p_from),0),
    'openingRetained',COALESCE(sum(CASE WHEN a.code='3200' THEN jl.credit-jl.debit ELSE 0 END) FILTER(WHERE p_from IS NOT NULL AND je.date<p_from),0),
    'openingOtherEquity',COALESCE(sum(CASE WHEN a.type='equity' AND a.code NOT IN('3100','3200') THEN jl.credit-jl.debit ELSE 0 END) FILTER(WHERE p_from IS NOT NULL AND je.date<p_from),0),
    'openingPriorNetIncome',COALESCE(sum(CASE WHEN a.type IN('revenue','expense') THEN jl.credit-jl.debit ELSE 0 END) FILTER(WHERE p_from IS NOT NULL AND je.date<p_from),0),
    'periodCapitalChange',COALESCE(sum(CASE WHEN a.code='3100' THEN jl.credit-jl.debit ELSE 0 END) FILTER(WHERE (p_from IS NULL OR je.date>=p_from) AND (p_to IS NULL OR je.date<=p_to)),0),
    'periodRetainedChange',COALESCE(sum(CASE WHEN a.code='3200' THEN jl.credit-jl.debit ELSE 0 END) FILTER(WHERE (p_from IS NULL OR je.date>=p_from) AND (p_to IS NULL OR je.date<=p_to)),0),
    'periodRevenue',COALESCE(sum(CASE WHEN a.type='revenue' THEN jl.credit-jl.debit ELSE 0 END) FILTER(WHERE (p_from IS NULL OR je.date>=p_from) AND (p_to IS NULL OR je.date<=p_to)),0),
    'periodExpenses',COALESCE(sum(CASE WHEN a.type='expense' THEN jl.debit-jl.credit ELSE 0 END) FILTER(WHERE (p_from IS NULL OR je.date>=p_from) AND (p_to IS NULL OR je.date<=p_to)),0)
  )
  FROM journal_lines jl
  JOIN journal_entries je ON je.id=jl.journal_entry_id AND je.company_id=p_company_id
    AND je.deleted_at IS NULL AND (je.status='posted' OR je.reversed_by IS NOT NULL)
  JOIN accounts a ON a.id=jl.account_id AND a.company_id=p_company_id
  WHERE jl.company_id=p_company_id AND (p_to IS NULL OR je.date<=p_to);
$$;

CREATE OR REPLACE FUNCTION public.get_cost_center_profitability(
  p_company_id UUID,p_from DATE DEFAULT NULL,p_to DATE DEFAULT NULL
) RETURNS TABLE(cost_center_id UUID,code TEXT,name TEXT,revenue NUMERIC,expenses NUMERIC)
LANGUAGE sql SECURITY DEFINER SET search_path=public STABLE AS $$
  SELECT cc.id,cc.code,cc.name,
    COALESCE(sum(CASE WHEN a.type='revenue' THEN jl.credit-jl.debit ELSE 0 END),0),
    COALESCE(sum(CASE WHEN a.type='expense' THEN jl.debit-jl.credit ELSE 0 END),0)
  FROM cost_centers cc
  LEFT JOIN journal_lines jl ON jl.cost_center_id=cc.id AND jl.company_id=p_company_id
  LEFT JOIN journal_entries je ON je.id=jl.journal_entry_id AND je.company_id=p_company_id
    AND je.deleted_at IS NULL AND (je.status='posted' OR je.reversed_by IS NOT NULL)
    AND (p_from IS NULL OR je.date>=p_from) AND (p_to IS NULL OR je.date<=p_to)
  LEFT JOIN accounts a ON a.id=jl.account_id AND a.company_id=p_company_id AND je.id IS NOT NULL
  WHERE cc.company_id=p_company_id
  GROUP BY cc.id,cc.code,cc.name ORDER BY cc.code;
$$;

CREATE OR REPLACE FUNCTION public.get_contact_balances(
  p_company_id UUID,p_type TEXT DEFAULT 'all',p_from DATE DEFAULT NULL,p_to DATE DEFAULT NULL
) RETURNS TABLE(contact_id UUID,name TEXT,contact_type TEXT,phone TEXT,tax_number TEXT,
  opening NUMERIC,period_debit NUMERIC,period_credit NUMERIC,closing NUMERIC)
LANGUAGE sql SECURITY DEFINER SET search_path=public STABLE AS $$
  SELECT c.id,c.name,c.type,c.phone,c.tax_number,
    COALESCE(sum(jl.debit-jl.credit) FILTER(WHERE p_from IS NOT NULL AND je.date<p_from AND a.id IS NOT NULL),0),
    COALESCE(sum(jl.debit) FILTER(WHERE (p_from IS NULL OR je.date>=p_from) AND (p_to IS NULL OR je.date<=p_to) AND a.id IS NOT NULL),0),
    COALESCE(sum(jl.credit) FILTER(WHERE (p_from IS NULL OR je.date>=p_from) AND (p_to IS NULL OR je.date<=p_to) AND a.id IS NOT NULL),0),
    COALESCE(sum(jl.debit-jl.credit) FILTER(WHERE (p_to IS NULL OR je.date<=p_to) AND a.id IS NOT NULL),0)
  FROM contacts c
  LEFT JOIN journal_lines jl ON jl.contact_id=c.id AND jl.company_id=p_company_id
  LEFT JOIN journal_entries je ON je.id=jl.journal_entry_id AND je.company_id=p_company_id
    AND je.deleted_at IS NULL AND (je.status='posted' OR je.reversed_by IS NOT NULL)
  LEFT JOIN accounts a ON a.id=jl.account_id AND a.company_id=p_company_id AND je.id IS NOT NULL
    AND ((c.type='client' AND a.code IN('1130','2180')) OR (c.type='supplier' AND a.code='2110')
      OR (c.type='subcontractor' AND a.code IN('2110','2150')) OR (c.type='both' AND a.code IN('1130','2110','2180')))
  WHERE c.company_id=p_company_id AND (p_type='all' OR (p_type='client' AND c.type IN('client','both'))
    OR (p_type='supplier' AND c.type IN('supplier','subcontractor','both')))
  GROUP BY c.id,c.name,c.type,c.phone,c.tax_number
  HAVING COALESCE(sum(abs(jl.debit)+abs(jl.credit)) FILTER(WHERE (p_to IS NULL OR je.date<=p_to) AND a.id IS NOT NULL),0)>0
  ORDER BY c.name;
$$;

CREATE OR REPLACE FUNCTION public.get_account_period_totals(
  p_company_id UUID,p_account_type TEXT DEFAULT NULL,p_from DATE DEFAULT NULL,p_to DATE DEFAULT NULL
) RETURNS TABLE(account_id UUID,code TEXT,name TEXT,account_type TEXT,debit NUMERIC,credit NUMERIC)
LANGUAGE sql SECURITY DEFINER SET search_path=public STABLE AS $$
  SELECT a.id,a.code,a.name,a.type,
    COALESCE(sum(CASE WHEN je.id IS NOT NULL THEN jl.debit ELSE 0 END),0),
    COALESCE(sum(CASE WHEN je.id IS NOT NULL THEN jl.credit ELSE 0 END),0)
  FROM accounts a
  LEFT JOIN journal_lines jl ON jl.account_id=a.id AND jl.company_id=p_company_id
  LEFT JOIN journal_entries je ON je.id=jl.journal_entry_id AND je.company_id=p_company_id
    AND je.deleted_at IS NULL AND (je.status='posted' OR je.reversed_by IS NOT NULL)
    AND (p_from IS NULL OR je.date>=p_from) AND (p_to IS NULL OR je.date<=p_to)
  WHERE a.company_id=p_company_id AND (p_account_type IS NULL OR a.type=p_account_type)
  GROUP BY a.id,a.code,a.name,a.type ORDER BY a.code;
$$;

CREATE OR REPLACE FUNCTION public.get_report_projects(
  p_company_id UUID,p_active_only BOOLEAN DEFAULT FALSE
) RETURNS TABLE(
  project_id UUID,name TEXT,contract_value NUMERIC,client_id UUID,client_name TEXT,status TEXT,
  start_date DATE,end_date DATE
) LANGUAGE sql SECURITY DEFINER SET search_path=public STABLE AS $$
  SELECT p.id,p.name,p.contract_value,p.client_id,c.name,p.status,p.start_date,p.end_date
  FROM projects p LEFT JOIN contacts c ON c.id=p.client_id AND c.company_id=p_company_id
  WHERE p.company_id=p_company_id AND (NOT p_active_only OR p.status='active')
  ORDER BY p.name,p.id;
$$;

CREATE OR REPLACE FUNCTION public.get_project_billing_totals(
  p_company_id UUID,p_project_ids UUID[] DEFAULT NULL,p_from DATE DEFAULT NULL,p_to DATE DEFAULT NULL
) RETURNS TABLE(project_id UUID,billed NUMERIC,credits NUMERIC,net_billed NUMERIC)
LANGUAGE sql SECURITY DEFINER SET search_path=public STABLE AS $$
  WITH billed AS (
    SELECT i.project_id,sum(i.subtotal) amount
    FROM invoices i
    JOIN journal_entries je ON je.id=i.journal_entry_id AND je.company_id=p_company_id
      AND je.status='posted' AND je.deleted_at IS NULL
    JOIN projects p ON p.id=i.project_id AND p.company_id=p_company_id
    WHERE i.company_id=p_company_id AND i.project_id IS NOT NULL AND i.status<>'cancelled' AND i.deleted_at IS NULL
      AND (p_project_ids IS NULL OR i.project_id=ANY(p_project_ids))
      AND (p_from IS NULL OR i.date>=p_from) AND (p_to IS NULL OR i.date<=p_to)
    GROUP BY i.project_id
  ), credits AS (
    SELECT cn.project_id,sum(cn.subtotal) amount
    FROM credit_notes cn
    JOIN journal_entries je ON je.id=cn.journal_entry_id AND je.company_id=p_company_id
      AND je.status='posted' AND je.deleted_at IS NULL
    JOIN projects p ON p.id=cn.project_id AND p.company_id=p_company_id
    WHERE cn.company_id=p_company_id AND cn.project_id IS NOT NULL AND cn.status='approved' AND cn.deleted_at IS NULL
      AND (p_project_ids IS NULL OR cn.project_id=ANY(p_project_ids))
      AND (p_from IS NULL OR cn.date>=p_from) AND (p_to IS NULL OR cn.date<=p_to)
    GROUP BY cn.project_id
  )
  SELECT COALESCE(b.project_id,c.project_id),COALESCE(b.amount,0),COALESCE(c.amount,0),COALESCE(b.amount,0)-COALESCE(c.amount,0)
  FROM billed b FULL JOIN credits c ON c.project_id=b.project_id;
$$;

CREATE OR REPLACE FUNCTION public.get_project_account_totals(
  p_company_id UUID,p_project_ids UUID[] DEFAULT NULL,p_from DATE DEFAULT NULL,p_to DATE DEFAULT NULL
) RETURNS TABLE(project_id UUID,account_id UUID,code TEXT,name TEXT,account_type TEXT,debit NUMERIC,credit NUMERIC)
LANGUAGE sql SECURITY DEFINER SET search_path=public STABLE AS $$
  SELECT jl.project_id,a.id,a.code,a.name,a.type,sum(jl.debit),sum(jl.credit)
  FROM journal_lines jl
  JOIN journal_entries je ON je.id=jl.journal_entry_id AND je.company_id=p_company_id
    AND je.deleted_at IS NULL AND (je.status='posted' OR je.reversed_by IS NOT NULL)
  JOIN accounts a ON a.id=jl.account_id AND a.company_id=p_company_id
  JOIN projects p ON p.id=jl.project_id AND p.company_id=p_company_id
  WHERE jl.company_id=p_company_id AND jl.project_id IS NOT NULL
    AND (p_project_ids IS NULL OR jl.project_id=ANY(p_project_ids))
    AND (p_from IS NULL OR je.date>=p_from) AND (p_to IS NULL OR je.date<=p_to)
  GROUP BY jl.project_id,a.id,a.code,a.name,a.type ORDER BY jl.project_id,a.code;
$$;

CREATE OR REPLACE FUNCTION public.get_project_profitability(p_company_id UUID,p_limit INTEGER DEFAULT 10)
RETURNS TABLE(project_id UUID,name TEXT,revenue NUMERIC,expenses NUMERIC,margin NUMERIC)
LANGUAGE sql SECURITY DEFINER SET search_path=public STABLE AS $$
  SELECT p.id,p.name,
    COALESCE(sum(CASE WHEN a.type='revenue' THEN jl.credit-jl.debit ELSE 0 END),0),
    COALESCE(sum(CASE WHEN a.type='expense' THEN jl.debit-jl.credit ELSE 0 END),0),
    CASE WHEN COALESCE(sum(CASE WHEN a.type='revenue' THEN jl.credit-jl.debit ELSE 0 END),0)=0 THEN 0
      ELSE (sum(CASE WHEN a.type='revenue' THEN jl.credit-jl.debit ELSE 0 END)
        -sum(CASE WHEN a.type='expense' THEN jl.debit-jl.credit ELSE 0 END))*100
        /NULLIF(sum(CASE WHEN a.type='revenue' THEN jl.credit-jl.debit ELSE 0 END),0) END
  FROM projects p
  LEFT JOIN journal_lines jl ON jl.project_id=p.id AND jl.company_id=p_company_id
  LEFT JOIN journal_entries je ON je.id=jl.journal_entry_id AND je.company_id=p_company_id
    AND je.deleted_at IS NULL AND (je.status='posted' OR je.reversed_by IS NOT NULL)
  LEFT JOIN accounts a ON a.id=jl.account_id AND a.company_id=p_company_id AND je.id IS NOT NULL
  WHERE p.company_id=p_company_id AND p.status IN('active','completed')
  GROUP BY p.id,p.name ORDER BY 5 DESC NULLS LAST
  LIMIT LEAST(GREATEST(p_limit,1),100);
$$;

CREATE OR REPLACE FUNCTION public.get_assistant_company_snapshot(p_company_id UUID)
RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path=public STABLE AS $$
  WITH ledger AS (
    SELECT COALESCE(sum(CASE WHEN a.type='revenue' THEN jl.credit-jl.debit ELSE 0 END),0) revenue,
      COALESCE(sum(CASE WHEN a.type='expense' THEN jl.debit-jl.credit ELSE 0 END),0) expenses
    FROM journal_lines jl
    JOIN journal_entries je ON je.id=jl.journal_entry_id AND je.company_id=p_company_id
      AND je.deleted_at IS NULL AND (je.status='posted' OR je.reversed_by IS NOT NULL)
    JOIN accounts a ON a.id=jl.account_id AND a.company_id=p_company_id
    WHERE jl.company_id=p_company_id
  ), invoices_due AS (
    SELECT count(*) unpaid_count,
      count(*) FILTER(WHERE i.due_date<CURRENT_DATE) overdue_count,
      COALESCE(sum(GREATEST(i.total-COALESCE(i.paid_amount,0),0)),0) outstanding,
      COALESCE(sum(GREATEST(i.total-COALESCE(i.paid_amount,0),0)) FILTER(WHERE i.due_date<CURRENT_DATE),0) overdue
    FROM invoices i
    JOIN journal_entries je ON je.id=i.journal_entry_id AND je.company_id=p_company_id
      AND je.status='posted' AND je.deleted_at IS NULL
    WHERE i.company_id=p_company_id AND i.status IN('unpaid','partial') AND i.deleted_at IS NULL
  ), counters AS (
    SELECT
      (SELECT count(*) FROM projects p WHERE p.company_id=p_company_id) total_projects,
      (SELECT count(*) FROM projects p WHERE p.company_id=p_company_id AND p.status='active') active_projects,
      (SELECT count(*) FROM projects p WHERE p.company_id=p_company_id AND p.status='completed') completed_projects,
      (SELECT count(*) FROM contacts c WHERE c.company_id=p_company_id AND c.type IN('client','both')
        AND COALESCE(c.is_active,TRUE) AND c.deleted_at IS NULL) clients,
      (SELECT count(*) FROM contacts c WHERE c.company_id=p_company_id AND c.type IN('supplier','subcontractor','both')
        AND COALESCE(c.is_active,TRUE) AND c.deleted_at IS NULL) suppliers,
      (SELECT count(*) FROM journal_entries je WHERE je.company_id=p_company_id AND je.deleted_at IS NULL
        AND (je.status='posted' OR je.reversed_by IS NOT NULL)) journal_entries,
      (SELECT count(*) FROM journal_entries je WHERE je.company_id=p_company_id AND je.deleted_at IS NULL
        AND (je.status='posted' OR je.reversed_by IS NOT NULL)
        AND date_trunc('month',je.date::TIMESTAMP)=date_trunc('month',CURRENT_DATE::TIMESTAMP)) month_journal_entries,
      (SELECT count(*) FROM approval_requests ar WHERE ar.company_id=p_company_id AND ar.status IN('pending','processing')) pending_approvals,
      (SELECT COALESCE(jsonb_agg(x.name ORDER BY x.name),'[]'::JSONB)
        FROM (SELECT p.name FROM projects p WHERE p.company_id=p_company_id AND p.status='active' ORDER BY p.name LIMIT 5) x) active_project_names
  )
  SELECT jsonb_build_object(
    'revenue',ledger.revenue,'expenses',ledger.expenses,'netProfit',ledger.revenue-ledger.expenses,
    'unpaidInvoices',invoices_due.unpaid_count,'outstandingInvoices',invoices_due.outstanding,
    'overdueInvoiceCount',invoices_due.overdue_count,'overdueInvoices',invoices_due.overdue,
    'totalProjects',counters.total_projects,
    'activeProjects',counters.active_projects,'completedProjects',counters.completed_projects,
    'clients',counters.clients,'suppliers',counters.suppliers,'journalEntries',counters.journal_entries,
    'monthJournalEntries',counters.month_journal_entries,'pendingApprovals',counters.pending_approvals,
    'activeProjectNames',counters.active_project_names
  ) FROM ledger,invoices_due,counters;
$$;

CREATE OR REPLACE FUNCTION public.get_project_budget_rows(
  p_company_id UUID,p_project_id UUID DEFAULT NULL
) RETURNS TABLE(
  id UUID,company_id UUID,project_id UUID,project_name TEXT,category TEXT,subcategory TEXT,
  amount NUMERIC,period TEXT,notes TEXT,created_by UUID,created_at TIMESTAMPTZ,updated_at TIMESTAMPTZ,
  actual_spent NUMERIC
) LANGUAGE sql SECURITY DEFINER SET search_path=public STABLE AS $$
  SELECT b.id,b.company_id,b.project_id,p.name,b.category,b.subcategory,b.amount,b.period,b.notes,
    b.created_by,b.created_at,b.updated_at,
    COALESCE((
      SELECT sum(jl.debit-jl.credit)
      FROM journal_lines jl
      JOIN journal_entries je ON je.id=jl.journal_entry_id AND je.company_id=p_company_id
        AND je.deleted_at IS NULL AND (je.status='posted' OR je.reversed_by IS NOT NULL)
      JOIN accounts a ON a.id=jl.account_id AND a.company_id=p_company_id AND a.type='expense'
      WHERE jl.company_id=p_company_id AND jl.project_id=b.project_id
        AND CASE b.category
          WHEN 'materials' THEN a.code LIKE '51%'
          WHEN 'labor' THEN a.code LIKE '52%'
          WHEN 'equipment' THEN a.code LIKE '53%'
          WHEN 'subcontractor' THEN a.code LIKE '54%'
          WHEN 'overhead' THEN a.code LIKE '55%'
          ELSE a.code NOT LIKE '51%' AND a.code NOT LIKE '52%' AND a.code NOT LIKE '53%'
            AND a.code NOT LIKE '54%' AND a.code NOT LIKE '55%'
        END
    ),0)
  FROM project_budgets b
  JOIN projects p ON p.id=b.project_id AND p.company_id=p_company_id
  WHERE b.company_id=p_company_id AND (p_project_id IS NULL OR b.project_id=p_project_id)
  ORDER BY b.created_at DESC,b.id;
$$;

CREATE OR REPLACE FUNCTION public.create_project_budget_atomic(
  p_company_id UUID,p_project_id UUID,p_category TEXT,p_subcategory TEXT,p_amount NUMERIC,
  p_period TEXT,p_notes TEXT,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_budget project_budgets%ROWTYPE;
BEGIN
  IF p_category NOT IN('materials','labor','equipment','subcontractor','overhead','other')
    OR p_period NOT IN('total','monthly','quarterly','phase')
    OR p_amount IS NULL OR p_amount<=0 OR p_amount<>ROUND(p_amount,2)
    OR LENGTH(COALESCE(p_subcategory,''))>100 OR LENGTH(COALESCE(p_notes,''))>1000 THEN
    RAISE EXCEPTION 'بيانات الميزانية غير صالحة';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE) THEN
    RAISE EXCEPTION 'المستخدم غير صالح';
  END IF;
  PERFORM 1 FROM projects WHERE id=p_project_id AND company_id=p_company_id
    AND status NOT IN('cancelled') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المشروع غير موجود'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_company_id::TEXT||':budget:'||p_project_id::TEXT||':'||p_category,0));
  -- Actuals are classified at project/category level, so allowing two budget
  -- rows for that scope would duplicate the same actual and make variance lie.
  IF EXISTS(
    SELECT 1 FROM project_budgets WHERE company_id=p_company_id AND project_id=p_project_id AND category=p_category
  ) THEN RAISE EXCEPTION 'توجد ميزانية لهذه الفئة في المشروع'; END IF;
  PERFORM set_config('app.budget_write_company',p_company_id::TEXT,TRUE);
  INSERT INTO project_budgets(company_id,project_id,category,subcategory,amount,period,notes,created_by)
  VALUES(p_company_id,p_project_id,p_category,NULLIF(BTRIM(p_subcategory),''),ROUND(p_amount,2),p_period,
    NULLIF(BTRIM(p_notes),''),p_user_id) RETURNING * INTO v_budget;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'create','project_budget',v_budget.id,to_jsonb(v_budget));
  RETURN to_jsonb(v_budget);
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_project_budget_write()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_company UUID:=COALESCE(NEW.company_id,OLD.company_id);
BEGIN
  IF TG_OP='UPDATE' AND NEW.company_id IS DISTINCT FROM OLD.company_id THEN RAISE EXCEPTION 'budget company is immutable'; END IF;
  IF current_setting('app.business_data_reset',TRUE)=v_company::TEXT THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF current_setting('app.budget_write_company',TRUE) IS DISTINCT FROM v_company::TEXT THEN
    RAISE EXCEPTION 'project budgets require audited functions';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_project_budget_write ON project_budgets;
CREATE TRIGGER trg_guard_project_budget_write BEFORE INSERT OR UPDATE OR DELETE ON project_budgets
FOR EACH ROW EXECUTE FUNCTION public.guard_project_budget_write();

REVOKE ALL ON FUNCTION public.get_financial_statement_rows(UUID,DATE,DATE) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_report_projects(UUID,BOOLEAN) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_assistant_company_snapshot(UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_project_budget_rows(UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.create_project_budget_atomic(UUID,UUID,TEXT,TEXT,NUMERIC,TEXT,TEXT,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_financial_statement_rows(UUID,DATE,DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_report_projects(UUID,BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_assistant_company_snapshot(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_project_budget_rows(UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_project_budget_atomic(UUID,UUID,TEXT,TEXT,NUMERIC,TEXT,TEXT,UUID) TO service_role;
