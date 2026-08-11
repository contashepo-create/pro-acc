'use client';

import { useState, useEffect } from 'react';
import { Plus, Trash2, PackageCheck } from 'lucide-react';
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
import { fetchRecord, applyDates, recordOrRow } from '@/lib/form-utils';
import { toast } from '@/components/ui/Toast';

interface OrderItem {
  description: string;
  quantity: number;
  unit_price: number;
}

const emptyItem: OrderItem = { description: '', quantity: 1, unit_price: 0 };

export default function PurchaseOrdersPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingOrder, setEditingOrder] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const [form, setForm] = useState<any>({
    date: new Date().toISOString().split('T')[0],
    supplier_id: '',
    notes: '',
    items: [{ ...emptyItem }] as OrderItem[],
  });

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const [ordRes, supRes] = await Promise.all([
        fetch('/api/purchases/orders'),
        fetch('/api/contacts?type=supplier'),
      ]);
      const [ordJson, supJson] = await Promise.all([
        ordRes.json(),
        supRes.json(),
      ]);
      if (ordJson.success) setOrders(ordJson.data?.orders || []);
      else setError(ordJson.message || 'فشل');
      if (supJson.success) setSuppliers(supJson.data?.contacts || []);
    } catch { setError('فشل تحميل البيانات'); } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const grandTotal = form.items.reduce((s: number, it: OrderItem) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0);

  const addItem = () => setForm({ ...form, items: [...form.items, { ...emptyItem }] });
  const removeItem = (index: number) => {
    if (form.items.length <= 1) return;
    setForm({ ...form, items: form.items.filter((_: any, i: number) => i !== index) });
  };
  const updateItem = (index: number, patch: Partial<OrderItem>) => {
    setForm({
      ...form,
      items: form.items.map((it: OrderItem, i: number) => (i === index ? { ...it, ...patch } : it)),
    });
  };

  const validateItems = (): string => {
    for (const it of form.items as OrderItem[]) {
      if (!it.description.trim()) return 'أدخل بيان كل بند';
      if (!(Number(it.quantity) > 0)) return 'الكمية يجب أن تكون أكبر من صفر';
      if (Number(it.unit_price) < 0) return 'السعر لا يمكن أن يكون سالباً';
    }
    return '';
  };

  const handleSave = async () => {
    if (!form.supplier_id) { setSaveError('يجب اختيار مورد'); return; }
    const itemError = validateItems();
    if (itemError) { setSaveError(itemError); return; }
    setSaving(true); setSaveError('');
    try {
      const url = editingOrder ? `/api/purchases/orders/${editingOrder.id}` : '/api/purchases/orders';
      const method = editingOrder ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: form.date,
          supplier_id: form.supplier_id,
          notes: form.notes,
          items: form.items.map((it: OrderItem) => ({
            description: it.description.trim(),
            quantity: Number(it.quantity),
            unit_price: Number(it.unit_price),
          })),
        }),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setEditingOrder(null);
        setForm({
          date: new Date().toISOString().split('T')[0],
          supplier_id: '',
          notes: '',
          items: [{ ...emptyItem }],
        });
        fetchData();
      } else setSaveError(json.message || 'فشل الحفظ');
    } catch { setSaveError('خطأ في الاتصال'); } finally { setSaving(false); }
  };

  const handleEdit = async (order: any) => {
    const { data, error } = await fetchRecord(`/api/purchases/orders/${order.id}`);
    const src = recordOrRow(data, order);
    if (!data && error) toast.error(error);
    setEditingOrder(order);
    setForm(applyDates({
      date: src.date,
      supplier_id: src.supplier_id || '',
      notes: src.notes || '',
      items: src.items?.length ? src.items : [{ ...emptyItem }],
    }, ['date']));
    setShowModal(true);
  };

  const handleReceive = async (order: any) => {
    if (!window.confirm('تأكيد استلام كامل الكميات المتبقية لهذا الأمر؟ سيتم تحديث المخزون.')) return;
    setReceivingId(order.id);
    try {
      const res = await fetch(`/api/purchases/orders/${order.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (json.success) fetchData();
      else alert(json.message || 'فشل الاستلام');
    } catch {
      alert('خطأ في الاتصال بالخادم');
    } finally { setReceivingId(null); }
  };

  const statusBadge = (status: string) => {
    const map: Record<string, { variant: 'success' | 'warning' | 'info' | 'danger'; label: string }> = {
      pending: { variant: 'warning', label: 'قيد الانتظار' },
      partial: { variant: 'info', label: 'جزئي' },
      received: { variant: 'success', label: 'مستلم' },
      cancelled: { variant: 'danger', label: 'ملغى' },
    };
    const m = map[status] || { variant: 'warning', label: status };
    return <Badge variant={m.variant}>{m.label}</Badge>;
  };

  const columns = [
    { key: 'po_number', label: 'الرقم', sortable: true },
    { key: 'date', label: 'التاريخ', render: (row: any) => formatDate(row.date) },
    { key: 'supplier_name', label: 'المورد', sortable: true },
    { key: 'total', label: 'الإجمالي', render: (row: any) => formatCurrency(row.total) },
    { key: 'status', label: 'الحالة', render: (row: any) => statusBadge(row.status) },
    {
      key: 'actions',
      label: 'إجراءات',
      render: (row: any) => (
        <div className="flex items-center gap-2">
          {(row.status === 'pending' || row.status === 'partial') && (
            <button
              type="button"
              className="text-success hover:opacity-70 transition disabled:opacity-40"
              title="استلام البضاعة"
              onClick={() => handleReceive(row)}
              disabled={receivingId === row.id}
            >
              <PackageCheck size={18} />
            </button>
          )}
          <ActionButtons
            item={row}
            onEdit={row.status === 'pending' ? handleEdit : undefined}
            onDelete={row.status !== 'received' ? handleDelete : undefined}
          />
        </div>
      ),
    },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;
  if (error) return <div className="p-6"><div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div></div>;

  const handleDelete = async (order: any) => {
    try {
      const res = await fetch(`/api/purchases/orders/${order.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        fetchData();
      } else {
        alert(json.message || 'فشل الإلغاء');
      }
    } catch {
      alert('خطأ في الاتصال بالخادم');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="أوامر الشراء" description="إدارة أوامر الشراء" actions={<Button onClick={() => { setEditingOrder(null); setForm({ date: new Date().toISOString().split('T')[0], supplier_id: '', notes: '', items: [{ ...emptyItem }] }); setShowModal(true); }} leftIcon={<Plus size={18} />}>إضافة أمر شراء</Button>} />
      {orders.length === 0 ? <EmptyState title="لا توجد أوامر شراء" actionLabel="إضافة أمر شراء" onAction={() => setShowModal(true)} /> : <DataTable columns={columns} data={orders} searchable searchKeys={['supplier_name', 'po_number']} />}
      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setEditingOrder(null); }} title={editingOrder ? 'تعديل أمر شراء' : 'إضافة أمر شراء'} size="xl" footer={<div className="flex gap-2"><Button variant="ghost" onClick={() => { setShowModal(false); setEditingOrder(null); }}>إلغاء</Button><Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</Button></div>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="التاريخ" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            <Select label="المورد" value={form.supplier_id} onChange={(v) => setForm({ ...form, supplier_id: v })} options={[{ value: '', label: 'اختر مورداً' }, ...suppliers.map((s: any) => ({ value: s.id, label: s.name }))]} />
          </div>

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
                  {form.items.map((item: OrderItem, i: number) => (
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
            <div className="flex justify-end border-t border-border pt-3">
              <div className="text-base">الإجمالي: <span className="font-bold">{formatCurrency(grandTotal)}</span></div>
            </div>
          </div>

          <Textarea label="ملاحظات" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="ملاحظات أمر الشراء" />
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
