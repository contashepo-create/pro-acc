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
import { formatDate, formatCurrency } from '@/lib/utils';

interface OrderItem { description: string; quantity: number; unitPrice: number; total: number; }

export default function PurchaseOrdersPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<any>({
    supplier_id: '', date: new Date().toISOString().split('T')[0], notes: '',
    items: [{ description: '', quantity: 1, unitPrice: 0, total: 0 }] as OrderItem[],
  });

  const handleSave = async () => {
    if (!form.supplier_id) { setSaveError('يجب اختيار مورد'); return; }
    if (form.items.length === 0 || form.items.every(i => !i.description)) { setSaveError('يجب إضافة صنف واحد على الأقل'); return; }
    setSaving(true); setSaveError('');
    try {
      const subtotal = form.items.reduce((sum: number, item: OrderItem) => sum + item.total, 0);
      const vatRate = 0.15; const vatAmount = subtotal * vatRate; const total = subtotal + vatAmount;
      const res = await fetch('/api/purchases/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supplier_id: form.supplier_id, date: form.date,
          items: form.items.map(i => ({ description: i.description, quantity: i.quantity, unit_price: i.unitPrice, total: i.total })),
          subtotal, tax_amount: vatAmount, total, notes: form.notes }) });
      const json = await res.json();
      if (json.success) { setShowModal(false); setForm({ supplier_id: '', date: new Date().toISOString().split('T')[0], notes: '',
        items: [{ description: '', quantity: 1, unitPrice: 0, total: 0 }] }); window.location.reload(); }
      else { setSaveError(json.message || 'فشل الحفظ'); }
    } catch { setSaveError('خطأ في الاتصال'); } finally { setSaving(false); }
  };

  const addItem = () => setForm({ ...form, items: [...form.items, { description: '', quantity: 1, unitPrice: 0, total: 0 }] });
  const removeItem = (index: number) => { if (form.items.length === 1) return; setForm({ ...form, items: form.items.filter((_: any, i: number) => i !== index) }); };
  const updateItem = (index: number, field: keyof OrderItem, value: any) => {
    const newItems = [...form.items]; newItems[index] = { ...newItems[index], [field]: value };
    if (field === 'quantity' || field === 'unitPrice') newItems[index].total = newItems[index].quantity * newItems[index].unitPrice;
    setForm({ ...form, items: newItems });
  };

  const subtotal = form.items.reduce((sum, item) => sum + item.total, 0);
  const vatAmount = subtotal * 0.15;
  const total = subtotal + vatAmount;

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [ordRes, supRes] = await Promise.all([fetch('/api/purchases/orders'), fetch('/api/contacts?type=supplier')]);
        const [ordJson, supJson] = await Promise.all([ordRes.json(), supRes.json()]);
        if (ordJson.success) setOrders(ordJson.data?.orders || []);
        else setError(ordJson.message || 'فشل');
        if (supJson.success) setSuppliers(supJson.data?.contacts || []);
      } catch { setError('فشل تحميل البيانات'); } finally { setLoading(false); }
    };
    fetchData();
  }, []);

  const statusBadge = (status: string) => {
    const map: Record<string, { variant: 'success' | 'warning' | 'info' | 'danger' | 'default'; label: string }> = {
      pending: { variant: 'warning', label: 'قيد الانتظار' }, partial: { variant: 'info', label: 'جزئي' },
      received: { variant: 'success', label: 'مستلم' }, cancelled: { variant: 'danger', label: 'ملغى' },
    };
    const m = map[status] || { variant: 'default', label: status };
    return <Badge variant={m.variant}>{m.label}</Badge>;
  };

  const columns = [
    { key: 'po_number', label: 'الرقم', sortable: true },
    { key: 'date', label: 'التاريخ', sortable: true, render: (row: any) => formatDate(row.date) },
    { key: 'supplier_name', label: 'المورد', sortable: true },
    { key: 'total', label: 'الإجمالي', sortable: true, render: (row: any) => formatCurrency(row.total) },
    { key: 'status', label: 'الحالة', sortable: true, render: (row: any) => statusBadge(row.status) },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;
  if (error) return <div className="p-6"><div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div></div>;

  return (
    <div className="space-y-6">
      <PageHeader title="أوامر الشراء" description="إدارة أوامر الشراء"
        actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة أمر شراء</Button>} />
      {orders.length === 0 ? <EmptyState title="لا توجد أوامر شراء" description="أضف أمر شراء جديد" actionLabel="إضافة أمر شراء" onAction={() => setShowModal(true)} /> : <DataTable columns={columns} data={orders} searchable searchKeys={['supplier_name', 'po_number']} />}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة أمر شراء" size="xl" footer={<div className="flex gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button onClick={handleSave} disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ"}</Button></div>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="التاريخ" type="date" value={form.date} onChange={(e) => setForm({...form, date: e.target.value})} />
            <Select label="المورد" value={form.supplier_id} onChange={(v) => setForm({...form, supplier_id: v})} options={[{ value: '', label: 'اختر مورداً' }, ...suppliers.map(s => ({ value: s.id, label: s.name }))]} className="col-span-2" />
          </div>
          <Textarea label="ملاحظات" value={form.notes} onChange={(e) => setForm({...form, notes: e.target.value})} placeholder="ملاحظات أمر الشراء" />
          <div className="border border-border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg-secondary"><tr><th className="p-2 text-right">البيان</th><th className="p-2 text-right w-24">الكمية</th><th className="p-2 text-right w-28">سعر الوحدة</th><th className="p-2 text-right w-28">الإجمالي</th><th className="p-2 w-10"></th></tr></thead>
              <tbody>{form.items.map((item, i) => (<tr key={i} className="border-t border-border">
                <td className="p-2"><Input placeholder="وصف الصنف" value={item.description} onChange={(e) => updateItem(i, 'description', e.target.value)} /></td>
                <td className="p-2"><Input type="number" value={item.quantity} onChange={(e) => updateItem(i, 'quantity', parseFloat(e.target.value) || 0)} /></td>
                <td className="p-2"><Input type="number" value={item.unitPrice} onChange={(e) => updateItem(i, 'unitPrice', parseFloat(e.target.value) || 0)} /></td>
                <td className="p-2"><Input type="number" value={item.total} disabled /></td>
                <td className="p-2">{form.items.length > 1 && <Button variant="ghost" size="sm" onClick={() => removeItem(i)}><Trash2 size={14} className="text-danger" /></Button>}</td>
              </tr>))}</tbody>
            </table>
          </div>
          <div className="flex justify-between items-center">
            <Button variant="ghost" onClick={addItem} leftIcon={<Plus size={16} />}>إضافة صنف</Button>
            <div className="text-left space-y-1 text-sm">
              <div>المجموع الفرعي: <strong>{formatCurrency(subtotal)}</strong></div>
              <div>ضريبة القيمة المضافة (15%): <strong>{formatCurrency(vatAmount)}</strong></div>
              <div className="text-lg">الإجمالي: <strong className="text-accent">{formatCurrency(total)}</strong></div>
            </div>
          </div>
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
