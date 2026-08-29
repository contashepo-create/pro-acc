'use client';

import { useState, useEffect } from 'react';
import { ArrowLeftRight, Plus } from 'lucide-react';
import { toast } from '@/components/ui/Toast';
import { localDateISO } from '@/lib/fiscal-calendar';
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
import { useCompanyMoney } from '@/hooks/use-company-money';

interface BankRow {
  id: string;
  name: string;
  type: string;
  account_number?: string;
  opening_balance?: number;
  balance: number;
  is_active?: boolean;
}
interface BankForm { name: string; type: string; account_number: string; opening_balance: number; }

export default function BanksPage() {
  const { money } = useCompanyMoney();
  const [banks, setBanks] = useState<BankRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingBank, setEditingBank] = useState<BankRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<BankForm>({ name: '', type: 'bank', account_number: '', opening_balance: 0 });
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferSaving, setTransferSaving] = useState(false);
  const [transferError, setTransferError] = useState('');
  const [transfer, setTransfer] = useState({ from_id: '', to_id: '', amount: 0, date: localDateISO(), reason: '' });

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch('/api/banks');
      const json = await res.json();
      if (json.success) setBanks(json.data?.banks || []);
      else setError(json.message || 'فشل تحميل البيانات');
    } catch { setError('فشل تحميل البيانات - خطأ في الاتصال'); } finally { setLoading(false); }
  };

  // Initial load on mount (standard fetch pattern).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchData(); }, []);

  const handleSave = async () => {
    if (!form.name || !form.type) { setSaveError('الاسم والنوع مطلوبان'); return; }
    setSaving(true); setSaveError('');
    try {
      const url = editingBank ? `/api/banks/${editingBank.id}` : '/api/banks';
      const method = editingBank ? 'PUT' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingBank ? {
          name: form.name,
          account_number: form.account_number,
        } : {
          name: form.name,
          type: form.type,
          account_number: form.account_number,
          opening_balance: Number(form.opening_balance) || 0,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setEditingBank(null);
        setForm({ name: '', type: 'bank', account_number: '', opening_balance: 0 });
        fetchData();
      } else setSaveError(json.message || 'فشل الحفظ');
    } catch (e) { setSaveError('خطأ في الاتصال: ' + (e instanceof Error ? e.message : '')); } finally { setSaving(false); }
  };

  const handleEdit = async (bank: BankRow) => {
    try {
      const res = await fetch(`/api/banks/${bank.id}`);
      const json = await res.json();
      if (json.success) {
        setEditingBank(bank);
        setForm({
          name: json.data.name,
          type: json.data.type,
          account_number: json.data.account_number || '',
          opening_balance: json.data.opening_balance || 0,
        });
        setShowModal(true);
      }
    } catch (e) {
      console.error('Failed to load bank:', e);
    }
  };

  const handleTransfer = async () => {
    if (!transfer.from_id || !transfer.to_id) { setTransferError('اختر الخزينة المصدر والوجهة'); return; }
    if (!transfer.amount || transfer.amount <= 0) { setTransferError('يجب إدخال مبلغ صحيح'); return; }
    if (!transfer.reason.trim()) { setTransferError('سبب التحويل مطلوب'); return; }
    setTransferSaving(true); setTransferError('');
    try {
      const res = await fetch('/api/banks/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_id: transfer.from_id,
          to_id: transfer.to_id,
          amount: transfer.amount,
          date: transfer.date,
          reason: transfer.reason.trim(),
        }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success('تم التحويل بين الخزائن');
        setShowTransfer(false);
        setTransfer({ from_id: '', to_id: '', amount: 0, date: localDateISO(), reason: '' });
        fetchData();
      } else setTransferError(json.message || 'فشل التحويل');
    } catch { setTransferError('خطأ في الاتصال بالخادم'); }
    finally { setTransferSaving(false); }
  };

  const handleDelete = async (bank: BankRow) => {
    try {
      const res = await fetch(`/api/banks/${bank.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        fetchData();
      } else {
        alert(json.message || 'فشل الحذف');
      }
    } catch {
      alert('خطأ في الاتصال بالخادم');
    }
  };

  const columns = [
    { key: 'name', label: 'الاسم', sortable: true },
    { key: 'type', label: 'النوع', render: (row: BankRow) => <Badge variant={row.type === 'bank' ? 'info' : 'accent'}>{row.type === 'bank' ? 'بنك' : 'صندوق'}</Badge> },
    { key: 'account_number', label: 'رقم الحساب' },
    { key: 'opening_balance', label: 'الرصيد الافتتاحي', render: (row: BankRow) => money(row.opening_balance ?? 0) },
    { key: 'balance', label: 'الرصيد الحالي', render: (row: BankRow) => <span className={row.balance < 0 ? 'text-danger font-bold' : 'text-success font-bold'}>{money(row.balance)}</span> },
    { key: 'is_active', label: 'الحالة', render: (row: BankRow) => <Badge variant={row.is_active ? 'success' : 'danger'}>{row.is_active ? 'نشط' : 'غير نشط'}</Badge> },
    {
      key: 'statement',
      label: 'الكشف',
      render: (row: BankRow) => (
        <a
          href={`/banks/${row.id}/statement`}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs bg-sky-950/20 text-sky-400 border border-sky-800/30 hover:bg-sky-950/40"
        >
          🧾 كشف حساب
        </a>
      ),
    },
    {
      key: 'actions',
      label: 'إجراءات',
      render: (row: BankRow) => (
        <ActionButtons
          item={row}
          onEdit={handleEdit}
          onDelete={handleDelete}
          deleteMode="deactivate"
        />
      ),
    },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;
  if (error) return <div className="space-y-6"><PageHeader title="البنوك والخزائن" description="إدارة الحسابات البنكية والخزائن النقدية" actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة بنك/خزينة</Button>} /><div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div></div>;

  return (
    <div className="space-y-6">
      <PageHeader title="البنوك والخزائن" description="إدارة الحسابات البنكية والخزائن النقدية — يمكن التحويل بينها بقيد مدين الوجهة ودائن المصدر" actions={<div className="flex gap-2"><Button variant="secondary" onClick={() => { setTransferError(''); setShowTransfer(true); }} leftIcon={<ArrowLeftRight size={18} />}>تحويل بين خزائن</Button><Button onClick={() => { setEditingBank(null); setShowModal(true); }} leftIcon={<Plus size={18} />}>إضافة بنك/خزينة</Button></div>} />
      {banks.length === 0 ? <EmptyState title="لا توجد بنوك أو خزائن" actionLabel="إضافة بنك/خزينة" onAction={() => setShowModal(true)} /> : <DataTable columns={columns} data={banks} searchable searchKeys={['name', 'account_number']} />}
      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setEditingBank(null); }} title={editingBank ? `تعديل: ${editingBank.name}` : 'إضافة بنك/خزينة'} size="lg" footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => { setShowModal(false); setEditingBank(null); }}>إلغاء</Button><Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</Button></div>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="الاسم" className="col-span-2" value={form.name} onChange={(e)=>setForm({...form, name: e.target.value})} placeholder="مثلاً: البنك الأهلي - حساب رئيسي" />
          <Select label="النوع" value={form.type} disabled={!!editingBank} onChange={(value)=>setForm({...form, type: value})} options={[{ value: 'bank', label: 'بنك' }, { value: 'safe', label: 'صندوق' }]} />
          <Input label="رقم الحساب" value={form.account_number} onChange={(e)=>setForm({...form, account_number: e.target.value})} placeholder="1234567890" />
          <Input label="الرصيد الافتتاحي" type="number" disabled={!!editingBank} value={form.opening_balance} onChange={(e)=>setForm({...form, opening_balance: parseFloat(e.target.value) || 0})} placeholder="0" />
          {saveError && <div className="col-span-2 bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
      <Modal isOpen={showTransfer} onClose={() => setShowTransfer(false)} title="تحويل بين خزائن أو بنوك" size="lg" footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowTransfer(false)}>إلغاء</Button><Button onClick={handleTransfer} disabled={transferSaving}>{transferSaving ? 'جاري التحويل...' : 'تحويل'}</Button></div>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select label="من" value={transfer.from_id} onChange={(v) => setTransfer({ ...transfer, from_id: v })} options={[{ value: '', label: 'اختر المصدر' }, ...banks.filter((b) => b.is_active !== false).map((b) => ({ value: b.id, label: `${b.name} (${money(b.balance)})` }))]} />
          <Select label="إلى" value={transfer.to_id} onChange={(v) => setTransfer({ ...transfer, to_id: v })} options={[{ value: '', label: 'اختر الوجهة' }, ...banks.filter((b) => b.is_active !== false && b.id !== transfer.from_id).map((b) => ({ value: b.id, label: b.name }))]} />
          <Input label="التاريخ" type="date" value={transfer.date} onChange={(e) => setTransfer({ ...transfer, date: e.target.value })} />
          <Input label="المبلغ" type="number" value={transfer.amount} onChange={(e) => setTransfer({ ...transfer, amount: parseFloat(e.target.value) || 0 })} />
          <Input label="البيان" className="col-span-2" value={transfer.reason} onChange={(e) => setTransfer({ ...transfer, reason: e.target.value })} placeholder="سبب التحويل" />
          {transferError && <div className="col-span-2 bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{transferError}</div>}
        </div>
      </Modal>
    </div>
  );
}
