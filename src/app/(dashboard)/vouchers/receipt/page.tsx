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
import { ActionButtons } from '@/components/ui/ActionButtons';
import { formatDate, formatCurrency } from '@/lib/utils';

export default function ReceiptPage() {
  const [receipts, setReceipts] = useState<any[]>([]);
  const [banks, setBanks] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingReceipt, setEditingReceipt] = useState<any>(null);
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
      const url = editingReceipt ? `/api/vouchers/receipt/${editingReceipt.id}` : '/api/vouchers/receipt';
      const method = editingReceipt ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setEditingReceipt(null);
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

  const handleEdit = async (receipt: any) => {
    try {
      const res = await fetch(`/api/vouchers/receipt/${receipt.id}`);
      const json = await res.json();
      if (json.success) {
        setEditingReceipt(receipt);
        setForm({
          date: json.data.date,
          receipt_type: json.data.receipt_type,
          bank_safe_id: json.data.bank_safe_id,
          contact_id: json.data.contact_id || '',
          amount: json.data.amount,
          reason: json.data.reason || '',
        });
        setShowModal(true);
      }
    } catch (e) {
      console.error('Failed to load receipt:', e);
    }
  };

  const handleDelete = async (receipt: any) => {
    try {
      const res = await fetch(`/api/vouchers/receipt/${receipt.id}`, { method: 'DELETE' });
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
        const [recRes, bankRes, cliRes] = await Promise.all([
          fetch('/api/vouchers/receipt'),
          fetch('/api/banks'),
          fetch('/api/clients'),
        ]);
        const [recJson, bankJson, cliJson] = await Promise.all([
          recRes.json(),
          bankRes.json(),
          cliRes.json(),
        ]);
        if (recJson.success) setReceipts(recJson.data?.receipts || []);
        else setError(recJson.message || 'فشل');
        if (bankJson.success) setBanks(bankJson.data?.banks || []);
        if (cliJson.success) setClients(cliJson.data?.clients || []);
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
    const m = map[type] || { variant: 'info', label: type };
    return <Badge variant={m.variant}>{m.label}</Badge>;
  };

  const columns = [
    { key: 'number', label: 'الرقم', sortable: true },
    { key: 'date', label: 'التاريخ', sortable: true, render: (row: any) => formatDate(row.date) },
    { key: 'receipt_type', label: 'النوع', sortable: true, render: (row: any) => typeBadge(row.receipt_type) },
    { key: 'contact_name', label: 'الطرف', sortable: true },
    { key: 'amount', label: 'المبلغ', sortable: true, render: (row: any) => formatCurrency(row.amount) },
    { key: 'bank_name', label: 'الخزينة/البنك', sortable: true },
    { key: 'status', label: 'الحالة', render: (row: any) => (
      <Badge variant={row.status === 'approved' ? 'success' : row.status === 'rejected' ? 'danger' : 'warning'}>
        {row.status === 'approved' ? 'مؤكدة' : row.status === 'rejected' ? 'مرفوضة' : 'قيد الانتظار'}
      </Badge>
    )},
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
      <PageHeader
        title="سندات القبض"
        description="تسجيل المقبوضات النقدية"
        actions={
          <Button onClick={() => { setEditingReceipt(null); setShowModal(true); }} leftIcon={<Plus size={18} />}>
            إضافة سند قبض
          </Button>
        }
      />

      {receipts.length === 0 ? (
        <EmptyState title="لا توجد سندات قبض" description="أضف سند قبض جديد" actionLabel="إضافة سند قبض" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={receipts} searchable searchKeys={['number', 'contact_name']} />
      )}

      <Modal
        isOpen={showModal}
        onClose={() => { setShowModal(false); setEditingReceipt(null); }}
        title={editingReceipt ? `تعديل سند قبض #${editingReceipt.number}` : 'إضافة سند قبض'}
        size="lg"
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => { setShowModal(false); setEditingReceipt(null); }}>إلغاء</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="التاريخ" type="date" value={form.date} onChange={(e) => setForm({...form, date: e.target.value})} />
            <Select
              label="نوع السند"
              value={form.receipt_type}
              onChange={(v) => setForm({...form, receipt_type: v})}
              options={[
                { value: 'client', label: 'تحصيل من عميل' },
                { value: 'supplier_refund', label: 'استرداد من مورد' },
                { value: 'general', label: 'قبض عام' },
              ]}
            />
            <Select
              label="الخزينة/البنك"
              value={form.bank_safe_id}
              onChange={(v) => setForm({...form, bank_safe_id: v})}
              options={[{ value: '', label: 'اختر' }, ...banks.map((b: any) => ({ value: b.id, label: b.name }))]}
            />
            {form.receipt_type === 'client' && (
              <Select
                label="العميل (اختياري)"
                value={form.contact_id}
                onChange={(v) => setForm({...form, contact_id: v})}
                options={[{ value: '', label: 'اختر عميلاً' }, ...clients.map((c: any) => ({ value: c.id, label: c.name }))]}
              />
            )}
            <Input label="المبلغ" type="number" value={form.amount} onChange={(e) => setForm({...form, amount: parseFloat(e.target.value) || 0})} />
            <Input label="البيان" value={form.reason} onChange={(e) => setForm({...form, reason: e.target.value})} placeholder="سبب القبض" className="col-span-2" />
          </div>
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
