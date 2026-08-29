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
   **الرقم التسلسلي التالي غير المستخدم** (آخر رقم حالياً: `115`).
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

## ⚠️ تعارض معروف: `company_telegram_configs` يُعرَّف مرتين (016 مقابل 020)
- `016-approval-system.sql` (سطر ~99) ينشئ الجدول بـ **`company_id UUID PRIMARY KEY`** (بدون عمود `id`).
- `020-telegram-system.sql` (سطر 5) ينشئه بـ **`id UUID PRIMARY KEY` + `UNIQUE(company_id)`**.
- كلاهما `CREATE TABLE IF NOT EXISTS`، والمشغّل يطبّق 016 أولاً ⇒ **شكل 016 هو الساري فعلياً**
  و`CREATE TABLE` في 020 لا يفعل شيئاً بصمت (فلا يوجد عمود `id` ولا `created_at` في الجدول الفعلي).
- **هذا غير مكسور حالياً**: كل كود التطبيق (`src/lib/notifications.ts`،
  `src/app/api/settings/telegram/route.ts`) وكل الـ RPCs اللاحقة (049، 056، 059)
  تتعامل مع الجدول عبر `company_id` فقط، و049 يضيف `reset_session_data` بـ `ADD COLUMN IF NOT EXISTS`.
- **عند كتابة أي كود جديد** يمس هذا الجدول: اعتمد شكل 016 (المفتاح `company_id`، لا تفترض وجود `id`).
- التوحيد الفعلي (إضافة `id`/`created_at` أو إعادة بناء المفتاح) يتطلب ميجريشن مدروساً على بيانات
  الإنتاج الحقيقية — لا تعِد تسمية أو تعدّل 016/020 نفسيهما (انظر قاعدة الأرقام المجمّدة أعلاه).

## الملفات المرجعية والأنظمة القديمة
- `supabase-full-schema.sql` هو **لقطة مُولَّدة تلقائياً** من السلسلة المرجعية
  `src/migrations/` (باستثناء 001–006 التي يسجّلها ملف البوتستراب 000 بنفسه).
  يُعاد توليدها عبر `node scripts/generate-full-schema.mjs` — **لا تُحرَّر يدوياً**
  ولا تُستخدم إلا كملف bootstrap واحد. المصدر الوحيد للتغييرات هو `src/migrations/`.
- الملفان القديمان `all-migrations.sql` و `supabase-apply-all-migrations.sql` **حُذفا**
  لأنهما كانا نسخاً متضاربة من نفس الترحيلات (نظاما تطبيق مختلفان). المصدر الوحيد الآن هو
  `src/migrations/` + `run.ts`.
- مجلد `supabase/migrations/` (الملفات `001`..`022`) منفصل وقديم ولا يحوي الجداول الأساسية —
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

### 064-supabase-linter-hardening.sql
Fixes every finding class from the live Supabase database linter report
(captured 2026-08-17): pins `search_path` on ALL remaining unpinned functions
(19 legacy warnings, swept from the catalogue not a list), widens the pin to
`public, extensions, pg_temp` for `digest()` callers (pgcrypto lives in the
`extensions` schema on hosted Supabase), revokes `anon`/`authenticated` from
every materialized view (`mv_trial_balance` was readable cross-tenant — MVs
bypass RLS), converts `tenant_company_id()` to SECURITY INVOKER, and revokes
API-role EXECUTE on the out-of-repo `rls_auto_enable()` if present. See
`docs/SUPABASE-DEPLOYMENT.md` §3.5 for how to read the linter report itself.

### 065-repair-additional-user-voucher-approvals.sql
Repairs the schema prerequisites used only when an additional user enters the
voucher approval path: canonical Telegram approval columns, the per-user bypass
flag, the unified approval-request columns, and a nullable `approver_id` until
the decision is actually made. This keeps voucher creation compatible with
historical/partially-applied schemas while approval authorization remains
validated at decision time.

### 066-global-backup-journal.sql
Adds the platform-level `global_backup_journal` table used by the scheduled
whole-database developer backup (`scripts/global-backup.ts`, driven by
`.github/workflows/global-backup.yml`): one row per dump with its size, SHA-256,
storage path and Telegram message id, so the retention policy can delete old
artifacts from storage AND from the Telegram chat, keeping only the last N
copies. The table has no `company_id` by design (it journals the whole
database); tenant routes never touch it.

### 110-purchase-returns-rls.sql
Enrolls the three purchase-returns tables created by 109 (`purchase_returns`,
`purchase_return_items`, `purchase_return_sequences`) in RLS tenant isolation
with the canonical `tenant_isolation_<tbl>` policy — 109 ran after 104's
catalogue sweep, so they were the only tenant tables left without RLS.

