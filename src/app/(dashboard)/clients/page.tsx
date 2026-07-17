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
import { formatCurrency } from '@/lib/utils';

export default function ClientsPage() {
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<any>({"name": "", "type": "", "phone": "", "email": ""});

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    try {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setForm({});
        // Refresh data
        window.location.reload();
      } else {
        setSaveError(json.message || 'فشل الحفظ: ' + JSON.stringify(json));
      }
    } catch (e) {
      setSaveError('خطأ في الاتصال بالخادم: ' + ('خطأ'));
    } finally {
      setSaving(false);
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
          setError(json.message || 'فشل تحميل البيانات');
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
    { key: 'balance', label: 'الرصيد', sortable: true, render: (row: any) => formatCurrency(row.balance) },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={6} />;

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="العملاء" description="إدارة بيانات العملاء وأرصدتهم"
          actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة عميل</Button>}
        />
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="العملاء" description="إدارة بيانات العملاء وأرصدتهم"
        actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة عميل</Button>}
      />
      {clients.length === 0 ? (
        <EmptyState title="لا توجد عملاء" actionLabel="إضافة عميل" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={clients} searchable searchKeys={['name', 'phone']} />
      )}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة عميل" footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button onClick={handleSave} disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ"}</Button></div>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="الاسم" className="col-span-2" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} />
          <Input label="الجوال" type="tel" type="tel" value={form.phone} onChange={(e) => setForm({...form, phone: e.target.value})} />
          <Input label="البريد الإلكتروني" type="email" value={form.email} onChange={(e) => setForm({...form, email: e.target.value})} />
          <Input label="الرقم الضريبي" value={form.tax_number} onChange={(e) => setForm({...form, tax_number: e.target.value})} />
          <Input label="الحد الائتماني" type="number" value={form.credit_limit} onChange={(e) => setForm({...form, credit_limit: e.target.value})} />
          <Input label="العنوان" className="col-span-2" value={form.address} onChange={(e) => setForm({...form, address: e.target.value})} />
                  {saveError && <div className="col-span-2 bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
