'use client';

import { useState, useEffect } from 'react';
import { Plus, Trash2, ArrowRight, FileText, Save, X, Search, Eye } from 'lucide-react';
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

interface InvoiceItem {
  id?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  total: number;
  item_type?: 'service' | 'product' | 'inventory';
  unit?: string;
  save_to_inventory?: boolean;
  item_code?: string;
}

const emptyItem: InvoiceItem = {
  description: '', quantity: 1, unitPrice: 0, discount: 0, total: 0,
  item_type: 'service', unit: 'وحدة', save_to_inventory: false,
};

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showEditor, setShowEditor] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [statusTab, setStatusTab] = useState('all');

  const [form, setForm] = useState<any>({
    client_id: '',
    project_id: '',
    date: new Date().toISOString().split('T')[0],
    due_date: '',
    notes: '',
    vat_enabled: true,
    items: [{ ...emptyItem }] as InvoiceItem[],
  });

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const [invRes, cliRes, projRes] = await Promise.all([
        fetch('/api/invoices'),
        fetch('/api/clients'),
        fetch('/api/projects'),
      ]);
      const [invJson, cliJson, projJson] = await Promise.all([
        invRes.json(), cliRes.json(), projRes.json(),
      ]);
      if (invJson.success) setInvoices(invJson.data?.invoices || []);
      else setError(invJson.message || 'فشل');
      if (cliJson.success) setClients(cliJson.data?.clients || []);
      if (projJson.success) setProjects(projJson.data?.projects || []);
    } catch { setError('فشل تحميل البيانات'); } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const openNewInvoice = () => {
    setEditingInvoice(null);
    setForm({
      client_id: '',
      project_id: '',
      date: new Date().toISOString().split('T')[0],
      due_date: '',
      notes: '',
      vat_enabled: true,
      items: [{ ...emptyItem }],
    });
    setSaveError('');
    setShowEditor(true);
  };

  const handleEdit = async (invoice: any) => {
    try {
      const res = await fetch(`/api/invoices/${invoice.id}`);
      const json = await res.json();
      if (json.success) {
        setEditingInvoice(invoice);
        setForm({
          client_id: json.data.contact_id,
          project_id: json.data.project_id || '',
          date: json.data.date,
          due_date: json.data.due_date || '',
          notes: json.data.notes || '',
          vat_enabled: (json.data.vat_rate || json.data.tax_rate || 0) > 0,
          items: json.data.items?.map((i: any) => ({
            id: i.id,
            description: i.description,
            quantity: i.quantity,
            unitPrice: i.unit_price,
            discount: 0,
            total: i.total,
            item_type: i.item_type || 'service',
            unit: i.unit || 'وحدة',
            save_to_inventory: false,
          })) || [{ ...emptyItem }],
        });
        setSaveError('');
        setShowEditor(true);
      } else { toast.error(json.message || 'فشل تحميل الفاتورة'); }
    } catch { toast.error('خطأ في الاتصال بالخادم'); }
  };

  const handleSave = async () => {
    if (!form.client_id) { setSaveError('يجب اختيار عميل'); return; }
    const validItems = form.items.filter((i: InvoiceItem) => i.description && i.quantity > 0);
    if (validItems.length === 0) { setSaveError('يجب إضافة صنف واحد على الأقل'); return; }

    setSaving(true); setSaveError('');
    try {
      const subtotal = validItems.reduce((sum: number, item: InvoiceItem) => sum + item.total, 0);
      const vatRate = form.vat_enabled ? 0.15 : 0;
      const vatAmount = subtotal * vatRate;
      const total = subtotal + vatAmount;

      const url = editingInvoice ? `/api/invoices/${editingInvoice.id}` : '/api/invoices';
      const method = editingInvoice ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: form.client_id,
          projectId: form.project_id || null,
          date: form.date,
          dueDate: form.due_date || form.date,
          items: validItems.map((i: InvoiceItem) => ({
            description: i.description, quantity: i.quantity, unitPrice: i.unitPrice, total: i.total,
            item_type: i.item_type || 'service', unit: i.unit || 'وحدة',
            save_to_inventory: i.save_to_inventory || false, item_code: i.item_code || undefined,
          })),
          subtotal, vatRate, vatAmount, vatEnabled: form.vat_enabled, total, notes: form.notes,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setShowEditor(false);
        setEditingInvoice(null);
        toast.success(editingInvoice ? 'تم تحديث الفاتورة بنجاح' : 'تم إضافة الفاتورة بنجاح');
        fetchData();
      } else { setSaveError(json.message || 'فشل الحفظ'); }
    } catch { setSaveError('خطأ في الاتصال بالخادم'); } finally { setSaving(false); }
  };

  const handleDelete = async (invoice: any) => {
    try {
      const res = await fetch(`/api/invoices/${invoice.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) { toast.success('تم حذف الفاتورة بنجاح'); fetchData(); }
      else { toast.error(json.message || 'فشل الحذف'); }
    } catch { toast.error('خطأ في الاتصال بالخادم'); }
  };

  const addItem = () => setForm({ ...form, items: [...form.items, { ...emptyItem }] });

  const removeItem = (index: number) => {
    if (form.items.length === 1) return;
    setForm({ ...form, items: form.items.filter((_: any, i: number) => i !== index) });
  };

  const updateItem = (index: number, field: keyof InvoiceItem, value: any) => {
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
  const vatAmount = form.vat_enabled ? subtotal * 0.15 : 0;
  const total = subtotal + vatAmount;

  const statusBadge = (status: string) => {
    const map: Record<string, { variant: 'success' | 'warning' | 'danger' | 'info'; label: string }> = {
      unpaid: { variant: 'warning', label: 'غير مدفوعة' },
      partial: { variant: 'info', label: 'مدفوعة جزئياً' },
      paid: { variant: 'success', label: 'مدفوعة' },
      cancelled: { variant: 'danger', label: 'ملغاة' },
    };
    const m = map[status] || { variant: 'warning', label: status };
    return <Badge variant={m.variant}>{m.label}</Badge>;
  };

  const filtered = statusTab === 'all' ? invoices : invoices.filter(i => i.status === statusTab);

  const columns = [
    { key: 'number', label: 'رقم الفاتورة', sortable: true, render: (row: any) => `#${row.number}` },
    { key: 'date', label: 'التاريخ', sortable: true, render: (row: any) => formatDate(row.date) },
    { key: 'contact_name', label: 'العميل', sortable: true },
    { key: 'total', label: 'الإجمالي', sortable: true, render: (row: any) => formatCurrency(row.total) },
    { key: 'status', label: 'الحالة', sortable: true, render: (row: any) => statusBadge(row.status) },
    { key: 'paid_amount', label: 'المدفوع', render: (row: any) => formatCurrency(row.paid_amount) },
    { key: 'actions', label: '', render: (row: any) => (
      <div className="flex items-center gap-1">
        <a href={`/invoices/${row.id}/view`} target="_blank" rel="noopener noreferrer">
          <Button variant="ghost" size="sm" title="عرض/طباعة">
            <Eye size={16} />
          </Button>
        </a>
        <ActionButtons item={row} onEdit={handleEdit} onDelete={handleDelete} />
      </div>
    )},
  ];

  // ====== Invoice Editor (Full Page) ======
  if (showEditor) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex flex-col">
        {/* Editor Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-bg-secondary">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => { setShowEditor(false); setEditingInvoice(null); }}>
              <ArrowRight size={20} />
            </Button>
            <div className="flex items-center gap-2">
              <FileText size={24} className="text-accent" />
              <h1 className="text-xl font-bold text-text-primary">
                {editingInvoice ? `تعديل فاتورة #${editingInvoice.number}` : 'فاتورة جديدة'}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => { setShowEditor(false); setEditingInvoice(null); }}>
              <X size={18} /> إلغاء
            </Button>
            <Button onClick={handleSave} disabled={saving} leftIcon={<Save size={18} />}>
              {saving ? 'جاري الحفظ...' : 'حفظ الفاتورة'}
            </Button>
          </div>
        </div>

        <div className="flex-1 flex gap-6 p-6 overflow-y-auto">
          {/* Main Content - Left Side */}
          <div className="flex-1 space-y-6">
            {/* Invoice Header Card */}
            <div className="bg-bg-primary border border-border rounded-xl p-6 shadow-sm">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-4">
                  <Select
                    label="العميل"
                    value={form.client_id}
                    onChange={(v) => setForm({ ...form, client_id: v })}
                    options={[{ value: '', label: '— اختر العميل —' }, ...clients.map((c: any) => ({ value: c.id, label: c.name }))]}
                  />
                  <Select
                    label="المشروع (اختياري)"
                    value={form.project_id}
                    onChange={(v) => setForm({ ...form, project_id: v })}
                    options={[{ value: '', label: '— بدون مشروع —' }, ...projects.map((p: any) => ({ value: p.id, label: p.name }))]}
                  />
                </div>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <Input label="تاريخ الفاتورة" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                    <Input label="تاريخ الاستحقاق" type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
                  </div>
                  <div className="flex items-center gap-4 pt-2">
                    <Checkbox
                      label="ضريبة القيمة المضافة (15%)"
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
                      <th className="p-3 text-center font-medium w-20">للمستودع</th>
                      <th className="p-3 w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.items.map((item: InvoiceItem, i: number) => (
                      <tr key={i} className="border-t border-border hover:bg-bg-secondary/50 transition-colors">
                        <td className="p-2 text-center text-text-muted">{i + 1}</td>
                        <td className="p-2">
                          <input
                            type="text"
                            placeholder="وصف الصنف أو الخدمة..."
                            value={item.description}
                            onChange={(e) => updateItem(i, 'description', e.target.value)}
                            className="w-full px-3 py-2 bg-transparent border border-transparent rounded-lg focus:border-accent focus:bg-bg-primary focus:outline-none transition-colors text-text-primary"
                          />
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
                        <td className="p-2 text-center">
                          <input
                            type="checkbox"
                            checked={item.save_to_inventory || false}
                            onChange={(e) => updateItem(i, 'save_to_inventory', e.target.checked)}
                            className="w-4 h-4 accent-accent cursor-pointer"
                          />
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
          <div className="w-80 shrink-0 space-y-4">
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
                    <span className="font-bold text-text-primary text-lg">{formatCurrency(subtotal)}</span>
                  </div>
                  {form.vat_enabled && (
                    <div className="flex justify-between items-center">
                      <span className="text-text-secondary">ضريبة القيمة المضافة (15%)</span>
                      <span className="font-bold text-text-primary">{formatCurrency(vatAmount)}</span>
                    </div>
                  )}
                </div>

                {/* Grand Total */}
                <div className="bg-accent/10 border border-accent/20 rounded-xl p-4">
                  <div className="flex justify-between items-center">
                    <span className="text-text-secondary text-sm">الإجمالي النهائي</span>
                    <span className="text-2xl font-bold text-accent">{formatCurrency(total)}</span>
                  </div>
                </div>

                {/* VAT toggle info */}
                <div className="flex items-center justify-between bg-bg-secondary rounded-lg p-3">
                  <span className="text-xs text-text-secondary">حالة الضريبة</span>
                  <Badge variant={form.vat_enabled ? 'success' : 'warning'}>
                    {form.vat_enabled ? 'مفعّلة (15%)' : 'معفاة'}
                  </Badge>
                </div>
              </div>

              {/* Action buttons */}
              <div className="px-6 py-4 border-t border-border space-y-2">
                <Button onClick={handleSave} disabled={saving} className="w-full" leftIcon={<Save size={18} />}>
                  {saving ? 'جاري الحفظ...' : editingInvoice ? 'تحديث الفاتورة' : 'حفظ الفاتورة'}
                </Button>
                <Button variant="ghost" className="w-full" onClick={() => { setShowEditor(false); setEditingInvoice(null); }}>
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
