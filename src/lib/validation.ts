import { z } from 'zod';

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

// --------------- Password policy (shared) ---------------

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'p@ssw0rd', '123456', '1234567', '12345678',
  '123456789', '1234567890', 'qwerty', 'qwerty123', 'abc123', '111111',
  'letmein', 'admin123', 'iloveyou', 'welcome', 'monkey', 'dragon',
  'كلمةالمرور', 'كلمةسر', 'كلمةسر123',
]);

export function isCommonPassword(password: string): boolean {
  return COMMON_PASSWORDS.has(password.toLowerCase());
}

/**
 * Central password policy for account-creation/change flows.
 * NOTE: loginSchema intentionally stays permissive (min 6) so existing
 * users with legacy 6-char passwords are not locked out at sign-in.
 */
export const passwordPolicy = z.string()
  .min(8, 'كلمة المرور يجب أن تكون 8 أحرف على الأقل')
  .max(128, 'كلمة المرور طويلة جداً')
  .refine((p) => !isCommonPassword(p), {
    message: 'كلمة المرور شائعة جداً، استخدم كلمة أكثر قوة',
  });

function isValidDateString(val: string): boolean {
  if (!dateRegex.test(val)) return false;
  const d = new Date(val + 'T00:00:00');
  if (isNaN(d.getTime())) return false;
  const [y, m, day] = val.split('-').map(Number);
  return d.getFullYear() === y && d.getMonth() + 1 === m && d.getDate() === day;
}

// --------------- Auth ---------------

export const loginSchema = z.object({
  email: z.string().email('البريد الإلكتروني غير صالح'),
  password: z.string().min(6, 'كلمة المرور يجب أن تكون 6 أحرف على الأقل'),
});

export const registerSchema = z.object({
  companyName: z.string().min(1, 'اسم الشركة مطلوب').max(200),
  name: z.string().min(1, 'الاسم مطلوب').max(100),
  email: z.string().email('البريد الإلكتروني غير صالح').max(254),
  password: passwordPolicy,
  phone: z.string().optional(),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('البريد الإلكتروني غير صالح'),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'الرمز مطلوب'),
  password: passwordPolicy,
});

// --------------- Admin ---------------

export const adminLoginSchema = z.object({
  email: z.string().email('البريد الإلكتروني غير صالح'),
  password: z.string().min(1, 'كلمة المرور مطلوبة'),
});

export const adminMasterSchema = z.object({
  masterPassword: z.string().min(1, 'كلمة المرور الرئيسية مطلوبة'),
});

// --------------- Company ---------------

export const companySchema = z.object({
  name: z.string().min(1, 'اسم الشركة مطلوب').max(200),
  nameEn: z.string().optional(),
  registrationNumber: z.string().optional(),
  taxNumber: z.string().optional(),
  vatNumber: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email('البريد الإلكتروني غير صالح').optional().or(z.literal('')),
  logo: z.string().optional(),
  commercialRecord: z.string().optional(),
}).strict();

// --------------- Accounts (Chart of Accounts) ---------------

export const accountSchema = z.object({
  code: z.string().regex(/^\d{4}$/, 'رمز الحساب يجب أن يكون 4 أرقام'),
  name: z.string().min(1, 'اسم الحساب مطلوب').max(200),
  nameEn: z.string().optional(),
  type: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense'] as const, {
    message: 'نوع الحساب غير صالح',
  }),
  parentId: z.string().uuid().optional().nullable(),
  isActive: z.boolean().optional().default(true),
  currency: z.string().optional(),
}).strict();

/**
 * PUT /api/accounts/[id] — partial update.
 * Unknown legacy keys from the edit form (type, parentId, ...) are stripped,
 * never applied: the account type must never change after creation, and
 * parent reassignment goes through a dedicated flow to avoid cycles.
 */
