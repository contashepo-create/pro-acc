-- ============================================================
-- 092: صافي تقادم الذمم ومؤشرات الفواتير مع إشعارات المدين/الدائن
-- ------------------------------------------------------------
-- المشكلة: دوال تقادم الذمم (get_aging_by_contact / get_receivable_aging)
-- كانت تخصم إشعارات الدائن فقط من المتبقي، وتتجاهل إشعارات المدين
-- (note_type أُضيف لاحقًا في 090)، فيظهر رصيد العميل أقل من حقيقته.
-- والحل: القيد يصبح صافيًا موقّعًا: دائن (+خصم) − مدين (+إضافة)
-- بنفس نوافذ التاريخ والاعتماد والإلغاء القائمة (as-of صحيح).
-- أُعيد تعريف get_assistant_company_snapshot أيضًا ليحسب
-- المستحقات/المتأخرات في لوحة المساعد صافية بعد الإشعارات المعتمدة.
-- الدوال LANGUAGE sql STABLE — إعادة تعريف آمنة وقابلة لإعادة التنفيذ.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_aging_by_contact(p_company_id UUID,p_type TEXT,p_as_of DATE)
RETURNS TABLE(contact_id UUID,contact_name TEXT,open_amount NUMERIC,unapplied NUMERIC,
  bucket_0_30 NUMERIC,bucket_31_60 NUMERIC,bucket_61_90 NUMERIC,bucket_90_plus NUMERIC,
  max_days_overdue INTEGER,last_invoice_date DATE)
