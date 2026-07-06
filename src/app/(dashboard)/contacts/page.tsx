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

const mockContacts = [
  { id: '1', name: 'شركة النخيل', type: 'client', phone: '0555000111', email: 'info@nakhil.com', is_active: true },
  { id: '2', name: 'مؤسسة المواد', type: 'supplier', phone: '0555000222', email: 'info@mawad.com', is_active: true },
];

export default function ContactsPage() {
  const [loading] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const columns = [
    { key: 'name', label: 'الاسم', sortable: true },
    { key: 'type', label: 'النوع', sortable: true, render: (row: any) => <Badge variant={row.type === 'client' ? 'success' : row.type === 'supplier' ? 'danger' : 'info'}>{row.type}</Badge> },
    { key: 'phone', label: 'الجوال' },
    { key: 'email', label: 'البريد' },
    { key: 'is_active', label: 'الحالة', render: (row: any) => <Badge variant={row.is_active ? 'success' : 'danger'}>{row.is_active ? 'نشط' : 'غير نشط'}</Badge> },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;

  return (
    <div className="space-y-6">
      <PageHeader title="جهات الاتصال" description="إدارة جهات الاتصال"
        actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة جهة اتصال</Button>}
      />
      {mockContacts.length === 0 ? (
        <EmptyState title="لا توجد جهات اتصال" actionLabel="إضافة جهة اتصال" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={mockContacts} searchable searchKeys={['name', 'phone', 'email']} />
      )}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة جهة اتصال" size="lg" footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button onClick={() => {}}>حفظ</Button></div>}>
        <div className="grid grid-cols-2 gap-4">
          <Input label="الاسم" className="col-span-2" />
          <Select label="النوع" options={[{ value: 'client', label: 'عميل' }, { value: 'supplier', label: 'مورد' }, { value: 'subcontractor', label: 'مقاول باطن' }, { value: 'both', label: 'عميل ومورد' }]} />
          <Input label="الجوال" /><Input label="البريد الإلكتروني" type="email" />
          <Input label="العنوان" className="col-span-2" />
          <Input label="الرقم الضريبي" /><Input label="السجل التجاري" />
        </div>
      </Modal>
    </div>
  );
}
