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

export default function ClientsPage() {
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingClient, setEditingClient] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<any>({
    name: '',
    phone: '',
    email: '',
    tax_number: '',
    credit_limit: 0,
    address: '',
  });

  const handleSave = async () => {
    if (!form.name) {
      setSaveError('اسم العميل مطلوب');
      return;
    }

    setSaving(true);
    setSaveError('');
    try {
      const url = editingClient ? `/api/clients/${editingClient.id}` : '/api/clients';
      const method = editingClient ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, type: 'client' }),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setEditingClient(null);
        setForm({ name: '', phone: '', email: '', tax_number: '', credit_limit: 0, address: '' });
        window.location.reload();
      } else {
        setSaveError(json.message || 'فشل الحفظ');
      }
    } catch (e: any) {
      setSaveError('خطأ في الاتصال بالخادم');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async (client: any) => {
    try {
      const res = await fetch(`/api/clients/${client.id}`);
      const json = await res.json();
      if (json.success) {
        setEditingClient(client);
        setForm({
          name: json.data.name,
          phone: json.data.phone || '',
          email: json.data.email || '',
          tax_number: json.data.tax_number || '',
          credit_limit: json.data.credit_limit || 0,
          address: json.data.address || '',
        });
        setShowModal(true);
      }
    } catch (e) {
      console.error('Failed to load client:', e);
    }
  };

  const handleDelete = async (client: any) => {
    try {
      const res = await fetch(`/api/clients/${client.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        window.location.reload();
      } else {
        alert(json.message || 'فشل الحذف');
      }
    } catch (e) {
      alert('خطأ في الاتصال بالخادم');
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/clients');
        const json = await res.json();
        if (json.success) {
          setClients(json.data?.clients || []);
        } else {
          setError(json.message || 'فشل');
        }
      } catch {
        setError('فشل تحميل البيانات');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const columns = [
    { key: 'name', label: 'الاسم', sortable: true },
    { key: 'phone', label: 'الجوال' },
    { key: 'email', label: 'البريد الإلكتروني' },
    { key: 'tax_number', label: 'الرقم الضريبي' },
    { key: 'credit_limit', label: 'الحد الائتماني', render: (row: any) => formatCurrency(row.credit_limit) },
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
      <PageHeader
        title="العملاء"
        description="إدارة بيانات العملاء"
        actions={
          <Button onClick={() => { setEditingClient(null); setShowModal(true); }} leftIcon={<Plus size={18} />}>
            إضافة عميل
          </Button>
        }
      />

      {clients.length === 0 ? (
        <EmptyState title="لا يوجد عملاء" actionLabel="إضافة عميل" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={clients} searchable searchKeys={['name', 'phone', 'email']} />
      )}

      <Modal
        isOpen={showModal}
        onClose={() => { setShowModal(false); setEditingClient(null); }}
        title={editingClient ? `تعديل عميل: ${editingClient.name}` : 'إضافة عميل'}
        size="lg"
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => { setShowModal(false); setEditingClient(null); }}>إلغاء</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="الاسم" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} className="col-span-2" />
            <Input label="الجوال" value={form.phone} onChange={(e) => setForm({...form, phone: e.target.value})} />
            <Input label="البريد الإلكتروني" type="email" value={form.email} onChange={(e) => setForm({...form, email: e.target.value})} />
            <Input label="الرقم الضريبي" value={form.tax_number} onChange={(e) => setForm({...form, tax_number: e.target.value})} />
            <Input label="الحد الائتماني" type="number" value={form.credit_limit} onChange={(e) => setForm({...form, credit_limit: parseFloat(e.target.value) || 0})} />
            <Input label="العنوان" value={form.address} onChange={(e) => setForm({...form, address: e.target.value})} className="col-span-2" />
          </div>
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
