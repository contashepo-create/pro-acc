# دليل الميجريشنز (Database Migrations)

## المصدر الموحّد للتغييرات الهيكلية
- **`src/migrations/`** هو المصدر **الوحيد** المعتمد لتغييرات قاعدة البيانات، ويُطبَّق عبر المشغّل
  **`src/migrations/run.ts`**.
- طريقة التطبيق:
  ```bash
  npx tsx src/migrations/run.ts
  ```
- المشغّل **idempotent بأمان**: يتتبّع ما طُبّق فعلاً في جدول `_migrations` (بالاسم الكامل للملف)،
  ويستخدم `CREATE TABLE IF NOT EXISTS`، لذا يمكن تشغيله أكثر من مرة دون أثر جانبي.

## قواعد إضافة ميجريشن جديد
1. أنشئ ملفاً جديداً داخل `src/migrations/` باسم `NNN-وصف-قصير.sql` حيث `NNN` هو
   **الرقم التسلسلي التالي غير المستخدم** (آخر رقم حالياً: `063`).
   لا تعتمد على الرقم المكتوب هنا — اقرأه من القرص حتى لا يتقادم:
   ```bash
   ls src/migrations/*.sql | sed 's#.*/##' | cut -d- -f1 | sort -n | tail -1
   ```
2. **يُمنع تكرار الأرقام**: المشغّل يفشل تلقائياً إذا اكتشف رقماً مكرراً جديداً
   (انظر `assertNoNewDuplicateNumbers` في `run.ts`).
3. اجعل كل ميجريشن idempotent (`IF NOT EXISTS` / `CREATE OR REPLACE`) قدر الإمكان.

## ⚠️ الأرقام المكررة التاريخية (مجمّدة — لا تُصلَح بإعادة التسمية)
الملفات التالية تتشارك نفس الرقم لأسباب تاريخية. جدول `_migrations` يتتبع **بالاسم الكامل**،
لذا إعادة تسميتها ستُعيد تشغيل SQL مطبّق فعلاً في الإنتاج. تبقى كما هي كاستثناء موثّق،
والمشغّل يرتّبها أبجدياً بشكل حتمي:
- `011-final-security-accounting.sql` + `011-fix-all-sequences-race-condition.sql`
- `012-atomic-journal-entry-insert.sql` + `012-enhanced-custody-system.sql`
- `015-branding-and-features.sql` + `015-fix-schema-mismatches.sql`
- `016-approval-system.sql` + `016-payment-portal-contracts.sql`

## الملفات المرجعية والأنظمة القديمة
- `supabase-full-schema.sql` هو **لقطة مرجعية (dump)** للاطلاع فقط — ليس مصدر تغييرات.
- الملفان القديمان `all-migrations.sql` و `supabase-apply-all-migrations.sql` **حُذفا**
  لأنهما كانا نسخاً متضاربة من نفس الترحيلات (نظاما تطبيق مختلفان). المصدر الوحيد الآن هو
  `src/migrations/` + `run.ts`.
- مجلد `supabase/migrations/` (الملفات `001`..`022`) منفصل ولا يحوي الجداول الأساسية —
  **لا تستخدم `supabase db push` معه في الإنتاج**.

## ملاحظات ميجريشنات مهمة

### 021-add-daily-worker.sql
Allows `daily_worker` as a `contacts.type` value so the "عمال يومية" (Daily Workers) section is usable.

### 022-fix-journal-lines-company-id.sql
`journal_lines.company_id` is `NOT NULL`, but `create_journal_entry` and
`create_invoice_with_journal` omitted it — every atomic journal insert failed
with a not-null violation. This migration rewrites both RPCs to write
`company_id` + `account_name`, and adds a `BEFORE INSERT` trigger that
backfills those columns from `journal_entries` / `accounts` if a leftover
application path still omits them.

### 023-fix-child-rows-company-id.sql
Same class of bug as 022, on line/item tables (`invoice_items`,
`quotation_items`, `purchase_invoice_items`, `purchase_order_items`, ...).
