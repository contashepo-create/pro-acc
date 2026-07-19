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
import { ActionButtons } from '@/components/ui/ActionButtons';
import { formatCurrency } from '@/lib/utils';

export default function BoqPage() {
  const [items, setItems] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<any>({
    project_id: '', code: '', description: '', unit: 'وحدة', quantity: 0, unit_price: 0,
  });

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const [boqRes, projRes] = await Promise.all([
        fetch('/api/boq'),
        fetch('/api/projects'),
      ]);
      const [boqJson, projJson] = await Promise.all([
        boqRes.json(),
        projRes.json(),
      ]);
      if (boqJson.success) setItems(boqJson.data?.items || []);
      else setError(boqJson.message || 'فشل');
      if (projJson.success) setProjects(projJson.data?.projects || []);
    } catch { setError('فشل تحميل البيانات'); } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleSave = async () => {
    if (!form.project_id || !form.description) { setSaveError('المشروع والوصف مطلوبان'); return; }
    setSaving(true); setSaveError('');
    try {
      const url = editingItem ? `/api/boq/${editingItem.id}` : '/api/boq';
      const method = editingItem ? 'PUT' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setEditingItem(null);
        setForm({ project_id: '', code: '', description: '', unit: 'وحدة', quantity: 0, unit_price: 0 });
        fetchData();
      } else setSaveError(json.message || 'فشل الحفظ');
    } catch (e: any) { setSaveError('خطأ في الاتصال'); } finally { setSaving(false); }
  };

  const handleEdit = async (item: any) => {
    try {
      const res = await fetch(`/api/boq/${item.id}`);
      const json = await res.json();
      if (json.success) {
        setEditingItem(item);
        setForm({
          project_id: json.data.project_id,
          code: json.data.code || '',
          description: json.data.description,
          unit: json.data.unit || 'وحدة',
          quantity: json.data.quantity,
          unit_price: json.data.unit_price,
        });
        setShowModal(true);
      }
    } catch (e) {
      console.error('Failed to load item:', e);
    }
  };

  const handleDelete = async (item: any) => {
    try {
      const res = await fetch(`/api/boq/${item.id}`, { method: 'DELETE' });
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
    { key: 'code', label: 'الرمز', sortable: true },
    { key: 'description', label: 'الوصف', sortable: true },
    { key: 'unit', label: 'الوحدة' },
    { key: 'quantity', label: 'الكمية', sortable: true },
    { key: 'unit_price', label: 'سعر الوحدة', render: (row: any) => formatCurrency(row.unit_price) },
    { key: 'total', label: 'الإجمالي', render: (row: any) => formatCurrency(row.quantity * row.unit_price) },
    { key: 'project_name', label: 'المشروع', sortable: true },
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

  if (loading) return <LoadingSkeleton variant="table" count={8} />;
  if (error) return <div className="p-6"><div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div></div>;

  return (
    <div className="space-y-6">
      <PageHeader title="جدول الكميات" description="إدارة جدول الكميات (BOQ)" actions={<Button onClick={() => { setEditingItem(null); setShowModal(true); }} leftIcon={<Plus size={18} />}>إضافة بند</Button>} />
      {items.length === 0 ? <EmptyState title="لا توجد بنود" actionLabel="إضافة بند" onAction={() => setShowModal(true)} /> : <DataTable columns={columns} data={items} searchable searchKeys={['description', 'code', 'project_name']} />}
      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setEditingItem(null); }} title={editingItem ? 'تعديل بند BOQ' : 'إضافة بند BOQ'} size="lg" footer={<div className="flex gap-2"><Button variant="ghost" onClick={() => { setShowModal(false); setEditingItem(null); }}>إلغاء</Button><Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</Button></div>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Select label="المشروع" value={form.project_id} onChange={(v) => setForm({...form, project_id: v})} options={[{ value: '', label: 'اختر مشروعاً' }, ...projects.map((p: any) => ({ value: p.id, label: p.name }))]} className="col-span-2" />
            <Input label="الرمز" value={form.code} onChange={(e) => setForm({...form, code: e.target.value})} />
            <Input label="الوحدة" value={form.unit} onChange={(e) => setForm({...form, unit: e.target.value})} placeholder="وحدة، متر، كجم" />
            <Input label="الوصف" className="col-span-2" value={form.description} onChange={(e) => setForm({...form, description: e.target.value})} />
            <Input label="الكمية" type="number" value={form.quantity} onChange={(e) => setForm({...form, quantity: parseFloat(e.target.value) || 0})} />
            <Input label="سعر الوحدة" type="number" value={form.unit_price} onChange={(e) => setForm({...form, unit_price: parseFloat(e.target.value) || 0})} />
          </div>
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
