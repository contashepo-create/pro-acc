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

const mockBoq = [
  { id: '1', item_code: 'B001', description: 'خرسانة مسلحة', unit: 'م³', quantity: 500, unit_price: 350, total: 175000, project_name: 'مشروع النخيل' },
  { id: '2', item_code: 'B002', description: 'حديد تسليح', unit: 'طن', quantity: 50, unit_price: 2500, total: 125000, project_name: 'مشروع النخيل' },
];

export default function BoqPage() {
  const [loading] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const columns = [
    { key: 'item_code', label: 'الكود', sortable: true },
    { key: 'description', label: 'البيان', sortable: true },
    { key: 'unit', label: 'الوحدة' },
    { key: 'quantity', label: 'الكمية', sortable: true },
    { key: 'unit_price', label: 'سعر الوحدة', render: (row: any) => formatCurrency(row.unit_price) },
    { key: 'total', label: 'الإجمالي', render: (row: any) => formatCurrency(row.total) },
    { key: 'project_name', label: 'المشروع', sortable: true },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;

  return (
    <div className="space-y-6">
      <PageHeader title="بنود الكميات" description="إدارة بنود الكميات للمشاريع"
        actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة بند</Button>}
      />
      {mockBoq.length === 0 ? (
        <EmptyState title="لا توجد بنود كميات" actionLabel="إضافة بند" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={mockBoq} searchable searchKeys={['item_code', 'description', 'project_name']} />
      )}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة بند كمية" size="lg" footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button onClick={() => {}}>حفظ</Button></div>}>
        <div className="grid grid-cols-2 gap-4">
          <Select label="المشروع" options={[{ value: '', label: 'اختر مشروعاً' }]} className="col-span-2" />
          <Input label="كود البند" /><Input label="الوحدة" />
          <Input label="البيان" className="col-span-2" />
          <Input label="الكمية" type="number" /><Input label="سعر الوحدة" type="number" />
        </div>
      </Modal>
    </div>
  );
}
