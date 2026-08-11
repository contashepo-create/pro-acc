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

## 021-add-daily-worker.sql
Allows `daily_worker` as a `contacts.type` value so the "عمال يومية" (Daily Workers) section is usable.
Run via: `npx tsx src/migrations/run.ts` (idempotent) or apply directly in the DB.

## 022-fix-journal-lines-company-id.sql
`journal_lines.company_id` is `NOT NULL`, but `create_journal_entry` and
`create_invoice_with_journal` omitted it — every atomic journal insert failed
with a not-null violation. This migration rewrites both RPCs to write
`company_id` + `account_name`, and adds a `BEFORE INSERT` trigger that
backfills those columns from `journal_entries` / `accounts` if a leftover
application path still omits them.

Apply in the Supabase SQL editor (or `npx tsx src/migrations/run.ts`) after
deploying the matching app code.
