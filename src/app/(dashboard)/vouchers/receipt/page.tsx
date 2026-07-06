'use client';

import { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { formatDate, formatCurrency } from '@/lib/utils';

const mockReceipts = [
  { id: '1', number: 1, date: '2026-06-22', receipt_type: 'client', contact_name: 'شركة النخيل', amount: 50000, bank_name: 'البنك الأهلي' },
  { id: '2', number: 2, date: '2026-06-21', receipt_type: 'general', contact_name: '', amount: 10000, bank_name: 'صندوق 1' },
];

export default function ReceiptPage() {
  const [loading] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const typeBadge = (type: string) => {
    const map: Record<string, { variant: 'success' | 'info' | 'accent'; label: string }> = {
      client: { variant: 'success', label: 'عميل' },
      supplier_refund: { variant: 'info', label: 'مورد' },
      general: { variant: 'accent', label: 'عام' },
    };
    const m = map[type] || { variant: 'default' as const, label: type };
    return <Badge variant={m.variant}>{m.label}</Badge>;
  };

  const columns = [
    { key: 'number', label: 'الرقم', sortable: true },
    { key: 'date', label: 'التاريخ', sortable: true, render: (row: any) => formatDate(row.date) },
    { key: 'receipt_type', label: 'النوع', sortable: true, render: (row: any) => typeBadge(row.receipt_type) },
    { key: 'contact_name', label: 'الطرف', sortable: true },
    { key: 'amount', label: 'المبلغ', sortable: true, render: (row: any) => formatCurrency(row.amount) },
    { key: 'bank_name', label: 'الخزينة/البنك', sortable: true },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="سندات القبض"
        description="تسجيل المقبوضات النقدية"
        actions={
          <Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>
            إضافة سند قبض
          </Button>
        }
      />

      {mockReceipts.length === 0 ? (
        <EmptyState title="لا توجد سندات قبض" description="أضف سند قبض جديد" actionLabel="إضافة سند قبض" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={mockReceipts} searchable searchKeys={['number', 'contact_name']} />
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة سند قبض" size="lg" footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button onClick={() => {}}>حفظ</Button></div>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="التاريخ" type="date" />
            <Select label="نوع السند" options={[
              { value: 'client', label: 'تحصيل من عميل' },
              { value: 'supplier_refund', label: 'استرداد من مورد' },
              { value: 'general', label: 'قبض عام' },
            ]} />
            <Select label="الخزينة/البنك" options={[{ value: '', label: 'اختر' }]} />
            <Input label="المبلغ" type="number" />
            <Input label="البيان" className="col-span-2" placeholder="سبب القبض" />
          </div>
        </div>
      </Modal>
    </div>
  );
}
