-- 089 - إزالة "نسخة قاعدة البيانات" للعميل نهائياً (تصدير JSON + استعادة)
--
-- السياسة الجديدة (قرار مالك المنصة):
--  * العميل يحصل على جداول بياناته هو فقط بصيغة Excel/CSV (عبر
--    /api/company/export-download) لمراجعتها أو نقلها لمنصة أخرى — وفق
--    المعايير المتعارف عليها في البرامج المحاسبية.
--  * لا يوجد أي شكل من "نسخة قاعدة بيانات" قابلة للتحميل (JSON) لأي عميل
--    (حالي/منتهي/معلّق/جديد).
--  * لا يوجد أي سبيل لاستعادة/رفع هذه الملفات إلى المنصة؛ إدخال البيانات
--    يدوي فقط. حُذفت مسارات /api/backup/download|upload|validate|auto
--    و /api/company/data-export من التطبيق.
--
-- هذا الميجريشن يحذف الجداول التي كانت تخدم تلك الميزة:
--  * company_data_exports : طلبات تصدير JSON لمسة الخدمة الذاتية.
--  * backup_logs          : سجل إثبات ملكية ملفات النسخ القابلة للاستعادة
--                           (كان شرط الاستعادة عبر /api/backup/upload).
--
-- ملاحظة: نسخ المطوّر العامة (pg_dump لكل قاعدة البيانات) نظام مستقل
-- تماماً (scripts/global-backup.ts + ملفات على التخزين) ولا يستخدم هذه
-- الجداول، فلا يتأثر بهذا الحذف.

BEGIN;

-- أفضل جهد: تنظيف كائنات حاوية تصديرات JSON القديمة من التخزين إن وُجدت.
DO $$
BEGIN
  DELETE FROM storage.objects WHERE bucket_id = 'company-exports';
EXCEPTION WHEN OTHERS THEN
  -- قد لا تكون الحاوية/المخطط متاحة في بعض البيئات — نتجاهل ونكمل.
  RAISE NOTICE 'storage cleanup skipped: %', SQLERRM;
END $$;

DROP TABLE IF EXISTS company_data_exports;
DROP TABLE IF EXISTS backup_logs;

COMMIT;
