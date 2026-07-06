'use client';

import { useState } from 'react';
import { Plus, FileText, Eye } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Badge } from '@/components/ui/Badge';
import { Tabs } from '@/components/ui/Tabs';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { formatDate, formatCurrency } from '@/lib/utils';

const mockInvoices = [
  { id: '1', number: 1, date: '2026-06-22', contact_name: 'شركة النخيل', total: 50000, status: 'unpaid', paid_amount: 0 },
  { id: '2', number: 2, date: '2026-06-20', contact_name: 'مؤسسة الورود', total: 75000, status: 'partial', paid_amount: 30000 },
];

export default function InvoicesPage() {
  const [loading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [statusTab, setStatusTab] = useState('all');

  const statusBadge = (status: string) => {
    const map: Record<string, { variant: 'success' | 'warning' | 'danger' | 'info'; label: string }> = {
      unpaid: { variant: 'warning', label: 'غير مدفوعة' },
      partial: { variant: 'info', label: 'مدفوعة جزئياً' },
      paid: { variant: 'success', label: 'مدفوعة' },
      cancelled: { variant: 'danger', label: 'ملغاة' },
    };
    const m = map[status] || { variant: 'default' as const, label: status };
    return <Badge variant={m.variant}>{m.label}</Badge>;
  };

  const filtered = statusTab === 'all' ? mockInvoices : mockInvoices.filter(i => i.status === statusTab);

  const columns = [
    { key: 'number', label: 'الرقم', sortable: true, render: (row: any) => `#${row.number}` },
    { key: 'date', label: 'التاريخ', sortable: true, render: (row: any) => formatDate(row.date) },
    { key: 'contact_name', label: 'العميل', sortable: true },
    { key: 'total', label: 'الإجمالي', sortable: true, render: (row: any) => formatCurrency(row.total) },
    { key: 'status', label: 'الحالة', sortable: true, render: (row: any) => statusBadge(row.status) },
    { key: 'paid_amount', label: 'المدفوع', render: (row: any) => formatCurrency(row.paid_amount) },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="الفواتير"
        description="إدارة فواتير المبيعات"
        actions={
          <Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>
            إضافة فاتورة
          </Button>
        }
      />

      <Tabs items={[
        { id: 'all', label: 'الكل' },
        { id: 'unpaid', label: 'غير مدفوعة' },
        { id: 'partial', label: 'مدفوعة جزئياً' },
        { id: 'paid', label: 'مدفوعة' },
      ]} activeTab={statusTab} onChange={setStatusTab} />

      {filtered.length === 0 ? (
        <EmptyState title="لا توجد فواتير" description="أضف فاتورة جديدة" actionLabel="إضافة فاتورة" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={filtered} searchable searchKeys={['contact_name', 'number']} />
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة فاتورة جديدة" size="xl" footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button onClick={() => {}}>حفظ</Button></div>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="التاريخ" type="date" />
            <Input label="تاريخ الاستحقاق" type="date" />
            <Select label="العميل" options={[{ value: '', label: 'اختر عميلاً' }]} className="col-span-2" />
            <Select label="المشروع" options={[{ value: '', label: 'اختياري' }]} className="col-span-2" />
          </div>
          <Textarea label="ملاحظات" placeholder="ملاحظات الفاتورة" />
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
