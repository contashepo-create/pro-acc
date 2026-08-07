# دليل الميجريشنز (Database Migrations)

## المصدر الموحّد للتغييرات الهيكلية
- **`src/migrations/`** هو المصدر المعتمد لتغييرات قاعدة البيانات، ويُطبَّق عبر المشغّل
  **`src/migrations/run.ts`**.
- طريقة التطبيق:
  ```bash
  npx tsx src/migrations/run.ts
  ```
- المشغّل **idempotent بأمان**: يتتبّع ما طُبّق فعلاً في جدول `_migrations`، ويستخدم
  `CREATE TABLE IF NOT EXISTS`، لذا يمكن تشغيله أكثر من مرة دون أثر جانبي.

## ⚠️ تحذير: مجلد `supabase/migrations/` متباعد عن المصدر
- مجلد `supabase/migrations/` (الملفّات `001`..`022`) **لا يحوي الجداول الأساسية**
  (`users`, `companies`, `accounts`, `invoices`, `journal_entries`...) وهو منفصل عن `src/migrations/`.
- **لا تستخدم `supabase db push` مع هذا المجلد** في الإنتاج لتجنّب نقص في الجداول أو تعارض
  في المخطّط.
- الملفّان `all-migrations.sql` و`supabase-full-schema.sql` هما **لقطات مرجعية (dumps)** وليسا
  مصدر تغييرات قابلاً للتطبيق التزايدي.

## التوصية
- اعتبر `src/migrations/` المصدر الوحيد للهجرات. أضف أي تغيير هيكلي جديد في ملفّ جديد
  بترقيم تصاعدي داخل `src/migrations/`.
- لا تخلط بين نظامَي هجرات (Supabase CLI + `run.ts`) لتفادي تباعد المخطّط بين البيئات.
