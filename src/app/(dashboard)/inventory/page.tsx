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

export default function InventoryPage() {
  const [items, setItems] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
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
      const [itemResponse, warehouseResponse] = await Promise.all([
        fetch('/api/inventory'),
        fetch('/api/warehouses'),
      ]);
      const [json, warehouseJson] = await Promise.all([itemResponse.json(), warehouseResponse.json()]);
      if (json.success) setItems(json.data?.items || []);
      else setError(json.message || 'فشل');
      if (warehouseJson.success) setWarehouses((warehouseJson.data?.warehouses || []).filter((warehouse: any) => warehouse.is_active));
    } catch { setError('فشل تحميل البيانات'); } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleSave = async () => {
    if (!form.name || !form.code || !form.unit || !form.warehouse_id) {
      setSaveError('الاسم والرمز والوحدة والمستودع مطلوبة'); return;
    }
    setSaving(true); setSaveError('');
    try {
      const url = editingItem ? `/api/inventory/${editingItem.id}` : '/api/inventory';
      const method = editingItem ? 'PUT' : 'POST';
      
      // التعديل: بيانات وصفية فقط — الكمية/السعر يتحركان بالحركات المخزنية حصراً
      const payload = editingItem
        ? { name: form.name, unit: form.unit, category: form.category || null, warehouse_id: form.warehouse_id || undefined }
        : { code: form.code, name: form.name, unit: form.unit, warehouse_id: form.warehouse_id, category: form.category || null };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
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
        alert(json.message || 'فشل التعطيل');
      }
    } catch (e) {
      alert('خطأ في الاتصال بالخادم');
    }
  };

  const columns = [
    { key: 'code', label: 'الرمز', sortable: true },
    { key: 'name', label: 'الاسم', sortable: true },
    { key: 'unit', label: 'الوحدة' },
    { key: 'warehouse_name', label: 'المستودع', sortable: true },
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
          deleteMode="deactivate"
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="الاسم" className="col-span-2" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} />
            <Input label="الرمز" value={form.code} onChange={(e) => setForm({...form, code: e.target.value})} />
            <Input label="الوحدة *" value={form.unit} onChange={(e) => setForm({...form, unit: e.target.value})} placeholder="قطعة، كيلو" />
            <Select label="المستودع *" value={form.warehouse_id} onChange={(value) => setForm({ ...form, warehouse_id: value })}
              options={[{ value: '', label: 'اختر مستودعاً' }, ...warehouses.map((warehouse: any) => ({ value: warehouse.id, label: warehouse.name }))]} />
            <Input label="الفئة" value={form.category} onChange={(e) => setForm({...form, category: e.target.value})} />
            <div className="sm:col-span-2 rounded-lg border border-info/30 bg-info/10 p-3 text-xs text-text-secondary">
              تُسجل الكمية والتكلفة من «حركات وتسوية المخزون» أو عند استلام أمر شراء؛ ولا تُدخل عند إنشاء بطاقة الصنف حتى يبقى سجل الحركة قابلاً للتدقيق.
            </div>
          </div>
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
