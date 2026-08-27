# مراجعة الاستجابة للموبايل (Responsive / Mobile) — تقرير شامل

**التاريخ:** 2026-08-12
**النطاق:** جميع صفحات المشروع (لوحة التحكم + صفحة المطور Zerocold) على الشاشات الصغيرة والمتوسطة (360px → 1024px) والمتصفحات غير اللابتوب.
**المنهجية:** مراجعة كودية منهجية لكل الصفحات والمكوّنات المشتركة، مع تحديد الأنماط المكسورة واستبدالها بأنماط استجابية صحيحة. (لم يتسنَّ تشغيل التطبيق كاملاً في بيئة الفحص لغياب بيانات الاتصال بـ Supabase والخطوط، لذا نوصي بمعاينة بصرية نهائية — راجع القسم الأخير.)

---

## 1) ملخص النتائج

المكوّنات المشتركة (Header، Sidebar، الجداول، القوائم المنسدلة، صفحة تسجيل الدخول) كانت في أغلبها **سليمة** وتستخدم `overflow-x-auto` للجداول ونمط `flex-wrap` الصحيح. المشاكل الحقيقية تمركزت في ثلاثة أنماط متكررة:

| # | المشكلة | الأثر على الموبايل | الحالة |
|---|---------|-------------------|--------|
| 1 | شبكات `grid-cols-2/3/4` بلا أساس استجابي `grid-cols-1` | حقول النماذج والبطاقات تنضغط في عمودين/ثلاثة على شاشة الجوال | ✅ أُصلحت |
| 2 | جداول المحرِّرات داخل حاوية `overflow-hidden` | محتوى الجدول يُقصّ ولا يمكن تمريره أفقياً | ✅ أُصلحت |
| 3 | عدم وجود حماية من التمرير الأفقي للصفحة كاملة | "قفز" الشاشة أفقياً عند وجود أي عنصر عريض | ✅ أُصلحت |
| 4 | محرِّر الفاتورة (عمودان جنباً إلى جنب) | لا يتناسب مع شاشة الجوال ويضيّق المحتوى | ✅ أُصلحت |
| 5 | حواشي/رأس النوافذ المنبثقة (Modal) ثابتة `p-6` | هدر مساحة الشاشة في الجوال | ✅ أُصلحت |

---

## 2) ما تم إصلاحه فعلياً

### 2.1 حماية عامة من التمرير الأفقي — `src/app/globals.css`
- إضافة `overflow-x: hidden` على `html` و `body` لمنع «رقص» الصفحة أفقياً عند وجود أي عنصر عريض.
- إضافة `img, video, canvas, iframe { max-width: 100% }` لمنع تجاوز الوسائط للشاشة.
- إضافة `min-height: 100dvh` و `text-size-adjust` للتحكم الأفضل على الجوال.
- إزالة تسليط الضوء عند اللمس على الأزرار (تحسين اللمس).

### 2.2 شبكات النماذج والبطاقات — ~50 موضعاً عبر 30+ صفحة
تحويل `grid grid-cols-2 gap-4` و `grid-cols-2 gap-3` و `grid-cols-3 gap-4`
إلى `grid grid-cols-1 sm:grid-cols-2/3 gap-4`.
> النتيجة: على الجوال (‏<640px) تتكدّس الأعمدة عمودياً، وعلى الشاشات الأكبر يعود نفس التصميم السابق تماماً.
> **الأثر في:** clients، invoices، vouchers، purchases، project*، employees، custodies، fixed-assets، boq، reports، inventory*، subscription، settings، permissions، pos، zerocold/app-settings، zerocold/reports وغيرها.

### 2.3 جداول المحرِّرات (تمرير أفقي بدل القص) — `journal`، `credit-notes`، `purchases/*`، `quotations`، `zerocold/*`
تحويل حاويات الجداول من `overflow-hidden` إلى `overflow-x-auto`
حتى لا يُقصّ جدول يحتوي أعمدة ذات `min-w-[280px]` / `w-28` على شاشة الجوال، بل يُمرَّر أفقياً.

