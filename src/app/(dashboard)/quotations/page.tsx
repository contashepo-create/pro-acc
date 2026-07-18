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
import { Textarea } from '@/components/ui/Textarea';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { formatDate, formatCurrency } from '@/lib/utils';

export default function QuotationsPage() {
  const [quotations, setQuotations] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<any>({
    date: new Date().toISOString().split('T')[0],
    contact_id: '',
    notes: '',
  });

  const handleSave = async () => {
    if (!form.contact_id) {
      setSaveError('يجب اختيار عميل');
      return;
    }

    setSaving(true);
    setSaveError('');
    try {
      const res = await fetch('/api/quotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setForm({
          date: new Date().toISOString().split('T')[0],
          contact_id: '',
          notes: '',
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
        const [quotRes, clientRes] = await Promise.all([
          fetch('/api/quotations'),
          fetch('/api/clients'),
        ]);
        const [quotJson, clientJson] = await Promise.all([
          quotRes.json(),
          clientRes.json(),
        ]);
        if (quotJson.success) {
          setQuotations(quotJson.data?.quotations || []);
        } else {
          setError(quotJson.message || 'فشل تحميل البيانات');
        }
        if (clientJson.success) {
          setClients(clientJson.data?.clients || []);
        }
      } catch {
        setError('فشل تحميل البيانات');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const statusBadge = (status: string) => {
    const map: Record<string, { variant: 'success' | 'warning' | 'info' | 'danger' | 'accent'; label: string }> = {
      draft: { variant: 'warning', label: 'مسودة' },
      sent: { variant: 'info', label: 'مرسل' },
      accepted: { variant: 'success', label: 'مقبول' },
      rejected: { variant: 'danger', label: 'مرفوض' },
      converted: { variant: 'accent', label: 'محول' },
    };
    const m = map[status] || { variant: 'warning', label: status };
    return <Badge variant={m.variant}>{m.label}</Badge>;
  };

  const columns = [
    { key: 'number', label: 'الرقم', sortable: true },
    { key: 'date', label: 'التاريخ', render: (row: any) => formatDate(row.date) },
    { key: 'contact_name', label: 'العميل', sortable: true },
    { key: 'total', label: 'الإجمالي', render: (row: any) => formatCurrency(row.total) },
    { key: 'status', label: 'الحالة', render: (row: any) => statusBadge(row.status) },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="عروض الأسعار" description="إدارة عروض الأسعار"
          actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة عرض</Button>}
        />
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="عروض الأسعار" description="إدارة عروض الأسعار"
        actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة عرض</Button>}
      />
      {quotations.length === 0 ? (
        <EmptyState title="لا توجد عروض" actionLabel="إضافة عرض" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={quotations} searchable searchKeys={['contact_name', 'number']} />
      )}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة عرض سعر" footer={
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ"}</Button>
        </div>
      }>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="التاريخ"
              type="date"
              value={form.date}
              onChange={(e) => setForm({...form, date: e.target.value})}
            />
            <Select
              label="العميل"
              value={form.contact_id}
              onChange={(value) => setForm({...form, contact_id: value})}
              options={[
                { value: '', label: 'اختر عميلاً' },
                ...clients.map(c => ({ value: c.id, label: c.name })),
              ]}
            />
            <Textarea
              label="ملاحظات"
              value={form.notes}
              onChange={(e) => setForm({...form, notes: e.target.value})}
              placeholder="ملاحظات عرض السعر"
              className="col-span-2"
            />
          </div>
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
