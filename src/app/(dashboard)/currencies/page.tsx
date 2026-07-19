'use client';

import { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { ActionButtons } from '@/components/ui/ActionButtons';

export default function CurrenciesPage() {
  const [currencies, setCurrencies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingCurrency, setEditingCurrency] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<any>({ code: '', name: '', rate: 1 });

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch('/api/currencies');
      const json = await res.json();
      if (json.success) setCurrencies(json.data?.currencies || []);
      else setError(json.message || 'فشل');
    } catch { setError('فشل تحميل البيانات'); } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleSave = async () => {
    if (!form.code || !form.name) { setSaveError('الرمز والاسم مطلوبان'); return; }
    setSaving(true); setSaveError('');
    try {
      const url = editingCurrency ? `/api/currencies/${editingCurrency.id}` : '/api/currencies';
      const method = editingCurrency ? 'PUT' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setEditingCurrency(null);
        setForm({ code: '', name: '', rate: 1 });
        fetchData();
      } else setSaveError(json.message || 'فشل الحفظ');
    } catch (e: any) { setSaveError('خطأ في الاتصال'); } finally { setSaving(false); }
  };

  const handleEdit = async (currency: any) => {
    try {
      const res = await fetch(`/api/currencies/${currency.id}`);
      const json = await res.json();
      if (json.success) {
        setEditingCurrency(currency);
        setForm({ code: json.data.code, name: json.data.name, rate: json.data.rate });
        setShowModal(true);
      }
    } catch (e) {
      console.error('Failed to load currency:', e);
    }
  };

  const handleDelete = async (currency: any) => {
    try {
      const res = await fetch(`/api/currencies/${currency.id}`, { method: 'DELETE' });
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
    { key: 'code', label: 'الرمز', sortable: true },
    { key: 'name', label: 'الاسم', sortable: true },
    { key: 'rate', label: 'سعر الصرف' },
    { key: 'is_base', label: 'الأساس', render: (row: any) => <Badge variant={row.is_base ? 'success' : 'default'}>{row.is_base ? 'نعم' : 'لا'}</Badge> },
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

  if (loading) return <LoadingSkeleton variant="table" count={6} />;
  if (error) return <div className="p-6"><div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div></div>;

  return (
    <div className="space-y-6">
      <PageHeader title="العملات" description="إدارة العملات وأسعار الصرف" actions={<Button onClick={() => { setEditingCurrency(null); setShowModal(true); }} leftIcon={<Plus size={18} />}>إضافة عملة</Button>} />
      {currencies.length === 0 ? <EmptyState title="لا توجد عملات" actionLabel="إضافة عملة" onAction={() => setShowModal(true)} /> : <DataTable columns={columns} data={currencies} searchable searchKeys={['name', 'code']} />}
      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setEditingCurrency(null); }} title={editingCurrency ? `تعديل: ${editingCurrency.code}` : 'إضافة عملة'} size="lg" footer={<div className="flex gap-2"><Button variant="ghost" onClick={() => { setShowModal(false); setEditingCurrency(null); }}>إلغاء</Button><Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</Button></div>}>
        <div className="space-y-4">
          <Input label="الرمز" value={form.code} onChange={(e) => setForm({...form, code: e.target.value})} placeholder="SAR" />
          <Input label="الاسم" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} placeholder="ريال سعودي" />
          <Input label="سعر الصرف" type="number" value={form.rate} onChange={(e) => setForm({...form, rate: parseFloat(e.target.value) || 1})} placeholder="1" />
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
