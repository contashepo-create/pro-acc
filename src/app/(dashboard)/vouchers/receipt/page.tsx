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
import { formatDate } from '@/lib/utils';
import { fetchRecord, applyDates, recordOrRow, toDateInput } from '@/lib/form-utils';
import { toast } from '@/components/ui/Toast';
import { PrintButton } from '@/components/ui/PrintButton';
import { formatDocumentNumber } from '@/lib/document-number';
import { useCompanyMoney } from '@/hooks/use-company-money';
import { localDateISO } from '@/lib/fiscal-calendar';

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
interface BankOption { id: string; name: string; type?: string; }
interface PartyOption { id: string; name: string; }
interface ProjectOption { id: string; name: string; }
interface OpenInvoice { id: string; number?: string; date?: string; remaining: number; }
interface ReceiptForm {
  date: string;
  receipt_type: string;
  bank_safe_id: string;
  contact_id: string;
  project_id: string;
  amount: number;
  reason: string;
  currency_code?: string;
  exchange_rate?: string;
}
interface CurrencyOption { id: string; code: string; rate: number; is_base: boolean; }

const emptyForm = (): ReceiptForm => ({
  date: localDateISO(),
  receipt_type: 'client',
  bank_safe_id: '',
  contact_id: '',
  project_id: '',
  amount: 0,
  reason: '',
  currency_code: '',
  exchange_rate: '',
});

