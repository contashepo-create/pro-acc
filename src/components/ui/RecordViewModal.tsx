'use client';

import type { ReactNode } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { formatCurrency, formatDate } from '@/lib/utils';

const HIDDEN = new Set([
  'id', 'company_id', 'created_by', 'updated_at', 'deleted_at',
  'contacts', 'accounts', 'projects', 'employees', 'invoices',
  'journal_entry_id', 'password', 'password_hash', 'token',
]);

const LABELS: Record<string, string> = {
  number: 'الرقم',
  date: 'التاريخ',
  due_date: 'تاريخ الاستحقاق',
  name: 'الاسم',
  description: 'البيان',
  notes: 'ملاحظات',
  status: 'الحالة',
  type: 'النوع',
  total: 'الإجمالي',
  subtotal: 'المجموع الفرعي',
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
  contract_value: 'قيمة العقد',
  valid_until: 'صالح حتى',
  created_at: 'تاريخ الإنشاء',
};

function labelOf(key: string) {
  return LABELS[key] || key.replace(/_/g, ' ');
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
    if (typeof v === 'object') return false;
    return true;
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title || 'عرض السجل'}
      size="lg"
      footer={<Button variant="ghost" onClick={onClose}>إغلاق</Button>}
    >
      <div className="space-y-4">
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {entries.map(([k, v]) => (
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
