import { z } from 'zod';

export const relationshipUuid = z.string().uuid('المعرف غير صالح');
const uuid = relationshipUuid;
const shortText = (max: number) => z.string().trim().max(max);
const requiredText = (max: number) => shortText(max).min(1);
const nullableUuid = z.preprocess((value) => value === '' ? null : value, uuid.nullable().optional());
const money = z.coerce.number().finite().min(0).max(9_999_999_999_999.99)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8, 'القيمة يجب ألا تتجاوز منزلتين عشريتين');
const positiveMoney = money.refine((value) => value > 0, 'المبلغ يجب أن يكون موجباً');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'التاريخ غير صالح').refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'التاريخ غير صالح');
const nullableDate = z.preprocess((value) => value === '' ? null : value, date.nullable().optional());
const timestamp = z.string().datetime({ offset: true });
const email = z.string().trim().email().max(254);
const nullableEmail = z.preprocess((value) => value === '' ? null : value, email.nullable().optional());
const phone = z.string().trim().max(50);

export const crmType = z.enum(['lead', 'opportunity', 'customer']);
export const crmSource = z.enum(['website', 'referral', 'cold_call', 'tender', 'social', 'other']);
export const crmStage = z.enum(['new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost']);
export const crmCreateSchema = z.object({
  name: requiredText(200), type: crmType, email: nullableEmail, phone: phone.nullable().optional(),
  company_name: shortText(200).nullable().optional(), source: crmSource.optional(), pipeline_stage: crmStage.optional(),
  estimated_value: money.nullable().optional(), description: shortText(4000).nullable().optional(), assigned_to: nullableUuid,
}).strict();
export const crmUpdateSchema = crmCreateSchema.partial().strict()
  .refine((value) => Object.keys(value).length > 0, 'لا توجد بيانات للتحديث');
export const crmFollowupSchema = z.object({
  type: z.enum(['call', 'meeting', 'email', 'visit']).optional(), scheduled_at: timestamp,
  notes: shortText(2000).nullable().optional(),
}).strict();

export const contractType = z.enum(['general', 'client', 'subcontractor', 'supplier', 'employee', 'lease', 'insurance', 'bond']);
export const contractStatus = z.enum(['draft', 'active', 'expired', 'terminated', 'completed']);
const contractFields = {
  title: requiredText(200), type: contractType.optional(), project_id: nullableUuid, contact_id: nullableUuid,
  start_date: date, end_date: date, value: money, description: shortText(4000).nullable().optional(),
};
export const contractCreateSchema = z.object({ ...contractFields, status: z.enum(['draft', 'active']).optional() }).strict()
  .refine((value) => value.start_date <= value.end_date, { message: 'تاريخ نهاية العقد يسبق بدايته', path: ['end_date'] });
