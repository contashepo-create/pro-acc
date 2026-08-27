# تقرير الفحص المحاسبي الشامل — نظام Pro Acc

**التاريخ:** 2026-08-20
**الفرع:** `arena/01a01f7b-pro-acc`
**المرجع:** `783f35d` (main)
**نوع الفحص:** فحص جديد كامل من المصدر — لا يعتمد على أي تقارير قديمة.
**النطاق:** رسائل الأخطاء + حساب تكاليف المشاريع + طريقة توليد التقارير + جرد الوحدات.

---

## ملاحظة مهمة قبل القراءة
هذا التقرير مبني على قراءة فعليّة للمصدر (`src/**`, `supabase-full-schema.sql`, الاختبارات)
وتشغيل مجموعة الاختبارات الكاملة (108 ملفًا، 1131 اختبارًا — كلها ناجحة) وفحص TypeScript.
الملاحظات المذكورة تحت عنوان «خلل/عدم تطابق» هي نتائج فحص مباشر للكود وليست نسخًا من تقارير سابقة.

---

# الجزء 1 — رسائل الأخطاء الحقيقية (تم تنفيذه)

### المشكلة
كانت الأخطاء غير المتوقعة تُعرض للمستخدم بالشكل العام **«حدث خطأ في الخادم»** حتى في بيئة
الإنتاج، رغم أن السبب الحقيقي معروف داخل الخادم. السبب: دالة `serverError()` في
`src/lib/api-helpers.ts` كانت تُخفي الرسالة الحقيقية في الإنتاج.

### ما تم تعديله
1. **`src/lib/api-helpers.ts` — `serverError()`**
   كانت تُعيد في الإنتاج `message: 'حدث خطأ في الخادم'` وتُظهر الرسالة الحقيقية فقط خارج الإنتاج.
   الآن تُعيد **الرسالة الحقيقية دائمًا** مع إبقاء `errorId` للتتبع، والتفاصيل (`details`) تُسجَّل في سجلّ الخادم.
2. **`src/lib/admin-guard.ts` — `adminJsonError()`**
   أصبحت تعرض الرسالة الحقيقية للخطأ بدلًا من الرسالة العامة.
3. **`src/app/api/admin/login/route.ts`**
   استُبدلت 5 مواضع للرسالة العامة «حدث خطأ في الخادم» بالرسالة الفعلية للخطأ المُلتقط
   (`e instanceof Error ? e.message : 'حدث خطأ غير متوقع'`)، مع الإبقاء على رسالة تيليجرام
   والرسائل الأمنية المتعمّدة كما هي.

### الاختبارات المحدّثة
- `src/__tests__/api-helper-residual-functions.test.ts`
- `src/__tests__/admin-guard-branches.test.ts`
- `src/__tests__/admin-global-integrity.test.ts`

### التحقق
- `npx tsc --noEmit` → **صفر أخطاء**.
- `npm test` → **1131/1131 اختبار ناجح** (108 ملفات).
- `npx eslint` على الملفات المعدّلة → **صفر أخطاء** (تحذيرات pre-existing فقط).

> ⚠️ ملاحظة أمنية (توصية وليست منفّذة): كشف رسائل قاعدة البيانات الخام (أسماء الأعمدة،
> SQL hints) للعميل قد يمنح المهاجم معلومات عن بنية المخطط. بما أن الطلب صراحةً هو إظهار
> الخطأ الحقيقي، تم تنفيذه. ننصح مستقبلًا بأفضل ممارسة: إظهار الرسالة الحقيقية للمسؤول
> وإظهار رسالة عامة + `errorId` للمستخدم العادي، أو تصفية أخطاء القيود المفروضة
> (unique/fk/check) وترجمتها لرسائل عربية واضحة.

---

# الجزء 2 — كيف تُحسب تكاليف المشاريع (الربح/الخسارة) في الوضع الحالي

## 2.1 المصدر المركزي للحساب
كل تقارير ربحية المشاريع تعتمد على دالة SQL واحدة:
`get_project_account_totals(p_company_id, p_project_ids, p_from, p_to)`
وملفّات اللاحقة في TS:
- `src/lib/project-costs.ts` → `sumProjectJournal()` و `sumProjectsJournal()` و `accumulateProjectLine()`
- المستهلكون: `reports/project-profit-loss`, `reports/profitability`, `reports/wip`, `reports/operational`, `projects/[id]/financials`.

