-- 088 - تعطيل تصفير قاعدة بيانات الشركة نهائياً (قرار تشغيلي)
--
-- لا يجوز لأي عميل (حالي/منتهي/معلّق/جديد) تصفير قاعدة بياناته بنفسه.
-- المسار البرمجي /api/company/reset أصبح قبراً (410)، وبوابة تيليجرام لم
-- تعد تصدر رموز تأكيد. هذا الميجريشن يزيل القدرة من قاعدة البيانات
-- نفسها: حذف دوال التصفير وجلساتها، بحيث لا يبقى أي مسار خلفي حتى مع
-- الاستدعاء المباشر للدوال.
--
-- ملاحظة: عمود reset_session_data يُبقى (لا يعود يستخدم) لكنه يُصفَّر
-- لإنهاء أي جلسات معلّقة تاريخياً؛ حذف العمود غير ضروري لأن كل الدوال
-- التي كانت تقرأه/تكتبه محذوفة هنا.

BEGIN;

-- 1) دوال التصفير الفعلية (الغلاف العام + النسخة الداخلية v56)
DROP FUNCTION IF EXISTS public.reset_company_business_data(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.reset_company_business_data_v56_internal(UUID, UUID, TEXT);

-- 2) دورة جلسات تيليجرام للتصفير (طلب/موافقة/رفض/إلغاء)
DROP FUNCTION IF EXISTS public.start_telegram_reset_session_atomic(UUID, UUID);
DROP FUNCTION IF EXISTS public.approve_telegram_reset_session_atomic(TEXT, TEXT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.reject_telegram_reset_session_atomic(TEXT);
DROP FUNCTION IF EXISTS public.cancel_telegram_reset_session_atomic(UUID, UUID, TEXT);

-- 3) إنهاء أي جلسات تصفير معلّقة تاريخياً
UPDATE company_telegram_configs
   SET reset_session_data = NULL, updated_at = NOW()
 WHERE reset_session_data IS NOT NULL;

-- 4) توثيق الحدث في سجل التدقيق الأمني (مرة واحدة لكل شركة لديها إعدادات)
INSERT INTO security_audit_log(company_id, user_id, action, details)
SELECT c.company_id, c.configured_by, 'company_data_reset_feature_disabled',
       jsonb_build_object('migrated_at', NOW(), 'reason', 'feature permanently removed by platform owner')
  FROM company_telegram_configs c
 WHERE c.configured_by IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM security_audit_log s
      WHERE s.company_id = c.company_id
        AND s.action = 'company_data_reset_feature_disabled'
   );

COMMIT;
