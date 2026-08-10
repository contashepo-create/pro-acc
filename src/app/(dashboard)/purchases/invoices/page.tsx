'use client';

import { useState, useEffect } from 'react';
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
import { formatDate, formatCurrency } from '@/lib/utils';

interface PurchaseItem {
  description: string;
  quantity: number;
  unit_price: number;
}

const emptyItem: PurchaseItem = { description: '', quantity: 1, unit_price: 0 };

const STATUS_LABELS: Record<string, { variant: 'success' | 'warning' | 'info' | 'danger'; label: string }> = {
  paid: { variant: 'success', label: 'مدفوعة' },
  unpaid: { variant: 'warning', label: 'غير مدفوعة' },
  partial: { variant: 'info', label: 'مدفوعة جزئياً' },
  cancelled: { variant: 'danger', label: 'ملغاة' },
};

export default function PurchaseInvoicesPage() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<any>({
    date: new Date().toISOString().split('T')[0],
    supplier_id: '',
    purchase_order_id: '',
    notes: '',
    tax_percent: 15,
    status: 'unpaid',
    items: [{ ...emptyItem }],
  });

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const [invRes, supRes, ordRes] = await Promise.all([
        fetch('/api/purchases/invoices'),
        fetch('/api/contacts?type=supplier'),
        fetch('/api/purchases/orders'),
      ]);
      const [invJson, supJson, ordJson] = await Promise.all([
        invRes.json(),
        supRes.json(),
        ordRes.json(),
      ]);
      if (invJson.success) setInvoices(invJson.data?.invoices || []);
      else setError(invJson.message || 'فشل');
      if (supJson.success) setSuppliers(supJson.data?.contacts || []);
      if (ordJson.success) setOrders(ordJson.data?.orders || []);
    } catch { setError('فشل تحميل البيانات'); } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const subtotal = form.items.reduce((s: number, it: PurchaseItem) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0);
  const taxAmount = subtotal * ((Number(form.tax_percent) || 0) / 100);
  const grandTotal = subtotal + taxAmount;

  const addItem = () => setForm({ ...form, items: [...form.items, { ...emptyItem }] });
  const removeItem = (index: number) => {
    if (form.items.length <= 1) return;
    setForm({ ...form, items: form.items.filter((_: any, i: number) => i !== index) });
  };
  const updateItem = (index: number, patch: Partial<PurchaseItem>) => {
    setForm({
      ...form,
      items: form.items.map((it: PurchaseItem, i: number) => (i === index ? { ...it, ...patch } : it)),
    });
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

  const handleEdit = async (invoice: any) => {
    try {
      const res = await fetch(`/api/purchases/invoices/${invoice.id}`);
      const json = await res.json();
      if (json.success) {
        setEditingInvoice(invoice);
        setForm({
          date: json.data.date,
          supplier_id: json.data.supplier_id,
          purchase_order_id: json.data.purchase_order_id || '',
          notes: json.data.notes || '',
          tax_percent: Math.round((Number(json.data.tax_rate) || 0) * 100),
          status: json.data.status || 'unpaid',
          items: json.data.items?.length ? json.data.items : [{ ...emptyItem }],
        });
        setShowModal(true);
      }
    } catch (e) {
      console.error('Failed to load invoice:', e);
    }
  };

  const handleDelete = async (invoice: any) => {
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

  const columns = [
    { key: 'invoice_number', label: 'الرقم', sortable: true },
    { key: 'date', label: 'التاريخ', render: (row: any) => formatDate(row.date) },
    { key: 'supplier_name', label: 'المورد', sortable: true },
    { key: 'total', label: 'الإجمالي', render: (row: any) => formatCurrency(row.total) },
    { key: 'paid_amount', label: 'المدفوع', render: (row: any) => formatCurrency(row.paid_amount || 0) },
    {
      key: 'status', label: 'الحالة', render: (row: any) => {
        const m = STATUS_LABELS[row.status] || { variant: 'warning' as const, label: row.status || 'غير مدفوعة' };
        return <Badge variant={m.variant}>{m.label}</Badge>;
      }
    },
    {
      key: 'actions',
      label: 'إجراءات',
      render: (row: any) => (
        <ActionButtons
          item={row}
          onEdit={row.status !== 'cancelled' ? handleEdit : undefined}
          onDelete={handleDelete}
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
          <div className="grid grid-cols-2 gap-4">
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
              <Select label="المورد" value={form.supplier_id} onChange={(v) => setForm({ ...form, supplier_id: v })} options={[{ value: '', label: 'اختر مورداً' }, ...suppliers.map((s: any) => ({ value: s.id, label: s.name }))]} />
            )}
            {!isEdit && (
              <>
                <Select label="أمر الشراء (اختياري)" value={form.purchase_order_id} onChange={(v) => setForm({ ...form, purchase_order_id: v })} options={[{ value: '', label: 'بدون' }, ...orders.map((o: any) => ({ value: o.id, label: `#${o.po_number}` }))]} />
                <Input label="نسبة الضريبة %" type="number" min={0} max={100} value={form.tax_percent} onChange={(e) => setForm({ ...form, tax_percent: Number(e.target.value) })} />
              </>
            )}
          </div>

          {!isEdit && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">البنود</span>
                <Button variant="ghost" size="sm" onClick={addItem} leftIcon={<Plus size={16} />}>إضافة بند</Button>
              </div>
              <div className="border border-border rounded-lg overflow-hidden">
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
                <div>المجموع الفرعي: <span className="font-semibold">{formatCurrency(subtotal)}</span></div>
                <div>الضريبة ({form.tax_percent}%): <span className="font-semibold">{formatCurrency(taxAmount)}</span></div>
                <div className="text-base">الإجمالي: <span className="font-bold">{formatCurrency(grandTotal)}</span></div>
              </div>
            </div>
          )}

          <Textarea label="ملاحظات" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="ملاحظات الفاتورة" />
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