export const contractUpdateSchema = z.object({
  title: contractFields.title.optional(), type: contractType.optional(), project_id: nullableUuid, contact_id: nullableUuid,
  start_date: date.optional(), end_date: date.optional(), value: money.optional(),
  description: contractFields.description, status: contractStatus.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'لا توجد بيانات للتحديث');
export const contractDocumentSchema = z.object({
  filename: requiredText(255).refine((value) => !/[\\/\u0000-\u001f]/.test(value), 'اسم الملف غير صالح'),
  content_type: z.enum(['image/jpeg', 'image/png', 'application/pdf']),
  file_data: z.string().min(1), description: shortText(1000).nullable().optional(),
}).strict();

const tenderFields = {
  title: requiredText(200), client_name: requiredText(200), contact_id: nullableUuid,
  reference_number: shortText(120).nullable().optional(), description: shortText(4000).nullable().optional(),
  estimated_value: money.nullable().optional(), bid_bond_amount: money.nullable().optional(),
  submission_deadline: nullableDate, opening_date: nullableDate,
  project_location: shortText(500).nullable().optional(), project_duration_months: z.coerce.number().int().min(0).max(1200).nullable().optional(),
  win_probability: z.coerce.number().int().min(0).max(100).nullable().optional(), notes: shortText(2000).nullable().optional(),
};
export const tenderCreateSchema = z.object({ ...tenderFields, status: z.enum(['draft', 'preparing']).optional() }).strict()
  .refine((value) => !(value.submission_deadline && value.opening_date) || value.submission_deadline <= value.opening_date, {
    message: 'تاريخ فتح المناقصة يسبق موعد التقديم', path: ['opening_date'],
  });
export const tenderUpdateSchema = z.object({
  title: tenderFields.title.optional(), client_name: tenderFields.client_name.optional(), contact_id: nullableUuid,
  reference_number: tenderFields.reference_number, description: tenderFields.description,
  estimated_value: tenderFields.estimated_value, bid_bond_amount: tenderFields.bid_bond_amount,
  submission_deadline: nullableDate, opening_date: nullableDate, project_location: tenderFields.project_location,
  project_duration_months: tenderFields.project_duration_months, win_probability: tenderFields.win_probability, notes: tenderFields.notes,
}).strict().refine((value) => Object.keys(value).length > 0, 'لا توجد بيانات للتحديث');
export const tenderLifecycleStatus = z.enum(['draft', 'preparing', 'submitted', 'won', 'lost', 'cancelled']);
export const tenderStatusSchema = z.object({
  action: z.literal('update_status'), status: z.enum(['preparing', 'submitted', 'won', 'lost', 'cancelled']),
  notes: shortText(2000).nullable().optional(),
}).strict();
export const tenderConversionSchema = z.object({ action: z.literal('convert_to_project') }).strict();
export const tenderCostItemSchema = z.object({
  category: z.enum(['materials', 'labor', 'equipment', 'subcontractor', 'overhead', 'other']),
  description: shortText(1000).nullable().optional(), amount: positiveMoney, notes: shortText(2000).nullable().optional(),
}).strict();

export const bondType = z.enum(['bid_bond', 'performance_bond', 'advance_payment', 'retention', 'warranty', 'insurance', 'other']);
export const bondLifecycleStatus = z.enum(['active', 'expired', 'released', 'cancelled']);
export const bondCreateSchema = z.object({
  title: requiredText(200), type: bondType, amount: positiveMoney, currency: z.string().trim().regex(/^[A-Z]{3}$/).optional(),
  issue_date: date, expiry_date: date, issuing_bank: shortText(200).nullable().optional(), bank_safe_id: nullableUuid,
  beneficiary_name: shortText(200).nullable().optional(), project_id: nullableUuid, tender_id: nullableUuid,
  contact_id: nullableUuid, reference_number: shortText(120).nullable().optional(), notes: shortText(2000).nullable().optional(),
}).strict().refine((value) => value.issue_date <= value.expiry_date, { message: 'تاريخ الانتهاء يسبق تاريخ الإصدار', path: ['expiry_date'] });
export const bondUpdateSchema = z.object({
  title: requiredText(200).optional(), amount: positiveMoney.optional(), expiry_date: date.optional(),
  notes: shortText(2000).nullable().optional(), beneficiary_name: shortText(200).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'لا توجد بيانات للتحديث');
export const bondActionSchema = z.object({
  action: z.enum(['release', 'cancel']), notes: shortText(2000).nullable().optional(),
}).strict();

const taskStatus = z.enum(['not_started', 'in_progress', 'completed', 'blocked', 'on_hold']);
const taskPriority = z.enum(['low', 'medium', 'high', 'critical']);
const hours = z.coerce.number().finite().min(0).max(99_999.99)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8, 'عدد الساعات يجب ألا يتجاوز منزلتين');
const ganttFields = {
  name: requiredText(200), description: shortText(4000).nullable().optional(), start_date: date, end_date: date,
  progress: z.coerce.number().finite().min(0).max(100).optional(), status: taskStatus.optional(), priority: taskPriority.optional(),
  parent_task_id: nullableUuid, assigned_to: nullableUuid, estimated_hours: hours.nullable().optional(), actual_hours: hours.nullable().optional(),
};
export const ganttCreateSchema = z.object({ project_id: uuid, ...ganttFields }).strict()
  .refine((value) => value.start_date <= value.end_date, { message: 'تاريخ نهاية المهمة يسبق بدايتها', path: ['end_date'] });
export const ganttUpdateSchema = z.object({
  name: ganttFields.name.optional(), description: ganttFields.description,
  start_date: date.optional(), end_date: date.optional(), progress: ganttFields.progress,
  status: ganttFields.status, priority: ganttFields.priority, parent_task_id: nullableUuid,
  assigned_to: nullableUuid, estimated_hours: ganttFields.estimated_hours, actual_hours: ganttFields.actual_hours,
}).strict().refine((value) => Object.keys(value).length > 0, 'لا توجد بيانات للتحديث');

export const reminderActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('send_all_overdue') }).strict(),
  z.object({ action: z.literal('send_single'), invoice_id: uuid }).strict(),
  z.object({ action: z.literal('preview'), invoice_id: uuid }).strict(),
]);
