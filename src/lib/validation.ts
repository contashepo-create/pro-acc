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

export const resendVerificationSchema = z.object({
  email: z.string().email('البريد الإلكتروني غير صالح').max(254),
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
).refine(
  // Accounting rule: a journal line is either debit OR credit, never both.
  (line) => !(line.debit > 0 && line.credit > 0),
  { message: 'السطر الواحد لا يمكن أن يكون مديناً ودائناً معاً' }
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
    )
    .refine(
      (lines) => {
        // Accounting control (double-entry standards): the same account must
        // NOT be posted as BOTH debit and credit within one voucher — the two
        // sides net to zero for that account while inflating ledger turnover.
        // Post the net amount on a single side instead.
        const sides = new Map<string, { debit: number; credit: number }>();
        for (const l of lines) {
          const agg = sides.get(l.accountCode) ?? { debit: 0, credit: 0 };
          agg.debit += l.debit;
          agg.credit += l.credit;
          sides.set(l.accountCode, agg);
        }
        for (const { debit, credit } of sides.values()) {
          if (debit > 0 && credit > 0) return false;
        }
        return true;
      },
      { message: 'لا يجوز أن يكون نفس الحساب مديناً ودائناً في القيد الواحد. اجمع الصافي في سطر واحد وفق المعايير المحاسبية' }
    ),
}).strict();

// --------------- Invoice ---------------

