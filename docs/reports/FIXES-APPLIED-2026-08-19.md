# سجل الإصلاحات المنفذة — 2026-08-19

هذا المستند يسجّل كل إصلاح طُبّق استجابةً لتقرير الفحص الشامل
`SECURITY-AUDIT-2026-08-19.md`. كل بند مصحوب بملفات التغيير واختبار الانحدار.

## 🟠 الإصلاحات متوسطة الخطورة

### 1. الملفات المُلغّمة (Polyglot) — تقوية فحص المحتوى
- **الملفات:** `src/lib/safe-input.ts` (إعادة كتابة `hasAllowedMagicBytes`)،
  `src/app/api/contracts/[id]/documents/[documentId]/route.ts`،
  `src/app/api/company/data-export/[id]/download/route.ts`
- **ما تغيّر:**
  - JPEG: يتطلب بنية markers صحيحة مع مقطع SOF خلال أول 4KB — ملف HTML يبدأ بـ `FF D8 FF` **مرفوض**.
  - PNG: يتطلب التوقيع الكامل + قطعة `IHDR` — أي محتوى HTML ملحَق **مرفوض**.
  - PDF: يتطلب رأس `%PDF-` عند الإزاحة 0 (بحد أقصى 4 بايتات مقدمة) + ذيل `%%EOF` في آخر 1KB — ملف HTML يحتوي `%PDF-` داخله **مرفوض**.
  - رفض عام لأي ملف يحمل تواقيع ويب/تنفيذية (`<script`, `<html`, `<!DOCTYPE`, `onerror=`, `MZ`, `PK`, `7z`, `Rar!`) في أول 1KB.
  - تحميل مستندات العقود وتصديرات البيانات أصبح **streaming** بدل إعادة التوجيه للرابط الموقّع: الرابط لا يصل للمتصفح إطلاقاً، ويُفرض `Content-Disposition: attachment` + `nosniff` (لا يُعرض الملف داخل المتصفح أبداً).
  - فحص UUID صارم لمسار تحميل التصدير (منع حقن ترويسات).
- **الاختبار:** `src/__tests__/audit-hardening-regression.test.ts` (7 حالات polyglot) + تحديث `scripts/audit-fuzz.mts` (كل محاولات polyglot أصبحت توقعات فشل HIGH).

### 2. سر الويب هوك تيليجرام — fail-closed في الإنتاج
- **الملفات:** `src/lib/webhook-guard.ts` (جديد)، `src/app/api/telegram/webhook/route.ts`، `README.md`
- **ما تغيّر:** في الإنتاج: لا سر مضبوط ⇒ رفض كل التحديثات. سر مضبوط لكن الترويسة غائبة أو غير مطابقة (مقارنة timing-safe) ⇒ رفض. القبول بدون تحقق يبقى **للتطوير فقط**.
- **الاختبار:** 5 حالات في `audit-hardening-regression.test.ts`.

## 🟡 الإصلاحات منخفضة الخطورة

### 3. حقن صيغ CSV (Formula Injection)
- **الملفات:** `src/lib/csv-export.ts` (جديد)، `src/app/api/backup/download/route.ts`
- **ما تغيّر:** كل خلية تبدأ بـ `= + - @` (ومتغيراتها) تُسبق بـ `'`، مع اقتباس وتهريب صحيحين، وترويسات `nosniff`.
- **الاختبار:** 4 حالات في ملف الانحدار.

### 4. انجراف المخطط (`supabase-full-schema.sql` القديم)
- **الملفات:** `scripts/generate-full-schema.mjs` (جديد)، `supabase-full-schema.sql` (أُعيد توليده)، `README.md`، `MIGRATIONS.md`، `package.json`
- **ما تغيّر:** الملف الجذر الآن **مولّد تلقائياً** من السلسلة المرجعية `src/migrations/` (باستثناء 001–006 التي يسجّلها ملف البوتستراب 000 بنفسه — نفس سلوك المشغّل تماماً). النسخة الضعيفة من `create_journal_entry` **اختفت نهائياً**. تحقّقت من تطبيق الملف من الصفر على PostgreSQL حقيقي وأن القيد غير المتوازن مرفوض منه.
- **أمر إعادة التوليد:** `npm run schema:generate`

### 5. نسبة الضريبة يتحكم بها منشئ الفاتورة
- **الملفات:** `src/app/api/invoices/route.ts`، `src/app/api/settings/route.ts`
- **ما تغيّر:**
  - منشئ الفاتورة غير المدير ملزم بنسبة الشركة `companies.vat_rate` أو 0% (فواتير معفاة) — أي نسبة أخرى ⇒ 403.
  - مفتاح `vat_rate` أصبح محجوزاً في جدول `settings` (لا يمكن للمديرين الكتابة عليه مباشرة) ويُزامَن تلقائياً عند تغيير المدير لنسبة الشركة — منع انحراف القيمتين.

