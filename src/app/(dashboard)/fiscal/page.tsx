'use client';

import { useState } from 'react';
import { Plus, Lock, Unlock } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { formatDate } from '@/lib/utils';

const mockFiscal = [
  { id: '1', name: '2026', start_date: '2026-01-01', end_date: '2026-12-31', status: 'open' },
  { id: '2', name: '2025', start_date: '2025-01-01', end_date: '2025-12-31', status: 'closed', closed_at: '2026-01-01' },
];

export default function FiscalPage() {
  const [loading] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const columns = [
    { key: 'name', label: 'الاسم', sortable: true },
    { key: 'start_date', label: 'تاريخ البداية', render: (row: any) => formatDate(row.start_date) },
    { key: 'end_date', label: 'تاريخ النهاية', render: (row: any) => formatDate(row.end_date) },
    { key: 'status', label: 'الحالة', render: (row: any) => <Badge variant={row.status === 'open' ? 'success' : 'warning'}>{row.status === 'open' ? 'مفتوحة' : 'مقفلة'}</Badge> },
    { key: 'closed_at', label: 'تاريخ الإقفال', render: (row: any) => row.closed_at ? formatDate(row.closed_at) : '-' },
    {
      key: 'actions', label: '', render: (row: any) => (
        <div className="flex gap-1">
          {row.status === 'open' ? (
            <Button variant="ghost" size="sm"><Lock size={14} /></Button>
          ) : (
            <Button variant="ghost" size="sm"><Unlock size={14} /></Button>
          )}
        </div>
      ),
    },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={6} />;

  return (
    <div className="space-y-6">
      <PageHeader title="السنوات المالية" description="إدارة الفترات المالية وإقفال السنة"
        actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة سنة مالية</Button>}
      />
      {mockFiscal.length === 0 ? (
        <EmptyState title="لا توجد سنوات مالية" actionLabel="إضافة سنة مالية" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={mockFiscal} />
      )}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة سنة مالية" footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button onClick={() => {}}>حفظ</Button></div>}>
        <div className="grid grid-cols-2 gap-4">
          <Input label="الاسم" placeholder="مثال: 2026" className="col-span-2" />
          <Input label="تاريخ البداية" type="date" />
          <Input label="تاريخ النهاية" type="date" />
        </div>
      </Modal>
    </div>
  );
}
