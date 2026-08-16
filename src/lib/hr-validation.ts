import { z } from 'zod';

const MAX_MONEY = 9_999_999_999_999.99;
export const hrUuid = z.string().uuid('المعرف غير صالح');
export const hrDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'التاريخ غير صالح').refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'التاريخ غير صالح');
const money = z.number().finite().min(0).max(MAX_MONEY)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8, 'القيمة يجب ألا تتجاوز منزلتين عشريتين');
const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();
const email = z.union([z.string().trim().email().max(320), z.literal(''), z.null()]).optional();

export const employeeCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  phone: nullableText(50),
  email,
  salary: money,
  department: nullableText(200),
  position: nullableText(200),
  hire_date: hrDate,
}).strict();
export const employeeUpdateSchema = employeeCreateSchema.partial().strict()
  .refine((value) => Object.keys(value).length > 0, 'لا توجد بيانات للتحديث');

export const employeeAdvanceCreateSchema = z.object({
  employee_id: hrUuid,
  amount: money.refine((value) => value > 0, 'المبلغ يجب أن يكون موجباً'),
  date: hrDate.optional(),
  reason: z.string().trim().max(2000).optional(),
  bank_safe_id: hrUuid,
}).strict();
export const employeeAdvanceUpdateSchema = z.object({
  reason: z.string().trim().max(2000).nullable(),
}).strict();

export const payrollBatchSchema = z.object({
  date: hrDate,
  employee_ids: z.array(hrUuid).min(1).max(500),
}).strict().refine((value) => new Set(value.employee_ids).size === value.employee_ids.length, {
  message: 'لا يمكن تكرار الموظف في دفعة الرواتب', path: ['employee_ids'],
});

export const fixedAssetCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  code: z.string().trim().regex(/^[A-Za-z0-9_-]{1,20}$/, 'رمز الأصل غير صالح'),
  category: z.string().trim().min(1).max(100),
  purchase_date: hrDate,
  purchase_cost: money.refine((value) => value > 0, 'تكلفة الشراء يجب أن تكون موجبة'),
  useful_life_years: z.number().int().min(1).max(100),
  depreciation_method: z.enum(['straight_line', 'declining_balance']).optional(),
  location: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(2000).optional(),
  bank_safe_id: hrUuid,
}).strict();
export const fixedAssetUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  location: z.string().trim().max(500).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'لا توجد بيانات للتحديث');
