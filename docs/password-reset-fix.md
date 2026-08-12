# تشخيص وإصلاح: رابط إعادة تعيين كلمة المرور لا يصل + عدم منع تكرار الطلبات

**التاريخ:** 2026-08-12

## الأعراض (بلاغ المستخدم)
1. طلب رابط إعادة تعيين كلمة المرور ولم يصل أي إيميل/رابط (ولا حتى في السبام).
2. استطاع إعادة نفس الطلب مرات غير محدودة في نفس الدقيقة دون أي تحذير أو منع.

---

## 1) سبب «عدم منع التكرار» — مؤكد برمجياً ✅
`checkRateLimit()` (المستخدمة أصلاً في forgot/resend) كانت تَعُدّ الصفوف في جدول **`login_attempts`** بفلتر `success = false`. لكن مساري `forgot-password` و `resend-verification` **لا يُدخلان أبداً** صفوفاً في `login_attempts`. النتيجة:
- `count` يبقى دائماً `0` → `allowed` دائماً `true` → **لا يُمنع أي طلب أبداً**.

### الإصلاح
- جدول مخصص **`password_reset_requests`** (migration 028) يسجّل كل طلب (email, ip, status, error, created_at).
- دوال جديدة في `rate-limit.ts`:
  - `checkPasswordResetRateLimit(email, ip)` — تَعُدّ طلبات (البريد **أو** IP) خلال 15 دقيقة، الحد **3 طلبات** (قابل للتخصيص)، وترفض بعد ذلك بـ 429 مع `remainingMinutes`.
  - `recordPasswordResetRequest(...)` — تُدخل صفاً قبل الإرسال.
  - `markPasswordResetRequest(id, status, err)` — تحدّث حالة التسليم.
- استُخدمت في `forgot-password` و `resend-verification`.

> الآن التكرار الحقيقي يُحسب ويُمنع: بعد 3 طلبات في 15 دقيقة لنفس البريد/IP يظهر «حاول بعد N دقائق».

---

## 2) سبب «عدم وصول الإيميل» — تشخيص
`sendEmail()` تعيد `false` في حالتين:
- **SMTP غير مهيأ** (لا يوجد `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` في `.env`).
- فشل إرسال فعلي عبر nodemailer.

### ما أُضيف
- **تتبّع حالة التسليم** لكل طلب في `password_reset_requests.status` (`delivered` / `failed` مع السبب)، ليمكنك لاحقاً الاستعلام عما حدث بالضبط:
  ```sql
  SELECT email, status, error, created_at FROM password_reset_requests ORDER BY created_at DESC LIMIT 10;
  ```
- رسالة أوضح للمستخدم عند فشل الإرسال: «تعذر إرسال رابط إعادة التعيين حالياً…» (في الإنتاج) أو عرض الرابط مباشرة (في غير-الإنتاج/التطوير).
- تسجيل واضح في السجلات (`console.warn/error`) عند غياب SMTP.

### الخطوة المطلوبة منك
تحقق أن متغيرات SMTP مضبوطة في بيئة الإنتاج (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `FROM_EMAIL`). بدونها لا يمكن إرسال أي بريد — هذا على الأرجح سبب «لم يصل الإيميل». بعد الضبط، أعد التجربة، وافحص `password_reset_requests.status` للتأكد من `delivered`.

---

## 3) التحقق
- **اختبارات جديدة** `password-reset-rate-limit.test.ts` (7): السماح دون الحد، المنع عند بلوغ الحد، الحد المخصص، تعقيم IP ضد حقن الفلاتر، fail-open عند خطأ DB، تسجيل الصف وتحديث الحالة.
- **الإجمالي: 407 اختباراً ناجحاً** عبر 32 مجموعة.
- **`npx tsc --noEmit`** نظيف.

## 4) الملفات المعدّلة
- `src/migrations/028-password-reset-rate-limit.sql` (جديد)
- `src/lib/rate-limit.ts` — دوال جديدة + إصلاح `s` المفقود.
- `src/app/api/auth/forgot-password/route.ts`
- `src/app/api/auth/resend-verification/route.ts`
- `src/__tests__/password-reset-rate-limit.test.ts` (جديد)
- `docs/password-reset-fix.md` (هذا الملف)

> ⚠️ يتطلب تشغيل migration 028 على قاعدة البيانات (`npm run migrate`) قبل أن يعمل عداد الطلبات.
