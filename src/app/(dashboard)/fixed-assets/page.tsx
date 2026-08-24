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
import { fetchRecord, applyDates, recordOrRow, toDateInput } from '@/lib/form-utils';
import { toast } from '@/components/ui/Toast';

interface AssetRow {
  id: string;
  name: string;
  code?: string;
  category?: string;
  purchase_date?: string;
  purchase_cost: number;
  net_book_value?: number;
  status?: string;
}
interface BankSafeOption { id: string; name: string; is_active?: boolean; }
interface AssetForm {
  name: string;
  code: string;
  category: string;
  purchase_date: string;
  purchase_cost: number;
  useful_life_years: number;
  depreciation_method: string;
  location: string;
  notes: string;
  bank_safe_id: string;
}

export default function FixedAssetsPage() {
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [banks, setBanks] = useState<BankSafeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingAsset, setEditingAsset] = useState<AssetRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<AssetForm>({
    name: '', code: '', category: '', purchase_date: new Date().toISOString().split('T')[0],
    purchase_cost: 0, useful_life_years: 5, depreciation_method: 'straight_line',
    location: '', notes: '', bank_safe_id: '',
  });

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const [assetResponse, bankResponse] = await Promise.all([fetch('/api/fixed-assets'), fetch('/api/banks')]);
      const [assetJson, bankJson] = await Promise.all([assetResponse.json(), bankResponse.json()]);
      if (assetJson.success) setAssets(assetJson.data?.assets || []);
      else setError(assetJson.message || 'فشل');
      if (bankJson.success) setBanks((bankJson.data?.banks || []).filter((bank: BankSafeOption) => bank.is_active));
    } catch { setError('فشل تحميل البيانات'); } finally { setLoading(false); }
  };

  // Initial load on mount (standard fetch pattern).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchData(); }, []);

  const handleSave = async () => {
    if (!form.name || (!editingAsset && (!form.code || !form.category || !form.purchase_cost || form.purchase_cost <= 0 || !form.bank_safe_id))) {
      setSaveError('الاسم والرمز والفئة والتكلفة وحساب الدفع مطلوبة');
      return;
    }
    setSaving(true); setSaveError('');
    try {
      const url = editingAsset ? `/api/fixed-assets/${editingAsset.id}` : '/api/fixed-assets';
      const method = editingAsset ? 'PUT' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingAsset ? {
          name: form.name,
          location: form.location || null,
          notes: form.notes || null,
        } : {
          name: form.name,
          code: form.code,
          category: form.category,
          purchase_date: form.purchase_date,
          purchase_cost: form.purchase_cost,
          useful_life_years: form.useful_life_years,
          depreciation_method: form.depreciation_method,
          location: form.location,
          notes: form.notes,
          bank_safe_id: form.bank_safe_id,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setEditingAsset(null);
        setForm({
          name: '', code: '', category: '', purchase_date: new Date().toISOString().split('T')[0],
          purchase_cost: 0, useful_life_years: 5, depreciation_method: 'straight_line',
          location: '', notes: '', bank_safe_id: '',
        });
        fetchData();
      } else setSaveError(json.message || 'فشل الحفظ');
    } catch { setSaveError('خطأ في الاتصال'); } finally { setSaving(false); }
  };

  const handleEdit = async (asset: AssetRow) => {
    const { data, error } = await fetchRecord(`/api/fixed-assets/${asset.id}`);
    const src = recordOrRow(data, asset);
    if (!data && error) toast.error(error);
    setEditingAsset(asset);
    setForm(applyDates({
      name: String(src.name ?? ''),
      code: String(src.code ?? ''),
      category: String(src.category ?? ''),
      purchase_date: toDateInput(src.purchase_date) ?? '',
      purchase_cost: Number(src.purchase_cost) || 0,
      useful_life_years: Number(src.useful_life_years) || 5,
      depreciation_method: String(src.depreciation_method ?? 'straight_line'),
      location: String(src.location ?? ''),
      notes: String(src.notes ?? ''),
      bank_safe_id: '',
    }, ['purchase_date']));
    setShowModal(true);
  };

  const handleDelete = async (asset: AssetRow) => {
    try {
      const res = await fetch(`/api/fixed-assets/${asset.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        toast.success('تم استبعاد الأصل وعكس قيد الشراء');
        fetchData();
      } else {
        alert(json.message || 'فشل الحذف');
      }
    } catch {
      alert('خطأ في الاتصال بالخادم');
    }
  };

  const columns = [
    { key: 'code', label: 'الرمز', sortable: true },
    { key: 'name', label: 'الاسم', sortable: true },
    { key: 'category', label: 'الفئة' },
    { key: 'purchase_date', label: 'تاريخ الشراء', render: (row: AssetRow) => formatDate(row.purchase_date) },
    { key: 'purchase_cost', label: 'التكلفة', render: (row: AssetRow) => formatCurrency(row.purchase_cost) },
    { key: 'net_book_value', label: 'القيمة الدفترية', render: (row: AssetRow) => formatCurrency(row.net_book_value ?? 0) },
    {
      key: 'actions',
      label: 'إجراءات',
      render: (row: AssetRow) => (
        <ActionButtons
          item={row}
          onEdit={row.status !== 'disposed' ? handleEdit : undefined}
          onDelete={row.status !== 'disposed' ? handleDelete : undefined}
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="الاسم" className="col-span-2" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} />
            {!editingAsset && <>
              <Input label="الرمز" value={form.code} onChange={(e) => setForm({...form, code: e.target.value})} />
              <Input label="الفئة" value={form.category} onChange={(e) => setForm({...form, category: e.target.value})} />
              <Input label="تاريخ الشراء" type="date" value={form.purchase_date} onChange={(e) => setForm({...form, purchase_date: e.target.value})} />
              <Input label="التكلفة" type="number" value={form.purchase_cost} onChange={(e) => setForm({...form, purchase_cost: parseFloat(e.target.value) || 0})} />
              <Input label="عمر الإنتاج (سنوات)" type="number" value={form.useful_life_years} onChange={(e) => setForm({...form, useful_life_years: parseInt(e.target.value) || 5})} />
              <Select label="طريقة الإهلاك" value={form.depreciation_method} onChange={(v) => setForm({...form, depreciation_method: v})} options={[{ value: 'straight_line', label: 'خط مستقيم' }, { value: 'declining_balance', label: 'رصيد متناقص' }]} />
              <Select label="حساب الدفع" value={form.bank_safe_id} onChange={(value) => setForm({ ...form, bank_safe_id: value })}
                options={[{ value: '', label: 'اختر الخزينة/البنك' }, ...banks.map((bank) => ({ value: bank.id, label: bank.name }))]} />
            </>}
            <Input label="الموقع" value={form.location} onChange={(e) => setForm({...form, location: e.target.value})} />
            <Input label="ملاحظات" className="col-span-2" value={form.notes} onChange={(e) => setForm({...form, notes: e.target.value})} />
          </div>
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
