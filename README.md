# Pro Acc - نظام محاسبة متكامل للمقاولات

نظام ERP محاسبي متكامل مصمم خصيصاً لشركات المقاولات والإنشاءات في السعودية والخليج. يدعم اللغة العربية بالكامل مع واجهة عصرية وسهلة الاستخدام.

![Next.js](https://img.shields.io/badge/Next.js-16-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-green)

## ✨ المميزات

### 📊 المحاسبة المالية
- دليل حسابات مرن (4 أرقام) مع شجرة حسابات
- قيود يومية متوازنة تلقائياً
- ميزان مراجعة، قائمة دخل، ميزانية عمومية
- تقارير تقادم العملاء والموردين

### 🧾 الفواتير والمبيعات
- فواتير مبيعات مع ضريبة القيمة المضافة 15%
- سندات قبض وصرف
- عروض أسعار
- متابعة التحصيلات

### 🏗️ إدارة المشاريع (مقاولات)
- BOQ (جدول الكميات)
- مستخلصات مقاولين
- عقود مقاولين باطن وشهادات إنجاز
- تكاليف المشاريع وربحية كل مشروع
- الفوترة المرحلية

### 👷 إدارة الموظفين
- رواتب وكشوف مرتبات
- عمالة يومية
- عهد وسلف موظفين
- حضور وانصراف

### 📦 المخزون والمشتريات
- مستودعات متعددة
- حركات مخزنية (إضافة، صرف، تحويل)
- أوامر شراء وفواتير مشتريات
- أصناف وموردين

### 🔐 الأمان
- مصادقة بـ JWT مع httpOnly cookies
- تشفير كلمات المرور بـ scrypt
- حماية CSRF
- Rate Limiting
- تسجيل دخول ثنائي عبر Telegram للـ Admin
- عزل بيانات كل شركة (Multi-tenant)

## 🚀 التشغيل السريع

### 1. المتطلبات
- Node.js 18+
- Supabase account
- SMTP (اختياري للبريد)

### 2. التثبيت
```bash
git clone https://github.com/contashepo-create/pro-acc.git
cd pro-acc
npm install
```

### 3. إعداد البيئة
```bash
cp .env.example .env.local
# عدل .env.local بمعلوماتك
```

### 4. إعداد قاعدة البيانات

الطريقة المفضّلة (تُطبّق السلسلة المرجعية `src/migrations/*` بالترتيب وتتتبّع ما سبق تطبيقه):
```bash
npm run migrate
```

أو يدوياً في Supabase Dashboard > SQL Editor — شغّل محتوى الملف الواحد المُولَّد:
```
supabase-full-schema.sql   (لقطة كاملة مُولَّدة تلقائياً من src/migrations/)
```
> ملاحظة أمان: لا تستخدم نسخاً قديمة من المخطط. الملف الجذر يُعاد توليده عبر
> `node scripts/generate-full-schema.mjs` من السلسلة المرجعية نفسها.

### 5. إنشاء مدير النظام
```bash
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=StrongPass123 npm run seed:admin
```

### 6. التشغيل
```bash
npm run dev
# افتح http://localhost:3000
```

## 🤖 تفعيل أزرار تيليجرام التفاعلية (الموافقات)

أزرار **موافق ✅ / رفض ❌** في رسائل طلبات الاعتماد لا تعمل إلا إذا كان
البوت مسجّلاً لاستقبال التحديثات من عنوان الـ webhook الصحيح. بعد كل نشر
للتطبيق سجّل الـ webhook مرة واحدة:

```bash
TELEGRAM_BOT_TOKEN=<توكن البوت> \
TELEGRAM_WEBHOOK_SECRET=<نفس قيمة المتغير في بيئة التطبيق> \
APP_URL=https://your-app.vercel.app \
node scripts/register-telegram-webhook.mjs
```

- المسار الصحيح هو `/api/telegram/webhook`. المسار القديم
  `/api/telegram/callback` ما زال يعمل كاسم بديل (alias) للتوافق.
- 🔒 **سياسة الأمان (fail-closed):** في الإنتاج تُرفض تحديثات الويب هوك
  تماماً إذا لم تكن `TELEGRAM_WEBHOOK_SECRET` مضبوطة أو إذا وصل التحديث
  بدون الترويسة المطابقة. اضبط المتغير وأعد تسجيل الـ webhook بنفس القيمة
  بعد كل نشر — وإلا لن تستجيب الأزرار. الاستثناء الوحيد هو بيئة التطوير.

## 🔐 توكن البوت الخاص بكل مدير (مشفّر في قاعدة البيانات)

عمود `admin_users.telegram_bot_token` **لا يُخزَّن نصاً صريحاً أبداً**
(الميجريشن `081`): القيمة المخزنة دائماً مغلف AES-256-GCM بالصيغة

```
enc:v1:<iv_b64>:<authtag_b64>:<ciphertext_b64>
```

- **مفتاح التشفير**: متغير البيئة `TELEGRAM_TOKEN_KEY` (64 حرف hex —
  `openssl rand -hex 32`). بدون هذا المفتاح تبقى القيمة `NULL` ويعمل
  النظام بالبوت العام `TELEGRAM_BOT_TOKEN`.
- **الحفظ/الحذف**: `PUT`/`DELETE` على `/api/admin/admins/[id]/telegram-token`
  (جلسة Superadmin + كلمة المرور الرئيسية)، أو عبر سكربتات البذر
  `scripts/seed-admin.mjs` و`scripts/update-admin.mjs` — كلها تكتب
  المغلف المشفر فقط، ولا يعيد أي مسار التوكن الصريح أبداً.
- **التوكن المسرّب سابقاً** (التزم مرة في تاريخ الريبو) **أُبطل لدى
  تيليجرام**؛ قاعدة `gitleaks` القائمة تمنع تكرار التزمت.

## 🗄️ النسخ الاحتياطي الشامل للمطور (كل الشركات والمستخدمين)

نظام مجدول يلتقط نسخة كاملة من قاعدة البيانات (كل المستأجرين) كل **6 ساعات**
بواسطة `pg_dump`، يرسلها إلى تيليجرام المطور، ويحتفظ بآخر **5 نسخ فقط** (يحذف
الأقدم من التخزين ومن المحادثة تلقائياً):

1. أضف الأسرار في GitHub (Settings → Secrets → Actions):
   `DATABASE_URL` (بإضافة `?sslmode=require`)، `TELEGRAM_BOT_TOKEN`،
   `TELEGRAM_ADMIN_CHAT_ID`، `SUPABASE_URL`، `SUPABASE_SERVICE_ROLE_KEY`.
2. طبّق ميجريشن `066` عبر `npm run migrate`.
3. الجدولة تلقائية عبر `.github/workflows/global-backup.yml` (كل 6 ساعات؛
   غيّر الـ cron إلى `0 * * * *` لنسخة كل ساعة).

الاسترجاع الآمن (يُطبق على قاعدة بيانات **منفصلة** أولاً ثم التحقق):

```bash
npx tsx scripts/restore-global-backup.ts backup-20260818-140509.dump   # معاينة بدون كتابة
npx tsx scripts/restore-global-backup.ts backup-20260818-140509.dump --target postgresql://... # الاسترجاع الفعلي
```

**التكلفة**: تيليجرام مجاني، وGitHub Actions مجاني عملياً (مستودع عام مجاني
بلا حدود؛ خاص ≈ 180 دقيقة شهرياً لكل 6 ساعات — ضمن الـ 2000 المجانية)، والتكلفة
الوحيدة القابلة للقياس هي خروج بيانات Supabase (5GB شهرياً مجاناً، تكفي كل 6 ساعات
لقاعدة حتى ~100MB). التفاصيل الكاملة: `docs/BACKUP_RESTORE_POLICY.md` §8.

**سلامة استرجاع العملاء**: `/api/backup/validate` يفحص الملف أولاً (توقيع HMAC +
سجل النظام + قائمة الجداول المسموحة + حقن/معرفات) دون كتابة أي شيء، ثم
`/api/backup/upload` يطبقه داخل معاملة واحدة معيداً التحقق كاملاً — الاسترجاع
لا يحذف أي بيانات أبداً ولا يمس أي شركة أخرى (تفاصيل الضمانات في
`docs/BACKUP_RESTORE_POLICY.md` §Restore safety).

## 🔧 متغيرات البيئة المطلوبة

| المتغير | الوصف | مطلوب |
|---------|-------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | رابط مشروع Supabase | ✅ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | المفتاح العام | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | مفتاح الخدمة (سري جداً) | ✅ |
| `TOKEN_SECRET` | مفتاح تشفير JWT (32 حرف+) | ✅ |
| `DATABASE_URL` | رابط Postgres مباشر (اختياري) | ❌ |
| `TELEGRAM_BOT_TOKEN` | بوت Telegram للـ Admin 2FA (البوت العام الافتراضي) | ❌ |
| `TELEGRAM_TOKEN_KEY` | مفتاح تشفير توكن البوت الخاص بكل مدير (`openssl rand -hex 32`) — مطلوب فقط عند حفظ توكن بوت مخصص في قاعدة البيانات | ❌ |
| `TELEGRAM_WEBHOOK_SECRET` | سرّ التحقق من تحديثات تيليجرام الواردة (يجب مطابقته عند تسجيل الـ webhook) | ❌ |
| `SMTP_*` | إعدادات البريد | ❌ |

## 📁 هيكل المشروع

```
src/
├── app/
│   ├── (auth)/       # صفحات الدخول والتسجيل
│   ├── (dashboard)/  # صفحات النظام المحاسبي
│   ├── zerocold/     # لوحة تحكم المطور
│   └── api/          # 100+ API route
├── lib/
│   ├── auth.ts       # JWT + تشفير
│   ├── db.ts         # اتصال pg
│   ├── supabase.ts   # عميل Supabase
│   ├── validation.ts # Zod schemas
│   └── ...
├── components/
│   └── ui/           # مكونات واجهة
└── migrations/       # ملفات SQL
```

## 🛡️ الأمان - تنبيه مهم

هذا المشروع تمت مراجعته أمنياً. قبل الإطلاق:

1. **احذف المفاتيح المسربة** من `scripts/` (تم إصلاحها)
2. **فعل RLS Policies** في Supabase
3. **استخدم Cloudflare Turnstile** بدلاً من CAPTCHA الرياضي
4. **لا ترفع `logs/`** على Git

راجع `SECURITY_AUDIT.md` و `REPORT_PRO-ACC.md`.

## 📝 الترخيص

خاص - جميع الحقوق محفوظة لصاحب المشروع.

## 🤝 المساهمة

هذا مشروع مغلق حالياً. للاستفسار: conta.moha@gmail.com

---

**تم التطوير بـ ❤️ للمحاسبين العرب**
