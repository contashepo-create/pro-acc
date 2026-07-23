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
import { toast } from '@/components/ui/Toast';
import { formatDate, formatCurrency } from '@/lib/utils';

export default function CreditNotesPage() {
  const [creditNotes, setCreditNotes] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<any>({
    invoice_id: '', project_id: '', contact_id: '', reason: '', date: new Date().toISOString().split('T')[0],
    items: [{ description: '', quantity: 1, unit_price: 0 }],
  });

  const fetchData = async () => {
    try {
      setLoading(true);
      const [cnRes, invRes, projRes, conRes] = await Promise.all([
        fetch('/api/credit-notes'),
        fetch('/api/invoices'),
        fetch('/api/projects'),
        fetch('/api/contacts'),
      ]);
      const [cnJson, invJson, projJson, conJson] = await Promise.all([cnRes.json(), invRes.json(), projRes.json(), conRes.json()]);
      if (cnJson.success) setCreditNotes(cnJson.data?.credit_notes || []);
      else setError(cnJson.message || 'فشل');
      if (invJson.success) setInvoices(invJson.data?.invoices || []);
      if (projJson.success) setProjects(projJson.data?.projects || []);
      if (conJson.success) setContacts(conJson.data?.contacts || []);
    } catch { setError('فشل تحميل البيانات'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleSave = async () => {
    if (!form.reason) { setSaveError('السبب مطلوب'); return; }
    if (form.items.length === 0 || !form.items[0].description) { setSaveError('يجب إضافة بند'); return; }
    setSaving(true); setSaveError('');
    try {
      const res = await fetch('/api/credit-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setForm({ invoice_id: '', project_id: '', contact_id: '', reason: '', date: new Date().toISOString().split('T')[0], items: [{ description: '', quantity: 1, unit_price: 0 }] });
        toast.success('تم إنشاء الإشعار الدائن');
        fetchData();
      } else setSaveError(json.message || 'فشل الحفظ');
    } catch { setSaveError('خطأ في الاتصال'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (cn: any) => {
    try {
      const res = await fetch(`/api/credit-notes/${cn.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) { toast.success('تم حذف الإشعار'); fetchData(); }
      else toast.error(json.message || 'فشل الحذف');
    } catch { toast.error('خطأ في الاتصال'); }
  };

  const addItem = () => setForm({ ...form, items: [...form.items, { description: '', quantity: 1, unit_price: 0 }] });
  const removeItem = (i: number) => { if (form.items.length > 1) setForm({ ...form, items: form.items.filter((_: any, idx: number) => idx !== i) }); };
  const updateItem = (i: number, field: string, value: any) => {
    const items = [...form.items];
    items[i] = { ...items[i], [field]: value };
    setForm({ ...form, items });
  };

  const subtotal = form.items.reduce((s: number, it: any) => s + (it.quantity * it.unit_price || 0), 0);

  const columns = [
    { key: 'number', label: 'الرقم', sortable: true },
    { key: 'date', label: 'التاريخ', render: (row: any) => formatDate(row.date), sortable: true },
    { key: 'contact_name', label: 'العميل', sortable: true },
    { key: 'reason', label: 'السبب' },
    { key: 'total', label: 'القيمة', render: (row: any) => formatCurrency(row.total), sortable: true },
    { key: 'status', label: 'الحالة', render: (row: any) => <Badge variant={row.status === 'approved' ? 'success' : 'warning'}>{row.status === 'approved' ? 'معتمد' : row.status}</Badge> },
    { key: 'actions', label: 'إجراءات', render: (row: any) => <ActionButtons item={row} onDelete={handleDelete} /> },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={6} />;
  if (error) return <div className="p-6"><div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div></div>;

  return (
    <div className="space-y-6">
      <PageHeader title="إشعارات دائنة" description="إدارة الإشعارات الدائنة لتخفيض رصيد العميل"
        actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إشعار دائن جديد</Button>} />

      {creditNotes.length === 0 ? (
        <EmptyState title="لا توجد إشعارات دائنة" actionLabel="إنشاء إشعار" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={creditNotes} searchable searchKeys={['number', 'contact_name', 'reason']} />
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إشعار دائن جديد" size="xl"
        footer={<div className="flex gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button onClick={handleSave} disabled={saving}>{saving ? 'جاري...' : 'حفظ'}</Button></div>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="التاريخ" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            <Select label="الفاتورة (اختياري)" value={form.invoice_id} onChange={(v) => setForm({ ...form, invoice_id: v })}
              options={[{ value: '', label: '— بدون —' }, ...invoices.map((inv: any) => ({ value: inv.id, label: `#${inv.number} - ${formatCurrency(inv.total) }` }))]} />
            <Select label="المشروع (اختياري)" value={form.project_id} onChange={(v) => setForm({ ...form, project_id: v })}
              options={[{ value: '', label: '— بدون —' }, ...projects.map((p: any) => ({ value: p.id, label: p.name }))]} />
            <Select label="العميل" value={form.contact_id} onChange={(v) => setForm({ ...form, contact_id: v })}
              options={[{ value: '', label: '— اختر —' }, ...contacts.filter((c: any) => c.type === 'client' || c.type === 'both').map((c: any) => ({ value: c.id, label: c.name }))]} />
          </div>
          <Textarea label="السبب" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="سبب الإشعار الدائن..." />

          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-bg-secondary">
                <tr>
                  <th className="p-2 text-right">البيان</th>
                  <th className="p-2 text-center w-24">الكمية</th>
                  <th className="p-2 text-center w-28">سعر الوحدة</th>
                  <th className="p-2 text-center w-28">الإجمالي</th>
                  <th className="p-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {form.items.map((item: any, i: number) => (
                  <tr key={i} className="border-t border-border">
                    <td className="p-1"><Input value={item.description} onChange={(e) => updateItem(i, 'description', e.target.value)} /></td>
                    <td className="p-1"><Input type="number" value={item.quantity} onChange={(e) => updateItem(i, 'quantity', parseFloat(e.target.value) || 0)} /></td>
                    <td className="p-1"><Input type="number" value={item.unit_price} onChange={(e) => updateItem(i, 'unit_price', parseFloat(e.target.value) || 0)} /></td>
                    <td className="p-1 text-center font-bold">{formatCurrency(item.quantity * item.unit_price)}</td>
                    <td className="p-1">{form.items.length > 1 && <Button variant="ghost" size="sm" onClick={() => removeItem(i)}><Trash2 size={14} className="text-danger" /></Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between items-center">
            <Button variant="ghost" size="sm" onClick={addItem} leftIcon={<Plus size={14} />}>إضافة بند</Button>
            <div className="text-sm">الإجمالي: <strong className="text-accent">{formatCurrency(subtotal)}</strong></div>
          </div>
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
