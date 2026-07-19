'use client';

import { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
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

interface OrderItem {
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
}

export default function PurchaseOrdersPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingOrder, setEditingOrder] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<any>({
    date: new Date().toISOString().split('T')[0],
    supplier_id: '',
    notes: '',
    items: [{ description: '', quantity: 1, unit_price: 0, total: 0 }] as OrderItem[],
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

  const handleSave = async () => {
    if (!form.supplier_id) { setSaveError('يجب اختيار مورد'); return; }
    setSaving(true); setSaveError('');
    try {
      const url = editingOrder ? `/api/purchases/orders/${editingOrder.id}` : '/api/purchases/orders';
      const method = editingOrder ? 'PUT' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setEditingOrder(null);
        setForm({
          date: new Date().toISOString().split('T')[0],
          supplier_id: '',
          notes: '',
          items: [{ description: '', quantity: 1, unit_price: 0, total: 0 }],
        });
        fetchData();
      } else setSaveError(json.message || 'فشل الحفظ');
    } catch (e: any) { setSaveError('خطأ في الاتصال'); } finally { setSaving(false); }
  };

  const handleEdit = async (order: any) => {
    try {
      const res = await fetch(`/api/purchases/orders/${order.id}`);
      const json = await res.json();
      if (json.success) {
        setEditingOrder(order);
        setForm({
          date: json.data.date,
          supplier_id: json.data.supplier_id,
          notes: json.data.notes || '',
          items: json.data.items || [{ description: '', quantity: 1, unit_price: 0, total: 0 }],
        });
        setShowModal(true);
      }
    } catch (e) {
      console.error('Failed to load order:', e);
    }
  };

  const handleDelete = async (order: any) => {
    try {
      const res = await fetch(`/api/purchases/orders/${order.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        fetchData();
      } else {
        alert(json.message || 'فشل الحذف');
      }
    } catch (e) {
      alert('خطأ في الاتصال بالخادم');
    }
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
        <ActionButtons
          item={row}
          onEdit={handleEdit}
          onDelete={handleDelete}
        />
      ),
    },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;
  if (error) return <div className="p-6"><div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div></div>;

  return (
    <div className="space-y-6">
      <PageHeader title="أوامر الشراء" description="إدارة أوامر الشراء" actions={<Button onClick={() => { setEditingOrder(null); setShowModal(true); }} leftIcon={<Plus size={18} />}>إضافة أمر شراء</Button>} />
      {orders.length === 0 ? <EmptyState title="لا توجد أوامر شراء" actionLabel="إضافة أمر شراء" onAction={() => setShowModal(true)} /> : <DataTable columns={columns} data={orders} searchable searchKeys={['supplier_name', 'po_number']} />}
      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setEditingOrder(null); }} title={editingOrder ? 'تعديل أمر شراء' : 'إضافة أمر شراء'} size="xl" footer={<div className="flex gap-2"><Button variant="ghost" onClick={() => { setShowModal(false); setEditingOrder(null); }}>إلغاء</Button><Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</Button></div>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="التاريخ" type="date" value={form.date} onChange={(e) => setForm({...form, date: e.target.value})} />
            <Select label="المورد" value={form.supplier_id} onChange={(v) => setForm({...form, supplier_id: v})} options={[{ value: '', label: 'اختر مورداً' }, ...suppliers.map((s: any) => ({ value: s.id, label: s.name }))]} className="col-span-2" />
          </div>
          <Textarea label="ملاحظات" value={form.notes} onChange={(e) => setForm({...form, notes: e.target.value})} placeholder="ملاحظات أمر الشراء" />
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
