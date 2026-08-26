/**
 * تقارير التصدير الاحترافية — بدل النسخ الخام من قاعدة البيانات.
 *
 * السياسة: العميل يحمّل تقارير محاسبية منسّقة (أسماء أعمدة عربية واضحة،
 * أسماء عملاء/مشاريع/حسابات بدل المعرّفات، حالات مترجمة، لا أعمدة تقنية
 * ولا بيانات حساسة مثل الإعدادات أو الإشعارات الداخلية) — بنفس معايير
 * التقارير في البرامج المحاسبية المتعارف عليها.
 *
 * This module is isomorphic (no node APIs): both the export route and the
 * /export-data page import the same single source of truth.
 */

export type Row = Record<string, unknown>;

/** A human-readable display name resolver per lookup table. */
export interface LookupDef {
  /** Comma-separated extra fields to fetch alongside id. */
  fields: string;
  label: (row: Row, maps: LookupMaps) => string;
  /** Other lookup tables this label depends on (fetched too). */
  deps?: string[];
}

export interface ReportColumn {
  label: string;
  type?: 'text' | 'date' | 'money' | 'number';
  /** Direct source field. */
  field?: string;
  /** FK column resolved through a lookup table (e.g. contact_id → اسم العميل). */
  lookupTable?: string;
  lookupLocal?: string;
  /** Status/enum Arabic labels (fallback: raw value). */
  statusMap?: Record<string, string>;
  /** Computed display value (e.g. المتبقي = الإجمالي − المدفوع). */
  derive?: (row: Row, maps: LookupMaps) => string | number;
  /** Fallback when the source value is null/undefined. */
  fallback?: string;
}

export interface ReportSpec {
  /** Report id used by the API contract (stable). */
  id: string;
  title: string;
  table: string;
  orderBy?: string;
  columns: ReportColumn[];
}

export type LookupMaps = Record<string, Map<string, Row>>;

// ---------------------------------------------------------------------------
// Lookup tables (id → business label)
// ---------------------------------------------------------------------------
export const LOOKUP_DEFS: Record<string, LookupDef> = {
  contacts: { fields: 'name', label: (r) => String(r.name ?? '') },
  projects: { fields: 'name', label: (r) => String(r.name ?? '') },
  accounts: { fields: 'code, name', label: (r) => (r.code ? `${r.code} - ${r.name ?? ''}` : String(r.name ?? '')) },
  employees: { fields: 'name', label: (r) => String(r.name ?? '') },
  warehouses: { fields: 'name', label: (r) => String(r.name ?? '') },
  invoices: { fields: 'number', label: (r) => (r.number != null ? `#${r.number}` : '') },
  quotations: { fields: 'number', label: (r) => (r.number != null ? `#${r.number}` : '') },
  journal_entries: { fields: 'number, date, description', label: (r) => (r.number != null ? `#${r.number}` : '') },
  custodies: {
    fields: 'employee_id, date',
    deps: ['employees'],
    label: (r, maps) => {
      const emp = r.employee_id ? maps.employees?.get(String(r.employee_id)) : null;
      const who = emp ? String(emp.name ?? '') : '';
      return who + (r.date ? ` (${String(r.date).slice(0, 10)})` : '');
    },
  },
  inventory_items: { fields: 'code, name', label: (r) => (r.code ? `${r.code} - ${r.name ?? ''}` : String(r.name ?? '')) },
  banks_safes: { fields: 'name', label: (r) => String(r.name ?? '') },
};

