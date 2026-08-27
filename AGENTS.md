# Agent Instructions

> ⚠️ Sandbox lesson learned: the workspace may be re-cloned between turns.
> **Uncommitted working-tree files survive; unpushed local commits do NOT.**
> Therefore: commit+push everything possible immediately, and deliberately
> leave unpushable files (e.g. `.github/workflows/ci.yml` when the App lacks
> `workflows` permission) *uncommitted in the working tree* so snapshots keep
> them — never as dangling local commits.

## Git / session workflow rules (mandatory)

- Work happens on the current Arena session branch (`arena/**`). Never switch
  to, create, or push to any other branch.
- **After ANY file modification, commit AND push immediately**
  (`git push origin <session-branch>`). Never leave changes sitting only in
  the working tree or in unpushed local commits — unpushed work is lost work.
- If a push is partially rejected (e.g. GitHub App lacks the `workflows`
  permission for `.github/workflows/**`), push everything else immediately
  and report the blocked files explicitly instead of holding the whole set.
- Verify before committing when touching code: `npx tsc --noEmit`,
  `npm run lint`, `npm test`.

## Section-by-section review rules (قواعد مراجعة الأقسام)

- Review ONE section at a time with programming + accounting + security
  expertise; never rush and never do superficial tests.
- Each section must be validated on: frontend interaction, backend/API
  behavior, create/save, edit/update, data validation & integrity
  (double-entry balance, tenant isolation), and security (authz, injection,
  secrets). Write/run real tests (jest) plus manual API probing where possible.
- Do not leave a section until it is production-ready برمجياً ومحاسبياً
  وأمنياً. Fix every finding, commit+push immediately, THEN ask the user
  before moving to the next section.
- Review order (dependency first):
  1. المصادقة والأمان العام (auth/sessions/rate-limit/CSRF)
  2. الإعداد الأولي وشجرة الحسابات  3. القيود اليومية والترقيم  4. الفواتير وZATCA
  5. المشتريات  6. السندات والبنوك والخزائن  7. المخزون  8. العملاء والموردون
  9. المشاريع والمقايسات  10. الموظفون والرواتب  11. الأصول الثابتة
  12. التقارير المالية  13. السنة المالية والإقفال  14. الإشعارات والاعتمادات
  15. الإعدادات والصلاحيات  16. الاشتراكات والترخيص والمدفوعات
  17. لوحة المطور zerocold  18. النسخ الاحتياطي وتصفير البيانات
  19. الموديولات المتبقية (POS/البوابة/العروض/الإشعارات الدائنة...)

## قواعد سير العمل (إلزامية)

- بعد أي تعديل على الملفات يجب تنفيذ commit ثم push فوراً إلى فرع الجلسة،
  ولا يُترك أي تعديل بدون دفع كي لا تضيع التعديلات.
- في حال رفض دفع ملفات معينة (مثل ملفات workflows) يتم دفع باقي التعديلات
  فوراً والإبلاغ صراحةً عن الملفات المتعذّر دفعها.
