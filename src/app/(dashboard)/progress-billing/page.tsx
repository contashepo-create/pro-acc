'use client';

import { useState, useEffect } from 'react';
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

export default function ProgressBillingPage() {
  const [claims, setClaims] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/progress-billing');
        const json = await res.json();
        if (json.success) {
          setClaims(json.data?.claims || []);
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
    { key: 'claim_number', label: 'رقم الفاتورة', sortable: true },
    { key: 'project_name', label: 'المشروع', sortable: true },
    { key: 'date', label: 'التاريخ', render: (row: any) => formatDate(row.date) },
    { key: 'gross_amount', label: 'الإجمالي', render: (row: any) => formatCurrency(row.gross_amount) },
    { key: 'retention_amount', label: 'الاحتجاز', render: (row: any) => formatCurrency(row.retention_amount) },
    { key: 'net_amount', label: 'الصافي', render: (row: any) => formatCurrency(row.net_amount) },
    { key: 'status', label: 'الحالة', render: (row: any) => <Badge variant="success">معتمدة</Badge> },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="الفواتير المرحلية" description="إدارة فواتير المبيعات المرحلية"
          actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة فاتورة مرحلية</Button>}
        />
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="الفواتير المرحلية" description="إدارة فواتير المبيعات المرحلية"
        actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة فاتورة مرحلية</Button>}
      />
      {claims.length === 0 ? (
        <EmptyState title="لا توجد فواتير مرحلية" actionLabel="إضافة فاتورة" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={claims} searchable searchKeys={['claim_number', 'project_name']} />
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
