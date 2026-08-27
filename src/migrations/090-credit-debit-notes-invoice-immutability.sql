-- ======================================================================
-- 090: المحور الثاني — نظام الإشعارات الدائنة/المدينة بديلاً عن تعديل
--      فاتورة البيع + منع تعديل الفواتير نهائياً على مستوى قاعدة البيانات
--
-- السياسة المحاسبية:
--   * فاتورة البيع بعد إنشائها مستند محاسبي/ضريبي غير قابل للتعديل؛
--     أي تصحيح يمر حصراً عبر:
--       - إشعار دائن  (note_type='credit') لتخفيض/إرجاع بمرجع الفاتورة الأصل.
--       - إشعار مدين  (note_type='debit')  لإضافة مبالغ إضافية للعميل.
--   * صافي رصيد الفاتورة = total + (إشعارات مدينة معتمدة) − (إشعارات دائنة معتمدة)
--     وتُحتسب سندات القبض ضمن هذا الصافي (لا تحصيل يتجاوز الصافي).
--   * لكل إشعار قيد محاسبي مستقل وتسلسل ترقيم مستقل (CN / DN) وإلغاؤه يولّد
--     قيداً عكسياً. القيد الأصلي للفاتورة لا يُمس إطلاقاً.
--   * قاعدة البيانات تمنع أي UPDATE يغيّر الحقول المحاسبية/التعريفية للفاتورة
--     أو يعدّل/يحذف بنودها — الإلغاء والتحصيل فقط عبر مسارات النظام.
-- ======================================================================

-- ---------------------------------------------------------------------------
-- 1) تمييز نوع الإشعار على نفس الجدول (credit = تخفيض / debit = زيادة)
-- ---------------------------------------------------------------------------
ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS note_type TEXT NOT NULL DEFAULT 'credit';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credit_notes_note_type_check') THEN
    ALTER TABLE credit_notes ADD CONSTRAINT credit_notes_note_type_check
      CHECK (note_type IN ('credit', 'debit'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_credit_notes_company_type ON credit_notes(company_id, note_type);

-- ---------------------------------------------------------------------------
-- 2) تسلسل ترقيم مستقل للإشعارات المدينة (بمعزل عن تسلسل الدائنة)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS debit_note_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  year INTEGER NOT NULL,
  last_number INTEGER NOT NULL DEFAULT 0,
  UNIQUE(company_id, year)
);

CREATE OR REPLACE FUNCTION public.next_debit_note_number(p_company_id UUID, p_year INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_number INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('debit-note-number:' || p_company_id::text));
  INSERT INTO debit_note_sequences(company_id, year, last_number)
  SELECT p_company_id, p_year, COALESCE(max(number), 0) + 1
  FROM credit_notes WHERE company_id = p_company_id AND note_type = 'debit'
  ON CONFLICT (company_id, year)
  DO UPDATE SET last_number = debit_note_sequences.last_number + 1
  RETURNING last_number INTO v_number;
  RETURN v_number;
END;
$$;
REVOKE ALL ON FUNCTION public.next_debit_note_number(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_debit_note_number(UUID, INTEGER) TO service_role;

-- ---------------------------------------------------------------------------
-- 3) صافي رصيد الفاتورة بعد الإشعارات المعتمدة
--    (يُستخدم في حدود التخصيص وسندات القبض وحدود الإشعار الدائن)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invoice_net_total(p_company_id UUID, p_invoice_id UUID)
RETURNS NUMERIC(15,2)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT round(
    i.total
    + COALESCE(sum(cn.total) FILTER (WHERE cn.note_type = 'debit'), 0)
    - COALESCE(sum(cn.total) FILTER (WHERE cn.note_type = 'credit'), 0), 2)
  FROM invoices i
  LEFT JOIN credit_notes cn
    ON cn.company_id = i.company_id AND cn.invoice_id = i.id
   AND cn.status = 'approved' AND cn.deleted_at IS NULL
  WHERE i.company_id = p_company_id AND i.id = p_invoice_id
  GROUP BY i.total;
