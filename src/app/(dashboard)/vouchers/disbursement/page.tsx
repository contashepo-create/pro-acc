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
import { Checkbox } from '@/components/ui/Checkbox';
import { toast } from '@/components/ui/Toast';
import { PrintButton } from '@/components/ui/PrintButton';
import { formatDate } from '@/lib/utils';
import { fetchRecord, applyDates, recordOrRow, toDateInput } from '@/lib/form-utils';
import { formatDocumentNumber } from '@/lib/document-number';
import { useCompanyMoney } from '@/hooks/use-company-money';
import { localDateISO } from '@/lib/fiscal-calendar';

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
interface BankSafeOption { id: string; name: string; type?: string; }
interface ContactOption { id: string; name: string; }
interface OpenInvoice { id: string; number?: string; remaining: number; }
interface DisbursementForm {
  date: string;
  disbursement_type: string;
  bank_safe_id: string;
  contact_id: string;
  employee_id: string;
  project_id: string;
  amount: number;
  reason: string;
}

const emptyForm = (): DisbursementForm => ({
  date: localDateISO(),
  disbursement_type: 'supplier',
  bank_safe_id: '',
  contact_id: '',
  employee_id: '',
  project_id: '',
  amount: 0,
  reason: '',
});

export default function DisbursementPage() {
  const { money } = useCompanyMoney();
  const [disbursements, setDisbursements] = useState<DisbursementRow[]>([]);
  const [banks, setBanks] = useState<BankSafeOption[]>([]);
  const [suppliers, setSuppliers] = useState<ContactOption[]>([]);
  const [subcontractors, setSubcontractors] = useState<ContactOption[]>([]);
  const [clients, setClients] = useState<ContactOption[]>([]);
  const [employees, setEmployees] = useState<ContactOption[]>([]);
  const [projects, setProjects] = useState<ContactOption[]>([]);
  const [openInvoices, setOpenInvoices] = useState<OpenInvoice[]>([]);
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  const [autoFifo, setAutoFifo] = useState(true);
  const [partyBalance, setPartyBalance] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingDisbursement, setEditingDisbursement] = useState<DisbursementRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<DisbursementForm>(emptyForm);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [disRes, bankRes, supRes, subRes, cliRes, empRes, projRes] = await Promise.all([
        fetch('/api/vouchers/disbursement'),
        fetch('/api/banks?pageSize=500'),
        fetch('/api/contacts?type=supplier&pageSize=500'),
        fetch('/api/contacts?type=subcontractor&pageSize=500'),
        fetch('/api/contacts?type=client&pageSize=500'),
        fetch('/api/employees'),
        fetch('/api/projects'),
      ]);
      const [disJson, bankJson, supJson, subJson, cliJson, empJson, projJson] = await Promise.all([
        disRes.json(), bankRes.json(), supRes.json(), subRes.json(), cliRes.json(), empRes.json(), projRes.json(),
      ]);
      if (disJson.success) setDisbursements(disJson.data?.disbursements || []);
      else setError(disJson.message || 'فشل تحميل البيانات');
      if (bankJson.success) setBanks(bankJson.data?.banks || []);
      if (supJson.success) setSuppliers(supJson.data?.contacts || []);
      if (subJson.success) setSubcontractors(subJson.data?.contacts || []);
      if (cliJson.success) setClients(cliJson.data?.contacts || []);
      if (empJson.success) setEmployees(empJson.data?.employees || []);
      if (projJson.success) setProjects(projJson.data?.rows || projJson.data?.projects || projJson.data || []);
    } catch (err) {
      setError('فشل تحميل البيانات');
      console.error('Failed to fetch disbursement data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPartyContext = useCallback(async (contactId: string, type: string) => {
    setOpenInvoices([]);
    setAllocations({});
    setPartyBalance('');
    if (!contactId) return;
    try {
      const [balRes, invRes] = await Promise.all([
        fetch(`/api/vouchers/contact-balance?contactId=${contactId}`),
        (type === 'supplier' || type === 'subcontractor')
          ? fetch(`/api/vouchers/unpaid-invoices?kind=purchase&contactId=${contactId}`)
          : Promise.resolve(null),
      ]);
      const balJson = await balRes.json();
      if (balJson.success && balJson.data) {
        setPartyBalance(`${balJson.data.label || ''} ${money(Number(balJson.data.balance) || 0)}`);
      }
      if (invRes) {
        const invJson = await invRes.json();
        if (invJson.success) {
          setOpenInvoices((invJson.data?.invoices || []).filter((row: OpenInvoice) => Number(row.remaining) > 0));
        }
      }
    } catch { /* اختياري */ }
  }, [money]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchData();
  }, [fetchData]);

  const handleSave = async () => {
    if (!form.bank_safe_id) { setSaveError('يجب اختيار الخزينة أو البنك'); return; }
    if (!form.amount || form.amount <= 0) { setSaveError('يجب إدخال مبلغ صحيح'); return; }
    if (!form.reason.trim()) { setSaveError('البيان مطلوب'); return; }
    if (['supplier', 'subcontractor', 'client_refund'].includes(form.disbursement_type) && !form.contact_id) {
      setSaveError('الطرف مطلوب لهذا النوع من سند الصرف');
      return;
    }
    if (form.disbursement_type === 'employee_advance' && !form.employee_id) {
      setSaveError('الموظف مطلوب لسلفة الموظف');
      return;
    }
    const invoiceItems = Object.entries(allocations)
      .filter(([, amount]) => amount > 0)
      .map(([invoice_id, amount]) => ({ invoice_id, amount: Math.round(amount * 100) / 100 }));
    if (invoiceItems.reduce((sum, item) => sum + item.amount, 0) > form.amount + 0.001) {
      setSaveError('مجموع التخصيص على الفواتير أكبر من مبلغ السند');
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
        body: JSON.stringify(editingDisbursement ? {
          date: form.date,
          amount: form.amount,
          bank_safe_id: form.bank_safe_id,
          reason: form.reason.trim(),
          contact_id: form.contact_id || null,
          employee_id: form.employee_id || null,
        } : {
          date: form.date,
          disbursement_type: form.disbursement_type,
          bank_safe_id: form.bank_safe_id,
          contact_id: form.contact_id || null,
          employee_id: form.employee_id || null,
          project_id: form.project_id || null,
          amount: form.amount,
          reason: form.reason.trim(),
          invoice_items: invoiceItems.length ? invoiceItems : undefined,
          auto_fifo: autoFifo,
        }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(editingDisbursement ? 'تم تعديل السند بنجاح' : 'تم إنشاء السند بنجاح');
        setShowModal(false);
        setEditingDisbursement(null);
        setForm(emptyForm());
        setOpenInvoices([]);
        setAllocations({});
        setAutoFifo(true);
        await fetchData();
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
    const { data, error: loadError } = await fetchRecord(`/api/vouchers/disbursement/${disbursement.id}`);
    const src = recordOrRow(data, disbursement);
    if (!data && loadError) toast.error(loadError);
    setEditingDisbursement(disbursement);
    const next = applyDates({
      date: toDateInput(src.date) ?? localDateISO(),
      disbursement_type: String(src.disbursement_type ?? 'supplier'),
      bank_safe_id: String(src.bank_safe_id ?? ''),
      contact_id: String(src.contact_id ?? ''),
      employee_id: String(src.employee_id ?? ''),
      project_id: String(src.project_id ?? ''),
      amount: Number(src.amount) || 0,
      reason: String(src.reason ?? ''),
    }, ['date']);
    setForm(next);
    setShowModal(true);
    if (next.contact_id) void loadPartyContext(next.contact_id, next.disbursement_type);
  };

  const handleDelete = async (disbursement: DisbursementRow) => {
    if (!confirm('الإلغاء ينشئ قيداً عكسياً ويبقي الأصل في الدفاتر. متابعة؟')) return;
    try {
      const res = await fetch(`/api/vouchers/disbursement/${disbursement.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        toast.success('تم عكس السند بنجاح');
        await fetchData();
      } else {
        toast.error(json.message || 'فشل الإلغاء');
      }
    } catch (err) {
      console.error('Failed to delete disbursement:', err);
      toast.error('خطأ في الاتصال بالخادم');
    }
  };

  const typeBadge = (type: string) => {
    const map: Record<string, { variant: 'danger' | 'warning' | 'info' | 'accent'; label: string }> = {
      supplier: { variant: 'danger', label: 'مورد' },
      client_refund: { variant: 'warning', label: 'رد عميل' },
      employee_advance: { variant: 'info', label: 'سلفة موظف' },
      subcontractor: { variant: 'accent', label: 'مقاول باطن' },
      other: { variant: 'accent', label: 'مصروف عام' },
    };
    const m = map[type] || { variant: 'accent', label: type };
    return <Badge variant={m.variant}>{m.label}</Badge>;
  };

  const columns = [
    { key: 'number', label: 'الرقم', sortable: true, render: (row: DisbursementRow) => formatDocumentNumber('disbursement_voucher', row.number) },
    { key: 'date', label: 'التاريخ', sortable: true, render: (row: DisbursementRow) => formatDate(row.date) },
    { key: 'disbursement_type', label: 'النوع', sortable: true, render: (row: DisbursementRow) => typeBadge(row.disbursement_type) },
    { key: 'contact_name', label: 'الطرف', sortable: true },
    { key: 'employee_name', label: 'الموظف', sortable: true },
    { key: 'amount', label: 'المبلغ', sortable: true, render: (row: DisbursementRow) => money(row.amount) },
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
        <ActionButtons item={row} onEdit={handleEdit} onDelete={handleDelete} />
      ),
    },
  ];

  const partyOptions = form.disbursement_type === 'client_refund'
    ? clients
    : form.disbursement_type === 'subcontractor'
      ? subcontractors
      : suppliers;
  const bankLabel = (bank: BankSafeOption) => bank.type === 'safe' ? `${bank.name} — خزينة` : bank.type === 'bank' ? `${bank.name} — بنك` : bank.name;

  if (loading) return <LoadingSkeleton variant="table" count={8} />;
  if (error) return <div className="p-6"><div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div></div>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="سندات الصرف"
        description="سداد مورد أو مقاول أو رد عميل أو سلفة أو مصروف عام — يُرحَّل مدين المقابل ودائن الخزينة"
        actions={
          <Button onClick={() => { setEditingDisbursement(null); setForm(emptyForm()); setOpenInvoices([]); setAllocations({}); setAutoFifo(true); setShowModal(true); }} leftIcon={<Plus size={18} />}>
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
          <p className="text-xs text-text-muted">
            دفعة المورد 2110، مقاول الباطن 2150، رد العميل 1130، سلفة الموظف 1160، وغيرها مصروف إداري 5400. المشروع اختياري لتكلفة المشروع وإلا يبقى مصروفاً عمومياً للشركة.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="التاريخ" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            <Select
              label="نوع السند"
              value={form.disbursement_type}
              onChange={(v) => {
                setForm({ ...form, disbursement_type: v, contact_id: '', employee_id: '' });
                setOpenInvoices([]);
                setAllocations({});
                setPartyBalance('');
              }}
              options={[
                { value: 'supplier', label: 'دفعة مورد' },
                { value: 'subcontractor', label: 'دفعة مقاول باطن' },
                { value: 'client_refund', label: 'رد إلى عميل' },
                { value: 'employee_advance', label: 'سلفة موظف' },
                { value: 'other', label: 'مصروف عام للشركة' },
              ]}
            />
            <Select
              label="الخزينة/البنك"
              value={form.bank_safe_id}
              onChange={(v) => setForm({ ...form, bank_safe_id: v })}
              options={[{ value: '', label: 'اختر الخزينة أو البنك' }, ...banks.map((b) => ({ value: b.id, label: bankLabel(b) }))]}
              className="col-span-2"
            />
            {['supplier', 'subcontractor', 'client_refund'].includes(form.disbursement_type) && (
              <Select
                label={form.disbursement_type === 'client_refund' ? 'العميل' : form.disbursement_type === 'subcontractor' ? 'مقاول الباطن' : 'المورد'}
                value={form.contact_id}
                onChange={(v) => {
                  setForm({ ...form, contact_id: v });
                  void loadPartyContext(v, form.disbursement_type);
                }}
                options={[{ value: '', label: 'اختر الطرف' }, ...partyOptions.map((s) => ({ value: s.id, label: s.name }))]}
                className="col-span-2"
              />
            )}
            {form.disbursement_type === 'employee_advance' && (
              <Select
                label="الموظف"
                value={form.employee_id}
                onChange={(v) => setForm({ ...form, employee_id: v })}
                options={[{ value: '', label: 'اختر موظفاً' }, ...employees.map((e) => ({ value: e.id, label: e.name }))]}
                className="col-span-2"
              />
            )}
            <Select
              label="المشروع (اختياري — تكلفة المشروع وإلا مصروف الشركة)"
              value={form.project_id}
              onChange={(v) => setForm({ ...form, project_id: v })}
              options={[{ value: '', label: 'بدون مشروع — عام للشركة' }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
            />
            <Input label="المبلغ" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })} />
            <Input label="البيان" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="سبب الصرف" className="col-span-2" />
          </div>
          {partyBalance && <p className="text-xs text-text-secondary">رصيد الطرف: {partyBalance}</p>}
          {(form.disbursement_type === 'supplier' || form.disbursement_type === 'subcontractor') && form.contact_id && !editingDisbursement && (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <Checkbox
                checked={autoFifo}
                onChange={setAutoFifo}
                label="تسوية أقدم فواتير الشراء تلقائياً إن لم تُخصص يدوياً"
              />
              {openInvoices.length === 0 ? (
                <p className="text-xs text-text-muted">لا فواتير شراء مفتوحة. المبلغ دفعة مقدمة أو على الحساب.</p>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-text-muted">تخصيص يدوي على فواتير الشراء المفتوحة (اختياري).</p>
                  {openInvoices.map((invoice) => (
                    <div key={invoice.id} className="grid grid-cols-3 gap-2 items-end">
                      <p className="col-span-2 text-xs">{invoice.number || invoice.id.slice(0, 8)} — متبقي {money(invoice.remaining)}</p>
                      <Input
                        label="التخصيص"
                        type="number"
                        value={allocations[invoice.id] ?? ''}
                        onChange={(e) => setAllocations({ ...allocations, [invoice.id]: parseFloat(e.target.value) || 0 })}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    <PrintButton /></div>
  );
}
