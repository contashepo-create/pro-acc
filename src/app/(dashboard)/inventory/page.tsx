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

export default function InventoryPage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<any>({ name: '', code: '', unit: '', quantity: 0, unit_price: 0, warehouse_id: '', category: '' });

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch('/api/inventory');
      const json = await res.json();
      if (json.success) setItems(json.data?.items || []);
      else setError(json.message || 'فشل');
    } catch { setError('فشل تحميل البيانات'); } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleSave = async () => {
    if (!form.name || !form.code) { setSaveError('الاسم والرمز مطلوبان'); return; }
    setSaving(true); setSaveError('');
    try {
      const url = editingItem ? `/api/inventory/${editingItem.id}` : '/api/inventory';
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
        setForm({ name: '', code: '', unit: '', quantity: 0, unit_price: 0, warehouse_id: '', category: '' });
        fetchData();
      } else setSaveError(json.message || 'فشل الحفظ');
    } catch (e: any) { setSaveError('خطأ في الاتصال'); } finally { setSaving(false); }
  };

  const handleEdit = async (item: any) => {
    try {
      const res = await fetch(`/api/inventory/${item.id}`);
      const json = await res.json();
      if (json.success) {
        setEditingItem(item);
        setForm({
          name: json.data.name,
          code: json.data.code,
          unit: json.data.unit || '',
          quantity: json.data.quantity,
          unit_price: json.data.unit_price,
          warehouse_id: json.data.warehouse_id || '',
          category: json.data.category || '',
        });
        setShowModal(true);
      }
    } catch (e) {
      console.error('Failed to load item:', e);
    }
  };

  const handleDelete = async (item: any) => {
    try {
      const res = await fetch(`/api/inventory/${item.id}`, { method: 'DELETE' });
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
    { key: 'name', label: 'الاسم', sortable: true },
    { key: 'unit', label: 'الوحدة' },
    { key: 'quantity', label: 'الكمية', sortable: true },
    { key: 'unit_price', label: 'السعر', render: (row: any) => formatCurrency(row.unit_price) },
    { key: 'category', label: 'الفئة' },
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
      <PageHeader title="المخزون" description="إدارة المخزون والأصناف" actions={<Button onClick={() => { setEditingItem(null); setShowModal(true); }} leftIcon={<Plus size={18} />}>إضافة صنف</Button>} />
      {items.length === 0 ? <EmptyState title="لا توجد أصناف" actionLabel="إضافة صنف" onAction={() => setShowModal(true)} /> : <DataTable columns={columns} data={items} searchable searchKeys={['name', 'code']} />}
      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setEditingItem(null); }} title={editingItem ? `تعديل: ${editingItem.name}` : 'إضافة صنف مخزون'} size="lg" footer={<div className="flex gap-2"><Button variant="ghost" onClick={() => { setShowModal(false); setEditingItem(null); }}>إلغاء</Button><Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</Button></div>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="الاسم" className="col-span-2" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} />
            <Input label="الرمز" value={form.code} onChange={(e) => setForm({...form, code: e.target.value})} />
            <Input label="الوحدة" value={form.unit} onChange={(e) => setForm({...form, unit: e.target.value})} placeholder="قطعة، كيلو" />
            <Input label="الكمية" type="number" value={form.quantity} onChange={(e) => setForm({...form, quantity: parseFloat(e.target.value) || 0})} />
            <Input label="السعر" type="number" value={form.unit_price} onChange={(e) => setForm({...form, unit_price: parseFloat(e.target.value) || 0})} />
            <Input label="الفئة" value={form.category} onChange={(e) => setForm({...form, category: e.target.value})} />
          </div>
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
