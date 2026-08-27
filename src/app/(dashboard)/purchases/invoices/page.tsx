'use client';

import { useState, useEffect } from 'react';
import type { Row } from '@/lib/types';
import { Plus, Trash2 } from 'lucide-react';
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
import { RecordViewModal } from '@/components/ui/RecordViewModal';
import { formatDate, formatCurrency, escapeHtml } from '@/lib/utils';
import { fetchRecord, applyDates, recordOrRow, toDateInput } from '@/lib/form-utils';
import { toast } from '@/components/ui/Toast';
import { formatDocumentNumber } from '@/lib/document-number';
import { openPrintWindow } from '@/lib/print';

interface PurchaseItem {
  description: string;
  quantity: number;
  unit_price: number;
  total?: number;
}

const emptyItem: PurchaseItem = { description: '', quantity: 1, unit_price: 0 };

interface OtherExpense { description: string; amount: number; }
interface OrderItem { description?: string; quantity?: number; received_quantity?: number; unit_price?: number; }
interface PurchaseInvoiceRow {
  id: string;
  number?: string;
  invoice_number?: string;
  date?: string;
  supplier_name?: string;
  total: number;
  paid_amount?: number;
  status?: string;
  items?: PurchaseItem[];
  notes?: string;
  subtotal?: number;
  tax_amount?: number;
  other_expenses_total?: number;
  journal_entry_id?: string | number;
  contacts?: { name?: string };
  supplier?: { name?: string };
}
interface PurchaseInvoiceForm {
  date: string;
  supplier_id: string;
  purchase_order_id: string;
  notes: string;
  tax_percent: number;
  status: string;
  items: PurchaseItem[];
  other_expenses?: OtherExpense[];
  payment_account_id?: string;
}
interface SupplierOption { id: string; name: string; }
interface PurchaseOrderOption {
  id: string;
  supplier_id?: string;
  number?: string;
  po_number?: string;
  supplier_name?: string;
  status: string;
  items?: OrderItem[];
}
interface CompanyInfo { name?: string; tax_number?: string; }

const STATUS_LABELS: Record<string, { variant: 'success' | 'warning' | 'info' | 'danger'; label: string }> = {
  paid: { variant: 'success', label: 'مدفوعة' },
  unpaid: { variant: 'warning', label: 'غير مدفوعة' },
  partial: { variant: 'info', label: 'مدفوعة جزئياً' },
  cancelled: { variant: 'danger', label: 'ملغاة' },
};

