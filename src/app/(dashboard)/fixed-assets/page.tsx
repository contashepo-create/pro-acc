'use client';

import { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { ActionButtons } from '@/components/ui/ActionButtons';
import { formatDate, formatCurrency } from '@/lib/utils';

export default function FixedAssetsPage() {
  const [assets, setAssets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingAsset, setEditingAsset] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<any>({
    name: '', code: '', category: '', purchase_date: new Date().toISOString().split('T')[0],
    purchase_cost: 0, useful_life_years: 5, depreciation_rate: 20, depreciation_method: 'straight_line',
    location: '', notes: '',
  });

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch('/api/fixed-assets');
      const json = await res.json();
      if (json.success) setAssets(json.data?.assets || []);
      else setError(json.message || 'فشل');
    } catch { setError('فشل تحميل البيانات'); } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleSave = async () => {
    if (!form.name || !form.code || !form.purchase_cost || form.purchase_cost <= 0) {
      setSaveError('الاسم والرمز والتكلفة مطلوبة');
      return;
    }
    setSaving(true); setSaveError('');
    try {
      const url = editingAsset ? `/api/fixed-assets/${editingAsset.id}` : '/api/fixed-assets';
      const method = editingAsset ? 'PUT' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setEditingAsset(null);
        setForm({
          name: '', code: '', category: '', purchase_date: new Date().toISOString().split('T')[0],
          purchase_cost: 0, useful_life_years: 5, depreciation_rate: 20, depreciation_method: 'straight_line',
          location: '', notes: '',
        });
        fetchData();
      } else setSaveError(json.message || 'فشل الحفظ');
    } catch (e: any) { setSaveError('خطأ في الاتصال'); } finally { setSaving(false); }
  };

  const handleEdit = async (asset: any) => {
    try {
      const res = await fetch(`/api/fixed-assets/${asset.id}`);
      const json = await res.json();
      if (json.success) {
        setEditingAsset(asset);
        setForm({
          name: json.data.name,
          code: json.data.code,
          category: json.data.category || '',
          purchase_date: json.data.purchase_date,
          purchase_cost: json.data.purchase_cost,
          useful_life_years: json.data.useful_life_years,
          depreciation_rate: json.data.depreciation_rate,
          depreciation_method: json.data.depreciation_method,
          location: json.data.location || '',
          notes: json.data.notes || '',
        });
        setShowModal(true);
      }
    } catch (e) {
      console.error('Failed to load asset:', e);
    }
  };

  const handleDelete = async (asset: any) => {
    try {
      const res = await fetch(`/api/fixed-assets/${asset.id}`, { method: 'DELETE' });
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
    { key: 'category', label: 'الفئة' },
    { key: 'purchase_date', label: 'تاريخ الشراء', render: (row: any) => formatDate(row.purchase_date) },
    { key: 'purchase_cost', label: 'التكلفة', render: (row: any) => formatCurrency(row.purchase_cost) },
    { key: 'net_book_value', label: 'القيمة الدفترية', render: (row: any) => formatCurrency(row.net_book_value) },
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
      <PageHeader title="الأصول الثابتة" description="إدارة الأصول الثابتة والإهلاك" actions={<Button onClick={() => { setEditingAsset(null); setShowModal(true); }} leftIcon={<Plus size={18} />}>إضافة أصل</Button>} />
      {assets.length === 0 ? <EmptyState title="لا توجد أصول" actionLabel="إضافة أصل" onAction={() => setShowModal(true)} /> : <DataTable columns={columns} data={assets} searchable searchKeys={['name', 'code', 'category']} />}
      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setEditingAsset(null); }} title={editingAsset ? `تعديل أصل: ${editingAsset.name}` : 'إضافة أصل ثابت'} size="lg" footer={<div className="flex gap-2"><Button variant="ghost" onClick={() => { setShowModal(false); setEditingAsset(null); }}>إلغاء</Button><Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</Button></div>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="الاسم" className="col-span-2" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} />
            <Input label="الرمز" value={form.code} onChange={(e) => setForm({...form, code: e.target.value})} />
            <Input label="الفئة" value={form.category} onChange={(e) => setForm({...form, category: e.target.value})} />
            <Input label="تاريخ الشراء" type="date" value={form.purchase_date} onChange={(e) => setForm({...form, purchase_date: e.target.value})} />
            <Input label="التكلفة" type="number" value={form.purchase_cost} onChange={(e) => setForm({...form, purchase_cost: parseFloat(e.target.value) || 0})} />
            <Input label="عمر الإنتاج (سنوات)" type="number" value={form.useful_life_years} onChange={(e) => setForm({...form, useful_life_years: parseInt(e.target.value) || 5})} />
            <Input label="معدل الإهلاك (%)" type="number" value={form.depreciation_rate} onChange={(e) => setForm({...form, depreciation_rate: parseFloat(e.target.value) || 20})} />
            <Select label="طريقة الإهلاك" value={form.depreciation_method} onChange={(v) => setForm({...form, depreciation_method: v})} options={[{ value: 'straight_line', label: 'خط مستقيم' }, { value: 'declining_balance', label: 'رصيد متناقص' }]} />
            <Input label="الموقع" value={form.location} onChange={(e) => setForm({...form, location: e.target.value})} />
            <Input label="ملاحظات" className="col-span-2" value={form.notes} onChange={(e) => setForm({...form, notes: e.target.value})} />
          </div>
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
