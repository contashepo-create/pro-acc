-- 109: تحصيل/سداد نقدي عند إصدار الفاتورة، ورد نقدي عند المرتجع
--
-- المعيار (استحقاق + تسوية اختيارية في نفس الترحيل):
--   فاتورة بيع: ذمة عميل ثم سند قبض فوري (موجود مسبقاً).
--   فاتورة شراء: ذمة مورد ثم سند صرف فوري من خزينة/بنك.
--   إشعار دائن (مرتجع مبيعات): تخفيض الذمة ثم رد نقدي اختياري للعميل.
--   إشعار مدين: زيادة الذمة ثم تحصيل اختياري.
--   مرتجع مشتريات: تخفيض ذمة المورد ثم قبض رد اختياري من المورد.

ALTER TABLE credit_notes
  ADD COLUMN IF NOT EXISTS refund_amount NUMERIC(15,2) NOT NULL DEFAULT 0;
ALTER TABLE credit_notes
  ADD COLUMN IF NOT EXISTS collected_amount NUMERIC(15,2) NOT NULL DEFAULT 0;
ALTER TABLE credit_notes
  ADD COLUMN IF NOT EXISTS settlement_voucher_id UUID;

ALTER TABLE purchase_invoices
  ADD COLUMN IF NOT EXISTS returned_amount NUMERIC(15,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS purchase_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  number INTEGER NOT NULL,
  purchase_invoice_id UUID NOT NULL REFERENCES purchase_invoices(id),
  date DATE NOT NULL,
  reason TEXT NOT NULL,
  subtotal NUMERIC(15,2) NOT NULL,
  vat_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(7,4) NOT NULL DEFAULT 0,
  total NUMERIC(15,2) NOT NULL,
  refund_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  refund_voucher_id UUID,
  journal_entry_id UUID,
  status TEXT NOT NULL DEFAULT 'approved',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE(company_id, number)
);

CREATE TABLE IF NOT EXISTS purchase_return_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  purchase_return_id UUID NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity NUMERIC(15,2) NOT NULL,
  unit_price NUMERIC(15,2) NOT NULL,
  total NUMERIC(15,2) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_purchase_returns_company_invoice
  ON purchase_returns(company_id, purchase_invoice_id);

CREATE TABLE IF NOT EXISTS purchase_return_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  year INTEGER NOT NULL,
  last_number INTEGER NOT NULL DEFAULT 0,
  UNIQUE(company_id, year)
);

CREATE OR REPLACE FUNCTION public.next_purchase_return_number(p_company_id UUID, p_year INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_number INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('purchase-return-number:' || p_company_id::text));
  INSERT INTO purchase_return_sequences(company_id, year, last_number)
  SELECT p_company_id, p_year, COALESCE(max(number), 0) + 1
  FROM purchase_returns WHERE company_id = p_company_id
  ON CONFLICT (company_id, year)
  DO UPDATE SET last_number = purchase_return_sequences.last_number + 1
  RETURNING last_number INTO v_number;
  RETURN v_number;