// ---------------------------------------------------------------------------
// Arabic status / enum labels
// ---------------------------------------------------------------------------
const INVOICE_STATUS: Record<string, string> = {
  unpaid: 'غير مدفوعة', partial: 'مدفوعة جزئياً', paid: 'مدفوعة', cancelled: 'ملغاة',
};
const QUOTATION_STATUS: Record<string, string> = {
  draft: 'مسودة', sent: 'مُرسل', accepted: 'مقبول', rejected: 'مرفوض',
  converted: 'محوّل لفاتورة', expired: 'منتهي', cancelled: 'ملغي',
};
const PROJECT_STATUS: Record<string, string> = {
  planning: 'قيد التخطيط', active: 'جاري', on_hold: 'متوقف',
  completed: 'مكتمل', cancelled: 'ملغي',
};
const EXPENSE_STATUS: Record<string, string> = { pending: 'معلق', approved: 'معتمد', rejected: 'مرفوض' };
const ASSET_STATUS: Record<string, string> = {
  active: 'في الخدمة', fully_depreciated: 'مهلك بالكامل', disposed: 'مستبعد', sold: 'مباع',
};
const INVENTORY_TYPE: Record<string, string> = {
  in: 'إضافة', out: 'صرف', transfer: 'تحويل', transfer_in: 'تحويل وارد', transfer_out: 'تحويل صادر', adjust: 'تسوية',
};
const RECEIPT_TYPE: Record<string, string> = {
  client: 'تحصيل من عميل', supplier_refund: 'استرداد من مورد', general: 'عام',
};
const DISBURSEMENT_TYPE: Record<string, string> = {
  supplier: 'سداد مورد', employee_advance: 'سلفة موظف', subcontractor: 'سداد مقاول باطن',
  client_refund: 'استرداد لعميل', other: 'أخرى',
};
const CUSTODY_TX_TYPE: Record<string, string> = {
  add: 'إضافة لعهدة', expense: 'صرف من عهدة', settle: 'تسوية', refund: 'رد عهدة',
};
const CONTACT_TYPE: Record<string, string> = { client: 'عميل', supplier: 'مورد', both: 'عميل ومورد' };
const ACCOUNT_TYPE: Record<string, string> = {
  asset: 'أصول', liability: 'التزامات', equity: 'حقوق ملكية', revenue: 'إيرادات', expense: 'مصروفات',
};
const BOND_STATUS: Record<string, string> = {
  active: 'سارية', released: 'مفرجة', expired: 'منتهية', cancelled: 'ملغاة',
};
const YES_NO = (v: unknown) => (v === true || v === 'true' ? 'نعم' : v === false || v === 'false' ? 'لا' : '');
const BUDGET_STATUS: Record<string, string> = { draft: 'مسودة', approved: 'معتمدة', active: 'نشطة', closed: 'مقفلة' };
const TAX_STATUS: Record<string, string> = { draft: 'مسودة', filed: 'مُقدَّم', approved: 'معتمد' };
const BANK_TYPE: Record<string, string> = { bank: 'بنك', safe: 'خزينة' };
const CASH_TYPE: Record<string, string> = {
  receipt: 'قبض', disbursement: 'صرف', transfer_in: 'تحويل وارد', transfer_out: 'تحويل صادر', deposit: 'إيداع', withdrawal: 'سحب',
};

