# تدقيق آلي شامل — عقود الواجهات والأمان

تاريخ التوليد: 2026-08-29T10:12:05.522Z

- مسارات API: **235**
- صفحات اللوحة: **64**

## A) عقود الواجهة ↔ المسارات (MISMATCH = خطر انهيار كصورة المعدات)

| الصفحة | المسار | ما تقرأه الواجهة | ما يرجعه المسار | الحكم |
|---|---|---|---|---|
| credit-notes | /api/${tab |  | <no route file> | NO-ROUTE |
| project-expenses | /api/project-expenses${filterProject |  | <no route file> | NO-ROUTE |

**عدد الاشتباهات: 2** (تحتاج تدقيقًا يدويًا — بعضها إنذارات كاذبة من التعبيرات النمطية)

## B) الأمان

### مسارات بلا حارس مصادقة (5)
- /api/auth/cleanup-inactive [GET,POST] ⚠️ NONE
- /api/auth/logout [POST] ⚠️ NONE
- /api/auth/resend-verification [POST] ⚠️ NONE
- /api/inventory/warehouses [] ⚠️ NONE
- /api/inventory-transactions [] ⚠️ NONE

### مسارات تحتاج تحققًا يدويًا (تحقق المدخلات/عزل المستأجر) (26)
- /api/accounts/seed-default — تحقق: CHECK، عزل: yes
- /api/admin/logout — تحقق: CHECK، عزل: n/a
- /api/advertisements — تحقق: CHECK، عزل: n/a
- /api/app-settings — تحقق: n/a (GET only)، عزل: CHECK
- /api/auth/cleanup-inactive — تحقق: CHECK، عزل: CHECK
- /api/auth/logout — تحقق: CHECK، عزل: CHECK
- /api/auth/resend-verification — تحقق: yes، عزل: CHECK
- /api/auth/subscribe — تحقق: CHECK، عزل: CHECK
- /api/company/export-download — تحقق: CHECK، عزل: yes
- /api/company/reset — تحقق: CHECK، عزل: n/a
- /api/credit-notes/[id] — تحقق: CHECK، عزل: yes
- /api/debit-notes/[id] — تحقق: CHECK، عزل: yes
- /api/fiscal/[id]/close — تحقق: CHECK، عزل: yes
- /api/fiscal/[id]/reopen — تحقق: CHECK، عزل: yes
- /api/fiscal/closing — تحقق: CHECK، عزل: CHECK
- /api/fixed-assets/depreciate — تحقق: CHECK، عزل: yes
- /api/inventory/warehouses — تحقق: CHECK، عزل: CHECK
- /api/inventory-transactions — تحقق: CHECK، عزل: CHECK
- /api/journal/[id] — تحقق: CHECK، عزل: yes
- /api/payment-methods — تحقق: n/a (GET only)، عزل: CHECK
- /api/purchases/returns/[id] — تحقق: CHECK، عزل: yes
- /api/settings/seed-chart — تحقق: CHECK، عزل: yes
- /api/telegram/callback — تحقق: CHECK، عزل: n/a
- /api/telegram/webhook — تحقق: CHECK، عزل: n/a
- /api/upload/receipt — تحقق: CHECK، عزل: yes
- /api/visitors — تحقق: CHECK، عزل: CHECK

### SQL خام بمُدمجات (0)
