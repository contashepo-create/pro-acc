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
    items: [{ description: '', quantity: 1, unit_price: 0, total: 0 }],
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

  const handleSave = async () => {
    if (!form.supplier_id) { setSaveError('يجب اختيار مورد'); return; }
    setSaving(true); setSaveError('');
    try {
      const url = editingInvoice ? `/api/purchases/invoices/${editingInvoice.id}` : '/api/purchases/invoices';
      const method = editingInvoice ? 'PUT' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
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
          items: [{ description: '', quantity: 1, unit_price: 0, total: 0 }],
        });
        fetchData();
      } else setSaveError(json.message || 'فشل الحفظ');
    } catch (e: any) { setSaveError('خطأ في الاتصال'); } finally { setSaving(false); }
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
          items: json.data.items || [{ description: '', quantity: 1, unit_price: 0, total: 0 }],
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
    } catch (e) {
      alert('خطأ في الاتصال بالخادم');
    }
  };

  const columns = [
    { key: 'invoice_number', label: 'الرقم', sortable: true },
    { key: 'date', label: 'التاريخ', render: (row: any) => formatDate(row.date) },
    { key: 'supplier_name', label: 'المورد', sortable: true },
    { key: 'total', label: 'الإجمالي', render: (row: any) => formatCurrency(row.total) },
    { key: 'paid_amount', label: 'المدفوع', render: (row: any) => formatCurrency(row.paid_amount) },
    { key: 'status', label: 'الحالة', render: (row: any) => <Badge variant={row.status === 'paid' ? 'success' : 'warning'}>{row.status === 'paid' ? 'مدفوعة' : 'غير مدفوعة'}</Badge> },
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
      <PageHeader title="فواتير المشتريات" description="إدارة فواتير الشراء" actions={<Button onClick={() => { setEditingInvoice(null); setShowModal(true); }} leftIcon={<Plus size={18} />}>إضافة فاتورة</Button>} />
      {invoices.length === 0 ? <EmptyState title="لا توجد فواتير" actionLabel="إضافة فاتورة" onAction={() => setShowModal(true)} /> : <DataTable columns={columns} data={invoices} searchable searchKeys={['supplier_name', 'invoice_number']} />}
      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setEditingInvoice(null); }} title={editingInvoice ? 'تعديل فاتورة شراء' : 'إضافة فاتورة شراء'} size="xl" footer={<div className="flex gap-2"><Button variant="ghost" onClick={() => { setShowModal(false); setEditingInvoice(null); }}>إلغاء</Button><Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</Button></div>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="التاريخ" type="date" value={form.date} onChange={(e) => setForm({...form, date: e.target.value})} />
            <Select label="المورد" value={form.supplier_id} onChange={(v) => setForm({...form, supplier_id: v})} options={[{ value: '', label: 'اختر مورداً' }, ...suppliers.map((s: any) => ({ value: s.id, label: s.name }))]} />
            <Select label="أمر الشراء (اختياري)" value={form.purchase_order_id} onChange={(v) => setForm({...form, purchase_order_id: v})} options={[{ value: '', label: 'بدون' }, ...orders.map((o: any) => ({ value: o.id, label: `#${o.po_number}` }))]} className="col-span-2" />
          </div>
          <Textarea label="ملاحظات" value={form.notes} onChange={(e) => setForm({...form, notes: e.target.value})} placeholder="ملاحظات الفاتورة" />
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
