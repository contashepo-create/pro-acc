'use client';

import { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { ActionButtons } from '@/components/ui/ActionButtons';
import { formatCurrency } from '@/lib/utils';

export default function DailyWorkersPage() {
  const [workers, setWorkers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingWorker, setEditingWorker] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<any>({ name: '', phone: '', daily_wage: 0 });

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch('/api/daily-workers');
      const json = await res.json();
      if (json.success) setWorkers(json.data?.workers || []);
      else setError(json.message || 'فشل');
    } catch { setError('فشل تحميل البيانات'); } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleSave = async () => {
    if (!form.name) { setSaveError('الاسم مطلوب'); return; }
    if (!form.daily_wage || form.daily_wage <= 0) { setSaveError('الأجر اليومي مطلوب'); return; }
    setSaving(true); setSaveError('');
    try {
      const url = editingWorker ? `/api/daily-workers/${editingWorker.id}` : '/api/daily-workers';
      const method = editingWorker ? 'PUT' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setEditingWorker(null);
        setForm({ name: '', phone: '', daily_wage: 0 });
        fetchData();
      } else setSaveError(json.message || 'فشل الحفظ');
    } catch (e: any) { setSaveError('خطأ في الاتصال'); } finally { setSaving(false); }
  };

  const handleEdit = async (worker: any) => {
    try {
      const res = await fetch(`/api/daily-workers/${worker.id}`);
      const json = await res.json();
      if (json.success) {
        setEditingWorker(worker);
        setForm({ name: json.data.name, phone: json.data.phone || '', daily_wage: json.data.daily_wage });
        setShowModal(true);
      }
    } catch (e) {
      console.error('Failed to load worker:', e);
    }
  };

  const handleDelete = async (worker: any) => {
    try {
      const res = await fetch(`/api/daily-workers/${worker.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        fetchData();
      } else {
        alert(json.message || 'فشل الحذف');
      }
    } catch (e) {
      alert('خطأ في الاتصال بالخادم');
    }
  };

  const columns = [
    { key: 'name', label: 'الاسم', sortable: true },
    { key: 'phone', label: 'الجوال' },
    { key: 'daily_wage', label: 'الأجر اليومي', render: (row: any) => formatCurrency(row.daily_wage) },
    { key: 'is_active', label: 'الحالة', render: (row: any) => <span className={row.is_active ? 'text-success' : 'text-danger'}>{row.is_active ? 'نشط' : 'غير نشط'}</span> },
    {
      key: 'actions',
      label: 'إجراءات',
      render: (row: any) => (
        <ActionButtons
          item={row}
          onEdit={handleEdit}
          onDelete={handleDelete}
        />
      ),
    },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={6} />;
  if (error) return <div className="p-6"><div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div></div>;

  return (
    <div className="space-y-6">
      <PageHeader title="العمالة اليومية" description="إدارة العمالة اليومية وأجورها" actions={<Button onClick={() => { setEditingWorker(null); setShowModal(true); }} leftIcon={<Plus size={18} />}>إضافة عامل</Button>} />
      {workers.length === 0 ? <EmptyState title="لا يوجد عمال" actionLabel="إضافة عامل" onAction={() => setShowModal(true)} /> : <DataTable columns={columns} data={workers} searchable searchKeys={['name', 'phone']} />}
      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setEditingWorker(null); }} title={editingWorker ? `تعديل: ${editingWorker.name}` : 'إضافة عامل يومي'} size="lg" footer={<div className="flex gap-2"><Button variant="ghost" onClick={() => { setShowModal(false); setEditingWorker(null); }}>إلغاء</Button><Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</Button></div>}>
        <div className="space-y-4">
          <Input label="الاسم" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} />
          <Input label="الجوال" value={form.phone} onChange={(e) => setForm({...form, phone: e.target.value})} />
          <Input label="الأجر اليومي" type="number" value={form.daily_wage} onChange={(e) => setForm({...form, daily_wage: parseFloat(e.target.value) || 0})} />
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
