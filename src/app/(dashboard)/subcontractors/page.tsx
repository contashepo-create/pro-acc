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

export default function SubcontractorsPage() {
  const [subcontractors, setSubcontractors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingSubcontractor, setEditingSubcontractor] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<any>({ name: '', contact_person: '', phone: '', email: '', tax_number: '', specialty: '', notes: '' });

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch('/api/subcontractors');
      const json = await res.json();
      if (json.success) setSubcontractors(json.data?.subcontractors || []);
      else setError(json.message || 'فشل');
    } catch { setError('فشل تحميل البيانات'); } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleSave = async () => {
    if (!form.name) { setSaveError('الاسم مطلوب'); return; }
    setSaving(true); setSaveError('');
    try {
      const url = editingSubcontractor ? `/api/subcontractors/${editingSubcontractor.id}` : '/api/subcontractors';
      const method = editingSubcontractor ? 'PUT' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setEditingSubcontractor(null);
        setForm({ name: '', contact_person: '', phone: '', email: '', tax_number: '', specialty: '', notes: '' });
        fetchData();
      } else setSaveError(json.message || 'فشل الحفظ');
    } catch (e: any) { setSaveError('خطأ في الاتصال'); } finally { setSaving(false); }
  };

  const handleEdit = async (subcontractor: any) => {
    try {
      const res = await fetch(`/api/subcontractors/${subcontractor.id}`);
      const json = await res.json();
      if (json.success) {
        setEditingSubcontractor(subcontractor);
        setForm({
          name: json.data.name,
          contact_person: json.data.contact_person || '',
          phone: json.data.phone || '',
          email: json.data.email || '',
          tax_number: json.data.tax_number || '',
          specialty: json.data.specialty || '',
          notes: json.data.notes || '',
        });
        setShowModal(true);
      }
    } catch (e) {
      console.error('Failed to load subcontractor:', e);
    }
  };

  const handleDelete = async (subcontractor: any) => {
    try {
      const res = await fetch(`/api/subcontractors/${subcontractor.id}`, { method: 'DELETE' });
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
    { key: 'contact_person', label: 'شخص الاتصال' },
    { key: 'phone', label: 'الهاتف' },
    { key: 'email', label: 'البريد الإلكتروني' },
    { key: 'specialty', label: 'التخصص' },
    { key: 'tax_number', label: 'الرقم الضريبي' },
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
      <PageHeader title="مقاولو الباطن" description="إدارة مقاولي الباطن" actions={<Button onClick={() => { setEditingSubcontractor(null); setShowModal(true); }} leftIcon={<Plus size={18} />}>إضافة مقاول</Button>} />
      {subcontractors.length === 0 ? <EmptyState title="لا يوجد مقاولون" actionLabel="إضافة مقاول" onAction={() => setShowModal(true)} /> : <DataTable columns={columns} data={subcontractors} searchable searchKeys={['name', 'specialty']} />}
      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setEditingSubcontractor(null); }} title={editingSubcontractor ? `تعديل: ${editingSubcontractor.name}` : 'إضافة مقاول باطن'} size="lg" footer={<div className="flex gap-2"><Button variant="ghost" onClick={() => { setShowModal(false); setEditingSubcontractor(null); }}>إلغاء</Button><Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</Button></div>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="الاسم" className="col-span-2" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} />
            <Input label="شخص الاتصال" value={form.contact_person} onChange={(e) => setForm({...form, contact_person: e.target.value})} />
            <Input label="التخصص" value={form.specialty} onChange={(e) => setForm({...form, specialty: e.target.value})} />
            <Input label="الهاتف" value={form.phone} onChange={(e) => setForm({...form, phone: e.target.value})} />
            <Input label="البريد الإلكتروني" type="email" value={form.email} onChange={(e) => setForm({...form, email: e.target.value})} />
            <Input label="الرقم الضريبي" value={form.tax_number} onChange={(e) => setForm({...form, tax_number: e.target.value})} />
            <Input label="ملاحظات" className="col-span-2" value={form.notes} onChange={(e) => setForm({...form, notes: e.target.value})} />
          </div>
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
