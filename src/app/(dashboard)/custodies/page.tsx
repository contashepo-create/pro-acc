'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
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
import { formatDate } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import { useCompanyMoney } from '@/hooks/use-company-money';
import { localDateISO } from '@/lib/fiscal-calendar';

interface CustodyRow {
  id: string;
  file_number?: string;
  employee_name?: string;
  project_name?: string;
  amount?: number;
  total_received?: number;
  total_expenses?: number;
  remaining_amount: number;
  date?: string;
  status?: string;
}
interface EmployeeOption { id: string; name: string; }
interface BankSafeOption { id: string; name: string; }
interface ProjectOption { id: string; name: string; }
interface CustodyForm {
  employee_id: string;
  amount: number;
  date: string;
  bank_safe_id: string;
  project_id: string;
  description: string;
}

export default function CustodiesPage() {
  const { money } = useCompanyMoney();
  const router = useRouter();
  const [custodies, setCustodies] = useState<CustodyRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [banks, setBanks] = useState<BankSafeOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<CustodyForm>({
    employee_id: '', amount: 0, date: localDateISO(),
    bank_safe_id: '', project_id: '', description: '',
  });

  const fetchData = async () => {
    try {
      setLoading(true); setError('');
      const [custRes, empRes, bankRes, projRes] = await Promise.all([
        fetch('/api/custodies'), fetch('/api/employees'), fetch('/api/banks?pageSize=500'), fetch('/api/projects'),
      ]);
      const [custJson, empJson, bankJson, projJson] = await Promise.all([
        custRes.json(), empRes.json(), bankRes.json(), projRes.json(),
      ]);
      if (custJson.success) setCustodies(custJson.data?.custodies || []);
      else setError(custJson.message || 'فشل');
      if (empJson.success) setEmployees(empJson.data?.employees || []);
      if (bankJson.success) setBanks(bankJson.data?.banks || []);
      if (projJson.success) setProjects(projJson.data?.projects || projJson.data || []);
    } catch { setError('فشل تحميل البيانات'); }
    finally { setLoading(false); }
  };

  // Initial load on mount (standard fetch pattern).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchData(); }, []);

  const handleSave = async () => {
    if (!form.employee_id || !form.amount || form.amount <= 0 || !form.bank_safe_id) {
      setSaveError('الموظف والمبلغ والخزينة مطلوبة');
      return;
    }
    setSaving(true); setSaveError('');
    try {
      const res = await fetch('/api/custodies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: form.employee_id,
          amount: form.amount,
          date: form.date,
          bank_safe_id: form.bank_safe_id,
          project_id: form.project_id || null,
          reason: form.description,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setForm({ employee_id: '', amount: 0, date: localDateISO(), bank_safe_id: '', project_id: '', description: '' });
        toast.success('تم فتح ملف العهدة وترحيل القيد');
        fetchData();
      } else setSaveError(json.message || 'فشل الحفظ');
    } catch { setSaveError('خطأ في الاتصال'); }
    finally { setSaving(false); }
  };

  const statusBadge = (status: string) => {
    const map: Record<string, { variant: 'success' | 'warning' | 'info' | 'danger'; label: string }> = {
      open: { variant: 'warning', label: 'مفتوحة' },
      partially_settled: { variant: 'info', label: 'مسوّاة جزئياً' },
      settled: { variant: 'success', label: 'مغلقة' },
      closed: { variant: 'success', label: 'مغلقة' },
    };
    const m = map[status] || { variant: 'warning', label: status };
    return <Badge variant={m.variant}>{m.label}</Badge>;
  };

  const columns = [
    { key: 'file_number', label: 'رقم الملف', render: (r: CustodyRow) => r.file_number || r.id?.slice(0, 8) },
    { key: 'employee_name', label: 'الموظف', sortable: true },
    { key: 'project_name', label: 'المشروع', render: (r: CustodyRow) => r.project_name || '—' },
    { key: 'amount', label: 'المستلم', render: (r: CustodyRow) => money(r.total_received ?? r.amount ?? 0) },
    { key: 'total_expenses', label: 'المصروف', render: (r: CustodyRow) => money(r.total_expenses ?? 0) },
    { key: 'remaining_amount', label: 'المتبقي', render: (r: CustodyRow) => money(r.remaining_amount) },
    { key: 'date', label: 'التاريخ', render: (r: CustodyRow) => formatDate(r.date) },
    { key: 'status', label: 'الحالة', render: (r: CustodyRow) => statusBadge(r.status ?? '') },
    {
      key: 'actions',
      label: 'إجراءات',
      render: (row: CustodyRow) => (
        <ActionButtons
          item={row}
          onView={() => router.push(`/custodies/${row.id}`)}
          onDelete={row.status === 'settled' || row.status === 'closed' ? undefined : async () => {
            if (!confirm('إلغاء الملف يعكس قيد الافتتاح. متابعة؟')) return;
            const res = await fetch(`/api/custodies/${row.id}`, { method: 'DELETE' });
            const json = await res.json();
            if (json.success) { toast.success('أُلغي الملف'); fetchData(); }
            else toast.error(json.message || 'فشل');
          }}
        />
      ),
    },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;
  if (error) return <div className="p-6"><div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div></div>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="ملفات عهد الموظفين"
        description="أكثر من ملف لنفس الموظف — التعزيز والمصروف لكل ملف على حدة دون تكرار الصرف"
        actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>فتح ملف عهدة</Button>}
      />
      {custodies.length === 0
        ? <EmptyState title="لا توجد ملفات عهد" actionLabel="فتح ملف" onAction={() => setShowModal(true)} />
        : <DataTable columns={columns} data={custodies} searchable searchKeys={['employee_name', 'file_number']} />}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="فتح ملف عهدة جديد" size="lg"
        footer={<div className="flex gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'صرف وترحيل'}</Button></div>}>
        <div className="space-y-4">
          <p className="text-xs text-text-muted">يُنشأ قيد: مدين عُهد الموظفين 1150 / دائن الخزينة. يمكن فتح أكثر من ملف لنفس الموظف.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select label="الموظف" value={form.employee_id} onChange={(v) => setForm({ ...form, employee_id: v })}
              options={[{ value: '', label: 'اختر موظفاً' }, ...employees.map((e) => ({ value: e.id, label: e.name }))]} className="col-span-2" />
            <Input label="المبلغ" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })} />
            <Input label="التاريخ" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            <Select label="الخزينة / البنك" value={form.bank_safe_id} onChange={(v) => setForm({ ...form, bank_safe_id: v })}
              options={[{ value: '', label: 'اختر المصدر' }, ...banks.map((b) => ({ value: b.id, label: b.name }))]} />
            <Select label="المشروع (اختياري — تكلفة المشروع وإلا عام للشركة)" value={form.project_id} onChange={(v) => setForm({ ...form, project_id: v })}
              options={[{ value: '', label: 'بدون مشروع — عام للشركة' }, ...(Array.isArray(projects) ? projects : []).map((p: ProjectOption) => ({ value: p.id, label: p.name }))]} />
            <Input label="الغرض" className="col-span-2" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
