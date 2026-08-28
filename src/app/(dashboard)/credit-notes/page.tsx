'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, FileMinus, FilePlus } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { ActionButtons } from '@/components/ui/ActionButtons';
import { toast } from '@/components/ui/Toast';
import { formatDate } from '@/lib/utils';
import { formatDocumentNumber } from '@/lib/document-number';
import { parseCompanyVatRate, vatPercentLabel } from '@/lib/company-vat';
import { companyDisplayMoney } from '@/lib/company-money';
import { localDateISO } from '@/lib/fiscal-calendar';
import { useAuthStore } from '@/store/auth-store';
import { CashSettlementFields } from '@/components/accounting/CashSettlementFields';

/**
 * الإشعارات الدائنة/المدينة — البديل النظامي عن تعديل الفاتورة.
 * فاتورة البيع غير قابلة للتعديل نهائياً (مفروض على مستوى قاعدة البيانات)،
 * وكل تخفيض يصدر كإشعار دائن (CN) وكل زيادة كإشعار مدين (DN) بمرجع الفاتورة.
 */

type NoteType = 'credit' | 'debit';

interface NoteItem { description: string; quantity: number; unit_price: number; }
interface NoteRow {
  id: string;
  number?: number;
  note_type?: NoteType;
  date?: string;
  contact_name?: string;
  invoice_number?: number | string;
  reason?: string;
  subtotal: number;
  vat_amount?: number;
  total: number;
  status?: string;
}
interface InvoiceOption { id: string; number: number; total: number; contact_id?: string; project_id?: string; status?: string; }
interface ProjectOption { id: string; name: string; }
interface ContactOption { id: string; name: string; type?: string; }
interface NoteForm {
  invoice_id: string;
  project_id: string;
  contact_id: string;
  reason: string;
  date: string;
  vat_enabled: boolean;
  items: NoteItem[];
  settlement_amount: string;
  bank_safe_id: string;
}
interface BankSafeOption { id: string; name: string; type?: string; }

const emptyForm = (): NoteForm => ({
  invoice_id: '', project_id: '', contact_id: '', reason: '',
  date: localDateISO(), vat_enabled: true,
  items: [{ description: '', quantity: 1, unit_price: 0 }],
  settlement_amount: '0',
  bank_safe_id: '',
});

