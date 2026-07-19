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

export default function WarehousesPage() {
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingWarehouse, setEditingWarehouse] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<any>({ name: '', location: '' });

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch('/api/warehouses');
      const json = await res.json();
      if (json.success) setWarehouses(json.data?.warehouses || []);
      else setError(json.message || 'فشل');
    } catch { setError('فشل تحميل البيانات'); } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleSave = async () => {
    if (!form.name) { setSaveError('اسم المستودع مطلوب'); return; }
    setSaving(true); setSaveError('');
    try {
      const url = editingWarehouse ? `/api/warehouses/${editingWarehouse.id}` : '/api/warehouses';
      const method = editingWarehouse ? 'PUT' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setEditingWarehouse(null);
        setForm({ name: '', location: '' });
        fetchData();
      } else setSaveError(json.message || 'فشل الحفظ');
    } catch (e: any) { setSaveError('خطأ في الاتصال'); } finally { setSaving(false); }
  };

  const handleEdit = async (warehouse: any) => {
    try {
      const res = await fetch(`/api/warehouses/${warehouse.id}`);
      const json = await res.json();
      if (json.success) {
        setEditingWarehouse(warehouse);
        setForm({ name: json.data.name, location: json.data.location || '' });
        setShowModal(true);
      }
    } catch (e) {
      console.error('Failed to load warehouse:', e);
    }
  };

  const handleDelete = async (warehouse: any) => {
    try {
      const res = await fetch(`/api/warehouses/${warehouse.id}`, { method: 'DELETE' });
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
    { key: 'location', label: 'الموقع' },
    { key: 'is_active', label: 'الحالة', render: (row: any) => <Badge variant={row.is_active ? 'success' : 'danger'}>{row.is_active ? 'نشط' : 'غير نشط'}</Badge> },
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
      <PageHeader title="المستودعات" description="إدارة المستودعات" actions={<Button onClick={() => { setEditingWarehouse(null); setShowModal(true); }} leftIcon={<Plus size={18} />}>إضافة مستودع</Button>} />
      {warehouses.length === 0 ? <EmptyState title="لا توجد مستودعات" actionLabel="إضافة مستودع" onAction={() => setShowModal(true)} /> : <DataTable columns={columns} data={warehouses} searchable searchKeys={['name', 'location']} />}
      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setEditingWarehouse(null); }} title={editingWarehouse ? 'تعديل مستودع' : 'إضافة مستودع'} size="lg" footer={<div className="flex gap-2"><Button variant="ghost" onClick={() => { setShowModal(false); setEditingWarehouse(null); }}>إلغاء</Button><Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</Button></div>}>
        <div className="space-y-4">
          <Input label="الاسم" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} />
          <Input label="الموقع" value={form.location} onChange={(e) => setForm({...form, location: e.target.value})} />
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
