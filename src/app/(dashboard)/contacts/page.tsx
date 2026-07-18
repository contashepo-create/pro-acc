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

export default function ContactsPage() {
  const [contacts, setContacts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<any>({});

  const handleSave = async () => {
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
        setForm({});
        // Refresh data
        window.location.reload();
      } else {
        setSaveError(json.message || 'فشل الحفظ: ' + JSON.stringify(json));
      }
    } catch (e: any) {
      setSaveError('خطأ في الاتصال بالخادم: ' + (e.message || ''));
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
    { key: 'type', label: 'النوع', sortable: true, render: (row: any) => <Badge variant={row.type === 'client' ? 'success' : row.type === 'supplier' ? 'danger' : 'info'}>{row.type}</Badge> },
    { key: 'phone', label: 'الجوال' },
    { key: 'email', label: 'البريد' },
    { key: 'is_active', label: 'الحالة', render: (row: any) => <Badge variant={row.is_active ? 'success' : 'danger'}>{row.is_active ? 'نشط' : 'غير نشط'}</Badge> },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="جهات الاتصال" description="إدارة جهات الاتصال"
          actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة جهة اتصال</Button>}
        />
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="جهات الاتصال" description="إدارة جهات الاتصال"
        actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة جهة اتصال</Button>}
      />
      {contacts.length === 0 ? (
        <EmptyState title="لا توجد جهات اتصال" actionLabel="إضافة جهة اتصال" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={contacts} searchable searchKeys={['name', 'phone', 'email']} />
      )}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة جهة اتصال" size="lg" footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button onClick={handleSave} disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ"}</Button></div>}>
        <div className="grid grid-cols-2 gap-4">
          <Input label="الاسم" className="col-span-2" />
          <Select label="النوع" options={[{ value: 'client', label: 'عميل' }, { value: 'supplier', label: 'مورد' }, { value: 'subcontractor', label: 'مقاول باطن' }, { value: 'both', label: 'عميل ومورد' }]} />
          <Input label="الجوال" /><Input label="البريد الإلكتروني" type="email" />
          <Input label="العنوان" className="col-span-2" />
          <Input label="الرقم الضريبي" /><Input label="السجل التجاري" />
                  {saveError && <div className="col-span-2 bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
