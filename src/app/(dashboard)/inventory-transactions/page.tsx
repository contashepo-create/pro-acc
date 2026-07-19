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

export default function InventoryTransactionsPage() {
  const [transactions, setTransactions] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<any>({
    item_id: '', warehouse_id: '', type: 'add', quantity: 0, unit_price: 0,
    date: new Date().toISOString().split('T')[0], notes: '',
  });

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const [txnRes, itemRes, whRes] = await Promise.all([
        fetch('/api/inventory-transactions'),
        fetch('/api/inventory'),
        fetch('/api/warehouses'),
      ]);
      const [txnJson, itemJson, whJson] = await Promise.all([
        txnRes.json(),
        itemRes.json(),
        whRes.json(),
      ]);
      if (txnJson.success) setTransactions(txnJson.data?.transactions || []);
      else setError(txnJson.message || 'فشل');
      if (itemJson.success) setItems(itemJson.data?.items || []);
      if (whJson.success) setWarehouses(whJson.data?.warehouses || []);
    } catch { setError('فشل تحميل البيانات'); } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleSave = async () => {
    if (!form.item_id || !form.warehouse_id || !form.quantity || form.quantity <= 0) {
      setSaveError('الصنف والمستودع والكمية مطلوبة');
      return;
    }
    setSaving(true); setSaveError('');
    try {
      const url = editingTransaction ? `/api/inventory-transactions/${editingTransaction.id}` : '/api/inventory-transactions';
      const method = editingTransaction ? 'PUT' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          total_value: form.quantity * form.unit_price,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setEditingTransaction(null);
        setForm({
          item_id: '', warehouse_id: '', type: 'add', quantity: 0, unit_price: 0,
          date: new Date().toISOString().split('T')[0], notes: '',
        });
        fetchData();
      } else setSaveError(json.message || 'فشل الحفظ');
    } catch (e: any) { setSaveError('خطأ في الاتصال'); } finally { setSaving(false); }
  };

  const handleEdit = async (transaction: any) => {
    try {
      const res = await fetch(`/api/inventory-transactions/${transaction.id}`);
      const json = await res.json();
      if (json.success) {
        setEditingTransaction(transaction);
        setForm({
          item_id: json.data.item_id,
          warehouse_id: json.data.warehouse_id,
          type: json.data.type,
          quantity: json.data.quantity,
          unit_price: json.data.unit_price,
          date: json.data.date,
          notes: json.data.notes || '',
        });
        setShowModal(true);
      }
    } catch (e) {
      console.error('Failed to load transaction:', e);
    }
  };

  const handleDelete = async (transaction: any) => {
    try {
      const res = await fetch(`/api/inventory-transactions/${transaction.id}`, { method: 'DELETE' });
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

  const typeBadge = (type: string) => {
    const map: Record<string, { variant: 'success' | 'danger' | 'warning' | 'info'; label: string }> = {
      add: { variant: 'success', label: 'إضافة' },
      issue: { variant: 'danger', label: 'صرف' },
      adjustment: { variant: 'warning', label: 'تسوية' },
      transfer: { variant: 'info', label: 'تحويل' },
    };
    const m = map[type] || { variant: 'info', label: type };
    return <Badge variant={m.variant}>{m.label}</Badge>;
  };

  const columns = [
    { key: 'item_name', label: 'الصنف', sortable: true },
    { key: 'warehouse_name', label: 'المستودع', sortable: true },
    { key: 'type', label: 'النوع', render: (row: any) => typeBadge(row.type) },
    { key: 'quantity', label: 'الكمية', sortable: true },
    { key: 'unit_price', label: 'السعر', render: (row: any) => formatCurrency(row.unit_price) },
    { key: 'total_value', label: 'الإجمالي', render: (row: any) => formatCurrency(row.total_value) },
    { key: 'date', label: 'التاريخ', render: (row: any) => formatDate(row.date) },
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
      <PageHeader title="معاملات المخزون" description="إضافة وعرض معاملات المخزون" actions={<Button onClick={() => { setEditingTransaction(null); setShowModal(true); }} leftIcon={<Plus size={18} />}>إضافة معاملة</Button>} />
      {transactions.length === 0 ? <EmptyState title="لا توجد معاملات" actionLabel="إضافة معاملة" onAction={() => setShowModal(true)} /> : <DataTable columns={columns} data={transactions} searchable searchKeys={['item_name', 'warehouse_name']} />}
      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setEditingTransaction(null); }} title={editingTransaction ? 'تعديل معاملة مخزون' : 'إضافة معاملة مخزون'} size="lg" footer={<div className="flex gap-2"><Button variant="ghost" onClick={() => { setShowModal(false); setEditingTransaction(null); }}>إلغاء</Button><Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</Button></div>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Select label="الصنف" value={form.item_id} onChange={(v) => setForm({...form, item_id: v})} options={[{ value: '', label: 'اختر صنفاً' }, ...items.map((i: any) => ({ value: i.id, label: `${i.code} - ${i.name}` }))]} className="col-span-2" />
            <Select label="المستودع" value={form.warehouse_id} onChange={(v) => setForm({...form, warehouse_id: v})} options={[{ value: '', label: 'اختر مستودعاً' }, ...warehouses.map((w: any) => ({ value: w.id, label: w.name }))]} />
            <Select label="النوع" value={form.type} onChange={(v) => setForm({...form, type: v})} options={[{ value: 'add', label: 'إضافة' }, { value: 'issue', label: 'صرف' }, { value: 'adjustment', label: 'تسوية' }, { value: 'transfer', label: 'تحويل' }]} />
            <Input label="الكمية" type="number" value={form.quantity} onChange={(e) => setForm({...form, quantity: parseFloat(e.target.value) || 0})} />
            <Input label="سعر الوحدة" type="number" value={form.unit_price} onChange={(e) => setForm({...form, unit_price: parseFloat(e.target.value) || 0})} />
            <Input label="التاريخ" type="date" value={form.date} onChange={(e) => setForm({...form, date: e.target.value})} />
          </div>
          <Textarea label="ملاحظات" value={form.notes} onChange={(e) => setForm({...form, notes: e.target.value})} placeholder="ملاحظات المعاملة" />
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
