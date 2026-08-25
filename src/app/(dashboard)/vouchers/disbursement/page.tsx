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

interface DisbursementRow {
  id: string;
  number?: string;
  date?: string;
  disbursement_type: string;
  contact_name?: string;
  employee_name?: string;
  amount: number;
  bank_name?: string;
  status?: string;
}
interface BankSafeOption { id: string; name: string; }
interface ContactOption { id: string; name: string; }
interface DisbursementForm {
  date: string;
  disbursement_type: string;
  bank_safe_id: string;
  contact_id: string;
  employee_id: string;
  project_id?: string;
  amount: number;
  reason: string;
}

export default function DisbursementPage() {
  const [disbursements, setDisbursements] = useState<DisbursementRow[]>([]);
  const [banks, setBanks] = useState<BankSafeOption[]>([]);
  const [suppliers, setSuppliers] = useState<ContactOption[]>([]);
  const [employees, setEmployees] = useState<ContactOption[]>([]);
  const [projects, setProjects] = useState<ContactOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingDisbursement, setEditingDisbursement] = useState<DisbursementRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<DisbursementForm>({
    date: new Date().toISOString().split('T')[0],
    disbursement_type: 'supplier',
    bank_safe_id: '',
    contact_id: '',
    employee_id: '',
    amount: 0,
    reason: '',
  });

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const [disRes, bankRes, supRes, empRes, projRes] = await Promise.all([
        fetch('/api/vouchers/disbursement'),
        fetch('/api/banks'),
        fetch('/api/contacts?type=supplier'),
        fetch('/api/employees'),
        fetch('/api/projects'),
      ]);
      const [disJson, bankJson, supJson, empJson, projJson] = await Promise.all([
        disRes.json(),
        bankRes.json(),
        supRes.json(),
        empRes.json(),
        projRes.json(),
      ]);
      if (disJson.success) setDisbursements(disJson.data?.disbursements || []);
      else setError(disJson.message || 'فشل تحميل البيانات');
      if (bankJson.success) setBanks(bankJson.data?.banks || []);
      if (supJson.success) setSuppliers(supJson.data?.contacts || []);
      if (empJson.success) setEmployees(empJson.data?.employees || []);
      if (projJson.success) setProjects(projJson.data?.rows || projJson.data || []);
    } catch (err) {
      setError('فشل تحميل البيانات');
      console.error('Failed to fetch disbursement data:', err);
    } finally {
      setLoading(false);
    }
  };

  // Initial load on mount (standard fetch pattern).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();
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
      const url = editingDisbursement ? `/api/vouchers/disbursement/${editingDisbursement.id}` : '/api/vouchers/disbursement';
      const method = editingDisbursement ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(editingDisbursement ? 'تم تعديل السند بنجاح' : 'تم إنشاء السند بنجاح');
        setShowModal(false);
        setEditingDisbursement(null);
        setForm({
          date: new Date().toISOString().split('T')[0],
          disbursement_type: 'supplier',
          bank_safe_id: '',
          contact_id: '',
          employee_id: '',
          amount: 0,
          reason: '',
        });
        await fetchData(); // Refresh data instead of reload
      } else {
        setSaveError(json.message || 'فشل الحفظ');
        toast.error(json.message || 'فشل الحفظ');
      }
    } catch (err) {
      setSaveError('خطأ في الاتصال بالخادم');
      toast.error('خطأ في الاتصال بالخادم');
      console.error('Failed to save disbursement:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async (disbursement: DisbursementRow) => {
    const { data, error } = await fetchRecord(`/api/vouchers/disbursement/${disbursement.id}`);
    const src = recordOrRow(data, disbursement);
    if (!data && error) toast.error(error);
    setEditingDisbursement(disbursement);
    setForm(applyDates({
      date: toDateInput(src.date) ?? '',
      disbursement_type: String(src.disbursement_type ?? 'supplier'),
      bank_safe_id: String(src.bank_safe_id ?? ''),
      contact_id: String(src.contact_id ?? ''),
      employee_id: String(src.employee_id ?? ''),
      amount: Number(src.amount) || 0,
      reason: String(src.reason ?? ''),
    }, ['date']));
    setShowModal(true);
  };

  const handleDelete = async (disbursement: DisbursementRow) => {
    if (!confirm('هل أنت متأكد من حذف هذا السند؟')) return;
    
    try {
      const res = await fetch(`/api/vouchers/disbursement/${disbursement.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        toast.success('تم حذف السند بنجاح');
        await fetchData(); // Refresh data instead of reload
      } else {
        toast.error(json.message || 'فشل الحذف');
      }
    } catch (err) {
      console.error('Failed to delete disbursement:', err);
      toast.error('خطأ في الاتصال بالخادم');
    }
  };

  const typeBadge = (type: string) => {
    const map: Record<string, { variant: 'danger' | 'warning' | 'info' | 'accent'; label: string }> = {
      supplier: { variant: 'danger', label: 'مورد' },
      client_refund: { variant: 'warning', label: 'عميل' },
      employee_advance: { variant: 'info', label: 'موظف' },
      subcontractor: { variant: 'accent', label: 'مقاول باطن' },
      other: { variant: 'accent', label: 'أخرى' },
    };
    const m = map[type] || { variant: 'accent', label: type };
    return <Badge variant={m.variant}>{m.label}</Badge>;
  };

  const columns = [
    { key: 'number', label: 'الرقم', sortable: true, render: (row: DisbursementRow) => formatDocumentNumber('disbursement_voucher', row.number) },
    { key: 'date', label: 'التاريخ', sortable: true, render: (row: DisbursementRow) => formatDate(row.date) },
    { key: 'disbursement_type', label: 'النوع', sortable: true, render: (row: DisbursementRow) => typeBadge(row.disbursement_type) },
    { key: 'contact_name', label: 'المورد', sortable: true },
    { key: 'employee_name', label: 'الموظف', sortable: true },
    { key: 'amount', label: 'المبلغ', sortable: true, render: (row: DisbursementRow) => formatCurrency(row.amount) },
    { key: 'bank_name', label: 'الخزينة/البنك' },
    { key: 'status', label: 'الحالة', render: (row: DisbursementRow) => (
      <Badge variant={row.status === 'approved' ? 'success' : row.status === 'rejected' ? 'danger' : 'warning'}>
        {row.status === 'approved' ? 'مؤكدة' : row.status === 'rejected' ? 'مرفوضة' : 'قيد الانتظار'}
      </Badge>
    )},
    {
      key: 'actions',
      label: 'إجراءات',
      render: (row: DisbursementRow) => (
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
        title="سندات الصرف"
        description="تسجيل المدفوعات النقدية"
        actions={
          <Button onClick={() => { setEditingDisbursement(null); setShowModal(true); }} leftIcon={<Plus size={18} />}>
            إضافة سند صرف
          </Button>
        }
      />

      {disbursements.length === 0 ? (
        <EmptyState title="لا توجد سندات صرف" description="أضف سند صرف جديد" actionLabel="إضافة سند صرف" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={disbursements} searchable searchKeys={['number', 'contact_name', 'employee_name']} />
      )}

      <Modal
        isOpen={showModal}
        onClose={() => { setShowModal(false); setEditingDisbursement(null); }}
        title={editingDisbursement ? `تعديل سند صرف #${editingDisbursement.number}` : 'إضافة سند صرف'}
        size="lg"
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => { setShowModal(false); setEditingDisbursement(null); }}>إلغاء</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="التاريخ" type="date" value={form.date} onChange={(e) => setForm({...form, date: e.target.value})} />
            <Select
              label="نوع السند"
              value={form.disbursement_type}
              onChange={(v) => setForm({...form, disbursement_type: v})}
              options={[
                { value: 'supplier', label: 'دفعة مورد' },
                { value: 'client_refund', label: 'رد عميل' },
                { value: 'employee_advance', label: 'سلفة موظف' },
                { value: 'subcontractor', label: 'دفعة مقاول باطن' },
                { value: 'other', label: 'أخرى' },
              ]}
            />
            <Select
              label="الخزينة/البنك"
              value={form.bank_safe_id}
              onChange={(v) => setForm({...form, bank_safe_id: v})}
              options={[{ value: '', label: 'اختر' }, ...banks.map((b) => ({ value: b.id, label: b.name }))]}
              className="col-span-2"
            />
            {(form.disbursement_type === 'supplier' || form.disbursement_type === 'subcontractor') && (
              <Select
                label="المورد/المقاول (اختياري)"
                value={form.contact_id}
                onChange={(v) => setForm({...form, contact_id: v})}
                options={[{ value: '', label: 'اختر' }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))]}
                className="col-span-2"
              />
            )}
            {form.disbursement_type === 'employee_advance' && (
              <Select
                label="الموظف"
                value={form.employee_id}
                onChange={(v) => setForm({...form, employee_id: v})}
                options={[{ value: '', label: 'اختر موظفاً' }, ...employees.map((e) => ({ value: e.id, label: e.name }))]}
                className="col-span-2"
              />
            )}
            <Select
              label="المشروع (اختياري — لاحتساب تكاليف المشروع)"
              value={form.project_id ?? ''}
              onChange={(v) => setForm({...form, project_id: v})}
              options={[{ value: '', label: 'بدون مشروع' }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
            />
            <Input label="المبلغ" type="number" value={form.amount} onChange={(e) => setForm({...form, amount: parseFloat(e.target.value) || 0})} />
            <Input label="البيان" value={form.reason} onChange={(e) => setForm({...form, reason: e.target.value})} placeholder="سبب الصرف" className="col-span-2" />
          </div>
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
