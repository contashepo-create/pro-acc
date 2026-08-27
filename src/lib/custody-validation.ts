import { z } from 'zod';

const MAX_MONEY = 9_999_999_999_999.99;
export const custodyUuid = z.string().uuid('المعرف غير صالح');
export const custodyDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'التاريخ غير صالح').refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'التاريخ غير صالح');
export const custodyMoney = z.number().finite().positive().max(MAX_MONEY)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8, 'المبلغ يجب ألا يتجاوز منزلتين عشريتين');
export const custodyText = z.string().trim().max(2000);

export const openCustodySchema = z.object({
  employee_id: custodyUuid,
  date: custodyDate,
  amount: custodyMoney,
  bank_safe_id: custodyUuid,
  project_id: custodyUuid.nullable().optional(),
  reason: custodyText.optional(),
  description: custodyText.optional(),
}).strict();

export const addCustodyFundsSchema = z.object({
  date: custodyDate.optional(),
  amount: custodyMoney,
  bank_safe_id: custodyUuid,
  description: custodyText.optional(),
}).strict();

export const custodyExpenseSchema = z.object({
  date: custodyDate.optional(),
  amount: custodyMoney,
  description: custodyText.min(1, 'بيان المصروف مطلوب'),
  expense_account_code: z.string().trim().regex(/^\d{3,20}$/, 'كود حساب المصروف غير صالح').optional(),
  allow_excess: z.boolean().optional(),
  link_to_project: z.boolean().optional(),
  project_id: custodyUuid.nullable().optional(),
  invoice_id: custodyUuid.nullable().optional(),
  purchase_invoice_id: custodyUuid.nullable().optional(),
}).strict().refine((value) => !(value.invoice_id && value.purchase_invoice_id), {
  message: 'حدد مستنداً واحداً فقط', path: ['invoice_id'],
});

export const settleCustodySchema = z.object({
  confirm: z.literal(true, { message: 'إغلاق الملف يتطلب تأكيداً صريحاً' }),
  date: custodyDate.optional(),
  returned_cash: z.number().finite().min(0).max(MAX_MONEY)
    .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8, 'المبلغ يجب ألا يتجاوز منزلتين عشريتين').optional(),
  bank_safe_id: custodyUuid.nullable().optional(),
  description: custodyText.optional(),
}).strict();

export const updateCustodySchema = z.object({
  reason: custodyText.nullable().optional(),
  description: custodyText.nullable().optional(),
  notes: custodyText.nullable().optional(),
  project_id: custodyUuid.nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'لا توجد بيانات للتحديث');