END;
$$;
REVOKE ALL ON FUNCTION public.next_purchase_return_number(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_purchase_return_number(UUID, INTEGER) TO service_role;

-- ---------------------------------------------------------------------------
-- فاتورة مشتريات: سداد نقدي فوري بعد إنشاء الذمة
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_purchase_invoice_atomic(
  UUID,UUID,UUID,UUID,UUID,BOOLEAN,DATE,JSONB,NUMERIC,TEXT,UUID,JSONB,UUID,NUMERIC
);

CREATE OR REPLACE FUNCTION public.create_purchase_invoice_atomic(
  p_company_id UUID,p_supplier_id UUID,p_purchase_order_id UUID,p_project_id UUID,
  p_custody_id UUID,p_link_to_project BOOLEAN,p_date DATE,p_items JSONB,
  p_tax_rate NUMERIC,p_notes TEXT,p_user_id UUID,
  p_other_expenses JSONB DEFAULT '[]'::JSONB,
  p_payment_account_id UUID DEFAULT NULL,
  p_withholding_rate NUMERIC DEFAULT 0,
  p_paid_amount NUMERIC DEFAULT 0,
  p_bank_safe_id UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_result JSONB;
  v_invoice_id UUID;
  v_inv_number TEXT;
  v_oe JSONB;
  v_oe_desc TEXT;
  v_oe_amount NUMERIC;
  v_oe_code TEXT;
  v_oe_account_id UUID;
  v_oe_acc UUID;
  v_other_total NUMERIC:=0;
  v_pay_acc UUID;
  v_lines JSONB:='[]'::JSONB;
  v_oe_journal JSONB;
  v_wh_journal JSONB;
  v_wh_rate NUMERIC:=COALESCE(p_withholding_rate,0);
  v_wh_amount NUMERIC:=0;
  v_subtotal NUMERIC;
  v_total NUMERIC;
  v_ap UUID;
  v_wh_acc UUID;
  v_country TEXT;
  v_parent UUID;
  v_payment_source TEXT;
  v_paid NUMERIC:=COALESCE(p_paid_amount,0);
  v_pay JSONB;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  PERFORM set_config('app.custody_write_company',p_company_id::TEXT,TRUE);

  IF v_wh_rate IS NULL OR v_wh_rate<0 OR v_wh_rate>0.2 OR v_wh_rate<>ROUND(v_wh_rate,4)
  THEN RAISE EXCEPTION 'نسبة خصم المنبع غير صالحة'; END IF;
  SELECT COALESCE(NULLIF(BTRIM(country_code),''),'SA') INTO v_country FROM companies WHERE id=p_company_id;
  IF v_wh_rate>0 AND v_country<>'EG' THEN
    RAISE EXCEPTION 'خصم المنبع متاح للشركات المصرية فقط';
  END IF;

  IF v_paid IS NULL OR v_paid<0 OR v_paid<>ROUND(v_paid,2)
    OR (v_paid>0 AND p_bank_safe_id IS NULL)
  THEN RAISE EXCEPTION 'مبلغ السداد غير صالح'; END IF;
  IF v_paid>0 AND p_custody_id IS NOT NULL THEN
    RAISE EXCEPTION 'لا يجتمع السداد النقدي مع سداد العهدة على نفس الفاتورة';
  END IF;

  IF jsonb_typeof(COALESCE(p_other_expenses,'[]'::JSONB))<>'array' OR jsonb_array_length(p_other_expenses)>100
  THEN RAISE EXCEPTION 'بيانات المصروفات الإضافية غير صالحة'; END IF;
  FOR v_oe IN SELECT value FROM jsonb_array_elements(COALESCE(p_other_expenses,'[]'::JSONB)) LOOP
    BEGIN
      v_oe_amount:=(v_oe->>'amount')::NUMERIC;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'مبلغ مصروف إضافي غير صالح'; END;
    v_oe_desc:=COALESCE(BTRIM(v_oe->>'description'),'');
    v_oe_code:=COALESCE(v_oe->>'account_code','5400');
    IF NULLIF(v_oe_desc,'') IS NULL OR LENGTH(v_oe_desc)>200 OR v_oe_amount IS NULL OR v_oe_amount<=0
      OR v_oe_amount<>ROUND(v_oe_amount,2) THEN RAISE EXCEPTION 'بند مصروف إضافي غير صالح'; END IF;
    v_other_total:=v_other_total+v_oe_amount;
  END LOOP;

  v_result:=create_purchase_invoice_atomic_v55_internal(p_company_id,p_supplier_id,p_purchase_order_id,
    p_project_id,p_custody_id,p_link_to_project,p_date,p_items,p_tax_rate,p_notes,p_user_id);
  v_invoice_id:=(v_result->>'id')::UUID;
  v_inv_number:=COALESCE(v_result->>'invoice_number',v_result->>'number');
  v_subtotal:=COALESCE((v_result->>'subtotal')::NUMERIC,0);
  v_total:=COALESCE((v_result->>'total')::NUMERIC,0);
  v_payment_source:=COALESCE(v_result->>'payment_source','ap');

  IF v_other_total>0 THEN
    IF p_payment_account_id IS NOT NULL THEN
      SELECT id INTO v_pay_acc FROM accounts WHERE id=p_payment_account_id AND company_id=p_company_id
        AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
      IF v_pay_acc IS NULL THEN RAISE EXCEPTION 'حساب دفع المصروفات الإضافية غير صالح'; END IF;
    ELSE
      SELECT id INTO v_pay_acc FROM accounts WHERE company_id=p_company_id AND code='1110'
        AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
      IF v_pay_acc IS NULL THEN RAISE EXCEPTION 'حساب دفع المصروفات الإضافية غير موجود'; END IF;
    END IF;
    v_lines:='[]'::JSONB;
    FOR v_oe IN SELECT value FROM jsonb_array_elements(p_other_expenses) LOOP
      v_oe_amount:=(v_oe->>'amount')::NUMERIC;
      v_oe_desc:=COALESCE(BTRIM(v_oe->>'description'),'');
      v_oe_code:=COALESCE(v_oe->>'account_code','5400');
      v_oe_account_id:=NULLIF(v_oe->>'account_id','')::UUID;
      v_oe_acc:=resolve_other_expense_account(p_company_id,v_oe_code,v_oe_account_id);
      IF v_oe_acc IS NULL THEN RAISE EXCEPTION 'حساب مصروف «%» غير موجود', v_oe_code; END IF;
      v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
        'accountId',v_oe_acc,'debit',v_oe_amount,'credit',0,'description',v_oe_desc,'projectId',(v_result->>'project_id')::UUID));
    END LOOP;
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
      'accountId',v_pay_acc,'debit',0,'credit',v_other_total,'description','مصاريف إضافية فاتورة '||v_inv_number));
    v_oe_journal:=create_journal_entry(p_company_id,p_date,'general','مصاريف إضافية فاتورة '||v_inv_number,p_user_id,v_lines);
    UPDATE purchase_invoices SET other_expenses_total=v_other_total WHERE id=v_invoice_id AND company_id=p_company_id;
  END IF;

  IF v_wh_rate>0 THEN
    IF v_payment_source<>'ap' THEN
      RAISE EXCEPTION 'لا يمكن تطبيق خصم المنبع على فاتورة مسددة من العهدة';
    END IF;
    v_wh_amount:=ROUND(v_subtotal*v_wh_rate,2);
    IF v_wh_amount<=0 THEN
      v_wh_amount:=0;
    ELSIF v_wh_amount>v_total THEN
      RAISE EXCEPTION 'خصم المنبع يتجاوز قيمة الفاتورة';
    ELSE
      SELECT id INTO v_ap FROM accounts WHERE company_id=p_company_id AND code='2110'
        AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
      SELECT id INTO v_wh_acc FROM accounts WHERE company_id=p_company_id AND code='2165'
        AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
      IF v_wh_acc IS NULL THEN
        SELECT id INTO v_parent FROM accounts WHERE company_id=p_company_id AND code='2100' LIMIT 1;
        INSERT INTO accounts(company_id,code,name,name_en,type,parent_id,is_active,is_header)
        SELECT p_company_id,'2165','ضريبة خصم المنبع المستحقة','Withholding tax payable','liability',v_parent,TRUE,FALSE
        WHERE NOT EXISTS(SELECT 1 FROM accounts WHERE company_id=p_company_id AND code='2165');
        SELECT id INTO v_wh_acc FROM accounts WHERE company_id=p_company_id AND code='2165'
          AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
      END IF;
      IF v_ap IS NULL OR v_wh_acc IS NULL THEN RAISE EXCEPTION 'حسابات خصم المنبع غير مكتملة'; END IF;
      v_wh_journal:=create_journal_entry(p_company_id,p_date,'general','خصم منبع فاتورة '||v_inv_number,p_user_id,
        jsonb_build_array(
          jsonb_build_object('accountId',v_ap,'debit',v_wh_amount,'credit',0,'description','خصم منبع','contactId',p_supplier_id),
          jsonb_build_object('accountId',v_wh_acc,'debit',0,'credit',v_wh_amount,'description','ضريبة خصم المنبع المستحقة')
        ));
      UPDATE purchase_invoices
        SET withholding_rate=v_wh_rate, withholding_amount=v_wh_amount, total=ROUND(total-v_wh_amount,2)
        WHERE id=v_invoice_id AND company_id=p_company_id;
      v_total:=ROUND(v_total-v_wh_amount,2);
    END IF;
  END IF;

  IF v_paid>v_total+0.005 THEN RAISE EXCEPTION 'مبلغ السداد يتجاوز المستحق للمورد'; END IF;
  IF v_paid>0 THEN
    v_pay:=create_voucher_disbursement_atomic(
      p_company_id,p_date,'supplier',p_supplier_id,NULL,v_paid,p_bank_safe_id,
      'سداد فوري لفاتورة مشتريات رقم '||v_inv_number,
      jsonb_build_array(jsonb_build_object('invoice_id',v_invoice_id,'amount',v_paid)),
      FALSE,p_user_id,FALSE,(v_result->>'project_id')::UUID
    );
    SELECT to_jsonb(pi.*) INTO v_result FROM purchase_invoices pi WHERE pi.id=v_invoice_id;
  END IF;

  RETURN v_result||jsonb_build_object(
    'other_expenses_total',v_other_total,
    'other_expenses_journal_entry_id',CASE WHEN v_oe_journal IS NULL THEN NULL ELSE v_oe_journal->>'id' END,
    'withholding_journal_entry_id',CASE WHEN v_wh_journal IS NULL THEN NULL ELSE v_wh_journal->>'id' END,
    'withholding_rate',v_wh_rate,
    'withholding_amount',v_wh_amount,
    'total',v_total,
    'voucher_disbursement_id',CASE WHEN v_pay IS NULL THEN NULL ELSE v_pay->>'id' END);
