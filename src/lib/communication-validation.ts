import { z } from 'zod';

export const communicationUuid = z.string().uuid('المعرف غير صالح');
export const approvalCreateSchema = z.object({
  entity_type: z.enum(['journal_entry', 'purchase_invoice', 'payroll', 'cash_transaction']),
  entity_id: communicationUuid,
  description: z.string().trim().max(2000).optional(),
}).strict();
export const approvalDecisionSchema = z.object({
  action: z.enum(['approve', 'reject']),
  comments: z.string().trim().max(2000).optional(),
}).strict();
export const companyMessageSchema = z.object({
  subject: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(5000),
}).strict();
export const adminCompanyMessageSchema = companyMessageSchema.extend({ companyId: communicationUuid }).strict();
export const telegramConfigSchema = z.object({
  chat_id: z.string().trim().regex(/^-?\d{1,20}$/).or(z.literal('')),
  is_enabled: z.boolean(), notify_invoices: z.boolean(), notify_cash_transactions: z.boolean(),
  notify_user_logins: z.boolean(), approvals_enabled: z.boolean(),
  approval_threshold: z.coerce.number().finite().min(0).max(9_999_999_999_999.99)
    .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8, 'حد الموافقة يجب ألا يتجاوز منزلتين'),
}).strict().refine((value) => !(value.is_enabled || value.approvals_enabled) || !!value.chat_id, {
  message: 'معرف محادثة تيليجرام مطلوب عند التفعيل', path: ['chat_id'],
});
const pushAction = z.object({
  action: z.string().trim().min(1).max(80), title: z.string().trim().min(1).max(120),
  icon: z.string().trim().max(500).optional(),
}).strict();
export const pushSubscriptionSchema = z.object({
  subscription: z.object({
    endpoint: z.string().url().max(4096).refine((value) => value.startsWith('https://'), 'endpoint يجب أن يستخدم HTTPS'),
    keys: z.object({ p256dh: z.string().min(1).max(2048), auth: z.string().min(1).max(1024) }).strict(),
  }).strict(),
}).strict();
export const pushQueueSchema = z.object({
  title: z.string().trim().min(1).max(200), message: z.string().trim().min(1).max(2000),
  url: z.string().trim().max(2000).refine((value) => value.startsWith('/') && !value.startsWith('//'), 'رابط الإشعار غير صالح').optional(),
  target_user_id: communicationUuid.optional(),
  target_role: z.enum(['admin', 'manager', 'accountant', 'supervisor']).optional(),
  tag: z.string().trim().max(200).optional(), actions: z.array(pushAction).max(5).optional(),
}).strict().refine((value) => !(value.target_user_id && value.target_role), {
  message: 'حدد مستخدماً أو دوراً واحداً فقط', path: ['target_user_id'],
});
export const notificationCreateSchema = z.object({
  type: z.string().trim().regex(/^[a-z0-9_-]{1,40}$/i), title: z.string().trim().min(1).max(160),
  message: z.string().trim().min(1).max(1000), link: z.string().trim().max(2000).optional(),
}).strict();
export const notificationReadSchema = z.object({ isRead: z.boolean().optional() }).strict();
export const publicComplaintSchema = z.object({
  type: z.enum(['complaint', 'suggestion']).optional().default('complaint'),
  name: z.string().trim().min(1).max(120), email: z.string().trim().email().max(254),
  subject: z.string().trim().min(1).max(200), message: z.string().trim().min(1).max(5000),
}).strict();
export const tenantComplaintSchema = z.object({
  type: z.enum(['complaint', 'suggestion']).optional().default('complaint'),
  subject: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(5000),
}).strict();
export const complaintPatchSchema = z.object({
  subject: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().min(1).max(5000).optional(), status: z.literal('closed').optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'لا توجد حقول قابلة للتحديث');
export const adminComplaintPatchSchema = z.object({
  id: communicationUuid, status: z.enum(['pending', 'read', 'replied', 'closed']).optional(),
  adminReply: z.string().max(5000).optional(),
}).strict().refine((value) => value.status !== undefined || value.adminReply !== undefined, 'لا توجد حقول قابلة للتحديث');
export const supportTicketCreateSchema = z.object({
  subject: z.string().trim().min(3).max(200), message: z.string().trim().min(10).max(5000),
  category: z.enum(['billing', 'payment', 'technical', 'account', 'data_request', 'other']).optional().default('other'),
  attachment_url: z.string().trim().max(2048).optional(),
}).strict();
export const adminSupportPatchSchema = z.object({
  id: communicationUuid, status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(),
  admin_notes: z.string().max(2000).optional(),
}).strict().refine((value) => value.status !== undefined || value.admin_notes !== undefined, 'لا توجد حقول قابلة للتحديث');