// ---------------------------------------------------------------------------
// The professional reports (id = legacy API table name for compatibility)
// ---------------------------------------------------------------------------
export const REPORTS: ReportSpec[] = [
  {
    id: 'accounts', title: 'دليل الحسابات', table: 'accounts', orderBy: 'code',
    columns: [
      { label: 'كود الحساب', field: 'code' },
      { label: 'اسم الحساب', field: 'name' },
      { label: 'التصنيف', field: 'type', statusMap: ACCOUNT_TYPE },
      { label: 'الحساب الأب', lookupTable: 'accounts', lookupLocal: 'parent_id' },
      { label: 'الحالة', derive: (r) => YES_NO(r.is_active) || 'نشط' },
    ],
  },
  {
    id: 'journal_entries', title: 'دفتر اليومية (القيود تفصيلياً)', table: 'journal_lines',
    columns: [
      { label: 'رقم القيد', lookupTable: 'journal_entries', lookupLocal: 'journal_entry_id' },
      { label: 'التاريخ', type: 'date', lookupTable: 'journal_entries', lookupLocal: 'journal_entry_id', derive: (r, m) => {
        const e = r.journal_entry_id ? m.journal_entries?.get(String(r.journal_entry_id)) : null;
        return e ? String(e.date ?? '').slice(0, 10) : '';
      } },
      { label: 'بيان القيد', lookupTable: 'journal_entries', lookupLocal: 'journal_entry_id', derive: (r, m) => {
        const e = r.journal_entry_id ? m.journal_entries?.get(String(r.journal_entry_id)) : null;
        return e ? String(e.description ?? '') : '';
      } },
      { label: 'كود الحساب', field: 'account_code' },
      { label: 'اسم الحساب', field: 'account_name' },
      { label: 'الوصف', field: 'description' },
      { label: 'مدين', type: 'money', field: 'debit' },
      { label: 'دائن', type: 'money', field: 'credit' },
      { label: 'المشروع', lookupTable: 'projects', lookupLocal: 'project_id' },
    ],
  },
  {
    id: 'invoices', title: 'فواتير المبيعات', table: 'invoices',
    columns: [
      { label: 'رقم الفاتورة', field: 'number' },
      { label: 'التاريخ', type: 'date', field: 'date' },
      { label: 'تاريخ الاستحقاق', type: 'date', field: 'due_date' },
      { label: 'العميل', lookupTable: 'contacts', lookupLocal: 'contact_id' },
      { label: 'المشروع', lookupTable: 'projects', lookupLocal: 'project_id' },
      { label: 'قبل الضريبة', type: 'money', field: 'subtotal' },
      { label: 'الضريبة', type: 'money', field: 'tax_amount' },
      { label: 'الإجمالي', type: 'money', field: 'total' },
      { label: 'المدفوع', type: 'money', field: 'paid_amount' },
      { label: 'المتبقي', type: 'money', derive: (r) => Math.max(0, Number(r.total ?? 0) - Number(r.paid_amount ?? 0)) },
      { label: 'الحالة', field: 'status', statusMap: INVOICE_STATUS },
    ],
  },
  {
    id: 'invoice_items', title: 'بنود فواتير المبيعات', table: 'invoice_items',
    columns: [
      { label: 'رقم الفاتورة', lookupTable: 'invoices', lookupLocal: 'invoice_id' },
      { label: 'البيان', field: 'description' },
      { label: 'الكمية', type: 'number', field: 'quantity' },
      { label: 'سعر الوحدة', type: 'money', field: 'unit_price' },
      { label: 'الإجمالي', type: 'money', field: 'total' },
    ],
  },
  {
    id: 'quotations', title: 'عروض الأسعار', table: 'quotations',
    columns: [
      { label: 'رقم العرض', field: 'number' },
      { label: 'التاريخ', type: 'date', field: 'date' },
      { label: 'العميل', lookupTable: 'contacts', lookupLocal: 'contact_id' },
      { label: 'المشروع', lookupTable: 'projects', lookupLocal: 'project_id' },
      { label: 'قبل الضريبة', type: 'money', field: 'subtotal' },
      { label: 'الضريبة', type: 'money', field: 'tax_amount' },
      { label: 'الإجمالي', type: 'money', field: 'total' },
      { label: 'الحالة', field: 'status', statusMap: QUOTATION_STATUS },
    ],
  },
  {
    id: 'quotation_items', title: 'بنود عروض الأسعار', table: 'quotation_items',
    columns: [
      { label: 'رقم العرض', lookupTable: 'quotations', lookupLocal: 'quotation_id' },
      { label: 'البيان', field: 'description' },
      { label: 'الكمية', type: 'number', field: 'quantity' },
      { label: 'سعر الوحدة', type: 'money', field: 'unit_price' },
      { label: 'الإجمالي', type: 'money', field: 'total' },
    ],
  },
  {
    id: 'purchase_invoices', title: 'فواتير المشتريات', table: 'purchase_invoices',
    columns: [
      { label: 'رقم الفاتورة', field: 'number' },
      { label: 'التاريخ', type: 'date', field: 'date' },
      { label: 'المورد', lookupTable: 'contacts', lookupLocal: 'supplier_id' },
      { label: 'قبل الضريبة', type: 'money', field: 'subtotal' },
      { label: 'الضريبة', type: 'money', field: 'tax_amount' },
      { label: 'الإجمالي', type: 'money', field: 'total' },
      { label: 'المدفوع', type: 'money', field: 'paid_amount' },
      { label: 'المتبقي', type: 'money', derive: (r) => Math.max(0, Number(r.total ?? 0) - Number(r.paid_amount ?? 0)) },
      { label: 'الحالة', field: 'status', statusMap: INVOICE_STATUS },
    ],
  },
  {
    id: 'contacts', title: 'العملاء والموردون', table: 'contacts', orderBy: 'name',
    columns: [
      { label: 'الاسم', field: 'name' },
      { label: 'النوع', field: 'type', statusMap: CONTACT_TYPE },
      { label: 'الهاتف', field: 'phone' },
      { label: 'البريد الإلكتروني', field: 'email' },
      { label: 'العنوان', field: 'address' },
      { label: 'الرقم الضريبي', field: 'tax_number' },
      { label: 'السجل التجاري', field: 'commercial_registration' },
      { label: 'حد الائتمان', type: 'money', field: 'credit_limit' },
      { label: 'الحالة', derive: (r) => (r.is_active === false ? 'غير نشط' : 'نشط') },
    ],
  },
  {
    id: 'projects', title: 'المشاريع', table: 'projects',
    columns: [
      { label: 'اسم المشروع', field: 'name' },
      { label: 'العميل', lookupTable: 'contacts', lookupLocal: 'client_id' },
      { label: 'قيمة العقد', type: 'money', field: 'contract_value' },
      { label: 'تاريخ البداية', type: 'date', field: 'start_date' },
      { label: 'تاريخ النهاية', type: 'date', field: 'end_date' },
      { label: 'الحالة', field: 'status', statusMap: PROJECT_STATUS },
    ],
  },
  {
    id: 'project_expenses', title: 'مصروفات المشاريع', table: 'project_expenses',
    columns: [
      { label: 'التاريخ', type: 'date', field: 'date' },
      { label: 'المشروع', lookupTable: 'projects', lookupLocal: 'project_id' },
      { label: 'البيان', field: 'description' },
      { label: 'المبلغ', type: 'money', field: 'amount' },
      { label: 'الضريبة', type: 'money', field: 'tax_amount' },
      { label: 'المورد/المستفيد', lookupTable: 'contacts', lookupLocal: 'contact_id' },
      { label: 'الحالة', field: 'status', statusMap: EXPENSE_STATUS },
    ],
  },
  {
    id: 'employees', title: 'الموظفون', table: 'employees', orderBy: 'name',
    columns: [
      { label: 'الاسم', field: 'name' },
      { label: 'المسمى الوظيفي', field: 'position' },
      { label: 'القسم', field: 'department' },
      { label: 'الراتب الأساسي', type: 'money', field: 'salary' },
      { label: 'تاريخ التعيين', type: 'date', field: 'hire_date' },
      { label: 'الهاتف', field: 'phone' },
      { label: 'الحالة', derive: (r) => (r.is_active === false ? 'غير نشط' : 'نشط') },
    ],
  },
  {
    id: 'employee_advances', title: 'سلف الموظفين', table: 'employee_advances',
    columns: [
      { label: 'الموظف', lookupTable: 'employees', lookupLocal: 'employee_id' },
      { label: 'التاريخ', type: 'date', field: 'date' },
      { label: 'مبلغ السلفة', type: 'money', field: 'amount' },
      { label: 'المسدد', type: 'money', derive: (r) => Math.max(0, Number(r.amount ?? 0) - Number(r.remaining_amount ?? 0)) },
      { label: 'المتبقي', type: 'money', field: 'remaining_amount' },
      { label: 'السبب', field: 'reason' },
    ],
  },
  {
    id: 'custodies', title: 'عهد النقدية', table: 'custodies',
    columns: [
      { label: 'الموظف', lookupTable: 'employees', lookupLocal: 'employee_id' },
      { label: 'التاريخ', type: 'date', field: 'date' },
      { label: 'مبلغ العهدة', type: 'money', field: 'amount' },
      { label: 'المصروف', type: 'money', derive: (r) => Math.max(0, Number(r.amount ?? 0) - Number(r.remaining_amount ?? 0)) },
      { label: 'المتبقي', type: 'money', field: 'remaining_amount' },
      { label: 'الغرض', field: 'reason' },
    ],
  },
  {
    id: 'custody_transactions', title: 'حركات العهد', table: 'custody_transactions',
    columns: [
      { label: 'العهدة', lookupTable: 'custodies', lookupLocal: 'custody_id' },
      { label: 'التاريخ', type: 'date', field: 'created_at' },
      { label: 'النوع', field: 'type', statusMap: CUSTODY_TX_TYPE },
      { label: 'المبلغ', type: 'money', field: 'amount' },
      { label: 'البيان', field: 'description' },
    ],
  },
  {
    id: 'fixed_assets', title: 'الأصول الثابتة', table: 'fixed_assets',
    columns: [
      { label: 'الكود', field: 'code' },
      { label: 'اسم الأصل', field: 'name' },
      { label: 'التصنيف', field: 'category' },
      { label: 'تاريخ الشراء', type: 'date', field: 'purchase_date' },
      { label: 'تكلفة الشراء', type: 'money', field: 'purchase_cost' },
      { label: 'العمر الإنتاجي (سنة)', type: 'number', field: 'useful_life_years' },
      { label: 'مجمع الإهلاك', type: 'money', field: 'accumulated_depreciation' },
      { label: 'القيمة الدفترية', type: 'money', field: 'net_book_value' },
      { label: 'الموقع', field: 'location' },
      { label: 'الحالة', field: 'status', statusMap: ASSET_STATUS },
    ],
  },
  {
    id: 'inventory_items', title: 'المخزون', table: 'inventory_items', orderBy: 'code',
    columns: [
      { label: 'كود الصنف', field: 'code' },
      { label: 'اسم الصنف', field: 'name' },
      { label: 'الوحدة', field: 'unit' },
      { label: 'الكمية', type: 'number', field: 'quantity' },
      { label: 'تكلفة الوحدة', type: 'money', field: 'unit_price' },
      { label: 'قيمة المخزون', type: 'money', derive: (r) => Number(r.quantity ?? 0) * Number(r.unit_price ?? 0) },
      { label: 'التصنيف', field: 'category' },
      { label: 'المستودع', lookupTable: 'warehouses', lookupLocal: 'warehouse_id' },
      { label: 'الحالة', derive: (r) => (r.is_active === false ? 'غير نشط' : 'نشط') },
    ],
  },
  {
    id: 'inventory_transactions', title: 'حركات المخزون', table: 'inventory_transactions',
    columns: [
      { label: 'التاريخ', type: 'date', field: 'date' },
      { label: 'الصنف', lookupTable: 'inventory_items', lookupLocal: 'item_id' },
      { label: 'النوع', field: 'type', statusMap: INVENTORY_TYPE },
      { label: 'الكمية', type: 'number', field: 'quantity' },
      { label: 'تكلفة الوحدة', type: 'money', field: 'unit_price' },
      { label: 'القيمة', type: 'money', field: 'total_value' },
      { label: 'المستودع', lookupTable: 'warehouses', lookupLocal: 'warehouse_id' },
      { label: 'ملاحظات', field: 'notes' },
    ],
  },
  {
    id: 'warehouses', title: 'المستودعات', table: 'warehouses',
    columns: [
      { label: 'اسم المستودع', field: 'name' },
      { label: 'الموقع', field: 'location' },
      { label: 'الحالة', derive: (r) => (r.is_active === false ? 'غير نشط' : 'نشط') },
    ],
  },
  {
    id: 'branches', title: 'الفروع', table: 'branches',
    columns: [
      { label: 'الكود', field: 'code' },
      { label: 'اسم الفرع', field: 'name' },
      { label: 'الهاتف', field: 'phone' },
      { label: 'العنوان', field: 'address' },
      { label: 'رئيسي', derive: (r) => YES_NO(r.is_main) },
      { label: 'الحالة', derive: (r) => (r.is_active === false ? 'غير نشط' : 'نشط') },
    ],
  },
  {
    id: 'banks_safes', title: 'البنوك والخزائن', table: 'banks_safes',
    columns: [
      { label: 'الاسم', field: 'name' },
      { label: 'النوع', field: 'type', statusMap: BANK_TYPE },
      { label: 'رقم الحساب البنكي', field: 'account_number' },
      { label: 'الحساب المحاسبي', lookupTable: 'accounts', lookupLocal: 'account_id' },
      { label: 'الحالة', derive: (r) => (r.is_active === false ? 'غير نشط' : 'نشط') },
    ],
  },
  {
    id: 'cash_transactions', title: 'حركة النقدية', table: 'cash_transactions',
    columns: [
      { label: 'التاريخ', type: 'date', field: 'date' },
      { label: 'النوع', field: 'type', statusMap: CASH_TYPE },
      { label: 'المبلغ', type: 'money', field: 'amount' },
      { label: 'البيان', field: 'reason' },
      { label: 'البنك/الخزينة', lookupTable: 'banks_safes', lookupLocal: 'bank_safe_id' },
      { label: 'الطرف', lookupTable: 'contacts', lookupLocal: 'contact_id' },
      { label: 'المشروع', lookupTable: 'projects', lookupLocal: 'project_id' },
    ],
  },
  {
    id: 'voucher_receipts', title: 'سندات القبض', table: 'voucher_receipts',
    columns: [
      { label: 'رقم السند', field: 'number' },
      { label: 'التاريخ', type: 'date', field: 'date' },
      { label: 'النوع', field: 'receipt_type', statusMap: RECEIPT_TYPE },
      { label: 'الطرف', lookupTable: 'contacts', lookupLocal: 'contact_id' },
      { label: 'المبلغ', type: 'money', field: 'amount' },
      { label: 'البنك/الخزينة', lookupTable: 'banks_safes', lookupLocal: 'bank_safe_id' },
      { label: 'البيان', field: 'reason' },
    ],
  },
  {
    id: 'voucher_disbursements', title: 'سندات الصرف', table: 'voucher_disbursements',
    columns: [
      { label: 'رقم السند', field: 'number' },
      { label: 'التاريخ', type: 'date', field: 'date' },
      { label: 'النوع', field: 'disbursement_type', statusMap: DISBURSEMENT_TYPE },
      { label: 'الطرف', lookupTable: 'contacts', lookupLocal: 'contact_id' },
      { label: 'الموظف', lookupTable: 'employees', lookupLocal: 'employee_id' },
      { label: 'المبلغ', type: 'money', field: 'amount' },
      { label: 'البنك/الخزينة', lookupTable: 'banks_safes', lookupLocal: 'bank_safe_id' },
      { label: 'البيان', field: 'reason' },
    ],
  },
  {
    id: 'bonds', title: 'الضمانات البنكية', table: 'bonds',
    columns: [
      { label: 'عنوان الضمان', field: 'title' },
      { label: 'النوع', field: 'type' },
      { label: 'المبلغ', type: 'money', field: 'amount' },
      { label: 'العملة', field: 'currency' },
      { label: 'تاريخ الإصدار', type: 'date', field: 'issue_date' },
      { label: 'تاريخ الانتهاء', type: 'date', field: 'expiry_date' },
      { label: 'البنك المصدر', field: 'issuing_bank' },
      { label: 'المستفيد', field: 'beneficiary_name' },
      { label: 'المشروع', lookupTable: 'projects', lookupLocal: 'project_id' },
      { label: 'الرقم المرجعي', field: 'reference_number' },
      { label: 'الحالة', field: 'status', statusMap: BOND_STATUS },
    ],
  },
  {
    id: 'budgets', title: 'الموازنات التقديرية', table: 'budgets',
    columns: [
      { label: 'اسم الموازنة', field: 'name' },
      { label: 'من تاريخ', type: 'date', field: 'start_date' },
      { label: 'إلى تاريخ', type: 'date', field: 'end_date' },
      { label: 'الحالة', field: 'status', statusMap: BUDGET_STATUS },
    ],
  },
  {
    id: 'cost_centers', title: 'مراكز التكلفة', table: 'cost_centers', orderBy: 'code',
    columns: [
      { label: 'الكود', field: 'code' },
      { label: 'اسم المركز', field: 'name' },
      { label: 'الوصف', field: 'description' },
      { label: 'الحالة', derive: (r) => (r.is_active === false ? 'غير نشط' : 'نشط') },
    ],
  },
  {
    id: 'tax_returns', title: 'الإقرارات الضريبية', table: 'tax_returns',
    columns: [
      { label: 'من تاريخ', type: 'date', field: 'period_from' },
      { label: 'إلى تاريخ', type: 'date', field: 'period_to' },
      { label: 'إجمالي المبيعات', type: 'money', field: 'total_sales' },
      { label: 'إجمالي المشتريات', type: 'money', field: 'total_purchases' },
      { label: 'ضريبة المخرجات', type: 'money', field: 'output_vat' },
      { label: 'ضريبة المدخلات', type: 'money', field: 'input_vat' },
      { label: 'صافي الضريبة', type: 'money', field: 'net_vat' },
      { label: 'تاريخ التقديم', type: 'date', field: 'filed_at' },
      { label: 'الحالة', field: 'status', statusMap: TAX_STATUS },
    ],
  },
];

