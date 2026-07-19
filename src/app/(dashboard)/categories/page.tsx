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
import { ActionButtons } from '@/components/ui/ActionButtons';

export default function CategoriesPage() {
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<any>({ name: '', type: 'revenue' });

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch('/api/categories');
      const json = await res.json();
      if (json.success) setCategories(json.data?.categories || []);
      else setError(json.message || 'فشل');
    } catch { setError('فشل تحميل البيانات'); } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleSave = async () => {
    if (!form.name) { setSaveError('اسم الفئة مطلوب'); return; }
    setSaving(true); setSaveError('');
    try {
      const url = editingCategory ? `/api/categories/${editingCategory.id}` : '/api/categories';
      const method = editingCategory ? 'PUT' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setEditingCategory(null);
        setForm({ name: '', type: 'revenue' });
        fetchData();
      } else setSaveError(json.message || 'فشل الحفظ');
    } catch (e: any) { setSaveError('خطأ في الاتصال'); } finally { setSaving(false); }
  };

  const handleEdit = async (category: any) => {
    try {
      const res = await fetch(`/api/categories/${category.id}`);
      const json = await res.json();
      if (json.success) {
        setEditingCategory(category);
        setForm({ name: json.data.name, type: json.data.type });
        setShowModal(true);
      }
    } catch (e) {
      console.error('Failed to load category:', e);
    }
  };

  const handleDelete = async (category: any) => {
    try {
      const res = await fetch(`/api/categories/${category.id}`, { method: 'DELETE' });
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
    { key: 'type', label: 'النوع', sortable: true, render: (row: any) => <Badge variant={row.type === 'revenue' ? 'success' : 'danger'}>{row.type === 'revenue' ? 'إيراد' : 'مصروف'}</Badge> },
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
      <PageHeader title="الفئات" description="إدارة فئات الإيرادات والمصروفات" actions={<Button onClick={() => { setEditingCategory(null); setShowModal(true); }} leftIcon={<Plus size={18} />}>إضافة فئة</Button>} />
      {categories.length === 0 ? <EmptyState title="لا توجد فئات" actionLabel="إضافة فئة" onAction={() => setShowModal(true)} /> : <DataTable columns={columns} data={categories} searchable searchKeys={['name']} />}
      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setEditingCategory(null); }} title={editingCategory ? `تعديل فئة: ${editingCategory.name}` : 'إضافة فئة'} size="lg" footer={<div className="flex gap-2"><Button variant="ghost" onClick={() => { setShowModal(false); setEditingCategory(null); }}>إلغاء</Button><Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</Button></div>}>
        <div className="space-y-4">
          <Input label="الاسم" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} />
          <Select label="النوع" value={form.type} onChange={(v) => setForm({...form, type: v})} options={[{ value: 'revenue', label: 'إيراد' }, { value: 'expense', label: 'مصروف' }]} />
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