### منطق الدالة (مباشر من المخطط)
```
SELECT jl.project_id, a.id, a.code, a.name, a.type,
       sum(jl.debit), sum(jl.credit)
FROM journal_lines jl
JOIN journal_entries je ON je.id = jl.journal_entry_id AND je.company_id = ...
  AND je.deleted_at IS NULL AND (je.status='posted' OR je.reversed_by IS NOT NULL)
JOIN accounts a ON a.id = jl.account_id AND a.company_id = ...
JOIN projects p ON p.id = jl.project_id AND p.company_id = ...
WHERE jl.company_id = ... AND jl.project_id IS NOT NULL
  [AND project_id = ANY(...)] [AND je.date بين الفترة]
GROUP BY ...;
```

ثم في `project-costs.ts`:
- **الإيرادات** = مجموع `(credit − debit)` للحسابات من النوع `revenue` الموسومة بـ `project_id`.
- **المصروفات** = مجموع `(debit − credit)` للحسابات من النوع `expense` الموسومة بـ `project_id`.
- **الربح** = الإيرادات − المصروفات.

أي أن الحساب **مقيّد تمامًا بالشركة** (عزل multi-tenant صحيح) و**يتجاهل** المسودّات
`draft` والقيود المحذوفة، ويشمل القيود المعكوسة إلى جانب قيودها العكسية فتتلاشى (تصفّر) بشكل سليم.

## 2.2 ما يتم التقاطه فعليًا كتكلفة مشروع (مباشر/مدعوم)
عند فحص كل مسار إدخال في القيود وجدنا أن هذه المسارات **توسم سطور القيد بـ `project_id`** وتظهر في حساب المشروع:

| المصدر | الحساب | وسم project_id |
|---|---|---|
| مصروفات المشروع `post_project_expense` | 5110/5120/5130/5140/5400 | ✅ نعم |
| شهادات مقاولي الباطن `create_subcontractor_certificate_atomic` | 5130 (تكلفة) | ✅ نعم |
| تكاليف المعدات `post_equipment_cost` | 5140/5270/5250/5120/5260/5400 | ✅ نعم |
| فواتير البيع للمشروع `invoice-accounting` | 4100 (إيراد) | ✅ نعم (سطر الإيراد فقط) |
| فواتير المشتريات المرتبطة بالمشروع `create_purchase_invoice (link_to_project)` | 5100 | ✅ نعم |
| دفعات مقاولي الباطن `create_subcontractor_payment_atomic` | 2150/النقد | ✅ نعم (لكنها التزام/نقد لا تُحتسب تكلفة) |

## 2.3 ما لا يتم التقاطه (تكاليف مباشرة مفقودة) — **خلل محاسبي جوهري**

### أ) المواد المنصرفة من المخزن إلى المشروع — **لا تُوسم بـ `project_id`**
- دالة `post_inventory_movement_atomic` لا تستقبل أي `project_id` (توقيعها بلا وسيط مشروع).
- سطور قيد صرف المواد: `مدين 5100 (تكلفة المبيعات) / دائن 1170 (المخزون)` **بدون** `project_id`.
- النتيجة: **تكلفة المواد المباشرة المنصرفة للمشروع لا تظهر إطلاقًا في تقرير ربحية المشروع**
  إلا إذا دخلت يدويًا عبر «مصروفات المشروع» أو قيد يدوي موسوم.
- لاحظ أن جدول `inventory_transactions` يحتوي عمود `project_id` لكنه يبقى `NULL` دائمًا حاليًا
  لأن RPC لا يملؤه.

### ب) الرواتب والعمالة (payroll / salary sheets) — **لا تُوسم بـ `project_id`**
- `post_payroll_batch` يدرج سطر `5210` مصروف الرواتب **بدون** `project_id`.
- العمالة اليومية (`create_daily_worker_atomic`) لا تولّد قيدًا محاسبيًا أصلاً.
- النتيجة: **الأجور المباشرة لا تدخل في تكلفة المشروع** إلا بمعالجة يدوية.

### ج) القيود اليدوية والسندات/المصروفات العمومية
- تُحتسب فقط إذا قام المستخدم بوسم `project_id` يدويًا؛ لا يوجد تخصيص تلقائي.

