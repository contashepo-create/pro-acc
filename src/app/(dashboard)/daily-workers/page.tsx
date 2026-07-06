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

const mockRecords = [
  { id: '1', date: '2026-06-15', worker_name: 'محمد علي', worker_type: 'worker', daily_rate: 150, hours_worked: 8, total_amount: 150, project_name: 'مشروع النخيل' },
  { id: '2', date: '2026-06-15', worker_name: 'خالد حسن', worker_type: 'foreman', daily_rate: 250, hours_worked: 8, total_amount: 250, project_name: 'مشروع النخيل' },
];

export default function DailyWorkersPage() {
  const [loading] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const columns = [
    { key: 'date', label: 'التاريخ', render: (row: any) => formatDate(row.date) },
    { key: 'worker_name', label: 'الاسم', sortable: true },
    { key: 'worker_type', label: 'النوع', render: (row: any) => <Badge variant={row.worker_type === 'foreman' ? 'info' : 'accent'}>{row.worker_type === 'foreman' ? 'رئيس عمال' : 'عامل'}</Badge> },
    { key: 'daily_rate', label: 'السعر اليومي', render: (row: any) => formatCurrency(row.daily_rate) },
    { key: 'hours_worked', label: 'ساعات العمل' },
    { key: 'total_amount', label: 'الإجمالي', render: (row: any) => formatCurrency(row.total_amount) },
    { key: 'project_name', label: 'المشروع', sortable: true },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;

  return (
    <div className="space-y-6">
      <PageHeader title="العمال اليوميون" description="تسجيل العمال اليوميين في المشاريع"
        actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة عامل</Button>}
      />
      {mockRecords.length === 0 ? (
        <EmptyState title="لا توجد سجلات" actionLabel="إضافة عامل" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={mockRecords} searchable searchKeys={['worker_name', 'project_name']} />
      )}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="تسجيل عامل يومي" footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button onClick={() => {}}>حفظ</Button></div>}>
        <div className="grid grid-cols-2 gap-4">
          <Select label="المشروع" options={[{ value: '', label: 'اختر' }]} className="col-span-2" />
          <Input label="اسم العامل" />
          <Select label="النوع" options={[{ value: 'worker', label: 'عامل' }, { value: 'foreman', label: 'رئيس عمال' }]} />
          <Input label="التاريخ" type="date" />
          <Input label="السعر اليومي" type="number" />
          <Input label="ساعات العمل" type="number" defaultValue="8" />
          <Input label="ملاحظات" className="col-span-2" />
        </div>
      </Modal>
    </div>
  );
}
