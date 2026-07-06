'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
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

const mockPI = [
  { id: '1', invoice_number: 1, date: '2026-06-20', supplier_name: 'شركة المواد', total: 45000, paid_amount: 45000 },
  { id: '2', invoice_number: 2, date: '2026-06-15', supplier_name: 'مؤسسة البناء', total: 78000, paid_amount: 30000 },
];

export default function PurchaseInvoicesPage() {
  const [loading] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const columns = [
    { key: 'invoice_number', label: 'الرقم', sortable: true },
    { key: 'date', label: 'التاريخ', sortable: true, render: (row: any) => formatDate(row.date) },
    { key: 'supplier_name', label: 'المورد', sortable: true },
    { key: 'total', label: 'الإجمالي', sortable: true, render: (row: any) => formatCurrency(row.total) },
    { key: 'paid_amount', label: 'المدفوع', sortable: true, render: (row: any) => formatCurrency(row.paid_amount) },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="فواتير المشتريات"
        description="إدارة فواتير الشراء"
        actions={
          <Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>
            إضافة فاتورة
          </Button>
        }
      />

      {mockPI.length === 0 ? (
        <EmptyState title="لا توجد فواتير مشتريات" description="أضف فاتورة مشتريات جديدة" actionLabel="إضافة فاتورة" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={mockPI} searchable searchKeys={['supplier_name', 'invoice_number']} />
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة فاتورة مشتريات" size="xl" footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button onClick={() => {}}>حفظ</Button></div>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="التاريخ" type="date" />
            <Select label="المورد" options={[{ value: '', label: 'اختر مورداً' }]} />
            <Select label="أمر الشراء" options={[{ value: '', label: 'اختياري' }]} className="col-span-2" />
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
