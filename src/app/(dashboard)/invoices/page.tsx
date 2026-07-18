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

interface InvoiceItem {
  id?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<any>({
    client_id: '',
    project_id: '',
    date: new Date().toISOString().split('T')[0],
    due_date: '',
    notes: '',
    items: [{ description: '', quantity: 1, unitPrice: 0, total: 0 }] as InvoiceItem[],
  });

  const handleSave = async () => {
    if (!form.client_id) {
      setSaveError('يجب اختيار عميل');
      return;
    }
    if (form.items.length === 0 || form.items.every((i: InvoiceItem) => !i.description)) {
      setSaveError('يجب إضافة صنف واحد على الأقل');
      return;
    }

    setSaving(true);
    setSaveError('');
    try {
      const subtotal = form.items.reduce((sum: number, item: InvoiceItem) => sum + item.total, 0);
      const vatRate = 0.15;
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
          items: form.items.map((i: InvoiceItem) => ({
            description: i.description,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            total: i.total,
          })),
          subtotal,
          vatRate,
          vatAmount,
          total,
          notes: form.notes,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setEditingInvoice(null);
        setForm({
          client_id: '',
          project_id: '',
          date: new Date().toISOString().split('T')[0],
          due_date: '',
          notes: '',
          items: [{ description: '', quantity: 1, unitPrice: 0, total: 0 }],
        });
        window.location.reload();
      } else {
        setSaveError(json.message || 'فشل الحفظ');
      }
    } catch (e: any) {
      setSaveError('خطأ في الاتصال بالخادم');
    } finally {
      setSaving(false);
    }
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
          items: json.data.items?.map((i: any) => ({
            id: i.id,
            description: i.description,
            quantity: i.quantity,
            unitPrice: i.unit_price,
            total: i.total,
          })) || [{ description: '', quantity: 1, unitPrice: 0, total: 0 }],
        });
        setShowModal(true);
      }
    } catch (e) {
      console.error('Failed to load invoice:', e);
    }
  };

  const handleDelete = async (invoice: any) => {
    try {
      const res = await fetch(`/api/invoices/${invoice.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        window.location.reload();
      } else {
        alert(json.message || 'فشل الحذف');
      }
    } catch (e) {
      alert('خطأ في الاتصال بالخادم');
    }
  };

  const addItem = () => {
    setForm({
      ...form,
      items: [...form.items, { description: '', quantity: 1, unitPrice: 0, total: 0 }],
    });
  };

  const removeItem = (index: number) => {
    if (form.items.length === 1) return;
    setForm({
      ...form,
      items: form.items.filter((_: any, i: number) => i !== index),
    });
  };

  const updateItem = (index: number, field: keyof InvoiceItem, value: any) => {
    const newItems = [...form.items];
    newItems[index] = { ...newItems[index], [field]: value };
    if (field === 'quantity' || field === 'unitPrice') {
      newItems[index].total = newItems[index].quantity * newItems[index].unitPrice;
    }
    setForm({ ...form, items: newItems });
  };

  const subtotal = form.items.reduce((sum, item) => sum + item.total, 0);
  const vatAmount = subtotal * 0.15;
  const total = subtotal + vatAmount;

  const [statusTab, setStatusTab] = useState('all');

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [invRes, cliRes, projRes] = await Promise.all([
          fetch('/api/invoices'),
          fetch('/api/clients'),
          fetch('/api/projects'),
        ]);
        const [invJson, cliJson, projJson] = await Promise.all([
          invRes.json(),
          cliRes.json(),
          projRes.json(),
        ]);
        if (invJson.success) setInvoices(invJson.data?.invoices || []);
        else setError(invJson.message || 'فشل');
        if (cliJson.success) setClients(cliJson.data?.clients || []);
        if (projJson.success) setProjects(projJson.data?.projects || []);
      } catch {
        setError('فشل تحميل البيانات');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

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
    { key: 'number', label: 'الرقم', sortable: true, render: (row: any) => `#${row.number}` },
    { key: 'date', label: 'التاريخ', sortable: true, render: (row: any) => formatDate(row.date) },
    { key: 'contact_name', label: 'العميل', sortable: true },
    { key: 'total', label: 'الإجمالي', sortable: true, render: (row: any) => formatCurrency(row.total) },
    { key: 'status', label: 'الحالة', sortable: true, render: (row: any) => statusBadge(row.status) },
    { key: 'paid_amount', label: 'المدفوع', render: (row: any) => formatCurrency(row.paid_amount) },
    {
      key: 'actions',
      label: 'إجراءات',
      render: (row: any) => (
        <ActionButtons
          item={row}
          onEdit={handleEdit}
          onDelete={handleDelete}
          status={row.status}
          showStatus={false}
        />
      ),
    },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;
  if (error) return <div className="p-6"><div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div></div>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="الفواتير"
        description="إدارة فواتير المبيعات"
        actions={
          <Button onClick={() => { setEditingInvoice(null); setShowModal(true); }} leftIcon={<Plus size={18} />}>
            إضافة فاتورة
          </Button>
        }
      />
      
      <div className="flex gap-4">
        <Button variant={statusTab === 'all' ? 'primary' : 'secondary'} size="sm" onClick={() => setStatusTab('all')}>الكل</Button>
        <Button variant={statusTab === 'unpaid' ? 'primary' : 'secondary'} size="sm" onClick={() => setStatusTab('unpaid')}>غير مدفوعة</Button>
        <Button variant={statusTab === 'partial' ? 'primary' : 'secondary'} size="sm" onClick={() => setStatusTab('partial')}>مدفوعة جزئياً</Button>
        <Button variant={statusTab === 'paid' ? 'primary' : 'secondary'} size="sm" onClick={() => setStatusTab('paid')}>مدفوعة</Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="لا توجد فواتير" description="أضف فاتورة جديدة" actionLabel="إضافة فاتورة" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={filtered} searchable searchKeys={['contact_name', 'number']} />
      )}

      <Modal
        isOpen={showModal}
        onClose={() => { setShowModal(false); setEditingInvoice(null); }}
        title={editingInvoice ? `تعديل فاتورة #${editingInvoice.number}` : 'إضافة فاتورة جديدة'}
        size="xl"
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => { setShowModal(false); setEditingInvoice(null); }}>إلغاء</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="التاريخ" type="date" value={form.date} onChange={(e) => setForm({...form, date: e.target.value})} />
            <Input label="تاريخ الاستحقاق" type="date" value={form.due_date} onChange={(e) => setForm({...form, due_date: e.target.value})} />
            <Select
              label="العميل"
              value={form.client_id}
              onChange={(v) => setForm({...form, client_id: v})}
              options={[{ value: '', label: 'اختر عميلاً' }, ...clients.map((c: any) => ({ value: c.id, label: c.name }))]}
              className="col-span-2"
            />
            <Select
              label="المشروع (اختياري)"
              value={form.project_id}
              onChange={(v) => setForm({...form, project_id: v})}
              options={[{ value: '', label: 'بدون مشروع' }, ...projects.map((p: any) => ({ value: p.id, label: p.name }))]}
              className="col-span-2"
            />
          </div>
          
          <Textarea label="ملاحظات" value={form.notes} onChange={(e) => setForm({...form, notes: e.target.value})} placeholder="ملاحظات الفاتورة" />
          
          <div className="border border-border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg-secondary">
                <tr>
                  <th className="p-2 text-right">البيان</th>
                  <th className="p-2 text-right w-24">الكمية</th>
                  <th className="p-2 text-right w-28">سعر الوحدة</th>
                  <th className="p-2 text-right w-28">الإجمالي</th>
                  <th className="p-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {form.items.map((item: InvoiceItem, i: number) => (
                  <tr key={i} className="border-t border-border">
                    <td className="p-2">
                      <Input placeholder="وصف الصنف" value={item.description} onChange={(e) => updateItem(i, 'description', e.target.value)} />
                    </td>
                    <td className="p-2">
                      <Input type="number" value={item.quantity} onChange={(e) => updateItem(i, 'quantity', parseFloat(e.target.value) || 0)} />
                    </td>
                    <td className="p-2">
                      <Input type="number" value={item.unitPrice} onChange={(e) => updateItem(i, 'unitPrice', parseFloat(e.target.value) || 0)} />
                    </td>
                    <td className="p-2">
                      <Input type="number" value={item.total} disabled />
                    </td>
                    <td className="p-2">
                      {form.items.length > 1 && (
                        <Button variant="ghost" size="sm" onClick={() => removeItem(i)}>
                          <Trash2 size={14} className="text-danger" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
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
