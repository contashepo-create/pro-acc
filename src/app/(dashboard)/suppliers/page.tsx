'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { ActionButtons } from '@/components/ui/ActionButtons';
import { Pagination } from '@/components/ui/Pagination';
import { toast } from '@/components/ui/Toast';

export default function SuppliersPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [form, setForm] = useState<any>({ name: '', phone: '', email: '', tax_number: '', notes: '' });

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch(`/api/contacts?type=supplier&page=${page}&pageSize=${pageSize}`);
      const json = await res.json();
      if (json.success) {
        setRows(json.data?.contacts || []);
        setTotal(Number(json.data?.total) || 0);
      } else { setError(json.message || 'فشل'); toast.error(json.message || 'فشل تحميل البيانات'); }
    } catch { setError('فشل تحميل البيانات'); }
    finally { setLoading(false); }
  }, [page, pageSize]);

  useEffect(() => {
    // The effect intentionally refreshes server-backed rows when pagination changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();
  }, [fetchData]);

  const handleSave = async () => {
    if (!form.name) { setSaveError('اسم المورد مطلوب'); return; }
    setSaving(true); setSaveError('');
    try {
      const url = editing ? `/api/contacts/${editing.id}` : '/api/contacts';
      const method = editing ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, type: editing?.type || 'supplier' }),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false); setEditing(null);
        setForm({ name: '', phone: '', email: '', tax_number: '', notes: '' });
        toast.success(editing ? 'تم تحديث المورد' : 'تم إضافة المورد');
        fetchData();
      } else setSaveError(json.message || 'فشل الحفظ');
    } catch { setSaveError('خطأ في الاتصال'); }
    finally { setSaving(false); }
  };

  const handleEdit = (row: any) => {
    setEditing(row);
    setForm({ name: row.name || '', phone: row.phone || '', email: row.email || '', tax_number: row.tax_number || '', notes: row.notes || '' });
    setShowModal(true);
  };

  const handleDelete = async (row: any) => {
    try {
      const res = await fetch(`/api/contacts/${row.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        toast.success('تم تعطيل المورد مع الاحتفاظ بسجله التاريخي');
        if (rows.length === 1 && page > 1) setPage((value) => value - 1);
        else fetchData();
      } else toast.error(json.message || 'فشل التعطيل');
    } catch { toast.error('خطأ في الاتصال'); }
  };

  const columns = [
    { key: 'name', label: 'اسم المورد', sortable: true },
    { key: 'phone', label: 'الجوال', render: (r: any) => <span dir="ltr">{r.phone || '—'}</span> },
    { key: 'email', label: 'البريد', render: (r: any) => <span dir="ltr">{r.email || '—'}</span> },
    { key: 'tax_number', label: 'الرقم الضريبي' },
    { key: 'notes', label: 'ملاحظات' },
    { key: 'actions', label: 'إجراءات', render: (r: any) => <ActionButtons item={r} onEdit={handleEdit} onDelete={handleDelete} deleteMode="deactivate" /> },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={6} />;
  if (error) return <div className="p-6"><div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div></div>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="الموردون"
        description="إدارة الموردين بشكل منفصل عن العملاء"
        actions={<Button onClick={() => { setEditing(null); setShowModal(true); }} leftIcon={<Plus size={18} />}>إضافة مورد</Button>}
      />
      {rows.length === 0 ? (
        <EmptyState title="لا يوجد موردون" actionLabel="إضافة مورد" onAction={() => setShowModal(true)} />
      ) : (
        <>
          <DataTable columns={columns} data={rows} searchable searchKeys={['name', 'phone', 'tax_number']} />
          <Pagination
            currentPage={page}
            totalPages={Math.max(1, Math.ceil(total / pageSize))}
            totalItems={total}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(size) => { setPage(1); setPageSize(size); }}
          />
        </>
      )}
      <Modal
        isOpen={showModal}
        onClose={() => { setShowModal(false); setEditing(null); }}
        title={editing ? `تعديل: ${editing.name}` : 'إضافة مورد جديد'}
        size="lg"
        footer={<div className="flex gap-2">
          <Button variant="ghost" onClick={() => { setShowModal(false); setEditing(null); }}>إلغاء</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</Button>
        </div>}
      >
        <div className="space-y-4">
          <Input label="اسم المورد *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="col-span-2" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="رقم الهاتف" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} dir="ltr" />
            <Input label="البريد الإلكتروني" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} dir="ltr" />
            <Input label="الرقم الضريبي" value={form.tax_number} onChange={(e) => setForm({ ...form, tax_number: e.target.value })} dir="ltr" />
          </div>
          <Textarea label="ملاحظات" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
