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

const mockClaims = [
  { id: '1', claim_number: 'PB-001', project_name: 'مشروع النخيل', gross_amount: 200000, retention_amount: 10000, net_amount: 190000, date: '2026-05-15', status: 'approved' },
  { id: '2', claim_number: 'PB-002', project_name: 'مشروع الورود', gross_amount: 150000, retention_amount: 7500, net_amount: 142500, date: '2026-06-01', status: 'approved' },
];

export default function ProgressBillingPage() {
  const [loading] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const columns = [
    { key: 'claim_number', label: 'رقم الفاتورة', sortable: true },
    { key: 'project_name', label: 'المشروع', sortable: true },
    { key: 'date', label: 'التاريخ', render: (row: any) => formatDate(row.date) },
    { key: 'gross_amount', label: 'الإجمالي', render: (row: any) => formatCurrency(row.gross_amount) },
    { key: 'retention_amount', label: 'الاحتجاز', render: (row: any) => formatCurrency(row.retention_amount) },
    { key: 'net_amount', label: 'الصافي', render: (row: any) => formatCurrency(row.net_amount) },
    { key: 'status', label: 'الحالة', render: (row: any) => <Badge variant="success">معتمدة</Badge> },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;

  return (
    <div className="space-y-6">
      <PageHeader title="الفواتير المرحلية" description="إدارة فواتير المبيعات المرحلية"
        actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة فاتورة مرحلية</Button>}
      />
      {mockClaims.length === 0 ? (
        <EmptyState title="لا توجد فواتير مرحلية" actionLabel="إضافة فاتورة" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={mockClaims} searchable searchKeys={['claim_number', 'project_name']} />
      )}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة فاتورة مرحلية" size="lg" footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button onClick={() => {}}>حفظ</Button></div>}>
        <div className="grid grid-cols-2 gap-4">
          <Input label="رقم الفاتورة" /><Select label="المشروع" options={[{ value: '', label: 'اختر' }]} />
          <Input label="التاريخ" type="date" /><Input label="المبلغ الإجمالي" type="number" />
          <Input label="نسبة الاحتجاز (%)" type="number" /><Input label="ملاحظات" className="col-span-2" />
        </div>
      </Modal>
    </div>
  );
}