LANGUAGE sql SECURITY DEFINER SET search_path=public STABLE AS $$
  WITH posted_receipts AS (
    SELECT vr.* FROM voucher_receipts vr
    JOIN journal_entries je ON je.id=vr.journal_entry_id AND je.company_id=p_company_id
      AND je.status='posted' AND je.created_at::DATE<=p_as_of
    LEFT JOIN journal_entries rev ON rev.id=je.reversed_by AND rev.company_id=p_company_id
    WHERE vr.company_id=p_company_id AND vr.date<=p_as_of
      AND (rev.id IS NULL OR rev.created_at::DATE>p_as_of)
  ), receipt_paid AS (
    SELECT rii.invoice_id,sum(rii.amount) paid FROM receipt_invoice_items rii
    JOIN posted_receipts vr ON vr.id=rii.voucher_receipt_id
    WHERE rii.company_id=p_company_id GROUP BY rii.invoice_id
  ), gateway_paid AS (
    SELECT pr.invoice_id,sum(GREATEST(jl.credit-jl.debit,0)) paid
    FROM payment_records pr JOIN journal_entries je ON je.reference_type='payment' AND je.reference_id=pr.id
      AND je.company_id=p_company_id AND je.date<=p_as_of AND je.status='posted' AND je.created_at::DATE<=p_as_of
    LEFT JOIN journal_entries rev ON rev.id=je.reversed_by AND rev.company_id=p_company_id
    JOIN journal_lines jl ON jl.journal_entry_id=je.id AND jl.company_id=p_company_id
    JOIN accounts a ON a.id=jl.account_id AND a.company_id=p_company_id AND a.code='1130'
    WHERE pr.company_id=p_company_id AND (rev.id IS NULL OR rev.created_at::DATE>p_as_of) GROUP BY pr.invoice_id
  ), invoice_credits AS (
    SELECT cn.invoice_id,sum(CASE WHEN cn.note_type='debit' THEN -cn.total ELSE cn.total END) credited FROM credit_notes cn
    JOIN journal_entries je ON je.id=cn.journal_entry_id AND je.company_id=p_company_id AND je.status='posted' AND je.created_at::DATE<=p_as_of
    LEFT JOIN journal_entries rev ON rev.id=je.reversed_by AND rev.company_id=p_company_id
    WHERE cn.company_id=p_company_id AND cn.date<=p_as_of AND cn.invoice_id IS NOT NULL
      AND (rev.id IS NULL OR rev.created_at::DATE>p_as_of) GROUP BY cn.invoice_id
  ), ar_invoice AS (
    SELECT i.contact_id,i.date,GREATEST(0,p_as_of-COALESCE(i.due_date,i.date)) days,
      GREATEST(i.total-COALESCE(rp.paid,0)-COALESCE(gp.paid,0)-COALESCE(ic.credited,0),0) remaining
    FROM invoices i
    JOIN journal_entries ije ON ije.id=i.journal_entry_id AND ije.company_id=p_company_id
      AND ije.status='posted' AND ije.date<=p_as_of AND ije.created_at::DATE<=p_as_of
    LEFT JOIN journal_entries irev ON irev.id=ije.reversed_by AND irev.company_id=p_company_id
    LEFT JOIN receipt_paid rp ON rp.invoice_id=i.id LEFT JOIN gateway_paid gp ON gp.invoice_id=i.id
    LEFT JOIN invoice_credits ic ON ic.invoice_id=i.id
    WHERE i.company_id=p_company_id AND i.date<=p_as_of
      AND (irev.id IS NULL OR irev.created_at::DATE>p_as_of)
  ), receipt_allocated AS (
    SELECT rii.voucher_receipt_id,sum(rii.amount) allocated FROM receipt_invoice_items rii
    JOIN posted_receipts vr ON vr.id=rii.voucher_receipt_id
    WHERE rii.company_id=p_company_id GROUP BY rii.voucher_receipt_id
  ), unapplied_receipts AS (
    SELECT vr.contact_id,sum(GREATEST(vr.amount-COALESCE(ra.allocated,0),0)) amount
    FROM posted_receipts vr LEFT JOIN receipt_allocated ra ON ra.voucher_receipt_id=vr.id
    WHERE vr.receipt_type='client' AND vr.contact_id IS NOT NULL GROUP BY vr.contact_id
  ), gateway_advances AS (
    SELECT jl.contact_id,sum(jl.credit-jl.debit) amount FROM journal_lines jl
    JOIN journal_entries je ON je.id=jl.journal_entry_id AND je.company_id=p_company_id AND je.status='posted' AND je.date<=p_as_of
    JOIN accounts a ON a.id=jl.account_id AND a.company_id=p_company_id AND a.code='2180'
    WHERE jl.company_id=p_company_id AND jl.contact_id IS NOT NULL GROUP BY jl.contact_id
  ), ar AS (
    SELECT c.id,c.name,COALESCE(sum(ai.remaining),0),GREATEST(COALESCE(ur.amount,0)+COALESCE(ga.amount,0),0),
      COALESCE(sum(ai.remaining) FILTER(WHERE ai.days<=30),0),COALESCE(sum(ai.remaining) FILTER(WHERE ai.days BETWEEN 31 AND 60),0),
      COALESCE(sum(ai.remaining) FILTER(WHERE ai.days BETWEEN 61 AND 90),0),COALESCE(sum(ai.remaining) FILTER(WHERE ai.days>90),0),
      COALESCE(max(ai.days),0)::INTEGER,max(ai.date)
    FROM contacts c LEFT JOIN ar_invoice ai ON ai.contact_id=c.id AND ai.remaining>0
    LEFT JOIN unapplied_receipts ur ON ur.contact_id=c.id LEFT JOIN gateway_advances ga ON ga.contact_id=c.id
    WHERE c.company_id=p_company_id AND c.type IN('client','both')
    GROUP BY c.id,c.name,ur.amount,ga.amount
    HAVING COALESCE(sum(ai.remaining),0)<>0 OR COALESCE(ur.amount,0)+COALESCE(ga.amount,0)<>0
  ), posted_disbursements AS (
    SELECT vd.* FROM voucher_disbursements vd
    JOIN journal_entries je ON je.id=vd.journal_entry_id AND je.company_id=p_company_id
      AND je.status='posted' AND je.created_at::DATE<=p_as_of
    LEFT JOIN journal_entries rev ON rev.id=je.reversed_by AND rev.company_id=p_company_id
    WHERE vd.company_id=p_company_id AND vd.date<=p_as_of
      AND (rev.id IS NULL OR rev.created_at::DATE>p_as_of)
  ), disbursement_paid AS (
    SELECT dii.purchase_invoice_id,sum(dii.amount) paid FROM disbursement_invoice_items dii
    JOIN posted_disbursements vd ON vd.id=dii.voucher_disbursement_id
    WHERE dii.company_id=p_company_id GROUP BY dii.purchase_invoice_id
  ), ap_invoice AS (
    SELECT i.supplier_id contact_id,i.date,GREATEST(0,p_as_of-COALESCE(i.due_date,i.date)) days,
      GREATEST(i.total-COALESCE(dp.paid,0),0) remaining
    FROM purchase_invoices i
    JOIN journal_entries ije ON ije.id=i.journal_entry_id AND ije.company_id=p_company_id
      AND ije.status='posted' AND ije.date<=p_as_of AND ije.created_at::DATE<=p_as_of
    LEFT JOIN journal_entries irev ON irev.id=ije.reversed_by AND irev.company_id=p_company_id
    LEFT JOIN disbursement_paid dp ON dp.purchase_invoice_id=i.id
    WHERE i.company_id=p_company_id AND i.date<=p_as_of
      AND (irev.id IS NULL OR irev.created_at::DATE>p_as_of)
  ), ap AS (
    SELECT c.id,c.name,COALESCE(sum(ai.remaining),0),0::NUMERIC,
      COALESCE(sum(ai.remaining) FILTER(WHERE ai.days<=30),0),COALESCE(sum(ai.remaining) FILTER(WHERE ai.days BETWEEN 31 AND 60),0),
      COALESCE(sum(ai.remaining) FILTER(WHERE ai.days BETWEEN 61 AND 90),0),COALESCE(sum(ai.remaining) FILTER(WHERE ai.days>90),0),
      COALESCE(max(ai.days),0)::INTEGER,max(ai.date)
    FROM contacts c JOIN ap_invoice ai ON ai.contact_id=c.id AND ai.remaining>0
    WHERE c.company_id=p_company_id AND c.type IN('supplier','subcontractor','both') GROUP BY c.id,c.name
  ) SELECT * FROM ar WHERE p_type='ar' UNION ALL SELECT * FROM ap WHERE p_type='ap';
