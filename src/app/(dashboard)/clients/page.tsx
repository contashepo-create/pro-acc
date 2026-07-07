'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { formatCurrency } from '@/lib/utils';

const mockClients = [
  { id: '1', name: 'شركة النخيل', phone: '0555000111', balance: 125000 },
  { id: '2', name: 'مؤسسة الورود', phone: '0555000222', balance: 68000 },
];

export default function ClientsPage() {
  const [loading] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const columns = [
    { key: 'name', label: 'الاسم', sortable: true },
    { key: 'phone', label: 'الجوال' },
    { key: 'balance', label: 'الرصيد', sortable: true, render: (row: any) => formatCurrency(row.balance) },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={6} />;

  return (
    <div className="space-y-6">
      <PageHeader title="العملاء" description="إدارة بيانات العملاء وأرصدتهم"
        actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة عميل</Button>}
      />
      {mockClients.length === 0 ? (
        <EmptyState title="لا توجد عملاء" actionLabel="إضافة عميل" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={mockClients} searchable searchKeys={['name', 'phone']} />
      )}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة عميل" footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button onClick={() => {}}>حفظ</Button></div>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="الاسم" className="col-span-2" />
          <Input label="الجوال" /><Input label="البريد الإلكتروني" type="email" />
          <Input label="الرقم الضريبي" /><Input label="الحد الائتماني" type="number" />
          <Input label="العنوان" className="col-span-2" />
        </div>
      </Modal>
    </div>
  );
}
