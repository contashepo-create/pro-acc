-- 083: Link receipt/disbursement vouchers to a project.
--
-- Vouchers were the only cash movements invisible to project P&L: their
-- journal lines carried no projectId and the tables had no project_id.
-- This migration adds the column and redefines both creation RPCs with an
-- optional p_project_id that is ownership-checked and stamped onto the
-- voucher AND every journal line, so project profit reports capture them.

ALTER TABLE public.voucher_receipts
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects(id);
ALTER TABLE public.voucher_disbursements
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects(id);

CREATE OR REPLACE FUNCTION public.create_voucher_receipt_atomic(
  p_company_id UUID,p_date DATE,p_receipt_type TEXT,p_contact_id UUID,p_amount NUMERIC,
  p_bank_safe_id UUID,p_reason TEXT,p_allocations JSONB,p_auto_fifo BOOLEAN,
  p_request_approval BOOLEAN,p_user_id UUID,
  p_project_id UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_bank banks_safes%ROWTYPE; v_receipt voucher_receipts%ROWTYPE; v_number INTEGER; v_counterpart UUID;
 v_journal JSONB; v_journal_id UUID; v_item JSONB; v_invoice invoices%ROWTYPE; v_alloc NUMERIC;
 v_alloc_total NUMERIC:=0; v_applied NUMERIC:=0; v_remaining NUMERIC; v_new_paid NUMERIC; v_approval approval_requests%ROWTYPE;
BEGIN
 IF p_date IS NULL OR p_receipt_type NOT IN ('client','supplier_refund','general') OR p_amount<=0 OR p_amount<>ROUND(p_amount,2)
  OR NULLIF(BTRIM(p_reason),'') IS NULL OR LENGTH(p_reason)>500 OR jsonb_typeof(p_allocations)<>'array' OR jsonb_array_length(p_allocations)>100 THEN RAISE EXCEPTION 'بيانات سند القبض غير صالحة'; END IF;
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE) THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
 IF p_contact_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM contacts WHERE id=p_contact_id AND company_id=p_company_id) THEN RAISE EXCEPTION 'الطرف غير موجود'; END IF;
 IF p_project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM projects WHERE id=p_project_id AND company_id=p_company_id) THEN RAISE EXCEPTION 'المشروع غير موجود'; END IF;
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
 INSERT INTO voucher_receipts(company_id,number,date,receipt_type,contact_id,amount,bank_safe_id,reason,created_by,status,auto_allocate_fifo,project_id)
 VALUES(p_company_id,v_number,p_date,p_receipt_type,p_contact_id,p_amount,p_bank_safe_id,BTRIM(p_reason),p_user_id,
   CASE WHEN p_request_approval THEN 'pending' ELSE 'approved' END,COALESCE(p_auto_fifo,FALSE),p_project_id) RETURNING * INTO v_receipt;

 IF p_request_approval THEN
  INSERT INTO approval_requests(company_id,transaction_type,transaction_id,entity_type,entity_id,amount,requester_id,status,message,description)
  VALUES(p_company_id,'voucher_receipt',v_receipt.id::TEXT,'voucher_receipt',v_receipt.id,p_amount,p_user_id,'pending',BTRIM(p_reason),BTRIM(p_reason)) RETURNING * INTO v_approval;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_allocations) LOOP
   INSERT INTO receipt_invoice_items(company_id,voucher_receipt_id,invoice_id,amount,journal_entry_id)
   VALUES(p_company_id,v_receipt.id,(v_item->>'invoice_id')::UUID,(v_item->>'amount')::NUMERIC,NULL);
  END LOOP;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'request_approval','voucher_receipt',v_receipt.id,jsonb_build_object('approval_id',v_approval.id,'amount',p_amount));
  RETURN to_jsonb(v_receipt)||jsonb_build_object('requires_approval',TRUE,'approval_id',v_approval.id);
 END IF;

 v_journal:=create_journal_entry(p_company_id,p_date,'general','سند قبض رقم '||v_number||': '||BTRIM(p_reason),p_user_id,jsonb_build_array(
  jsonb_build_object('accountId',v_bank.account_id,'debit',p_amount,'credit',0,'projectId',p_project_id),
  jsonb_build_object('accountId',v_counterpart,'debit',0,'credit',p_amount,'contactId',p_contact_id,'projectId',p_project_id)));
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
 RETURN to_jsonb(v_receipt)||jsonb_build_object('requires_approval',FALSE,'allocated_amount',ROUND(v_applied,2),'unapplied_amount',ROUND(p_amount-v_applied,2));
