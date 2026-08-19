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
import { toast } from '@/components/ui/Toast';
import { formatDate, formatCurrency } from '@/lib/utils';
import { fetchRecord, applyDates, recordOrRow } from '@/lib/form-utils';
import { formatDocumentNumber } from '@/lib/document-number';

export default function CashPage() {
  const [transactions, setTransactions] = useState<any[]>([]);
  const [banks, setBanks] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<any>({
    date: new Date().toISOString().split('T')[0],
    type: 'receipt',
    amount: 0,
    account_id: '',
    bank_safe_id: '',
    contact_id: '',
    reason: '',
  });

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const [txRes, bankRes, accRes, conRes] = await Promise.all([
        fetch('/api/cash'),
        fetch('/api/banks'),
        fetch('/api/accounts'),
        fetch('/api/contacts'),
      ]);
      const [txJson, bankJson, accJson, conJson] = await Promise.all([
        txRes.json(),
        bankRes.json(),
        accRes.json(),
        conRes.json(),
      ]);
      if (txJson.success) {
        setTransactions(txJson.data?.transactions || txJson.data?.rows || []);
      } else {
        setError(txJson.message || 'فشل');
        toast.error(txJson.message || 'فشل تحميل البيانات');
      }
      if (bankJson.success) setBanks(bankJson.data?.banks || []);
      if (accJson.success) {
        const flatten = (nodes: any[], out: any[] = []): any[] => {
          for (const n of nodes || []) {
            if (!n.is_header) out.push(n);
            if (n.children?.length) flatten(n.children, out);
          }
          return out;
        };
        setAccounts(flatten(accJson.data?.accounts || []));
      }
      if (conJson.success) setContacts(conJson.data?.contacts || []);
    } catch (err) {
      setError('فشل تحميل البيانات');
      toast.error('خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!form.amount || form.amount <= 0) {
      setSaveError('يجب إدخال مبلغ صحيح');
      return;
    }
    if (!editingTransaction && (!form.account_id || !form.bank_safe_id)) {
      setSaveError('يجب اختيار الحساب والخزينة/البنك');
      return;
    }
    if (!form.reason?.trim()) {
      setSaveError('بيان المعاملة مطلوب');
      return;
    }

    setSaving(true);
    setSaveError('');
    try {
      const url = editingTransaction ? `/api/cash/${editingTransaction.id}` : '/api/cash';
      const method = editingTransaction ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingTransaction ? {
          reason: form.reason.trim(),
        } : {
          date: form.date,
          type: form.type === 'receipt' || form.type === 'revenue' ? 'revenue' : 'expense',
          amount: form.amount,
          accountId: form.account_id,
          bankSafeId: form.bank_safe_id,
          contactId: form.contact_id || null,
          reason: form.reason.trim(),
        }),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setEditingTransaction(null);
        setForm({
          date: new Date().toISOString().split('T')[0],
          type: 'receipt',
          amount: 0,
          account_id: '',
          bank_safe_id: '',
          contact_id: '',
          reason: '',
        });
        toast.success(editingTransaction ? 'تم تحديث المعاملة بنجاح' : 'تم إضافة المعاملة بنجاح');
        fetchData();
      } else {
        setSaveError(json.message || 'فشل الحفظ');
      }
    } catch (e: any) {
      setSaveError('خطأ في الاتصال بالخادم');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async (transaction: any) => {
    const { data, error } = await fetchRecord(`/api/cash/${transaction.id}`);
    const src = recordOrRow(data, transaction);
    if (!data && error) toast.error(error);
    setEditingTransaction(transaction);
    setForm(applyDates({
      date: src.date,
      type: src.type || 'receipt',
      amount: src.amount || 0,
      account_id: src.account_id || '',
      bank_safe_id: src.bank_safe_id || '',
      contact_id: src.contact_id || '',
      reason: src.reason || '',
    }, ['date']));
    setShowModal(true);
  };

  const handleDelete = async (transaction: any) => {
    try {
      const res = await fetch(`/api/cash/${transaction.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        toast.success('تم إلغاء المعاملة وعكس قيدها بنجاح');
        fetchData();
      } else {
        toast.error(json.message || 'فشل الحذف');
      }
    } catch (e) {
      toast.error('خطأ في الاتصال بالخادم');
    }
  };

  const [typeTab, setTypeTab] = useState('all');

  useEffect(() => {
    fetchData();
  }, []);

  const typeBadge = (type: string) => {
    const map: Record<string, { variant: 'success' | 'danger'; label: string }> = {
      receipt: { variant: 'success', label: 'قبض' },
      revenue: { variant: 'success', label: 'قبض' },
      expense: { variant: 'danger', label: 'صرف' },
    };
    const m = map[type] || { variant: 'success', label: type };
    return <Badge variant={m.variant}>{m.label}</Badge>;
  };

  const filtered = typeTab === 'all' ? transactions : transactions.filter(t =>
    typeTab === 'receipt' ? t.type === 'receipt' || t.type === 'revenue' : t.type === typeTab,
  );
  
  const columns = [
    { key: 'number', label: 'الرقم', sortable: true, render: (row: any) => formatDocumentNumber('cash_transaction', row.number) },
    { key: 'date', label: 'التاريخ', sortable: true, render: (row: any) => formatDate(row.date) },
    { key: 'type', label: 'النوع', sortable: true, render: (row: any) => typeBadge(row.type) },
    { key: 'account_name', label: 'الحساب', sortable: true },
    { key: 'amount', label: 'المبلغ', sortable: true, render: (row: any) => formatCurrency(row.amount) },
    { key: 'reason', label: 'البيان', sortable: true },
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
        title="حركة النقدية"
        description="قبض وصرف يومي مرتبط بالخزائن والبنوك المسجّلة في دليل الحسابات"
        actions={
          <Button onClick={() => { setEditingTransaction(null); setShowModal(true); }} leftIcon={<Plus size={18} />}>
            إضافة معاملة
          </Button>
        }
      />

      <div className="flex gap-4">
        <Button variant={typeTab === 'all' ? 'primary' : 'secondary'} size="sm" onClick={() => setTypeTab('all')}>الكل</Button>
        <Button variant={typeTab === 'receipt' ? 'primary' : 'secondary'} size="sm" onClick={() => setTypeTab('receipt')}>قبض</Button>
        <Button variant={typeTab === 'expense' ? 'primary' : 'secondary'} size="sm" onClick={() => setTypeTab('expense')}>صرف</Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="لا توجد معاملات" description="أضف معاملة نقدية جديدة" actionLabel="إضافة معاملة" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={filtered} searchable searchKeys={['reason', 'account_name']} />
      )}

      <Modal
        isOpen={showModal}
        onClose={() => { setShowModal(false); setEditingTransaction(null); }}
        title={editingTransaction ? 'تعديل معاملة نقدية' : 'إضافة معاملة نقدية'}
        size="lg"
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => { setShowModal(false); setEditingTransaction(null); }}>إلغاء</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="التاريخ" type="date" value={form.date} disabled={!!editingTransaction} onChange={(e) => setForm({...form, date: e.target.value})} />
            <Select
              label="النوع"
              value={form.type}
              disabled={!!editingTransaction}
              onChange={(v) => setForm({...form, type: v})}
              options={[
                { value: 'receipt', label: 'قبض' },
                { value: 'expense', label: 'صرف' },
              ]}
            />
            <Input label="المبلغ" type="number" value={form.amount} disabled={!!editingTransaction} onChange={(e) => setForm({...form, amount: parseFloat(e.target.value) || 0})} />
            <Select
              label="الحساب المقابل (إيراد/مصروف)"
              value={form.account_id}
              disabled={!!editingTransaction}
              onChange={(v) => setForm({...form, account_id: v})}
              options={[{ value: '', label: 'اختر حساب الإيراد أو المصروف' }, ...accounts.filter((account: any) => account.id !== banks.find((bank: any) => bank.id === form.bank_safe_id)?.account_id).map((a: any) => ({ value: a.id, label: `${a.code} - ${a.name}` }))]}
            />
            <Select
              label="الخزينة/البنك"
              value={form.bank_safe_id}
              disabled={!!editingTransaction}
              onChange={(v) => setForm({...form, bank_safe_id: v})}
              options={[{ value: '', label: 'بدون' }, ...banks.map((b: any) => ({ value: b.id, label: b.name }))]}
            />
            <Select
              label="جهة الاتصال (اختياري)"
              value={form.contact_id}
              disabled={!!editingTransaction}
              onChange={(v) => setForm({...form, contact_id: v})}
              options={[{ value: '', label: 'بدون' }, ...contacts.map((c: any) => ({ value: c.id, label: c.name }))]}
            />
            <Input label="البيان" value={form.reason} onChange={(e) => setForm({...form, reason: e.target.value})} placeholder="سبب المعاملة" className="col-span-2" />
          </div>
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