$$;

CREATE OR REPLACE FUNCTION public.get_receivable_aging(p_company_id UUID,p_as_of DATE)
RETURNS TABLE(bucket TEXT,invoice_count BIGINT,amount NUMERIC)
LANGUAGE sql SECURITY DEFINER SET search_path=public STABLE AS $$
  WITH posted_receipts AS (
    SELECT vr.id FROM voucher_receipts vr JOIN journal_entries je ON je.id=vr.journal_entry_id
      AND je.company_id=p_company_id AND je.status='posted' AND je.created_at::DATE<=p_as_of
    LEFT JOIN journal_entries rev ON rev.id=je.reversed_by AND rev.company_id=p_company_id
    WHERE vr.company_id=p_company_id AND vr.date<=p_as_of AND (rev.id IS NULL OR rev.created_at::DATE>p_as_of)
  ), receipt_paid AS (
    SELECT rii.invoice_id,sum(rii.amount) paid FROM receipt_invoice_items rii
    JOIN posted_receipts vr ON vr.id=rii.voucher_receipt_id WHERE rii.company_id=p_company_id GROUP BY rii.invoice_id
  ), gateway_paid AS (
    SELECT pr.invoice_id,sum(GREATEST(jl.credit-jl.debit,0)) paid FROM payment_records pr
    JOIN journal_entries je ON je.reference_type='payment' AND je.reference_id=pr.id
      AND je.company_id=p_company_id AND je.date<=p_as_of AND je.status='posted' AND je.created_at::DATE<=p_as_of
    LEFT JOIN journal_entries rev ON rev.id=je.reversed_by AND rev.company_id=p_company_id
    JOIN journal_lines jl ON jl.journal_entry_id=je.id AND jl.company_id=p_company_id
    JOIN accounts a ON a.id=jl.account_id AND a.company_id=p_company_id AND a.code='1130'
    WHERE pr.company_id=p_company_id AND (rev.id IS NULL OR rev.created_at::DATE>p_as_of) GROUP BY pr.invoice_id
  ), credits AS (
    SELECT cn.invoice_id,sum(CASE WHEN cn.note_type='debit' THEN -cn.total ELSE cn.total END) amount FROM credit_notes cn
    JOIN journal_entries je ON je.id=cn.journal_entry_id AND je.company_id=p_company_id AND je.status='posted' AND je.created_at::DATE<=p_as_of
    LEFT JOIN journal_entries rev ON rev.id=je.reversed_by AND rev.company_id=p_company_id
    WHERE cn.company_id=p_company_id AND cn.invoice_id IS NOT NULL AND cn.date<=p_as_of
      AND (rev.id IS NULL OR rev.created_at::DATE>p_as_of) GROUP BY cn.invoice_id
  ), open_invoices AS (
    SELECT i.id,GREATEST(0,p_as_of-COALESCE(i.due_date,i.date)) days,
      GREATEST(i.total-COALESCE(rp.paid,0)-COALESCE(gp.paid,0)-COALESCE(c.amount,0),0) remaining
    FROM invoices i
    JOIN journal_entries ije ON ije.id=i.journal_entry_id AND ije.company_id=p_company_id
      AND ije.status='posted' AND ije.date<=p_as_of AND ije.created_at::DATE<=p_as_of
    LEFT JOIN journal_entries irev ON irev.id=ije.reversed_by AND irev.company_id=p_company_id
    LEFT JOIN receipt_paid rp ON rp.invoice_id=i.id
    LEFT JOIN gateway_paid gp ON gp.invoice_id=i.id LEFT JOIN credits c ON c.invoice_id=i.id
    WHERE i.company_id=p_company_id AND i.date<=p_as_of
      AND (irev.id IS NULL OR irev.created_at::DATE>p_as_of)
  ), ranges(bucket,min_days,max_days,ordering) AS (VALUES
    ('حالي (0-30 يوم)',0,30,1),('31-60 يوم',31,60,2),('61-90 يوم',61,90,3),('+90 يوم',91,1000000,4)
  ) SELECT r.bucket,count(i.id),COALESCE(sum(i.remaining),0)
  FROM ranges r LEFT JOIN open_invoices i ON i.days BETWEEN r.min_days AND r.max_days AND i.remaining>0
  GROUP BY r.bucket,r.ordering ORDER BY r.ordering;
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
  ), notes_net AS (
    SELECT cn.invoice_id, sum(CASE WHEN cn.note_type='debit' THEN cn.total ELSE -cn.total END) net
    FROM credit_notes cn
    WHERE cn.company_id=p_company_id AND cn.status='approved' AND cn.deleted_at IS NULL
      AND cn.invoice_id IS NOT NULL
    GROUP BY cn.invoice_id
  ), invoices_due AS (
    SELECT count(*) unpaid_count,
      count(*) FILTER(WHERE i.due_date<CURRENT_DATE) overdue_count,
      COALESCE(sum(GREATEST(i.total-COALESCE(i.paid_amount,0)+COALESCE(nn.net,0),0)),0) outstanding,
      COALESCE(sum(GREATEST(i.total-COALESCE(i.paid_amount,0)+COALESCE(nn.net,0),0)) FILTER(WHERE i.due_date<CURRENT_DATE),0) overdue
    FROM invoices i
    JOIN journal_entries je ON je.id=i.journal_entry_id AND je.company_id=p_company_id
      AND je.status='posted' AND je.deleted_at IS NULL
    LEFT JOIN notes_net nn ON nn.invoice_id=i.id
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