END;
$$;

CREATE OR REPLACE FUNCTION public.create_voucher_disbursement_atomic(
  p_company_id UUID,p_date DATE,p_disbursement_type TEXT,p_contact_id UUID,p_employee_id UUID,p_amount NUMERIC,
  p_bank_safe_id UUID,p_reason TEXT,p_allocations JSONB,p_request_approval BOOLEAN,p_user_id UUID,
  p_auto_fifo BOOLEAN DEFAULT FALSE,
  p_project_id UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_bank banks_safes%ROWTYPE; v_voucher voucher_disbursements%ROWTYPE; v_number INTEGER; v_counterpart UUID;
 v_journal JSONB; v_journal_id UUID; v_balance NUMERIC; v_item JSONB; v_invoice purchase_invoices%ROWTYPE;
 v_alloc NUMERIC; v_alloc_total NUMERIC:=0; v_applied NUMERIC:=0; v_remaining NUMERIC; v_new_paid NUMERIC; v_approval approval_requests%ROWTYPE;
BEGIN
 IF p_date IS NULL OR p_disbursement_type NOT IN ('supplier','employee_advance','subcontractor','client_refund','other')
  OR p_amount<=0 OR p_amount<>ROUND(p_amount,2) OR NULLIF(BTRIM(p_reason),'') IS NULL OR LENGTH(p_reason)>500
  OR jsonb_typeof(p_allocations)<>'array' OR jsonb_array_length(p_allocations)>100 THEN RAISE EXCEPTION 'بيانات سند الصرف غير صالحة'; END IF;
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE) THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
 IF p_contact_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM contacts WHERE id=p_contact_id AND company_id=p_company_id) THEN RAISE EXCEPTION 'الطرف غير موجود'; END IF;
 IF p_employee_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM employees WHERE id=p_employee_id AND company_id=p_company_id AND is_active=TRUE) THEN RAISE EXCEPTION 'الموظف غير موجود'; END IF;
 IF p_project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM projects WHERE id=p_project_id AND company_id=p_company_id) THEN RAISE EXCEPTION 'المشروع غير موجود'; END IF;
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
 INSERT INTO voucher_disbursements(company_id,number,date,disbursement_type,contact_id,employee_id,amount,bank_safe_id,reason,created_by,status,project_id)
 VALUES(p_company_id,v_number,p_date,p_disbursement_type,p_contact_id,p_employee_id,p_amount,p_bank_safe_id,BTRIM(p_reason),p_user_id,
  CASE WHEN p_request_approval THEN 'pending' ELSE 'approved' END,p_project_id) RETURNING * INTO v_voucher;

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
  jsonb_build_object('accountId',v_counterpart,'debit',p_amount,'credit',0,'contactId',p_contact_id,'projectId',p_project_id),
  jsonb_build_object('accountId',v_bank.account_id,'debit',0,'credit',p_amount,'projectId',p_project_id)));
 v_journal_id:=(v_journal->>'id')::UUID;
 UPDATE journal_entries SET reference_type='voucher_disbursement',reference_id=v_voucher.id WHERE id=v_journal_id AND company_id=p_company_id;
 FOR v_item IN SELECT value FROM jsonb_array_elements(p_allocations) LOOP
  SELECT * INTO v_invoice FROM purchase_invoices WHERE id=(v_item->>'invoice_id')::UUID AND company_id=p_company_id FOR UPDATE;
  v_alloc:=(v_item->>'amount')::NUMERIC; v_new_paid:=ROUND(v_invoice.paid_amount+v_alloc,2);
  UPDATE purchase_invoices SET paid_amount=v_new_paid,status=CASE WHEN v_new_paid>=v_invoice.total-0.005 THEN 'paid' ELSE 'partial' END WHERE id=v_invoice.id;
  INSERT INTO disbursement_invoice_items(company_id,voucher_disbursement_id,purchase_invoice_id,amount,journal_entry_id)
  VALUES(p_company_id,v_voucher.id,v_invoice.id,v_alloc,v_journal_id);
  v_applied:=v_applied+v_alloc;
 END LOOP;

 IF jsonb_array_length(p_allocations)=0 AND COALESCE(p_auto_fifo,FALSE)
    AND p_disbursement_type IN ('supplier','subcontractor') AND p_contact_id IS NOT NULL THEN
  v_remaining:=p_amount;
  FOR v_invoice IN SELECT * FROM purchase_invoices
   WHERE company_id=p_company_id AND supplier_id=p_contact_id AND status NOT IN ('cancelled','paid')
   ORDER BY date,number FOR UPDATE LOOP
   EXIT WHEN v_remaining<=0.005;
   v_alloc:=LEAST(v_remaining,ROUND(v_invoice.total-v_invoice.paid_amount,2)); CONTINUE WHEN v_alloc<=0;
   v_new_paid:=ROUND(v_invoice.paid_amount+v_alloc,2);
   UPDATE purchase_invoices SET paid_amount=v_new_paid,status=CASE WHEN v_new_paid>=v_invoice.total-0.005 THEN 'paid' ELSE 'partial' END WHERE id=v_invoice.id;
   INSERT INTO disbursement_invoice_items(company_id,voucher_disbursement_id,purchase_invoice_id,amount,journal_entry_id)
   VALUES(p_company_id,v_voucher.id,v_invoice.id,v_alloc,v_journal_id);
   v_applied:=v_applied+v_alloc; v_remaining:=v_remaining-v_alloc;
  END LOOP;
 END IF;
 UPDATE voucher_disbursements SET journal_entry_id=v_journal_id WHERE id=v_voucher.id RETURNING * INTO v_voucher;
 INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values) VALUES(p_company_id,p_user_id,'post','voucher_disbursement',v_voucher.id,to_jsonb(v_voucher));
 RETURN to_jsonb(v_voucher)||jsonb_build_object('requires_approval',FALSE,'allocated_amount',ROUND(v_applied,2),'unapplied_amount',ROUND(p_amount-v_applied,2));
