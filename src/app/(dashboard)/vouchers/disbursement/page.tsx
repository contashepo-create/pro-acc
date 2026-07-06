'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
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

const mockDisbursements = [
  { id: '1', number: 1, date: '2026-06-22', disbursement_type: 'supplier', contact_name: 'مورد مواد', amount: 34000, bank_name: 'البنك الأهلي' },
  { id: '2', number: 2, date: '2026-06-21', disbursement_type: 'employee_advance', employee_name: 'أحمد محمد', amount: 5000, bank_name: 'صندوق 1' },
];

export default function DisbursementPage() {
  const [loading] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const typeBadge = (type: string) => {
    const map: Record<string, { variant: 'danger' | 'warning' | 'info' | 'accent'; label: string }> = {
      supplier: { variant: 'danger', label: 'مورد' },
      client_refund: { variant: 'warning', label: 'عميل' },
      employee_advance: { variant: 'info', label: 'موظف' },
      other: { variant: 'accent', label: 'أخرى' },
    };
    const m = map[type] || { variant: 'default' as const, label: type };
    return <Badge variant={m.variant}>{m.label}</Badge>;
  };

  const columns = [
    { key: 'number', label: 'الرقم', sortable: true },
    { key: 'date', label: 'التاريخ', sortable: true, render: (row: any) => formatDate(row.date) },
    { key: 'disbursement_type', label: 'النوع', sortable: true, render: (row: any) => typeBadge(row.disbursement_type) },
    { key: 'contact_name', label: 'المورد', sortable: true },
    { key: 'employee_name', label: 'الموظف', sortable: true },
    { key: 'amount', label: 'المبلغ', sortable: true, render: (row: any) => formatCurrency(row.amount) },
    { key: 'bank_name', label: 'الخزينة/البنك' },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="سندات الصرف"
        description="تسجيل المدفوعات النقدية"
        actions={
          <Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>
            إضافة سند صرف
          </Button>
        }
      />

      {mockDisbursements.length === 0 ? (
        <EmptyState title="لا توجد سندات صرف" description="أضف سند صرف جديد" actionLabel="إضافة سند صرف" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={mockDisbursements} searchable searchKeys={['number', 'contact_name', 'employee_name']} />
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة سند صرف" size="lg" footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button onClick={() => {}}>حفظ</Button></div>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="التاريخ" type="date" />
            <Select label="نوع السند" options={[
              { value: 'supplier', label: 'دفعة مورد' },
              { value: 'client_refund', label: 'رد عميل' },
              { value: 'employee_advance', label: 'سلفة موظف' },
              { value: 'other', label: 'أخرى' },
            ]} />
            <Select label="الخزينة/البنك" options={[{ value: '', label: 'اختر' }]} />
            <Input label="المبلغ" type="number" />
            <Input label="البيان" className="col-span-2" placeholder="سبب الصرف" />
          </div>
        </div>
      </Modal>
    </div>
  );
}