export const invoiceItemSchema = z.object({
  description: z.string().min(1, 'البيان مطلوب'),
  quantity: z.number().positive('الكمية يجب أن تكون أكبر من صفر'),
  unitPrice: z.number().min(0, 'السعر لا يمكن أن يكون سالباً'),
  discount: z.number().min(0, 'الخصم لا يمكن أن يكون سالباً').optional().default(0),
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

// --------------- Purchases ---------------
// NOTE: purchase APIs use snake_case fields (supplier_id, unit_price, ...)
// matching the DB columns — unlike the sales invoice API which is camelCase.

export const purchaseInvoiceItemSchema = z.object({
  description: z.string().min(1, 'البيان مطلوب'),
  quantity: z.number().positive('الكمية يجب أن تكون أكبر من صفر'),
  unit_price: z.number().min(0, 'السعر لا يمكن أن يكون سالباً'),
  // UI hint only — the server always recomputes line totals.
  total: z.number().optional(),
});

export const purchaseInvoiceSchema = z.object({
  date: z.string().refine(isValidDateString, { message: 'تاريخ الفاتورة غير صالح' }),
  supplier_id: z.string().uuid('رقم المورد غير صالح'),
  purchase_order_id: z.string().uuid('رقم أمر الشراء غير صالح').optional().nullable(),
  items: z.array(purchaseInvoiceItemSchema).min(1, 'يجب إضافة بند واحد على الأقل'),
  // Fraction (0.15 = 15%). Unbounded previously — negative/huge rates were accepted.
  tax_rate: z.number().min(0, 'نسبة الضريبة لا يمكن أن تكون سالبة').max(1, 'نسبة الضريبة غير صالحة').optional().default(0),
  notes: z.string().optional(),
}).strict();

export const purchaseInvoiceUpdateSchema = z.object({
  status: z.enum(['unpaid', 'partial', 'paid', 'cancelled'] as const, {
    message: 'حالة الفاتورة غير صالحة',
  }).optional(),
  notes: z.string().optional(),
}).strict();

export const purchaseOrderSchema = z.object({
  date: z.string().refine(isValidDateString, { message: 'التاريخ غير صالح' }),
  supplier_id: z.string().uuid('رقم المورد غير صالح'),
  items: z.array(purchaseInvoiceItemSchema).min(1, 'يجب إضافة بند واحد على الأقل'),
  notes: z.string().optional(),
}).strict();

export const purchaseOrderUpdateSchema = z.object({
  date: z.string().refine(isValidDateString, { message: 'التاريخ غير صالح' }).optional(),
  supplier_id: z.string().uuid('رقم المورد غير صالح').optional(),
  items: z.array(purchaseInvoiceItemSchema).min(1, 'يجب إضافة بند واحد على الأقل').optional(),
  notes: z.string().optional(),
}).strict();

// Goods receipt against a PO: explicit per-item quantities must be POSITIVE —
// a negative value previously reduced received_quantity AND deducted stock.
export const purchaseReceiveSchema = z.object({
  quantities: z.record(z.string(), z.number().positive('كمية الاستلام يجب أن تكون أكبر من صفر')).optional(),
  date: z.string().refine(isValidDateString, { message: 'تاريخ الاستلام غير صالح' }).optional(),
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

// --------------- Voucher updates & creates ---------------

/**
 * PUT /api/vouchers/receipt/[id] & /api/vouchers/disbursement/[id]
 * تعديل سند: الحقول المسموح بتعديلها فقط. الكمية المالية (amount) تُمرَّر
 * للقيد الجديد بعد عكس القيد القديم — لا يمكن تعديل النوع/الطرف المخفي.
 */
export const voucherUpdateSchema = z.object({
  date: z.string().refine(isValidDateString, { message: 'التاريخ غير صالح' }).optional(),
  contact_id: z.string().uuid('رقم الطرف غير صالح').optional().nullable(),
  employee_id: z.string().uuid('رقم الموظف غير صالح').optional().nullable(),
  amount: z.number().positive('المبلغ يجب أن يكون أكبر من صفر').optional(),
  bank_safe_id: z.string().uuid('رقم الخزينة/البنك غير صالح').optional(),
  reason: z.string().min(1).max(500).optional(),
}).strict();

/**
 * POST /api/vouchers/receipt — سند قبض.
 * الحقول بتنسيق snake_case بعد التطبيع في المسار. amount رقم موجب.
 */
export const receiptVoucherCreateSchema = z.object({
  date: z.string().refine(isValidDateString, { message: 'التاريخ غير صالح' }),
  receipt_type: z.enum(['client', 'supplier_refund', 'general'] as const, {
    message: 'نوع سند القبض غير صالح',
  }),
  contact_id: z.string().uuid('رقم الطرف غير صالح').optional().nullable(),
  amount: z.number().positive('المبلغ يجب أن يكون أكبر من صفر'),
  bank_safe_id: z.string().uuid('رقم الخزينة/البنك غير صالح'),
  reason: z.string().min(1, 'السبب مطلوب').max(500),
  invoice_items: z.array(z.object({
    invoice_id: z.string().uuid(),
    amount: z.number().positive(),
  })).optional(),
}).strict();

/**
 * POST /api/vouchers/disbursement — سند صرف.
 */
export const disbursementVoucherCreateSchema = z.object({
  date: z.string().refine(isValidDateString, { message: 'التاريخ غير صالح' }),
  disbursement_type: z.enum(['supplier', 'employee_advance', 'subcontractor', 'client_refund', 'other'] as const, {
    message: 'نوع سند الصرف غير صالح',
  }),
  contact_id: z.string().uuid('رقم الطرف غير صالح').optional().nullable(),
  employee_id: z.string().uuid('رقم الموظف غير صالح').optional().nullable(),
  amount: z.number().positive('المبلغ يجب أن يكون أكبر من صفر'),
  bank_safe_id: z.string().uuid('رقم الخزينة/البنك غير صالح'),
  reason: z.string().min(1, 'السبب مطلوب').max(500),
  invoice_items: z.array(z.object({
    invoice_id: z.string().uuid(),
    amount: z.number().positive(),
  })).optional(),
}).strict();

// --------------- Inventory ---------------

// حركة مخزنية موحدة. ملاحظة: الواجهة ترسل 'adjustment' — تُطبَّع إلى 'adjust'
// في المسار. كمية التسوية = الرصيد المستهدف المطلق (تقبل صفراً).
export const inventoryMovementSchema = z.object({
  item_id: z.string().uuid('رقم الصنف غير صالح'),
  warehouse_id: z.string().uuid('رقم المستودع غير صالح'),
  type: z.enum(['add', 'issue', 'adjust', 'adjustment', 'transfer', 'return'] as const, {
    message: 'نوع العملية غير مدعوم',
  }),
  quantity: z.number().min(0, 'الكمية يجب أن لا تكون سالبة'),
  unit_price: z.number().min(0, 'السعر لا يمكن أن يكون سالباً').optional(),
  date: z.string().refine(isValidDateString, { message: 'التاريخ غير صالح' }).optional(),
  notes: z.string().max(500).optional(),
  to_warehouse_id: z.string().uuid('مستودع الوجهة غير صالح').optional().nullable(),
}).strict().refine(
  (m) => m.type === 'adjust' || m.type === 'adjustment' ? true : m.quantity > 0,
  { message: 'الكمية يجب أن تكون أكبر من صفر' }
).refine(
  (m) => m.type !== 'transfer' || (!!m.to_warehouse_id && m.to_warehouse_id !== m.warehouse_id),
  { message: 'مستودع الوجهة مطلوب ويجب أن يخالف المصدر' }
);

export const inventoryItemSchema = z.object({
  code: z.string().min(1, 'كود الصنف مطلوب').max(50),
  name: z.string().min(1, 'اسم الصنف مطلوب').max(300),
  unit: z.string().min(1, 'وحدة القياس مطلوبة').max(50),
  warehouse_id: z.string().uuid('رقم المستودع غير صالح'),
  category: z.string().max(100).optional().nullable(),
}).strict();

// تعديل صنف: لا كمية/سعر هنا أبداً — الرصيد يتحرك بالحركات المخزنية فقط
export const inventoryItemUpdateSchema = z.object({
  name: z.string().min(1).max(300).optional(),
  unit: z.string().min(1).max(50).optional(),
  category: z.string().max(100).nullable().optional(),
  is_active: z.boolean().optional(),
  warehouse_id: z.string().uuid().optional(),
}).strict();

export const warehouseSchema = z.object({
  name: z.string().min(1, 'اسم المستودع مطلوب').max(200),
  location: z.string().max(300).optional().nullable(),
}).strict();

// --------------- Contacts / Clients / Suppliers ---------------

export const contactTypeSchema = z.enum(['client', 'supplier', 'subcontractor', 'both'] as const, {
  message: 'نوع الطرف غير صالح',
});

export const contactCreateSchema = z.object({
  name: z.string().min(1, 'الاسم مطلوب').max(200),
  type: contactTypeSchema,
  phone: z.string().max(50).optional().nullable(),
  email: z.string().email('البريد الإلكتروني غير صالح').optional().nullable().or(z.literal('')),
  address: z.string().max(500).optional().nullable(),
  tax_number: z.string().max(100).optional().nullable(),
  commercial_registration: z.string().max(100).optional().nullable(),
  credit_limit: z.number().min(0, 'الحد الائتماني لا يمكن أن يكون سالباً').optional(),
  opening_balance: z.number().min(0).optional(),
  opening_balance_type: z.enum(['debit', 'credit'] as const).optional(),
}).strict();

export const contactUpdateSchema = z.object({
  name: z.string().min(1, 'الاسم مطلوب').max(200).optional(),
  type: contactTypeSchema.optional(),
  phone: z.string().max(50).nullable().optional(),
  email: z.string().email('البريد الإلكتروني غير صالح').nullable().optional().or(z.literal('')),
  address: z.string().max(500).nullable().optional(),
  tax_number: z.string().max(100).nullable().optional(),
  commercial_registration: z.string().max(100).nullable().optional(),
  credit_limit: z.number().min(0).nullable().optional(),
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

// --------------- Change Orders ---------------

export const changeOrderSchema = z.object({
  project_id: z.string().uuid('رقم المشروع غير صالح'),
  title: z.string().min(1, 'العنوان مطلوب').max(300),
  description: z.string().max(1000).optional(),
  change_amount: z.number('المبلغ يجب أن يكون رقمًا'),
  status: z.enum(['draft', 'submitted', 'approved', 'rejected', 'invoiced']).optional().default('draft'),
}).strict();

export const changeOrderUpdateSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(1000).nullable().optional(),
  change_amount: z.number().optional(),
  status: z.enum(['draft', 'submitted', 'approved', 'rejected', 'invoiced']).optional(),
}).strict();

// --------------- Equipment Costs ---------------

export const equipmentCostSchema = z.object({
  equipment_id: z.string().uuid().nullable().optional(),
  project_id: z.string().uuid('رقم المشروع غير صالح').nullable().optional(),
  date: z.string().refine(isValidDateString, { message: 'التاريخ غير صالح' }).optional(),
  cost_type: z.enum(['rental', 'fuel', 'maintenance', 'labour', 'depreciation', 'other']).default('other'),
  amount: z.number().min(0, 'المبلغ لا يمكن أن يكون سالبًا'),
  usage_hours: z.number().min(0).optional().default(0),
  notes: z.string().max(500).nullable().optional(),
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