export const accountUpdateSchema = z.object({
  code: z.string().regex(/^\d{4}$/, 'رمز الحساب يجب أن يكون 4 أرقام').optional(),
  name: z.string().min(1, 'اسم الحساب مطلوب').max(200).optional(),
  nameEn: z.string().max(200).nullable().optional(),
  is_active: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

// --------------- Journal Entry ---------------

export const journalEntryLineSchema = z.object({
  accountCode: z.string().min(1, 'رمز الحساب مطلوب'),
  debit: z.number().min(0, 'لا يمكن أن يكون المدين سالباً').default(0),
  credit: z.number().min(0, 'لا يمكن أن يكون الدائن سالباً').default(0),
  description: z.string().optional(),
}).refine(
  (line) => line.debit > 0 || line.credit > 0,
  { message: 'يجب إدخال مبلغ المدين أو الدائن' }
);

export const journalEntrySchema = z.object({
  date: z.string().refine(isValidDateString, { message: 'التاريخ غير صالح (YYYY-MM-DD)' }),
  type: z.enum(['general', 'opening_balance', 'accrual'] as const, {
    message: 'نوع القيد غير صالح',
  }),
  description: z.string().optional(),
  reference: z.string().optional(),
  lines: z.array(journalEntryLineSchema)
    .min(2, 'يجب إضافة قيدين على الأقل')
    .refine(
      (lines) => {
        const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
        const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
        return Math.abs(totalDebit - totalCredit) < 0.01;
      },
      { message: 'مجموع الديون يجب أن يساوي مجموع الدائنين' }
    ),
}).strict();

// --------------- Invoice ---------------

export const invoiceItemSchema = z.object({
  description: z.string().min(1, 'البيان مطلوب'),
  quantity: z.number().positive('الكمية يجب أن تكون أكبر من صفر'),
  unitPrice: z.number().min(0, 'السعر لا يمكن أن يكون سالباً'),
  total: z.number().optional(),
  item_type: z.enum(['service', 'product', 'inventory']).optional().default('service'),
  inventory_item_id: z.string().uuid().optional().nullable(),
  unit: z.string().optional().default('وحدة'),
  save_to_inventory: z.boolean().optional().default(false),
  item_code: z.string().optional(),
});

export const invoiceSchema = z.object({
  clientId: z.string().uuid('رقم العميل غير صالح'),
  projectId: z.string().uuid().optional().nullable(),
  date: z.string().refine(isValidDateString, { message: 'تاريخ الفاتورة غير صالح' }),
  dueDate: z.string().refine(isValidDateString, { message: 'تاريخ الاستحقاق غير صالح' }),
  items: z.array(invoiceItemSchema).min(1, 'يجب إضافة بند واحد على الأقل'),
  subtotal: z.number().min(0, 'المجموع الفرعي غير صالح'),
  vatRate: z.number().min(0).max(1).default(0.15),
  vatAmount: z.number().min(0).optional(),
  total: z.number().min(0, 'المجموع الكلي غير صالح'),
  vatEnabled: z.boolean().optional().default(true),
  notes: z.string().optional(),
}).strict();

// --------------- Voucher Receipt ---------------

export const voucherReceiptSchema = z.object({
  type: z.enum(['client', 'supplier_refund', 'general'] as const, {
    message: 'نوع سند القبض غير صالح',
  }),
  contactId: z.string().uuid('رقم الطرف غير صالح').optional().nullable(),
  date: z.string().refine(isValidDateString, { message: 'التاريخ غير صالح' }),
  amount: z.number().positive('المبلغ يجب أن يكون أكبر من صفر'),
  bankSafeId: z.string().uuid('رقم الخزينة/البنك غير صالح'),
  referenceNumber: z.string().optional(),
  notes: z.string().optional(),
  invoiceItems: z.array(z.object({
    invoiceId: z.string().uuid(),
    amount: z.number().positive(),
  })).optional(),
  revenueAccountCode: z.string().optional(),
  isAdvance: z.boolean().optional().default(false),
}).strict();

// --------------- Voucher Disbursement ---------------

export const voucherDisbursementSchema = z.object({
  type: z.enum(['supplier', 'client_refund', 'employee_advance', 'other'] as const, {
    message: 'نوع سند الصرف غير صالح',
  }),
  contactId: z.string().uuid('رقم الطرف غير صالح').optional().nullable(),
  employeeId: z.string().uuid().optional().nullable(),
  date: z.string().refine(isValidDateString, { message: 'التاريخ غير صالح' }),
  amount: z.number().positive('المبلغ يجب أن يكون أكبر من صفر'),
  bankSafeId: z.string().uuid('رقم الخزينة/البنك غير صالح'),
  reason: z.string().min(1, 'السبب مطلوب'),
  referenceNumber: z.string().optional(),
  notes: z.string().optional(),
  invoiceItems: z.array(z.object({
    invoiceId: z.string().uuid(),
    amount: z.number().positive(),
  })).optional(),
  expenseAccountCode: z.string().optional(),
}).strict();

// --------------- Project ---------------

export const projectSchema = z.object({
  name: z.string().min(1, 'اسم المشروع مطلوب').max(300),
  clientId: z.string().uuid().optional().nullable(),
  contractValue: z.number().positive('قيمة العقد يجب أن تكون أكبر من صفر'),
  startDate: z.string().refine(isValidDateString, { message: 'تاريخ البداية غير صالح' }),
  endDate: z.string().refine(isValidDateString, { message: 'تاريخ النهاية غير صالح' }).optional().nullable(),
  status: z.enum(['active', 'completed', 'cancelled', 'on_hold']).optional().default('active'),
  description: z.string().optional(),
  location: z.string().optional(),
}).strict();

// --------------- Pagination ---------------

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(500).default(50),
});

// --------------- Date Range ---------------

export const dateRangeSchema = z.object({
  from: z.string().refine(isValidDateString, { message: 'تاريخ البداية غير صالح' }),
  to: z.string().refine(isValidDateString, { message: 'تاريخ النهاية غير صالح' }),
}).refine(
  (data) => data.from <= data.to,
  { message: 'تاريخ البداية يجب أن يكون قبل تاريخ النهاية' }
);
