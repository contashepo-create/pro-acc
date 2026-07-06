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

const mockCategories = [
  { id: '1', name: 'مصروفات إدارية', type: 'expense', account_name: 'مصروفات عمومية' },
  { id: '2', name: 'إيرادات استشارات', type: 'revenue', account_name: 'إيرادات أخرى' },
];

export default function CategoriesPage() {
  const [loading] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const columns = [
    { key: 'name', label: 'الاسم', sortable: true },
    { key: 'type', label: 'النوع', render: (row: any) => <Badge variant={row.type === 'revenue' ? 'success' : 'danger'}>{row.type === 'revenue' ? 'إيراد' : 'مصروف'}</Badge> },
    { key: 'account_name', label: 'الحساب', sortable: true },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={6} />;

  return (
    <div className="space-y-6">
      <PageHeader title="تصنيفات المعاملات" description="إدارة تصنيفات الإيرادات والمصروفات"
        actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة تصنيف</Button>}
      />
      {mockCategories.length === 0 ? (
        <EmptyState title="لا توجد تصنيفات" actionLabel="إضافة تصنيف" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={mockCategories} searchable searchKeys={['name', 'account_name']} />
      )}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة تصنيف" footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button onClick={() => {}}>حفظ</Button></div>}>
        <div className="grid grid-cols-2 gap-4">
          <Input label="الاسم" className="col-span-2" />
          <Select label="النوع" options={[{ value: 'revenue', label: 'إيراد' }, { value: 'expense', label: 'مصروف' }]} />
          <Select label="الحساب" options={[{ value: '', label: 'اختر حساباً' }]} />
        </div>
      </Modal>
    </div>
  );
}
