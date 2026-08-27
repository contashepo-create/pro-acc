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
import { fetchRecord, applyDates, recordOrRow, toDateInput } from '@/lib/form-utils';
import { formatDocumentNumber } from '@/lib/document-number';

interface CashTransactionRow {
  id: string;
  number?: string;
  date?: string;
  type: string;
  account_name?: string;
  amount: number;
  reason?: string;
}
interface BankSafeOption { id: string; name: string; account_id?: string; }
interface AccountOption { id: string; code: string; name: string; type?: string; is_header?: boolean; children?: AccountOption[]; }
interface ContactOption { id: string; name: string; }
interface CashForm { date: string; type: string; amount: number; account_id: string; bank_safe_id: string; contact_id: string; reason: string; }

/** Disabled option used as a visual section header inside the Select dropdown. */
function groupHeader(label: string) {
  return { value: `__hdr_${label}__`, label, disabled: true };
}

export default function CashPage() {
  const [transactions, setTransactions] = useState<CashTransactionRow[]>([]);
  const [banks, setBanks] = useState<BankSafeOption[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<CashTransactionRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [advancedAccounts, setAdvancedAccounts] = useState(false);
  const [form, setForm] = useState<CashForm>({
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
        const flatten = (nodes: AccountOption[], out: AccountOption[] = []): AccountOption[] => {
          for (const n of nodes || []) {
            if (!n.is_header) out.push(n);
            if (n.children?.length) flatten(n.children, out);
          }
          return out;
        };
        setAccounts(flatten(accJson.data?.accounts || []));
      }
      if (conJson.success) setContacts(conJson.data?.contacts || []);
    } catch {
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
      setSaveError('اختر غرض الحركة (من أين جاء المال / على ماذا صُرف) والخزينة أو البنك');
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
    } catch {
      setSaveError('خطأ في الاتصال بالخادم');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async (transaction: CashTransactionRow) => {
    const { data, error } = await fetchRecord(`/api/cash/${transaction.id}`);
    const src = recordOrRow(data, transaction);
    if (!data && error) toast.error(error);
    setEditingTransaction(transaction);
    setForm(applyDates({
      date: toDateInput(src.date) ?? '',
      type: String(src.type ?? 'receipt'),
      amount: Number(src.amount) || 0,
      account_id: String(src.account_id ?? ''),
      bank_safe_id: String(src.bank_safe_id ?? ''),
      contact_id: String(src.contact_id ?? ''),
      reason: String(src.reason ?? ''),
    }, ['date']));
    setShowModal(true);
  };

  const handleDelete = async (transaction: CashTransactionRow) => {
    try {
      const res = await fetch(`/api/cash/${transaction.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        toast.success('تم إلغاء المعاملة وعكس قيدها بنجاح');
        fetchData();
      } else {
        toast.error(json.message || 'فشل الحذف');
      }
    } catch {
      toast.error('خطأ في الاتصال بالخادم');
    }
  };

  const [typeTab, setTypeTab] = useState('all');

  // Initial load on mount (standard fetch pattern).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  // ── Simplified "purpose" picker ──────────────────────────────────────────
  // The owner thinks in purposes ("rent", "sales income"), not in GL codes.
  // We group real chart-of-accounts entries under plain-language headers.
  // The API still receives a genuine account id, so the journal entry and
  // double-entry integrity are untouched. Advanced mode exposes every account
  // with its code for accountants.
  const selectedBankAccount = banks.find((b) => b.id === form.bank_safe_id)?.account_id;
  const selectableAccounts = accounts.filter((a) => a.id !== selectedBankAccount);
  const byType = (t: string) => selectableAccounts.filter((a) => a.type === t);
  const accountLabel = (a: AccountOption) =>
    advancedAccounts ? `${a.code} - ${a.name}` : a.name;

  const accountOptions: Array<{ value: string; label: string; disabled?: boolean }> = (() => {
    const opts: Array<{ value: string; label: string; disabled?: boolean }> = [
      { value: '', label: form.type === 'receipt' ? 'اختر مصدر القبض' : 'اختر بند الصرف' },
    ];
    const pushGroup = (title: string, list: AccountOption[]) => {
      if (!list.length) return;
      opts.push(groupHeader(title));
      for (const a of list) opts.push({ value: a.id, label: accountLabel(a) });
    };
    if (form.type === 'receipt') {
      pushGroup('إيرادات النشاط (مبيعات، خدمات...)', byType('revenue'));
      pushGroup('أموال المالك / رأس المال', byType('equity'));
    } else {
      pushGroup('المصروفات (إيجار، رواتب، كهرباء...)', byType('expense'));
    }
    if (advancedAccounts) {
      const groupedIds = new Set([...byType('revenue'), ...byType('equity'), ...byType('expense')].map((a) => a.id));
      pushGroup('حسابات أخرى', selectableAccounts.filter((a) => !groupedIds.has(a.id)));
    }
    // Keep the currently-selected account visible even when its group is hidden
    // (e.g. editing an old transaction in simple mode).
    const current = selectableAccounts.find((a) => a.id === form.account_id);
    if (current && !opts.some((o) => o.value === current.id)) {
      opts.push({ value: current.id, label: `${current.code} - ${current.name}` });
    }
    return opts;
  })();

  const handleTypeChange = (nextType: string) => {
    // Switching direction invalidates a purpose picked from the opposite group.
    const currentAccount = accounts.find((a) => a.id === form.account_id);
    const mismatch =
      currentAccount &&
      ((nextType === 'receipt' && currentAccount.type !== 'revenue' && currentAccount.type !== 'equity') ||
        (nextType === 'expense' && currentAccount.type !== 'expense'));
    setForm({ ...form, type: nextType, account_id: mismatch ? '' : form.account_id });
  };

  const columns = [
    { key: 'number', label: 'الرقم', sortable: true, render: (row: CashTransactionRow) => formatDocumentNumber('cash_transaction', row.number) },
    { key: 'date', label: 'التاريخ', sortable: true, render: (row: CashTransactionRow) => formatDate(row.date) },
    { key: 'type', label: 'النوع', sortable: true, render: (row: CashTransactionRow) => typeBadge(row.type) },
    { key: 'account_name', label: 'الحساب', sortable: true },
    { key: 'amount', label: 'المبلغ', sortable: true, render: (row: CashTransactionRow) => formatCurrency(row.amount) },
    { key: 'reason', label: 'البيان', sortable: true },
    {
      key: 'actions',
      label: 'إجراءات',
      render: (row: CashTransactionRow) => (
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
              onChange={handleTypeChange}
              options={[
                { value: 'receipt', label: 'قبض (دخل أموال)' },
                { value: 'expense', label: 'صرف (خروج أموال)' },
              ]}
            />
            <Input label="المبلغ" type="number" value={form.amount} disabled={!!editingTransaction} onChange={(e) => setForm({...form, amount: parseFloat(e.target.value) || 0})} />
            <Select
              label="غرض الحركة"
              value={form.account_id}
              disabled={!!editingTransaction}
              searchable
              onChange={(v) => setForm({...form, account_id: v})}
              options={accountOptions}
            />
            <Select
              label="الخزينة/البنك"
              value={form.bank_safe_id}
              disabled={!!editingTransaction}
              onChange={(v) => setForm({...form, bank_safe_id: v})}
              options={[{ value: '', label: 'بدون' }, ...banks.map((b) => ({ value: b.id, label: b.name }))]}
            />
            <Select
              label="جهة الاتصال (اختياري)"
              value={form.contact_id}
              disabled={!!editingTransaction}
              onChange={(v) => setForm({...form, contact_id: v})}
              options={[{ value: '', label: 'بدون' }, ...contacts.map((c) => ({ value: c.id, label: c.name }))]}
            />
            <Input label="البيان" value={form.reason} onChange={(e) => setForm({...form, reason: e.target.value})} placeholder="سبب المعاملة" className="col-span-2" />
            <label className="col-span-2 flex items-center gap-2 text-xs text-text-secondary cursor-pointer select-none">
              <input type="checkbox" checked={advancedAccounts} onChange={(e) => setAdvancedAccounts(e.target.checked)} />
              وضع المحاسب — عرض دليل الحسابات كاملاً بالأكواد
            </label>
          </div>
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
