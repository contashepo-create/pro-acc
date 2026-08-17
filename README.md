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
في Supabase Dashboard > SQL Editor، شغل:
```sql
-- من ملف src/migrations/000-full-schema.sql
-- ثم 001, 002, ... حتى 007
```

أو استخدم:
```bash
npm run migrate
```

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
- إذا لم تُضبط `TELEGRAM_WEBHOOK_SECRET` في بيئة التطبيق، تُقبل التحديثات
  الواردة بدون تحقق (مع تحذير في السجلات) حتى لا تتعطل الأزرار — يُنصح
  بضبطها وإعادة التسجيل بنفس القيمة لتشغيل التحقق الكامل.

## 🔧 متغيرات البيئة المطلوبة

| المتغير | الوصف | مطلوب |
|---------|-------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | رابط مشروع Supabase | ✅ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | المفتاح العام | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | مفتاح الخدمة (سري جداً) | ✅ |
| `TOKEN_SECRET` | مفتاح تشفير JWT (32 حرف+) | ✅ |
| `DATABASE_URL` | رابط Postgres مباشر (اختياري) | ❌ |
| `TELEGRAM_BOT_TOKEN` | بوت Telegram للـ Admin 2FA | ❌ |
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
