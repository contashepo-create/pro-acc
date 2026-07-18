'use client';
import { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';

export default function BoqPage() {
  const [items, setItems] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<any>({ project_id: '', code: '', description: '', unit: '', quantity: 0, unit_price: 0 });

  const handleSave = async () => {
    if (!form.project_id || !form.description) { setSaveError('المشروع والوصف مطلوبان'); return; }
    setSaving(true); setSaveError('');
    try {
      const res = await fetch('/api/boq', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const json = await res.json();
      if (json.success) { setShowModal(false); setForm({ project_id: '', code: '', description: '', unit: '', quantity: 0, unit_price: 0 }); window.location.reload(); }
      else { setSaveError(json.message || 'فشل الحفظ'); }
    } catch { setSaveError('خطأ في الاتصال'); } finally { setSaving(false); }
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [itemRes, projRes] = await Promise.all([fetch('/api/boq'), fetch('/api/projects')]);
        const [itemJson, projJson] = await Promise.all([itemRes.json(), projRes.json()]);
        if (itemJson.success) setItems(itemJson.data?.items || []);
        else setError(itemJson.message || 'فشل');
        if (projJson.success) setProjects(projJson.data?.projects || []);
      } catch { setError('فشل تحميل البيانات'); } finally { setLoading(false); }
    };
    fetchData();
  }, []);

  const columns = [
    { key: 'code', label: 'الرمز', sortable: true },
    { key: 'description', label: 'الوصف', sortable: true },
    { key: 'unit', label: 'الوحدة' },
    { key: 'quantity', label: 'الكمية' },
    { key: 'unit_price', label: 'السعر' },
    { key: 'total', label: 'الإجمالي' },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;
  if (error) return <div className="p-6"><div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div></div>;

  return (
    <div className="space-y-6">
      <PageHeader title="جدول الكميات" description="إدارة جدول الكميات (BOQ)"
        actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة بند</Button>} />
      {items.length === 0 ? <EmptyState title="لا توجد بنود" actionLabel="إضافة بند" onAction={() => setShowModal(true)} /> : <DataTable columns={columns} data={items} searchable searchKeys={['description', 'code']} />}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة بند BOQ" footer={<div className="flex gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button onClick={handleSave} disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ"}</Button></div>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Select label="المشروع" value={form.project_id} onChange={(v) => setForm({...form, project_id: v})} options={[{ value: '', label: 'اختر مشروعاً' }, ...projects.map(p => ({ value: p.id, label: p.name }))]} className="col-span-2" />
            <Input label="الرمز" value={form.code} onChange={(e) => setForm({...form, code: e.target.value})} />
            <Input label="الوحدة" value={form.unit} onChange={(e) => setForm({...form, unit: e.target.value})} />
            <Input label="الوصف" value={form.description} onChange={(e) => setForm({...form, description: e.target.value})} className="col-span-2" />
            <Input label="الكمية" type="number" value={form.quantity} onChange={(e) => setForm({...form, quantity: parseFloat(e.target.value) || 0})} />
            <Input label="سعر الوحدة" type="number" value={form.unit_price} onChange={(e) => setForm({...form, unit_price: parseFloat(e.target.value) || 0})} />
          </div>
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
