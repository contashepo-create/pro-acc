-- 108: عهدة — مصروف فاتورة الشراء على حساب فرعي، سداد ذمة مورد، وإلغاء يعكس التعزيزات
--
-- 5100 في الدليل رأس مجموعة تكلفة المشاريع فلا يُرحَّل عليه. فاتورة بلا أمر شراء
-- كانت تسقط إلى 1140 (مصروفات مقدمة). الصحيح: 5110 مع مشروع، و5400 عاماً.
-- إلغاء الملف كان يعكس قيد الافتتاح فقط فيترك تعزيزات 1150 معلّقة.

CREATE OR REPLACE FUNCTION public.create_purchase_invoice_atomic_v55_internal(
  p_company_id UUID,p_supplier_id UUID,p_purchase_order_id UUID,p_project_id UUID,
  p_custody_id UUID,p_link_to_project BOOLEAN,p_date DATE,p_items JSONB,
  p_tax_rate NUMERIC,p_notes TEXT,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_invoice purchase_invoices%ROWTYPE; v_order purchase_orders%ROWTYPE; v_custody custodies%ROWTYPE;
  v_project UUID; v_item JSONB; v_qty NUMERIC; v_price NUMERIC; v_subtotal NUMERIC; v_tax NUMERIC; v_total NUMERIC;
  v_number INTEGER; v_debit UUID; v_vat UUID; v_credit UUID; v_lines JSONB; v_journal JSONB; v_journal_id UUID;
  v_last_receipt DATE;
BEGIN
  IF p_date IS NULL OR p_tax_rate IS NULL OR p_tax_rate<0 OR p_tax_rate>1 OR p_tax_rate<>round(p_tax_rate,4)
    OR length(COALESCE(p_notes,''))>2000 THEN RAISE EXCEPTION 'بيانات فاتورة المشتريات غير صالحة'; END IF;
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  IF NOT EXISTS(SELECT 1 FROM contacts WHERE id=p_supplier_id AND company_id=p_company_id
    AND type IN('supplier','both') AND COALESCE(is_active,TRUE) AND deleted_at IS NULL)
  THEN RAISE EXCEPTION 'المورد غير موجود'; END IF;
  v_subtotal:=purchase_items_total(p_items);

  IF p_purchase_order_id IS NOT NULL THEN
    IF p_custody_id IS NOT NULL THEN RAISE EXCEPTION 'لا يمكن ربط أمر شراء مستلم بعهدة'; END IF;
    SELECT * INTO v_order FROM purchase_orders WHERE id=p_purchase_order_id AND company_id=p_company_id FOR UPDATE;
    IF NOT FOUND OR v_order.status<>'received' OR v_order.supplier_id<>p_supplier_id
    THEN RAISE EXCEPTION 'يجب أن يكون أمر الشراء مستلماً بالكامل وللمورد المحدد'; END IF;
    IF abs(v_subtotal-v_order.total)>0.005 THEN RAISE EXCEPTION 'إجمالي الفاتورة لا يطابق أمر الشراء'; END IF;
    IF EXISTS(SELECT 1 FROM purchase_invoices WHERE company_id=p_company_id AND purchase_order_id=p_purchase_order_id
      AND status<>'cancelled') THEN RAISE EXCEPTION 'تمت فوترة أمر الشراء مسبقاً'; END IF;
    SELECT max(date) INTO v_last_receipt FROM inventory_transactions
      WHERE company_id=p_company_id AND reference_type='purchase_order' AND reference_id=p_purchase_order_id;
    IF v_last_receipt IS NULL OR p_date<v_last_receipt THEN RAISE EXCEPTION 'تاريخ الفاتورة يسبق استلام أمر الشراء'; END IF;
  END IF;

  IF COALESCE(p_link_to_project,TRUE) AND p_project_id IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM projects WHERE id=p_project_id AND company_id=p_company_id)
    THEN RAISE EXCEPTION 'المشروع غير موجود'; END IF;
    v_project:=p_project_id;
  END IF;
  IF p_custody_id IS NOT NULL THEN
    SELECT * INTO v_custody FROM custodies WHERE id=p_custody_id AND company_id=p_company_id FOR UPDATE;
    IF NOT FOUND OR v_custody.status IN('settled','closed') OR v_custody.deleted_at IS NOT NULL
    THEN RAISE EXCEPTION 'ملف العهدة غير صالح'; END IF;
    IF COALESCE(p_link_to_project,TRUE) AND v_project IS NULL THEN v_project:=v_custody.project_id; END IF;
  END IF;

  v_tax:=round(v_subtotal*p_tax_rate,2); v_total:=round(v_subtotal+v_tax,2);
  IF p_custody_id IS NOT NULL AND v_total>v_custody.remaining_amount+0.005
  THEN RAISE EXCEPTION 'مبلغ الفاتورة أكبر من المتبقي في ملف العهدة'; END IF;

  IF p_purchase_order_id IS NOT NULL THEN
    SELECT id INTO v_debit FROM accounts WHERE company_id=p_company_id AND code='2145'
      AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
  ELSE
    -- لا ترحيل على 5100 لأنه رأس مجموعة. مشروع → مواد 5110، وإلا عموميات 5400.
    SELECT id INTO v_debit FROM accounts WHERE company_id=p_company_id
      AND code=CASE WHEN v_project IS NOT NULL THEN '5110' ELSE '5400' END
      AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
    IF v_debit IS NULL THEN
      SELECT id INTO v_debit FROM accounts WHERE company_id=p_company_id
        AND code=CASE WHEN v_project IS NOT NULL THEN '5400' ELSE '5110' END
        AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
    END IF;
  END IF;
  SELECT id INTO v_credit FROM accounts WHERE company_id=p_company_id
    AND code=CASE WHEN p_custody_id IS NULL THEN '2110' ELSE '1150' END
    AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
  IF v_debit IS NULL OR v_credit IS NULL THEN RAISE EXCEPTION 'حسابات المشتريات غير مكتملة'; END IF;
  IF v_tax>0 THEN
    SELECT id INTO v_vat FROM accounts WHERE company_id=p_company_id AND code='1180'
      AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
    IF v_vat IS NULL THEN RAISE EXCEPTION 'حساب ضريبة المشتريات غير موجود'; END IF;
  END IF;

  v_number:=next_purchase_invoice_number(p_company_id);
  INSERT INTO purchase_invoices(company_id,invoice_number,number,date,supplier_id,purchase_order_id,project_id,
    custody_id,payment_source,subtotal,tax_amount,tax_rate,total,paid_amount,status,notes,created_by)
  VALUES(p_company_id,v_number::TEXT,v_number,p_date,p_supplier_id,p_purchase_order_id,v_project,p_custody_id,
    CASE WHEN p_custody_id IS NULL THEN 'ap' ELSE 'custody' END,v_subtotal,v_tax,p_tax_rate,v_total,
    CASE WHEN p_custody_id IS NULL THEN 0 ELSE v_total END,CASE WHEN p_custody_id IS NULL THEN 'unpaid' ELSE 'paid' END,
    NULLIF(btrim(p_notes),''),p_user_id) RETURNING * INTO v_invoice;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_qty:=(v_item->>'quantity')::NUMERIC; v_price:=(v_item->>'unit_price')::NUMERIC;
    INSERT INTO purchase_invoice_items(company_id,purchase_invoice_id,description,quantity,unit_price,total)
    VALUES(p_company_id,v_invoice.id,btrim(v_item->>'description'),v_qty,v_price,round(v_qty*v_price,2));
  END LOOP;
  v_lines:=jsonb_build_array(
    jsonb_build_object('accountId',v_debit,'debit',v_subtotal,'credit',0,'projectId',v_project,'contactId',p_supplier_id),
    jsonb_build_object('accountId',v_credit,'debit',0,'credit',v_total,'contactId',p_supplier_id)
  );
  IF v_tax>0 THEN v_lines:=v_lines||jsonb_build_array(
    jsonb_build_object('accountId',v_vat,'debit',v_tax,'credit',0,'projectId',v_project,'contactId',p_supplier_id)
  ); END IF;
  v_journal:=create_journal_entry(p_company_id,p_date,'general','فاتورة مشتريات رقم '||v_number,p_user_id,v_lines);
  v_journal_id:=(v_journal->>'id')::UUID;
  UPDATE journal_entries SET reference_type='purchase_invoice',reference_id=v_invoice.id
    WHERE id=v_journal_id AND company_id=p_company_id;
  UPDATE purchase_invoices SET journal_entry_id=v_journal_id WHERE id=v_invoice.id RETURNING * INTO v_invoice;
  IF p_custody_id IS NOT NULL THEN
    INSERT INTO custody_transactions(company_id,custody_id,type,amount,description,reference_type,reference_id,created_by,journal_entry_id)
    VALUES(p_company_id,p_custody_id,'expense',v_total,'فاتورة مشتريات '||v_number,
      'purchase_invoice',v_invoice.id,p_user_id,v_journal_id);
    INSERT INTO custody_invoices(company_id,custody_id,purchase_invoice_id,amount,description)
    VALUES(p_company_id,p_custody_id,v_invoice.id,v_total,'فاتورة '||v_number);
  END IF;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'create','purchase_invoice',v_invoice.id,to_jsonb(v_invoice));
  RETURN to_jsonb(v_invoice);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_custody_file_v49_internal(
  p_company_id UUID, p_custody_id UUID, p_created_by UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_file custodies%ROWTYPE; v_tx RECORD; v_reversal UUID; v_last UUID;
BEGIN
  SELECT * INTO v_file FROM custodies WHERE id=p_custody_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ملف العهدة غير موجود'; END IF;
  IF v_file.status<>'open' THEN RAISE EXCEPTION 'ملف العهدة مغلق'; END IF;
  IF COALESCE(v_file.total_expenses,0)>0.005 THEN RAISE EXCEPTION 'ملف العهدة عليه حركات ولا يمكن إلغاؤه'; END IF;
  IF EXISTS(
    SELECT 1 FROM custody_transactions
    WHERE custody_id=p_custody_id AND company_id=p_company_id
      AND type NOT IN ('addition','receipt')
  ) THEN RAISE EXCEPTION 'ملف العهدة عليه حركات ولا يمكن إلغاؤه'; END IF;

  FOR v_tx IN
    SELECT journal_entry_id FROM custody_transactions
    WHERE custody_id=p_custody_id AND company_id=p_company_id
      AND type IN ('addition','receipt') AND journal_entry_id IS NOT NULL
    ORDER BY created_at, id
  LOOP
    v_last:=post_journal_reversal(p_company_id,v_tx.journal_entry_id,'custody_reversal',p_custody_id,
      'عكس حركة عهدة '||COALESCE(v_file.file_number,p_custody_id::TEXT),p_created_by);
    IF v_reversal IS NULL THEN v_reversal:=v_last; END IF;
  END LOOP;
  IF v_reversal IS NULL AND v_file.journal_entry_id IS NOT NULL THEN
    v_reversal:=post_journal_reversal(p_company_id,v_file.journal_entry_id,'custody_reversal',p_custody_id,
      'عكس افتتاح عهدة '||COALESCE(v_file.file_number,p_custody_id::TEXT),p_created_by);
  END IF;
  IF v_reversal IS NULL THEN RAISE EXCEPTION 'قيد افتتاح العهدة غير موجود'; END IF;

  DELETE FROM custody_transactions WHERE custody_id=p_custody_id AND company_id=p_company_id
    AND type IN ('addition','receipt');
  UPDATE custodies SET status='settled',remaining_amount=0,total_received=0,total_expenses=0,amount=0,
    notes=BTRIM(COALESCE(notes,'')||' [ملغى]'),updated_at=NOW()
  WHERE id=p_custody_id RETURNING * INTO v_file;
  RETURN to_jsonb(v_file)||jsonb_build_object('reversal_journal_id',v_reversal,'cancelled',TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.pay_purchase_invoice_from_custody(
  p_company_id UUID, p_custody_id UUID, p_purchase_invoice_id UUID,
  p_amount NUMERIC, p_date DATE, p_created_by UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_file custodies%ROWTYPE; v_inv purchase_invoices%ROWTYPE;
  v_pay NUMERIC; v_remain NUMERIC; v_ap UUID; v_custody_acc UUID;
  v_journal JSONB; v_journal_id UUID; v_new_paid NUMERIC;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_created_by AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  PERFORM set_config('app.custody_write_company',p_company_id::TEXT,TRUE);

  SELECT * INTO v_file FROM custodies WHERE id=p_custody_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND OR v_file.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'ملف العهدة غير موجود'; END IF;
  IF v_file.status IN ('settled','closed') THEN RAISE EXCEPTION 'ملف العهدة مغلق'; END IF;

  SELECT * INTO v_inv FROM purchase_invoices WHERE id=p_purchase_invoice_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'فاتورة المشتريات غير موجودة'; END IF;
  IF v_inv.status IN ('cancelled','paid') THEN RAISE EXCEPTION 'فاتورة المشتريات غير صالحة للسداد'; END IF;
  IF COALESCE(v_inv.payment_source,'ap')='custody' THEN
    RAISE EXCEPTION 'الفاتورة مسددة من عهدة مسبقاً';
  END IF;

  v_remain:=ROUND(GREATEST(COALESCE(v_inv.total,0)-COALESCE(v_inv.paid_amount,0),0),2);
  v_pay:=COALESCE(p_amount,v_remain);
  IF v_pay IS NULL OR v_pay<=0 OR v_pay<>ROUND(v_pay,2) THEN RAISE EXCEPTION 'مبلغ السداد غير صالح'; END IF;
  IF v_pay>v_remain+0.005 THEN RAISE EXCEPTION 'المبلغ يتجاوز المتبقي على الفاتورة'; END IF;
  IF v_pay>v_file.remaining_amount+0.005 THEN RAISE EXCEPTION 'المبلغ أكبر من رصيد العهدة'; END IF;
  IF p_date IS NULL THEN RAISE EXCEPTION 'تاريخ السداد غير صالح'; END IF;

  SELECT id INTO v_ap FROM accounts WHERE company_id=p_company_id AND code='2110'
    AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
  SELECT id INTO v_custody_acc FROM accounts WHERE company_id=p_company_id AND code='1150'
    AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
  IF v_ap IS NULL OR v_custody_acc IS NULL THEN RAISE EXCEPTION 'حسابات السداد غير مكتملة'; END IF;

  v_journal:=create_journal_entry(p_company_id,p_date,'general',
    'سداد فاتورة مشتريات '||COALESCE(v_inv.invoice_number,v_inv.number::TEXT)||' من العهدة',p_created_by,
    jsonb_build_array(
      jsonb_build_object('accountId',v_ap,'debit',v_pay,'credit',0,'description','سداد مورد من العهدة','contactId',v_inv.supplier_id,'projectId',v_inv.project_id),
      jsonb_build_object('accountId',v_custody_acc,'debit',0,'credit',v_pay,'description','خصم من العهدة','contactId',v_inv.supplier_id)
    ));
  v_journal_id:=(v_journal->>'id')::UUID;
  UPDATE journal_entries SET reference_type='custody_ap_payment',reference_id=p_purchase_invoice_id
    WHERE id=v_journal_id AND company_id=p_company_id;

  v_new_paid:=ROUND(COALESCE(v_inv.paid_amount,0)+v_pay,2);
  UPDATE purchase_invoices
    SET paid_amount=v_new_paid, status=CASE WHEN v_new_paid>=v_inv.total-0.005 THEN 'paid' ELSE 'partial' END
    WHERE id=v_inv.id AND company_id=p_company_id RETURNING * INTO v_inv;

  INSERT INTO custody_transactions(company_id,custody_id,type,amount,description,reference_type,reference_id,created_by,journal_entry_id)
  VALUES(p_company_id,p_custody_id,'expense',v_pay,'سداد فاتورة '||COALESCE(v_inv.invoice_number,v_inv.number::TEXT),
    'purchase_invoice',v_inv.id,p_created_by,v_journal_id);
  INSERT INTO custody_invoices(company_id,custody_id,purchase_invoice_id,amount,description,journal_entry_id)
  VALUES(p_company_id,p_custody_id,v_inv.id,v_pay,'سداد فاتورة '||COALESCE(v_inv.invoice_number,v_inv.number::TEXT),v_journal_id)
  ON CONFLICT (custody_id, purchase_invoice_id) DO UPDATE
    SET amount=custody_invoices.amount+EXCLUDED.amount,
        journal_entry_id=EXCLUDED.journal_entry_id;

  SELECT * INTO v_file FROM custodies WHERE id=p_custody_id;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_created_by,'pay_from_custody','purchase_invoice',v_inv.id,
    jsonb_build_object('custody_id',p_custody_id,'amount',v_pay,'journal_entry_id',v_journal_id));
  RETURN to_jsonb(v_file)||jsonb_build_object('journal_entry_id',v_journal_id,'paid_amount',v_pay,
    'invoice_id',v_inv.id,'invoice_status',v_inv.status);
END;
$$;

REVOKE ALL ON FUNCTION public.pay_purchase_invoice_from_custody(UUID,UUID,UUID,NUMERIC,DATE,UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pay_purchase_invoice_from_custody(UUID,UUID,UUID,NUMERIC,DATE,UUID) TO service_role;

SELECT 'Migration 108 completed' AS result;
