-- 116: إلغاء ميزة «مستندات العقود» من التخزين نهائياً.
--
-- كانت الميزة ترفع ملفات (PDF/صور) إلى دلو Supabase Storage الخاص
-- (contract-documents) وتخزن بياناتها في جدول contract_documents. اتُّخذ قرار
-- بعدم تخزين أي ملفات داخل قاعدة البيانات/التخزين حتى لا تزدحم مساحة المشروع —
-- نفس سياسة إيصالات الدفع (الميجريشن 115): الملفات تتبادل عبر تليجرام.
--
-- ماذا يفعل هذا الميجريشن:
--   1. يعيد كتابة delete_draft_contract_atomic بلا مسارات تخزين (كان يجمّع
--      مسارات الملفات من الجدول المحذوف).
--   2. يسقط دالة create_contract_document_atomic وجدول contract_documents
--      (مع سياسته RLS وفهارسه — كلها كائنات تابعة).
--   3. يعيد تركيب محفزات حراسة العلاقات دون contract_documents (محفز الجدول
--      المحذوف يسقط معه تلقائياً — إعادة الحلقة تجعل القائمة صريحة).
--   4. يفرّغ دلو contract-documents ويمسحه من storage (محمول: يتخطى الخطوة
--      على محركات PostgreSQL بلا مخطط storage مثل بيئات الاختبار).
--      حذف كائنات الدلو هنا يحرر مساحة التخزين على Supabase فعلياً.

CREATE OR REPLACE FUNCTION public.delete_draft_contract_atomic(p_company_id UUID,p_contract_id UUID,p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old contracts%ROWTYPE;
BEGIN
  PERFORM assert_relationship_actor(p_company_id,p_user_id);
  SELECT * INTO v_old FROM contracts WHERE id=p_contract_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'العقد غير موجود'; END IF;
  IF v_old.status<>'draft' THEN RAISE EXCEPTION 'لا يمكن حذف عقد دخل دورة العمل'; END IF;
  PERFORM set_config('app.relationship_write_company',p_company_id::TEXT,TRUE);
  DELETE FROM contracts WHERE id=p_contract_id;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values)
  VALUES(p_company_id,p_user_id,'delete','contract',p_contract_id,to_jsonb(v_old));
  RETURN jsonb_build_object('id',p_contract_id,'deleted',TRUE);
END;
$$;

DROP FUNCTION IF EXISTS public.create_contract_document_atomic(UUID,UUID,TEXT,TEXT,TEXT,INTEGER,TEXT,UUID);
DROP TABLE IF EXISTS public.contract_documents;

DO $$ DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['crm_contacts','crm_followups','contracts','tenders','tender_cost_items','bonds','project_tasks','reminder_log'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_guard_relationship_writes ON %I',t);
    EXECUTE format('CREATE TRIGGER trg_guard_relationship_writes BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION guard_relationship_writes()',t);
  END LOOP;
END $$;

DO $$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    DELETE FROM storage.objects WHERE bucket_id='contract-documents';
    DELETE FROM storage.buckets WHERE id='contract-documents';
  END IF;
END $$;

SELECT 'Migration 116 completed' AS result;