### 6. حدود قصوى للقيم الرقمية (منع أخطاء 500 بمبالغ فلكية)
- **الملفات:** `src/lib/validation.ts`
- **ما تغيّر:** مساعدان مركزيان `moneyAmount()` (حد `NUMERIC(15,2)` = 9,999,999,999,999.99 + `finite` + منزلتان) و`quantityAmount()`، طُبّقا على: أسطر القيود، الفواتير وبنودها، المشتريات وبنودها، السندات، تكاليف المعدات، الحد الائتماني، أوامر التغيير (السالب مسموح ضمن الحد)، ساعات التشغيل، نسبة الضريبة.
- **النتيجة:** الـ fuzzer (100K+ حالة) يعيد **صفر نتائج** بدل 19.

### 7. تهريب HTML في إشعارات تيليجرام والبريد
- **الملفات:** `src/lib/telegram.ts` (تصدير `escapeTelegramHtml`)، `src/lib/notifications.ts`، `src/lib/messaging/index.ts`، `src/app/api/telegram/webhook/route.ts`، `src/app/api/admin/database/backup/route.ts`، `src/lib/email.ts`
- **ما تغيّر:** كل متغير مستخدم (أسماء، بيانات، أسباب) يُهرَّب قبل الإدراج في رسائل `parse_mode: HTML`؛ قوالب البريد تُهرَّب وتُحوَّل أسطرها إلى `<br>`؛ روابط البريد تُهرَّب في السمات؛ أُضيفت دالة `sendVerificationEmail` جديدة.

### 8. تغيير البريد الإلكتروني دون إعادة تحقق (انتحال هوية محتمل)
- **الملفات:** `src/app/api/auth/me/route.ts`، `src/lib/email.ts`
- **ما تغيّر:** تغيير البريد في الملف الشخصي الآن: يفحص التفرّد عالمياً ⇒ يرسل رابط تأكيد للمعنون الجديد ⇒ يثبّت `email_verified=false` ورمزاً مجزّأً صالحاً 24 ساعة ⇒ **يفشل مغلقاً في الإنتاج إذا تعذر إرسال البريد** (لا يُحفظ البريد غير الموثّق).

### 9. تحديد معدل التسجيل (منع الزراعة الجماعية للحسابات)
- **الملفات:** `src/migrations/067-audit-hardening-fixes.sql` (جدول `registration_attempts` + RLS + إعادة تثبيت الدالة المحصّنة مع `SET search_path`)، `src/lib/rate-limit.ts`، `src/app/api/auth/register/route.ts`
- **ما تغيّر:** عدّاد مخصص (5 محاولات/ساعة لكل بريد أو IP) فوق تحقق Turnstile، مع الفشل المغلق عند تعذر المتجر.

### 10. تضييق CSP
- **الملفات:** `next.config.ts`، `src/__tests__/next-config.test.ts`
- **ما تغيّر:** حذف المصدر المفتوح `connect-src https:` وأصل Supabase (المتصفح لا يتصل به مباشرة — كل الطلبات تمر عبر نفس الأصل). بقي `'self'` و`api.moyasar.com` فقط.

## 🔵 تحسينات إضافية

### 11. الوضع الصارم TypeScript مكتمل
- **الملفات:** `tsconfig.json` (`"strict": true` بدل الخطة التدريجية) + ~46 تصحيحاً نوعياً في 17 ملفاً (مسارات التقارير، `voucher-utils`، صفحة المشاريع، ملفات الاختبار).
- **النتيجة:** `tsc --noEmit` = **0 أخطاء**، والبناء الإنتاجي `next build` يمر كاملاً.

### 12. الخطوط مستضافة ذاتياً (لا اعتماد على Google Fonts)
- **الملفات:** `src/app/layout.tsx`، `package.json` (+`@fontsource/ibm-plex-sans-arabic`, `@fontsource/plus-jakarta-sans`)
- **ما تغيّر:** أُزيل `next/font/google` — البناء يعمل دون اتصال، ولا تُرسل أي طلبات لجهات خارجية عند زيارة الصفحات (خصوصية + موثوقية).

### 13. حزام فحص دائم في CI
- **الملفات:** `package.json` (أوامر جديدة) + `scripts/audit-fuzz.mts` + `scripts/audit-live-db.mjs`
- `npm run audit:fuzz` — Fuzz للمخططات والدوال الأمنية.
- `npm run audit:db` — هجوم حي على RPCs على PostgreSQL حقيقي.
- `npm run schema:generate` — إعادة توليد المخطط الكامل.

## التحقق النهائي

| الفحص | النتيجة |
|---|---|
| `npm audit` | ✅ 0 ثغرة |
| `npx tsc --noEmit` (strict كامل) | ✅ 0 أخطاء |
| `next build` (إنتاج) | ✅ نجح كاملاً |
| `npx jest` | ✅ 616/616 (59 مجموعة) |
| `npm run test:migrations` (PGlite) | ✅ |
| `npm run test:migrations:pg` (PostgreSQL حقيقي) | ✅ |
| `npm run audit:db` | ✅ 18/18 |
| `npm run audit:fuzz` | ✅ 0 نتائج، 0 انهيار |
| `eslint` | ✅ 0 أخطاء (تحذيرات `any` متبقية فقط) |