END;
$$;

REVOKE ALL ON FUNCTION public.create_voucher_receipt_atomic(UUID,DATE,TEXT,UUID,NUMERIC,UUID,TEXT,JSONB,BOOLEAN,BOOLEAN,UUID,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_voucher_receipt_atomic(UUID,DATE,TEXT,UUID,NUMERIC,UUID,TEXT,JSONB,BOOLEAN,BOOLEAN,UUID,UUID) TO service_role;
REVOKE ALL ON FUNCTION public.create_voucher_disbursement_atomic(UUID,DATE,TEXT,UUID,UUID,NUMERIC,UUID,TEXT,JSONB,BOOLEAN,UUID,BOOLEAN,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_voucher_disbursement_atomic(UUID,DATE,TEXT,UUID,UUID,NUMERIC,UUID,TEXT,JSONB,BOOLEAN,UUID,BOOLEAN,UUID) TO service_role;

-- Drop the pre-083 signatures. Keeping them as overloads makes every
-- positional call ambiguous (42725 "function is not unique"): an 11-argument
-- invocation matches both the old signature and the new one via its DEFAULT.
-- The p_project_id default preserves compatibility for old callers.
DROP FUNCTION IF EXISTS public.create_voucher_receipt_atomic(UUID,DATE,TEXT,UUID,NUMERIC,UUID,TEXT,JSONB,BOOLEAN,BOOLEAN,UUID);
DROP FUNCTION IF EXISTS public.create_voucher_disbursement_atomic(UUID,DATE,TEXT,UUID,UUID,NUMERIC,UUID,TEXT,JSONB,BOOLEAN,UUID,BOOLEAN);