### 111-tenders-contact-fk.sql
Adds the missing `tenders.contact_id -> contacts(id)` FK. Without it,
PostgREST could not embed `contacts(name)` on `tenders` (PGRST200 on the
tenders list/detail routes). Legacy rows pointing at a missing or
cross-tenant contact are nullified first (the UI falls back to `client_name`).

### 112-subscriber-numbers.sql
Guarantees every subscriber a unique, permanent `subscriptions.subscriber_number`
(the number a subscriber sends the developer): backfills NULL/blank rows from
`subscriber_number_seq` in `created_at` order, a `BEFORE INSERT OR UPDATE`
trigger (`assign_subscriber_number`, re-assigns if the value is ever cleared)
covers every current/future creation path, and
`subscriptions_subscriber_number_key` UNIQUE makes a number identify exactly
one subscriber. Numbers are shown to the subscriber on
Settings → Subscription, and the developer panel (zerocold → companies)
supports server-side lookup by the number via `GET /api/admin/companies?q=…`.

Two production findings (2026-08) harden it further:
- **Type normalization** — in some environments the column pre-existed as
  INTEGER before 041, so 041's `ADD COLUMN IF NOT EXISTS … TEXT` was a silent
  no-op and the backfill died with `42883: function btrim(integer) does not
  exist`. 112 now coerces any non-text `subscriber_number` to TEXT
  (`USING …::text`) before anything else runs.
- **Collision-proof allocation** — every assignment (backfill, duplicate
  renumber, trigger) goes through `next_subscriber_number()`, which advances
  the sequence past any value already in the table. A plain `nextval()` can
  collide with legacy/manual values (sequence at 1000 + existing
  "1001","1001" → the renumber mints a second "1001" and the UNIQUE fails).

### 113-unified-note-numbering.sql
Fixes a critical numbering collision found by the programmatic accounting
audit (2026-08): `credit_notes.number` is `UNIQUE(company_id, number)` and
serves BOTH note types, but the two sequence functions seeded from independent
sources — `next_credit_note_number` from all notes, `next_debit_note_number`
from debit notes only. Result: the first debit note of a year re-seeded from
0 and hit `23505` against the first credit note's #1 (and any mixed
credit/debit sequence drifted the debit counter into taken numbers). Any
company issuing both note types in a year was deterministically affected.
Both functions now share one counter (`credit_note_sequences`) under the
existing advisory lock, with a self-healing floor at the actual table max
(`GREATEST(counter, max(number)) + 1`) so stale/legacy state can never mint a
used number. Covered by
`src/__tests__/migration-113-unified-note-numbering.db.test.ts` (both
orderings + legacy floor, PGlite full schema).

### 114-random-subscriber-numbers.sql
Replaces 112's sequential allocator (`subscriber_number_seq`: 1000, 1001, …)
with a random one — a sequential number let anyone who learned one subscriber
number enumerate the neighbours and use them in support/social-engineering
attacks against OTHER companies. `next_subscriber_number()` now mints a
12-character code from an unambiguous alphabet (no 0/O/1/I/L) grouped as
`XXXX-XXXX-XXXX` (~31¹² combinations), collision-checked against the live
table. Every legacy all-digit number is re-issued once (one-time change, in
`created_at` order) and `subscriber_number_seq` is dropped so no future code
path can reintroduce sequential numbers. The 112 trigger and UNIQUE
constraint stay untouched. SQL contract covered by
`src/__tests__/subscriber-number-telegram-proof.test.ts`.

### 115-telegram-payment-proof.sql
Payment proofs move out of the platform: customers send the receipt
screenshot to the developer on Telegram, and the request carries only the
transfer metadata (method, amount, date, time, notes).
- `create_upgrade_request_atomic` / `create_addon_request_atomic` no longer
  accept a receipt reference — any non-NULL value is rejected so stale
  clients cannot smuggle uploads back in (`/api/upload/receipt` was removed).
- `review_upgrade_request` / `review_addon_request` no longer require a
  stored receipt file for approval; the full-amount + transfer-date guards
  stay intact (the admin confirms the screenshot in the Telegram chat).
- New `cancel_own_subscription_request` RPC lets the owner cancel their own
  still-pending request, freeing the partial-unique "one pending request"
  slot so a typo'd request can be resubmitted without developer help.

New upgrade/add-on requests also announce themselves on the admin bot
(`sendAdminNotification`) with the company's permanent subscriber number, so
matching the incoming Telegram receipt to the panel request is trivial.
