-- 119: اكتمال سندات القبض/الصرف وحركات النقدية
-- ------------------------------------------------------------
-- الأنواع الناقصة (موظف / مالك / سلفة / قرض / عهدة / راتب) مع الحسابات الصحيحة،
-- حفظ الحساب المقابل على السند، سلفة الموظف في جدول employee_advances،
-- تحويل بين الخزائن، تصنيف التدفق النقدي، وافتراضي المصروف 5400 بدل 5100.
-- ------------------------------------------------------------

ALTER TABLE voucher_receipts
  ADD COLUMN IF NOT EXISTS employee_id UUID REFERENCES employees(id);
ALTER TABLE voucher_receipts
  ADD COLUMN IF NOT EXISTS counterpart_account_id UUID REFERENCES accounts(id);
ALTER TABLE voucher_disbursements
  ADD COLUMN IF NOT EXISTS counterpart_account_id UUID REFERENCES accounts(id);

CREATE INDEX IF NOT EXISTS idx_voucher_receipts_employee ON voucher_receipts(company_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_voucher_receipts_counterpart ON voucher_receipts(counterpart_account_id);
CREATE INDEX IF NOT EXISTS idx_voucher_disbursements_counterpart ON voucher_disbursements(counterpart_account_id);

ALTER TABLE voucher_receipts DROP CONSTRAINT IF EXISTS voucher_receipts_receipt_type_check;
ALTER TABLE voucher_receipts ADD CONSTRAINT voucher_receipts_receipt_type_check CHECK (
  receipt_type IN (
    'client','client_advance','supplier_refund','supplier_advance_return',
    'employee_repayment','owner_capital','loan','general'
  )
);

ALTER TABLE voucher_disbursements DROP CONSTRAINT IF EXISTS voucher_disbursements_disbursement_type_check;
ALTER TABLE voucher_disbursements ADD CONSTRAINT voucher_disbursements_disbursement_type_check CHECK (
  disbursement_type IN (
    'supplier','supplier_advance','subcontractor','client_refund',
    'employee_advance','salary','custody','owner_drawings','loan_repayment','other'
  )
);

CREATE TABLE IF NOT EXISTS receipt_advance_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  voucher_receipt_id UUID NOT NULL REFERENCES voucher_receipts(id),
  employee_advance_id UUID NOT NULL REFERENCES employee_advances(id),
  amount NUMERIC(15,2) NOT NULL,
  journal_entry_id UUID REFERENCES journal_entries(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_receipt_advance_items_receipt
  ON receipt_advance_items(company_id, voucher_receipt_id);
ALTER TABLE receipt_advance_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_receipt_advance_items ON receipt_advance_items;
CREATE POLICY tenant_isolation_receipt_advance_items ON receipt_advance_items
  FOR ALL
  USING (company_id = public.tenant_company_id())
  WITH CHECK (company_id = public.tenant_company_id());

INSERT INTO accounts(company_id, code, name, name_en, type, parent_id, is_active, is_header)
SELECT c.id, x.code, x.name, x.name_en, x.acc_type,
  (SELECT a.id FROM accounts a WHERE a.company_id = c.id AND a.code = x.parent_code LIMIT 1),
  TRUE, FALSE
FROM companies c
CROSS JOIN (VALUES
  ('1190', 'دفعات مقدمة لموردين', 'Advance to Suppliers', 'asset', '1100'),
  ('2130', 'القروض قصيرة الأجل', 'Short-term Loans', 'liability', '2100'),
  ('2180', 'دفعات مقدمة من عملاء', 'Advances from Clients', 'liability', '2100'),
  ('2210', 'القروض طويلة الأجل', 'Long-term Loans', 'liability', '2200'),
  ('3400', 'المسحوبات الشخصية', 'Owner Drawings', 'equity', '3000'),
  ('4200', 'إيرادات أخرى', 'Other Revenue', 'revenue', '4000'),
  ('5400', 'مصروفات إدارية وعمومية', 'General & Admin Expenses', 'expense', '5000')
) AS x(code, name, name_en, acc_type, parent_code)
WHERE NOT EXISTS (
  SELECT 1 FROM accounts a WHERE a.company_id = c.id AND a.code = x.code
);

CREATE OR REPLACE FUNCTION public.resolve_voucher_counterpart(
  p_company_id UUID, p_kind TEXT, p_type TEXT, p_override UUID, p_bank_account UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id UUID; v_code TEXT;
BEGIN
  IF p_override IS NOT NULL THEN
    SELECT id INTO v_id FROM accounts WHERE id=p_override AND company_id=p_company_id
      AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
    IF v_id IS NULL OR v_id=p_bank_account THEN RAISE EXCEPTION 'الحساب المقابل غير صالح'; END IF;
    RETURN v_id;
  END IF;
  v_code := CASE p_kind
    WHEN 'receipt' THEN CASE p_type
      WHEN 'client' THEN '1130'
      WHEN 'client_advance' THEN '2180'
      WHEN 'supplier_refund' THEN '2110'
      WHEN 'supplier_advance_return' THEN '1190'
      WHEN 'employee_repayment' THEN '1160'
      WHEN 'owner_capital' THEN '3100'
      WHEN 'loan' THEN '2130'
      ELSE '4200'
    END
    ELSE CASE p_type
      WHEN 'supplier' THEN '2110'
      WHEN 'supplier_advance' THEN '1190'
      WHEN 'employee_advance' THEN '1160'
      WHEN 'subcontractor' THEN '2150'
      WHEN 'client_refund' THEN '1130'
      WHEN 'owner_drawings' THEN '3400'
      WHEN 'salary' THEN '2140'
      WHEN 'custody' THEN '1150'
      WHEN 'loan_repayment' THEN '2130'
      ELSE '5400'
    END
  END;
  SELECT id INTO v_id FROM accounts WHERE company_id=p_company_id AND code=v_code
    AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
  IF v_id IS NULL OR v_id=p_bank_account THEN RAISE EXCEPTION 'الحساب المقابل غير صالح'; END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_voucher_counterpart(UUID,TEXT,TEXT,UUID,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_voucher_counterpart(UUID,TEXT,TEXT,UUID,UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_employee_repayment_internal(
  p_company_id UUID, p_receipt_id UUID, p_employee_id UUID, p_amount NUMERIC, p_journal_id UUID
) RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_adv employee_advances%ROWTYPE; v_remaining NUMERIC; v_alloc NUMERIC; v_applied NUMERIC:=0;
BEGIN
  IF p_employee_id IS NULL OR p_amount IS NULL OR p_amount<=0.005 THEN RETURN 0; END IF;
  PERFORM set_config('app.hr_write_company', p_company_id::TEXT, TRUE);
  v_remaining:=p_amount;
  FOR v_adv IN
    SELECT * FROM employee_advances
    WHERE company_id=p_company_id AND employee_id=p_employee_id
      AND COALESCE(status,'paid') NOT IN ('cancelled')
      AND remaining_amount>0.005
    ORDER BY date, created_at
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining<=0.005;
    v_alloc:=LEAST(v_remaining, ROUND(v_adv.remaining_amount,2));
    CONTINUE WHEN v_alloc<=0;
    UPDATE employee_advances SET remaining_amount=ROUND(remaining_amount-v_alloc,2)
      WHERE id=v_adv.id;
    INSERT INTO receipt_advance_items(company_id,voucher_receipt_id,employee_advance_id,amount,journal_entry_id)
    VALUES(p_company_id,p_receipt_id,v_adv.id,v_alloc,p_journal_id);
    v_applied:=v_applied+v_alloc; v_remaining:=v_remaining-v_alloc;
  END LOOP;
  RETURN ROUND(v_applied,2);
END;
$$;
REVOKE ALL ON FUNCTION public.apply_employee_repayment_internal(UUID,UUID,UUID,NUMERIC,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_employee_repayment_internal(UUID,UUID,UUID,NUMERIC,UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.insert_employee_advance_from_voucher(
  p_company_id UUID, p_employee_id UUID, p_amount NUMERIC, p_date DATE, p_reason TEXT,
  p_journal_id UUID, p_voucher_id UUID
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF p_employee_id IS NULL OR p_amount IS NULL OR p_amount<=0 THEN RETURN; END IF;
  IF EXISTS(SELECT 1 FROM employee_advances WHERE company_id=p_company_id AND voucher_disbursement_id=p_voucher_id) THEN RETURN; END IF;
  PERFORM set_config('app.hr_write_company', p_company_id::TEXT, TRUE);
  INSERT INTO employee_advances(company_id,employee_id,amount,remaining_amount,date,reason,journal_entry_id,voucher_disbursement_id,status)
  VALUES(p_company_id,p_employee_id,p_amount,p_amount,p_date,NULLIF(BTRIM(p_reason),''),p_journal_id,p_voucher_id,'paid');
END;
$$;
REVOKE ALL ON FUNCTION public.insert_employee_advance_from_voucher(UUID,UUID,NUMERIC,DATE,TEXT,UUID,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_employee_advance_from_voucher(UUID,UUID,NUMERIC,DATE,TEXT,UUID,UUID) TO service_role;

DROP FUNCTION IF EXISTS public.create_voucher_receipt_atomic(UUID,DATE,TEXT,UUID,NUMERIC,UUID,TEXT,JSONB,BOOLEAN,BOOLEAN,UUID,UUID,TEXT,NUMERIC);

CREATE OR REPLACE FUNCTION public.create_voucher_receipt_atomic(
  p_company_id UUID,p_date DATE,p_receipt_type TEXT,p_contact_id UUID,p_amount NUMERIC,
  p_bank_safe_id UUID,p_reason TEXT,p_allocations JSONB,p_auto_fifo BOOLEAN,
  p_request_approval BOOLEAN,p_user_id UUID,
  p_project_id UUID DEFAULT NULL,
  p_currency_code TEXT DEFAULT NULL,p_exchange_rate NUMERIC DEFAULT NULL,
  p_counterpart_account_id UUID DEFAULT NULL,
  p_employee_id UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_bank banks_safes%ROWTYPE; v_receipt voucher_receipts%ROWTYPE; v_number INTEGER; v_counterpart UUID;
 v_journal JSONB; v_journal_id UUID; v_item JSONB; v_invoice invoices%ROWTYPE; v_alloc NUMERIC;
 v_alloc_total NUMERIC:=0; v_applied NUMERIC:=0; v_remaining NUMERIC; v_new_paid NUMERIC; v_approval approval_requests%ROWTYPE;
 v_fx NUMERIC; v_fx_total NUMERIC:=0; v_relief_total NUMERIC:=0; v_relief NUMERIC;
 v_currency_id UUID; v_fx_gain UUID; v_fx_loss UUID; v_lines JSONB; v_net NUMERIC;
BEGIN
 IF p_date IS NULL OR p_receipt_type NOT IN (
      'client','client_advance','supplier_refund','supplier_advance_return',
      'employee_repayment','owner_capital','loan','general')
  OR p_amount<=0 OR p_amount<>ROUND(p_amount,2)
  OR NULLIF(BTRIM(p_reason),'') IS NULL OR LENGTH(p_reason)>500 OR jsonb_typeof(p_allocations)<>'array' OR jsonb_array_length(p_allocations)>100 THEN RAISE EXCEPTION 'بيانات سند القبض غير صالحة'; END IF;
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE) THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
 IF p_receipt_type IN ('client','client_advance','supplier_refund','supplier_advance_return') AND p_contact_id IS NULL THEN RAISE EXCEPTION 'الطرف غير موجود'; END IF;
 IF p_receipt_type='employee_repayment' AND p_employee_id IS NULL THEN RAISE EXCEPTION 'الموظف غير موجود'; END IF;
 IF p_contact_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM contacts WHERE id=p_contact_id AND company_id=p_company_id) THEN RAISE EXCEPTION 'الطرف غير موجود'; END IF;
 IF p_employee_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM employees WHERE id=p_employee_id AND company_id=p_company_id AND is_active=TRUE) THEN RAISE EXCEPTION 'الموظف غير موجود'; END IF;
 IF p_project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM projects WHERE id=p_project_id AND company_id=p_company_id) THEN RAISE EXCEPTION 'المشروع غير موجود'; END IF;
 IF jsonb_array_length(p_allocations)>0 AND p_receipt_type<>'client' THEN RAISE EXCEPTION 'بيانات التخصيص غير صالحة'; END IF;
 SELECT * INTO v_bank FROM banks_safes WHERE id=p_bank_safe_id AND company_id=p_company_id AND is_active=TRUE FOR UPDATE;
 IF NOT FOUND OR v_bank.account_id IS NULL THEN RAISE EXCEPTION 'البنك أو الخزينة غير موجود'; END IF;
 v_counterpart:=resolve_voucher_counterpart(p_company_id,'receipt',p_receipt_type,p_counterpart_account_id,v_bank.account_id);
 IF p_currency_code IS NOT NULL THEN
  SELECT id INTO v_currency_id FROM currencies WHERE company_id=p_company_id AND code=UPPER(BTRIM(p_currency_code));
  IF v_currency_id IS NULL THEN RAISE EXCEPTION 'العملة المحددة غير موجودة لهذه الشركة'; END IF;
  IF p_exchange_rate IS NULL THEN
   SELECT rate INTO p_exchange_rate FROM currencies WHERE id=v_currency_id;
  END IF;
 END IF;
 IF p_exchange_rate IS NOT NULL AND p_exchange_rate<=0 THEN RAISE EXCEPTION 'سعر الصرف غير صالح'; END IF;
 FOR v_item IN SELECT value FROM jsonb_array_elements(p_allocations) LOOP
  BEGIN v_alloc:=(v_item->>'amount')::NUMERIC; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'مبلغ التخصيص غير صالح'; END;
  IF NULLIF(v_item->>'invoice_id','') IS NULL OR v_alloc<=0 OR v_alloc<>ROUND(v_alloc,2) THEN RAISE EXCEPTION 'بيانات التخصيص غير صالحة'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_allocations) x WHERE x->>'invoice_id'=v_item->>'invoice_id' GROUP BY x->>'invoice_id' HAVING COUNT(*)>1) THEN RAISE EXCEPTION 'تخصيص فاتورة مكرر'; END IF;
  SELECT * INTO v_invoice FROM invoices WHERE id=(v_item->>'invoice_id')::UUID AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND OR v_invoice.status IN ('cancelled','paid') OR (p_contact_id IS NOT NULL AND v_invoice.contact_id<>p_contact_id)
  THEN RAISE EXCEPTION 'فاتورة البيع غير صالحة للتخصيص'; END IF;
  v_net:=invoice_net_total(p_company_id,v_invoice.id);
  IF v_invoice.paid_amount+v_alloc>v_net+0.005 THEN RAISE EXCEPTION 'فاتورة البيع غير صالحة للتخصيص'; END IF;
  v_alloc_total:=v_alloc_total+v_alloc;
  v_relief:=v_alloc;
  IF v_invoice.currency_code IS NOT NULL AND p_exchange_rate IS NOT NULL
    AND p_exchange_rate<>COALESCE(v_invoice.exchange_rate,1) THEN
   v_fx:=ROUND(v_alloc*(p_exchange_rate-COALESCE(v_invoice.exchange_rate,1))/p_exchange_rate,2);
   v_relief:=ROUND(v_alloc-v_fx,2);
   v_fx_total:=v_fx_total+v_fx;
  END IF;
  v_relief_total:=v_relief_total+v_relief;
 END LOOP;
 IF v_alloc_total>p_amount+0.005 THEN RAISE EXCEPTION 'مجموع التخصيصات يتجاوز مبلغ السند'; END IF;
 v_number:=next_voucher_number(p_company_id,'voucher_receipts');
 INSERT INTO voucher_receipts(company_id,number,date,receipt_type,contact_id,employee_id,amount,bank_safe_id,reason,created_by,status,auto_allocate_fifo,project_id,currency_code,exchange_rate,counterpart_account_id)
 VALUES(p_company_id,v_number,p_date,p_receipt_type,p_contact_id,p_employee_id,p_amount,p_bank_safe_id,BTRIM(p_reason),p_user_id,
   CASE WHEN p_request_approval THEN 'pending' ELSE 'approved' END,COALESCE(p_auto_fifo,FALSE),p_project_id,
   CASE WHEN v_currency_id IS NOT NULL THEN UPPER(BTRIM(p_currency_code)) END,p_exchange_rate,v_counterpart) RETURNING * INTO v_receipt;

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

 v_lines:=jsonb_build_array(
  jsonb_build_object('accountId',v_bank.account_id,'debit',p_amount,'credit',0,'projectId',p_project_id),
  jsonb_build_object('accountId',v_counterpart,'debit',0,'credit',ROUND((p_amount-v_alloc_total)+v_relief_total,2),'contactId',p_contact_id,'projectId',p_project_id));
 IF v_fx_total>0.005 THEN
  SELECT id INTO v_fx_gain FROM accounts WHERE company_id=p_company_id AND code='4210' AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
  IF v_fx_gain IS NULL THEN RAISE EXCEPTION 'حساب أرباح فروق العملة (4210) غير موجود'; END IF;
  v_lines:=v_lines||jsonb_build_array(jsonb_build_object('accountId',v_fx_gain,'debit',0,'credit',v_fx_total,'description','أرباح فروق عملة محققة'));
 ELSIF v_fx_total<-0.005 THEN
  SELECT id INTO v_fx_loss FROM accounts WHERE company_id=p_company_id AND code='5450' AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
  IF v_fx_loss IS NULL THEN RAISE EXCEPTION 'حساب خسائر فروق العملة (5450) غير موجود'; END IF;
  v_lines:=v_lines||jsonb_build_array(jsonb_build_object('accountId',v_fx_loss,'debit',-v_fx_total,'credit',0,'description','خسائر فروق عملة محققة'));
 END IF;
 v_journal:=create_journal_entry(p_company_id,p_date,'general','سند قبض رقم '||v_number||': '||BTRIM(p_reason),p_user_id,v_lines);
 v_journal_id:=(v_journal->>'id')::UUID;
 UPDATE journal_entries SET reference_type='voucher_receipt',reference_id=v_receipt.id WHERE id=v_journal_id AND company_id=p_company_id;
 IF v_currency_id IS NOT NULL THEN
  UPDATE journal_lines SET currency_id=v_currency_id,exchange_rate=p_exchange_rate,
   amount_in_base_currency=CASE WHEN debit>0 THEN debit ELSE credit END
  WHERE journal_entry_id=v_journal_id AND company_id=p_company_id;
 END IF;
 FOR v_item IN SELECT value FROM jsonb_array_elements(p_allocations) LOOP
  SELECT * INTO v_invoice FROM invoices WHERE id=(v_item->>'invoice_id')::UUID AND company_id=p_company_id FOR UPDATE;
  v_alloc:=(v_item->>'amount')::NUMERIC; v_new_paid:=ROUND(v_invoice.paid_amount+v_alloc,2);
  v_net:=invoice_net_total(p_company_id,v_invoice.id);
  UPDATE invoices SET paid_amount=v_new_paid,status=CASE WHEN v_new_paid>=v_net-0.005 THEN 'paid' ELSE 'partial' END WHERE id=v_invoice.id;
  INSERT INTO receipt_invoice_items(company_id,voucher_receipt_id,invoice_id,amount,journal_entry_id) VALUES(p_company_id,v_receipt.id,v_invoice.id,v_alloc,v_journal_id);
  v_applied:=v_applied+v_alloc;
 END LOOP;
 IF jsonb_array_length(p_allocations)=0 AND p_auto_fifo AND p_receipt_type='client' AND p_contact_id IS NOT NULL THEN
  v_remaining:=p_amount;
  FOR v_invoice IN SELECT * FROM invoices WHERE company_id=p_company_id AND contact_id=p_contact_id AND status NOT IN ('cancelled','paid') ORDER BY date,number FOR UPDATE LOOP
   EXIT WHEN v_remaining<=0.005;
   v_net:=invoice_net_total(p_company_id,v_invoice.id);
   v_alloc:=LEAST(v_remaining,GREATEST(0,ROUND(v_net-v_invoice.paid_amount,2))); CONTINUE WHEN v_alloc<=0;
   v_new_paid:=ROUND(v_invoice.paid_amount+v_alloc,2);
   UPDATE invoices SET paid_amount=v_new_paid,status=CASE WHEN v_new_paid>=v_net-0.005 THEN 'paid' ELSE 'partial' END WHERE id=v_invoice.id;
   INSERT INTO receipt_invoice_items(company_id,voucher_receipt_id,invoice_id,amount,journal_entry_id) VALUES(p_company_id,v_receipt.id,v_invoice.id,v_alloc,v_journal_id);
   v_applied:=v_applied+v_alloc; v_remaining:=v_remaining-v_alloc;
  END LOOP;
 END IF;
 IF p_receipt_type='employee_repayment' THEN
  PERFORM apply_employee_repayment_internal(p_company_id,v_receipt.id,p_employee_id,p_amount,v_journal_id);
 END IF;
 UPDATE voucher_receipts SET journal_entry_id=v_journal_id WHERE id=v_receipt.id RETURNING * INTO v_receipt;
 INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values) VALUES(p_company_id,p_user_id,'post','voucher_receipt',v_receipt.id,to_jsonb(v_receipt));
 RETURN to_jsonb(v_receipt)||jsonb_build_object('requires_approval',FALSE,'allocated_amount',ROUND(v_applied,2),'unapplied_amount',ROUND(p_amount-v_applied,2));
END;
$$;
REVOKE ALL ON FUNCTION public.create_voucher_receipt_atomic(UUID,DATE,TEXT,UUID,NUMERIC,UUID,TEXT,JSONB,BOOLEAN,BOOLEAN,UUID,UUID,TEXT,NUMERIC,UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_voucher_receipt_atomic(UUID,DATE,TEXT,UUID,NUMERIC,UUID,TEXT,JSONB,BOOLEAN,BOOLEAN,UUID,UUID,TEXT,NUMERIC,UUID,UUID) TO service_role;

DROP FUNCTION IF EXISTS public.create_voucher_disbursement_atomic(UUID,DATE,TEXT,UUID,UUID,NUMERIC,UUID,TEXT,JSONB,BOOLEAN,UUID,BOOLEAN,UUID);

CREATE OR REPLACE FUNCTION public.create_voucher_disbursement_atomic(
  p_company_id UUID,p_date DATE,p_disbursement_type TEXT,p_contact_id UUID,p_employee_id UUID,p_amount NUMERIC,
  p_bank_safe_id UUID,p_reason TEXT,p_allocations JSONB,p_request_approval BOOLEAN,p_user_id UUID,
  p_auto_fifo BOOLEAN DEFAULT FALSE,
  p_project_id UUID DEFAULT NULL,
  p_counterpart_account_id UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_bank banks_safes%ROWTYPE; v_voucher voucher_disbursements%ROWTYPE; v_number INTEGER; v_counterpart UUID;
 v_journal JSONB; v_journal_id UUID; v_balance NUMERIC; v_item JSONB; v_invoice purchase_invoices%ROWTYPE;
 v_alloc NUMERIC; v_alloc_total NUMERIC:=0; v_applied NUMERIC:=0; v_remaining NUMERIC; v_new_paid NUMERIC; v_approval approval_requests%ROWTYPE;
 v_net NUMERIC;
BEGIN
 IF p_date IS NULL OR p_disbursement_type NOT IN (
      'supplier','supplier_advance','employee_advance','subcontractor','client_refund',
      'salary','custody','owner_drawings','loan_repayment','other')
  OR p_amount<=0 OR p_amount<>ROUND(p_amount,2) OR NULLIF(BTRIM(p_reason),'') IS NULL OR LENGTH(p_reason)>500
  OR jsonb_typeof(p_allocations)<>'array' OR jsonb_array_length(p_allocations)>100 THEN RAISE EXCEPTION 'بيانات سند الصرف غير صالحة'; END IF;
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE) THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
 IF p_disbursement_type IN ('supplier','supplier_advance','subcontractor','client_refund') AND p_contact_id IS NULL THEN RAISE EXCEPTION 'الطرف غير موجود'; END IF;
 IF p_disbursement_type IN ('employee_advance','salary','custody') AND p_employee_id IS NULL THEN RAISE EXCEPTION 'الموظف غير موجود'; END IF;
 IF p_contact_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM contacts WHERE id=p_contact_id AND company_id=p_company_id) THEN RAISE EXCEPTION 'الطرف غير موجود'; END IF;
 IF p_employee_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM employees WHERE id=p_employee_id AND company_id=p_company_id AND is_active=TRUE) THEN RAISE EXCEPTION 'الموظف غير موجود'; END IF;
 IF p_project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM projects WHERE id=p_project_id AND company_id=p_company_id) THEN RAISE EXCEPTION 'المشروع غير موجود'; END IF;
 IF jsonb_array_length(p_allocations)>0 AND p_disbursement_type NOT IN ('supplier','subcontractor') THEN RAISE EXCEPTION 'بيانات تخصيص الفواتير غير صالحة'; END IF;
 SELECT * INTO v_bank FROM banks_safes WHERE id=p_bank_safe_id AND company_id=p_company_id AND is_active=TRUE FOR UPDATE;
 IF NOT FOUND OR v_bank.account_id IS NULL THEN RAISE EXCEPTION 'البنك أو الخزينة غير موجود'; END IF;
 v_counterpart:=resolve_voucher_counterpart(p_company_id,'disbursement',p_disbursement_type,p_counterpart_account_id,v_bank.account_id);

 FOR v_item IN SELECT value FROM jsonb_array_elements(p_allocations) LOOP
  BEGIN v_alloc:=(v_item->>'amount')::NUMERIC; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'مبلغ التخصيص غير صالح'; END;
  IF NULLIF(v_item->>'invoice_id','') IS NULL OR v_alloc<=0 OR v_alloc<>ROUND(v_alloc,2) THEN RAISE EXCEPTION 'بيانات تخصيص الفواتير غير صالحة'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_allocations) x WHERE x->>'invoice_id'=v_item->>'invoice_id' GROUP BY x->>'invoice_id' HAVING COUNT(*)>1) THEN RAISE EXCEPTION 'تخصيص فاتورة مكرر'; END IF;
  SELECT * INTO v_invoice FROM purchase_invoices WHERE id=(v_item->>'invoice_id')::UUID AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND OR v_invoice.status IN ('cancelled','paid') THEN RAISE EXCEPTION 'فاتورة الشراء غير صالحة للتخصيص'; END IF;
  IF p_contact_id IS NOT NULL AND v_invoice.supplier_id<>p_contact_id THEN RAISE EXCEPTION 'الفاتورة لا تخص الطرف المحدد'; END IF;
  v_net:=ROUND(v_invoice.total-COALESCE(v_invoice.returned_amount,0),2);
  IF v_invoice.paid_amount+v_alloc>v_net+0.005 THEN RAISE EXCEPTION 'التخصيص يتجاوز المتبقي على الفاتورة'; END IF;
  v_alloc_total:=v_alloc_total+v_alloc;
 END LOOP;
 IF v_alloc_total>p_amount+0.005 THEN RAISE EXCEPTION 'مجموع التخصيصات يتجاوز مبلغ السند'; END IF;

 v_number:=next_voucher_number(p_company_id,'voucher_disbursements');
 INSERT INTO voucher_disbursements(company_id,number,date,disbursement_type,contact_id,employee_id,amount,bank_safe_id,reason,created_by,status,project_id,counterpart_account_id)
 VALUES(p_company_id,v_number,p_date,p_disbursement_type,p_contact_id,p_employee_id,p_amount,p_bank_safe_id,BTRIM(p_reason),p_user_id,
  CASE WHEN p_request_approval THEN 'pending' ELSE 'approved' END,p_project_id,v_counterpart) RETURNING * INTO v_voucher;

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
  v_net:=ROUND(v_invoice.total-COALESCE(v_invoice.returned_amount,0),2);
  UPDATE purchase_invoices SET paid_amount=v_new_paid,status=CASE WHEN v_new_paid>=v_net-0.005 THEN 'paid' ELSE 'partial' END WHERE id=v_invoice.id;
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
   v_net:=ROUND(v_invoice.total-COALESCE(v_invoice.returned_amount,0),2);
   v_alloc:=LEAST(v_remaining,ROUND(v_net-v_invoice.paid_amount,2)); CONTINUE WHEN v_alloc<=0;
   v_new_paid:=ROUND(v_invoice.paid_amount+v_alloc,2);
   UPDATE purchase_invoices SET paid_amount=v_new_paid,status=CASE WHEN v_new_paid>=v_net-0.005 THEN 'paid' ELSE 'partial' END WHERE id=v_invoice.id;
   INSERT INTO disbursement_invoice_items(company_id,voucher_disbursement_id,purchase_invoice_id,amount,journal_entry_id)
   VALUES(p_company_id,v_voucher.id,v_invoice.id,v_alloc,v_journal_id);
   v_applied:=v_applied+v_alloc; v_remaining:=v_remaining-v_alloc;
  END LOOP;
 END IF;
 IF p_disbursement_type='employee_advance' THEN
  PERFORM insert_employee_advance_from_voucher(p_company_id,p_employee_id,p_amount,p_date,BTRIM(p_reason),v_journal_id,v_voucher.id);
 END IF;
 UPDATE voucher_disbursements SET journal_entry_id=v_journal_id WHERE id=v_voucher.id RETURNING * INTO v_voucher;
 INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values) VALUES(p_company_id,p_user_id,'post','voucher_disbursement',v_voucher.id,to_jsonb(v_voucher));
 RETURN to_jsonb(v_voucher)||jsonb_build_object('requires_approval',FALSE,'allocated_amount',ROUND(v_applied,2),'unapplied_amount',ROUND(p_amount-v_applied,2));
