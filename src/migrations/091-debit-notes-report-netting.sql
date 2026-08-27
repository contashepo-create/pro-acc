-- ======================================================================
-- 091: إدماج الإشعارات المدينة في تقارير الصافي (مكمل لميجريشن 090)
--
-- get_vat_return_summary: صافي المبيعات = الفواتير + المدين − الدائن
--   (ضريبة المخرجات في الدالة محسوبة من القيود فتشمل المدين أصلاً،
--    وبذلك يتطابق رقم المبيعات مع المخرجات).
-- get_project_billing_totals: عمود credits يصبح "صافي الإشعارات"
--   (الدائن − المدين) لتبقى هوية net_billed = billed − credits صحيحة.
-- ======================================================================

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
      AND cn.note_type='credit' AND cn.status='approved' AND cn.deleted_at IS NULL
  ), debits AS (
    SELECT COALESCE(sum(cn.subtotal),0) debit_sales
    FROM credit_notes cn JOIN journal_entries je ON je.id=cn.journal_entry_id AND je.company_id=p_company_id
      AND je.status='posted' AND je.deleted_at IS NULL
    WHERE cn.company_id=p_company_id AND cn.date BETWEEN p_from AND p_to
      AND cn.note_type='debit' AND cn.status='approved' AND cn.deleted_at IS NULL
  ), purchases AS (
    SELECT COALESCE(sum(pi.subtotal),0) total_purchases,count(*) purchase_count
    FROM purchase_invoices pi JOIN journal_entries je ON je.id=pi.journal_entry_id AND je.company_id=p_company_id
      AND je.status='posted' AND je.deleted_at IS NULL
    WHERE pi.company_id=p_company_id AND pi.date BETWEEN p_from AND p_to AND pi.status<>'cancelled'
  )
  SELECT jsonb_build_object(
    'outputVat',vat.output_vat,'inputVat',vat.input_vat,
    'totalSales',GREATEST(sales.total_sales+debits.debit_sales-credits.credit_sales,0),'zeroRatedSales',sales.zero_sales,
    'totalPurchases',purchases.total_purchases,'invoiceCount',sales.invoice_count,'purchaseCount',purchases.purchase_count
  ) FROM vat,sales,credits,debits,purchases;
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
      AND cn.note_type='credit'
      AND (p_project_ids IS NULL OR cn.project_id=ANY(p_project_ids))
      AND (p_from IS NULL OR cn.date>=p_from) AND (p_to IS NULL OR cn.date<=p_to)
    GROUP BY cn.project_id
  ), debits AS (
    SELECT cn.project_id,sum(cn.subtotal) amount
    FROM credit_notes cn
    JOIN journal_entries je ON je.id=cn.journal_entry_id AND je.company_id=p_company_id
      AND je.status='posted' AND je.deleted_at IS NULL
    JOIN projects p ON p.id=cn.project_id AND p.company_id=p_company_id
    WHERE cn.company_id=p_company_id AND cn.project_id IS NOT NULL AND cn.status='approved' AND cn.deleted_at IS NULL
      AND cn.note_type='debit'
      AND (p_project_ids IS NULL OR cn.project_id=ANY(p_project_ids))
      AND (p_from IS NULL OR cn.date>=p_from) AND (p_to IS NULL OR cn.date<=p_to)
    GROUP BY cn.project_id
  )
  SELECT COALESCE(b.project_id,c.project_id),COALESCE(b.amount,0),COALESCE(c.amount,0)-COALESCE(d.amount,0),COALESCE(b.amount,0)-(COALESCE(c.amount,0)-COALESCE(d.amount,0))
  FROM billed b FULL JOIN credits c ON c.project_id=b.project_id FULL JOIN debits d ON d.project_id=b.project_id;
$$;
