'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { ActionButtons } from '@/components/ui/ActionButtons';
import { formatCurrency, formatDate } from '@/lib/utils';
import { formatDocumentNumber } from '@/lib/document-number';

type ReconciliationItem = { transactionType: string; amount: string; date: string; isCleared: boolean };
const emptyItem = (): ReconciliationItem => ({ transactionType: '', amount: '', date: '', isCleared: false });
const initialForm = () => ({ bankSafeId: '', date: new Date().toISOString().slice(0, 10), closingBalance: '', items: [emptyItem()] });

export default function BankReconciliationPage() {
  const [reconciliations, setReconciliations] = useState<any[]>([]);
  const [banks, setBanks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(initialForm());

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const [reconciliationResponse, bankResponse] = await Promise.all([
        fetch('/api/bank-reconciliation'),
        fetch('/api/banks?page_size=500'),
      ]);
      const [reconciliationJson, bankJson] = await Promise.all([reconciliationResponse.json(), bankResponse.json()]);
      if (!reconciliationJson.success) throw new Error(reconciliationJson.message || 'فشل تحميل المطابقات');
      if (!bankJson.success) throw new Error(bankJson.message || 'فشل تحميل البنوك');
      setReconciliations(reconciliationJson.data || []);
      setBanks((bankJson.data?.banks || []).filter((bank: any) => bank.is_active));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'فشل تحميل البيانات');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const updateItem = (index: number, patch: Partial<ReconciliationItem>) => {
    setForm((current) => ({ ...current, items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) }));
  };

  const handleSave = async () => {
    if (!form.bankSafeId || !form.date || form.closingBalance === '') {
      setSaveError('البنك والتاريخ والرصيد الختامي مطلوبة');
      return;
    }
    const items = form.items.filter((item) => item.transactionType.trim() || item.amount !== '' || item.date);
    if (items.some((item) => !item.transactionType.trim() || item.amount === '' || Number(item.amount) < 0)) {
      setSaveError('أكمل وصف ومبلغ كل بند مضاف');
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      const response = await fetch('/api/bank-reconciliation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bankSafeId: form.bankSafeId,
          date: form.date,
          closingBalance: Number(form.closingBalance),
          items: items.map((item) => ({
            transactionType: item.transactionType.trim(), amount: Number(item.amount),
            ...(item.date ? { date: item.date } : {}), isCleared: item.isCleared,
          })),
        }),
      });
      const json = await response.json();
      if (!json.success) throw new Error(json.message || 'فشل حفظ المطابقة');
      setShowModal(false);
      setForm(initialForm());
      await fetchData();
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'فشل حفظ المطابقة');
    } finally {
      setSaving(false);
    }
  };

  const handleComplete = async (row: any) => {
    try {
      setError('');
      const response = await fetch(`/api/bank-reconciliation/${row.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'completed' }),
      });
      const json = await response.json();
      if (!json.success) throw new Error(json.message || 'فشل إغلاق المطابقة');
      await fetchData();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'فشل إغلاق المطابقة');
    }
  };

  const handleDelete = async (row: any) => {
    try {
      setError('');
      const response = await fetch(`/api/bank-reconciliation/${row.id}`, { method: 'DELETE' });
      const json = await response.json();
      if (!json.success) throw new Error(json.message || 'فشل حذف المطابقة المعلقة');
      await fetchData();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'فشل حذف المطابقة المعلقة');
    }
  };

  const columns = [
    { key: 'number', label: 'الرقم', sortable: true, render: (row: any) => formatDocumentNumber('bank_reconciliation', row.number) },
    { key: 'bank_safe_name', label: 'البنك/الخزينة', sortable: true },
    { key: 'date', label: 'التاريخ', sortable: true, render: (row: any) => formatDate(row.date) },
    { key: 'closing_balance', label: 'الرصيد الختامي', sortable: true, render: (row: any) => formatCurrency(Number(row.closing_balance) || 0) },
    { key: 'difference', label: 'الفروقات', render: (row: any) => {
      const difference = Number(row.difference) || 0;
      return <span className={Math.abs(difference) < 0.005 ? 'text-green-600' : 'text-red-600'}>
        {Math.abs(difference) < 0.005 ? '✓ مطابق' : `${formatCurrency(difference)} غير مطابق`}
      </span>;
    } },
    { key: 'status', label: 'الحالة', render: (row: any) => row.status === 'completed'
      ? <Badge variant="success">مغلقة</Badge> : <Badge variant="warning">معلقة</Badge> },
    { key: 'actions', label: 'إجراءات', render: (row: any) => (
      <div className="flex items-center gap-2">
        {row.status === 'pending' && Math.abs(Number(row.difference) || 0) < 0.005 && (
          <Button size="sm" variant="secondary" onClick={() => handleComplete(row)}>إغلاق المطابقة</Button>
        )}
        <ActionButtons item={row} onDelete={row.status === 'pending' ? handleDelete : undefined} />
      </div>
    ) },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={6} />;

  return (
    <div className="space-y-6">
      <PageHeader title="تسوية البنوك" description="مطابقة كشوف الحساب البنكي مع القيود المحاسبية"
        actions={<Button onClick={() => { setSaveError(''); setShowModal(true); }} leftIcon={<Plus size={18} />}>تسوية جديدة</Button>} />
      {error && <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>}
      <div className="rounded-xl border border-info/30 bg-info/10 p-4 text-sm text-text-secondary">
        <strong className="text-text-primary">كيف تعمل المطابقة؟</strong> تُحفظ المطابقة أولاً بحالة «معلقة» وتظهر في الجدول أدناه. قارن رصيد كشف البنك برصيد النظام وأضف البنود المعلّقة عند الحاجة. عندما تصبح الفروقات صفراً يظهر زر «إغلاق المطابقة»؛ الإغلاق يثبت المطابقة ولا ينشئ حركة نقدية أو قيداً جديداً تلقائياً.
      </div>
      {reconciliations.length === 0 ? (
        <EmptyState title="لا توجد تسويات" actionLabel="تسوية جديدة" onAction={() => setShowModal(true)} />
      ) : <DataTable columns={columns} data={reconciliations} searchable searchKeys={['bank_safe_name']} />}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="تسوية بنكية جديدة" size="lg"
        footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ التسوية'}</Button></div>}>
        <div className="space-y-4">
          <Select label="البنك/الخزينة" value={form.bankSafeId} onChange={(value) => setForm({ ...form, bankSafeId: value })}
            options={[{ value: '', label: 'اختر' }, ...banks.map((bank) => ({ value: bank.id, label: bank.name }))]} />
          <Input label="تاريخ التسوية" type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} />
          <Input label="الرصيد الختامي حسب كشف الحساب" type="number" step="0.01" value={form.closingBalance}
            onChange={(event) => setForm({ ...form, closingBalance: event.target.value })} />
          <div className="border border-border rounded-lg p-4">
            <h3 className="font-medium mb-3">بنود كشف الحساب الاختيارية</h3>
            <div className="space-y-2">
              {form.items.map((item, index) => (
                <div key={index} className="grid grid-cols-1 sm:grid-cols-[1fr_8rem_10rem_auto] gap-2 items-end p-2 bg-bg-card rounded-lg border border-border">
                  <Input label="الوصف" value={item.transactionType} onChange={(event) => updateItem(index, { transactionType: event.target.value })} />
                  <Input label="المبلغ" type="number" min="0" step="0.01" value={item.amount} onChange={(event) => updateItem(index, { amount: event.target.value })} />
                  <Input label="التاريخ" type="date" value={item.date} onChange={(event) => updateItem(index, { date: event.target.value })} />
                  <Button variant="ghost" onClick={() => setForm((current) => ({ ...current, items: current.items.filter((_, itemIndex) => itemIndex !== index) }))} title="حذف البند"><Trash2 size={16} /></Button>
                </div>
              ))}
            </div>
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => setForm((current) => ({ ...current, items: [...current.items, emptyItem()] }))}>+ إضافة بند</Button>
          </div>
          {saveError && <div className="bg-danger/10 border border-danger/30 rounded-lg p-3 text-danger text-sm">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
