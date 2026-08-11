'use client';

import type { ReactNode } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Badge } from './Badge';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Eye } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';

const HIDDEN = new Set([
  'id', 'company_id', 'created_by', 'updated_at', 'deleted_at',
  'contacts', 'accounts', 'projects', 'employees', 'invoices',
  'journal_entry_id', 'password', 'password_hash', 'token', 'items', 'lines', 'boq_items',
  'journal_entry_id', 'password', 'password_hash', 'token',
]);

const LABELS: Record<string, string> = {
  number: 'الرقم',
  po_number: 'رقم أمر الشراء',
  invoice_number: 'رقم فاتورة الشراء',
  claim_number: 'رقم الفاتورة المرحلية',
  certificate_number: 'رقم شهادة المقاول',
  contract_number: 'رقم العقد',
  date: 'التاريخ',
  due_date: 'تاريخ الاستحقاق',
  valid_until: 'صالح حتى',
  name: 'الاسم',
  code: 'الرمز / الكود',
  category: 'التصنيف / الفئة',
  description: 'البيان والتفاصيل',
  notes: 'ملاحظات',
  reason: 'السبب / البيان',
  date: 'التاريخ',
  due_date: 'تاريخ الاستحقاق',
  name: 'الاسم',
  description: 'البيان',
  notes: 'ملاحظات',
  status: 'الحالة',
  type: 'النوع',
  total: 'الإجمالي',
  subtotal: 'المجموع الفرعي',
  vat_amount: 'ضريبة القيمة المضافة',
  tax_amount: 'مبلغ الضريبة',
  vat_rate: 'نسبة الضريبة',
  tax_rate: 'نسبة الضريبة',
  paid_amount: 'المبلغ المدفوع',
  amount: 'المبلغ',
  debit: 'مدين',
  credit: 'دائن',
  balance: 'الرصيد',
  remaining_amount: 'المبلغ المتبقي',
  client_name: 'العميل',
  contact_name: 'جهة الاتصال / الطرف',
  supplier_name: 'المورد',
  project_name: 'المشروع',
  employee_name: 'الموظف',
  bank_name: 'الخزينة / البنك',
  bank_safe_name: 'الخزينة / البنك',
  account_code: 'رمز الحساب',
  account_name: 'اسم الحساب',
  phone: 'رقم الهاتف / الجوال',
  email: 'البريد الإلكتروني',
  vat_amount: 'الضريبة',
  tax_amount: 'الضريبة',
  vat_rate: 'نسبة الضريبة',
  tax_rate: 'نسبة الضريبة',
  paid_amount: 'المدفوع',
  amount: 'المبلغ',
  debit: 'مدين',
  credit: 'دائن',
  client_name: 'العميل',
  contact_name: 'العميل',
  supplier_name: 'المورد',
  project_name: 'المشروع',
  account_code: 'رمز الحساب',
  account_name: 'الحساب',
  phone: 'الهاتف',
  email: 'البريد',
  address: 'العنوان',
  location: 'الموقع',
  start_date: 'تاريخ البدء',
  end_date: 'تاريخ الانتهاء',
  contract_value: 'قيمة العقد / الميزانية',
  salary: 'الراتب',
  basic_salary: 'الراتب الأساسي',
  advance_deduction: 'خصم السلف',
  net_pay: 'صافي الراتب',
  department: 'القسم',
  position: 'الوظيفة',
  hire_date: 'تاريخ التعيين',
  purchase_cost: 'تكلفة الشراء',
  purchase_date: 'تاريخ الشراء',
  useful_life_years: 'العمر الإنتاجي (سنوات)',
  depreciation_rate: 'معدل الإهلاك %',
  depreciation_method: 'طريقة الإهلاك',
  net_book_value: 'القيمة الدفترية',
  accumulated_depreciation: 'مجمع الإهلاك',
  disbursement_type: 'نوع الصرف',
  receipt_type: 'نوع القبض',
  tax_number: 'الرقم الضريبي',
  commercial_registration: 'السجل التجاري',
  national_id: 'رقم الهوية',
  gender: 'الجنس',
  date_of_birth: 'تاريخ الميلاد',
  birth_date: 'تاريخ الميلاد',
  city: 'المدينة',
  region: 'المنطقة',
  country: 'الدولة',
  postal_code: 'الرمز البريدي',
  website: 'الموقع الإلكتروني',
  iban: 'رقم الآيبان (IBAN)',
  swift_code: 'رمز السويفت (SWIFT)',
  credit_limit: 'الحد الائتماني',
  opening_balance: 'الرصيد الافتتاحي',
  payment_terms: 'شروط الدفع',
  role: 'الدور / الصلاحية',
  is_active: 'الحالة التشغيلية',
  gross_amount: 'المبلغ الإجمالي قبل الاستقطاع',
  retention_percentage: 'نسبة الاحتجاز %',
  retention_amount: 'مبلغ الاحتجاز',
  net_amount: 'صافي المستحق',
  is_final: 'دفعة نهائية',
  total_value: 'إجمالي القيمة',
  quantity: 'الكمية',
  unit_price: 'سعر الوحدة',
  unit: 'الوحدة',
  warehouse_name: 'المستودع',
  item_name: 'اسم الصنف',
  item_code: 'رمز الصنف',
  created_at: 'تاريخ وساعة الإنشاء',
};