## 2.4 التكاليف غير المباشرة / النفقات العامة (overhead) — **غائبة تمامًا**
لا توجد أي آلية في النظام لتخصيص/تحميل النفقات غير المباشرة على المشاريع
(إشراف، تأمينات، مصاريف موقع، عمومية وإدارية، إهلاك ورشة/معدات مشتركة، إلخ).
لذلك **«تكلفة المشروع» المعلنة أقل من التكلفة الحقيقية**، والربحية تبدو أعلى من الواقع.

## 2.5 عدم تطابق أكواد التصنيف بين التقارير — **خلل اتساق**

رمز التكلفة المستخدم عند الإدراج يختلف عن الأكواد المستخدمة عند التصنيف في كل تقرير:

| التصنيف | عند الإدراج (PROJECT_EXPENSE_CODES) | تقرير project-profit-loss | تقرير operational | تقرير projects/costs |
|---|---|---|---|---|
| مواد | 5110 | `511*` ✅ | `511*` ✅ | `511*` ✅ |
| عمالة | 5120 | `521/522` ❌ (يقع في «أخرى») | `521/522` ❌ | `215*` للباطن، و`52* غير 521` فيُصنَّف 5120 **معدات** ❌ |
| مقاول باطن | 5130 | `513*` ✅ | `513*` ✅ | `215*` (رقم التزام) ❌ |
| معدات | 5140 | `512*` ❌ (يقع في «أخرى») | لا يوجد بند معدات ❌ | `52* غير 521` ✅ |
| أخرى | 5400 | «أخرى» ✅ | «مشتريات» ⚠️ | «أخرى» ✅ |

**العواقب العملية:**
- مصروف «عمالة» الذي يُسجَّل في حساب `5120` (مشروع) سيُعرض في تقرير `project-profit-loss`
  و `operational` تحت **«أخرى»** وليس تحت العمالة، وفي تقرير `projects/costs` سيُعرض تحت **«معدات»**.
- تكاليف المعدات (إيجار `5140`، صيانة `5250`، إهلاك `5260`، وقود `5270`) ستُعرض في
  `project-profit-loss` تحت **«أخرى»** لأنها لا تبدأ بـ `512`.
- نفس التقارير الثلاثة تُظهر **توزيعًا مختلفًا** لنفس البيانات → نتيجة مضلّلة للمستخدم.

## 2.6 خلل في تقرير `projects/costs` (استعلام غير مُصفّى)
`src/app/api/projects/costs/route.ts` يجلب `journal_lines` مباشرة عبر
`.eq('project_id', ...)` **بدون** الربط بجدول `journal_entries` لتصفية:
- القيود المحذوفة (`deleted_at`)
- القيود غير المرحّلة (`status <> 'posted'`) والمسودّات
- القيود المعكوسة (يجب أن تتلاشى مع قيدها العكسي)

بينما كل دالة SQL الأخرى (`get_project_account_totals`) تصفّي هذه بشكل سليم.
النتيجة: تقرير `projects/costs` **قد يضخّم التكاليف** أو يدرج قيودًا غير نهائية.

## 2.7 عدم اتساق طريقة حساب الربح في ملخص المشروع
`src/app/api/projects/[id]/financials/route.ts`:
```
actualProfit = journal.revenue > 0 ? journal.profit : (netInvoiced - totalExpenses);
```
تستخدم **طريقتين مختلفتين** حسب وجود إيراد في دفتر الأستاذ أم لا؛ هذا يجعل رقم الربح
غير قابل للمقارنة بين مشروع وآخر وقد يكون ناتجًا عن خلط أساس الإيراد (فاتورة مقابل دفتر أستاذ).

---

# الجزء 3 — هل يطابق المعايير المحاسبية؟

### التقييم العام: **جزئي — لا يفي بالكامل لمعايير عقود المقاولات (IFRS 15 / IAS 11) ولا التقارير المالية العامة.**

