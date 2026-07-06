'use client';

import { useState } from 'react';
import { Plus, Eye } from 'lucide-react';
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

const mockCustodies = [
  { id: '1', employee_name: 'أحمد محمد', date: '2026-06-01', amount: 10000, description: 'عهدة مشتريات', status: 'open' },
  { id: '2', employee_name: 'سارة خالد', date: '2026-06-10', amount: 5000, description: 'عهدة سفر', status: 'settled' },
];

export default function CustodiesPage() {
  const [loading] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const columns = [
    { key: 'employee_name', label: 'الموظف', sortable: true },
    { key: 'date', label: 'التاريخ', sortable: true, render: (row: any) => formatDate(row.date) },
    { key: 'amount', label: 'المبلغ', sortable: true, render: (row: any) => formatCurrency(row.amount) },
    { key: 'description', label: 'البيان', sortable: true },
    { key: 'status', label: 'الحالة', render: (row: any) => <Badge variant={row.status === 'open' ? 'warning' : 'success'}>{row.status === 'open' ? 'مفتوحة' : 'مسددة'}</Badge> },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;

  return (
    <div className="space-y-6">
      <PageHeader title="العهد" description="إدارة عهد الموظفين"
        actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة عهدة</Button>}
      />
      {mockCustodies.length === 0 ? (
        <EmptyState title="لا توجد عهد" description="أضف عهدة جديدة" actionLabel="إضافة عهدة" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={mockCustodies} searchable searchKeys={['employee_name', 'description']} />
      )}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة عهدة" size="lg" footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button onClick={() => {}}>حفظ</Button></div>}>
        <div className="grid grid-cols-2 gap-4">
          <Select label="الموظف" options={[{ value: '', label: 'اختر موظفاً' }]} className="col-span-2" />
          <Input label="التاريخ" type="date" />
          <Input label="المبلغ" type="number" />
          <Select label="الخزينة/البنك" options={[{ value: '', label: 'اختر' }]} />
          <Input label="البيان" className="col-span-2" placeholder="وصف العهدة" />
        </div>
      </Modal>
    </div>
  );
}
