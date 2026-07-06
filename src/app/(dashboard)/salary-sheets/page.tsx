'use client';

import { useState } from 'react';
import { Plus, Eye, Search, FileText } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';

const monthNames: Record<number, string> = {
  1: 'يناير', 2: 'فبراير', 3: 'مارس', 4: 'أبريل', 5: 'مايو', 6: 'يونيو',
  7: 'يوليو', 8: 'أغسطس', 9: 'سبتمبر', 10: 'أكتوبر', 11: 'نوفمبر', 12: 'ديسمبر',
};

const mockSheets = [
  { id: '1', name: 'مرتبات يونيو 2026', month: 6, year: 2026, date: '2026-06-25', status: 'draft', total_employees: 15 },
  { id: '2', name: 'مرتبات مايو 2026', month: 5, year: 2026, date: '2026-05-25', status: 'approved', total_employees: 14 },
];

export default function SalarySheetsPage() {
  const [loading] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const columns = [
    { key: 'name', label: 'اسم الكشف', sortable: true },
    { key: 'date', label: 'التاريخ', sortable: true },
    { key: 'total_employees', label: 'عدد الموظفين' },
    { key: 'status', label: 'الحالة',
      render: (row: any) => {
        const variants: Record<string, string> = { draft: 'warning', approved: 'success' };
        const labels: Record<string, string> = { draft: 'مسودة', approved: 'معتمد' };
        return <Badge variant={(variants[row.status] || 'info') as any}>{labels[row.status] || row.status}</Badge>;
      },
    },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={6} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="كشوف المرتبات"
        description="إعداد مسودات المرتبات قبل الترحيل المحاسبي"
        actions={
          <Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>كشف جديد</Button>
        }
      />
      {mockSheets.length === 0 ? (
        <EmptyState title="لا توجد كشوف" actionLabel="كشف جديد" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={mockSheets} searchable searchKeys={['name']} />
      )}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة كشف مرتبات" size="lg" footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button>حفظ</Button></div>}>
        <div className="space-y-4">
          <Input label="اسم الكشف" placeholder="مثال: مرتبات يوليو 2026" />
          <div className="grid grid-cols-2 gap-4">
            <Select label="الشهر" options={Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: monthNames[i + 1] }))} />
            <Input label="السنة" type="number" defaultValue="2026" />
          </div>
          <Input label="التاريخ" type="date" />
          <div className="border border-border rounded-lg p-4">
            <h3 className="font-medium mb-3">الموظفون</h3>
            <p className="text-sm text-text-muted">سيتم جلب الموظفين النشطين تلقائياً عند الحفظ</p>
          </div>
        </div>
      </Modal>
    </div>
  );
}