| المعيار | الحالة |
|---|---|
| القيد المزدوج المتوازن | ✅ مفروض في `insertJournalLines` و `createJournalEntry` |
| عزل بيانات الشركة (Multi-tenant) | ✅ مقيّد بـ `company_id` في كل الاستعلامات |
| استبعاد المسودّات/المحذوفة/المنقضية من التقارير | ✅ في دوال SQL، ❌ في `projects/costs` |
| الاعتراف بإيراد عقود الإنشاءات الطويلة | ❌ يعتمد على الفوترة (نقطة زمنية) وليس نسبة الإنجاز بشكل متّسق |
| التقاط كامل التكاليف المباشرة (مواد+أجور+معدات+باطن) | ❌ المواد والأجور مفقودة (انظر 2.3) |
| التحميل العادل للتكاليف غير المباشرة/النفقات العامة | ❌ غائب |
| توزيع صحيح للتكلفة على بنود (مواد/عمالة/معدات/باطن) | ❌ أكواد التصنيف غير متطابقة بين التقارير |
| مبدأ الاستحقاق (Accrual) في إيراد المشروع | ❌ جزئي |
| ميزانية تقييم العمل تحت التنفيذ (WIP) | ❌ بيانات التكلفة المدخلة غير كاملة فتنتج نسب إنجاز غير دقيقة |

### الخلاصة
النظام **سليم البنية المحاسبية الأساسية** (قيد مزدوج، عزل، اتساق القيود)، لكن **تكلفة المشروع
المعلنة ناقصة** لأن (أ) التكاليف المباشرة للمواد والأجور لا تُوسم بالمشروع تلقائيًا،
و(ب) لا توجد تخصيصات غير مباشرة، و(ج) توزيع البنود غير متسق. لذلك **ربحية المشروع المعلنة
غير دقيقة (أعلى من الواقع عادةً)** ولا ينبغي الاعتماد عليها للقرارات قبل معالجة هذه النقاط.

---

# الجزء 4 — فحص طريقة توليد التقارير (نتائج سليمة؟)

تم فحص كل التقارير الموجودة تحت `src/app/api/reports/**`:

## 4.1 قائمة الدخل / الميزانية / ميزان المراجعة — `reports/financial`
- التجميع في PostgreSQL عبر `get_financial_statement_rows` (يتجاوز حدود PostgREST، ويشمل الحسابات
  التاريخية غير النشطة، ويستبعد المسودّات/المحذوفة). ✅
- **قائمة الدخل:** `periodCredit - periodDebit` للإيرادات و `periodDebit - periodCredit` للمصروفات
  (نشاط الفترة) → **سليم**.
- **الميزانية العمومية:** الأصول = `cumulativeDebit - cumulativeCredit`، الخصوم/حقوق = العكس،
  مع سطر ربح/خسارة تراكمي `3300-V` = (الإيراد التراكمي − المصروف التراكمي) حتى تاريخ التقرير.
  - السلوك عند إقفال السنة المالية (`close_fiscal_year` ينقل أرصدة الإيراد/المصروف إلى `3200`)
    يجعل الأرقام قابلة للتطابق دون احتساب مزدوج. ✅ (تحقّقنا من أن قيد الإقفال يصفّر حسابَي
    الإيراد والمصروف فيُصبح البند التراكمي `3300-V` ≈ صفر للسنوات المقفلة). ✅
- ملاحظة: تقرير الميزانية يعتمد على «حتى تاريخ التقرير» وليس نهاية السنة فقط — مقبول كتقرير «كما في تاريخ».

## 4.2 تقرير ربحية المشاريع / أرباح وخسائر المشروع — `reports/profitability` و `project-profit-loss`
- يعتمد على دفتر الأستاذ الموسوم بـ `project_id` مع تصفية سليمة. ✅ (البنية)
- لكن **التصنيف غير متسق** (انظر 2.5) و**البيانات ناقصة** (انظر 2.3) → **النتائج غير سليمة/مضلّلة**.
- `completion_percent = revenue / contractValue` (أساس فواتير) وليس نسبة الإنجاز الفعلية.

## 4.3 تقرير WIP (عمل تحت التنفيذ) — `reports/wip` + `computeWip` في `src/lib/construction.ts`
- المنطق الخالص (`computeWip`) سليم رياضيًا: `% = costsIncurred/contract`،
  `earnedRevenue = contract × %`، `over/under-billing`، `costToComplete`، `estimatedProfit`.
- لكن **المدخلات ناقصة**: `costsIncurred` من دفتر الأستاذ تستبعد المواد المنصرفة والأجور
  (لأنها غير موسومة) → **نسبة الإنجاز أضعف من الواقع، و`estimatedProfit` مبالغ فيه**.
- كما أن `costToComplete = contract - costsIncurred` يساوي «القيمة المتبقية من العقد» وليس
  «التكلفة المتوقعة للإنجاز» — وهذا **تعريف غير محاسبي** لـ cost-to-complete (يجب أن يكون تكلفة مقدرة).

