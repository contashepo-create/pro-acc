# Agent Instructions

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

## قواعد سير العمل (إلزامية)

- بعد أي تعديل على الملفات يجب تنفيذ commit ثم push فوراً إلى فرع الجلسة،
  ولا يُترك أي تعديل بدون دفع كي لا تضيع التعديلات.
- في حال رفض دفع ملفات معينة (مثل ملفات workflows) يتم دفع باقي التعديلات
  فوراً والإبلاغ صراحةً عن الملفات المتعذّر دفعها.
