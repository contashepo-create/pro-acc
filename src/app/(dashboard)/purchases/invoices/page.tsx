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
import { RecordViewModal } from '@/components/ui/RecordViewModal';
import { formatDate, formatCurrency } from '@/lib/utils';
import { fetchRecord, applyDates, recordOrRow } from '@/lib/form-utils';
import { toast } from '@/components/ui/Toast';
import { formatDocumentNumber } from '@/lib/document-number';

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
  const [viewingInvoice, setViewingInvoice] = useState<any>(null);
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

  const applyPurchaseOrder = (orderId: string) => {
    if (!orderId) {
      setForm({ ...form, purchase_order_id: '' });
      return;
    }
    const order = orders.find((candidate: any) => candidate.id === orderId);
    if (!order) {
      setForm({ ...form, purchase_order_id: orderId });
      return;
    }
    setForm({
      ...form,
      purchase_order_id: orderId,
      supplier_id: order.supplier_id || form.supplier_id,
      items: (order.items || []).map((item: any) => ({
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
    const { data, error } = await fetchRecord(`/api/purchases/invoices/${invoice.id}`);
    const src = recordOrRow(data, invoice);
    if (!data && error) toast.error(error);
    setEditingInvoice(invoice);
    setForm(applyDates({
      date: src.date,
      supplier_id: src.supplier_id || '',
      purchase_order_id: src.purchase_order_id || '',
      notes: src.notes || '',
      tax_percent: Math.round((Number(src.tax_rate) || 0) * 100),
      status: src.status || 'unpaid',
      items: src.items?.length ? src.items : [{ ...emptyItem }],
    }, ['date']));
    setShowModal(true);
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
    { key: 'invoice_number', label: 'الرقم', sortable: true, render: (row: any) => formatDocumentNumber('purchase_invoice', row.number || row.invoice_number) },
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
          onView={async () => {
            try {
              const res = await fetch(`/api/purchases/invoices/${row.id}`);
              const json = await res.json();
              if (json.success) setViewingInvoice(json.data);
              else toast.error(json.message || 'تعذر عرض الفاتورة');
            } catch { toast.error('تعذر عرض الفاتورة'); }
          }}
          onEdit={row.status !== 'cancelled' ? handleEdit : undefined}
          onDelete={!row.journal_entry_id && (parseFloat(row.paid_amount) || 0) <= 0 ? handleDelete : undefined}
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
              <Select label="المورد" value={form.supplier_id} onChange={(v) => setForm({ ...form, supplier_id: v })} options={[{ value: '', label: 'اختر مورداً' }, ...suppliers.map((s: any) => ({ value: s.id, label: s.name }))]} />
            )}
            {!isEdit && (
              <>
                <Select label="أمر الشراء (اختياري)" value={form.purchase_order_id} onChange={applyPurchaseOrder} options={[{ value: '', label: 'بدون' }, ...orders.filter((order: any) => order.status === 'received').map((o: any) => ({ value: o.id, label: `${formatDocumentNumber('purchase_order', o.number || o.po_number)} — ${o.supplier_name || ''}` }))]} />
                <Input label="نسبة الضريبة %" type="number" min={0} max={100} value={form.tax_percent} onChange={(e) => setForm({ ...form, tax_percent: Number(e.target.value) })} />
              </>
            )}
          </div>

          {!isEdit && orders.some((order: any) => order.status !== 'received' && order.status !== 'cancelled') && (
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
                {viewingInvoice.items.map((it: any, idx: number) => (
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
