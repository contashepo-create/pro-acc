'use client';

import { useState, useEffect, useCallback } from 'react';
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
import { Pagination } from '@/components/ui/Pagination';

interface ContactRow {
  id: string;
  name: string;
  type: string;
  phone?: string;
  email?: string;
  tax_number?: string;
  address?: string;
}
interface ContactForm {
  name: string;
  type: string;
  phone: string;
  email: string;
  tax_number: string;
  address: string;
}

export default function ContactsPage() {
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingContact, setEditingContact] = useState<ContactRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [form, setForm] = useState<ContactForm>({ name: '', type: 'client', phone: '', email: '', tax_number: '', address: '' });

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch(`/api/contacts?page=${page}&pageSize=${pageSize}`);
      const json = await res.json();
      if (json.success) {
        setContacts(json.data?.contacts || []);
        setTotal(Number(json.data?.total) || 0);
      } else setError(json.message || 'فشل');
    } catch { setError('فشل تحميل البيانات'); } finally { setLoading(false); }
  }, [page, pageSize]);

  useEffect(() => {
    // The effect intentionally refreshes server-backed rows when pagination changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();
  }, [fetchData]);

  const handleSave = async () => {
    if (!form.name) { setSaveError('الاسم مطلوب'); return; }
    setSaving(true); setSaveError('');
    try {
      const url = editingContact ? `/api/contacts/${editingContact.id}` : '/api/contacts';
      const method = editingContact ? 'PUT' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setEditingContact(null);
        setForm({ name: '', type: 'client', phone: '', email: '', tax_number: '', address: '' });
        fetchData();
      } else setSaveError(json.message || 'فشل الحفظ');
    } catch { setSaveError('خطأ في الاتصال'); } finally { setSaving(false); }
  };

  const handleEdit = async (contact: ContactRow) => {
    try {
      const res = await fetch(`/api/contacts/${contact.id}`);
      const json = await res.json();
      if (json.success) {
        setEditingContact(contact);
        setForm({
          name: json.data.name,
          type: json.data.type,
          phone: json.data.phone || '',
          email: json.data.email || '',
          tax_number: json.data.tax_number || '',
          address: json.data.address || '',
        });
        setShowModal(true);
      }
    } catch (e) {
      console.error('Failed to load contact:', e);
    }
  };

  const handleDelete = async (contact: ContactRow) => {
    try {
      const res = await fetch(`/api/contacts/${contact.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        if (contacts.length === 1 && page > 1) setPage((value) => value - 1);
        else fetchData();
      } else {
        alert(json.message || 'فشل التعطيل');
      }
    } catch {
      alert('خطأ في الاتصال بالخادم');
    }
  };

  const typeBadge = (type: string) => {
    const map: Record<string, { variant: 'success' | 'warning' | 'info'; label: string }> = {
      client: { variant: 'success', label: 'عميل' },
      supplier: { variant: 'warning', label: 'مورد' },
      both: { variant: 'info', label: 'كلاهما' },
    };
    const m = map[type] || { variant: 'info', label: type };
    return <Badge variant={m.variant}>{m.label}</Badge>;
  };

  const columns = [
    { key: 'name', label: 'الاسم', sortable: true },
    { key: 'type', label: 'النوع', sortable: true, render: (row: ContactRow) => typeBadge(row.type) },
    { key: 'phone', label: 'الجوال' },
    { key: 'email', label: 'البريد الإلكتروني' },
    { key: 'tax_number', label: 'الرقم الضريبي' },
    {
      key: 'actions',
      label: 'إجراءات',
      render: (row: ContactRow) => (
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
      <PageHeader title="جهات الاتصال" description="إدارة العملاء والموردين" actions={<Button onClick={() => { setEditingContact(null); setShowModal(true); }} leftIcon={<Plus size={18} />}>إضافة جهة اتصال</Button>} />
      {contacts.length === 0 ? (
        <EmptyState title="لا توجد جهات اتصال" actionLabel="إضافة جهة اتصال" onAction={() => setShowModal(true)} />
      ) : (
        <>
          <DataTable columns={columns} data={contacts} searchable searchKeys={['name', 'phone', 'email']} />
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
      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setEditingContact(null); }} title={editingContact ? `تعديل: ${editingContact.name}` : 'إضافة جهة اتصال'} size="lg" footer={<div className="flex gap-2"><Button variant="ghost" onClick={() => { setShowModal(false); setEditingContact(null); }}>إلغاء</Button><Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</Button></div>}>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="الاسم" className="col-span-2" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} />
            <Select label="النوع" value={form.type} onChange={(v) => setForm({...form, type: v})} options={[{ value: 'client', label: 'عميل' }, { value: 'supplier', label: 'مورد' }, { value: 'both', label: 'كلاهما' }]} />
            <Input label="الجوال" value={form.phone} onChange={(e) => setForm({...form, phone: e.target.value})} />
            <Input label="البريد الإلكتروني" type="email" value={form.email} onChange={(e) => setForm({...form, email: e.target.value})} />
            <Input label="الرقم الضريبي" value={form.tax_number} onChange={(e) => setForm({...form, tax_number: e.target.value})} />
            <Input label="العنوان" className="col-span-2" value={form.address} onChange={(e) => setForm({...form, address: e.target.value})} />
          </div>
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