$$;
REVOKE ALL ON FUNCTION public.invoice_net_total(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoice_net_total(UUID, UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- 4) إنشاء إشعار مدين ذري (زيادة مستحقات العميل بديلاً عن تعديل الفاتورة)
--    القيد: من ح/ العملاء (الصافي)   إلى ح/ الإيراد + ضريبة القيمة المضافة
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_debit_note_atomic(
  p_company_id UUID, p_invoice_id UUID, p_project_id UUID, p_contact_id UUID,
  p_date DATE, p_reason TEXT, p_items JSONB, p_tax_rate NUMERIC, p_user_id UUID
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
BEGIN
  IF p_date IS NULL OR NULLIF(btrim(p_reason),'') IS NULL OR length(p_reason)>1000
    OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)=0
    OR jsonb_array_length(p_items)>200
  THEN RAISE EXCEPTION 'بيانات الإشعار المدين غير صالحة'; END IF;
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;

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
    vat_amount,tax_amount,tax_rate,total,status,created_by
  ) VALUES(
    p_company_id,v_number,'debit',p_invoice_id,v_project,v_contact,p_date,btrim(p_reason),
    v_subtotal,v_tax,v_tax,v_rate,v_total,'approved',p_user_id
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
  UPDATE credit_notes SET journal_entry_id=v_journal_id
  WHERE id=v_note.id RETURNING * INTO v_note;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'create','debit_note',v_note.id,to_jsonb(v_note));
  RETURN to_jsonb(v_note);
END;
$$;

-- ---------------------------------------------------------------------------
-- 5) تحديث حد الإشعار الدائن: الاعتماد على صافي الفاتورة
--    (الأصل + المدين المعتمد − الدائن المعتمد) بدل الأصل وحده
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_credit_note_atomic(
  p_company_id UUID, p_invoice_id UUID, p_project_id UUID, p_contact_id UUID,
  p_date DATE, p_reason TEXT, p_items JSONB, p_tax_rate NUMERIC, p_user_id UUID
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
BEGIN
  IF p_date IS NULL OR NULLIF(btrim(p_reason),'') IS NULL OR length(p_reason)>1000
    OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)=0
    OR jsonb_array_length(p_items)>200
  THEN RAISE EXCEPTION 'بيانات الإشعار الدائن غير صالحة'; END IF;
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;

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

  IF p_invoice_id IS NOT NULL THEN
    -- صف الفاتورة مقفول أعلاه (FOR UPDATE) فلا تزامن مع سند قبض أو إشعار آخر.
    -- الحد = صافي الفاتورة: الأصل + المدين المعتمد − الدائن المعتمد.
    v_net:=invoice_net_total(p_company_id,p_invoice_id);
    IF v_total>v_net+0.005 THEN
      RAISE EXCEPTION 'يتجاوز الإشعار الرصيد المتبقي للفاتورة (الأصل + المدين − الدائن المعتمد)';
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
    vat_amount,tax_amount,tax_rate,total,status,created_by
  ) VALUES(
    p_company_id,v_number,'credit',p_invoice_id,v_project,v_contact,p_date,btrim(p_reason),
    v_subtotal,v_tax,v_tax,v_rate,v_total,'approved',p_user_id
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
  UPDATE credit_notes SET journal_entry_id=v_journal_id
  WHERE id=v_note.id RETURNING * INTO v_note;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'create','credit_note',v_note.id,to_jsonb(v_note));
  RETURN to_jsonb(v_note);
END;
$$;

