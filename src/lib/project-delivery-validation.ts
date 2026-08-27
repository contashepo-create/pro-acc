import { z } from 'zod';

export const deliveryUuid = z.string().uuid('المعرف غير صالح');
export const deliveryDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'التاريخ غير صالح').refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'التاريخ غير صالح');
const money = z.number().finite().max(9_999_999_999_999.99)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8, 'القيمة يجب ألا تتجاوز منزلتين عشريتين');
const nonnegativeMoney = money.min(0);
const positiveMoney = money.positive();

export const boqCreateSchema = z.object({
  project_id: deliveryUuid,
  item_code: z.string().trim().max(80).optional(),
  code: z.string().trim().max(80).optional(),
  description: z.string().trim().min(1).max(1000),
  unit: z.string().trim().min(1).max(40),
  quantity: positiveMoney,
  unit_price: nonnegativeMoney,
}).strict();
export const boqUpdateSchema = z.object({
  item_code: z.string().trim().max(80).optional(),
  code: z.string().trim().max(80).optional(),
  description: z.string().trim().min(1).max(1000).optional(),
  unit: z.string().trim().min(1).max(40).optional(),
  quantity: positiveMoney.optional(),
  unit_price: nonnegativeMoney.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'لا توجد تغييرات');

export const projectExpenseCreateSchema = z.object({
  project_id: deliveryUuid,
  expense_type: z.enum(['materials', 'labor', 'subcontractor', 'equipment', 'other']),
  description: z.string().trim().min(1).max(2000),
  amount: positiveMoney,
  date: deliveryDate,
  contact_id: deliveryUuid.nullable().optional(),
  bank_safe_id: deliveryUuid.nullable().optional(),
  notes: z.string().trim().max(2000).optional(),
  tax_rate: z.number().finite().min(0).max(1)
    .refine((value) => Math.abs(value * 10000 - Math.round(value * 10000)) < 1e-8).optional(),
  tax_enabled: z.boolean().optional(),
}).strict();
export const projectExpenseUpdateSchema = z.object({ notes: z.string().trim().max(2000).nullable() }).strict();

export const progressBillingCreateSchema = z.object({
  project_id: deliveryUuid,
  date: deliveryDate,
  claim_number: z.string().trim().max(80).optional(),
  description: z.string().trim().max(2000).optional(),
  notes: z.string().trim().max(2000).optional(),
  gross_amount: positiveMoney,
  retention_rate: z.number().finite().min(0).max(1).optional(),
  retention_percentage: z.number().finite().min(0).max(100).optional(),
  tax_rate: z.number().finite().min(0).max(1).optional(),
  tax_enabled: z.boolean().optional(),
  is_final: z.boolean().optional(),
}).strict().refine((value) => !(value.retention_rate !== undefined && value.retention_percentage !== undefined), {
  message: 'حدد صيغة واحدة لنسبة الاستقطاع', path: ['retention_rate'],
});
export const progressBillingUpdateSchema = z.object({
  claim_number: z.string().trim().max(80).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  is_final: z.boolean().optional(),
  status: z.literal('cancelled').optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'لا توجد تغييرات');

const projectItemSchema = z.object({
  description: z.string().trim().min(1).max(1000),
  unit: z.string().trim().min(1).max(40),
  quantity: positiveMoney,
  unit_price: nonnegativeMoney,
  total: nonnegativeMoney.optional(),
}).strict();
export const projectCreateSchema = z.object({
  name: z.string().trim().min(1).max(300), client_id: deliveryUuid.nullable().optional(),
  contract_value: nonnegativeMoney.optional(), start_date: deliveryDate,
  end_date: deliveryDate.nullable().optional(), status: z.enum(['active', 'on_hold']).optional(),
  description: z.string().trim().max(4000).optional(), location: z.string().trim().max(1000).optional(),
  auto_invoice: z.boolean().optional(), items: z.array(projectItemSchema).max(1000).optional(),
}).strict().superRefine((value, context) => {
  const itemTotal = (value.items || []).reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
  if ((value.contract_value || itemTotal) <= 0) context.addIssue({ code: z.ZodIssueCode.custom, message: 'قيمة العقد يجب أن تكون أكبر من صفر', path: ['contract_value'] });
  if (value.end_date && value.end_date < value.start_date) context.addIssue({ code: z.ZodIssueCode.custom, message: 'تاريخ النهاية يسبق تاريخ البداية', path: ['end_date'] });
});
export const projectUpdateSchema = z.object({
  name: z.string().trim().min(1).max(300).optional(), client_id: deliveryUuid.nullable().optional(),
  contract_value: positiveMoney.optional(), start_date: deliveryDate.optional(), end_date: deliveryDate.nullable().optional(),
  budget: nonnegativeMoney.optional(), status: z.enum(['active', 'on_hold']).optional(),
  description: z.string().trim().max(4000).nullable().optional(), location: z.string().trim().max(1000).nullable().optional(),
  auto_invoice: z.boolean().optional(), items: z.array(projectItemSchema).max(1000).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'لا توجد تغييرات');
export const projectCloseSchema = z.object({
  close_date: deliveryDate.optional(), notes: z.string().trim().max(4000).optional(),
}).strict();

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
export const equipmentCreateSchema = z.object({
  name: z.string().trim().min(1).max(300),
  type: z.string().trim().min(1).max(100),
  model: optionalText(200), manufacturer: optionalText(200),
  year_of_manufacture: z.number().int().min(1900).max(2200).nullable().optional(),
  serial_number: optionalText(200), plate_number: optionalText(100),
  purchase_date: deliveryDate.nullable().optional(), purchase_cost: nonnegativeMoney.optional(),
  depreciation_method: z.enum(['straight_line', 'declining_balance', 'units_of_production']).optional(),
  useful_life_years: z.number().int().min(1).max(100).optional(),
  hourly_rate: nonnegativeMoney.optional(), assigned_project_id: deliveryUuid.nullable().optional(),
  assigned_operator_id: deliveryUuid.nullable().optional(),
  status: z.enum(['available', 'in_use', 'maintenance']).optional(),
  location: optionalText(500), notes: optionalText(2000),
  last_maintenance_date: deliveryDate.nullable().optional(),
  maintenance_interval_days: z.number().int().min(1).max(36500).optional(),
}).strict();
export const equipmentUpdateSchema = equipmentCreateSchema.omit({
  purchase_date: true, purchase_cost: true, depreciation_method: true, useful_life_years: true,
}).partial().strict().refine((value) => Object.keys(value).length > 0, 'لا توجد تغييرات');
export const equipmentMaintenanceSchema = z.object({
  maintenance_date: deliveryDate,
  type: z.enum(['routine', 'repair', 'inspection', 'overhaul', 'emergency']).optional(),
  description: z.string().trim().min(1).max(2000),
  cost: nonnegativeMoney.optional(),
  performed_by: z.string().trim().max(300).optional(),
  next_maintenance_date: deliveryDate.nullable().optional(),
  parts_replaced: z.string().trim().max(4000).optional(),
}).strict().refine((value) => !value.next_maintenance_date || value.next_maintenance_date >= value.maintenance_date, {
  message: 'موعد الصيانة القادمة يسبق تاريخ الصيانة', path: ['next_maintenance_date'],
});

export const dailyWorkerCreateSchema = z.object({
  name: z.string().trim().min(1).max(200), phone: z.string().trim().max(50).optional(),
  daily_wage: nonnegativeMoney,
}).strict();
export const dailyWorkerUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(), phone: z.string().trim().max(50).nullable().optional(),
  daily_wage: nonnegativeMoney.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'لا توجد تغييرات');
