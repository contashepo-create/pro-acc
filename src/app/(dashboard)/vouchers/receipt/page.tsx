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
import { formatDate, formatCurrency } from '@/lib/utils';
import { fetchRecord, applyDates, recordOrRow, toDateInput } from '@/lib/form-utils';
import { toast } from '@/components/ui/Toast';
import { PrintButton } from '@/components/ui/PrintButton';
import { formatDocumentNumber } from '@/lib/document-number';

interface ReceiptRow {
  id: string;
  number?: string;
  date?: string;
  receipt_type: string;
  contact_name?: string;
  amount: number;
  bank_name?: string;
  status?: string;
}
interface BankOption { id: string; name: string; }
interface ClientOption { id: string; name: string; }
interface ProjectOption { id: string; name: string; }
interface ReceiptForm {
  date: string;
  receipt_type: string;
  bank_safe_id: string;
  contact_id: string;
  project_id?: string;
  amount: number;
  reason: string;
  currency_code?: string;
  exchange_rate?: string;
}
interface CurrencyOption { id: string; code: string; rate: number; is_base: boolean; }

export default function ReceiptPage() {
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [banks, setBanks] = useState<BankOption[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [currencies, setCurrencies] = useState<CurrencyOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingReceipt, setEditingReceipt] = useState<ReceiptRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<ReceiptForm>({
    date: new Date().toISOString().split('T')[0],
    receipt_type: 'client',
    bank_safe_id: '',
    contact_id: '',
    amount: 0,
    reason: '',
    currency_code: '',
    exchange_rate: '',
  });

  const fetchData = useCallback(async (showSkeleton = true) => {
    try {
      if (showSkeleton) setLoading(true);
      setError('');
      const [recRes, bankRes, cliRes, projRes, curRes] = await Promise.all([
        fetch('/api/vouchers/receipt'),
        fetch('/api/banks'),
        fetch('/api/clients'),
        fetch('/api/projects'),
        fetch('/api/currencies'),
      ]);
      const [recJson, bankJson, cliJson, projJson, curJson] = await Promise.all([
        recRes.json(),
        bankRes.json(),
        cliRes.json(),
        projRes.json(),
        curRes.json(),
      ]);
      if (recJson.success) setReceipts(recJson.data?.receipts || []);
      else setError(recJson.message || 'فشل');
      if (bankJson.success) setBanks(bankJson.data?.banks || []);
      if (cliJson.success) setClients(cliJson.data?.clients || []);
      if (projJson.success) setProjects(projJson.data?.rows || projJson.data || []);
      if (curJson.success) setCurrencies(curJson.data || []);
    } catch {
      setError('فشل تحميل البيانات');
    } finally {
      if (showSkeleton) setLoading(false);
    }
  }, []);

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
        body: JSON.stringify({
          ...form,
          currency_code: form.currency_code || undefined,
          exchange_rate: form.currency_code && form.exchange_rate ? Number(form.exchange_rate) : undefined,
        }),
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
        if (json.data?.requiresApproval) {
          toast.warning(json.data.message || 'تم حفظ السند وهو بانتظار الاعتماد');
        } else {
          toast.success(editingReceipt ? 'تم تعديل سند القبض' : 'تم تسجيل سند القبض بنجاح');
        }
        await fetchData(false);
      } else {
        const reference = json.errorId ? ` (مرجع الخطأ: ${json.errorId})` : '';
        setSaveError(`${json.message || 'فشل الحفظ'}${reference}`);
      }
    } catch {
      setSaveError('خطأ في الاتصال بالخادم');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async (receipt: ReceiptRow) => {
    const { data, error } = await fetchRecord(`/api/vouchers/receipt/${receipt.id}`);
    const src = recordOrRow(data, receipt);
    if (!data && error) toast.error(error);
    setEditingReceipt(receipt);
    setForm(applyDates({
      date: toDateInput(src.date) ?? '',
      receipt_type: String(src.receipt_type ?? 'client'),
      bank_safe_id: String(src.bank_safe_id ?? ''),
      contact_id: String(src.contact_id ?? ''),
      amount: Number(src.amount) || 0,
      reason: String(src.reason ?? ''),
    }, ['date']));
    setShowModal(true);
  };

  const handleDelete = async (receipt: ReceiptRow) => {
    try {
      const res = await fetch(`/api/vouchers/receipt/${receipt.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        window.location.reload();
      } else {
        alert(json.message || 'فشل الحذف');
      }
    } catch {
      alert('خطأ في الاتصال بالخادم');
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchData();
  }, [fetchData]);

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
    { key: 'number', label: 'الرقم', sortable: true, render: (row: ReceiptRow) => formatDocumentNumber('receipt_voucher', row.number) },
    { key: 'date', label: 'التاريخ', sortable: true, render: (row: ReceiptRow) => formatDate(row.date) },
    { key: 'receipt_type', label: 'النوع', sortable: true, render: (row: ReceiptRow) => typeBadge(row.receipt_type) },
    { key: 'contact_name', label: 'الطرف', sortable: true },
    { key: 'amount', label: 'المبلغ', sortable: true, render: (row: ReceiptRow) => formatCurrency(row.amount) },
    { key: 'bank_name', label: 'الخزينة/البنك', sortable: true },
    { key: 'status', label: 'الحالة', render: (row: ReceiptRow) => (
      <Badge variant={row.status === 'approved' ? 'success' : row.status === 'rejected' ? 'danger' : 'warning'}>
        {row.status === 'approved' ? 'مؤكدة' : row.status === 'rejected' ? 'مرفوضة' : 'قيد الانتظار'}
      </Badge>
    )},
    {
      key: 'actions',
      label: 'إجراءات',
      render: (row: ReceiptRow) => (
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
              label="العملة (اختياري)"
              value={form.currency_code || ''}
              onChange={(v) => {
                const cur = currencies.find((c) => c.code === v);
                setForm({...form, currency_code: v, exchange_rate: cur ? String(cur.rate) : ''});
              }}
              options={[{ value: '', label: 'عملة الشركة' }, ...currencies.map((c) => ({ value: c.code, label: `${c.code}${c.is_base ? ' (أساسية)' : ''}` }))]}
            />
            <Input
              label="سعر الصرف"
              type="number"
              value={form.exchange_rate || ''}
              onChange={(e) => setForm({...form, exchange_rate: e.target.value})}
              placeholder="1"
            />
            <Select
              label="الخزينة/البنك"
              value={form.bank_safe_id}
              onChange={(v) => setForm({...form, bank_safe_id: v})}
              options={[{ value: '', label: 'اختر' }, ...banks.map((b) => ({ value: b.id, label: b.name }))]}
            />
            {form.receipt_type === 'client' && (
              <Select
                label="العميل (اختياري)"
                value={form.contact_id}
                onChange={(v) => setForm({...form, contact_id: v})}
                options={[{ value: '', label: 'اختر عميلاً' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
              />
            )}
            <Select
              label="المشروع (اختياري — لاحتساب أرباح المشروع)"
              value={form.project_id ?? ''}
              onChange={(v) => setForm({...form, project_id: v})}
              options={[{ value: '', label: 'بدون مشروع' }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
            />
            <Input label="المبلغ" type="number" value={form.amount} onChange={(e) => setForm({...form, amount: parseFloat(e.target.value) || 0})} />
            <Input label="البيان" value={form.reason} onChange={(e) => setForm({...form, reason: e.target.value})} placeholder="سبب القبض" className="col-span-2" />
          </div>
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    <PrintButton /></div>
  );
}
