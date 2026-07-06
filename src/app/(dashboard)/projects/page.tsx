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
import { Tabs } from '@/components/ui/Tabs';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { formatDate, formatCurrency } from '@/lib/utils';

const mockProjects = [
  { id: '1', name: 'مشروع النخيل', client_name: 'شركة النخيل', contract_value: 1200000, status: 'active', start_date: '2026-01-15' },
  { id: '2', name: 'مشروع الورود', client_name: 'مؤسسة الورود', contract_value: 850000, status: 'active', start_date: '2026-03-01' },
];

export default function ProjectsPage() {
  const [loading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [statusTab, setStatusTab] = useState('all');

  const statusBadge = (status: string) => {
    const map: Record<string, { variant: 'success' | 'warning' | 'danger'; label: string }> = {
      active: { variant: 'success', label: 'نشط' },
      completed: { variant: 'warning', label: 'منتهي' },
      cancelled: { variant: 'danger', label: 'ملغي' },
    };
    const m = map[status] || { variant: 'default' as const, label: status };
    return <Badge variant={m.variant}>{m.label}</Badge>;
  };

  const filtered = statusTab === 'all' ? mockProjects : mockProjects.filter(p => p.status === statusTab);

  const columns = [
    { key: 'name', label: 'اسم المشروع', sortable: true },
    { key: 'client_name', label: 'العميل', sortable: true },
    { key: 'contract_value', label: 'قيمة العقد', sortable: true, render: (row: any) => formatCurrency(row.contract_value) },
    { key: 'status', label: 'الحالة', sortable: true, render: (row: any) => statusBadge(row.status) },
    { key: 'start_date', label: 'تاريخ البداية', render: (row: any) => formatDate(row.start_date) },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="المشاريع"
        description="إدارة المشاريع"
        actions={
          <Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>
            إضافة مشروع
          </Button>
        }
      />

      <Tabs items={[
        { id: 'all', label: 'الكل' },
        { id: 'active', label: 'نشط' },
        { id: 'completed', label: 'منتهي' },
        { id: 'cancelled', label: 'ملغي' },
      ]} activeTab={statusTab} onChange={setStatusTab} />

      {filtered.length === 0 ? (
        <EmptyState title="لا توجد مشاريع" description="أضف مشروعاً جديداً" actionLabel="إضافة مشروع" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={filtered} searchable searchKeys={['name', 'client_name']} />
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة مشروع جديد" size="lg" footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button onClick={() => {}}>حفظ</Button></div>}>
        <div className="grid grid-cols-2 gap-4">
          <Input label="اسم المشروع" placeholder="اسم المشروع" className="col-span-2" />
          <Select label="العميل" options={[{ value: '', label: 'اختر عميلاً' }]} className="col-span-2" />
          <Input label="قيمة العقد" type="number" />
          <Input label="تاريخ البداية" type="date" />
          <Input label="تاريخ النهاية" type="date" />
        </div>
      </Modal>
    </div>
  );
}