export default function PurchaseInvoicesPage() {
  const [invoices, setInvoices] = useState<PurchaseInvoiceRow[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [orders, setOrders] = useState<PurchaseOrderOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<PurchaseInvoiceRow | null>(null);
  const [viewingInvoice, setViewingInvoice] = useState<PurchaseInvoiceRow | null>(null);
  const [company, setCompany] = useState<CompanyInfo | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<PurchaseInvoiceForm>({
    date: new Date().toISOString().split('T')[0],
    supplier_id: '',
    purchase_order_id: '',
    notes: '',
    tax_percent: 15,
    status: 'unpaid',
    items: [{ ...emptyItem }],
    other_expenses: [] as { description: string; amount: number }[],
    payment_account_id: '',
  });

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const [invRes, supRes, ordRes, setRes] = await Promise.all([
        fetch('/api/purchases/invoices'),
        fetch('/api/contacts?type=supplier'),
        fetch('/api/purchases/orders'),
        fetch('/api/settings'),
      ]);
      const [invJson, supJson, ordJson, setJson] = await Promise.all([
        invRes.json(),
        supRes.json(),
        ordRes.json(),
        setRes.json(),
      ]);
      if (invJson.success) setInvoices(invJson.data?.invoices || []);
      else setError(invJson.message || 'فشل');
      if (supJson.success) setSuppliers(supJson.data?.contacts || []);
      if (ordJson.success) setOrders(ordJson.data?.orders || []);
      if (setJson.success && setJson.data?.company) setCompany(setJson.data.company);
    } catch { setError('فشل تحميل البيانات'); } finally { setLoading(false); }
  };

  // Initial load on mount (standard fetch pattern: loading state set
  // synchronously before the network round trip).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchData(); }, []);

  const subtotal = form.items.reduce((s: number, it: PurchaseItem) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0);
  const taxAmount = subtotal * ((Number(form.tax_percent) || 0) / 100);
  const otherExpensesTotal = (form.other_expenses || []).reduce((s: number, o: OtherExpense) => s + (Number(o.amount) || 0), 0);
  const grandTotal = subtotal + taxAmount + otherExpensesTotal;
  const addOtherExpense = () => setForm({ ...form, other_expenses: [...(form.other_expenses || []), { description: '', amount: 0 }] });
  const updateOtherExpense = (i: number, patch: Partial<OtherExpense>) => {
    const list = [...(form.other_expenses || [])];
    list[i] = { ...list[i], ...patch };
    setForm({ ...form, other_expenses: list });
  };
  const removeOtherExpense = (i: number) => setForm({ ...form, other_expenses: (form.other_expenses || []).filter((_o: OtherExpense, idx: number) => idx !== i) });

  const addItem = () => setForm({ ...form, items: [...form.items, { ...emptyItem }] });
  const removeItem = (index: number) => {
    if (form.items.length <= 1) return;
    setForm({ ...form, items: form.items.filter((_o: PurchaseItem, i: number) => i !== index) });
  };
  const updateItem = (index: number, patch: Partial<PurchaseItem>) => {
    setForm({
      ...form,
      items: form.items.map((it: PurchaseItem, i: number) => (i === index ? { ...it, ...patch } : it)),
    });
  };

  const applyPurchaseOrder = (orderId: string) => {
    if (!orderId) {
      setForm({ ...form, purchase_order_id: '' });
      return;
    }
    const order = orders.find((candidate) => candidate.id === orderId);
    if (!order) {
      setForm({ ...form, purchase_order_id: orderId });
      return;
    }
    setForm({
      ...form,
      purchase_order_id: orderId,
      supplier_id: order.supplier_id || form.supplier_id,
      items: (order.items || []).map((item: OrderItem) => ({
        description: item.description || '',
        quantity: Math.max(0, Number(item.quantity) - Number(item.received_quantity || 0)) || Number(item.quantity) || 1,
        unit_price: Number(item.unit_price) || 0,
      })),
    });
    setSaveError('');
  };

  const validateItems = (): string => {
    for (const it of form.items as PurchaseItem[]) {
      if (!it.description.trim()) return 'أدخل بيان كل بند';
      if (!(Number(it.quantity) > 0)) return 'الكمية يجب أن تكون أكبر من صفر';
      if (Number(it.unit_price) < 0) return 'السعر لا يمكن أن يكون سالباً';
    }
    return '';
  };

  const handleSave = async () => {
    if (!form.supplier_id) { setSaveError('يجب اختيار مورد'); return; }
    if (!editingInvoice) {
      const itemError = validateItems();
      if (itemError) { setSaveError(itemError); return; }
    }
    setSaving(true); setSaveError('');
    try {
      // في وضع التعديل: الحالة والملاحظات فقط — المبالغ والبنود لا تتغير بعد الترحيل
      const payload = editingInvoice
        ? { status: form.status, notes: form.notes }
        : {
            date: form.date,
            supplier_id: form.supplier_id,
            purchase_order_id: form.purchase_order_id || null,
            notes: form.notes,
            tax_rate: (Number(form.tax_percent) || 0) / 100,
            items: form.items.map((it: PurchaseItem) => ({
              description: it.description.trim(),
              quantity: Number(it.quantity),
              unit_price: Number(it.unit_price),
            })),
            other_expenses: (form.other_expenses || []).filter((o: OtherExpense) => String(o.description || '').trim() && Number(o.amount) > 0),
            payment_account_id: form.payment_account_id || null,
          };

      const url = editingInvoice ? `/api/purchases/invoices/${editingInvoice.id}` : '/api/purchases/invoices';
      const method = editingInvoice ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setEditingInvoice(null);
        setForm({
          date: new Date().toISOString().split('T')[0],
          supplier_id: '',
          purchase_order_id: '',
          notes: '',
          tax_percent: 15,
          status: 'unpaid',
          items: [{ ...emptyItem }],
        });
        fetchData();
      } else setSaveError(json.message || 'فشل الحفظ');
    } catch { setSaveError('خطأ في الاتصال'); } finally { setSaving(false); }
  };

  const handleEdit = async (invoice: PurchaseInvoiceRow) => {
    const { data, error } = await fetchRecord(`/api/purchases/invoices/${invoice.id}`);
    const src = recordOrRow(data, invoice);
    if (!data && error) toast.error(error);
    setEditingInvoice(invoice);
    setForm(applyDates({
      date: toDateInput(src.date) ?? '',
      supplier_id: String(src.supplier_id ?? ''),
      purchase_order_id: String(src.purchase_order_id ?? ''),
      notes: String(src.notes ?? ''),
      tax_percent: Math.round((Number(src.tax_rate) || 0) * 100),
      status: String(src.status ?? 'unpaid'),
      items: src.items && (src.items as Row[]).length ? (src.items as PurchaseItem[]) : [{ ...emptyItem }],
    }, ['date']));
    setShowModal(true);
  };

  const handleDelete = async (invoice: PurchaseInvoiceRow) => {
    try {
      const res = await fetch(`/api/purchases/invoices/${invoice.id}`, { method: 'DELETE' });
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

  // طباعة فاتورة مشتريات احترافية كفاتورة.
  const handlePrint = async (invoice: PurchaseInvoiceRow) => {
    let record: PurchaseInvoiceRow = invoice;
    try {
      const res = await fetch(`/api/purchases/invoices/${invoice.id}`);
      const json = await res.json();
      if (json.success) record = json.data;
    } catch { /* use row data */ }
    const items = record.items || [];
    const itemsHtml = items.map((it: PurchaseItem) => `<tr>
      <td style="padding:8px 10px;border:1px solid #d8dee9;text-align:right">${escapeHtml(String(it.description || ''))}</td>
      <td style="padding:8px 10px;border:1px solid #d8dee9;text-align:center;white-space:nowrap">${Number(it.quantity || 0)}</td>
      <td style="padding:8px 10px;border:1px solid #d8dee9;text-align:center;white-space:nowrap">${Number(it.unit_price || 0).toFixed(2)}</td>
      <td style="padding:8px 10px;border:1px solid #d8dee9;text-align:left;white-space:nowrap;font-weight:700">${Number(it.total || 0).toFixed(2)}</td>
    </tr>`).join('');
    const subtotal = Number(record.subtotal || 0);
    const taxAmount = Number(record.tax_amount || 0);
    const otherTotal = Number(record.other_expenses_total || 0);
    const total = Number(record.total || 0);
    const companyName = escapeHtml(String(company?.name || ''));
    const companyTax = escapeHtml(String(company?.tax_number || ''));
    const supplierName = escapeHtml(String(record.supplier_name || record.contacts?.name || record.supplier?.name || ''));
    const html = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>فاتورة شراء ${record.number || record.invoice_number}</title>
      <style>
        body{font-family:Tahoma,Arial,sans-serif;color:#0f172a;padding:0;margin:0;background:#fff}
        .page{max-width:820px;margin:0 auto;padding:32px}
        .doc{border:1px solid #e2e8f0;border-radius:14px;overflow:hidden}
        .bar{height:6px;background:linear-gradient(90deg,#0f766e,#14b8a6)}
        .head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding:22px 26px;border-bottom:1px solid #e2e8f0}
        .title{font-size:22px;font-weight:800;color:#0f766e;margin:0}
        .subtitle{font-size:12px;color:#64748b;margin:2px 0 0}
        .num{background:#ecfdf5;color:#0f766e;font-weight:700;font-size:14px;padding:6px 12px;border-radius:8px;display:inline-block;margin-top:10px}
        .meta{font-size:12px;color:#334155;line-height:1.9;text-align:left}
        .section{padding:16px 26px;border-bottom:1px solid #e2e8f0}
        .section h3{font-size:13px;font-weight:800;color:#334155;margin:0 0 8px}
        table{width:100%;border-collapse:collapse}
        th{background:#f1f5f9;color:#334155;font-size:12px;padding:9px 10px;border:1px solid #d8dee9;text-align:right}
        td{font-size:12px;color:#0f172a}
        .totals{display:flex;flex-direction:column;gap:6px;align-items:flex-end;padding:6px 0}
        .totals .row{display:flex;justify-content:space-between;width:300px;font-size:13px;color:#334155}
        .grand{display:flex;justify-content:space-between;width:300px;font-size:16px;font-weight:800;color:#0f766e;border-top:2px solid #0f172a;padding-top:8px;margin-top:4px}
        .footer{text-align:center;font-size:11px;color:#94a3b8;padding:14px}
        .muted{color:#64748b;font-size:12px}
        @media print{button{display:none}.page{padding:0}.doc{border:none;border-radius:0}}
      </style></head><body>
      <div class="page"><div class="doc">
        <div class="bar"></div>
        <div class="head">
          <div>
            <h1 class="title">فاتورة مشتريات</h1>
            <p class="subtitle">Purchase Invoice</p>
            <span class="num">رقم الفاتورة: ${escapeHtml(String(record.number || record.invoice_number))}</span>
          </div>
          <div class="meta">
            ${companyName ? `<div style="font-weight:800;font-size:14px;color:#0f172a">${companyName}</div>` : ''}
            ${companyTax ? `<div>الرقم الضريبي: ${companyTax}</div>` : ''}
          </div>
        </div>
        <div class="section">
          <div style="display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap">
            <div><h3>المورد</h3><div style="font-weight:700;color:#0f172a">${supplierName || '—'}</div></div>
            <div><h3>التاريخ</h3><div>${formatDate(record.date)}</div></div>
          </div>
        </div>
        <div class="section">
          <table>
            <thead><tr><th style="width:46%">البيان / الوصف</th><th>الكمية</th><th>سعر الوحدة</th><th style="text-align:left">الإجمالي</th></tr></thead>
            <tbody>${itemsHtml || '<tr><td colspan="4" style="text-align:center;color:#94a3b8">لا توجد بنود</td></tr>'}</tbody>
          </table>
          <div class="totals">
            <div class="row"><span>المجموع الفرعي (قيمة المورد)</span><span>${subtotal.toFixed(2)}</span></div>
            ${taxAmount > 0 ? `<div class="row"><span>ضريبة القيمة المضافة</span><span>${taxAmount.toFixed(2)}</span></div>` : ''}
            ${otherTotal > 0 ? `<div class="row"><span>مصاريف إضافية</span><span>${otherTotal.toFixed(2)}</span></div>` : ''}
            <div class="grand"><span>الإجمالي</span><span>${total.toFixed(2)}</span></div>
          </div>
        </div>
        ${record.notes ? `<div class="section"><h3>ملاحظات</h3><p class="muted" style="margin:0;line-height:1.8">${escapeHtml(String(record.notes))}</p></div>` : ''}
        <div class="footer">تم إنشاء هذه الفاتورة إلكترونياً بواسطة ${companyName || 'النظام المحاسبي'}</div>
      </div></div>
      <p style="text-align:center"><button onclick="window.print()" style="padding:10px 28px;border-radius:8px;border:none;background:#0f766e;color:#fff;font-size:15px;cursor:pointer">طباعة / حفظ PDF</button></p>
      </body></html>`;
    const result = openPrintWindow(html);
    if (!result.ok) toast.error(result.blocked ? 'منع المتصفح فتح نافذة الطباعة. اسمح بالنوافذ المنبثقة.' : 'تعذر فتح نافذة الطباعة.');
  };

  const columns = [
    { key: 'invoice_number', label: 'الرقم', sortable: true, render: (row: PurchaseInvoiceRow) => formatDocumentNumber('purchase_invoice', row.number || row.invoice_number) },
    { key: 'date', label: 'التاريخ', render: (row: PurchaseInvoiceRow) => formatDate(row.date) },
    { key: 'supplier_name', label: 'المورد', sortable: true },
    { key: 'total', label: 'الإجمالي', render: (row: PurchaseInvoiceRow) => formatCurrency(row.total) },
    { key: 'paid_amount', label: 'المدفوع', render: (row: PurchaseInvoiceRow) => formatCurrency(row.paid_amount || 0) },
    {
      key: 'status', label: 'الحالة', render: (row: PurchaseInvoiceRow) => {
        const m = STATUS_LABELS[row.status ?? ''] || { variant: 'warning' as const, label: row.status || 'غير مدفوعة' };
        return <Badge variant={m.variant}>{m.label}</Badge>;
      }
    },
    {
      key: 'actions',
      label: 'إجراءات',
      render: (row: PurchaseInvoiceRow) => (
        <ActionButtons
          item={row}
          onPrint={() => handlePrint(row)}
          onView={async () => {
            try {
              const res = await fetch(`/api/purchases/invoices/${row.id}`);
              const json = await res.json();
              if (json.success) setViewingInvoice(json.data);
              else toast.error(json.message || 'تعذر عرض الفاتورة');
            } catch { toast.error('تعذر عرض الفاتورة'); }
          }}
          onEdit={row.status !== 'cancelled' ? handleEdit : undefined}
          onDelete={!row.journal_entry_id && (parseFloat(String(row.paid_amount ?? '')) || 0) <= 0 ? handleDelete : undefined}
        />
      ),
    },
  ];

  const isEdit = !!editingInvoice;
  const canChangeStatus = isEdit && form.status === 'unpaid';

  if (loading) return <LoadingSkeleton variant="table" count={8} />;
  if (error) return <div className="p-6"><div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div></div>;

  return (
    <div className="space-y-6">
      <PageHeader title="فواتير المشتريات" description="إدارة فواتير الشراء" actions={<Button onClick={() => { setEditingInvoice(null); setForm({ date: new Date().toISOString().split('T')[0], supplier_id: '', purchase_order_id: '', notes: '', tax_percent: 15, status: 'unpaid', items: [{ ...emptyItem }] }); setShowModal(true); }} leftIcon={<Plus size={18} />}>إضافة فاتورة</Button>} />
      {invoices.length === 0 ? <EmptyState title="لا توجد فواتير" actionLabel="إضافة فاتورة" onAction={() => setShowModal(true)} /> : <DataTable columns={columns} data={invoices} searchable searchKeys={['supplier_name', 'invoice_number']} />}
      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setEditingInvoice(null); }} title={isEdit ? 'تعديل فاتورة شراء' : 'إضافة فاتورة شراء'} size="xl" footer={<div className="flex gap-2"><Button variant="ghost" onClick={() => { setShowModal(false); setEditingInvoice(null); }}>إلغاء</Button><Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</Button></div>}>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="التاريخ" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} disabled={isEdit} />
            {isEdit ? (
              <Select
                label="الحالة"
                value={form.status}
                onChange={(v) => setForm({ ...form, status: v })}
                disabled={!canChangeStatus}
                options={[
                  { value: form.status, label: STATUS_LABELS[form.status]?.label || form.status },
                  ...(canChangeStatus ? [{ value: 'cancelled', label: 'إلغاء الفاتورة (عكس القيد)' }] : []),
                ]}
              />
            ) : (
              <Select label="المورد" value={form.supplier_id} onChange={(v) => setForm({ ...form, supplier_id: v })} options={[{ value: '', label: 'اختر مورداً' }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))]} />
            )}
            {!isEdit && (
              <>
                <Select label="أمر الشراء (اختياري)" value={form.purchase_order_id} onChange={applyPurchaseOrder} options={[{ value: '', label: 'بدون' }, ...orders.filter((order) => order.status === 'received').map((o) => ({ value: o.id, label: `${formatDocumentNumber('purchase_order', o.number || o.po_number)} — ${o.supplier_name || ''}` }))]} />
                <Input label="نسبة الضريبة %" type="number" min={0} max={100} value={form.tax_percent} onChange={(e) => setForm({ ...form, tax_percent: Number(e.target.value) })} />
              </>
            )}
          </div>

          {!isEdit && orders.some((order) => order.status !== 'received' && order.status !== 'cancelled') && (
            <div className="rounded-lg border border-info/30 bg-info/10 p-3 text-xs text-text-secondary">
              لا تظهر هنا إلا أوامر الشراء المستلمة بالكامل. نفّذ «استلام البضاعة» من شاشة أوامر الشراء أولاً؛ عندها تُحدّث كميات المخزون، ثم اختر الأمر هنا لترحيل فاتورة المورد وإغلاق حساب البضاعة المستلمة غير المفوترة.
            </div>
          )}

          {!isEdit && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">البنود</span>
                <Button variant="ghost" size="sm" onClick={addItem} leftIcon={<Plus size={16} />}>إضافة بند</Button>
              </div>
              <div className="border border-border rounded-lg overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-hover/50">
                    <tr>
                      <th className="p-2 text-start">البيان</th>
                      <th className="p-2 text-start w-24">الكمية</th>
                      <th className="p-2 text-start w-28">سعر الوحدة</th>
                      <th className="p-2 text-start w-28">الإجمالي</th>
                      <th className="p-2 w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.items.map((item: PurchaseItem, i: number) => (
                      <tr key={i} className="border-t border-border">
                        <td className="p-2">
                          <input className="w-full bg-transparent outline-none" value={item.description} onChange={(e) => updateItem(i, { description: e.target.value })} placeholder="وصف البند" />
                        </td>
                        <td className="p-2">
                          <input className="w-full bg-transparent outline-none" type="number" min={0} step="any" value={item.quantity} onChange={(e) => updateItem(i, { quantity: Number(e.target.value) })} />
                        </td>
                        <td className="p-2">
                          <input className="w-full bg-transparent outline-none" type="number" min={0} step="any" value={item.unit_price} onChange={(e) => updateItem(i, { unit_price: Number(e.target.value) })} />
                        </td>
                        <td className="p-2">{formatCurrency((Number(item.quantity) || 0) * (Number(item.unit_price) || 0))}</td>
                        <td className="p-2">
                          <button type="button" className="text-danger disabled:opacity-30" onClick={() => removeItem(i)} disabled={form.items.length <= 1} aria-label="حذف البند">
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-col items-end gap-1 text-sm border-t border-border pt-3">
                <div>المجموع الفرعي (قيمة المورد): <span className="font-semibold">{formatCurrency(subtotal)}</span></div>
                <div>الضريبة ({form.tax_percent}%): <span className="font-semibold">{formatCurrency(taxAmount)}</span></div>
                {otherExpensesTotal > 0 && <div>مصاريف إضافية: <span className="font-semibold">{formatCurrency(otherExpensesTotal)}</span></div>}
                <div className="text-base">إجمالي تكلفة الفاتورة: <span className="font-bold">{formatCurrency(grandTotal)}</span></div>
              </div>
            </div>
          )}

          {/* مصاريف إضافية (لا تُضاف لرصيد المورد) */}
          <div className="rounded-xl border border-border bg-bg-secondary p-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-bold">مصاريف إضافية (نقل، وقود، إيجار، عمالة، صيانة...)</h4>
              <Button type="button" size="sm" variant="outline" onClick={addOtherExpense}>إضافة مصروف</Button>
            </div>
            <p className="text-xs text-text-muted mb-3">
              تُحمَّل على تكلفة الفاتورة وتزيد تكلفة البنود، لكنها <strong>لا تُضاف إلى رصيد المورد</strong>.
            </p>
            {(form.other_expenses || []).length === 0 ? (
              <div className="text-xs text-text-muted py-2">لا توجد مصاريف إضافية.</div>
            ) : (
              <div className="space-y-2">
                {(form.other_expenses || []).map((o: OtherExpense, i: number) => (
                  <div key={i} className="grid grid-cols-[1fr_8rem_2rem] gap-2 items-center">
                    <input
                      className="input-base !py-2 text-sm"
                      placeholder="وصف المصروف (مثال: أجرة نقل)"
                      value={o.description}
                      onChange={(e) => updateOtherExpense(i, { description: e.target.value })}
                    />
                    <input
                      className="input-base !py-2 text-sm text-center font-mono"
                      type="number"
                      placeholder="المبلغ"
                      value={o.amount}
                      onChange={(e) => updateOtherExpense(i, { amount: Number(e.target.value) })}
                    />
                    <button type="button" className="text-danger" onClick={() => removeOtherExpense(i)} aria-label="حذف">
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Textarea label="ملاحظات" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="ملاحظات الفاتورة" />
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
      {/* Purchase Invoice Preview Modal */}
      <RecordViewModal
        isOpen={!!viewingInvoice}
        onClose={() => setViewingInvoice(null)}
        title={viewingInvoice ? `فاتورة مشتريات رقم ${formatDocumentNumber('purchase_invoice', viewingInvoice.number || viewingInvoice.invoice_number)}` : 'معاينة فاتورة الشراء'}
        record={viewingInvoice}
        extra={viewingInvoice?.items?.length ? (
          <div className="border border-border rounded-xl overflow-x-auto mt-3">
            <div className="bg-bg-secondary p-2.5 font-bold text-xs border-b border-border">بنود فاتورة الشراء</div>
            <table className="w-full text-xs text-right">
              <thead className="bg-bg-secondary/50 text-text-muted">
                <tr>
                  <th className="p-2">البيان</th>
                  <th className="p-2 text-center">الكمية</th>
                  <th className="p-2 text-center">سعر الوحدة</th>
                  <th className="p-2 text-left">المجموع</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(viewingInvoice.items || []).map((it: PurchaseItem, idx: number) => (
                  <tr key={idx}>
                    <td className="p-2 font-medium">{it.description}</td>
                    <td className="p-2 text-center font-mono">{it.quantity}</td>
                    <td className="p-2 text-center font-mono">{formatCurrency(it.unit_price || 0)}</td>
                    <td className="p-2 text-left font-bold font-mono">{formatCurrency((Number(it.quantity) || 0) * (Number(it.unit_price) || 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      />
    </div>
  );
}
