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

export default function DailyWorkersPage() {
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<any>({"name": "", "phone": "", "daily_wage": ""});

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    try {
      const res = await fetch('/api/daily-workers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setForm({});
        // Refresh data
        window.location.reload();
      } else {
        setSaveError(json.message || 'فشل الحفظ: ' + JSON.stringify(json));
      }
    } catch (e) {
      setSaveError('خطأ في الاتصال بالخادم: ' + ('خطأ'));
    } finally {
      setSaving(false);
    }
  };





  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/daily-workers');
        const json = await res.json();
        if (json.success) {
          setRecords(json.data?.records || []);
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
    { key: 'date', label: 'التاريخ', render: (row: any) => formatDate(row.date) },
    { key: 'worker_name', label: 'الاسم', sortable: true },
    { key: 'worker_type', label: 'النوع', render: (row: any) => <Badge variant={row.worker_type === 'foreman' ? 'info' : 'accent'}>{row.worker_type === 'foreman' ? 'رئيس عمال' : 'عامل'}</Badge> },
    { key: 'daily_rate', label: 'السعر اليومي', render: (row: any) => formatCurrency(row.daily_rate) },
    { key: 'hours_worked', label: 'ساعات العمل' },
    { key: 'total_amount', label: 'الإجمالي', render: (row: any) => formatCurrency(row.total_amount) },
    { key: 'project_name', label: 'المشروع', sortable: true },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="العمال اليوميون" description="تسجيل العمال اليوميين في المشاريع"
          actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة عامل</Button>}
        />
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="العمال اليوميون" description="تسجيل العمال اليوميين في المشاريع"
        actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة عامل</Button>}
      />
      {records.length === 0 ? (
        <EmptyState title="لا توجد سجلات" actionLabel="إضافة عامل" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={records} searchable searchKeys={['worker_name', 'project_name']} />
      )}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="تسجيل عامل يومي" footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button onClick={handleSave} disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ"}</Button></div>}>
        <div className="grid grid-cols-2 gap-4">
          <Select label="المشروع" options={[{ value: '', label: 'اختر' }]} className="col-span-2" value={form.project_id} onChange={(value) => setForm({...form, project_id: value})} />
          <Input label="اسم العامل" value={form.name} onChange={(e) => setForm({...form, اسم_العامل: e.target.value})} />
          <Select label="النوع" options={[{ value: 'worker', label: 'عامل' }, { value: 'foreman', label: 'رئيس عمال' }]} value={form.type} onChange={(value) => setForm({...form, type: value})} />
          <Input label="التاريخ" type="date" value={form.date} onChange={(e) => setForm({...form, date: e.target.value})} />
          <Input label="السعر اليومي" type="number" value={form.daily_wage} onChange={(e) => setForm({...form, السعر_اليومي: e.target.value})} />
          <Input label="ساعات العمل" type="number" defaultValue="8" value={form.hours} onChange={(e) => setForm({...form, ساعات_العمل: e.target.value})} />
          <Input label="ملاحظات" className="col-span-2" value={form.notes} onChange={(e) => setForm({...form, ملاحظات: e.target.value})} />
                  {saveError && <div className="col-span-2 bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