END;
$$;

REVOKE ALL ON FUNCTION public.create_purchase_invoice_atomic(
  UUID,UUID,UUID,UUID,UUID,BOOLEAN,DATE,JSONB,NUMERIC,TEXT,UUID,JSONB,UUID,NUMERIC,NUMERIC,UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_purchase_invoice_atomic(
  UUID,UUID,UUID,UUID,UUID,BOOLEAN,DATE,JSONB,NUMERIC,TEXT,UUID,JSONB,UUID,NUMERIC,NUMERIC,UUID
) TO service_role;

-- ---------------------------------------------------------------------------
-- إشعار دائن: رد نقدي اختياري بعد تخفيض ذمة العميل
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_credit_note_atomic(UUID,UUID,UUID,UUID,DATE,TEXT,JSONB,NUMERIC,UUID);

CREATE OR REPLACE FUNCTION public.create_credit_note_atomic(
  p_company_id UUID, p_invoice_id UUID, p_project_id UUID, p_contact_id UUID,
  p_date DATE, p_reason TEXT, p_items JSONB, p_tax_rate NUMERIC, p_user_id UUID,
  p_refund_amount NUMERIC DEFAULT 0, p_bank_safe_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_invoice invoices%ROWTYPE;
  v_note credit_notes%ROWTYPE;
  v_item JSONB;
  v_qty NUMERIC;
  v_price NUMERIC;
  v_subtotal NUMERIC(15,2):=0;
  v_tax NUMERIC(15,2);
  v_total NUMERIC(15,2);
  v_net NUMERIC(15,2);
  v_contact UUID:=p_contact_id;
  v_project UUID:=p_project_id;
  v_rate NUMERIC:=p_tax_rate;
  v_number INT;
  v_ar UUID;
  v_revenue UUID;
  v_vat UUID;
  v_lines JSONB;
  v_journal JSONB;
  v_journal_id UUID;
  v_refund NUMERIC:=COALESCE(p_refund_amount,0);
  v_pay JSONB;
  v_new_paid NUMERIC;
BEGIN
  IF p_date IS NULL OR NULLIF(btrim(p_reason),'') IS NULL OR length(p_reason)>1000
    OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)=0
    OR jsonb_array_length(p_items)>200
  THEN RAISE EXCEPTION 'بيانات الإشعار الدائن غير صالحة'; END IF;
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  IF v_refund IS NULL OR v_refund<0 OR v_refund<>round(v_refund,2)
    OR (v_refund>0 AND p_bank_safe_id IS NULL)
  THEN RAISE EXCEPTION 'مبلغ الرد النقدي غير صالح'; END IF;

  IF p_invoice_id IS NOT NULL THEN
    SELECT * INTO v_invoice FROM invoices
    WHERE id=p_invoice_id AND company_id=p_company_id FOR UPDATE;
    IF NOT FOUND OR v_invoice.status='cancelled' THEN RAISE EXCEPTION 'الفاتورة غير صالحة'; END IF;
    v_contact:=v_invoice.contact_id;
    v_project:=v_invoice.project_id;
    v_rate:=COALESCE(v_invoice.vat_rate,v_invoice.tax_rate,0);
  ELSE
    IF v_contact IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM contacts WHERE id=v_contact AND company_id=p_company_id
    ) THEN RAISE EXCEPTION 'الطرف غير موجود'; END IF;
    IF v_project IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM projects WHERE id=v_project AND company_id=p_company_id
    ) THEN RAISE EXCEPTION 'المشروع غير موجود'; END IF;
  END IF;
  IF v_rate<0 OR v_rate>1 THEN RAISE EXCEPTION 'نسبة الضريبة غير صالحة'; END IF;
  IF v_refund>0 AND v_contact IS NULL THEN RAISE EXCEPTION 'العميل مطلوب للرد النقدي'; END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    BEGIN
      v_qty:=(v_item->>'quantity')::NUMERIC;
      v_price:=(v_item->>'unit_price')::NUMERIC;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'بند إشعار غير صالح'; END;
    IF NULLIF(btrim(v_item->>'description'),'') IS NULL
      OR length(v_item->>'description')>500 OR v_qty<=0 OR v_price<0
    THEN RAISE EXCEPTION 'بند إشعار غير صالح'; END IF;
    v_subtotal:=v_subtotal+round(v_qty*v_price,2);
  END LOOP;
  v_subtotal:=round(v_subtotal,2);
  v_tax:=round(v_subtotal*v_rate,2);
  v_total:=round(v_subtotal+v_tax,2);
  IF v_total<=0 THEN RAISE EXCEPTION 'إجمالي الإشعار يجب أن يكون موجباً'; END IF;
  IF v_refund>v_total+0.005 THEN RAISE EXCEPTION 'مبلغ الرد يتجاوز قيمة الإشعار'; END IF;

  IF p_invoice_id IS NOT NULL THEN
    v_net:=invoice_net_total(p_company_id,p_invoice_id);
    IF v_total>v_net+0.005 THEN
      RAISE EXCEPTION 'يتجاوز الإشعار الرصيد المتبقي للفاتورة (الأصل + المدين − الدائن المعتمد)';
    END IF;
    IF v_refund>COALESCE(v_invoice.paid_amount,0)+0.005 THEN
      RAISE EXCEPTION 'لا يمكن رد مبلغ أكبر من المحصّل على الفاتورة';
    END IF;
  END IF;

  SELECT id INTO v_ar FROM accounts WHERE company_id=p_company_id AND code='1130'
    AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
  SELECT id INTO v_revenue FROM accounts WHERE company_id=p_company_id AND code='4100'
    AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
  IF v_ar IS NULL OR v_revenue IS NULL THEN RAISE EXCEPTION 'حسابات الإشعار غير مكتملة'; END IF;
  IF v_tax>0 THEN
    SELECT id INTO v_vat FROM accounts WHERE company_id=p_company_id AND code='2120'
      AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
    IF v_vat IS NULL THEN RAISE EXCEPTION 'حساب ضريبة المبيعات غير موجود'; END IF;
  END IF;

  v_number:=next_credit_note_number(p_company_id,extract(year FROM p_date)::INT);
  INSERT INTO credit_notes(
    company_id,number,note_type,invoice_id,project_id,contact_id,date,reason,subtotal,
    vat_amount,tax_amount,tax_rate,total,status,created_by,refund_amount
  ) VALUES(
    p_company_id,v_number,'credit',p_invoice_id,v_project,v_contact,p_date,btrim(p_reason),
    v_subtotal,v_tax,v_tax,v_rate,v_total,'approved',p_user_id,v_refund
  ) RETURNING * INTO v_note;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_qty:=(v_item->>'quantity')::NUMERIC;
    v_price:=(v_item->>'unit_price')::NUMERIC;
    INSERT INTO credit_note_items(company_id,credit_note_id,description,quantity,unit_price,total)
    VALUES(p_company_id,v_note.id,btrim(v_item->>'description'),v_qty,v_price,round(v_qty*v_price,2));
  END LOOP;

  v_lines:=jsonb_build_array(
    jsonb_build_object('accountId',v_revenue,'debit',v_subtotal,'credit',0,'projectId',v_project,'contactId',v_contact),
    jsonb_build_object('accountId',v_ar,'debit',0,'credit',v_total,'contactId',v_contact)
  );
  IF v_tax>0 THEN
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
      'accountId',v_vat,'debit',v_tax,'credit',0,'contactId',v_contact
    ));
  END IF;
  v_journal:=create_journal_entry(
    p_company_id,p_date,'general','إشعار دائن '||v_number||' - '||btrim(p_reason),
    p_user_id,v_lines
  );
  v_journal_id:=(v_journal->>'id')::UUID;
  UPDATE journal_entries SET reference_type='credit_note',reference_id=v_note.id
  WHERE id=v_journal_id AND company_id=p_company_id;

  IF v_refund>0 THEN
    v_pay:=create_voucher_disbursement_atomic(
      p_company_id,p_date,'client_refund',v_contact,NULL,v_refund,p_bank_safe_id,
      'رد نقدي لإشعار دائن '||v_number,'[]'::JSONB,FALSE,p_user_id,FALSE,v_project
    );
    IF p_invoice_id IS NOT NULL THEN
      SELECT * INTO v_invoice FROM invoices WHERE id=p_invoice_id AND company_id=p_company_id FOR UPDATE;
      v_new_paid:=round(GREATEST(0,COALESCE(v_invoice.paid_amount,0)-v_refund),2);
      UPDATE invoices SET paid_amount=v_new_paid,
        status=CASE WHEN v_new_paid<=0.005 THEN 'unpaid'
          WHEN v_new_paid>=invoice_net_total(p_company_id,p_invoice_id)-0.005 THEN 'paid'
          ELSE 'partial' END
      WHERE id=p_invoice_id;
    END IF;
    UPDATE credit_notes SET settlement_voucher_id=(v_pay->>'id')::UUID
    WHERE id=v_note.id;
  END IF;

  UPDATE credit_notes SET journal_entry_id=v_journal_id
  WHERE id=v_note.id RETURNING * INTO v_note;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'create','credit_note',v_note.id,to_jsonb(v_note));
  RETURN to_jsonb(v_note)||jsonb_build_object('settlement_voucher_id',v_note.settlement_voucher_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- إشعار مدين: تحصيل اختياري بعد زيادة ذمة العميل
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_debit_note_atomic(UUID,UUID,UUID,UUID,DATE,TEXT,JSONB,NUMERIC,UUID);

CREATE OR REPLACE FUNCTION public.create_debit_note_atomic(
  p_company_id UUID, p_invoice_id UUID, p_project_id UUID, p_contact_id UUID,
  p_date DATE, p_reason TEXT, p_items JSONB, p_tax_rate NUMERIC, p_user_id UUID,
  p_collected_amount NUMERIC DEFAULT 0, p_bank_safe_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_invoice invoices%ROWTYPE;
  v_note credit_notes%ROWTYPE;
  v_item JSONB;
  v_qty NUMERIC;
  v_price NUMERIC;
  v_subtotal NUMERIC(15,2):=0;
  v_tax NUMERIC(15,2);
  v_total NUMERIC(15,2);
  v_contact UUID:=p_contact_id;
  v_project UUID:=p_project_id;
  v_rate NUMERIC:=p_tax_rate;
  v_number INT;
  v_ar UUID;
  v_revenue UUID;
  v_vat UUID;
  v_lines JSONB;
  v_journal JSONB;
  v_journal_id UUID;
  v_collected NUMERIC:=COALESCE(p_collected_amount,0);
  v_receipt JSONB;
BEGIN
  IF p_date IS NULL OR NULLIF(btrim(p_reason),'') IS NULL OR length(p_reason)>1000
    OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)=0
    OR jsonb_array_length(p_items)>200
  THEN RAISE EXCEPTION 'بيانات الإشعار المدين غير صالحة'; END IF;
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  IF v_collected IS NULL OR v_collected<0 OR v_collected<>round(v_collected,2)
    OR (v_collected>0 AND p_bank_safe_id IS NULL)
  THEN RAISE EXCEPTION 'مبلغ التحصيل غير صالح'; END IF;
  IF v_collected>0 AND p_invoice_id IS NULL THEN
    RAISE EXCEPTION 'التحصيل الفوري للإشعار المدين يتطلب فاتورة أصل';
  END IF;

  IF p_invoice_id IS NOT NULL THEN
    SELECT * INTO v_invoice FROM invoices
    WHERE id=p_invoice_id AND company_id=p_company_id FOR UPDATE;
    IF NOT FOUND OR v_invoice.status='cancelled' THEN RAISE EXCEPTION 'الفاتورة غير صالحة'; END IF;
    v_contact:=v_invoice.contact_id;
    v_project:=v_invoice.project_id;
    v_rate:=COALESCE(v_invoice.vat_rate,v_invoice.tax_rate,0);
  ELSE
    IF v_contact IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM contacts WHERE id=v_contact AND company_id=p_company_id
    ) THEN RAISE EXCEPTION 'الطرف غير موجود'; END IF;
    IF v_project IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM projects WHERE id=v_project AND company_id=p_company_id
    ) THEN RAISE EXCEPTION 'المشروع غير موجود'; END IF;
  END IF;
  IF v_rate<0 OR v_rate>1 THEN RAISE EXCEPTION 'نسبة الضريبة غير صالحة'; END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    BEGIN
      v_qty:=(v_item->>'quantity')::NUMERIC;
      v_price:=(v_item->>'unit_price')::NUMERIC;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'بند إشعار غير صالح'; END;
    IF NULLIF(btrim(v_item->>'description'),'') IS NULL
      OR length(v_item->>'description')>500 OR v_qty<=0 OR v_price<0
    THEN RAISE EXCEPTION 'بند إشعار غير صالح'; END IF;
    v_subtotal:=v_subtotal+round(v_qty*v_price,2);
  END LOOP;
  v_subtotal:=round(v_subtotal,2);
  v_tax:=round(v_subtotal*v_rate,2);
  v_total:=round(v_subtotal+v_tax,2);
  IF v_total<=0 THEN RAISE EXCEPTION 'إجمالي الإشعار يجب أن يكون موجباً'; END IF;
  IF v_collected>v_total+0.005 THEN RAISE EXCEPTION 'مبلغ التحصيل يتجاوز قيمة الإشعار'; END IF;

  SELECT id INTO v_ar FROM accounts WHERE company_id=p_company_id AND code='1130'
    AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
  SELECT id INTO v_revenue FROM accounts WHERE company_id=p_company_id AND code='4100'
    AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
  IF v_ar IS NULL OR v_revenue IS NULL THEN RAISE EXCEPTION 'حسابات الإشعار غير مكتملة'; END IF;
  IF v_tax>0 THEN
    SELECT id INTO v_vat FROM accounts WHERE company_id=p_company_id AND code='2120'
      AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
    IF v_vat IS NULL THEN RAISE EXCEPTION 'حساب ضريبة المبيعات غير موجود'; END IF;
  END IF;

  v_number:=next_debit_note_number(p_company_id,extract(year FROM p_date)::INT);
  INSERT INTO credit_notes(
    company_id,number,note_type,invoice_id,project_id,contact_id,date,reason,subtotal,
    vat_amount,tax_amount,tax_rate,total,status,created_by,collected_amount
  ) VALUES(
    p_company_id,v_number,'debit',p_invoice_id,v_project,v_contact,p_date,btrim(p_reason),
    v_subtotal,v_tax,v_tax,v_rate,v_total,'approved',p_user_id,v_collected
  ) RETURNING * INTO v_note;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_qty:=(v_item->>'quantity')::NUMERIC;
    v_price:=(v_item->>'unit_price')::NUMERIC;
    INSERT INTO credit_note_items(company_id,credit_note_id,description,quantity,unit_price,total)
    VALUES(p_company_id,v_note.id,btrim(v_item->>'description'),v_qty,v_price,round(v_qty*v_price,2));
  END LOOP;

  v_lines:=jsonb_build_array(
    jsonb_build_object('accountId',v_ar,'debit',v_total,'credit',0,'contactId',v_contact),
    jsonb_build_object('accountId',v_revenue,'debit',0,'credit',v_subtotal,'projectId',v_project,'contactId',v_contact)
  );
  IF v_tax>0 THEN
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
      'accountId',v_vat,'debit',0,'credit',v_tax,'contactId',v_contact
    ));
  END IF;
  v_journal:=create_journal_entry(
    p_company_id,p_date,'general','إشعار مدين '||v_number||' - '||btrim(p_reason),
    p_user_id,v_lines
  );
  v_journal_id:=(v_journal->>'id')::UUID;
  UPDATE journal_entries SET reference_type='debit_note',reference_id=v_note.id
  WHERE id=v_journal_id AND company_id=p_company_id;

  IF v_collected>0 THEN
    v_receipt:=create_voucher_receipt_atomic(
      p_company_id,p_date,'client',v_contact,v_collected,p_bank_safe_id,
      'تحصيل فوري لإشعار مدين '||v_number,
      jsonb_build_array(jsonb_build_object('invoice_id',p_invoice_id,'amount',v_collected)),
      FALSE,FALSE,p_user_id,v_project
    );
    UPDATE credit_notes SET settlement_voucher_id=(v_receipt->>'id')::UUID WHERE id=v_note.id;
  END IF;

  UPDATE credit_notes SET journal_entry_id=v_journal_id
  WHERE id=v_note.id RETURNING * INTO v_note;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'create','debit_note',v_note.id,to_jsonb(v_note));
  RETURN to_jsonb(v_note)||jsonb_build_object('settlement_voucher_id',v_note.settlement_voucher_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_credit_note_atomic(
  p_company_id UUID,p_credit_note_id UUID,p_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old credit_notes%ROWTYPE; v_note credit_notes%ROWTYPE; v_reversal UUID;
  v_invoice invoices%ROWTYPE; v_new_paid NUMERIC;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  SELECT * INTO v_old FROM credit_notes
  WHERE id=p_credit_note_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الإشعار غير موجود'; END IF;
  IF v_old.status='cancelled' THEN
    RETURN jsonb_build_object('id',p_credit_note_id,'status','cancelled','already_processed',TRUE);
  END IF;
  IF v_old.status='approved' AND v_old.journal_entry_id IS NULL THEN
    RAISE EXCEPTION 'الإشعار المعتمد بلا قيد محاسبي';
  END IF;
  IF v_old.settlement_voucher_id IS NOT NULL THEN
    IF v_old.note_type='debit' THEN
      PERFORM cancel_voucher_receipt_atomic(p_company_id,v_old.settlement_voucher_id,p_user_id);
    ELSE
      PERFORM cancel_voucher_disbursement_atomic(p_company_id,v_old.settlement_voucher_id,p_user_id);
      IF v_old.invoice_id IS NOT NULL AND COALESCE(v_old.refund_amount,0)>0.005 THEN
        SELECT * INTO v_invoice FROM invoices
        WHERE id=v_old.invoice_id AND company_id=p_company_id FOR UPDATE;
        IF FOUND THEN
          v_new_paid:=round(COALESCE(v_invoice.paid_amount,0)+v_old.refund_amount,2);
          UPDATE invoices SET paid_amount=v_new_paid WHERE id=v_invoice.id;
        END IF;
      END IF;
    END IF;
  END IF;
  IF v_old.journal_entry_id IS NOT NULL THEN
    v_reversal:=post_journal_reversal(
      p_company_id,v_old.journal_entry_id,'credit_note_cancellation',p_credit_note_id,
      CASE WHEN v_old.note_type='debit' THEN 'إلغاء الإشعار المدين ' ELSE 'إلغاء الإشعار الدائن ' END||v_old.number,
      p_user_id
    );
  END IF;
  UPDATE credit_notes SET status='cancelled',deleted_at=now()
  WHERE id=p_credit_note_id RETURNING * INTO v_note;
  IF v_old.invoice_id IS NOT NULL THEN
    SELECT * INTO v_invoice FROM invoices WHERE id=v_old.invoice_id AND company_id=p_company_id FOR UPDATE;
    IF FOUND THEN
      UPDATE invoices SET status=CASE
        WHEN COALESCE(paid_amount,0)<=0.005 THEN 'unpaid'
        WHEN paid_amount>=invoice_net_total(p_company_id,id)-0.005 THEN 'paid'
        ELSE 'partial' END
      WHERE id=v_invoice.id;
    END IF;
  END IF;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'cancel','credit_note',p_credit_note_id,to_jsonb(v_old),
    to_jsonb(v_note)||jsonb_build_object('reversal_journal_id',v_reversal));
  RETURN to_jsonb(v_note)||jsonb_build_object('reversal_journal_id',v_reversal);
END;
$$;

REVOKE ALL ON FUNCTION public.create_debit_note_atomic(UUID,UUID,UUID,UUID,DATE,TEXT,JSONB,NUMERIC,UUID,NUMERIC,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.create_credit_note_atomic(UUID,UUID,UUID,UUID,DATE,TEXT,JSONB,NUMERIC,UUID,NUMERIC,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cancel_credit_note_atomic(UUID,UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_debit_note_atomic(UUID,UUID,UUID,UUID,DATE,TEXT,JSONB,NUMERIC,UUID,NUMERIC,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_credit_note_atomic(UUID,UUID,UUID,UUID,DATE,TEXT,JSONB,NUMERIC,UUID,NUMERIC,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_credit_note_atomic(UUID,UUID,UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- مرتجع مشتريات
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_purchase_return_atomic(
  p_company_id UUID, p_purchase_invoice_id UUID, p_date DATE, p_reason TEXT,
  p_items JSONB, p_user_id UUID,
  p_refund_amount NUMERIC DEFAULT 0, p_bank_safe_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inv purchase_invoices%ROWTYPE;
  v_ret purchase_returns%ROWTYPE;
  v_item JSONB;
  v_qty NUMERIC;
  v_price NUMERIC;
  v_subtotal NUMERIC(15,2):=0;
  v_tax NUMERIC(15,2);
  v_total NUMERIC(15,2);
  v_number INT;
  v_ap UUID;
  v_exp UUID;
  v_vat UUID;
  v_lines JSONB;
  v_journal JSONB;
  v_journal_id UUID;
  v_refund NUMERIC:=COALESCE(p_refund_amount,0);
  v_receipt JSONB;
  v_already NUMERIC;
  v_new_paid NUMERIC;
BEGIN
  IF p_date IS NULL OR NULLIF(btrim(p_reason),'') IS NULL OR length(p_reason)>1000
    OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)=0
    OR jsonb_array_length(p_items)>200
  THEN RAISE EXCEPTION 'بيانات مرتجع المشتريات غير صالحة'; END IF;
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  IF v_refund IS NULL OR v_refund<0 OR v_refund<>round(v_refund,2)
    OR (v_refund>0 AND p_bank_safe_id IS NULL)
  THEN RAISE EXCEPTION 'مبلغ الرد النقدي غير صالح'; END IF;

  SELECT * INTO v_inv FROM purchase_invoices
  WHERE id=p_purchase_invoice_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND OR v_inv.status='cancelled' THEN RAISE EXCEPTION 'فاتورة المشتريات غير صالحة'; END IF;
  IF COALESCE(v_inv.payment_source,'ap')='custody' THEN
    RAISE EXCEPTION 'لا يمكن إرجاع فاتورة مسددة من العهدة من هذا المسار';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    BEGIN
      v_qty:=(v_item->>'quantity')::NUMERIC;
      v_price:=(v_item->>'unit_price')::NUMERIC;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'بند مرتجع غير صالح'; END;
    IF NULLIF(btrim(v_item->>'description'),'') IS NULL
      OR length(v_item->>'description')>500 OR v_qty<=0 OR v_price<0
    THEN RAISE EXCEPTION 'بند مرتجع غير صالح'; END IF;
    v_subtotal:=v_subtotal+round(v_qty*v_price,2);
  END LOOP;
  v_subtotal:=round(v_subtotal,2);
  v_tax:=round(v_subtotal*COALESCE(v_inv.tax_rate,0),2);
  v_total:=round(v_subtotal+v_tax,2);
  IF v_total<=0 THEN RAISE EXCEPTION 'إجمالي المرتجع يجب أن يكون موجباً'; END IF;
  v_already:=COALESCE(v_inv.returned_amount,0);
  IF v_already+v_total>v_inv.total+0.005 THEN
    RAISE EXCEPTION 'المرتجع يتجاوز قيمة فاتورة المشتريات';
  END IF;
  IF v_refund>v_total+0.005 THEN RAISE EXCEPTION 'مبلغ الرد يتجاوز قيمة المرتجع'; END IF;
  IF v_refund>COALESCE(v_inv.paid_amount,0)+0.005 THEN
    RAISE EXCEPTION 'لا يمكن قبض رد أكبر من المسدد للمورد';
  END IF;

  SELECT id INTO v_ap FROM accounts WHERE company_id=p_company_id AND code='2110'
    AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
  IF v_inv.purchase_order_id IS NOT NULL THEN
    SELECT id INTO v_exp FROM accounts WHERE company_id=p_company_id AND code='2145'
      AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
  ELSE
    SELECT id INTO v_exp FROM accounts WHERE company_id=p_company_id
      AND code=CASE WHEN v_inv.project_id IS NOT NULL THEN '5110' ELSE '5400' END
      AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
    IF v_exp IS NULL THEN
      SELECT id INTO v_exp FROM accounts WHERE company_id=p_company_id
        AND code=CASE WHEN v_inv.project_id IS NOT NULL THEN '5400' ELSE '5110' END
        AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
    END IF;
  END IF;
  IF v_ap IS NULL OR v_exp IS NULL THEN RAISE EXCEPTION 'حسابات مرتجع المشتريات غير مكتملة'; END IF;
  IF v_tax>0 THEN
    SELECT id INTO v_vat FROM accounts WHERE company_id=p_company_id AND code='1180'
      AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
    IF v_vat IS NULL THEN RAISE EXCEPTION 'حساب ضريبة المشتريات غير موجود'; END IF;
  END IF;

  v_number:=next_purchase_return_number(p_company_id,extract(year FROM p_date)::INT);
  INSERT INTO purchase_returns(
    company_id,number,purchase_invoice_id,date,reason,subtotal,vat_amount,tax_rate,total,
    refund_amount,status,created_by
  ) VALUES(
    p_company_id,v_number,p_purchase_invoice_id,p_date,btrim(p_reason),v_subtotal,v_tax,
    COALESCE(v_inv.tax_rate,0),v_total,v_refund,'approved',p_user_id
  ) RETURNING * INTO v_ret;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_qty:=(v_item->>'quantity')::NUMERIC;
    v_price:=(v_item->>'unit_price')::NUMERIC;
    INSERT INTO purchase_return_items(company_id,purchase_return_id,description,quantity,unit_price,total)
    VALUES(p_company_id,v_ret.id,btrim(v_item->>'description'),v_qty,v_price,round(v_qty*v_price,2));
  END LOOP;

  v_lines:=jsonb_build_array(
    jsonb_build_object('accountId',v_ap,'debit',v_total,'credit',0,'contactId',v_inv.supplier_id),
    jsonb_build_object('accountId',v_exp,'debit',0,'credit',v_subtotal,'projectId',v_inv.project_id,'contactId',v_inv.supplier_id)
  );
  IF v_tax>0 THEN
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
      'accountId',v_vat,'debit',0,'credit',v_tax,'contactId',v_inv.supplier_id
    ));
  END IF;
  v_journal:=create_journal_entry(
    p_company_id,p_date,'general','مرتجع مشتريات '||v_number||' - '||btrim(p_reason),
    p_user_id,v_lines
  );
  v_journal_id:=(v_journal->>'id')::UUID;
  UPDATE journal_entries SET reference_type='purchase_return',reference_id=v_ret.id
  WHERE id=v_journal_id AND company_id=p_company_id;

  UPDATE purchase_invoices SET returned_amount=round(v_already+v_total,2)
  WHERE id=v_inv.id;

  IF v_refund>0 THEN
    v_receipt:=create_voucher_receipt_atomic(
      p_company_id,p_date,'supplier_refund',v_inv.supplier_id,v_refund,p_bank_safe_id,
      'رد نقدي من المورد لمرتجع '||v_number,'[]'::JSONB,FALSE,FALSE,p_user_id,v_inv.project_id
    );
    v_new_paid:=round(GREATEST(0,COALESCE(v_inv.paid_amount,0)-v_refund),2);
    UPDATE purchase_invoices SET paid_amount=v_new_paid,
      status=CASE WHEN v_new_paid<=0.005 THEN 'unpaid'
        WHEN v_new_paid>=GREATEST(0,total-round(v_already+v_total,2))-0.005 THEN 'paid'
        ELSE 'partial' END
    WHERE id=v_inv.id;
    UPDATE purchase_returns SET refund_voucher_id=(v_receipt->>'id')::UUID WHERE id=v_ret.id;
  END IF;

  UPDATE purchase_returns SET journal_entry_id=v_journal_id WHERE id=v_ret.id RETURNING * INTO v_ret;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'create','purchase_return',v_ret.id,to_jsonb(v_ret));
  RETURN to_jsonb(v_ret);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_purchase_return_atomic(
  p_company_id UUID, p_return_id UUID, p_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old purchase_returns%ROWTYPE; v_ret purchase_returns%ROWTYPE; v_reversal UUID;
  v_inv purchase_invoices%ROWTYPE; v_new_paid NUMERIC; v_new_ret NUMERIC;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  SELECT * INTO v_old FROM purchase_returns
  WHERE id=p_return_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'مرتجع المشتريات غير موجود'; END IF;
  IF v_old.status='cancelled' THEN
    RETURN jsonb_build_object('id',p_return_id,'status','cancelled','already_processed',TRUE);
  END IF;
  SELECT * INTO v_inv FROM purchase_invoices
  WHERE id=v_old.purchase_invoice_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'فاتورة المشتريات غير موجودة'; END IF;
  IF v_old.refund_voucher_id IS NOT NULL THEN
    PERFORM cancel_voucher_receipt_atomic(p_company_id,v_old.refund_voucher_id,p_user_id);
    v_new_paid:=round(COALESCE(v_inv.paid_amount,0)+COALESCE(v_old.refund_amount,0),2);
    UPDATE purchase_invoices SET paid_amount=v_new_paid WHERE id=v_inv.id;
    SELECT * INTO v_inv FROM purchase_invoices WHERE id=v_inv.id;
  END IF;
  IF v_old.journal_entry_id IS NOT NULL THEN
    v_reversal:=post_journal_reversal(
      p_company_id,v_old.journal_entry_id,'purchase_return_cancellation',p_return_id,
      'إلغاء مرتجع مشتريات '||v_old.number,p_user_id
    );
  END IF;
  v_new_ret:=round(GREATEST(0,COALESCE(v_inv.returned_amount,0)-v_old.total),2);
  UPDATE purchase_invoices SET returned_amount=v_new_ret,
    status=CASE WHEN COALESCE(paid_amount,0)<=0.005 THEN 'unpaid'
      WHEN COALESCE(paid_amount,0)>=GREATEST(0,total-v_new_ret)-0.005 THEN 'paid'
      ELSE 'partial' END
  WHERE id=v_inv.id;
  UPDATE purchase_returns SET status='cancelled',deleted_at=now()
  WHERE id=p_return_id RETURNING * INTO v_ret;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'cancel','purchase_return',p_return_id,to_jsonb(v_old),
    to_jsonb(v_ret)||jsonb_build_object('reversal_journal_id',v_reversal));
  RETURN to_jsonb(v_ret)||jsonb_build_object('reversal_journal_id',v_reversal);
END;
$$;

REVOKE ALL ON FUNCTION public.create_purchase_return_atomic(UUID,UUID,DATE,TEXT,JSONB,UUID,NUMERIC,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cancel_purchase_return_atomic(UUID,UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_purchase_return_atomic(UUID,UUID,DATE,TEXT,JSONB,UUID,NUMERIC,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_purchase_return_atomic(UUID,UUID,UUID) TO service_role;

-- سند صرف المورد: المتبقي = الأصل − المرتجع − المدفوع
CREATE OR REPLACE FUNCTION public.create_voucher_disbursement_atomic(
  p_company_id UUID,p_date DATE,p_disbursement_type TEXT,p_contact_id UUID,p_employee_id UUID,p_amount NUMERIC,
  p_bank_safe_id UUID,p_reason TEXT,p_allocations JSONB,p_request_approval BOOLEAN,p_user_id UUID,
  p_auto_fifo BOOLEAN DEFAULT FALSE,
  p_project_id UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_bank banks_safes%ROWTYPE; v_voucher voucher_disbursements%ROWTYPE; v_number INTEGER; v_counterpart UUID;
 v_journal JSONB; v_journal_id UUID; v_balance NUMERIC; v_item JSONB; v_invoice purchase_invoices%ROWTYPE;
 v_alloc NUMERIC; v_alloc_total NUMERIC:=0; v_applied NUMERIC:=0; v_remaining NUMERIC; v_new_paid NUMERIC; v_approval approval_requests%ROWTYPE;
 v_net NUMERIC;
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
  v_net:=ROUND(v_invoice.total-COALESCE(v_invoice.returned_amount,0),2);
  IF v_invoice.paid_amount+v_alloc>v_net+0.005 THEN RAISE EXCEPTION 'التخصيص يتجاوز المتبقي على الفاتورة'; END IF;
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
 UPDATE voucher_disbursements SET journal_entry_id=v_journal_id WHERE id=v_voucher.id RETURNING * INTO v_voucher;
 INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values) VALUES(p_company_id,p_user_id,'post','voucher_disbursement',v_voucher.id,to_jsonb(v_voucher));
 RETURN to_jsonb(v_voucher)||jsonb_build_object('requires_approval',FALSE,'allocated_amount',ROUND(v_applied,2),'unapplied_amount',ROUND(p_amount-v_applied,2));
END;
$$;

REVOKE ALL ON FUNCTION public.create_voucher_disbursement_atomic(UUID,DATE,TEXT,UUID,UUID,NUMERIC,UUID,TEXT,JSONB,BOOLEAN,UUID,BOOLEAN,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_voucher_disbursement_atomic(UUID,DATE,TEXT,UUID,UUID,NUMERIC,UUID,TEXT,JSONB,BOOLEAN,UUID,BOOLEAN,UUID) TO service_role;

SELECT 'Migration 109 completed' AS result;
