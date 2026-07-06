'use client';

import { useState } from 'react';
import { Plus, Eye } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { formatDate, formatCurrency } from '@/lib/utils';

const mockQuotations = [
  { id: '1', number: 1, date: '2026-06-20', contact_name: 'شركة النخيل', total: 45000, status: 'draft' },
  { id: '2', number: 2, date: '2026-06-18', contact_name: 'مؤسسة الورود', total: 78000, status: 'sent' },
];

export default function QuotationsPage() {
  const [loading] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const statusBadge = (status: string) => {
    const map: Record<string, { variant: 'warning' | 'info' | 'success' | 'danger'; label: string }> = {
      draft: { variant: 'warning', label: 'مسودة' },
      sent: { variant: 'info', label: 'مرسل' },
      accepted: { variant: 'success', label: 'مقبول' },
      rejected: { variant: 'danger', label: 'مرفوض' },
    };
    const m = map[status] || { variant: 'default' as const, label: status };
    return <Badge variant={m.variant}>{m.label}</Badge>;
  };

  const columns = [
    { key: 'number', label: 'الرقم', render: (row: any) => `#${row.number}` },
    { key: 'date', label: 'التاريخ', render: (row: any) => formatDate(row.date) },
    { key: 'contact_name', label: 'العميل', sortable: true },
    { key: 'total', label: 'الإجمالي', render: (row: any) => formatCurrency(row.total) },
    { key: 'status', label: 'الحالة', render: (row: any) => statusBadge(row.status) },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;

  return (
    <div className="space-y-6">
      <PageHeader title="عروض الأسعار" description="إدارة عروض الأسعار للعملاء"
        actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة عرض سعر</Button>}
      />
      {mockQuotations.length === 0 ? (
        <EmptyState title="لا توجد عروض أسعار" actionLabel="إضافة عرض سعر" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={mockQuotations} searchable searchKeys={['contact_name']} />
      )}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة عرض سعر" size="xl" footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button onClick={() => {}}>حفظ</Button></div>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="التاريخ" type="date" />
            <Input label="صالح حتى" type="date" />
            <Select label="العميل" options={[{ value: '', label: 'اختر عميلاً' }]} className="col-span-2" />
          </div>
          <Textarea label="ملاحظات" />
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-bg-secondary">
                <tr><th className="p-2 text-right">البيان</th><th className="p-2 text-right">الكمية</th><th className="p-2 text-right">سعر الوحدة</th><th className="p-2 text-right">الإجمالي</th></tr>
              </thead>
              <tbody>
                <tr className="border-t border-border">
                  <td className="p-2"><Input placeholder="وصف الصنف" /></td>
                  <td className="p-2 w-24"><Input type="number" /></td>
                  <td className="p-2 w-24"><Input type="number" /></td>
                  <td className="p-2 w-24"><Input type="number" disabled /></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </Modal>
    </div>
  );
}