## 4.4 تقرير التكاليف التشغيلية — `reports/operational`
- `project-costs` يعتمد `get_project_account_totals` (سليم البنية) لكن تصنيف البنود غير متسق
  (انظر 2.5)، ولا يشمل المواد المنصرفة/الأجور.

## 4.5 تقرير ضريبة القيمة المضافة — `reports/vat`
- يعتمد على حسابات ضريبة المراقبة (control accounts) `get_vat_return_summary` كمرجع،
  والفواتير/فواتير الشراء كدليل مطابقة مع تصفية `posted` وغير المحذوفة. ✅ **منهجية سليمة**.

## 4.6 تقرير التدفق النقدي — `reports/cash-flow`
- الطريقة المباشرة من حركة الحسابات النقدية/البنكية، مع تصنيف تشغيلي/استثماري/تمويلي حسب
  بادئة حساب الطرف المقابل، وتصفية `posted`/غير المحذوفة عبر `loadReportJournalEntries`. ✅
- ملاحظة: تصنيف الأطراف المقابلة بالبادئة `12/13 → استثماري`, `22/31/32 → تمويلي` تقريبي
  وقد يُصنّف بعض البنود خطأً، لكنه مقبول كتقريب مباشر.

## 4.7 تقرير دفتر الأستاذ — `reports/general-ledger`
- يستخدم `get_general_ledger` و `get_account_opening_balance` مع تصفية سليمة. ✅

## 4.8 تقارير أخرى تم فحصها (سليمة المنهجية)
`aging`, `expense-analysis`, `cost-center`, `equity-changes`, `anomalies` (يبني على `lib/analytics/anomaly.ts`),
`consolidation`, `contact-balances`. جميعها تمر عبر `handleApiError` وتستند إلى قيود مثبتة/غير محذوفة.

### خلاصة التقارير
- **سليمة البنية:** قائمة الدخل، الميزانية، ميزان المراجعة، VAT، التدفق النقدي، دفتر الأستاذ.
- **مضلّلة أو ناقصة بيانات:** تقرير ربحية المشروع، WIP، التكاليف التشغيلية، و `projects/costs`
  (بسبب التصنيف غير المتسق + نقص المواد/الأجور + استعلام `projects/costs` غير المُصفّى).

---

# الجزء 5 — جرد شامل للوحدات في كل قسم وكل كود (فحص جديد)

> الأرقام أدناه من فحص فعلي حديث للملفات (وليس من تقرير سابق).

## 5.1 إحصاءات عامة
| المؤشر | العدد |
|---|---|
| إجمالي ملفات TypeScript/TSX في `src/` | 560 |
| صفحات الواجهة (dashboard) | 56 ملف `page.tsx` |
| وحدات لوحة التحكم (أقسام) | 48 قسمًا |
| نقاط نهاية API (`route.ts`) | 229 |
| وحدات `src/lib` | 75 |
| مكوّنات `src/components` | 40 |
| ملفات المخطط المرجعي SQL | `supabase-full-schema.sql` (ناتج من `src/migrations/**`) |

## 5.2 جرد وحدات لوحة التحكم (أقسام + عدد الملفات)
| القسم | ملفات | | القسم | ملفات |
|---|---|---|---|---|
| reports | 3 | | vouchers | 2 |
| purchases | 2 | | journal | 2 |
| invoices | 2 | | custodies | 2 |
| clients | 2 | | warehouses | 1 |
| users | 1 | | suppliers | 1 |
| subscription | 1 | | subcontractors | 1 |
| settings | 1 | | search | 1 |
| salary-sheets | 1 | | quotations | 1 |
| projects | 1 | | project-expenses | 1 |
| progress-billing | 1 | | profile | 1 |
| pos | 1 | | permissions | 1 |
| payroll | 1 | | notifications | 1 |
| messages | 1 | | inventory-transactions | 1 |
| inventory | 1 | | gantt | 1 |
| fixed-assets | 1 | | fiscal | 1 |
| financial-audit | 1 | | equipment | 1 |
| employees | 1 | | employee-advances | 1 |
| dashboard | 1 | | daily-workers | 1 |
| currencies | 1 | | credit-notes | 1 |
| contacts | 1 | | complaints | 1 |
| change-orders | 1 | | categories | 1 |
| cash | 1 | | boq | 1 |
| banks | 1 | | bank-reconciliation | 1 |
| assistant | 1 | | accounts | 1 |

