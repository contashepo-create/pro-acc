'use client';

import { useState, useEffect } from 'react';
import { Plus, Trash2, ArrowRight, FileText, Save, X, FileMinus, FilePlus } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Badge } from '@/components/ui/Badge';
import { Checkbox } from '@/components/ui/Checkbox';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { ActionButtons } from '@/components/ui/ActionButtons';
import { toast } from '@/components/ui/Toast';
import { formatDate, formatCurrency } from '@/lib/utils';
import { formatDocumentNumber } from '@/lib/document-number';
import { parseCompanyVatRate, vatPercentLabel } from '@/lib/company-vat';

interface InvoiceItem {
  id?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  total: number;
  item_type?: 'service' | 'product' | 'inventory';
  unit?: string;
  item_code?: string;
  inventory_item_id?: string;
}

const emptyItem: InvoiceItem = {
  description: '', quantity: 1, unitPrice: 0, discount: 0, total: 0,
  item_type: 'service', unit: 'وحدة',
};

interface SalesInvoiceRow {
  id: string;
  number?: string;
  date?: string;
  contact_name?: string;
  client_name?: string;
  status?: string;
  total: number;
  paid_amount: number;
}
interface ClientOption { id: string; name: string; }
interface ProjectOption { id: string; name: string; }
interface InventoryOption { id: string; name: string; code: string; quantity: number; unit: string; }
interface InvoiceForm {
  client_id: string;
  project_id: string;
  date: string;
  due_date: string;
  notes: string;
  vat_enabled: boolean;
  items: InvoiceItem[];
  currency_code: string;
  exchange_rate: string;
}
interface CurrencyOption { id: string; code: string; name: string; rate: number; is_base: boolean; }

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<SalesInvoiceRow[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryOption[]>([]);
  const [currencies, setCurrencies] = useState<CurrencyOption[]>([]);
  const [companyVatRate, setCompanyVatRate] = useState(0.15);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showEditor, setShowEditor] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [statusTab, setStatusTab] = useState('all');

  const [form, setForm] = useState<InvoiceForm>({
    client_id: '',
    project_id: '',
    date: new Date().toISOString().split('T')[0],
    due_date: '',
    notes: '',
    vat_enabled: true,
    items: [{ ...emptyItem }],
    currency_code: '',
    exchange_rate: '',
  });

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const [invRes, cliRes, projRes, stockRes, curRes, setRes] = await Promise.all([
        fetch('/api/invoices'),
        fetch('/api/clients'),
        fetch('/api/projects'),
        fetch('/api/inventory?items=1'),
        fetch('/api/currencies'),
        fetch('/api/auth/me'),
      ]);
      const [invJson, cliJson, projJson, stockJson, curJson, setJson] = await Promise.all([
        invRes.json(), cliRes.json(), projRes.json(), stockRes.json(), curRes.json(), setRes.json(),
      ]);
      if (invJson.success) setInvoices(invJson.data?.invoices || []);
      else setError(invJson.message || 'فشل');
      if (cliJson.success) setClients(cliJson.data?.clients || []);
      if (projJson.success) setProjects(projJson.data?.rows || projJson.data?.projects || []);
      if (stockJson.success) {
        setInventoryItems((stockJson.data?.items || []).map((it: Record<string, unknown>) => ({
          id: String(it.id), name: String(it.name), code: String(it.code),
          quantity: Number(it.quantity) || 0, unit: String(it.unit || 'وحدة'),
        })));
      }
      if (curJson.success) setCurrencies(curJson.data || []);
      if (setJson.success) setCompanyVatRate(parseCompanyVatRate(setJson.data?.company));
    } catch { setError('فشل تحميل البيانات'); } finally { setLoading(false); }
  };

  // Initial load on mount (standard fetch pattern).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchData(); }, []);

  const openNewInvoice = () => {
    setForm({
      client_id: '',
      project_id: '',
      date: new Date().toISOString().split('T')[0],
      due_date: '',
      notes: '',
      currency_code: '',
      exchange_rate: '',
      vat_enabled: true,
      items: [{ ...emptyItem }],
    });
    setSaveError('');
    setShowEditor(true);
  };

  // ⛔ لا يوجد تعديل للفاتورة: المستند غير قابل للتعديل نهائياً بعد الإنشاء
  // (مفروض بمُشغِّل قاعدة البيانات). التصحيح عبر إشعار دائن/مدين فقط.

  const handleSave = async () => {
    if (!form.client_id) { setSaveError('يجب اختيار عميل'); return; }
    const validItems = form.items.filter((i: InvoiceItem) => i.description && i.quantity > 0);
    if (validItems.length === 0) { setSaveError('يجب إضافة صنف واحد على الأقل'); return; }

    setSaving(true); setSaveError('');
    try {
      const subtotal = validItems.reduce((sum: number, item: InvoiceItem) => sum + item.total, 0);
      const vatRate = form.vat_enabled ? companyVatRate : 0;
      const vatAmount = subtotal * vatRate;
      const total = subtotal + vatAmount;

      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: form.client_id,
          projectId: form.project_id || null,
          date: form.date,
          dueDate: form.due_date || form.date,
          items: validItems.map((i: InvoiceItem) => ({
            description: i.description, quantity: i.quantity, unitPrice: i.unitPrice, total: i.total,
            discount: Number(i.discount) || 0,
            item_type: i.item_type || 'service', unit: i.unit || 'وحدة',
            item_code: i.item_code || undefined,
            inventory_item_id: i.inventory_item_id || undefined,
          })),
          currency_code: form.currency_code || undefined,
          exchange_rate: form.currency_code && form.exchange_rate ? Number(form.exchange_rate) : undefined,
          subtotal, vatRate, vatAmount, vatEnabled: form.vat_enabled, total, notes: form.notes,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setShowEditor(false);
        toast.success('تم إضافة الفاتورة بنجاح');
        fetchData();
      } else { setSaveError(json.message || 'فشل الحفظ'); }
    } catch { setSaveError('خطأ في الاتصال بالخادم'); } finally { setSaving(false); }
  };

  const handleDelete = async (invoice: SalesInvoiceRow) => {
    if (!confirm('سيتم إلغاء الفاتورة مع عكس قيدها المحاسبي. متابعة؟')) return;
    try {
      // الإلغاء (وليس الحذف المادي) — المسار الصحيح هو PATCH status=cancelled
      // الذي يعكس القيد المحاسبي؛ لا يوجد DELETE في واجهة الفواتير.
      const res = await fetch(`/api/invoices/${invoice.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      });
      const json = await res.json();
      if (json.success) { toast.success('تم إلغاء الفاتورة بنجاح'); fetchData(); }
      else { toast.error(json.message || 'فشل الإلغاء'); }
    } catch { toast.error('خطأ في الاتصال بالخادم'); }
  };

  // اختيار مشروع: تستمد الفاتورة بنودها من جدول كميات المشروع (صافي بدون
  // ضريبة) مع إضافة الضريبة فوقها، وتُرتبط بالعميل تلقائياً، مع بقاء كل
  // البنود قابلة للتعديل.
  const handleProjectChange = async (projectId: string) => {
    setForm((prev) => ({ ...prev, project_id: projectId }));
    if (!projectId) return;
    try {
      const res = await fetch(`/api/projects/${projectId}`);
      const json = await res.json();
      if (!json.success) {
        toast.error(json.message || 'تعذر تحميل بيانات المشروع');
        return;
      }
      const d = json.data;
      const boq = (d.boq_items || []).map((it: Record<string, unknown>) => ({
        description: String(it.description || '').trim(),
        quantity: Number(it.quantity) || 1,
        unitPrice: Number(it.unit_price) || 0,
        discount: 0,
        total: (Number(it.quantity) || 0) * (Number(it.unit_price) || 0),
        item_type: 'service',
        unit: String(it.unit || 'وحدة').trim(),
      }));
      setForm((prev) => ({
        ...prev,
        project_id: projectId,
        client_id: prev.client_id || d.client_id || '',
        items: boq.length ? boq : [{ ...emptyItem }],
      }));
      if (boq.length) toast.success(`تم استيراد ${boq.length} بند من المشروع — أضف الضريبة حسب الحاجة`);
    } catch (e) {
      console.error('Failed to load project items:', e);
      toast.error('تعذر تحميل بنود المشروع');
    }
  };

  const addItem = () => setForm({ ...form, items: [...form.items, { ...emptyItem }] });

  const removeItem = (index: number) => {
    if (form.items.length === 1) return;
    setForm({ ...form, items: form.items.filter((_o: InvoiceItem, i: number) => i !== index) });
  };

  const updateItem = (index: number, field: keyof InvoiceItem, value: string | number | boolean | undefined) => {
    const newItems = [...form.items];
    newItems[index] = { ...newItems[index], [field]: value };
    if (field === 'quantity' || field === 'unitPrice' || field === 'discount') {
      const item = newItems[index];
      const gross = item.quantity * item.unitPrice;
      const disc = gross * (item.discount || 0) / 100;
      item.total = gross - disc;
    }
    setForm({ ...form, items: newItems });
  };

  const subtotal = form.items.reduce((sum: number, item: InvoiceItem) => sum + (item.total || 0), 0);
  const totalDiscount = form.items.reduce((sum: number, item: InvoiceItem) => {
    return sum + (item.quantity * item.unitPrice * (item.discount || 0) / 100);
  }, 0);
  const vatAmount = form.vat_enabled ? subtotal * companyVatRate : 0;
  const vatPct = vatPercentLabel(companyVatRate);
  const total = subtotal + vatAmount;

  const filtered = statusTab === 'all' ? invoices : invoices.filter(i => i.status === statusTab);

  const columns = [
    { key: 'number', label: 'رقم الفاتورة', sortable: true, render: (row: SalesInvoiceRow) => formatDocumentNumber('sales_invoice', row.number) },
    { key: 'date', label: 'التاريخ', sortable: true, render: (row: SalesInvoiceRow) => formatDate(row.date) },
    { key: 'contact_name', label: 'العميل', sortable: true, render: (row: SalesInvoiceRow) => row.contact_name || row.client_name || '—' },
    { key: 'total', label: 'الإجمالي', sortable: true, render: (row: SalesInvoiceRow) => formatCurrency(row.total) },
    { key: 'paid_amount', label: 'المدفوع', render: (row: SalesInvoiceRow) => formatCurrency(row.paid_amount) },
    { key: 'actions', label: '', render: (row: SalesInvoiceRow) => (
      <div className="flex items-center gap-1">
        {/* بديل التعديل: إشعار دائن (تخفيض) / إشعار مدين (زيادة) */}
        <button
          type="button"
          title="إشعار دائن (تخفيض) — بديل التعديل"
          className="p-2 rounded-md text-success hover:bg-success/10 transition-colors"
          onClick={() => { window.location.href = `/credit-notes?invoice=${row.id}&type=credit`; }}
        >
          <FileMinus size={16} />
        </button>
        <button
          type="button"
          title="إشعار مدين (زيادة) — بديل التعديل"
          className="p-2 rounded-md text-warning hover:bg-warning/10 transition-colors"
          onClick={() => { window.location.href = `/credit-notes?invoice=${row.id}&type=debit`; }}
        >
          <FilePlus size={16} />
        </button>
        <ActionButtons
          item={row}
          onView={() => { window.location.href = `/invoices/${row.id}/view`; }}
          onPrint={() => { window.open(`/invoices/${row.id}/view?print=1`, '_blank', 'noopener,noreferrer'); }}
          onDelete={handleDelete}
        />
      </div>
    )},
  ];

  // ====== Invoice Editor (Full Page) ======
  if (showEditor) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex flex-col">
        {/* Editor Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-border bg-bg-secondary">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="sm" onClick={() => { setShowEditor(false); }}>
              <ArrowRight size={20} />
            </Button>
            <div className="flex items-center gap-2 min-w-0">
              <FileText size={24} className="text-accent shrink-0" />
              <h1 className="text-lg sm:text-xl font-bold text-text-primary truncate">
                فاتورة جديدة — غير قابلة للتعديل بعد الحفظ
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => { setShowEditor(false); }}>
              <X size={18} /> إلغاء
            </Button>
            <Button onClick={handleSave} disabled={saving} leftIcon={<Save size={18} />}>
              {saving ? 'جاري الحفظ...' : 'حفظ الفاتورة'}
            </Button>
          </div>
        </div>

        <div className="flex-1 flex flex-col lg:flex-row gap-6 p-4 sm:p-6 overflow-y-auto">
          {/* Main Content - Left Side */}
          <div className="flex-1 space-y-6">
            {/* Invoice Header Card */}
            <div className="bg-bg-primary border border-border rounded-xl p-6 shadow-sm">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-4">
                  <Select
                    label="العميل"
                    value={form.client_id}
                    onChange={(v) => setForm({ ...form, client_id: v })}
                    options={[{ value: '', label: '— اختر العميل —' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
                  />
                  <Select
                    label="المشروع (اختياري — تستمد البنود منه)"
                    value={form.project_id}
                    onChange={handleProjectChange}
                    options={[{ value: '', label: '— بدون مشروع —' }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
                  />
                </div>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Input label="تاريخ الفاتورة" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                    <Input label="تاريخ الاستحقاق" type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Select
                      label="العملة"
                      value={form.currency_code}
                      onChange={(v) => {
                        const cur = currencies.find((c) => c.code === v);
                        setForm({ ...form, currency_code: v, exchange_rate: cur ? String(cur.rate) : '' });
                      }}
                      options={[{ value: '', label: 'عملة الشركة' }, ...currencies.map((c) => ({ value: c.code, label: `${c.code}${c.is_base ? ' (أساسية)' : ''}` }))]}
                    />
                    <Input
                      label="سعر الصرف"
                      type="number"
                      value={form.exchange_rate}
                      onChange={(e) => setForm({ ...form, exchange_rate: e.target.value })}
                      placeholder="1"
                    />
                  </div>
                  <div className="flex items-center gap-4 pt-2">
                    <Checkbox
                      label={`ضريبة القيمة المضافة (${vatPct}%)`}
                      checked={form.vat_enabled}
                      onChange={(checked: boolean) => setForm({ ...form, vat_enabled: checked })}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Items Table */}
            <div className="bg-bg-primary border border-border rounded-xl shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                <h2 className="text-lg font-bold text-text-primary">بنود الفاتورة</h2>
                <Button variant="ghost" size="sm" onClick={addItem} leftIcon={<Plus size={16} />}>
                  إضافة بند
                </Button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-bg-secondary text-text-secondary">
                      <th className="p-3 text-center font-medium w-10">#</th>
                      <th className="p-3 text-right font-medium">البيان / الوصف</th>
                      <th className="p-3 text-center font-medium w-20">النوع</th>
                      <th className="p-3 text-center font-medium w-24">الكمية</th>
                      <th className="p-3 text-center font-medium w-20">الوحدة</th>
                      <th className="p-3 text-center font-medium w-28">سعر الوحدة</th>
                      <th className="p-3 text-center font-medium w-20">خصم %</th>
                      <th className="p-3 text-center font-medium w-28">الإجمالي</th>
                      <th className="p-3 w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.items.map((item: InvoiceItem, i: number) => (
                      <tr key={i} className="border-t border-border hover:bg-bg-secondary/50 transition-colors">
                        <td className="p-2 text-center text-text-muted">{i + 1}</td>
                        <td className="p-2">
                          {item.item_type === 'inventory' ? (
                            <div>
                              <select
                                value={item.inventory_item_id || ''}
                                onChange={(e) => {
                                  const sel = inventoryItems.find((s) => s.id === e.target.value);
                                  const newItems = [...form.items];
                                  newItems[i] = {
                                    ...newItems[i],
                                    inventory_item_id: e.target.value || undefined,
                                    description: sel ? sel.name : newItems[i].description,
                                    unit: sel ? sel.unit : newItems[i].unit,
                                  };
                                  setForm({ ...form, items: newItems });
                                }}
                                className="w-full px-2 py-2 bg-transparent border border-transparent rounded-lg focus:border-accent focus:bg-bg-primary focus:outline-none text-text-primary"
                              >
                                <option value="">— اختر الصنف المخزني —</option>
                                {inventoryItems.map((s) => (
                                  <option key={s.id} value={s.id}>{s.name} (متاح: {s.quantity})</option>
                                ))}
                              </select>
                              {item.inventory_item_id && (() => {
                                const stock = inventoryItems.find((s) => s.id === item.inventory_item_id);
                                return stock && item.quantity > stock.quantity ? (
                                  <span className="text-xs text-danger">الكمية تتجاوز المتاح ({stock.quantity})</span>
                                ) : null;
                              })()}
                            </div>
                          ) : (
                            <input
                              type="text"
                              placeholder="وصف الصنف أو الخدمة..."
                              value={item.description}
                              onChange={(e) => updateItem(i, 'description', e.target.value)}
                              className="w-full px-3 py-2 bg-transparent border border-transparent rounded-lg focus:border-accent focus:bg-bg-primary focus:outline-none transition-colors text-text-primary"
                            />
                          )}
                        </td>
                        <td className="p-2">
                          <select
                            value={item.item_type || 'service'}
                            onChange={(e) => updateItem(i, 'item_type', e.target.value)}
                            className="w-full px-2 py-2 bg-transparent border border-transparent rounded-lg focus:border-accent focus:bg-bg-primary focus:outline-none text-sm text-text-secondary"
                          >
                            <option value="service">خدمة</option>
                            <option value="product">منتج</option>
                            <option value="inventory">مخزون</option>
                          </select>
                        </td>
                        <td className="p-2">
                          <input
                            type="number"
                            value={item.quantity}
                            onChange={(e) => updateItem(i, 'quantity', parseFloat(e.target.value) || 0)}
                            className="w-full px-2 py-2 bg-transparent border border-transparent rounded-lg focus:border-accent focus:bg-bg-primary focus:outline-none text-center text-text-primary"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={item.unit || 'وحدة'}
                            onChange={(e) => updateItem(i, 'unit', e.target.value)}
                            className="w-full px-2 py-2 bg-transparent border border-transparent rounded-lg focus:border-accent focus:bg-bg-primary focus:outline-none text-center text-text-primary text-sm"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="number"
                            value={item.unitPrice}
                            onChange={(e) => updateItem(i, 'unitPrice', parseFloat(e.target.value) || 0)}
                            className="w-full px-2 py-2 bg-transparent border border-transparent rounded-lg focus:border-accent focus:bg-bg-primary focus:outline-none text-center text-text-primary"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="number"
                            value={item.discount || 0}
                            onChange={(e) => updateItem(i, 'discount', parseFloat(e.target.value) || 0)}
                            className="w-full px-2 py-2 bg-transparent border border-transparent rounded-lg focus:border-accent focus:bg-bg-primary focus:outline-none text-center text-text-primary"
                            placeholder="0"
                          />
                        </td>
                        <td className="p-2 text-center font-bold text-text-primary whitespace-nowrap">
                          {formatCurrency(item.total || 0)}
                        </td>
                        <td className="p-2">
                          {form.items.length > 1 && (
                            <button
                              onClick={() => removeItem(i)}
                              className="p-1.5 rounded-lg text-danger hover:bg-danger/10 transition-colors"
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="px-6 py-3 border-t border-border bg-bg-secondary/30">
                <Button variant="ghost" size="sm" onClick={addItem} leftIcon={<Plus size={16} />}>
                  إضافة بند جديد
                </Button>
              </div>
            </div>

            {/* Notes */}
            <div className="bg-bg-primary border border-border rounded-xl p-6 shadow-sm">
              <Textarea
                label="ملاحظات الفاتورة"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="أضف ملاحظات تظهر على الفاتورة..."
              />
            </div>
          </div>

          {/* Sidebar - Totals (Right Side) */}
          <div className="w-full lg:w-80 shrink-0 space-y-4">
            <div className="bg-bg-primary border border-border rounded-xl shadow-sm sticky top-0">
              <div className="px-6 py-4 border-b border-border">
                <h2 className="text-lg font-bold text-text-primary">ملخص الفاتورة</h2>
              </div>
              <div className="p-6 space-y-4">
                {/* Totals breakdown */}
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-text-secondary">عدد البنود</span>
                    <span className="font-bold text-text-primary">{form.items.length}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-text-secondary">الإجمالي قبل الخصم</span>
                    <span className="font-bold text-text-primary">{formatCurrency(subtotal + totalDiscount)}</span>
                  </div>
                  {totalDiscount > 0 && (
                    <div className="flex justify-between items-center">
                      <span className="text-text-secondary">إجمالي الخصم</span>
                      <span className="font-bold text-danger">- {formatCurrency(totalDiscount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center pt-2 border-t border-border">
                    <span className="text-text-secondary">المجموع الفرعي</span>
                    <span className="font-bold text-text-primary text-lg" data-testid="invoice-subtotal">{formatCurrency(subtotal)}</span>
                  </div>
                  {form.vat_enabled && (
                    <div className="flex justify-between items-center">
                      <span className="text-text-secondary">ضريبة القيمة المضافة ({vatPct}%)</span>
                      <span className="font-bold text-text-primary" data-testid="invoice-vat">{formatCurrency(vatAmount)}</span>
                    </div>
                  )}
                </div>

                {/* Grand Total */}
                <div className="bg-accent/10 border border-accent/20 rounded-xl p-4">
                  <div className="flex justify-between items-center">
                    <span className="text-text-secondary text-sm">الإجمالي النهائي</span>
                    <span className="text-2xl font-bold text-accent" data-testid="invoice-total">{formatCurrency(total)}</span>
                  </div>
                </div>

                {/* VAT toggle info */}
                <div className="flex items-center justify-between bg-bg-secondary rounded-lg p-3">
                  <span className="text-xs text-text-secondary">حالة الضريبة</span>
                  <Badge variant={form.vat_enabled ? 'success' : 'warning'}>
                    {form.vat_enabled ? `مفعّلة (${vatPct}%)` : 'معفاة'}
                  </Badge>
                </div>
              </div>

              {/* Action buttons */}
              <div className="px-6 py-4 border-t border-border space-y-2">
                <Button onClick={handleSave} disabled={saving} className="w-full" leftIcon={<Save size={18} />}>
                  {saving ? 'جاري الحفظ...' : 'حفظ الفاتورة'}
                </Button>
                <Button variant="ghost" className="w-full" onClick={() => { setShowEditor(false); }}>
                  إلغاء
                </Button>
              </div>
            </div>

            {saveError && (
              <div className="bg-danger/10 border border-danger/30 rounded-xl p-4 text-danger text-sm">
                {saveError}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ====== Invoice List View ======
  if (loading) return <LoadingSkeleton variant="table" count={8} />;
  if (error) return <div className="p-6"><div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div></div>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="الفواتير"
        description="إدارة فواتير المبيعات والضريبية"
        actions={
          <Button onClick={openNewInvoice} leftIcon={<Plus size={18} />}>
            فاتورة جديدة
          </Button>
        }
      />

      <div className="flex gap-2">
        <Button variant={statusTab === 'all' ? 'primary' : 'secondary'} size="sm" onClick={() => setStatusTab('all')}>الكل</Button>
        <Button variant={statusTab === 'unpaid' ? 'primary' : 'secondary'} size="sm" onClick={() => setStatusTab('unpaid')}>غير مدفوعة</Button>
        <Button variant={statusTab === 'partial' ? 'primary' : 'secondary'} size="sm" onClick={() => setStatusTab('partial')}>مدفوعة جزئياً</Button>
        <Button variant={statusTab === 'paid' ? 'primary' : 'secondary'} size="sm" onClick={() => setStatusTab('paid')}>مدفوعة</Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="لا توجد فواتير" description="أنشئ فاتورة جديدة لبدء التسجيل" actionLabel="فاتورة جديدة" onAction={openNewInvoice} />
      ) : (
        <DataTable columns={columns} data={filtered} searchable searchKeys={['contact_name', 'number']} />
      )}
    </div>
  );
}