/** API-contract report ids (the only accepted `tables` values). */
export const EXPORT_TABLES = REPORTS.map((r) => r.id);

/** Old raw-table names from the first export generation → report ids. */
export const LEGACY_TABLE_ALIAS: Record<string, string> = {
  clients: 'contacts',
  inventory: 'inventory_items',
  banks: 'banks_safes',
  vouchers: 'voucher_receipts',
  journal_lines: 'journal_entries',
};

export function resolveReportIds(requested: string[]): string[] {
  const ids: string[] = [];
  for (const raw of requested) {
    const id = LEGACY_TABLE_ALIAS[raw] ?? raw;
    if (EXPORT_TABLES.includes(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function getReport(id: string): ReportSpec | undefined {
  return REPORTS.find((r) => r.id === id);
}

/** Lookup tables required by a set of reports (excluding self-referencing ones the source already provides). */
export function requiredLookupTables(specs: ReportSpec[], companyId: string): { table: string; companyId: string }[] {
  const needed = new Set<string>();
  const addWithDeps = (table: string) => {
    if (needed.has(table)) return;
    needed.add(table);
    // اجلب جداول يعتمد عليها عرض هذا الجدول (مثل custodies → employees)
    for (const dep of LOOKUP_DEFS[table]?.deps ?? []) addWithDeps(dep);
  };
  for (const spec of specs) {
    for (const col of spec.columns) {
      if (col.lookupTable) {
        // A table can be both source and lookup (accounts parent) — fetching it is still fine.
        addWithDeps(col.lookupTable);
      }
    }
  }
  return [...needed].map((table) => ({ table, companyId }));
}

// ---------------------------------------------------------------------------
// Row shaping → professional display rows
// ---------------------------------------------------------------------------
const money = (v: unknown): string => {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return '0.00';
  return n.toFixed(2);
};

export function shapeReportRow(spec: ReportSpec, row: Row, maps: LookupMaps): string[] {
  return spec.columns.map((col) => {
    let value: unknown;
    if (col.lookupTable && col.lookupLocal) {
      const id = row[col.lookupLocal];
      const rec = id ? maps[col.lookupTable]?.get(String(id)) : null;
      value = rec ? LOOKUP_DEFS[col.lookupTable].label(rec, maps) : (col.fallback ?? '');
      if (col.derive) value = col.derive(row, maps);
    } else if (col.derive) {
      value = col.derive(row, maps);
    } else {
      value = row[col.field ?? ''];
      if (value === null || value === undefined || value === '') return col.fallback ?? '';
      if (col.statusMap) return col.statusMap[String(value)] ?? String(value);
      if (col.type === 'date') return String(value).slice(0, 10);
      if (col.type === 'money') return money(value);
    }
    if (value === null || value === undefined || value === '') return col.fallback ?? '';
    if (typeof value === 'number') return col.type === 'money' ? money(value) : String(value);
    return String(value);
  });
}

export function shapeReportHeaders(spec: ReportSpec): string[] {
  return spec.columns.map((c) => c.label);
}

/**
 * Build the lookup maps for the given reports from pre-fetched table rows.
 * `fetched` maps lookup-table name → rows (already company-scoped).
 */
export function buildLookupMaps(fetched: Record<string, Row[]>): LookupMaps {
  const maps: LookupMaps = {};
  for (const [table, rows] of Object.entries(fetched)) {
    maps[table] = new Map((rows || []).map((r) => [String(r.id), r]));
  }
  return maps;
}
