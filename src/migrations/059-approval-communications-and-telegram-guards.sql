-- 059 - Atomic approval, messaging, push, and Telegram tenant boundaries.
BEGIN;

ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_id UUID REFERENCES users(id);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE company_telegram_configs ADD COLUMN IF NOT EXISTS configured_by UUID REFERENCES users(id);
ALTER TABLE company_telegram_configs ALTER COLUMN chat_id DROP NOT NULL;
ALTER TABLE telegram_test_runs ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'not_requested';
ALTER TABLE cash_transactions ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'not_requested';
ALTER TABLE purchase_invoices DROP CONSTRAINT IF EXISTS purchase_invoices_approval_status_check;
ALTER TABLE purchase_invoices ADD CONSTRAINT purchase_invoices_approval_status_check
  CHECK(approval_status IN('not_requested','pending','approved','rejected'));
ALTER TABLE cash_transactions DROP CONSTRAINT IF EXISTS cash_transactions_approval_status_check;
ALTER TABLE cash_transactions ADD CONSTRAINT cash_transactions_approval_status_check
  CHECK(approval_status IN('not_requested','pending','approved','rejected'));
CREATE INDEX IF NOT EXISTS idx_messages_company_live ON messages(company_id,created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_complaints_company_live ON complaints(company_id,created_at DESC) WHERE deleted_at IS NULL;

-- A Telegram chat is an authorization factor and must resolve to one enabled tenant.
WITH duplicate_bindings AS (
  SELECT company_id,row_number() OVER(PARTITION BY chat_id ORDER BY updated_at DESC NULLS LAST,company_id) AS position
  FROM company_telegram_configs
  WHERE is_enabled=TRUE AND NULLIF(BTRIM(chat_id),'') IS NOT NULL
)
UPDATE company_telegram_configs c
SET is_enabled=FALSE,approvals_enabled=FALSE,chat_id=NULL,configured_by=NULL,updated_at=NOW()
FROM duplicate_bindings d WHERE c.company_id=d.company_id AND d.position>1;
CREATE UNIQUE INDEX IF NOT EXISTS uq_enabled_company_telegram_chat
  ON company_telegram_configs(chat_id)
  WHERE is_enabled=TRUE AND NULLIF(BTRIM(chat_id),'') IS NOT NULL;

-- Preserve only the newest historical pending test before enforcing one live test.
WITH pending_tests AS (
  SELECT id,row_number() OVER(PARTITION BY company_id ORDER BY created_at DESC,id) AS position
  FROM telegram_test_runs WHERE status='pending'
)
UPDATE telegram_test_runs t SET status='expired',updated_at=NOW()
FROM pending_tests p WHERE t.id=p.id AND p.position>1;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_telegram_test_company
  ON telegram_test_runs(company_id) WHERE status='pending';

ALTER FUNCTION public.admin_send_company_message(UUID,UUID,TEXT,TEXT)
  RENAME TO admin_send_company_message_v52_internal;
ALTER FUNCTION public.admin_update_complaint(UUID,UUID,TEXT,TEXT,BOOLEAN)
  RENAME TO admin_update_complaint_v52_internal;
ALTER FUNCTION public.respond_approval_request_atomic(UUID,UUID,TEXT,UUID,TEXT)
  RENAME TO respond_approval_request_v50_internal;
ALTER FUNCTION public.respond_voucher_disbursement_approval(UUID,UUID,TEXT,UUID,TEXT,TEXT)
  RENAME TO respond_voucher_disbursement_approval_v49_internal;
ALTER FUNCTION public.respond_voucher_receipt_approval(UUID,UUID,TEXT,UUID,TEXT,TEXT)
  RENAME TO respond_voucher_receipt_approval_v49_internal;
ALTER FUNCTION public.reset_company_business_data(UUID,UUID,TEXT)
  RENAME TO reset_company_business_data_v56_internal;

CREATE OR REPLACE FUNCTION public.assert_communication_actor(p_company_id UUID,p_user_id UUID,p_admin_only BOOLEAN DEFAULT FALSE)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE;
  IF NOT FOUND OR (p_admin_only AND v_role<>'admin') THEN RAISE EXCEPTION 'المستخدم غير مخول'; END IF;
  RETURN v_role;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_send_company_message(p_admin_id UUID,p_company_id UUID,p_subject TEXT,p_body TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM set_config('app.communication_write_company',p_company_id::TEXT,TRUE);
  RETURN admin_send_company_message_v52_internal(p_admin_id,p_company_id,p_subject,p_body);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_complaint(
  p_admin_id UUID,p_complaint_id UUID,p_status TEXT,p_reply TEXT,p_reply_set BOOLEAN
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_company UUID; v_found BOOLEAN;
BEGIN
  SELECT company_id,TRUE INTO v_company,v_found FROM complaints WHERE id=p_complaint_id;
  IF NOT COALESCE(v_found,FALSE) THEN RETURN jsonb_build_object('not_found',TRUE); END IF;
  PERFORM set_config('app.complaint_write_scope',COALESCE(v_company::TEXT,'public'),TRUE);
  RETURN admin_update_complaint_v52_internal(p_admin_id,p_complaint_id,p_status,p_reply,p_reply_set);
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_company_business_data(p_company_id UUID,p_user_id UUID,p_code_hash TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM assert_communication_actor(p_company_id,p_user_id,TRUE);
  PERFORM set_config('app.communication_write_company',p_company_id::TEXT,TRUE);
  RETURN reset_company_business_data_v56_internal(p_company_id,p_user_id,p_code_hash);
END;
$$;

CREATE OR REPLACE FUNCTION public.send_company_message_atomic(
  p_company_id UUID,p_user_id UUID,p_subject TEXT,p_body TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_row messages%ROWTYPE;
BEGIN
  PERFORM assert_communication_actor(p_company_id,p_user_id,FALSE);
  IF LENGTH(BTRIM(COALESCE(p_subject,''))) NOT BETWEEN 1 AND 200
    OR LENGTH(BTRIM(COALESCE(p_body,''))) NOT BETWEEN 1 AND 5000
  THEN RAISE EXCEPTION 'بيانات الرسالة غير صالحة'; END IF;
  PERFORM set_config('app.communication_write_company',p_company_id::TEXT,TRUE);
  INSERT INTO messages(company_id,sender_id,subject,body,direction,is_read)
  VALUES(p_company_id,p_user_id,BTRIM(p_subject),BTRIM(p_body),'company_to_admin',FALSE) RETURNING * INTO v_row;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'send','message',v_row.id,jsonb_build_object('direction',v_row.direction,'subject',v_row.subject));
  RETURN jsonb_build_object('id',v_row.id,'created_at',v_row.created_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_company_message_read_atomic(
  p_company_id UUID,p_user_id UUID,p_message_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old messages%ROWTYPE; v_new messages%ROWTYPE;
BEGIN
  PERFORM assert_communication_actor(p_company_id,p_user_id,FALSE);
  SELECT * INTO v_old FROM messages WHERE id=p_message_id AND company_id=p_company_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الرسالة غير موجودة'; END IF;
  IF v_old.direction<>'admin_to_company' THEN RAISE EXCEPTION 'لا يمكن تغيير حالة رسالة صادرة'; END IF;
  IF v_old.is_read THEN RETURN jsonb_build_object('id',p_message_id,'is_read',TRUE,'already_processed',TRUE); END IF;
  PERFORM set_config('app.communication_write_company',p_company_id::TEXT,TRUE);
  UPDATE messages SET is_read=TRUE,read_at=COALESCE(read_at,NOW()) WHERE id=p_message_id RETURNING * INTO v_new;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'read','message',p_message_id,jsonb_build_object('is_read',FALSE),jsonb_build_object('is_read',TRUE));
  RETURN jsonb_build_object('id',p_message_id,'is_read',TRUE,'already_processed',FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_company_message_atomic(
  p_company_id UUID,p_user_id UUID,p_message_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old messages%ROWTYPE;
BEGIN
  PERFORM assert_communication_actor(p_company_id,p_user_id,FALSE);
  SELECT * INTO v_old FROM messages WHERE id=p_message_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الرسالة غير موجودة'; END IF;
  IF v_old.deleted_at IS NOT NULL THEN RETURN jsonb_build_object('id',p_message_id,'archived',TRUE,'already_processed',TRUE); END IF;
  PERFORM set_config('app.communication_write_company',p_company_id::TEXT,TRUE);
  UPDATE messages SET deleted_at=NOW() WHERE id=p_message_id;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'archive','message',p_message_id,to_jsonb(v_old),jsonb_build_object('deleted_at',NOW()));
  RETURN jsonb_build_object('id',p_message_id,'archived',TRUE,'already_processed',FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_complaint_atomic(
  p_company_id UUID,p_user_id UUID,p_type TEXT,p_subject TEXT,p_body TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_row complaints%ROWTYPE; v_scope TEXT:=COALESCE(p_company_id::TEXT,'public');
BEGIN
  IF (p_company_id IS NULL)<>(p_user_id IS NULL) THEN RAISE EXCEPTION 'هوية مقدم الشكوى غير صالحة'; END IF;
  IF p_company_id IS NOT NULL THEN PERFORM assert_communication_actor(p_company_id,p_user_id,FALSE); END IF;
  IF p_type NOT IN('complaint','suggestion')
    OR LENGTH(BTRIM(COALESCE(p_subject,''))) NOT BETWEEN 1 AND 200
    OR LENGTH(BTRIM(COALESCE(p_body,''))) NOT BETWEEN 1 AND 5000
  THEN RAISE EXCEPTION 'بيانات الشكوى غير صالحة'; END IF;
  PERFORM set_config('app.complaint_write_scope',v_scope,TRUE);
  INSERT INTO complaints(company_id,user_id,type,subject,body,status)
  VALUES(p_company_id,p_user_id,p_type,BTRIM(p_subject),BTRIM(p_body),'pending') RETURNING * INTO v_row;
  IF p_company_id IS NOT NULL THEN
    INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
    VALUES(p_company_id,p_user_id,'create','complaint',v_row.id,jsonb_build_object('type',p_type,'subject',v_row.subject));
  END IF;
  RETURN jsonb_build_object('id',v_row.id,'type',v_row.type,'subject',v_row.subject,'body',v_row.body,
    'status',v_row.status,'created_at',v_row.created_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_company_complaint_atomic(
  p_company_id UUID,p_user_id UUID,p_complaint_id UUID,p_patch JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old complaints%ROWTYPE; v_row complaints%ROWTYPE; v_role TEXT;
BEGIN
  v_role:=assert_communication_actor(p_company_id,p_user_id,FALSE);
  IF p_patch IS NULL OR jsonb_typeof(p_patch)<>'object' OR p_patch='{}'::JSONB
  THEN RAISE EXCEPTION 'بيانات تحديث الشكوى غير صالحة'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_patch) key WHERE key NOT IN('subject','body','status'))
    OR (p_patch?'subject' AND (jsonb_typeof(p_patch->'subject')<>'string'
      OR LENGTH(BTRIM(p_patch->>'subject')) NOT BETWEEN 1 AND 200))
    OR (p_patch?'body' AND (jsonb_typeof(p_patch->'body')<>'string'
      OR LENGTH(BTRIM(p_patch->>'body')) NOT BETWEEN 1 AND 5000))
    OR (p_patch?'status' AND (jsonb_typeof(p_patch->'status')<>'string' OR p_patch->>'status'<>'closed'))
  THEN RAISE EXCEPTION 'بيانات تحديث الشكوى غير صالحة'; END IF;
  SELECT * INTO v_old FROM complaints
  WHERE id=p_complaint_id AND company_id=p_company_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR (v_old.user_id IS DISTINCT FROM p_user_id AND v_role<>'admin')
  THEN RAISE EXCEPTION 'الشكوى غير موجودة'; END IF;
  IF (p_patch?'subject' OR p_patch?'body') AND v_old.status<>'pending'
  THEN RAISE EXCEPTION 'لا يمكن تعديل شكوى قيد المعالجة'; END IF;
  PERFORM set_config('app.complaint_write_scope',p_company_id::TEXT,TRUE);
  UPDATE complaints SET
    subject=CASE WHEN p_patch?'subject' THEN BTRIM(p_patch->>'subject') ELSE subject END,
    body=CASE WHEN p_patch?'body' THEN BTRIM(p_patch->>'body') ELSE body END,
    status=CASE WHEN p_patch?'status' THEN 'closed' ELSE status END,updated_at=NOW()
  WHERE id=p_complaint_id RETURNING * INTO v_row;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'update','complaint',p_complaint_id,to_jsonb(v_old),to_jsonb(v_row));
  RETURN to_jsonb(v_row)-'deleted_at';
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_company_complaint_atomic(
  p_company_id UUID,p_user_id UUID,p_complaint_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old complaints%ROWTYPE; v_role TEXT;
BEGIN
  v_role:=assert_communication_actor(p_company_id,p_user_id,FALSE);
  SELECT * INTO v_old FROM complaints WHERE id=p_complaint_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND OR (v_old.user_id IS DISTINCT FROM p_user_id AND v_role<>'admin')
  THEN RAISE EXCEPTION 'الشكوى غير موجودة'; END IF;
  IF v_old.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('id',p_complaint_id,'archived',TRUE,'already_processed',TRUE);
  END IF;
  PERFORM set_config('app.complaint_write_scope',p_company_id::TEXT,TRUE);
  UPDATE complaints SET deleted_at=NOW(),updated_at=NOW() WHERE id=p_complaint_id;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'archive','complaint',p_complaint_id,to_jsonb(v_old),jsonb_build_object('deleted_at',NOW()));
  RETURN jsonb_build_object('id',p_complaint_id,'archived',TRUE,'already_processed',FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_approval_request_atomic(
  p_company_id UUID,p_entity_type TEXT,p_entity_id UUID,p_description TEXT,p_requester_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_amount NUMERIC:=0; v_role TEXT; v_approver UUID; v_request approval_requests%ROWTYPE;
BEGIN
  PERFORM assert_communication_actor(p_company_id,p_requester_id,FALSE);
  IF p_entity_type NOT IN('journal_entry','purchase_invoice','payroll','cash_transaction')
    OR LENGTH(COALESCE(p_description,''))>2000 THEN RAISE EXCEPTION 'نوع طلب الاعتماد غير مدعوم'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_company_id::TEXT||':approval:'||p_entity_type||':'||p_entity_id::TEXT,0));
  IF p_entity_type='journal_entry' THEN
    PERFORM 1 FROM journal_entries WHERE id=p_entity_id AND company_id=p_company_id
      AND deleted_at IS NULL AND reversed_by IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'العنصر المطلوب اعتماده غير موجود'; END IF;
    SELECT COALESCE(SUM(debit),0) INTO v_amount FROM journal_lines WHERE journal_entry_id=p_entity_id AND company_id=p_company_id;
    v_role:='manager';
  ELSIF p_entity_type='purchase_invoice' THEN
    SELECT total INTO v_amount FROM purchase_invoices WHERE id=p_entity_id AND company_id=p_company_id AND status<>'cancelled' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'العنصر المطلوب اعتماده غير موجود'; END IF;
    v_role:='manager';
  ELSIF p_entity_type='payroll' THEN
    PERFORM 1 FROM salary_sheets WHERE id=p_entity_id AND company_id=p_company_id AND status='draft' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'كشف الرواتب غير موجود أو غير قابل للاعتماد'; END IF;
    SELECT COALESCE(SUM(net_pay),0) INTO v_amount FROM salary_items WHERE sheet_id=p_entity_id AND company_id=p_company_id;
    v_role:='admin';
  ELSE
    SELECT amount INTO v_amount FROM cash_transactions WHERE id=p_entity_id AND company_id=p_company_id AND status<>'cancelled' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'العنصر المطلوب اعتماده غير موجود'; END IF;
    v_role:=CASE WHEN v_amount>50000 THEN 'admin' ELSE 'manager' END;
  END IF;
  SELECT id INTO v_approver FROM users WHERE company_id=p_company_id AND role=v_role AND is_active=TRUE AND id<>p_requester_id
    ORDER BY created_at,id LIMIT 1;
  IF v_approver IS NULL AND v_role<>'admin' THEN
    SELECT id INTO v_approver FROM users WHERE company_id=p_company_id AND role='admin' AND is_active=TRUE AND id<>p_requester_id
      ORDER BY created_at,id LIMIT 1;
  END IF;
  IF v_approver IS NULL THEN RAISE EXCEPTION 'لا يوجد معتمد مستقل لهذا الطلب'; END IF;
  IF EXISTS(SELECT 1 FROM approval_requests WHERE company_id=p_company_id AND entity_type=p_entity_type
    AND entity_id=p_entity_id AND status IN('pending','processing')) THEN RAISE EXCEPTION 'يوجد طلب اعتماد قائم'; END IF;
  IF EXISTS(SELECT 1 FROM approval_requests WHERE company_id=p_company_id AND entity_type=p_entity_type
    AND entity_id=p_entity_id AND status='approved') THEN RAISE EXCEPTION 'سبق اعتماد هذا العنصر'; END IF;
  IF p_entity_type='journal_entry' THEN
    UPDATE journal_entries SET status='pending' WHERE id=p_entity_id AND company_id=p_company_id;
  ELSIF p_entity_type='payroll' THEN
    UPDATE salary_sheets SET status='pending' WHERE id=p_entity_id AND company_id=p_company_id;
  ELSIF p_entity_type='purchase_invoice' THEN
    UPDATE purchase_invoices SET approval_status='pending' WHERE id=p_entity_id AND company_id=p_company_id;
  ELSE
    UPDATE cash_transactions SET approval_status='pending' WHERE id=p_entity_id AND company_id=p_company_id;
  END IF;
  INSERT INTO approval_requests(company_id,entity_type,entity_id,transaction_type,transaction_id,amount,description,message,
    requester_id,approver_id,status)
  VALUES(p_company_id,p_entity_type,p_entity_id,p_entity_type,p_entity_id::TEXT,ROUND(v_amount,2),NULLIF(BTRIM(p_description),''),
    NULLIF(BTRIM(p_description),''),p_requester_id,v_approver,'pending') RETURNING * INTO v_request;
  INSERT INTO notifications(company_id,user_id,type,title,message,entity_type,entity_id)
  VALUES(p_company_id,v_approver,'approval_request','طلب اعتماد جديد',
    LEFT('طلب اعتماد '||p_entity_type||' بمبلغ '||ROUND(v_amount,2)::TEXT,1000),'approval_request',v_request.id);
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_requester_id,'create','approval_request',v_request.id,to_jsonb(v_request));
  RETURN to_jsonb(v_request);
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_voucher_disbursement_approval(
  p_company_id UUID,p_approval_id UUID,p_action TEXT,p_approver_user_id UUID,p_approver_chat_id TEXT,p_comments TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_request approval_requests%ROWTYPE;
BEGIN
  IF p_approver_user_id IS NULL THEN RAISE EXCEPTION 'هوية مستخدم المعتمد الموثوقة مطلوبة'; END IF;
  SELECT * INTO v_request FROM approval_requests
  WHERE id=p_approval_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'طلب الاعتماد غير موجود'; END IF;
  RETURN respond_voucher_disbursement_approval_v49_internal(
    p_company_id,p_approval_id,p_action,p_approver_user_id,p_approver_chat_id,p_comments
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_voucher_receipt_approval(
  p_company_id UUID,p_approval_id UUID,p_action TEXT,p_approver_user_id UUID,p_approver_chat_id TEXT,p_comments TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_request approval_requests%ROWTYPE;
BEGIN
  IF p_approver_user_id IS NULL THEN RAISE EXCEPTION 'هوية مستخدم المعتمد الموثوقة مطلوبة'; END IF;
  SELECT * INTO v_request FROM approval_requests
  WHERE id=p_approval_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'طلب الاعتماد غير موجود'; END IF;
  RETURN respond_voucher_receipt_approval_v49_internal(
    p_company_id,p_approval_id,p_action,p_approver_user_id,p_approver_chat_id,p_comments
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_approval_request_atomic(
  p_company_id UUID,p_approval_id UUID,p_action TEXT,p_approver_user_id UUID,p_comments TEXT DEFAULT ''
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_request approval_requests%ROWTYPE; v_type TEXT; v_entity UUID; v_result JSONB; v_status TEXT;
BEGIN
  SELECT * INTO v_request FROM approval_requests
  WHERE id=p_approval_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'طلب الاعتماد غير موجود'; END IF;
  v_type:=COALESCE(v_request.entity_type,v_request.transaction_type);
  BEGIN v_entity:=COALESCE(v_request.entity_id,v_request.transaction_id::UUID);
  EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'معرف العنصر غير صالح'; END;
  v_result:=respond_approval_request_v50_internal(
    p_company_id,p_approval_id,p_action,p_approver_user_id,p_comments
  );
  v_status:=v_result->>'status';
  IF COALESCE((v_result->>'replayed')::BOOLEAN,FALSE) THEN
    RETURN v_result||jsonb_build_object('entity_approval_status',v_status);
  END IF;
  IF v_type='journal_entry' AND v_status='rejected' THEN
    PERFORM post_journal_reversal(p_company_id,v_entity,'approval_rejection',p_approval_id,
      'عكس قيد مرفوض في دورة الاعتماد',p_approver_user_id);
    UPDATE journal_entries SET status='rejected' WHERE id=v_entity AND company_id=p_company_id;
  ELSIF v_type='payroll' AND v_status='rejected' THEN
    UPDATE salary_sheets SET status='rejected' WHERE id=v_entity AND company_id=p_company_id;
  ELSIF v_type='purchase_invoice' THEN
    IF v_status='rejected' THEN
      PERFORM cancel_purchase_invoice_atomic(p_company_id,v_entity,'رفض عبر دورة الاعتماد',p_approver_user_id);
    END IF;
    UPDATE purchase_invoices SET approval_status=v_status WHERE id=v_entity AND company_id=p_company_id;
  ELSIF v_type='cash_transaction' THEN
    IF v_status='rejected' THEN
      PERFORM cancel_cash_transaction(p_company_id,v_entity,p_approver_user_id);
    END IF;
    UPDATE cash_transactions SET approval_status=v_status WHERE id=v_entity AND company_id=p_company_id;
  END IF;
  RETURN v_result||jsonb_build_object('entity_approval_status',v_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_approval_by_telegram_atomic(
  p_approval_id UUID,p_action TEXT,p_chat_id TEXT,p_comments TEXT DEFAULT ''
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_request approval_requests%ROWTYPE; v_actor UUID; v_type TEXT; v_result JSONB;
BEGIN
  IF p_action NOT IN('approve','reject') OR LENGTH(COALESCE(p_comments,''))>2000 OR NULLIF(p_chat_id,'') IS NULL
  THEN RAISE EXCEPTION 'قرار الاعتماد غير صالح'; END IF;
  SELECT * INTO v_request FROM approval_requests WHERE id=p_approval_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'طلب الاعتماد غير موجود'; END IF;
  SELECT configured_by INTO v_actor FROM company_telegram_configs
    WHERE company_id=v_request.company_id AND is_enabled=TRUE AND approvals_enabled=TRUE AND chat_id=p_chat_id FOR UPDATE;
  IF v_actor IS NULL OR NOT EXISTS(SELECT 1 FROM users WHERE id=v_actor AND company_id=v_request.company_id AND is_active=TRUE AND role='admin')
  THEN RAISE EXCEPTION 'إعدادات تيليجرام تحتاج إلى إعادة حفظ بواسطة مدير نشط'; END IF;
  v_type:=COALESCE(v_request.entity_type,v_request.transaction_type);
  IF v_type='voucher_disbursement' THEN
    v_result:=respond_voucher_disbursement_approval(v_request.company_id,p_approval_id,p_action,v_actor,p_chat_id,p_comments);
  ELSIF v_type='voucher_receipt' THEN
    v_result:=respond_voucher_receipt_approval(v_request.company_id,p_approval_id,p_action,v_actor,p_chat_id,p_comments);
  ELSE
    v_result:=respond_approval_request_atomic(v_request.company_id,p_approval_id,p_action,v_actor,p_comments)
      ||jsonb_build_object('approver_chat_id',p_chat_id);
    UPDATE approval_requests SET approver_chat_id=p_chat_id WHERE id=p_approval_id;
  END IF;
  RETURN v_result||jsonb_build_object('company_id',v_request.company_id,'requester_id',v_request.requester_id,'entity_type',v_type);
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_legacy_approval_by_telegram_atomic(
  p_action TEXT,p_transaction_type TEXT,p_transaction_id UUID,p_chat_id TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id UUID;
BEGIN
  SELECT ar.id INTO v_id FROM approval_requests ar JOIN company_telegram_configs c ON c.company_id=ar.company_id
  WHERE c.chat_id=p_chat_id AND c.is_enabled=TRUE AND c.approvals_enabled=TRUE
    AND COALESCE(ar.entity_type,ar.transaction_type)=p_transaction_type
    AND COALESCE(ar.entity_id::TEXT,ar.transaction_id)=p_transaction_id::TEXT
    AND ar.status IN('pending','processing')
  ORDER BY ar.created_at DESC LIMIT 1;
  IF v_id IS NULL THEN RAISE EXCEPTION 'طلب الاعتماد غير موجود'; END IF;
  RETURN respond_approval_by_telegram_atomic(v_id,p_action,p_chat_id,'');
END;
$$;

CREATE OR REPLACE FUNCTION public.save_telegram_config_atomic(
  p_company_id UUID,p_user_id UUID,p_payload JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_chat TEXT; v_threshold NUMERIC; v_row company_telegram_configs%ROWTYPE;
BEGIN
  PERFORM assert_communication_actor(p_company_id,p_user_id,TRUE);
  IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN(
    'chat_id','is_enabled','notify_invoices','notify_cash_transactions','notify_user_logins','approvals_enabled','approval_threshold'))
  THEN RAISE EXCEPTION 'إعدادات تيليجرام غير صالحة'; END IF;
  BEGIN v_threshold:=COALESCE((p_payload->>'approval_threshold')::NUMERIC,0);
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'حد الموافقة غير صالح'; END;
  v_chat:=BTRIM(COALESCE(p_payload->>'chat_id',''));
  IF (v_chat<>'' AND v_chat!~'^-?[0-9]{1,20}$') OR v_threshold<0 OR v_threshold<>ROUND(v_threshold,2)
    OR (COALESCE((p_payload->>'is_enabled')::BOOLEAN,FALSE) OR COALESCE((p_payload->>'approvals_enabled')::BOOLEAN,FALSE)) AND v_chat=''
  THEN RAISE EXCEPTION 'إعدادات تيليجرام غير صالحة'; END IF;
  PERFORM set_config('app.communication_write_company',p_company_id::TEXT,TRUE);
  INSERT INTO company_telegram_configs(company_id,chat_id,is_enabled,notify_invoices,notify_cash_transactions,
    notify_user_logins,approvals_enabled,approval_threshold,configured_by,updated_at)
  VALUES(p_company_id,NULLIF(v_chat,''),COALESCE((p_payload->>'is_enabled')::BOOLEAN,FALSE),
    COALESCE((p_payload->>'notify_invoices')::BOOLEAN,FALSE),COALESCE((p_payload->>'notify_cash_transactions')::BOOLEAN,FALSE),
    COALESCE((p_payload->>'notify_user_logins')::BOOLEAN,FALSE),COALESCE((p_payload->>'approvals_enabled')::BOOLEAN,FALSE),
    v_threshold,p_user_id,NOW())
  ON CONFLICT(company_id) DO UPDATE SET chat_id=EXCLUDED.chat_id,is_enabled=EXCLUDED.is_enabled,
    notify_invoices=EXCLUDED.notify_invoices,notify_cash_transactions=EXCLUDED.notify_cash_transactions,
    notify_user_logins=EXCLUDED.notify_user_logins,approvals_enabled=EXCLUDED.approvals_enabled,
    approval_threshold=EXCLUDED.approval_threshold,configured_by=EXCLUDED.configured_by,updated_at=NOW()
  RETURNING * INTO v_row;
  INSERT INTO security_audit_log(company_id,user_id,action,details)
  VALUES(p_company_id,p_user_id,'telegram_config_updated',jsonb_build_object('is_enabled',v_row.is_enabled,'approvals_enabled',v_row.approvals_enabled));
  RETURN to_jsonb(v_row)-'reset_session_data';
END;
$$;

CREATE OR REPLACE FUNCTION public.create_telegram_test_run_atomic(p_company_id UUID,p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_config company_telegram_configs%ROWTYPE; v_run telegram_test_runs%ROWTYPE;
BEGIN
  PERFORM assert_communication_actor(p_company_id,p_user_id,TRUE);
  SELECT * INTO v_config FROM company_telegram_configs WHERE company_id=p_company_id AND is_enabled=TRUE AND NULLIF(chat_id,'') IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'إعدادات تيليجرام غير مفعلة'; END IF;
  IF v_config.configured_by IS NULL OR NOT EXISTS(
    SELECT 1 FROM users WHERE id=v_config.configured_by AND company_id=p_company_id AND is_active=TRUE AND role='admin'
  ) THEN RAISE EXCEPTION 'إعدادات تيليجرام تحتاج إلى إعادة حفظ بواسطة مدير نشط'; END IF;
  PERFORM set_config('app.communication_write_company',p_company_id::TEXT,TRUE);
  UPDATE telegram_test_runs SET status='expired',updated_at=NOW()
  WHERE company_id=p_company_id AND status='pending' AND created_at<NOW()-INTERVAL '2 minutes';
  IF EXISTS(SELECT 1 FROM telegram_test_runs WHERE company_id=p_company_id AND status='pending')
  THEN RAISE EXCEPTION 'يوجد فحص تيليجرام قيد التنفيذ'; END IF;
  INSERT INTO telegram_test_runs(company_id,status,created_by) VALUES(p_company_id,'pending',p_user_id) RETURNING * INTO v_run;
  INSERT INTO security_audit_log(company_id,user_id,action,details)
  VALUES(p_company_id,p_user_id,'telegram_test_started',jsonb_build_object('test_run_id',v_run.id));
  RETURN jsonb_build_object('id',v_run.id,'chat_id',v_config.chat_id,'status',v_run.status);
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_telegram_test_run_atomic(p_test_run_id UUID,p_chat_id TEXT,p_action TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_run telegram_test_runs%ROWTYPE; v_actor UUID;
BEGIN
  IF p_action NOT IN('accept','reject') THEN RAISE EXCEPTION 'إجراء الفحص غير صالح'; END IF;
  SELECT * INTO v_run FROM telegram_test_runs WHERE id=p_test_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.status<>'pending' THEN RAISE EXCEPTION 'انتهى الفحص أو تمت معالجته'; END IF;
  SELECT configured_by INTO v_actor FROM company_telegram_configs
  WHERE company_id=v_run.company_id AND is_enabled=TRUE AND chat_id=p_chat_id FOR UPDATE;
  IF v_actor IS NULL OR NOT EXISTS(
    SELECT 1 FROM users WHERE id=v_actor AND company_id=v_run.company_id AND is_active=TRUE AND role='admin'
  ) THEN RAISE EXCEPTION 'حساب تيليجرام غير مخول'; END IF;
  PERFORM set_config('app.communication_write_company',v_run.company_id::TEXT,TRUE);
  UPDATE telegram_test_runs SET status=CASE WHEN p_action='accept' THEN 'accepted' ELSE 'rejected' END,updated_at=NOW()
  WHERE id=p_test_run_id RETURNING * INTO v_run;
  INSERT INTO security_audit_log(company_id,user_id,action,details)
  VALUES(v_run.company_id,v_actor,'telegram_test_finished',jsonb_build_object('test_run_id',v_run.id,'status',v_run.status));
  RETURN to_jsonb(v_run);
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_telegram_test_run_atomic(p_company_id UUID,p_test_run_id UUID,p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_run telegram_test_runs%ROWTYPE;
BEGIN
  PERFORM assert_communication_actor(p_company_id,p_user_id,TRUE);
  SELECT * INTO v_run FROM telegram_test_runs WHERE id=p_test_run_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الفحص غير موجود'; END IF;
  PERFORM set_config('app.communication_write_company',p_company_id::TEXT,TRUE);
  UPDATE telegram_test_runs SET status='expired',updated_at=NOW() WHERE id=p_test_run_id AND status='pending' RETURNING * INTO v_run;
  RETURN COALESCE(to_jsonb(v_run),jsonb_build_object('id',p_test_run_id,'already_processed',TRUE));
END;
$$;

CREATE OR REPLACE FUNCTION public.start_telegram_reset_session_atomic(p_company_id UUID,p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_config company_telegram_configs%ROWTYPE; v_step TEXT; v_live BOOLEAN:=FALSE;
BEGIN
  PERFORM assert_communication_actor(p_company_id,p_user_id,TRUE);
  SELECT * INTO v_config FROM company_telegram_configs
  WHERE company_id=p_company_id AND is_enabled=TRUE AND NULLIF(chat_id,'') IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'إعدادات تيليجرام غير مفعلة'; END IF;
  IF v_config.configured_by IS NULL OR NOT EXISTS(
    SELECT 1 FROM users WHERE id=v_config.configured_by AND company_id=p_company_id AND is_active=TRUE AND role='admin'
  ) THEN RAISE EXCEPTION 'إعدادات تيليجرام تحتاج إلى إعادة حفظ بواسطة مدير نشط'; END IF;
  IF v_config.reset_session_data IS NOT NULL THEN
    v_step:=v_config.reset_session_data->>'step';
    BEGIN
      v_live:=(v_step='pending_telegram_approval' AND (v_config.reset_session_data->>'requested_at')::TIMESTAMPTZ>NOW()-INTERVAL '10 minutes')
        OR (v_step='approved_and_code_sent' AND (v_config.reset_session_data->>'expires_at')::TIMESTAMPTZ>NOW());
    EXCEPTION WHEN OTHERS THEN v_live:=FALSE; END;
    IF v_live THEN RAISE EXCEPTION 'يوجد طلب تصفير قائم'; END IF;
  END IF;
  PERFORM set_config('app.communication_write_company',p_company_id::TEXT,TRUE);
  UPDATE company_telegram_configs SET reset_session_data=jsonb_build_object(
    'step','pending_telegram_approval','requested_at',NOW(),'requester_id',p_user_id),updated_at=NOW()
  WHERE company_id=p_company_id;
  INSERT INTO security_audit_log(company_id,user_id,action,details)
  VALUES(p_company_id,p_user_id,'telegram_reset_requested',jsonb_build_object('requested_at',NOW()));
  RETURN jsonb_build_object('company_id',p_company_id,'chat_id',v_config.chat_id,'step','pending_telegram_approval');
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_telegram_reset_session_atomic(
  p_chat_id TEXT,p_code_hash TEXT,p_expires_at TIMESTAMPTZ
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_config company_telegram_configs%ROWTYPE; v_session JSONB; v_actor UUID; v_requester UUID; v_requested_at TIMESTAMPTZ;
BEGIN
  IF NULLIF(BTRIM(p_chat_id),'') IS NULL OR p_code_hash!~'^[0-9a-f]{64}$'
    OR p_expires_at<=NOW() OR p_expires_at>NOW()+INTERVAL '10 minutes'
  THEN RAISE EXCEPTION 'بيانات الرمز غير صالحة'; END IF;
  SELECT * INTO v_config FROM company_telegram_configs
  WHERE is_enabled=TRUE AND chat_id=p_chat_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'حساب تيليجرام غير مخول'; END IF;
  v_session:=v_config.reset_session_data; v_actor:=v_config.configured_by;
  IF v_actor IS NULL OR NOT EXISTS(
    SELECT 1 FROM users WHERE id=v_actor AND company_id=v_config.company_id AND is_active=TRUE AND role='admin'
  ) THEN RAISE EXCEPTION 'إعدادات تيليجرام تحتاج إلى إعادة حفظ بواسطة مدير نشط'; END IF;
  BEGIN
    v_requester:=(v_session->>'requester_id')::UUID;
    v_requested_at:=(v_session->>'requested_at')::TIMESTAMPTZ;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'طلب التصفير منتهٍ أو غير صالح'; END;
  IF v_session IS NULL OR v_session->>'step'<>'pending_telegram_approval'
    OR v_requested_at<NOW()-INTERVAL '10 minutes'
    OR NOT EXISTS(SELECT 1 FROM users WHERE id=v_requester AND company_id=v_config.company_id AND is_active=TRUE AND role='admin')
  THEN RAISE EXCEPTION 'طلب التصفير منتهٍ أو غير صالح'; END IF;
  PERFORM set_config('app.communication_write_company',v_config.company_id::TEXT,TRUE);
  UPDATE company_telegram_configs SET reset_session_data=jsonb_build_object(
    'step','approved_and_code_sent','code_hash',p_code_hash,'attempts',0,'requester_id',v_requester,
    'expires_at',p_expires_at,'approved_by_chat_id',p_chat_id),updated_at=NOW()
  WHERE company_id=v_config.company_id;
  INSERT INTO security_audit_log(company_id,user_id,action,details)
  VALUES(v_config.company_id,v_actor,'telegram_reset_approved',jsonb_build_object('requester_id',v_requester));
  RETURN jsonb_build_object('company_id',v_config.company_id,'requester_id',v_requester,'status','approved');
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_telegram_reset_session_atomic(p_chat_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_config company_telegram_configs%ROWTYPE; v_actor UUID;
BEGIN
  SELECT * INTO v_config FROM company_telegram_configs
  WHERE is_enabled=TRUE AND chat_id=p_chat_id FOR UPDATE;
  IF NOT FOUND OR v_config.reset_session_data IS NULL
    OR v_config.reset_session_data->>'step'<>'pending_telegram_approval'
  THEN RAISE EXCEPTION 'لا يوجد طلب صالح'; END IF;
  v_actor:=v_config.configured_by;
  IF v_actor IS NULL OR NOT EXISTS(
    SELECT 1 FROM users WHERE id=v_actor AND company_id=v_config.company_id AND is_active=TRUE AND role='admin'
  ) THEN RAISE EXCEPTION 'إعدادات تيليجرام تحتاج إلى إعادة حفظ بواسطة مدير نشط'; END IF;
  PERFORM set_config('app.communication_write_company',v_config.company_id::TEXT,TRUE);
  UPDATE company_telegram_configs SET reset_session_data=NULL,updated_at=NOW() WHERE company_id=v_config.company_id;
  INSERT INTO security_audit_log(company_id,user_id,action,details)
  VALUES(v_config.company_id,v_actor,'telegram_reset_rejected',jsonb_build_object('date',NOW()));
  RETURN jsonb_build_object('company_id',v_config.company_id,'status','rejected');
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_telegram_reset_session_atomic(
  p_company_id UUID,p_requester_id UUID,p_reason TEXT DEFAULT 'cancelled_by_requester'
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_session JSONB;
BEGIN
  PERFORM assert_communication_actor(p_company_id,p_requester_id,TRUE);
  IF LENGTH(COALESCE(p_reason,'')) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'سبب الإلغاء غير صالح'; END IF;
  SELECT reset_session_data INTO v_session FROM company_telegram_configs WHERE company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'إعدادات تيليجرام غير موجودة'; END IF;
  IF v_session IS NOT NULL AND COALESCE(v_session->>'requester_id','')<>p_requester_id::TEXT
  THEN RAISE EXCEPTION 'لا يمكنك إلغاء طلب مستخدم آخر'; END IF;
  PERFORM set_config('app.communication_write_company',p_company_id::TEXT,TRUE);
  UPDATE company_telegram_configs SET reset_session_data=NULL,updated_at=NOW() WHERE company_id=p_company_id;
  INSERT INTO security_audit_log(company_id,user_id,action,details)
  VALUES(p_company_id,p_requester_id,'telegram_reset_cancelled',jsonb_build_object('reason',p_reason));
  RETURN jsonb_build_object('company_id',p_company_id,'cancelled',TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_push_subscription_atomic(
  p_company_id UUID,p_user_id UUID,p_endpoint TEXT,p_p256dh TEXT,p_auth TEXT,p_user_agent TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_row push_subscriptions%ROWTYPE;
BEGIN
  PERFORM assert_communication_actor(p_company_id,p_user_id,FALSE);
  IF p_endpoint NOT LIKE 'https://%' OR LENGTH(p_endpoint)>4096 OR LENGTH(COALESCE(p_p256dh,'')) NOT BETWEEN 1 AND 2048
    OR LENGTH(COALESCE(p_auth,'')) NOT BETWEEN 1 AND 1024 OR LENGTH(COALESCE(p_user_agent,''))>1000
  THEN RAISE EXCEPTION 'اشتراك الإشعارات غير صالح'; END IF;
  SELECT * INTO v_row FROM push_subscriptions WHERE endpoint=p_endpoint FOR UPDATE;
  IF FOUND AND (v_row.company_id<>p_company_id OR v_row.user_id<>p_user_id) THEN RAISE EXCEPTION 'اشتراك الإشعارات غير صالح'; END IF;
  PERFORM set_config('app.communication_write_company',p_company_id::TEXT,TRUE);
  INSERT INTO push_subscriptions(user_id,company_id,endpoint,p256dh_key,auth_key,user_agent,is_active)
  VALUES(p_user_id,p_company_id,p_endpoint,p_p256dh,p_auth,NULLIF(p_user_agent,''),TRUE)
  ON CONFLICT(endpoint) DO UPDATE SET p256dh_key=EXCLUDED.p256dh_key,auth_key=EXCLUDED.auth_key,
    user_agent=EXCLUDED.user_agent,is_active=TRUE,updated_at=NOW() RETURNING * INTO v_row;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'subscribe','push_subscription',v_row.id,jsonb_build_object('is_active',TRUE));
  RETURN jsonb_build_object('id',v_row.id,'is_active',v_row.is_active);
END;
$$;

CREATE OR REPLACE FUNCTION public.deactivate_push_subscription_atomic(
  p_company_id UUID,p_user_id UUID,p_endpoint TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_row push_subscriptions%ROWTYPE;
BEGIN
  PERFORM assert_communication_actor(p_company_id,p_user_id,FALSE);
  SELECT * INTO v_row FROM push_subscriptions WHERE endpoint=p_endpoint AND company_id=p_company_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الاشتراك غير موجود'; END IF;
  PERFORM set_config('app.communication_write_company',p_company_id::TEXT,TRUE);
  UPDATE push_subscriptions SET is_active=FALSE,updated_at=NOW() WHERE id=v_row.id;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'unsubscribe','push_subscription',v_row.id,jsonb_build_object('is_active',v_row.is_active),jsonb_build_object('is_active',FALSE));
  RETURN jsonb_build_object('id',v_row.id,'unsubscribed',TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.queue_push_notifications_atomic(
  p_company_id UUID,p_user_id UUID,p_payload JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_role TEXT; v_target UUID; v_target_role TEXT; v_user RECORD; v_sub RECORD; v_action JSONB; v_notification UUID; v_users INTEGER:=0; v_queued INTEGER:=0;
BEGIN
  v_role:=assert_communication_actor(p_company_id,p_user_id,FALSE);
  IF v_role NOT IN('admin','manager') THEN RAISE EXCEPTION 'المستخدم غير مخول'; END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN(
    'title','message','url','target_user_id','target_role','tag','actions'))
    OR LENGTH(BTRIM(COALESCE(p_payload->>'title',''))) NOT BETWEEN 1 AND 200
    OR LENGTH(BTRIM(COALESCE(p_payload->>'message',''))) NOT BETWEEN 1 AND 2000
    OR LEFT(COALESCE(p_payload->>'url','/dashboard'),1)<>'/' OR LEFT(COALESCE(p_payload->>'url','/dashboard'),2)='//'
    OR LENGTH(COALESCE(p_payload->>'url',''))>2000 OR LENGTH(COALESCE(p_payload->>'tag',''))>200
    OR (p_payload?'target_user_id' AND p_payload?'target_role')
  THEN RAISE EXCEPTION 'بيانات الإشعار غير صالحة'; END IF;
  IF p_payload?'actions' THEN
    IF jsonb_typeof(p_payload->'actions')<>'array' OR jsonb_array_length(p_payload->'actions')>5
    THEN RAISE EXCEPTION 'إجراءات الإشعار غير صالحة'; END IF;
    FOR v_action IN SELECT value FROM jsonb_array_elements(p_payload->'actions') LOOP
      IF jsonb_typeof(v_action)<>'object' THEN RAISE EXCEPTION 'إجراءات الإشعار غير صالحة'; END IF;
      IF EXISTS(SELECT 1 FROM jsonb_object_keys(v_action) key WHERE key NOT IN('action','title','icon'))
        OR LENGTH(BTRIM(COALESCE(v_action->>'action',''))) NOT BETWEEN 1 AND 80
        OR LENGTH(BTRIM(COALESCE(v_action->>'title',''))) NOT BETWEEN 1 AND 120
        OR LENGTH(COALESCE(v_action->>'icon',''))>500
      THEN RAISE EXCEPTION 'إجراءات الإشعار غير صالحة'; END IF;
    END LOOP;
  END IF;
  BEGIN v_target:=NULLIF(p_payload->>'target_user_id','')::UUID;
  EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'المستخدم المستهدف غير صالح'; END;
  v_target_role:=NULLIF(p_payload->>'target_role','');
  IF v_target_role IS NOT NULL AND v_target_role NOT IN('admin','manager','accountant','supervisor') THEN RAISE EXCEPTION 'الدور المستهدف غير صالح'; END IF;
  IF v_target IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=v_target AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم المستهدف غير موجود'; END IF;
  PERFORM set_config('app.communication_write_company',p_company_id::TEXT,TRUE);
  FOR v_user IN SELECT id FROM users WHERE company_id=p_company_id AND is_active=TRUE
    AND (v_target IS NULL OR id=v_target) AND (v_target_role IS NULL OR role=v_target_role)
  LOOP
    v_users:=v_users+1;
    INSERT INTO notifications(company_id,user_id,type,title,message,link,entity_type)
    VALUES(p_company_id,v_user.id,'push',BTRIM(p_payload->>'title'),BTRIM(p_payload->>'message'),
      COALESCE(NULLIF(p_payload->>'url',''),'/dashboard'),'push_notification') RETURNING id INTO v_notification;
    FOR v_sub IN SELECT id FROM push_subscriptions WHERE company_id=p_company_id AND user_id=v_user.id AND is_active=TRUE FOR UPDATE
    LOOP
      INSERT INTO push_notification_log(company_id,subscription_id,user_id,title,body,url,tag,actions,status)
      VALUES(p_company_id,v_sub.id,v_user.id,BTRIM(p_payload->>'title'),BTRIM(p_payload->>'message'),
        COALESCE(NULLIF(p_payload->>'url',''),'/dashboard'),NULLIF(p_payload->>'tag',''),
        CASE WHEN p_payload?'actions' THEN (p_payload->'actions')::TEXT ELSE NULL END,'queued');
      v_queued:=v_queued+1;
    END LOOP;
  END LOOP;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,new_values)
  VALUES(p_company_id,p_user_id,'queue','push_notification',jsonb_build_object('users',v_users,'subscriptions',v_queued));
  RETURN jsonb_build_object('users',v_users,'queued',v_queued);
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_communication_writes()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_company UUID:=CASE WHEN TG_OP='DELETE' THEN OLD.company_id ELSE NEW.company_id END;
BEGIN
  IF current_setting('app.business_data_reset',TRUE)=v_company::TEXT THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
  IF current_setting('app.communication_write_company',TRUE) IS DISTINCT FROM v_company::TEXT THEN RAISE EXCEPTION 'communication records require audited functions'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF TG_OP='UPDATE' AND NEW.company_id IS DISTINCT FROM OLD.company_id THEN RAISE EXCEPTION 'communication tenant cannot change'; END IF;
  IF TG_TABLE_NAME='messages' THEN
    IF NEW.company_id IS NULL OR LENGTH(BTRIM(NEW.subject)) NOT BETWEEN 1 AND 200 OR LENGTH(BTRIM(NEW.body)) NOT BETWEEN 1 AND 5000
    THEN RAISE EXCEPTION 'invalid message'; END IF;
  ELSIF TG_TABLE_NAME='company_telegram_configs' THEN
    IF NEW.configured_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.configured_by AND company_id=NEW.company_id AND is_active=TRUE)
      OR NEW.approval_threshold<0 THEN RAISE EXCEPTION 'invalid telegram config'; END IF;
  ELSIF TG_TABLE_NAME='telegram_test_runs' THEN
    IF NEW.created_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.created_by AND company_id=NEW.company_id)
    THEN RAISE EXCEPTION 'invalid telegram test'; END IF;
  ELSIF TG_TABLE_NAME='push_subscriptions' THEN
    IF NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND company_id=NEW.company_id) THEN RAISE EXCEPTION 'invalid push subscription'; END IF;
  ELSE
    IF (NEW.subscription_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM push_subscriptions WHERE id=NEW.subscription_id AND company_id=NEW.company_id AND user_id=NEW.user_id))
      OR (NEW.user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND company_id=NEW.company_id))
    THEN RAISE EXCEPTION 'invalid push log'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_complaint_writes()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_company UUID:=CASE WHEN TG_OP='DELETE' THEN OLD.company_id ELSE NEW.company_id END;
  v_scope TEXT:=COALESCE(v_company::TEXT,'public');
BEGIN
  IF v_company IS NOT NULL AND current_setting('app.business_data_reset',TRUE)=v_company::TEXT
  THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
  IF current_setting('app.complaint_write_scope',TRUE) IS DISTINCT FROM v_scope
  THEN RAISE EXCEPTION 'complaint records require audited functions'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF TG_OP='UPDATE' AND NEW.company_id IS DISTINCT FROM OLD.company_id
  THEN RAISE EXCEPTION 'complaint tenant cannot change'; END IF;
  IF NEW.company_id IS NULL AND NEW.user_id IS NOT NULL THEN RAISE EXCEPTION 'invalid public complaint'; END IF;
  IF NEW.company_id IS NOT NULL AND (NEW.user_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM users WHERE id=NEW.user_id AND company_id=NEW.company_id
  )) THEN RAISE EXCEPTION 'invalid complaint actor'; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_complaint_writes ON complaints;
CREATE TRIGGER trg_guard_complaint_writes BEFORE INSERT OR UPDATE OR DELETE ON complaints FOR EACH ROW EXECUTE FUNCTION guard_complaint_writes();
DROP TRIGGER IF EXISTS trg_guard_message_writes ON messages;
CREATE TRIGGER trg_guard_message_writes BEFORE INSERT OR UPDATE OR DELETE ON messages FOR EACH ROW EXECUTE FUNCTION guard_communication_writes();
DROP TRIGGER IF EXISTS trg_guard_telegram_config_writes ON company_telegram_configs;
CREATE TRIGGER trg_guard_telegram_config_writes BEFORE INSERT OR UPDATE OR DELETE ON company_telegram_configs FOR EACH ROW EXECUTE FUNCTION guard_communication_writes();
DROP TRIGGER IF EXISTS trg_guard_telegram_test_writes ON telegram_test_runs;
CREATE TRIGGER trg_guard_telegram_test_writes BEFORE INSERT OR UPDATE OR DELETE ON telegram_test_runs FOR EACH ROW EXECUTE FUNCTION guard_communication_writes();
DROP TRIGGER IF EXISTS trg_guard_push_subscription_writes ON push_subscriptions;
CREATE TRIGGER trg_guard_push_subscription_writes BEFORE INSERT OR UPDATE OR DELETE ON push_subscriptions FOR EACH ROW EXECUTE FUNCTION guard_communication_writes();
DROP TRIGGER IF EXISTS trg_guard_push_log_writes ON push_notification_log;
CREATE TRIGGER trg_guard_push_log_writes BEFORE INSERT OR UPDATE OR DELETE ON push_notification_log FOR EACH ROW EXECUTE FUNCTION guard_communication_writes();

REVOKE ALL ON FUNCTION public.admin_send_company_message_v52_internal(UUID,UUID,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.admin_update_complaint_v52_internal(UUID,UUID,TEXT,TEXT,BOOLEAN) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.respond_approval_request_v50_internal(UUID,UUID,TEXT,UUID,TEXT) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.respond_voucher_disbursement_approval_v49_internal(UUID,UUID,TEXT,UUID,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.respond_voucher_receipt_approval_v49_internal(UUID,UUID,TEXT,UUID,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.reset_company_business_data_v56_internal(UUID,UUID,TEXT) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.assert_communication_actor(UUID,UUID,BOOLEAN) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.guard_communication_writes() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guard_complaint_writes() FROM PUBLIC,anon,authenticated;

DO $$ DECLARE sig REGPROCEDURE; BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'admin_send_company_message(uuid,uuid,text,text)'::REGPROCEDURE,
    'admin_update_complaint(uuid,uuid,text,text,boolean)'::REGPROCEDURE,
    'reset_company_business_data(uuid,uuid,text)'::REGPROCEDURE,
    'send_company_message_atomic(uuid,uuid,text,text)'::REGPROCEDURE,
    'mark_company_message_read_atomic(uuid,uuid,uuid)'::REGPROCEDURE,
    'archive_company_message_atomic(uuid,uuid,uuid)'::REGPROCEDURE,
    'create_complaint_atomic(uuid,uuid,text,text,text)'::REGPROCEDURE,
    'update_company_complaint_atomic(uuid,uuid,uuid,jsonb)'::REGPROCEDURE,
    'archive_company_complaint_atomic(uuid,uuid,uuid)'::REGPROCEDURE,
    'create_approval_request_atomic(uuid,text,uuid,text,uuid)'::REGPROCEDURE,
    'respond_voucher_disbursement_approval(uuid,uuid,text,uuid,text,text)'::REGPROCEDURE,
    'respond_voucher_receipt_approval(uuid,uuid,text,uuid,text,text)'::REGPROCEDURE,
    'respond_approval_request_atomic(uuid,uuid,text,uuid,text)'::REGPROCEDURE,
    'respond_approval_by_telegram_atomic(uuid,text,text,text)'::REGPROCEDURE,
    'respond_legacy_approval_by_telegram_atomic(text,text,uuid,text)'::REGPROCEDURE,
    'save_telegram_config_atomic(uuid,uuid,jsonb)'::REGPROCEDURE,
    'create_telegram_test_run_atomic(uuid,uuid)'::REGPROCEDURE,
    'finish_telegram_test_run_atomic(uuid,text,text)'::REGPROCEDURE,
    'expire_telegram_test_run_atomic(uuid,uuid,uuid)'::REGPROCEDURE,
    'start_telegram_reset_session_atomic(uuid,uuid)'::REGPROCEDURE,
    'approve_telegram_reset_session_atomic(text,text,timestamptz)'::REGPROCEDURE,
    'reject_telegram_reset_session_atomic(text)'::REGPROCEDURE,
    'cancel_telegram_reset_session_atomic(uuid,uuid,text)'::REGPROCEDURE,
    'upsert_push_subscription_atomic(uuid,uuid,text,text,text,text)'::REGPROCEDURE,
    'deactivate_push_subscription_atomic(uuid,uuid,text)'::REGPROCEDURE,
    'queue_push_notifications_atomic(uuid,uuid,jsonb)'::REGPROCEDURE
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',sig);
  END LOOP;
END $$;

COMMIT;