END;
$$;
REVOKE ALL ON FUNCTION public.create_voucher_disbursement_atomic(UUID,DATE,TEXT,UUID,UUID,NUMERIC,UUID,TEXT,JSONB,BOOLEAN,UUID,BOOLEAN,UUID,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_voucher_disbursement_atomic(UUID,DATE,TEXT,UUID,UUID,NUMERIC,UUID,TEXT,JSONB,BOOLEAN,UUID,BOOLEAN,UUID,UUID) TO service_role;


CREATE OR REPLACE FUNCTION public.respond_voucher_receipt_approval_v49_internal(
 p_company_id UUID,p_approval_id UUID,p_action TEXT,p_approver_user_id UUID,p_approver_chat_id TEXT,p_comments TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_request approval_requests%ROWTYPE; v_receipt voucher_receipts%ROWTYPE; v_bank banks_safes%ROWTYPE; v_counterpart UUID;
 v_journal JSONB; v_journal_id UUID; v_link receipt_invoice_items%ROWTYPE; v_invoice invoices%ROWTYPE;
 v_alloc NUMERIC; v_new_paid NUMERIC; v_remaining NUMERIC; v_actor UUID;
 v_fx NUMERIC; v_fx_total NUMERIC:=0; v_relief_total NUMERIC:=0; v_link_total NUMERIC:=0;
 v_fx_gain UUID; v_fx_loss UUID; v_lines JSONB; v_net NUMERIC;
BEGIN
 IF p_action NOT IN ('approve','reject') OR LENGTH(COALESCE(p_comments,''))>2000 THEN RAISE EXCEPTION 'قرار الاعتماد غير صالح'; END IF;
 SELECT * INTO v_request FROM approval_requests WHERE id=p_approval_id AND company_id=p_company_id FOR UPDATE;
 IF NOT FOUND OR v_request.status<>'pending' OR v_request.transaction_type<>'voucher_receipt' THEN RAISE EXCEPTION 'طلب الاعتماد غير موجود أو تمت معالجته'; END IF;
 IF p_approver_user_id IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_approver_user_id AND company_id=p_company_id AND is_active=TRUE
    AND (role='admin' OR p_approver_user_id=v_request.approver_id)) THEN RAISE EXCEPTION 'المستخدم غير مخول بالاعتماد'; END IF;
  v_actor:=p_approver_user_id;
 ELSIF NULLIF(p_approver_chat_id,'') IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM company_telegram_configs WHERE company_id=p_company_id AND approvals_enabled=TRUE AND chat_id=p_approver_chat_id) THEN RAISE EXCEPTION 'حساب تيليجرام غير مخول'; END IF;
  v_actor:=v_request.requester_id;
 ELSE RAISE EXCEPTION 'هوية المعتمد مطلوبة'; END IF;
 SELECT * INTO v_receipt FROM voucher_receipts WHERE id=COALESCE(v_request.entity_id,v_request.transaction_id::UUID) AND company_id=p_company_id FOR UPDATE;
 IF NOT FOUND OR v_receipt.status<>'pending' OR v_receipt.journal_entry_id IS NOT NULL THEN RAISE EXCEPTION 'سند القبض ليس معلقاً'; END IF;
 IF p_action='reject' THEN
  UPDATE voucher_receipts SET status='rejected' WHERE id=v_receipt.id;
  UPDATE approval_requests SET status='rejected',approved_by=p_approver_user_id,approver_chat_id=p_approver_chat_id,approved_at=NOW(),approval_comments=NULLIF(BTRIM(p_comments),''),updated_at=NOW() WHERE id=p_approval_id;
  INSERT INTO notifications(company_id,user_id,type,title,message,entity_type,entity_id) VALUES(p_company_id,v_request.requester_id,'warning','تم رفض طلبك','سند قبض - تم الرفض','approval_request',p_approval_id);
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values) VALUES(p_company_id,v_actor,'reject_approval','approval_request',p_approval_id,jsonb_build_object('voucher_id',v_receipt.id,'chat_id',p_approver_chat_id));
  RETURN jsonb_build_object('status','rejected','voucher_id',v_receipt.id,'requester_id',v_request.requester_id);
 END IF;
 SELECT * INTO v_bank FROM banks_safes WHERE id=v_receipt.bank_safe_id AND company_id=p_company_id AND is_active=TRUE FOR UPDATE;
 IF NOT FOUND OR v_bank.account_id IS NULL THEN RAISE EXCEPTION 'البنك أو الخزينة غير صالح'; END IF;
 v_counterpart:=resolve_voucher_counterpart(p_company_id,'receipt',v_receipt.receipt_type,v_receipt.counterpart_account_id,v_bank.account_id);
 FOR v_link IN SELECT * FROM receipt_invoice_items WHERE company_id=p_company_id AND voucher_receipt_id=v_receipt.id FOR UPDATE LOOP
  SELECT * INTO v_invoice FROM invoices WHERE id=v_link.invoice_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND OR v_invoice.status IN ('cancelled','paid') OR (v_receipt.contact_id IS NOT NULL AND v_invoice.contact_id<>v_receipt.contact_id)
    OR v_invoice.paid_amount+v_link.amount>invoice_net_total(p_company_id,v_invoice.id)+0.005 THEN RAISE EXCEPTION 'تعذر تطبيق تخصيص فاتورة البيع'; END IF;
  v_link_total:=v_link_total+v_link.amount;
  IF v_invoice.currency_code IS NOT NULL AND v_receipt.exchange_rate IS NOT NULL
    AND v_receipt.exchange_rate<>COALESCE(v_invoice.exchange_rate,1) THEN
   v_fx:=ROUND(v_link.amount*(v_receipt.exchange_rate-COALESCE(v_invoice.exchange_rate,1))/v_receipt.exchange_rate,2);
   v_fx_total:=v_fx_total+v_fx;
   v_relief_total:=v_relief_total+v_link.amount-v_fx;
  ELSE
   v_relief_total:=v_relief_total+v_link.amount;
  END IF;
 END LOOP;
 v_lines:=jsonb_build_array(
  jsonb_build_object('accountId',v_bank.account_id,'debit',v_receipt.amount,'credit',0,'projectId',v_receipt.project_id),
  jsonb_build_object('accountId',v_counterpart,'debit',0,'credit',ROUND((v_receipt.amount-v_link_total)+v_relief_total,2),'contactId',v_receipt.contact_id,'projectId',v_receipt.project_id));
 IF v_fx_total>0.005 THEN
  SELECT id INTO v_fx_gain FROM accounts WHERE company_id=p_company_id AND code='4210' AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
  IF v_fx_gain IS NULL THEN RAISE EXCEPTION 'حساب أرباح فروق العملة (4210) غير موجود'; END IF;
  v_lines:=v_lines||jsonb_build_array(jsonb_build_object('accountId',v_fx_gain,'debit',0,'credit',v_fx_total,'description','أرباح فروق عملة محققة'));
 ELSIF v_fx_total<-0.005 THEN
  SELECT id INTO v_fx_loss FROM accounts WHERE company_id=p_company_id AND code='5450' AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
  IF v_fx_loss IS NULL THEN RAISE EXCEPTION 'حساب خسائر فروق العملة (5450) غير موجود'; END IF;
  v_lines:=v_lines||jsonb_build_array(jsonb_build_object('accountId',v_fx_loss,'debit',-v_fx_total,'credit',0,'description','خسائر فروق عملة محققة'));
 END IF;
 v_journal:=create_journal_entry(p_company_id,v_receipt.date,'general','سند قبض رقم '||v_receipt.number||': '||v_receipt.reason,v_request.requester_id,v_lines);
 v_journal_id:=(v_journal->>'id')::UUID;
 UPDATE journal_entries SET reference_type='voucher_receipt',reference_id=v_receipt.id WHERE id=v_journal_id AND company_id=p_company_id;
 FOR v_link IN SELECT * FROM receipt_invoice_items WHERE company_id=p_company_id AND voucher_receipt_id=v_receipt.id FOR UPDATE LOOP
  SELECT * INTO v_invoice FROM invoices WHERE id=v_link.invoice_id AND company_id=p_company_id FOR UPDATE;
  v_new_paid:=ROUND(v_invoice.paid_amount+v_link.amount,2);
  v_net:=invoice_net_total(p_company_id,v_invoice.id);
  UPDATE invoices SET paid_amount=v_new_paid,status=CASE WHEN v_new_paid>=v_net-0.005 THEN 'paid' ELSE 'partial' END WHERE id=v_invoice.id;
  UPDATE receipt_invoice_items SET journal_entry_id=v_journal_id WHERE id=v_link.id;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM receipt_invoice_items WHERE company_id=p_company_id AND voucher_receipt_id=v_receipt.id)
   AND v_receipt.auto_allocate_fifo AND v_receipt.receipt_type='client' AND v_receipt.contact_id IS NOT NULL THEN
  v_remaining:=v_receipt.amount;
  FOR v_invoice IN SELECT * FROM invoices WHERE company_id=p_company_id AND contact_id=v_receipt.contact_id AND status NOT IN ('cancelled','paid') ORDER BY date,number FOR UPDATE LOOP
   EXIT WHEN v_remaining<=0.005;
   v_net:=invoice_net_total(p_company_id,v_invoice.id);
   v_alloc:=LEAST(v_remaining,GREATEST(0,ROUND(v_net-v_invoice.paid_amount,2))); CONTINUE WHEN v_alloc<=0;
   v_new_paid:=ROUND(v_invoice.paid_amount+v_alloc,2);
   UPDATE invoices SET paid_amount=v_new_paid,status=CASE WHEN v_new_paid>=v_net-0.005 THEN 'paid' ELSE 'partial' END WHERE id=v_invoice.id;
   INSERT INTO receipt_invoice_items(company_id,voucher_receipt_id,invoice_id,amount,journal_entry_id) VALUES(p_company_id,v_receipt.id,v_invoice.id,v_alloc,v_journal_id);
   v_remaining:=v_remaining-v_alloc;
  END LOOP;
 END IF;
 IF v_receipt.receipt_type='employee_repayment' THEN
  PERFORM apply_employee_repayment_internal(p_company_id,v_receipt.id,v_receipt.employee_id,v_receipt.amount,v_journal_id);
 END IF;
 UPDATE voucher_receipts SET status='approved',journal_entry_id=v_journal_id,counterpart_account_id=COALESCE(counterpart_account_id,v_counterpart) WHERE id=v_receipt.id RETURNING * INTO v_receipt;
 UPDATE approval_requests SET status='approved',approved_by=p_approver_user_id,approver_chat_id=p_approver_chat_id,approved_at=NOW(),approval_comments=NULLIF(BTRIM(p_comments),''),updated_at=NOW() WHERE id=p_approval_id;
 INSERT INTO notifications(company_id,user_id,type,title,message,entity_type,entity_id) VALUES(p_company_id,v_request.requester_id,'success','تم اعتماد طلبك','سند قبض - تم الاعتماد بنجاح','approval_request',p_approval_id);
 INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values) VALUES(p_company_id,v_actor,'approve_approval','approval_request',p_approval_id,jsonb_build_object('voucher_id',v_receipt.id,'journal_entry_id',v_journal_id,'chat_id',p_approver_chat_id));
 RETURN jsonb_build_object('status','approved','voucher_id',v_receipt.id,'journal_entry_id',v_journal_id,'requester_id',v_request.requester_id);
