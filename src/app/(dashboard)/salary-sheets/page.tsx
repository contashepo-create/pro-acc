'use client';

import { useState, useEffect } from 'react';
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

export default function SalarySheetsPage() {
  const [sheets, setSheets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/salary-sheets');
        const json = await res.json();
        if (json.success) {
          setSheets(json.data || []);
        } else {
          setError(json.message || 'فشل تحميل البيانات');
        }
      } catch {
        setError('فشل تحميل البيانات');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

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

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="كشوف المرتبات" description="إعداد مسودات المرتبات قبل الترحيل المحاسبي"
          actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>كشف جديد</Button>}
        />
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="كشوف المرتبات"
        description="إعداد مسودات المرتبات قبل الترحيل المحاسبي"
        actions={
          <Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>كشف جديد</Button>
        }
      />
      {sheets.length === 0 ? (
        <EmptyState title="لا توجد كشوف" actionLabel="كشف جديد" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={sheets} searchable searchKeys={['name']} />
      )}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة كشف مرتبات" size="lg" footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button>حفظ</Button></div>}>
        <div className="space-y-4">
          <Input label="اسم الكشف" placeholder="مثال: مرتبات يوليو 2026" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} />
          <div className="grid grid-cols-2 gap-4">
            <Select label="الشهر" options={Array.from({ length: 12 }, (_, i) = value={form.الشهر} onChange={(value) => setForm({...form, الشهر: value})}> ({ value: String(i + 1), label: monthNames[i + 1] }))} />
            <Input label="السنة" type="number" defaultValue="2026" value={form.year} onChange={(e) => setForm({...form, year: e.target.value})} />
          </div>
          <Input label="التاريخ" type="date" value={form.date} onChange={(e) => setForm({...form, date: e.target.value})} />
          <div className="border border-border rounded-lg p-4">
            <h3 className="font-medium mb-3">الموظفون</h3>
            <p className="text-sm text-text-muted">سيتم جلب الموظفين النشطين تلقائياً عند الحفظ</p>
          </div>
        </div>
      </Modal>
    </div>
  );
}