## 5.3 جرد نقاط نهاية API (كل كود API بعدد الـ routes)
- **admin (zerocold):** 36 | **reports:** 16 | **auth:** 13 | **vouchers:** 8 | **fiscal:** 7
- **company:** 6 | **subcontractors:** 5 | **projects:** 5 | **custodies:** 5 | **settings:** 4
- **purchases:** 4 | **inventory:** 4 | **backup:** 4 | **subscription:** 3 | **portal:** 3
- **permissions:** 3 | **notifications:** 3 | **invoices:** 3 | **fixed-assets:** 3 | **equipment:** 3
- **contracts:** 3 | **clients:** 3 | **accounts:** 3
- **warehouses, timesheets, tenders, telegram, salary-sheets, quotations, project-expenses,
  progress-billing, pos, petty-cash, messages, journal, inventory-transactions, gantt,
  employees, employee-advances, daily-workers, currencies, crm, credit-notes, contacts,
  complaints, change-orders, categories, cash, boq, bonds, banks, bank-reconciliation,
  approvals:** بواقع 2 لكل منها
- **وحدات بواقع 1:** visitors, upload, tax-returns, support, reminders, push-notifications,
  payroll, payments, payment-methods, financial-audit, equipment-costs, docs, diagnostics,
  dashboard, csrf-token, cost-centers, budgets, branches, assistant, app-settings,
  advertisements, ads.

## 5.4 جرد دوال SQL المحاسبية الأساسية (من `supabase-full-schema.sql`)
وظائف التجميع/الترحيل المركزية التي تشكّل «الكود المحاسبي» وتؤثر في التكاليف والتقارير:
- `get_project_account_totals`, `get_project_profitability`, `get_project_billing_totals`
- `get_financial_statement_rows`, `get_general_ledger`, `get_account_opening_balance`, `get_account_balance`
- `get_vat_return_summary`, `get_vat_ledger_lines`
- `post_project_expense`, `post_equipment_cost`, `post_inventory_movement_atomic`, `post_payroll_batch`
- `create_subcontractor_certificate_atomic`, `create_subcontractor_payment_atomic`, `create_purchase_invoice`
- `create_journal_entry`, `reverse_journal_entry_atomic`, `close_fiscal_year` / `reopen_fiscal_year`

---

# الجزء 6 — التوصيات (مرتبة بالأولوية)

### حرِج (يؤثر في دقة التكلفة والربحية)
1. **إضافة `project_id` إلى قيد صرف المواد** (`post_inventory_movement_atomic`): استقبال
   وسيط مشروع اختياري، ووسم سطر التكلفة `5100` بـ `project_id` (وكذلك `inventory_transactions.project_id`).
2. **ربط الرواتب/العمالة بالمشروع**: إضافة `project_id` اختياري على بنود الرواتب أو دعم
   توزيعها على المشاريع، حتى تدخل الأجور المباشرة في تكلفة المشروع.
3. **توحيد أكواد التصنيف** بين `project-profit-loss` و `operational` و `projects/costs`
   على مرجع واحد (مثلاً: مواد `511*`، عمالة `512*` أو `521/522`، باطن `513*`، معدات `514/525/526/527`، أخرى).
   الأفضل إنشاء دالة SQL واحدة لإرجاع «تكلفة المشروع مُصنّفة» تُستخدم من كل التقارير.
4. **إصلاح `projects/costs`**: الربط بـ `journal_entries` لتصفية المسودّات/المحذوفة/المنقضية
   كما تفعل باقي الدوال.

### مهم
5. **إدخال تخصيص التكاليف غير المباشرة/النفقات العامة** على المشاريع (أو على الأقل
   الإفصاح صراحةً بأنها غير متضمّنة)، كي لا تُعلن ربحية أعلى من الواقع.
6. **تثبيت أساس واحد للربح** في `projects/[id]/financials` بدل الطريقة المزدوجة.

### تحسينات
7. اعتماد **نسبة الإنجاز (Percentage-of-Completion)** مع بيانات تكلفة مكتملة في تقرير WIP،
   وتصحيح تعريف `costToComplete` (تكلفة تقديرية وليس «متبقي العقد»).
8. رسائل الأخطاء: توازن بين «إظهار الخطأ الحقيقي» (المُنفّذ) وبين تصفية تفاصيل قاعدة
   البيانات الحسّاسة للمستخدمين العاديين، مع إبقاء `errorId` للتتبع.

