'use client';

import { useState, useEffect } from 'react';
import { Plus, Search } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { formatDate, formatCurrency } from '@/lib/utils';

export default function ReceiptPage() {
  const [receipts, setReceipts] = useState<any[]>([]);
  const [banks, setBanks] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<any>({
    date: new Date().toISOString().split('T')[0],
    receipt_type: 'client',
    bank_safe_id: '',
    contact_id: '',
    amount: 0,
    reason: '',
  });

  const handleSave = async () => {
    if (!form.bank_safe_id) {
      setSaveError('يجب اختيار الخزينة/البنك');
      return;
    }
    if (!form.amount || form.amount <= 0) {
      setSaveError('يجب إدخال مبلغ صحيح');
      return;
    }

    setSaving(true);
    setSaveError('');
    try {
      const res = await fetch('/api/vouchers/receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setForm({
          date: new Date().toISOString().split('T')[0],
          receipt_type: 'client',
          bank_safe_id: '',
          contact_id: '',
          amount: 0,
          reason: '',
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
        const [recRes, bankRes, conRes] = await Promise.all([
          fetch('/api/vouchers/receipt'),
          fetch('/api/banks'),
          fetch('/api/contacts'),
        ]);
        const [recJson, bankJson, conJson] = await Promise.all([
          recRes.json(),
          bankRes.json(),
          conRes.json(),
        ]);
        if (recJson.success) {
          setReceipts(recJson.data?.receipts || []);
        } else {
          setError(recJson.message || 'فشل تحميل البيانات');
        }
        if (bankJson.success) {
          setBanks(bankJson.data?.banks || []);
        }
        if (conJson.success) {
          setContacts(conJson.data?.contacts || []);
        }
      } catch {
        setError('فشل تحميل البيانات');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const typeBadge = (type: string) => {
    const map: Record<string, { variant: 'success' | 'info' | 'accent'; label: string }> = {
      client: { variant: 'success', label: 'عميل' },
      supplier_refund: { variant: 'info', label: 'مورد' },
      general: { variant: 'accent', label: 'عام' },
    };
    const m = map[type] || { variant: 'default' as const, label: type };
    return <Badge variant={m.variant}>{m.label}</Badge>;
  };

  const columns = [
    { key: 'number', label: 'الرقم', sortable: true },
    { key: 'date', label: 'التاريخ', sortable: true, render: (row: any) => formatDate(row.date) },
    { key: 'receipt_type', label: 'النوع', sortable: true, render: (row: any) => typeBadge(row.receipt_type) },
    { key: 'contact_name', label: 'الطرف', sortable: true },
    { key: 'amount', label: 'المبلغ', sortable: true, render: (row: any) => formatCurrency(row.amount) },
    { key: 'bank_name', label: 'الخزينة/البنك', sortable: true },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="سندات القبض" description="تسجيل المقبوضات النقدية"
          actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة سند قبض</Button>}
        />
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="سندات القبض"
        description="تسجيل المقبوضات النقدية"
        actions={
          <Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>
            إضافة سند قبض
          </Button>
        }
      />

      {receipts.length === 0 ? (
        <EmptyState title="لا توجد سندات قبض" description="أضف سند قبض جديد" actionLabel="إضافة سند قبض" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={receipts} searchable searchKeys={['number', 'contact_name']} />
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة سند قبض" size="lg" footer={
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
              label="نوع السند"
              value={form.receipt_type}
              onChange={(value) => setForm({...form, receipt_type: value})}
              options={[
                { value: 'client', label: 'تحصيل من عميل' },
                { value: 'supplier_refund', label: 'استرداد من مورد' },
                { value: 'general', label: 'قبض عام' },
              ]}
            />
            <Select
              label="الخزينة/البنك"
              value={form.bank_safe_id}
              onChange={(value) => setForm({...form, bank_safe_id: value})}
              options={[
                { value: '', label: 'اختر الخزينة/البنك' },
                ...banks.map(b => ({ value: b.id, label: `${b.name} (${b.type === 'bank' ? 'بنك' : 'صندوق'})` })),
              ]}
              className="col-span-2"
            />
            {form.receipt_type === 'client' && (
              <Select
                label="العميل"
                value={form.contact_id}
                onChange={(value) => setForm({...form, contact_id: value})}
                options={[
                  { value: '', label: 'اختر عميلاً (اختياري)' },
                  ...contacts.filter(c => c.type === 'client' || c.type === 'both').map(c => ({ value: c.id, label: c.name })),
                ]}
                className="col-span-2"
              />
            )}
            <Input
              label="المبلغ"
              type="number"
              value={form.amount}
              onChange={(e) => setForm({...form, amount: parseFloat(e.target.value) || 0})}
            />
            <Input
              label="البيان"
              value={form.reason}
              onChange={(e) => setForm({...form, reason: e.target.value})}
              placeholder="سبب القبض"
              className="col-span-2"
            />
          </div>
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