END;
$$;
REVOKE ALL ON FUNCTION public.respond_voucher_receipt_approval_v49_internal(UUID,UUID,TEXT,UUID,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.respond_voucher_receipt_approval_v49_internal(UUID,UUID,TEXT,UUID,TEXT,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.respond_voucher_disbursement_approval_v49_internal(
 p_company_id UUID,p_approval_id UUID,p_action TEXT,p_approver_user_id UUID,p_approver_chat_id TEXT,p_comments TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_request approval_requests%ROWTYPE; v_voucher voucher_disbursements%ROWTYPE; v_bank banks_safes%ROWTYPE;
 v_counterpart UUID; v_balance NUMERIC; v_journal JSONB; v_journal_id UUID; v_link disbursement_invoice_items%ROWTYPE;
 v_invoice purchase_invoices%ROWTYPE; v_new_paid NUMERIC; v_actor UUID; v_net NUMERIC;
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
 v_counterpart:=resolve_voucher_counterpart(p_company_id,'disbursement',v_voucher.disbursement_type,v_voucher.counterpart_account_id,v_bank.account_id);
 v_journal:=create_journal_entry(p_company_id,v_voucher.date,'general','اعتماد سند صرف رقم '||v_voucher.number||': '||v_voucher.reason,v_request.requester_id,jsonb_build_array(
  jsonb_build_object('accountId',v_counterpart,'debit',v_voucher.amount,'credit',0,'contactId',v_voucher.contact_id,'projectId',v_voucher.project_id),
  jsonb_build_object('accountId',v_bank.account_id,'debit',0,'credit',v_voucher.amount,'projectId',v_voucher.project_id)));
 v_journal_id:=(v_journal->>'id')::UUID;
 UPDATE journal_entries SET reference_type='voucher_disbursement',reference_id=v_voucher.id WHERE id=v_journal_id AND company_id=p_company_id;
 FOR v_link IN SELECT * FROM disbursement_invoice_items WHERE company_id=p_company_id AND voucher_disbursement_id=v_voucher.id FOR UPDATE LOOP
  SELECT * INTO v_invoice FROM purchase_invoices WHERE id=v_link.purchase_invoice_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND OR v_invoice.status='cancelled' OR (v_voucher.contact_id IS NOT NULL AND v_invoice.supplier_id<>v_voucher.contact_id)
  THEN RAISE EXCEPTION 'تعذر تطبيق تخصيص فاتورة الشراء'; END IF;
  v_net:=ROUND(v_invoice.total-COALESCE(v_invoice.returned_amount,0),2);
  IF v_invoice.paid_amount+v_link.amount>v_net+0.005 THEN RAISE EXCEPTION 'تعذر تطبيق تخصيص فاتورة الشراء'; END IF;
  v_new_paid:=ROUND(v_invoice.paid_amount+v_link.amount,2);
  UPDATE purchase_invoices SET paid_amount=v_new_paid,status=CASE WHEN v_new_paid>=v_net-0.005 THEN 'paid' ELSE 'partial' END WHERE id=v_invoice.id;
  UPDATE disbursement_invoice_items SET journal_entry_id=v_journal_id WHERE id=v_link.id;
 END LOOP;
 IF v_voucher.disbursement_type='employee_advance' THEN
  PERFORM insert_employee_advance_from_voucher(p_company_id,v_voucher.employee_id,v_voucher.amount,v_voucher.date,v_voucher.reason,v_journal_id,v_voucher.id);
 END IF;
 UPDATE voucher_disbursements SET status='approved',journal_entry_id=v_journal_id,counterpart_account_id=COALESCE(counterpart_account_id,v_counterpart) WHERE id=v_voucher.id RETURNING * INTO v_voucher;
 UPDATE approval_requests SET status='approved',approved_by=p_approver_user_id,approver_chat_id=p_approver_chat_id,approved_at=NOW(),
  approval_comments=NULLIF(BTRIM(p_comments),''),updated_at=NOW() WHERE id=p_approval_id;
 INSERT INTO notifications(company_id,user_id,type,title,message,entity_type,entity_id)
 VALUES(p_company_id,v_request.requester_id,'success','تم اعتماد طلبك','سند صرف - تم الاعتماد بنجاح','approval_request',p_approval_id);
 INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values) VALUES(p_company_id,v_actor,'approve_approval','approval_request',p_approval_id,jsonb_build_object('voucher_id',v_voucher.id,'journal_entry_id',v_journal_id,'chat_id',p_approver_chat_id));
 RETURN jsonb_build_object('status','approved','voucher_id',v_voucher.id,'journal_entry_id',v_journal_id,'requester_id',v_request.requester_id);
END;
$$;
REVOKE ALL ON FUNCTION public.respond_voucher_disbursement_approval_v49_internal(UUID,UUID,TEXT,UUID,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.respond_voucher_disbursement_approval_v49_internal(UUID,UUID,TEXT,UUID,TEXT,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.update_voucher_receipt_atomic(
  p_company_id UUID,p_voucher_id UUID,p_date DATE,p_contact_id UUID,p_contact_set BOOLEAN,
  p_amount NUMERIC,p_bank_safe_id UUID,p_reason TEXT,p_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old voucher_receipts%ROWTYPE; v_voucher voucher_receipts%ROWTYPE; v_bank banks_safes%ROWTYPE;
  v_contact UUID; v_amount NUMERIC; v_counterpart UUID; v_reversal UUID; v_journal JSONB; v_journal_id UUID;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  SELECT * INTO v_old FROM voucher_receipts WHERE id=p_voucher_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'السند غير موجود'; END IF;
  IF v_old.status<>'approved' OR v_old.journal_entry_id IS NULL THEN RAISE EXCEPTION 'لا يمكن تعديل سند غير مرحل'; END IF;
  IF EXISTS(SELECT 1 FROM cash_transactions WHERE company_id=p_company_id AND voucher_receipt_id=p_voucher_id)
  THEN RAISE EXCEPTION 'السند مرتبط بحركة نقدية'; END IF;
  IF EXISTS(SELECT 1 FROM receipt_invoice_items WHERE company_id=p_company_id AND voucher_receipt_id=p_voucher_id)
    OR EXISTS(SELECT 1 FROM receipt_advance_items WHERE company_id=p_company_id AND voucher_receipt_id=p_voucher_id)
  THEN RAISE EXCEPTION 'لا يمكن تعديل سند مخصص على فواتير'; END IF;
  v_contact:=CASE WHEN p_contact_set THEN p_contact_id ELSE v_old.contact_id END;
  v_amount:=COALESCE(p_amount,v_old.amount);
  IF v_amount<=0 OR v_amount<>round(v_amount,2) OR length(COALESCE(p_reason,v_old.reason,''))>500
  THEN RAISE EXCEPTION 'بيانات السند غير صالحة'; END IF;
  IF v_contact IS NOT NULL AND NOT EXISTS(SELECT 1 FROM contacts WHERE id=v_contact AND company_id=p_company_id)
  THEN RAISE EXCEPTION 'الطرف غير موجود'; END IF;
  SELECT * INTO v_bank FROM banks_safes
  WHERE id=COALESCE(p_bank_safe_id,v_old.bank_safe_id) AND company_id=p_company_id AND is_active=TRUE FOR UPDATE;
  IF NOT FOUND OR v_bank.account_id IS NULL THEN RAISE EXCEPTION 'البنك أو الخزينة غير صالح'; END IF;
  v_counterpart:=resolve_voucher_counterpart(p_company_id,'receipt',v_old.receipt_type,v_old.counterpart_account_id,v_bank.account_id);
  v_reversal:=post_journal_reversal(p_company_id,v_old.journal_entry_id,'voucher_receipt_reversal',p_voucher_id,
    'عكس سند قبض رقم '||v_old.number||' (تعديل)',p_user_id);
  v_journal:=create_journal_entry(
    p_company_id,COALESCE(p_date,v_old.date),'general','سند قبض رقم '||v_old.number||': '||COALESCE(NULLIF(btrim(p_reason),''),v_old.reason),p_user_id,
    jsonb_build_array(
      jsonb_build_object('accountId',v_bank.account_id,'debit',v_amount,'credit',0,'projectId',v_old.project_id),
      jsonb_build_object('accountId',v_counterpart,'debit',0,'credit',v_amount,'contactId',v_contact,'projectId',v_old.project_id)
    )
  );
  v_journal_id:=(v_journal->>'id')::UUID;
  UPDATE journal_entries SET reference_type='voucher_receipt',reference_id=p_voucher_id WHERE id=v_journal_id AND company_id=p_company_id;
  UPDATE voucher_receipts SET date=COALESCE(p_date,v_old.date),contact_id=v_contact,amount=v_amount,
    bank_safe_id=v_bank.id,reason=COALESCE(NULLIF(btrim(p_reason),''),v_old.reason),journal_entry_id=v_journal_id,
    counterpart_account_id=v_counterpart,updated_at=now()
  WHERE id=p_voucher_id RETURNING * INTO v_voucher;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'update','voucher_receipt',p_voucher_id,to_jsonb(v_old),
    to_jsonb(v_voucher)||jsonb_build_object('reversal_journal_id',v_reversal));
  RETURN to_jsonb(v_voucher);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_voucher_disbursement_atomic(
  p_company_id UUID,p_voucher_id UUID,p_date DATE,p_contact_id UUID,p_contact_set BOOLEAN,
  p_employee_id UUID,p_employee_set BOOLEAN,p_amount NUMERIC,p_bank_safe_id UUID,p_reason TEXT,p_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old voucher_disbursements%ROWTYPE; v_voucher voucher_disbursements%ROWTYPE; v_bank banks_safes%ROWTYPE;
  v_contact UUID; v_employee UUID; v_amount NUMERIC; v_counterpart UUID; v_reversal UUID;
  v_journal JSONB; v_journal_id UUID; v_balance NUMERIC;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  SELECT * INTO v_old FROM voucher_disbursements WHERE id=p_voucher_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'السند غير موجود'; END IF;
  IF v_old.status<>'approved' OR v_old.journal_entry_id IS NULL THEN RAISE EXCEPTION 'لا يمكن تعديل سند غير مرحل'; END IF;
  IF EXISTS(SELECT 1 FROM cash_transactions WHERE company_id=p_company_id AND voucher_disbursement_id=p_voucher_id)
  THEN RAISE EXCEPTION 'السند مرتبط بحركة نقدية'; END IF;
  IF EXISTS(SELECT 1 FROM disbursement_invoice_items WHERE company_id=p_company_id AND voucher_disbursement_id=p_voucher_id)
    OR EXISTS(SELECT 1 FROM employee_advances WHERE company_id=p_company_id AND voucher_disbursement_id=p_voucher_id)
  THEN RAISE EXCEPTION 'لا يمكن تعديل سند مخصص على فواتير'; END IF;
  v_contact:=CASE WHEN p_contact_set THEN p_contact_id ELSE v_old.contact_id END;
  v_employee:=CASE WHEN p_employee_set THEN p_employee_id ELSE v_old.employee_id END;
  v_amount:=COALESCE(p_amount,v_old.amount);
  IF v_amount<=0 OR v_amount<>round(v_amount,2) OR length(COALESCE(p_reason,v_old.reason,''))>500
  THEN RAISE EXCEPTION 'بيانات السند غير صالحة'; END IF;
  IF v_contact IS NOT NULL AND NOT EXISTS(SELECT 1 FROM contacts WHERE id=v_contact AND company_id=p_company_id)
  THEN RAISE EXCEPTION 'الطرف غير موجود'; END IF;
  IF v_employee IS NOT NULL AND NOT EXISTS(SELECT 1 FROM employees WHERE id=v_employee AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'الموظف غير موجود'; END IF;
  SELECT * INTO v_bank FROM banks_safes
  WHERE id=COALESCE(p_bank_safe_id,v_old.bank_safe_id) AND company_id=p_company_id AND is_active=TRUE FOR UPDATE;
  IF NOT FOUND OR v_bank.account_id IS NULL THEN RAISE EXCEPTION 'البنك أو الخزينة غير صالح'; END IF;
  v_counterpart:=resolve_voucher_counterpart(p_company_id,'disbursement',v_old.disbursement_type,v_old.counterpart_account_id,v_bank.account_id);
  v_reversal:=post_journal_reversal(p_company_id,v_old.journal_entry_id,'voucher_disbursement_reversal',p_voucher_id,
    'عكس سند صرف رقم '||v_old.number||' (تعديل)',p_user_id);
  v_balance:=get_account_balance(p_company_id,v_bank.account_id,NULL,NULL);
  IF v_balance+0.005<v_amount THEN RAISE EXCEPTION 'الرصيد غير كاف للصرف'; END IF;
  v_journal:=create_journal_entry(
    p_company_id,COALESCE(p_date,v_old.date),'general','سند صرف رقم '||v_old.number||': '||COALESCE(NULLIF(btrim(p_reason),''),v_old.reason),p_user_id,
    jsonb_build_array(
      jsonb_build_object('accountId',v_counterpart,'debit',v_amount,'credit',0,'contactId',v_contact,'projectId',v_old.project_id),
      jsonb_build_object('accountId',v_bank.account_id,'debit',0,'credit',v_amount,'projectId',v_old.project_id)
    )
  );
  v_journal_id:=(v_journal->>'id')::UUID;
  UPDATE journal_entries SET reference_type='voucher_disbursement',reference_id=p_voucher_id WHERE id=v_journal_id AND company_id=p_company_id;
  UPDATE voucher_disbursements SET date=COALESCE(p_date,v_old.date),contact_id=v_contact,employee_id=v_employee,
    amount=v_amount,bank_safe_id=v_bank.id,reason=COALESCE(NULLIF(btrim(p_reason),''),v_old.reason),journal_entry_id=v_journal_id,
    counterpart_account_id=v_counterpart,updated_at=now()
  WHERE id=p_voucher_id RETURNING * INTO v_voucher;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'update','voucher_disbursement',p_voucher_id,to_jsonb(v_old),
    to_jsonb(v_voucher)||jsonb_build_object('reversal_journal_id',v_reversal));
  RETURN to_jsonb(v_voucher);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_voucher_receipt_atomic(
  p_company_id UUID,p_voucher_id UUID,p_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old voucher_receipts%ROWTYPE; v_voucher voucher_receipts%ROWTYPE; v_link receipt_invoice_items%ROWTYPE;
  v_invoice invoices%ROWTYPE; v_new_paid NUMERIC; v_reversal UUID; v_adv_link receipt_advance_items%ROWTYPE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  SELECT * INTO v_old FROM voucher_receipts WHERE id=p_voucher_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'السند غير موجود'; END IF;
  IF v_old.status='cancelled' THEN RETURN jsonb_build_object('id',p_voucher_id,'status','cancelled','already_processed',TRUE); END IF;
  IF EXISTS(SELECT 1 FROM cash_transactions WHERE company_id=p_company_id AND voucher_receipt_id=p_voucher_id)
  THEN RAISE EXCEPTION 'السند مرتبط بحركة نقدية'; END IF;
  IF v_old.status='pending' THEN
    UPDATE approval_requests SET status='cancelled',updated_at=now()
    WHERE company_id=p_company_id AND transaction_type='voucher_receipt' AND transaction_id=p_voucher_id::TEXT AND status='pending';
  ELSE
    IF v_old.journal_entry_id IS NULL THEN RAISE EXCEPTION 'السند المرحل بلا قيد'; END IF;
    FOR v_link IN SELECT * FROM receipt_invoice_items
      WHERE company_id=p_company_id AND voucher_receipt_id=p_voucher_id ORDER BY id FOR UPDATE LOOP
      SELECT * INTO v_invoice FROM invoices WHERE id=v_link.invoice_id AND company_id=p_company_id FOR UPDATE;
      IF NOT FOUND OR v_invoice.paid_amount+0.005<v_link.amount THEN RAISE EXCEPTION 'تعذر عكس تخصيص الفاتورة'; END IF;
      v_new_paid:=round(GREATEST(0,v_invoice.paid_amount-v_link.amount),2);
      UPDATE invoices SET paid_amount=v_new_paid,status=CASE WHEN v_new_paid<=0.005 THEN 'unpaid'
        WHEN v_new_paid>=invoice_net_total(p_company_id,v_invoice.id)-0.005 THEN 'paid' ELSE 'partial' END WHERE id=v_invoice.id;
    END LOOP;
    PERFORM set_config('app.hr_write_company', p_company_id::TEXT, TRUE);
    FOR v_adv_link IN SELECT * FROM receipt_advance_items
      WHERE company_id=p_company_id AND voucher_receipt_id=p_voucher_id ORDER BY id FOR UPDATE LOOP
      UPDATE employee_advances SET remaining_amount=ROUND(remaining_amount+v_adv_link.amount,2),
        status=CASE WHEN COALESCE(status,'paid')='cancelled' THEN status ELSE 'paid' END
      WHERE id=v_adv_link.employee_advance_id AND company_id=p_company_id;
    END LOOP;
    v_reversal:=post_journal_reversal(p_company_id,v_old.journal_entry_id,'voucher_receipt_reversal',p_voucher_id,
      'عكس سند قبض رقم '||v_old.number||' (إلغاء)',p_user_id);
  END IF;
  UPDATE voucher_receipts SET status='cancelled',updated_at=now() WHERE id=p_voucher_id RETURNING * INTO v_voucher;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'cancel','voucher_receipt',p_voucher_id,to_jsonb(v_old),
    to_jsonb(v_voucher)||jsonb_build_object('reversal_journal_id',v_reversal));
  RETURN to_jsonb(v_voucher)||jsonb_build_object('reversal_journal_id',v_reversal);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_voucher_disbursement_atomic(
  p_company_id UUID,p_voucher_id UUID,p_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old voucher_disbursements%ROWTYPE; v_voucher voucher_disbursements%ROWTYPE;
  v_link disbursement_invoice_items%ROWTYPE; v_invoice purchase_invoices%ROWTYPE;
  v_new_paid NUMERIC; v_reversal UUID; v_net NUMERIC;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  SELECT * INTO v_old FROM voucher_disbursements WHERE id=p_voucher_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'السند غير موجود'; END IF;
  IF v_old.status='cancelled' THEN RETURN jsonb_build_object('id',p_voucher_id,'status','cancelled','already_processed',TRUE); END IF;
  IF EXISTS(SELECT 1 FROM cash_transactions WHERE company_id=p_company_id AND voucher_disbursement_id=p_voucher_id)
  THEN RAISE EXCEPTION 'السند مرتبط بحركة نقدية'; END IF;
  IF v_old.status='pending' THEN
    UPDATE approval_requests SET status='cancelled',updated_at=now()
    WHERE company_id=p_company_id AND transaction_type='voucher_disbursement' AND transaction_id=p_voucher_id::TEXT AND status='pending';
  ELSE
    IF v_old.journal_entry_id IS NULL THEN RAISE EXCEPTION 'السند المرحل بلا قيد'; END IF;
    PERFORM set_config('app.hr_write_company', p_company_id::TEXT, TRUE);
    IF EXISTS (
      SELECT 1 FROM employee_advances ea
      WHERE ea.company_id = p_company_id
        AND (ea.journal_entry_id = v_old.journal_entry_id OR ea.voucher_disbursement_id = p_voucher_id)
        AND COALESCE(ea.status,'paid') <> 'cancelled'
        AND ea.remaining_amount < ea.amount - 0.005
    ) THEN RAISE EXCEPTION 'لا يمكن إلغاء سلفة الموظف بعد تسديد جزء منها'; END IF;
    FOR v_link IN SELECT * FROM disbursement_invoice_items
      WHERE company_id=p_company_id AND voucher_disbursement_id=p_voucher_id ORDER BY id FOR UPDATE LOOP
      SELECT * INTO v_invoice FROM purchase_invoices WHERE id=v_link.purchase_invoice_id AND company_id=p_company_id FOR UPDATE;
      IF NOT FOUND OR v_invoice.paid_amount+0.005<v_link.amount THEN RAISE EXCEPTION 'تعذر عكس تخصيص فاتورة الشراء'; END IF;
      v_new_paid:=round(GREATEST(0,v_invoice.paid_amount-v_link.amount),2);
      v_net:=ROUND(v_invoice.total-COALESCE(v_invoice.returned_amount,0),2);
      UPDATE purchase_invoices SET paid_amount=v_new_paid,status=CASE WHEN v_new_paid<=0.005 THEN 'unpaid'
        WHEN v_new_paid>=v_net-0.005 THEN 'paid' ELSE 'partial' END WHERE id=v_invoice.id;
    END LOOP;
    v_reversal:=post_journal_reversal(p_company_id,v_old.journal_entry_id,'voucher_disbursement_reversal',p_voucher_id,
      'عكس سند صرف رقم '||v_old.number||' (إلغاء)',p_user_id);
    UPDATE employee_advances SET status='cancelled', remaining_amount=0
    WHERE company_id=p_company_id AND (journal_entry_id=v_old.journal_entry_id OR voucher_disbursement_id=p_voucher_id);
  END IF;
  UPDATE voucher_disbursements SET status='cancelled',updated_at=now() WHERE id=p_voucher_id RETURNING * INTO v_voucher;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'cancel','voucher_disbursement',p_voucher_id,to_jsonb(v_old),
    to_jsonb(v_voucher)||jsonb_build_object('reversal_journal_id',v_reversal));
  RETURN to_jsonb(v_voucher)||jsonb_build_object('reversal_journal_id',v_reversal);
END;
$$;

REVOKE ALL ON FUNCTION public.update_voucher_receipt_atomic(UUID,UUID,DATE,UUID,BOOLEAN,NUMERIC,UUID,TEXT,UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_voucher_disbursement_atomic(UUID,UUID,DATE,UUID,BOOLEAN,UUID,BOOLEAN,NUMERIC,UUID,TEXT,UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_voucher_receipt_atomic(UUID,UUID,UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_voucher_disbursement_atomic(UUID,UUID,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_voucher_receipt_atomic(UUID,UUID,DATE,UUID,BOOLEAN,NUMERIC,UUID,TEXT,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_voucher_disbursement_atomic(UUID,UUID,DATE,UUID,BOOLEAN,UUID,BOOLEAN,NUMERIC,UUID,TEXT,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_voucher_receipt_atomic(UUID,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_voucher_disbursement_atomic(UUID,UUID,UUID) TO service_role;


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
      AND code=CASE WHEN p_type='revenue' THEN '4100' ELSE '5400' END
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
REVOKE ALL ON FUNCTION public.post_cash_transaction(UUID,DATE,TEXT,NUMERIC,UUID,UUID,UUID,UUID,UUID,TEXT,TEXT,NUMERIC,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_cash_transaction(UUID,DATE,TEXT,NUMERIC,UUID,UUID,UUID,UUID,UUID,TEXT,TEXT,NUMERIC,UUID) TO service_role;

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
   (SELECT id FROM accounts WHERE company_id=p_company_id AND code=CASE WHEN p_type='deposit' THEN '1120' ELSE '5400' END LIMIT 1))
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
REVOKE ALL ON FUNCTION public.post_petty_cash_transaction(UUID,UUID,TEXT,NUMERIC,TEXT,TEXT,UUID,TEXT,TEXT,DATE,UUID,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_petty_cash_transaction(UUID,UUID,TEXT,NUMERIC,TEXT,TEXT,UUID,TEXT,TEXT,DATE,UUID,UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.transfer_between_safes_atomic(
  p_company_id UUID, p_from_id UUID, p_to_id UUID, p_amount NUMERIC,
  p_date DATE, p_reason TEXT, p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_from banks_safes%ROWTYPE; v_to banks_safes%ROWTYPE; v_first UUID; v_second UUID;
  v_balance NUMERIC; v_journal JSONB; v_journal_id UUID;
BEGIN
  IF p_date IS NULL OR p_amount IS NULL OR p_amount<=0 OR p_amount<>ROUND(p_amount,2)
    OR NULLIF(BTRIM(p_reason),'') IS NULL OR LENGTH(p_reason)>500
    OR p_from_id IS NULL OR p_to_id IS NULL THEN RAISE EXCEPTION 'بيانات التحويل غير صالحة'; END IF;
  IF p_from_id=p_to_id THEN RAISE EXCEPTION 'لا يمكن التحويل إلى نفس الخزينة'; END IF;
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE) THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  IF p_from_id<p_to_id THEN v_first:=p_from_id; v_second:=p_to_id; ELSE v_first:=p_to_id; v_second:=p_from_id; END IF;
  PERFORM 1 FROM banks_safes WHERE id=v_first AND company_id=p_company_id FOR UPDATE;
  PERFORM 1 FROM banks_safes WHERE id=v_second AND company_id=p_company_id FOR UPDATE;
  SELECT * INTO v_from FROM banks_safes WHERE id=p_from_id AND company_id=p_company_id AND is_active=TRUE;
  IF NOT FOUND OR v_from.account_id IS NULL THEN RAISE EXCEPTION 'الخزينة المصدر غير موجودة'; END IF;
  SELECT * INTO v_to FROM banks_safes WHERE id=p_to_id AND company_id=p_company_id AND is_active=TRUE;
  IF NOT FOUND OR v_to.account_id IS NULL THEN RAISE EXCEPTION 'الخزينة الوجهة غير موجودة'; END IF;
  IF v_from.account_id=v_to.account_id THEN RAISE EXCEPTION 'لا يمكن التحويل إلى نفس الخزينة'; END IF;
  v_balance:=get_account_balance(p_company_id,v_from.account_id,NULL,NULL);
  IF v_balance+0.005<p_amount THEN RAISE EXCEPTION 'الرصيد غير كاف للتحويل'; END IF;
  v_journal:=create_journal_entry(p_company_id,p_date,'general','تحويل بين خزائن: '||BTRIM(p_reason),p_user_id,jsonb_build_array(
    jsonb_build_object('accountId',v_to.account_id,'debit',p_amount,'credit',0,'description','تحويل وارد من '||v_from.name),
    jsonb_build_object('accountId',v_from.account_id,'debit',0,'credit',p_amount,'description','تحويل صادر إلى '||v_to.name)
  ));
  v_journal_id:=(v_journal->>'id')::UUID;
  UPDATE journal_entries SET reference_type='bank_transfer',reference_id=v_from.id WHERE id=v_journal_id AND company_id=p_company_id;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'transfer','banks_safes',v_from.id,
    jsonb_build_object('from_id',p_from_id,'to_id',p_to_id,'amount',p_amount,'journal_entry_id',v_journal_id,'reason',BTRIM(p_reason)));
  RETURN jsonb_build_object('journal_entry_id',v_journal_id,'from_id',p_from_id,'to_id',p_to_id,'amount',p_amount);
END;
$$;
REVOKE ALL ON FUNCTION public.transfer_between_safes_atomic(UUID,UUID,UUID,NUMERIC,DATE,TEXT,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_between_safes_atomic(UUID,UUID,UUID,NUMERIC,DATE,TEXT,UUID) TO service_role;

UPDATE voucher_receipts vr SET counterpart_account_id = (
  SELECT a.id FROM accounts a WHERE a.company_id=vr.company_id
    AND a.code=CASE vr.receipt_type
      WHEN 'client' THEN '1130' WHEN 'client_advance' THEN '2180'
      WHEN 'supplier_refund' THEN '2110' WHEN 'supplier_advance_return' THEN '1190'
      WHEN 'employee_repayment' THEN '1160' WHEN 'owner_capital' THEN '3100'
      WHEN 'loan' THEN '2130' ELSE '4200' END
    AND COALESCE(a.is_active,TRUE)=TRUE AND COALESCE(a.is_header,FALSE)=FALSE
  LIMIT 1
) WHERE counterpart_account_id IS NULL;

UPDATE voucher_disbursements vd SET counterpart_account_id = (
  SELECT a.id FROM accounts a WHERE a.company_id=vd.company_id
    AND a.code=CASE vd.disbursement_type
      WHEN 'supplier' THEN '2110' WHEN 'supplier_advance' THEN '1190'
      WHEN 'employee_advance' THEN '1160' WHEN 'subcontractor' THEN '2150'
      WHEN 'client_refund' THEN '1130' WHEN 'owner_drawings' THEN '3400'
      WHEN 'salary' THEN '2140' WHEN 'custody' THEN '1150'
      WHEN 'loan_repayment' THEN '2130' ELSE '5400' END
    AND COALESCE(a.is_active,TRUE)=TRUE AND COALESCE(a.is_header,FALSE)=FALSE
  LIMIT 1
) WHERE counterpart_account_id IS NULL;

SELECT 'Migration 119 completed — voucher/cash completeness' AS result;
