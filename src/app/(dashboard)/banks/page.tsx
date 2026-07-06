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
import { formatCurrency } from '@/lib/utils';

const mockBanks = [
  { id: '1', name: 'البنك الأهلي', type: 'bank', account_number: 'SA123456789', opening_balance: 500000, is_active: true },
  { id: '2', name: 'صندوق رئيسي', type: 'safe', account_number: '', opening_balance: 50000, is_active: true },
];

export default function BanksPage() {
  const [loading] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const columns = [
    { key: 'name', label: 'الاسم', sortable: true },
    { key: 'type', label: 'النوع', render: (row: any) => <Badge variant={row.type === 'bank' ? 'info' : 'accent'}>{row.type === 'bank' ? 'بنك' : 'صندوق'}</Badge> },
    { key: 'account_number', label: 'رقم الحساب' },
    { key: 'opening_balance', label: 'الرصيد الافتتاحي', render: (row: any) => formatCurrency(row.opening_balance) },
    { key: 'is_active', label: 'الحالة', render: (row: any) => <Badge variant={row.is_active ? 'success' : 'danger'}>{row.is_active ? 'نشط' : 'غير نشط'}</Badge> },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;

  return (
    <div className="space-y-6">
      <PageHeader title="البنوك والخزائن" description="إدارة الحسابات البنكية والخزائن النقدية"
        actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة بنك/خزينة</Button>}
      />
      {mockBanks.length === 0 ? (
        <EmptyState title="لا توجد بنوك أو خزائن" actionLabel="إضافة بنك/خزينة" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={mockBanks} searchable searchKeys={['name', 'account_number']} />
      )}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة بنك/خزينة" size="lg" footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button onClick={() => {}}>حفظ</Button></div>}>
        <div className="grid grid-cols-2 gap-4">
          <Input label="الاسم" className="col-span-2" />
          <Select label="النوع" options={[{ value: 'bank', label: 'بنك' }, { value: 'safe', label: 'صندوق' }]} />
          <Input label="رقم الحساب" />
          <Input label="الرصيد الافتتاحي" type="number" />
        </div>
      </Modal>
    </div>
  );
}
