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
import { formatDate } from '@/lib/utils';

export default function FiscalPage() {
  const [fiscalYears, setFiscalYears] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingYear, setEditingYear] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<any>({ name: '', start_date: '', end_date: '' });

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch('/api/fiscal');
      const json = await res.json();
      if (json.success) setFiscalYears(json.data?.fiscalYears || []);
      else setError(json.message || 'فشل');
    } catch { setError('فشل تحميل البيانات'); } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleSave = async () => {
    if (!form.name || !form.start_date || !form.end_date) {
      setSaveError('جميع الحقول مطلوبة');
      return;
    }
    setSaving(true); setSaveError('');
    try {
      const url = editingYear ? `/api/fiscal/${editingYear.id}` : '/api/fiscal';
      const method = editingYear ? 'PUT' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setEditingYear(null);
        setForm({ name: '', start_date: '', end_date: '' });
        fetchData();
      } else setSaveError(json.message || 'فشل الحفظ');
    } catch (e: any) { setSaveError('خطأ في الاتصال'); } finally { setSaving(false); }
  };

  const handleEdit = async (year: any) => {
    try {
      const res = await fetch(`/api/fiscal/${year.id}`);
      const json = await res.json();
      if (json.success) {
        setEditingYear(year);
        setForm({ name: json.data.name, start_date: json.data.start_date, end_date: json.data.end_date });
        setShowModal(true);
      }
    } catch (e) {
      console.error('Failed to load fiscal year:', e);
    }
  };

  const handleDelete = async (year: any) => {
    try {
      const res = await fetch(`/api/fiscal/${year.id}`, { method: 'DELETE' });
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
    { key: 'start_date', label: 'تاريخ البداية', render: (row: any) => formatDate(row.start_date) },
    { key: 'end_date', label: 'تاريخ النهاية', render: (row: any) => formatDate(row.end_date) },
    { key: 'status', label: 'الحالة', render: (row: any) => <Badge variant={row.status === 'open' ? 'success' : 'warning'}>{row.status === 'open' ? 'مفتوحة' : 'مقفلة'}</Badge> },
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
      <PageHeader title="السنوات المالية" description="إدارة الفترات المالية" actions={<Button onClick={() => { setEditingYear(null); setShowModal(true); }} leftIcon={<Plus size={18} />}>إضافة سنة مالية</Button>} />
      {fiscalYears.length === 0 ? <EmptyState title="لا توجد سنوات مالية" actionLabel="إضافة سنة مالية" onAction={() => setShowModal(true)} /> : <DataTable columns={columns} data={fiscalYears} searchable searchKeys={['name']} />}
      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setEditingYear(null); }} title={editingYear ? 'تعديل سنة مالية' : 'إضافة سنة مالية'} size="lg" footer={<div className="flex gap-2"><Button variant="ghost" onClick={() => { setShowModal(false); setEditingYear(null); }}>إلغاء</Button><Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</Button></div>}>
        <div className="space-y-4">
          <Input label="الاسم" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} placeholder="مثال: 2026" />
          <Input label="تاريخ البداية" type="date" value={form.start_date} onChange={(e) => setForm({...form, start_date: e.target.value})} />
          <Input label="تاريخ النهاية" type="date" value={form.end_date} onChange={(e) => setForm({...form, end_date: e.target.value})} />
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
