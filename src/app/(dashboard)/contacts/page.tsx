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

export default function ContactsPage() {
  const [contacts, setContacts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<any>({
    name: '',
    type: 'client',
    phone: '',
    email: '',
    tax_number: '',
    address: '',
  });

  const handleSave = async () => {
    if (!form.name) {
      setSaveError('الاسم مطلوب');
      return;
    }

    setSaving(true);
    setSaveError('');
    try {
      const res = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setForm({
          name: '',
          type: 'client',
          phone: '',
          email: '',
          tax_number: '',
          address: '',
        });
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

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/contacts');
        const json = await res.json();
        if (json.success) {
          setContacts(json.data?.contacts || []);
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
    { key: 'type', label: 'النوع', sortable: true },
    { key: 'phone', label: 'الجوال' },
    { key: 'email', label: 'البريد الإلكتروني' },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="جهات الاتصال" description="إدارة العملاء والموردين"
          actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة جهة اتصال</Button>}
        />
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="جهات الاتصال" description="إدارة العملاء والموردين"
        actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة جهة اتصال</Button>}
      />
      {contacts.length === 0 ? (
        <EmptyState title="لا توجد جهات اتصال" actionLabel="إضافة جهة اتصال" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={contacts} searchable searchKeys={['name', 'phone', 'email']} />
      )}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة جهة اتصال" footer={
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ"}</Button>
        </div>
      }>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="الاسم" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} className="col-span-2" />
            <Select
              label="النوع"
              value={form.type}
              onChange={(value) => setForm({...form, type: value})}
              options={[
                { value: 'client', label: 'عميل' },
                { value: 'supplier', label: 'مورد' },
                { value: 'subcontractor', label: 'مقاول باطن' },
                { value: 'both', label: 'عميل ومورد' },
              ]}
              className="col-span-2"
            />
            <Input label="الجوال" value={form.phone} onChange={(e) => setForm({...form, phone: e.target.value})} />
            <Input label="البريد الإلكتروني" type="email" value={form.email} onChange={(e) => setForm({...form, email: e.target.value})} />
            <Input label="الرقم الضريبي" value={form.tax_number} onChange={(e) => setForm({...form, tax_number: e.target.value})} />
            <Input label="العنوان" value={form.address} onChange={(e) => setForm({...form, address: e.target.value})} className="col-span-2" />
          </div>
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
