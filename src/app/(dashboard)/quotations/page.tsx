'use client';

import { useState, useEffect } from 'react';
import { Plus, ArrowRightCircle } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Checkbox } from '@/components/ui/Checkbox';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { ActionButtons } from '@/components/ui/ActionButtons';
import { toast } from '@/components/ui/Toast';
import { formatDate, formatCurrency } from '@/lib/utils';

export default function QuotationsPage() {
  const [quotations, setQuotations] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingQuotation, setEditingQuotation] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [convertingQuotation, setConvertingQuotation] = useState<any>(null);
  const [convertForm, setConvertForm] = useState<any>({
    name: '',
    start_date: new Date().toISOString().split('T')[0],
    end_date: '',
  });
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState('');
  const [form, setForm] = useState<any>({
    date: new Date().toISOString().split('T')[0],
    contact_id: '',
    valid_until: '',
    notes: '',
    tax_rate: 0.15,
    tax_enabled: true,
    items: [{ description: '', quantity: 1, unit_price: 0, total: 0 }],
  });

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const [quotRes, cliRes] = await Promise.all([
        fetch('/api/quotations'),
        fetch('/api/clients'),
      ]);
      const [quotJson, cliJson] = await Promise.all([
        quotRes.json(),
        cliRes.json(),
      ]);
      if (quotJson.success) setQuotations(quotJson.data?.quotations || []);
      else setError(quotJson.message || 'فشل');
      if (cliJson.success) setClients(cliJson.data?.clients || []);
    } catch { setError('فشل تحميل البيانات'); } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleSave = async () => {
    if (!form.contact_id) { setSaveError('يجب اختيار عميل'); return; }
    setSaving(true); setSaveError('');
    try {
      const url = editingQuotation ? `/api/quotations/${editingQuotation.id}` : '/api/quotations';
      const method = editingQuotation ? 'PUT' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setEditingQuotation(null);
        setForm({
          date: new Date().toISOString().split('T')[0],
          contact_id: '',
          valid_until: '',
          notes: '',
          tax_rate: 0.15,
          tax_enabled: true,
          items: [{ description: '', quantity: 1, unit_price: 0, total: 0 }],
        });
        fetchData();
      } else setSaveError(json.message || 'فشل الحفظ');
    } catch (e: any) { setSaveError('خطأ في الاتصال'); } finally { setSaving(false); }
  };

  const handleEdit = async (quotation: any) => {
    try {
      const res = await fetch(`/api/quotations/${quotation.id}`);
      const json = await res.json();
      if (json.success) {
        setEditingQuotation(quotation);
        setForm({
          date: json.data.date,
          contact_id: json.data.contact_id,
          valid_until: json.data.valid_until || '',
          notes: json.data.notes || '',
          items: json.data.items || [{ description: '', quantity: 1, unit_price: 0, total: 0 }],
        });
        setShowModal(true);
      }
    } catch (e) {
      console.error('Failed to load quotation:', e);
    }
  };

  const handleDelete = async (quotation: any) => {
    try {
      const res = await fetch(`/api/quotations/${quotation.id}`, { method: 'DELETE' });
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

  const openConvertModal = (quotation: any) => {
    setConvertingQuotation(quotation);
    setConvertForm({
      name: `مشروع - ${quotation.contact_name || 'عرض ' + quotation.number}`,
      start_date: new Date().toISOString().split('T')[0],
      end_date: '',
    });
    setConvertError('');
    setShowConvertModal(true);
  };

  const handleConvert = async () => {
    if (!convertingQuotation) return;
    if (!convertForm.name || !convertForm.start_date) {
      setConvertError('اسم المشروع وتاريخ البدء مطلوبان');
      return;
    }
    setConverting(true); setConvertError('');
    try {
      const res = await fetch(`/api/quotations/${convertingQuotation.id}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(convertForm),
      });
      const json = await res.json();
      if (json.success) {
        setShowConvertModal(false);
        setConvertingQuotation(null);
        toast.success('تم تحويل العرض إلى مشروع بنجاح');
        fetchData();
      } else setConvertError(json.message || 'فشل التحويل');
    } catch (e: any) { setConvertError('خطأ في الاتصال'); } finally { setConverting(false); }
  };

  const statusBadge = (status: string) => {
    const map: Record<string, { variant: 'success' | 'warning' | 'info' | 'danger'; label: string }> = {
      draft: { variant: 'warning', label: 'مسودة' },
      sent: { variant: 'info', label: 'مرسل' },
      accepted: { variant: 'success', label: 'مقبول' },
      rejected: { variant: 'danger', label: 'مرفوض' },
      converted: { variant: 'success', label: 'محول' },
    };
    const m = map[status] || { variant: 'warning', label: status };
    return <Badge variant={m.variant}>{m.label}</Badge>;
  };

  const columns = [
    { key: 'number', label: 'الرقم', sortable: true },
    { key: 'date', label: 'التاريخ', render: (row: any) => formatDate(row.date) },
    { key: 'contact_name', label: 'العميل', sortable: true },
    { key: 'total', label: 'الإجمالي', render: (row: any) => formatCurrency(row.total) },
    { key: 'status', label: 'الحالة', render: (row: any) => statusBadge(row.status) },
    {
      key: 'actions',
      label: 'إجراءات',
      render: (row: any) => (
        <div className="flex items-center gap-2">
          {row.status === 'accepted' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => openConvertModal(row)}
              title="تحويل إلى مشروع"
            >
              <ArrowRightCircle size={16} className="text-green-600" />
            </Button>
          )}
          <ActionButtons
            item={row}
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
        </div>
      ),
    },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;
  if (error) return <div className="p-6"><div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div></div>;

  return (
    <div className="space-y-6">
      <PageHeader title="عروض الأسعار" description="إدارة عروض الأسعار" actions={<Button onClick={() => { setEditingQuotation(null); setShowModal(true); }} leftIcon={<Plus size={18} />}>إضافة عرض</Button>} />
      {quotations.length === 0 ? <EmptyState title="لا توجد عروض" actionLabel="إضافة عرض" onAction={() => setShowModal(true)} /> : <DataTable columns={columns} data={quotations} searchable searchKeys={['contact_name', 'number']} />}
      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setEditingQuotation(null); }} title={editingQuotation ? 'تعديل عرض سعر' : 'إضافة عرض سعر'} size="xl" footer={<div className="flex gap-2"><Button variant="ghost" onClick={() => { setShowModal(false); setEditingQuotation(null); }}>إلغاء</Button><Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</Button></div>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="التاريخ" type="date" value={form.date} onChange={(e) => setForm({...form, date: e.target.value})} />
            <Input label="صالح حتى" type="date" value={form.valid_until} onChange={(e) => setForm({...form, valid_until: e.target.value})} />
            <Select label="العميل" value={form.contact_id} onChange={(v) => setForm({...form, contact_id: v})} options={[{ value: '', label: 'اختر عميلاً' }, ...clients.map((c: any) => ({ value: c.id, label: c.name }))]} className="col-span-2" />
          </div>
          <Textarea label="ملاحظات" value={form.notes} onChange={(e) => setForm({...form, notes: e.target.value})} placeholder="ملاحظات عرض السعر" />
          <Checkbox label="تطبيق ضريبة القيمة المضافة (15%)" checked={form.tax_enabled} onChange={(checked: boolean) => setForm({...form, tax_enabled: checked, tax_rate: checked ? 0.15 : 0})} />
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>

      <Modal
        isOpen={showConvertModal}
        onClose={() => { setShowConvertModal(false); setConvertingQuotation(null); }}
        title="تحويل عرض سعر إلى مشروع"
        size="md"
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => { setShowConvertModal(false); setConvertingQuotation(null); }}>إلغاء</Button>
            <Button onClick={handleConvert} disabled={converting}>{converting ? 'جاري التحويل...' : 'تحويل إلى مشروع'}</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="bg-info/10 border border-info/20 rounded-lg p-3 text-sm text-text-secondary">
            سيتم إنشاء مشروع جديد ونسخ بنود العرض كبنود كمية (BOQ) وإنشاء فاتورة تلقائية مرتبطة بالمشروع.
          </div>
          <div className="grid grid-cols-1 gap-4">
            <Input label="اسم المشروع" value={convertForm.name} onChange={(e) => setConvertForm({ ...convertForm, name: e.target.value })} />
            <div className="grid grid-cols-2 gap-4">
              <Input label="تاريخ البدء" type="date" value={convertForm.start_date} onChange={(e) => setConvertForm({ ...convertForm, start_date: e.target.value })} />
              <Input label="تاريخ الانتهاء (اختياري)" type="date" value={convertForm.end_date} onChange={(e) => setConvertForm({ ...convertForm, end_date: e.target.value })} />
            </div>
          </div>
          {convertError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{convertError}</div>}
        </div>
      </Modal>
    </div>
  );
}