export default function CreditNotesPage() {
  const { company: authCompany } = useAuthStore();
  const money = (n: number) => companyDisplayMoney(Number(n) || 0, authCompany);
  const [tab, setTab] = useState<NoteType>('credit');
  const [creditNotes, setCreditNotes] = useState<NoteRow[]>([]);
  const [debitNotes, setDebitNotes] = useState<NoteRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<NoteForm>(emptyForm());
  const [companyVatRate, setCompanyVatRate] = useState(0.15);
  const [banks, setBanks] = useState<BankSafeOption[]>([]);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [cnRes, dnRes, invRes, projRes, conRes, setRes, bankRes] = await Promise.all([
        fetch('/api/credit-notes'),
        fetch('/api/debit-notes'),
        fetch('/api/invoices'),
        fetch('/api/projects'),
        fetch('/api/contacts'),
        fetch('/api/auth/me'),
        fetch('/api/banks?pageSize=500'),
      ]);
      const [cnJson, dnJson, invJson, projJson, conJson, setJson, bankJson] = await Promise.all([
        cnRes.json(), dnRes.json(), invRes.json(), projRes.json(), conRes.json(), setRes.json(), bankRes.json(),
      ]);
      if (cnJson.success) setCreditNotes(cnJson.data?.credit_notes || []);
      else setError(cnJson.message || 'فشل');
      if (dnJson.success) setDebitNotes(dnJson.data?.debit_notes || []);
      if (invJson.success) setInvoices(invJson.data?.invoices || []);
      if (projJson.success) setProjects(projJson.data?.projects || []);
      if (conJson.success) setContacts(conJson.data?.contacts || []);
      if (setJson.success) setCompanyVatRate(parseCompanyVatRate(setJson.data?.company));
      if (bankJson.success) setBanks(bankJson.data?.banks || []);
    } catch { setError('فشل تحميل البيانات'); }
    finally { setLoading(false); }
  }, []);

  // Initial load + deep-link support (?invoice=<id>&type=credit|debit) from
  // the invoices list — opens the matching note form pre-filled.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    fetchData();
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const type = params.get('type') === 'debit' ? 'debit' : 'credit';
      const invoiceId = params.get('invoice') || '';
      if (type === 'debit') setTab('debit');
      if (invoiceId) {
        setForm((prev) => ({ ...prev, invoice_id: invoiceId }));
        setShowModal(true);
      }
    }
  }, [fetchData]);

  const notes = tab === 'credit' ? creditNotes : debitNotes;

  const handleSave = async () => {
    if (!form.reason) { setSaveError('السبب مطلوب'); return; }
    const validItems = form.items.filter((it: NoteItem) => it.description && it.quantity > 0);
    if (validItems.length === 0) { setSaveError('يجب إضافة بند'); return; }

    setSaving(true); setSaveError('');
    try {
      const endpoint = tab === 'credit' ? '/api/credit-notes' : '/api/debit-notes';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoice_id: form.invoice_id || null,
          project_id: form.invoice_id ? null : (form.project_id || null),
          contact_id: form.invoice_id ? null : (form.contact_id || null),
          reason: form.reason,
          date: form.date,
          tax_rate: form.vat_enabled ? companyVatRate : 0,
          items: validItems,
          ...(tab === 'credit'
            ? { refund_amount: Number(form.settlement_amount) || 0 }
            : { collected_amount: Number(form.settlement_amount) || 0 }),
          bank_safe_id: form.bank_safe_id || null,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setForm(emptyForm());
        toast.success(tab === 'credit' ? 'تم إنشاء الإشعار الدائن' : 'تم إنشاء الإشعار المدين');
        fetchData();
      } else setSaveError(json.message || 'فشل الحفظ');
    } catch { setSaveError('خطأ في الاتصال'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (note: NoteRow) => {
    if (!confirm('سيتم إلغاء الإشعار مع قيد عكسي. متابعة؟')) return;
    try {
      const res = await fetch(`/api/${tab === 'credit' ? 'credit-notes' : 'debit-notes'}/${note.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) { toast.success('تم إلغاء الإشعار'); fetchData(); }
      else toast.error(json.message || 'فشل الإلغاء');
    } catch { toast.error('خطأ في الاتصال'); }
  };

  const addItem = () => setForm({ ...form, items: [...form.items, { description: '', quantity: 1, unit_price: 0 }] });
  const removeItem = (i: number) => { if (form.items.length > 1) setForm({ ...form, items: form.items.filter((_o: NoteItem, idx: number) => idx !== i) }); };
  const updateItem = (i: number, field: string, value: string | number) => {
    const items = [...form.items];
    items[i] = { ...items[i], [field]: value };
    setForm({ ...form, items });
  };

  const selectedInvoice = invoices.find((inv) => inv.id === form.invoice_id);
  const subtotal = form.items.reduce((s: number, it: NoteItem) => s + (it.quantity * it.unit_price || 0), 0);
  const vatAmount = form.vat_enabled ? subtotal * companyVatRate : 0;
  const vatPct = vatPercentLabel(companyVatRate);
  const grandTotal = subtotal + vatAmount;

  // متاح الإشعار الدائن لكل فاتورة = الأصل − (الدائن المعتمد − المدين المعتمد)
  const creditedByInvoice: Record<string, number> = {};
  for (const n of [...creditNotes, ...debitNotes]) {
    if (n.status !== 'approved' || !n.invoice_number) continue;
    const inv = invoices.find((i) => String(i.number) === String(n.invoice_number));
    if (!inv) continue;
    const delta = n.note_type === 'debit' ? n.total : -n.total;
    creditedByInvoice[inv.id] = (creditedByInvoice[inv.id] || 0) + delta;
  }

  const typeLabel = tab === 'credit' ? 'الإشعار الدائن' : 'الإشعار المدين';

  const columns = [
    { key: 'number', label: 'الرقم', sortable: true, render: (row: NoteRow) => (
      <span className="inline-flex items-center gap-1">
        {row.note_type === 'debit' ? <FilePlus size={13} className="text-warning" /> : <FileMinus size={13} className="text-success" />}
        {formatDocumentNumber(row.note_type === 'debit' ? 'debit_note' : 'credit_note', row.number)}
      </span>
    ) },
    { key: 'date', label: 'التاريخ', render: (row: NoteRow) => formatDate(row.date), sortable: true },
    { key: 'contact_name', label: 'العميل', sortable: true },
    { key: 'invoice_number', label: 'الفاتورة الأصل', render: (row: NoteRow) => row.invoice_number ? formatDocumentNumber('sales_invoice', row.invoice_number) : '—' },
    { key: 'reason', label: 'السبب' },
    { key: 'vat_amount', label: 'الضريبة', render: (row: NoteRow) => money(row.vat_amount || 0) },
    { key: 'total', label: 'القيمة', render: (row: NoteRow) => money(row.total), sortable: true },
    { key: 'status', label: 'الحالة', render: (row: NoteRow) => <Badge variant={row.status === 'approved' ? 'success' : 'warning'}>{row.status === 'approved' ? 'معتمد' : row.status === 'cancelled' ? 'ملغي' : row.status}</Badge> },
    { key: 'actions', label: 'إجراءات', render: (row: NoteRow) => <ActionButtons item={row} onDelete={row.status === 'cancelled' ? undefined : handleDelete} /> },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={6} />;
  if (error) return <div className="p-6"><div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div></div>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="إشعارات دائنة ومدينة"
        description="البديل النظامي عن تعديل الفاتورة: التخفيض بإشعار دائن والزيادة بإشعار مدين"
        actions={
          <Button onClick={() => { setForm(emptyForm()); setShowModal(true); }} leftIcon={<Plus size={18} />}>
            {tab === 'credit' ? 'إشعار دائن جديد' : 'إشعار مدين جديد'}
          </Button>
        }
      />

      {/* Type switch */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTab('credit')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${tab === 'credit' ? 'bg-success/10 border-success/40 text-success' : 'border-border text-text-secondary hover:bg-bg-secondary'}`}
        >
          <FileMinus size={15} /> إشعارات دائنة ({creditNotes.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('debit')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${tab === 'debit' ? 'bg-warning/10 border-warning/40 text-warning' : 'border-border text-text-secondary hover:bg-bg-secondary'}`}
        >
          <FilePlus size={15} /> إشعارات مدينة ({debitNotes.length})
        </button>
      </div>

      {notes.length === 0 ? (
        <EmptyState
          title={tab === 'credit' ? 'لا توجد إشعارات دائنة' : 'لا توجد إشعارات مدينة'}
          description="الفواتير غير قابلة للتعديل بعد الإصدار — أي تصحيح يتم عبر هذه الإشعارات"
          actionLabel={tab === 'credit' ? 'إنشاء إشعار دائن' : 'إنشاء إشعار مدين'}
          onAction={() => { setForm(emptyForm()); setShowModal(true); }}
        />
      ) : (
        <DataTable columns={columns} data={notes} searchable searchKeys={['number', 'contact_name', 'reason', 'invoice_number']} />
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={tab === 'credit' ? 'إشعار دائن جديد (تخفيض)' : 'إشعار مدين جديد (زيادة)'} size="xl"
        footer={<div className="flex gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button onClick={handleSave} disabled={saving}>{saving ? 'جاري...' : 'حفظ'}</Button></div>}>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="التاريخ" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            <Select
              label="الفاتورة الأصل"
              value={form.invoice_id}
              onChange={(v) => setForm({ ...form, invoice_id: v })}
              options={[
                { value: '', label: '— بدون فاتورة —' },
                ...invoices.filter((inv) => inv.status !== 'cancelled').map((inv) => {
                  const net = inv.total - (creditedByInvoice[inv.id] || 0);
                  const avail = tab === 'credit' ? net : inv.total;
                  return { value: inv.id, label: `#${inv.number} — ${money(inv.total)}${tab === 'credit' ? ` (المتاح: ${money(Math.max(0, avail))})` : ''}` };
                }),
              ]}
            />
            {!form.invoice_id && (
              <>
                <Select label="المشروع (اختياري)" value={form.project_id} onChange={(v) => setForm({ ...form, project_id: v })}
                  options={[{ value: '', label: '— بدون —' }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} />
                <Select label="العميل" value={form.contact_id} onChange={(v) => setForm({ ...form, contact_id: v })}
                  options={[{ value: '', label: '— اختر —' }, ...contacts.filter((c) => c.type === 'client' || c.type === 'both').map((c) => ({ value: c.id, label: c.name }))]} />
              </>
            )}
          </div>
          {form.invoice_id && (
            <div className="bg-bg-secondary border border-border rounded-lg p-3 text-sm text-text-secondary">
              سيتم اشتقاق العميل والمشروع ونسبة الضريبة تلقائياً من الفاتورة الأصل
              {selectedInvoice ? ` (#${selectedInvoice.number})` : ''} — الفاتورة نفسها لن تُعدَّل.
            </div>
          )}
          <Textarea label="السبب" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}
            placeholder={tab === 'credit' ? 'سبب التخفيض/الإرجاع (إلزامي لأغراض الضريبة)...' : 'سبب الزيادة (إلزامي)...'} />

          <div className="border border-border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg-secondary">
                <tr>
                  <th className="p-2 text-right">البيان</th>
                  <th className="p-2 text-center w-24">الكمية</th>
                  <th className="p-2 text-center w-28">سعر الوحدة</th>
                  <th className="p-2 text-center w-28">الإجمالي</th>
                  <th className="p-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {form.items.map((item: NoteItem, i: number) => (
                  <tr key={i} className="border-t border-border">
                    <td className="p-1"><Input value={item.description} onChange={(e) => updateItem(i, 'description', e.target.value)} /></td>
                    <td className="p-1"><Input type="number" value={item.quantity} onChange={(e) => updateItem(i, 'quantity', parseFloat(e.target.value) || 0)} /></td>
                    <td className="p-1"><Input type="number" value={item.unit_price} onChange={(e) => updateItem(i, 'unit_price', parseFloat(e.target.value) || 0)} /></td>
                    <td className="p-1 text-center font-bold">{money(item.quantity * item.unit_price)}</td>
                    <td className="p-1">{form.items.length > 1 && <Button variant="ghost" size="sm" onClick={() => removeItem(i)}><Trash2 size={14} className="text-danger" /></Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm text-text-secondary">
              <input type="checkbox" checked={form.vat_enabled} onChange={(e) => setForm({ ...form, vat_enabled: e.target.checked })} />
              ضريبة القيمة المضافة {vatPct}% {form.invoice_id ? '(تُطبَّق نسبة الفاتورة الأصل)' : ''}
            </label>
            <div className="text-sm flex gap-4">
              <span>الضريبة: <strong>{money(vatAmount)}</strong></span>
              <span>{typeLabel}: <strong className="text-accent">{money(grandTotal)}</strong></span>
            </div>
          </div>
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
