'use client';

import { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { ActionButtons } from '@/components/ui/ActionButtons';
import { formatDate, formatCurrency } from '@/lib/utils';
import { fetchRecord, applyDates, recordOrRow, toDateInput } from '@/lib/form-utils';
import { toast } from '@/components/ui/Toast';

interface AdvanceRow {
  id: string;
  employee_name?: string;
  amount: number;
  remaining_amount?: number;
  date?: string;
  reason?: string;
  status?: string;
}
interface EmployeeOption { id: string; name: string; }
interface BankSafeOption { id: string; name: string; is_active?: boolean; }
interface AdvanceForm { employee_id: string; amount: number; date: string; reason: string; bank_safe_id: string; }

export default function EmployeeAdvancesPage() {
  const [advances, setAdvances] = useState<AdvanceRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [banks, setBanks] = useState<BankSafeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingAdvance, setEditingAdvance] = useState<AdvanceRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<AdvanceForm>({ employee_id: '', amount: 0, date: new Date().toISOString().split('T')[0], reason: '', bank_safe_id: '' });

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const [advRes, empRes, bankRes] = await Promise.all([
        fetch('/api/employee-advances'),
        fetch('/api/employees?active=true'),
        fetch('/api/banks'),
      ]);
      const [advJson, empJson, bankJson] = await Promise.all([
        advRes.json(),
        empRes.json(),
        bankRes.json(),
      ]);
      if (advJson.success) setAdvances(advJson.data?.advances || []);
      else setError(advJson.message || 'فشل');
      if (empJson.success) setEmployees(empJson.data?.employees || []);
      if (bankJson.success) setBanks((bankJson.data?.banks || []).filter((bank: BankSafeOption) => bank.is_active));
    } catch { setError('فشل تحميل البيانات'); } finally { setLoading(false); }
  };

  // Initial load on mount (standard fetch pattern).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchData(); }, []);

  const handleSave = async () => {
    if (!editingAdvance && (!form.employee_id || !form.amount || form.amount <= 0 || !form.bank_safe_id)) {
      setSaveError('الموظف والمبلغ والخزينة/البنك مطلوبة');
      return;
    }
    setSaving(true); setSaveError('');
    try {
      const url = editingAdvance ? `/api/employee-advances/${editingAdvance.id}` : '/api/employee-advances';
      const method = editingAdvance ? 'PUT' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingAdvance ? { reason: form.reason || null } : {
          employee_id: form.employee_id,
          amount: form.amount,
          date: form.date,
          reason: form.reason,
          bank_safe_id: form.bank_safe_id,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setEditingAdvance(null);
        setForm({ employee_id: '', amount: 0, date: new Date().toISOString().split('T')[0], reason: '', bank_safe_id: '' });
        fetchData();
      } else setSaveError(json.message || 'فشل الحفظ');
    } catch { setSaveError('خطأ في الاتصال'); } finally { setSaving(false); }
  };

  const handleEdit = async (advance: AdvanceRow) => {
    const { data, error } = await fetchRecord(`/api/employee-advances/${advance.id}`);
    const src = recordOrRow(data, advance);
    if (!data && error) toast.error(error);
    setEditingAdvance(advance);
    setForm(applyDates({
      employee_id: String(src.employee_id ?? ''),
      amount: Number(src.amount) || 0,
      date: toDateInput(src.date) ?? '',
      reason: String(src.reason ?? ''),
      bank_safe_id: '',
    }, ['date']));
    setShowModal(true);
  };

  const handleDelete = async (advance: AdvanceRow) => {
    try {
      const res = await fetch(`/api/employee-advances/${advance.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        toast.success('تم إلغاء السلفة وعكس قيدها');
        fetchData();
      } else {
        alert(json.message || 'فشل الحذف');
      }
    } catch {
      alert('خطأ في الاتصال بالخادم');
    }
  };

  const columns = [
    { key: 'employee_name', label: 'الموظف', sortable: true },
    { key: 'amount', label: 'المبلغ', render: (row: AdvanceRow) => formatCurrency(row.amount) },
    { key: 'remaining_amount', label: 'المتبقي', render: (row: AdvanceRow) => formatCurrency(row.remaining_amount ?? 0) },
    { key: 'date', label: 'التاريخ', render: (row: AdvanceRow) => formatDate(row.date) },
    { key: 'reason', label: 'السبب' },
    {
      key: 'actions',
      label: 'إجراءات',
      render: (row: AdvanceRow) => (
        <ActionButtons
          item={row}
          onEdit={row.status !== 'cancelled' ? handleEdit : undefined}
          onDelete={row.status !== 'cancelled' ? handleDelete : undefined}
        />
      ),
    },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;
  if (error) return <div className="p-6"><div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div></div>;

  return (
    <div className="space-y-6">
      <PageHeader title="سلف الموظفين" description="إدارة السلف المقدمة للموظفين" actions={<Button onClick={() => { setEditingAdvance(null); setShowModal(true); }} leftIcon={<Plus size={18} />}>إضافة سلفة</Button>} />
      {advances.length === 0 ? <EmptyState title="لا توجد سلف" actionLabel="إضافة سلفة" onAction={() => setShowModal(true)} /> : <DataTable columns={columns} data={advances} searchable searchKeys={['employee_name']} />}
      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setEditingAdvance(null); }} title={editingAdvance ? 'تعديل سلفة' : 'إضافة سلفة موظف'} size="lg" footer={<div className="flex gap-2"><Button variant="ghost" onClick={() => { setShowModal(false); setEditingAdvance(null); }}>إلغاء</Button><Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</Button></div>}>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select label="الموظف" value={form.employee_id} disabled={!!editingAdvance} onChange={(v) => setForm({...form, employee_id: v})} options={[{ value: '', label: 'اختر موظفاً' }, ...employees.map((e) => ({ value: e.id, label: e.name }))]} className="col-span-2" />
            <Input label="المبلغ" type="number" value={form.amount} disabled={!!editingAdvance} onChange={(e) => setForm({...form, amount: parseFloat(e.target.value) || 0})} />
            <Input label="التاريخ" type="date" value={form.date} disabled={!!editingAdvance} onChange={(e) => setForm({...form, date: e.target.value})} />
            {!editingAdvance && <Select label="الخزينة/البنك" value={form.bank_safe_id} onChange={(value) => setForm({ ...form, bank_safe_id: value })}
              options={[{ value: '', label: 'اختر مصدر الصرف' }, ...banks.map((bank) => ({ value: bank.id, label: bank.name }))]} />}

          </div>
          <Textarea label="السبب" value={form.reason} onChange={(e) => setForm({...form, reason: e.target.value})} placeholder="سبب السلفة" />
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