---

# الجزء 7 — الأخطاء المُعالَجة والمدفوعة (تحديث 2026-08-20)

بعد التقرير، عُولجت الأخطاء القابلة للإصلاح بشكل قاطع ومُتحقق منها على النحو التالي (كلها مدفوعة):

| # | الخطأ | المعالجة |
|---|---|---|
| 1 | صرف المواد من المخزن لا يُوسم بـ `project_id` فيختفي من ربحية المشروع | Migration `071` + تعديل `stock-movements.ts` و `validation.ts` ومسار المخزون: قبل `post_inventory_movement_atomic` الآن `p_project_id` اختياري، يُوثَّق أنه مشروع فعّال تابع للشركة، يُوسم سطر التكلفة `5100` بـ `projectId`، ويُحفظ في `inventory_transactions.project_id`. |
| 2 | أكواد تصنيف التكلفة غير متطابقة بين التقارير | ملف جديد `src/lib/project-cost-classifier.ts` (المصدر الوحيد للتصنيف) واستُخدم في `project-profit-loss` و `operational` و `projects/costs`. |
| 3 | `projects/costs` لا يصفّي المسودّات/المحذوفة/المنقضية فيضخّم الأرقام | أُضيف الربط بـ `journal_entries!inner` مع تصفية `posted` وغير المحذوفة كما في كل دوال التقارير. |
| 4 | الربح في `projects/[id]/financials` بطريقتين مختلفتين (خلط فاتورة ودفتر أستاذ) | ثُبِّت أساس واحد: عند وجود نشاط في دفتر الأستاذ تُؤخذ الإيراد والمصروفات من دفتر الأستاذ، وإلا تُؤخذ الإيراد من الفواتير صافية من الإشعارات الدائنة. |
| 5 | رسائل «حدث خطأ في الخادم» العامة | عُولجت في الجزء 1 (serverError + adminJsonError + مسار دخول الإدارة). |

### الاختبارات المضافة/المحدّثة لهذه المعالجات
- `src/__tests__/project-cost-classifier.test.ts` — جديد (تصنيف كل بند).
- `src/__tests__/stock-integrity.test.ts` — تمرير `project_id` إلى RPC + رفض UUID غير صالح.
- `scripts/test-migrations.mjs` — اختبارات SQL حقيقية: صرف مواد لمشروع يُوسم سطر `5100` و `project_id`،
  رفض ربط مشروع لحسابات غير صرف/إرجاع، ورفض مشروع أجنبي/غير نشط.
- `src/__tests__/projects-reports-integrity.test.ts` — دعم دالة `is` في الـ mock.

### ما بقي معلّقًا عمدًا (يتطلب قرارًا محاسبيًا/بيانات غير متوفرة، وليس خطأً برمجيًا)
- **ربط الرواتب/العمالة بالمشروع**: لا يوجد نموذج «موظف → مشروع» في البيانات؛ تخصيص الأجور يحتاج
  إضافة حقل/شاشة وليس مجرد إصلاح.
- **التكاليف غير المباشرة/النفقات العامة**: لا توجد بيانات/قاعدة تخصيص؛ إدخالها يتطلب مواصفات تخصيص.
- **تقرير WIP**: `costToComplete` و `estimatedProfit` كلاهما = قيمة العقد − التكلفة المتكبدة،
  وهذه نتيجة مفهوم «نسبة الإنجاز = التكلفة/قيمة العقد» المعتمدة حاليًا. التصحيح المحاسبي يتطلب
  «إجمالي التكلفة التقديرية» كبيانات إدخال — وهو غير متوفر حاليًا. أُبقي المنطق كما هو مع اختباراته.

---

## فحص الاختبارات الذي أُجري (دليل الفحص الجديد)
- `npx tsc --noEmit` ✅
- `npx jest --runInBand` → 108 suites / **1131 passed** ✅
- `npx eslint` على الملفات المعدّلة → صفر أخطاء ✅
- قراءة المصدر: `src/lib/project-costs.ts`, `src/lib/stock-movements.ts`,
  `src/lib/report-journal.ts`, `src/lib/construction.ts`, `src/lib/api-helpers.ts`,
  `src/lib/admin-guard.ts`, `src/app/api/projects/**`, `src/app/api/reports/**`,
  والدوال المحاسبية في `supabase-full-schema.sql`.
