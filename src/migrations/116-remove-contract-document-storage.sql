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
--   4. يحاول إسقاط صف دلو contract-documents حرساً (محمول: يتخطى الخطوة على
--      محركات PostgreSQL بلا مخطط storage مثل بيئات الاختبار).
--      (حذف الكائنات عبر SQL ممنوع على Supabase [storage.protect_delete] —
--       تفريغ المساحة الفعلي يتم عبر scripts/purge-contract-documents-storage.mjs
--       بواجهة Storage API الرسمية.)

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

-- Supabase forbids direct SQL deletes on storage.objects (storage.protect_delete
-- trigger raises 42501). Object purge + bucket removal therefore happen via the
-- Storage API — run scripts/purge-contract-documents-storage.mjs once (or delete
-- the bucket from the Supabase dashboard). Here we only attempt the bucket-row
-- delete guarded, in case the bucket was already emptied by hand.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    BEGIN
      DELETE FROM storage.buckets WHERE id = 'contract-documents';
      RAISE NOTICE 'contract-documents bucket row removed';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'bucket row not removed by SQL (%) — purge objects and delete the bucket via scripts/purge-contract-documents-storage.mjs', SQLERRM;
    END;
  END IF;
END $$;

SELECT 'Migration 116 completed' AS result;