const TRANSLATIONS: Record<string, string> = {
  // Roles
  admin: 'مدير النظام (صلاحية كاملة)',
  manager: 'مدير',
  accountant: 'محاسب',
  supervisor: 'مشرف',
  // Statuses
  paid: 'مدفوعة بالكامل ✅',
  unpaid: 'غير مدفوعة ⏳',
  partial: 'مدفوعة جزئياً 🔄',
  cancelled: 'ملغاة ❌',
  active: 'نشط',
  completed: 'مكتمل',
  pending: 'قيد الانتظار',
  approved: 'معتمد',
  rejected: 'مرفوض',
  open: 'مفتوح',
  closed: 'مقفل',
  draft: 'مسودة',
  converted: 'محول إلى مشروع',
  received: 'مستلم بالكامل',
  settled: 'تمت التسوية',
  shortage: 'يوجد عجز',
  // Types
  client: 'عميل',
  supplier: 'مورد',
  both: 'عميل ومورد',
  daily_worker: 'عامل يومية',
  male: 'ذكر',
  female: 'أنثى',
  asset: 'أصل',
  liability: 'خصم / التزام',
  equity: 'حقوق ملكية',
  revenue: 'إيراد',
  expense: 'مصروف',
  general: 'عام',
  opening_balance: 'قيد افتتاحي',
  accrual: 'استحقاق',
  supplier_refund: 'استرداد من مورد',
  client_refund: 'رد إلى عميل',
  employee_advance: 'سلفة موظف',
  subcontractor: 'مقاول باطن',
  straight_line: 'قسط ثابت (Straight Line)',
  declining_balance: 'رصيد متناقص (Declining Balance)',
  immediate: 'سداد فوري',
  net_15: 'خلال 15 يوم',
  net_30: 'خلال 30 يوم',
  net_45: 'خلال 45 يوم',
  net_60: 'خلال 60 يوم',
  net_90: 'خلال 90 يوم',
  add: 'إضافة للمخزون (+)',
  issue: 'صرف من المخزون (-)',
  adjustment: 'تسوية جردية',
  transfer: 'تحويل بين المستودعات',
  return: 'مرتجع للمخزون',
  contract_value: 'قيمة العقد',
  valid_until: 'صالح حتى',
  created_at: 'تاريخ الإنشاء',
};

function labelOf(key: string) {
  return LABELS[key] || key.replace(/_/g, ' ');
}

function formatValue(key: string, value: any): ReactNode {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') {
    return (
      <Badge variant={value ? 'success' : 'danger'}>
        {value ? 'نعم / مفعّل' : 'لا / غير مفعّل'}
      </Badge>
    );
  }
  if (typeof value === 'object') return null;

  const s = String(value);

  // Status & enum translation
  if (TRANSLATIONS[s]) {
    return <span className="font-semibold text-slate-800">{TRANSLATIONS[s]}</span>;
  }

  // Date formatting
  if (/date|until|created_at|_at$/i.test(key) && /\d{4}-\d{2}-\d{2}/.test(s)) {
    return <span className="font-medium text-slate-800">{formatDate(s.slice(0, 10))}</span>;
  }

  // Currency & financial formatting
  if (/amount|total|debit|credit|balance|price|value|subtotal|cost|salary|pay|gross|net|limit/i.test(key) && !Number.isNaN(Number(value))) {
    const num = Number(value);
    return <span className="font-mono font-bold text-slate-900">{formatCurrency(num)}</span>;
  }

  // Phone / Numbers
  if (/phone|mobile|tel|iban|tax_number|commercial_registration|national_id|swift/i.test(key)) {
    return <span dir="ltr" className="font-mono font-semibold text-slate-800">{s}</span>;
  }

function formatValue(key: string, value: any): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'نعم' : 'لا';
  if (typeof value === 'object') return '';
  const s = String(value);
  if (/date|until|created_at|_at$/i.test(key) && /\d{4}-\d{2}-\d{2}/.test(s)) {
    return formatDate(s.slice(0, 10));
  }
  if (/amount|total|debit|credit|balance|price|value|subtotal|vat|tax|paid/i.test(key) && !Number.isNaN(Number(value))) {
    return formatCurrency(Number(value));
  }
  return s;
}

export function RecordViewModal({
  isOpen,
  onClose,
  title,
  record,
  extra,
}: {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  record: Record<string, any> | null;
  extra?: ReactNode;
}) {
  if (!record) return null;
  const entries = Object.entries(record).filter(([k, v]) => {
    if (HIDDEN.has(k)) return false;
    if (v == null || v === '') return false;
    if (typeof v === 'object' && !Array.isArray(v)) return false;
    return true;
  });

  const displayTitle = title || (record.name ? `معاينة: ${record.name}` : record.number ? `معاينة سجل رقم #${record.number}` : 'معاينة تفاصيل السجل');

    if (typeof v === 'object') return false;
    return true;
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2 text-slate-900 font-bold">
          <Eye size={18} className="text-accent" />
          <span>{displayTitle}</span>
        </div>
      }
      size="lg"
      footer={<Button variant="ghost" onClick={onClose}>إغلاق المعاينة</Button>}
      title={title || 'عرض السجل'}
      size="lg"
      footer={<Button variant="ghost" onClick={onClose}>إغلاق</Button>}
    >
      <div className="space-y-4">
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {entries.map(([k, v]) => (
            <div key={k} className="rounded-xl bg-slate-50 border border-slate-200 px-3.5 py-2.5 shadow-sm text-right">
              <dt className="text-[11px] font-semibold text-slate-500 mb-1">{labelOf(k)}</dt>
              <dd className="text-xs font-medium text-slate-900 break-words">{formatValue(k, v)}</dd>
            <div key={k} className="rounded-lg bg-bg-secondary/50 border border-border px-3 py-2">
              <dt className="text-xs text-text-muted mb-0.5">{labelOf(k)}</dt>
              <dd className="text-sm font-medium text-text-primary break-words">{formatValue(k, v)}</dd>
            </div>
          ))}
        </dl>
        {extra}
      </div>
    </Modal>
  );
}