-- ---------------------------------------------------------------------------
-- 6) إلغاء الإشعار (دائن/مدين) بصيغة موحدة — قيد عكسي ثم إلغاء
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_credit_note_atomic(
  p_company_id UUID,p_credit_note_id UUID,p_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old credit_notes%ROWTYPE; v_note credit_notes%ROWTYPE; v_reversal UUID;
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
  IF v_old.journal_entry_id IS NOT NULL THEN
    v_reversal:=post_journal_reversal(
      p_company_id,v_old.journal_entry_id,'credit_note_cancellation',p_credit_note_id,
      CASE WHEN v_old.note_type='debit' THEN 'إلغاء الإشعار المدين ' ELSE 'إلغاء الإشعار الدائن ' END||v_old.number,
      p_user_id
    );
  END IF;
  UPDATE credit_notes SET status='cancelled',deleted_at=now()
  WHERE id=p_credit_note_id RETURNING * INTO v_note;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'cancel','credit_note',p_credit_note_id,to_jsonb(v_old),
    to_jsonb(v_note)||jsonb_build_object('reversal_journal_id',v_reversal));
  RETURN to_jsonb(v_note)||jsonb_build_object('reversal_journal_id',v_reversal);
END;
$$;

REVOKE ALL ON FUNCTION public.create_debit_note_atomic(UUID,UUID,UUID,UUID,DATE,TEXT,JSONB,NUMERIC,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.create_credit_note_atomic(UUID,UUID,UUID,UUID,DATE,TEXT,JSONB,NUMERIC,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cancel_credit_note_atomic(UUID,UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_debit_note_atomic(UUID,UUID,UUID,UUID,DATE,TEXT,JSONB,NUMERIC,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_credit_note_atomic(UUID,UUID,UUID,UUID,DATE,TEXT,JSONB,NUMERIC,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_credit_note_atomic(UUID,UUID,UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- 7) سندات القبض: حدود التخصيص والتحصيل على أساس صافي الفاتورة
--    (الأصل + المدين المعتمد − الدائن المعتمد) — إعادة تعريف بنفس التواقيع
-- ---------------------------------------------------------------------------
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
    OR v_invoice.paid_amount+v_alloc>invoice_net_total(p_company_id,v_invoice.id)+0.005 THEN RAISE EXCEPTION 'فاتورة البيع غير صالحة للتخصيص'; END IF;
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
  UPDATE invoices SET paid_amount=v_new_paid,status=CASE WHEN v_new_paid>=invoice_net_total(p_company_id,v_invoice.id)-0.005 THEN 'paid' ELSE 'partial' END WHERE id=v_invoice.id;
  INSERT INTO receipt_invoice_items(company_id,voucher_receipt_id,invoice_id,amount,journal_entry_id) VALUES(p_company_id,v_receipt.id,v_invoice.id,v_alloc,v_journal_id);
  v_applied:=v_applied+v_alloc;
 END LOOP;
 IF jsonb_array_length(p_allocations)=0 AND p_auto_fifo AND p_receipt_type='client' AND p_contact_id IS NOT NULL THEN
  v_remaining:=p_amount;
  FOR v_invoice IN SELECT * FROM invoices WHERE company_id=p_company_id AND contact_id=p_contact_id AND status NOT IN ('cancelled','paid') ORDER BY date,number FOR UPDATE LOOP
   EXIT WHEN v_remaining<=0.005;
   v_alloc:=LEAST(v_remaining,GREATEST(0,ROUND(invoice_net_total(p_company_id,v_invoice.id)-v_invoice.paid_amount,2))); CONTINUE WHEN v_alloc<=0;
   v_new_paid:=ROUND(v_invoice.paid_amount+v_alloc,2);
   UPDATE invoices SET paid_amount=v_new_paid,status=CASE WHEN v_new_paid>=invoice_net_total(p_company_id,v_invoice.id)-0.005 THEN 'paid' ELSE 'partial' END WHERE id=v_invoice.id;
   INSERT INTO receipt_invoice_items(company_id,voucher_receipt_id,invoice_id,amount,journal_entry_id) VALUES(p_company_id,v_receipt.id,v_invoice.id,v_alloc,v_journal_id);
   v_applied:=v_applied+v_alloc; v_remaining:=v_remaining-v_alloc;
  END LOOP;
 END IF;
 UPDATE voucher_receipts SET journal_entry_id=v_journal_id WHERE id=v_receipt.id RETURNING * INTO v_receipt;
 INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values) VALUES(p_company_id,p_user_id,'post','voucher_receipt',v_receipt.id,to_jsonb(v_receipt));
 RETURN to_jsonb(v_receipt)||jsonb_build_object('requires_approval',FALSE,'allocated_amount',ROUND(v_applied,2),'unapplied_amount',ROUND(p_amount-v_applied,2));
END;
$$;

REVOKE ALL ON FUNCTION public.create_voucher_receipt_atomic(UUID,DATE,TEXT,UUID,NUMERIC,UUID,TEXT,JSONB,BOOLEAN,BOOLEAN,UUID,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_voucher_receipt_atomic(UUID,DATE,TEXT,UUID,NUMERIC,UUID,TEXT,JSONB,BOOLEAN,BOOLEAN,UUID,UUID) TO service_role;

-- نسخة اعتماد السندات (الداخلية v49 التي يستدعيها الغلاف من 059) بحدود الصافي
CREATE OR REPLACE FUNCTION public.respond_voucher_receipt_approval_v49_internal(
 p_company_id UUID,p_approval_id UUID,p_action TEXT,p_approver_user_id UUID,p_approver_chat_id TEXT,p_comments TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_request approval_requests%ROWTYPE; v_receipt voucher_receipts%ROWTYPE; v_bank banks_safes%ROWTYPE; v_counterpart UUID;
 v_journal JSONB; v_journal_id UUID; v_link receipt_invoice_items%ROWTYPE; v_invoice invoices%ROWTYPE;
 v_alloc NUMERIC; v_new_paid NUMERIC; v_remaining NUMERIC; v_actor UUID;
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
 SELECT id INTO v_counterpart FROM accounts WHERE company_id=p_company_id AND code=CASE v_receipt.receipt_type WHEN 'client' THEN '1130' WHEN 'supplier_refund' THEN '2110' ELSE '4200' END
  AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
 IF v_counterpart IS NULL OR v_counterpart=v_bank.account_id THEN RAISE EXCEPTION 'الحساب المقابل غير صالح'; END IF;
 FOR v_link IN SELECT * FROM receipt_invoice_items WHERE company_id=p_company_id AND voucher_receipt_id=v_receipt.id FOR UPDATE LOOP
  SELECT * INTO v_invoice FROM invoices WHERE id=v_link.invoice_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND OR v_invoice.status IN ('cancelled','paid') OR (v_receipt.contact_id IS NOT NULL AND v_invoice.contact_id<>v_receipt.contact_id)
    OR v_invoice.paid_amount+v_link.amount>invoice_net_total(p_company_id,v_invoice.id)+0.005 THEN RAISE EXCEPTION 'تعذر تطبيق تخصيص فاتورة البيع'; END IF;
 END LOOP;
 v_journal:=create_journal_entry(p_company_id,v_receipt.date,'general','سند قبض رقم '||v_receipt.number||': '||v_receipt.reason,v_request.requester_id,jsonb_build_array(
  jsonb_build_object('accountId',v_bank.account_id,'debit',v_receipt.amount,'credit',0),
  jsonb_build_object('accountId',v_counterpart,'debit',0,'credit',v_receipt.amount,'contactId',v_receipt.contact_id)));
 v_journal_id:=(v_journal->>'id')::UUID;
 UPDATE journal_entries SET reference_type='voucher_receipt',reference_id=v_receipt.id WHERE id=v_journal_id AND company_id=p_company_id;
 FOR v_link IN SELECT * FROM receipt_invoice_items WHERE company_id=p_company_id AND voucher_receipt_id=v_receipt.id FOR UPDATE LOOP
  SELECT * INTO v_invoice FROM invoices WHERE id=v_link.invoice_id AND company_id=p_company_id FOR UPDATE;
  v_new_paid:=ROUND(v_invoice.paid_amount+v_link.amount,2);
  UPDATE invoices SET paid_amount=v_new_paid,status=CASE WHEN v_new_paid>=invoice_net_total(p_company_id,v_invoice.id)-0.005 THEN 'paid' ELSE 'partial' END WHERE id=v_invoice.id;
  UPDATE receipt_invoice_items SET journal_entry_id=v_journal_id WHERE id=v_link.id;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM receipt_invoice_items WHERE company_id=p_company_id AND voucher_receipt_id=v_receipt.id)
   AND v_receipt.auto_allocate_fifo AND v_receipt.receipt_type='client' AND v_receipt.contact_id IS NOT NULL THEN
  v_remaining:=v_receipt.amount;
  FOR v_invoice IN SELECT * FROM invoices WHERE company_id=p_company_id AND contact_id=v_receipt.contact_id AND status NOT IN ('cancelled','paid') ORDER BY date,number FOR UPDATE LOOP
   EXIT WHEN v_remaining<=0.005; v_alloc:=LEAST(v_remaining,GREATEST(0,ROUND(invoice_net_total(p_company_id,v_invoice.id)-v_invoice.paid_amount,2))); CONTINUE WHEN v_alloc<=0;
   v_new_paid:=ROUND(v_invoice.paid_amount+v_alloc,2);
   UPDATE invoices SET paid_amount=v_new_paid,status=CASE WHEN v_new_paid>=invoice_net_total(p_company_id,v_invoice.id)-0.005 THEN 'paid' ELSE 'partial' END WHERE id=v_invoice.id;
   INSERT INTO receipt_invoice_items(company_id,voucher_receipt_id,invoice_id,amount,journal_entry_id) VALUES(p_company_id,v_receipt.id,v_invoice.id,v_alloc,v_journal_id);
   v_remaining:=v_remaining-v_alloc;
  END LOOP;
 END IF;
 UPDATE voucher_receipts SET status='approved',journal_entry_id=v_journal_id WHERE id=v_receipt.id RETURNING * INTO v_receipt;
 UPDATE approval_requests SET status='approved',approved_by=p_approver_user_id,approver_chat_id=p_approver_chat_id,approved_at=NOW(),approval_comments=NULLIF(BTRIM(p_comments),''),updated_at=NOW() WHERE id=p_approval_id;
 INSERT INTO notifications(company_id,user_id,type,title,message,entity_type,entity_id) VALUES(p_company_id,v_request.requester_id,'success','تم اعتماد طلبك','سند قبض - تم الاعتماد بنجاح','approval_request',p_approval_id);
 INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values) VALUES(p_company_id,v_actor,'approve_approval','approval_request',p_approval_id,jsonb_build_object('voucher_id',v_receipt.id,'journal_entry_id',v_journal_id,'chat_id',p_approver_chat_id));
 RETURN jsonb_build_object('status','approved','voucher_id',v_receipt.id,'journal_entry_id',v_journal_id,'requester_id',v_request.requester_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- 7ب) الدفع الإلكتروني: تخصيص السداد على أساس صافي الفاتورة (بعد الإشعارات)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_gateway_payment(
 p_company_id UUID,p_payment_record_id UUID,p_final_status TEXT,p_gateway_response TEXT,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_payment payment_records%ROWTYPE; v_invoice invoices%ROWTYPE; v_settlement UUID; v_ar UUID; v_advance UUID;
 v_remaining NUMERIC; v_applied NUMERIC; v_excess NUMERIC; v_new_paid NUMERIC; v_lines JSONB; v_journal JSONB; v_journal_id UUID;
BEGIN
 IF p_final_status NOT IN ('authorized','paid','failed','cancelled') OR LENGTH(COALESCE(p_gateway_response,''))>100000 THEN RAISE EXCEPTION 'حالة الدفع غير صالحة'; END IF;
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE) THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
 SELECT * INTO v_payment FROM payment_records WHERE id=p_payment_record_id AND company_id=p_company_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'سجل الدفع غير موجود'; END IF;
 IF v_payment.status='paid' AND v_payment.journal_entry_id IS NOT NULL THEN RETURN to_jsonb(v_payment)||jsonb_build_object('already_processed',TRUE); END IF;
 IF v_payment.status IN ('refunded','cancelled') THEN RAISE EXCEPTION 'لا يمكن تغيير حالة سجل دفع نهائي'; END IF;
 IF p_final_status<>'paid' THEN
  UPDATE payment_records SET status=p_final_status,gateway_response=p_gateway_response,updated_at=NOW() WHERE id=v_payment.id RETURNING * INTO v_payment;
  RETURN to_jsonb(v_payment)||jsonb_build_object('already_processed',FALSE);
 END IF;
 SELECT * INTO v_invoice FROM invoices WHERE id=v_payment.invoice_id AND company_id=p_company_id FOR UPDATE;
 IF NOT FOUND OR v_invoice.status='cancelled' THEN RAISE EXCEPTION 'الفاتورة غير موجودة أو ملغاة'; END IF;
 SELECT id INTO v_settlement FROM accounts WHERE company_id=p_company_id AND id=COALESCE(v_payment.settlement_account_id,
  (SELECT id FROM accounts WHERE company_id=p_company_id AND code='1110' LIMIT 1)) AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE FOR UPDATE;
 SELECT id INTO v_ar FROM accounts WHERE company_id=p_company_id AND code='1130' AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
 IF v_settlement IS NULL OR v_ar IS NULL OR v_payment.amount<=0 THEN RAISE EXCEPTION 'حسابات تحصيل الدفع غير مكتملة'; END IF;
 v_remaining:=GREATEST(ROUND(invoice_net_total(p_company_id,v_invoice.id)-v_invoice.paid_amount,2),0);
 v_applied:=LEAST(v_payment.amount,v_remaining); v_excess:=ROUND(v_payment.amount-v_applied,2);
 v_lines:=jsonb_build_array(jsonb_build_object('accountId',v_settlement,'debit',v_payment.amount,'credit',0,'description','سداد إلكتروني','contactId',v_invoice.contact_id));
 IF v_applied>0 THEN v_lines:=v_lines||jsonb_build_array(jsonb_build_object('accountId',v_ar,'debit',0,'credit',v_applied,'description','سداد فاتورة','contactId',v_invoice.contact_id)); END IF;
 IF v_excess>0 THEN
  SELECT id INTO v_advance FROM accounts WHERE company_id=p_company_id AND code='2180' AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
  IF v_advance IS NULL THEN RAISE EXCEPTION 'حساب دفعات العملاء المقدمة غير موجود لمعالجة الزيادة'; END IF;
  v_lines:=v_lines||jsonb_build_array(jsonb_build_object('accountId',v_advance,'debit',0,'credit',v_excess,'description','دفعة عميل زائدة','contactId',v_invoice.contact_id));
 END IF;
 v_journal:=create_journal_entry(p_company_id,CURRENT_DATE,'general','سداد إلكتروني — فاتورة '||v_invoice.number,p_user_id,v_lines);
 v_journal_id:=(v_journal->>'id')::UUID;
 UPDATE journal_entries SET reference_type='payment',reference_id=v_payment.id WHERE id=v_journal_id AND company_id=p_company_id;
 v_new_paid:=ROUND(v_invoice.paid_amount+v_applied,2);
 UPDATE invoices SET paid_amount=v_new_paid,status=CASE WHEN v_new_paid>=invoice_net_total(p_company_id,v_invoice.id)-0.005 THEN 'paid' WHEN v_new_paid>0 THEN 'partial' ELSE 'unpaid' END,
  paid_at=CASE WHEN v_new_paid>=invoice_net_total(p_company_id,v_invoice.id)-0.005 THEN NOW() ELSE paid_at END WHERE id=v_invoice.id;
 UPDATE payment_records SET status='paid',gateway_response=p_gateway_response,journal_entry_id=v_journal_id,updated_at=NOW()
  WHERE id=v_payment.id RETURNING * INTO v_payment;
 INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values) VALUES(p_company_id,p_user_id,'finalize','payment_record',v_payment.id,jsonb_build_object('status','paid','journal_entry_id',v_journal_id,'invoice_applied',v_applied,'customer_advance',v_excess));
 RETURN to_jsonb(v_payment)||jsonb_build_object('already_processed',FALSE,'invoice_applied',v_applied,'customer_advance',v_excess);
END;
$$;
REVOKE ALL ON FUNCTION public.finalize_gateway_payment(UUID,UUID,TEXT,TEXT,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_gateway_payment(UUID,UUID,TEXT,TEXT,UUID) TO service_role;

REVOKE ALL ON FUNCTION public.respond_voucher_receipt_approval_v49_internal(UUID,UUID,TEXT,UUID,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.respond_voucher_receipt_approval_v49_internal(UUID,UUID,TEXT,UUID,TEXT,TEXT) TO service_role;

-- إلغاء سند قبض: إعادة حساب الحالة على أساس صافي الفاتورة
CREATE OR REPLACE FUNCTION public.cancel_voucher_receipt_atomic(
  p_company_id UUID,p_voucher_id UUID,p_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old voucher_receipts%ROWTYPE; v_voucher voucher_receipts%ROWTYPE; v_link receipt_invoice_items%ROWTYPE;
  v_invoice invoices%ROWTYPE; v_new_paid NUMERIC; v_reversal UUID;
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

REVOKE ALL ON FUNCTION public.cancel_voucher_receipt_atomic(UUID,UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_voucher_receipt_atomic(UUID,UUID,UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- 8) إلغاء فاتورة البيع: يمنع أيضاً عند وجود إشعارات مدينة معتمدة
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_sales_invoice_atomic(
  p_company_id UUID, p_invoice_id UUID, p_notes TEXT, p_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old invoices%ROWTYPE; v_invoice invoices%ROWTYPE; v_reversal UUID;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE) THEN
    RAISE EXCEPTION 'المستخدم غير صالح';
  END IF;
  SELECT * INTO v_old FROM invoices
  WHERE id = p_invoice_id AND company_id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الفاتورة غير موجودة'; END IF;
  IF v_old.status = 'cancelled' THEN
    RETURN jsonb_build_object('id',p_invoice_id,'status','cancelled','already_processed',TRUE);
  END IF;
  IF v_old.paid_amount > 0.005 OR v_old.status IN ('paid','partial') THEN
    RAISE EXCEPTION 'لا يمكن إلغاء فاتورة عليها تحصيل';
  END IF;
  IF EXISTS(
    SELECT 1 FROM credit_notes
    WHERE company_id=p_company_id AND invoice_id=p_invoice_id
      AND status='approved' AND deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'لا يمكن إلغاء فاتورة لها إشعارات دائنة أو مدينة معتمدة؛ ألغِ الإشعارات أولاً'; END IF;
  IF v_old.journal_entry_id IS NOT NULL THEN
    v_reversal := post_journal_reversal(
      p_company_id,v_old.journal_entry_id,'invoice_reversal',p_invoice_id,
      'قيد عكسي لفاتورة رقم '||v_old.number,p_user_id
    );
  END IF;
  UPDATE invoices SET status='cancelled',
    notes=COALESCE(NULLIF(btrim(p_notes),''),v_old.notes),updated_at=now()
  WHERE id=p_invoice_id RETURNING * INTO v_invoice;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'cancel','invoice',p_invoice_id,to_jsonb(v_old),
    to_jsonb(v_invoice)||jsonb_build_object('reversal_journal_id',v_reversal));
  RETURN to_jsonb(v_invoice)||jsonb_build_object('reversal_journal_id',v_reversal);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_sales_invoice_atomic(UUID,UUID,TEXT,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_sales_invoice_atomic(UUID,UUID,TEXT,UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- 9) القفل النهائي: فاتورة البيع غير قابلة للتعديل بعد إنشائها
--    يُسمح فقط بمسارات النظام: التحصيل/عكسه، الإلغاء، ربط القيد،
--    رمز QR (ZATCA)، لقطة الضريبة، الطوابع الزمنية، والحذف الناعم.
--    أي تعديل حقيقي = إشعار دائن/مدين.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_sales_invoice_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- 9.1 لا إعادة فتح أو تغيير حالة فاتورة ملغاة نهائياً
  IF OLD.status = 'cancelled' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'لا يمكن تعديل أو إعادة فتح فاتورة ملغاة (فاتورة %)', OLD.number;
  END IF;

  -- 9.2 الحقول المحاسبية والتعريفية ممنوعة تغييرها مهما كانت الصلاحيات
  IF NEW.number              IS DISTINCT FROM OLD.number
      OR NEW.company_id      IS DISTINCT FROM OLD.company_id
      OR NEW.contact_id      IS DISTINCT FROM OLD.contact_id
      OR NEW.project_id      IS DISTINCT FROM OLD.project_id
      OR NEW.date            IS DISTINCT FROM OLD.date
      OR NEW.due_date        IS DISTINCT FROM OLD.due_date
      OR NEW.subtotal        IS DISTINCT FROM OLD.subtotal
      OR NEW.vat_rate        IS DISTINCT FROM OLD.vat_rate
      OR NEW.vat_amount      IS DISTINCT FROM OLD.vat_amount
      OR NEW.tax_rate        IS DISTINCT FROM OLD.tax_rate
      OR NEW.tax_amount      IS DISTINCT FROM OLD.tax_amount
      OR NEW.total           IS DISTINCT FROM OLD.total
      OR NEW.branch_id       IS DISTINCT FROM OLD.branch_id
      OR NEW.cost_center_id  IS DISTINCT FROM OLD.cost_center_id
      OR NEW.created_by      IS DISTINCT FROM OLD.created_by
      OR NEW.created_at      IS DISTINCT FROM OLD.created_at
      OR NEW.contact_email   IS DISTINCT FROM OLD.contact_email
      OR NEW.payment_method  IS DISTINCT FROM OLD.payment_method
  THEN
    RAISE EXCEPTION 'فاتورة البيع مستند غير قابل للتعديل (فاتورة %)؛ صحّح عبر إشعار دائن أو إشعار مدين', OLD.number;
  END IF;

  -- 9.3 الملاحظات تُكتب فقط لحظة الإلغاء (ضمن نفس التحديث)
  IF NEW.notes IS DISTINCT FROM OLD.notes
    AND NOT (NEW.status = 'cancelled' AND OLD.status <> 'cancelled')
  THEN
    RAISE EXCEPTION 'ملاحظات الفاتورة المرحّلة غير قابلة للتعديل؛ استخدم الإشعارات الدائنة/المدينة';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sales_invoices_immutable ON invoices;
CREATE TRIGGER trg_sales_invoices_immutable
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION public.enforce_sales_invoice_immutable();

-- ---------------------------------------------------------------------------
-- 10) بنود الفاتورة غير قابلة للتعديل أو الحذف نهائياً (الإدراج فقط مسموح
--     لحظة إنشاء الفاتورة أو تحويل عرض السعر)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_invoice_items_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'بنود الفاتورة غير قابلة للتعديل أو الحذف بعد الإنشاء؛ استخدم الإشعارات الدائنة/المدينة';
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_items_immutable ON invoice_items;
CREATE TRIGGER trg_invoice_items_immutable
  BEFORE UPDATE OR DELETE ON invoice_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_invoice_items_immutable();

-- ---------------------------------------------------------------------------
-- 11) إزالة مسار تعديل بيانات الفاتورة (أُغلق بديله بالإشعارات)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.update_sales_invoice_metadata(UUID,UUID,DATE,TEXT,BOOLEAN,UUID);
