'use client';

import { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { ActionButtons } from '@/components/ui/ActionButtons';
import { fetchRecord, recordOrRow } from '@/lib/form-utils';
import { toast } from '@/components/ui/Toast';
import { PrintButton } from '@/components/ui/PrintButton';
import { useCompanyMoney } from '@/hooks/use-company-money';

interface WorkerRow { id: string; name: string; phone?: string; daily_wage?: number; is_active?: boolean; }
interface WorkerForm { name: string; phone: string; daily_wage: number; }

export default function DailyWorkersPage() {
  const { money } = useCompanyMoney();
  const [rows, setRows] = useState<WorkerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<WorkerRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<WorkerForm>({ name: '', phone: '', daily_wage: 0 });

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/daily-workers');
      const json = await res.json();
      if (json.success) setRows(json.data?.workers || []);
      else { setError(json.message || 'فشل'); toast.error(json.message || 'فشل تحميل البيانات'); }
    } catch { setError('فشل تحميل البيانات'); }
    finally { setLoading(false); }
  };

  // Initial load on mount (standard fetch pattern).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchData(); }, []);

  const handleSave = async () => {
    if (!form.name.trim()) { setSaveError('اسم العامل مطلوب'); return; }
    setSaving(true); setSaveError('');
    try {
      const url = editing ? `/api/daily-workers/${editing.id}` : '/api/daily-workers';
      const method = editing ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false); setEditing(null);
        setForm({ name: '', phone: '', daily_wage: 0 });
        toast.success(editing ? 'تم تحديث العامل' : 'تم إضافة عامل يومي');
        fetchData();
      } else setSaveError(json.message || 'فشل الحفظ');
    } catch { setSaveError('خطأ في الاتصال'); }
    finally { setSaving(false); }
  };

  const handleEdit = async (row: WorkerRow) => {
    const { data, error } = await fetchRecord(`/api/daily-workers/${row.id}`);
    const src = recordOrRow(data, row);
    if (!data && error) toast.error(error);
    setEditing(row);
    setForm({ name: String(src.name ?? ''), phone: String(src.phone ?? ''), daily_wage: Number(src.daily_wage) || 0 });
    setShowModal(true);
  };

  const handleDelete = async (row: WorkerRow) => {
    if (!confirm(`حذف العامل "${row.name}"؟`)) return;
    try {
      const res = await fetch(`/api/daily-workers/${row.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) { toast.success('تم حذف العامل'); fetchData(); }
      else toast.error(json.message || 'فشل الحذف');
    } catch { toast.error('خطأ في الاتصال'); }
  };

  const columns = [
    { key: 'name', label: 'اسم العامل', sortable: true },
    { key: 'phone', label: 'الجوال', render: (r: WorkerRow) => <span dir="ltr">{r.phone || '—'}</span> },
    { key: 'daily_wage', label: 'الأجر اليومي', render: (r: WorkerRow) => money(r.daily_wage ?? 0) },
    { key: 'is_active', label: 'الحالة', render: (r: WorkerRow) => <Badge variant={r.is_active ? 'success' : 'danger'}>{r.is_active ? 'نشط' : 'معطّل'}</Badge> },
    { key: 'actions', label: 'إجراءات', render: (r: WorkerRow) => <ActionButtons item={r} onEdit={() => handleEdit(r)} onDelete={() => handleDelete(r)} /> },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={6} />;
  if (error) return <div className="p-6"><div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div></div>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="العمال اليوميون"
        description="إدارة سجل العمالة اليومية والأجور"
        actions={<Button onClick={() => { setEditing(null); setForm({ name: '', phone: '', daily_wage: 0 }); setShowModal(true); }} leftIcon={<Plus size={18} />}>إضافة عامل يومي</Button>}
      />
      {rows.length === 0 ? (
        <EmptyState title="لا يوجد عمال يوميون" actionLabel="إضافة عامل" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={rows} searchable searchKeys={['name', 'phone']} />
      )}
      <Modal
        isOpen={showModal}
        onClose={() => { setShowModal(false); setEditing(null); }}
        title={editing ? `تعديل: ${editing.name}` : 'إضافة عامل يومي جديد'}
        size="md"
        footer={<div className="flex gap-2">
          <Button variant="ghost" onClick={() => { setShowModal(false); setEditing(null); }}>إلغاء</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</Button>
        </div>}
      >
        <div className="space-y-4">
          <Input label="اسم العامل *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label="رقم الهاتف" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} dir="ltr" />
          <Input label="الأجر اليومي" type="number" value={form.daily_wage} onChange={(e) => setForm({ ...form, daily_wage: parseFloat(e.target.value) || 0 })} />
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    <PrintButton /></div>
  );
}