### 2.4 محرِّر الفاتورة — `src/app/(dashboard)/invoices/page.tsx`
- تغيير تخطيط المحرِّر من `flex gap-6` إلى `flex flex-col lg:flex-row` (يتكدّس عمودياً على الجوال).
- جعل الشريط الجانبي (ملخص الفاتورة) من `w-80` إلى `w-full lg:w-80`.
- جعل رأس المحرِّر `flex-wrap` وتقليص العنوان على الشاشات الصغيرة لمنع تجاوز العرض.

### 2.5 النوافذ المنبثقة — `src/components/ui/Modal.tsx`
- حواشي استجابية `px-4 sm:px-6` و `pt-5 sm:pt-6`.
- عنوان قابل للالتفاف + `break-words` لتجنّب تجاوز النصوص الطويلة.
- رفع حد الارتفاع القابل للتمرير إلى `max-h-[75vh]`.

### 2.6 محرِّر القيد المحاسبي — `src/app/(dashboard)/journal/new/page.tsx`
- `max-w-5xl mx-auto p-4 sm:p-6` بدل `p-6`.
- جدول بنود القيد أصبح `overflow-x-auto`.
- صف الإجماليات أصبح `flex-wrap`.

---

## 3) أمور تم إبقاؤها متعمَّداً (وثائق الطباعة)
- **صفحة عرض الفاتورة** `invoices/[id]/view` وتنسيقات الطباعة (`@media print`) حُفظت كما هي لئلّا تتأثر مخرجات A4 الاحترافية. (أُعيدت أية تغييرات مسّتها أثناء الفحص.)
- شبكات توقيعات الوثائق داخل صيغ الطباعة تُركت بعمودين لأنها جزء من تصميم المستند المطبوع.

---

## 4) توصيات إضافية (متبقّية / للمعاينة اليدوية)
1. **معاينة بصرية نهائية:** التشغيل ببيانات حقيقية (Supabase) وفحص كل صفحة على أحجام 360px / 390px / 768px / 1024px عبر DevTools أو Lighthouse Mobile. هذه المعاينة ضرورية لتأكيد النتائج لأن البيئة الحالية لا تسمح بتسجيل الدخول الفعلي.
2. **أعمدة الجداول في الشاشة الصغيرة:** رغم أنّ `DataTable` تمرَّر أفقياً، يُستحسن مستقبلاً «ميزة إخفاء الأعمدة» (موجودة أصلاً في `DataTable`) وتفعيلها افتراضياً على الجوال، أو عرض الجداول كبطاقات عند الضرورة.
3. **حجم الخط والتلامس:** التأكد من أن أهداف اللمس (الأزرار) ≥ 44px على الجوال في الصفحات المزدحمة.
4. **خطر البناء/الخطوط:** `next/font/google` يجلب الخطوط من Google Fonts وقت البناء؛ لو تعذّر الوصول للإنترنت عند البناء/النشر تفشل العملية. يُنصح بحفظ الخطوط محلياً (`next/font/local` أو `@fontsource`) لتحسين الاستقرار — وهذا مستقلّ عن قضية الموبايل.
5. **الـ iframe/بث الـ preview:** إن أردت معاينة مباشرة في المتصفح، تأكد من تعريف `NEXT_PUBLIC_SUPABASE_URL` و `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

---

## 5) قائمة الملفات المعدّلة
- `src/app/globals.css`
- `src/components/ui/Modal.tsx`
- `src/app/(dashboard)/invoices/page.tsx`
- `src/app/(dashboard)/journal/new/page.tsx`
- `src/app/(dashboard)/journal/page.tsx`
- `src/app/(dashboard)/credit-notes/page.tsx`
- `src/app/(dashboard)/purchases/invoices/page.tsx`
- `src/app/(dashboard)/purchases/orders/page.tsx`
- `src/app/(dashboard)/quotations/page.tsx`
- `src/app/(dashboard)/clients/[id]/statement/page.tsx`
- `src/app/(dashboard)/reports/page.tsx`
- + ~25 صفحة أخرى (banks، boq، cash، contacts، custodies، daily-workers، employee-advances، employees، fixed-assets، inventory*، permissions، pos، progress-billing، project-expenses، projects، settings، subcontractors، subscription، suppliers، vouchers/*)
- + صفحات المطوّر Zerocold: `app-settings`، `codes`، `companies`، `logs`، `reports`، `upgrade-requests`

**التحقق:** `npx tsc --noEmit` يمرّ بدون أخطاء بعد كل التعديلات.