export default function ReceiptPage() {
  const { money } = useCompanyMoney();
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [banks, setBanks] = useState<BankOption[]>([]);
  const [clients, setClients] = useState<PartyOption[]>([]);
  const [suppliers, setSuppliers] = useState<PartyOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [currencies, setCurrencies] = useState<CurrencyOption[]>([]);
  const [openInvoices, setOpenInvoices] = useState<OpenInvoice[]>([]);
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  const [autoFifo, setAutoFifo] = useState(true);
  const [partyBalance, setPartyBalance] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingReceipt, setEditingReceipt] = useState<ReceiptRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<ReceiptForm>(emptyForm);

  const fetchData = useCallback(async (showSkeleton = true) => {
    try {
      if (showSkeleton) setLoading(true);
      setError('');
      const [recRes, bankRes, cliRes, supRes, projRes, curRes] = await Promise.all([
        fetch('/api/vouchers/receipt'),
        fetch('/api/banks?pageSize=500'),
        fetch('/api/contacts?type=client&pageSize=500'),
        fetch('/api/contacts?type=supplier&pageSize=500'),
        fetch('/api/projects'),
        fetch('/api/currencies'),
      ]);
      const [recJson, bankJson, cliJson, supJson, projJson, curJson] = await Promise.all([
        recRes.json(), bankRes.json(), cliRes.json(), supRes.json(), projRes.json(), curRes.json(),
      ]);
      if (recJson.success) setReceipts(recJson.data?.receipts || []);
      else setError(recJson.message || 'فشل');
      if (bankJson.success) setBanks(bankJson.data?.banks || []);
      if (cliJson.success) setClients(cliJson.data?.contacts || cliJson.data?.clients || []);
      if (supJson.success) setSuppliers(supJson.data?.contacts || []);
      if (projJson.success) setProjects(projJson.data?.rows || projJson.data?.projects || projJson.data || []);
      if (curJson.success) setCurrencies(curJson.data || []);
    } catch {
      setError('فشل تحميل البيانات');
    } finally {
      if (showSkeleton) setLoading(false);
    }
  }, []);

  const loadPartyContext = useCallback(async (contactId: string, receiptType: string) => {
    setOpenInvoices([]);
    setAllocations({});
    setPartyBalance('');
    if (!contactId) return;
    try {
      const [balRes, invRes] = await Promise.all([
        fetch(`/api/vouchers/contact-balance?contactId=${contactId}`),
        receiptType === 'client'
          ? fetch(`/api/vouchers/unpaid-invoices?contactId=${contactId}`)
          : Promise.resolve(null),
      ]);
      const balJson = await balRes.json();
      if (balJson.success && balJson.data) {
        const label = balJson.data.label || '';
        setPartyBalance(`${label} ${money(Number(balJson.data.balance) || 0)}`);
      }
      if (invRes) {
        const invJson = await invRes.json();
        if (invJson.success) {
          const list = (invJson.data?.invoices || []).filter((row: OpenInvoice) => Number(row.remaining) > 0);
          setOpenInvoices(list);
        }
      }
    } catch {
      /* الرصيد والتخصيص اختياريان للعرض */
    }
  }, [money]);

  const handleSave = async () => {
    if (!form.bank_safe_id) { setSaveError('يجب اختيار الخزينة أو البنك'); return; }
    if (!form.amount || form.amount <= 0) { setSaveError('يجب إدخال مبلغ صحيح'); return; }
    if (!form.reason.trim()) { setSaveError('البيان مطلوب'); return; }
    if ((form.receipt_type === 'client' || form.receipt_type === 'supplier_refund') && !form.contact_id) {
      setSaveError(form.receipt_type === 'client' ? 'العميل مطلوب لتحصيل الذمم' : 'المورد مطلوب لاسترداد المورد');
      return;
    }

    const invoiceItems = Object.entries(allocations)
      .filter(([, amount]) => amount > 0)
      .map(([invoice_id, amount]) => ({ invoice_id, amount: Math.round(amount * 100) / 100 }));
    const allocated = invoiceItems.reduce((sum, item) => sum + item.amount, 0);
    if (allocated > form.amount + 0.001) {
      setSaveError('مجموع التخصيص على الفواتير أكبر من مبلغ السند');
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
        body: JSON.stringify(editingReceipt ? {
          date: form.date,
          amount: form.amount,
          bank_safe_id: form.bank_safe_id,
          reason: form.reason.trim(),
          contact_id: form.contact_id || null,
        } : {
          date: form.date,
          receipt_type: form.receipt_type,
          bank_safe_id: form.bank_safe_id,
          contact_id: form.contact_id || null,
          project_id: form.project_id || null,
          amount: form.amount,
          reason: form.reason.trim(),
          currency_code: form.currency_code || undefined,
          exchange_rate: form.currency_code && form.exchange_rate ? Number(form.exchange_rate) : undefined,
          invoice_items: invoiceItems.length ? invoiceItems : undefined,
          auto_fifo: autoFifo,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setEditingReceipt(null);
        setForm(emptyForm());
        setOpenInvoices([]);
        setAllocations({});
        setAutoFifo(true);
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
    const { data, error: loadError } = await fetchRecord(`/api/vouchers/receipt/${receipt.id}`);
    const src = recordOrRow(data, receipt);
    if (!data && loadError) toast.error(loadError);
    setEditingReceipt(receipt);
    const next: ReceiptForm = applyDates({
      date: toDateInput(src.date) ?? localDateISO(),
      receipt_type: String(src.receipt_type ?? 'client'),
      bank_safe_id: String(src.bank_safe_id ?? ''),
      contact_id: String(src.contact_id ?? ''),
      project_id: String(src.project_id ?? ''),
      amount: Number(src.amount) || 0,
      reason: String(src.reason ?? ''),
      currency_code: '',
      exchange_rate: '',
    }, ['date']);
    setForm(next);
    setShowModal(true);
    if (next.contact_id) void loadPartyContext(next.contact_id, next.receipt_type);
  };

  const handleDelete = async (receipt: ReceiptRow) => {
    try {
      const res = await fetch(`/api/vouchers/receipt/${receipt.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        toast.success('تم عكس سند القبض مع الإبقاء على الأصل في الدفاتر');
        await fetchData(false);
      } else {
        toast.error(json.message || 'فشل الإلغاء');
      }
    } catch {
      toast.error('خطأ في الاتصال بالخادم');
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchData();
  }, [fetchData]);

  const typeBadge = (type: string) => {
    const map: Record<string, { variant: 'success' | 'info' | 'accent'; label: string }> = {
      client: { variant: 'success', label: 'عميل' },
      supplier_refund: { variant: 'info', label: 'استرداد مورد' },
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
    { key: 'amount', label: 'المبلغ', sortable: true, render: (row: ReceiptRow) => money(row.amount) },
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
        <ActionButtons item={row} onEdit={handleEdit} onDelete={handleDelete} />
      ),
    },
  ];

  const parties = form.receipt_type === 'supplier_refund' ? suppliers : clients;
  const bankLabel = (bank: BankOption) => bank.type === 'safe' ? `${bank.name} — خزينة` : bank.type === 'bank' ? `${bank.name} — بنك` : bank.name;

  if (loading) return <LoadingSkeleton variant="table" count={8} />;
  if (error) return <div className="p-6"><div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div></div>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="سندات القبض"
        description="تحصيل عميل أو استرداد مورد أو قبض عام — يُرحَّل مدين الخزينة ودائن الطرف، ويُربط بالمشروع إن وُجد"
        actions={
          <Button onClick={() => { setEditingReceipt(null); setForm(emptyForm()); setOpenInvoices([]); setAllocations({}); setAutoFifo(true); setShowModal(true); }} leftIcon={<Plus size={18} />}>
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
          <p className="text-xs text-text-muted">
            تحصيل العميل يخفض الذمم 1130. الاسترداد من المورد يخفض الدائنين 2110. القبض العام يُرحَّل على إيرادات أخرى 4200. المشروع اختياري: إن رُبط ظهر في ربح المشروع، وإلا بقي في نتيجة الشركة.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="التاريخ" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            <Select
              label="نوع السند"
              value={form.receipt_type}
              onChange={(v) => {
                setForm({ ...form, receipt_type: v, contact_id: '' });
                setOpenInvoices([]);
                setAllocations({});
                setPartyBalance('');
              }}
              options={[
                { value: 'client', label: 'تحصيل من عميل' },
                { value: 'supplier_refund', label: 'استرداد من مورد' },
                { value: 'general', label: 'قبض عام (إيراد آخر)' },
              ]}
            />
            <Select
              label="العملة (اختياري)"
              value={form.currency_code || ''}
              onChange={(v) => {
                const cur = currencies.find((c) => c.code === v);
                setForm({ ...form, currency_code: v, exchange_rate: cur ? String(cur.rate) : '' });
              }}
              options={[{ value: '', label: 'عملة الشركة' }, ...currencies.map((c) => ({ value: c.code, label: `${c.code}${c.is_base ? ' (أساسية)' : ''}` }))]}
            />
            <Input
              label="سعر الصرف"
              type="number"
              value={form.exchange_rate || ''}
              onChange={(e) => setForm({ ...form, exchange_rate: e.target.value })}
              placeholder="1"
            />
            <Select
              label="الخزينة/البنك"
              value={form.bank_safe_id}
              onChange={(v) => setForm({ ...form, bank_safe_id: v })}
              options={[{ value: '', label: 'اختر الخزينة أو البنك' }, ...banks.map((b) => ({ value: b.id, label: bankLabel(b) }))]}
            />
            {form.receipt_type !== 'general' && (
              <Select
                label={form.receipt_type === 'client' ? 'العميل' : 'المورد'}
                value={form.contact_id}
                onChange={(v) => {
                  setForm({ ...form, contact_id: v });
                  void loadPartyContext(v, form.receipt_type);
                }}
                options={[{ value: '', label: form.receipt_type === 'client' ? 'اختر عميلاً' : 'اختر مورداً' }, ...parties.map((c) => ({ value: c.id, label: c.name }))]}
              />
            )}
            <Select
              label="المشروع (اختياري — ربح المشروع وإلا نتيجة الشركة)"
              value={form.project_id}
              onChange={(v) => setForm({ ...form, project_id: v })}
              options={[{ value: '', label: 'بدون مشروع — عام للشركة' }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
            />
            <Input label="المبلغ" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })} />
            <Input label="البيان" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="سبب القبض" className="col-span-2" />
          </div>
          {partyBalance && <p className="text-xs text-text-secondary">رصيد الطرف: {partyBalance}</p>}
          {form.receipt_type === 'client' && form.contact_id && !editingReceipt && (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <Checkbox
                checked={autoFifo}
                onChange={setAutoFifo}
                label="تسوية أقدم فواتير العميل تلقائياً إن لم تُخصص يدوياً"
              />
              {openInvoices.length === 0 ? (
                <p className="text-xs text-text-muted">لا فواتير مفتوحة لهذا العميل. المبلغ يبقى دفعة على الحساب.</p>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-text-muted">تخصيص يدوي على الفواتير المفتوحة (اختياري). إن تُرك صفراً يُطبَّق التوزيع التلقائي أعلاه.</p>
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
