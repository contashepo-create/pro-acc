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
import { formatCurrency } from '@/lib/utils';

export default function InventoryPage() {
  const [items, setItems] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<any>({
    name: '',
    code: '',
    unit: '',
    quantity: 0,
    unit_price: 0,
    warehouse_id: '',
  });

  const handleSave = async () => {
    if (!form.name || !form.code) {
      setSaveError('الاسم والرمز مطلوبان');
      return;
    }
    if (!form.warehouse_id) {
      setSaveError('يجب اختيار المستودع');
      return;
    }

    setSaving(true);
    setSaveError('');
    try {
      const res = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setForm({
          name: '',
          code: '',
          unit: '',
          quantity: 0,
          unit_price: 0,
          warehouse_id: '',
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

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [itemRes, whRes] = await Promise.all([
          fetch('/api/inventory'),
          fetch('/api/inventory/warehouses'),
        ]);
        const [itemJson, whJson] = await Promise.all([
          itemRes.json(),
          whRes.json(),
        ]);
        if (itemJson.success) {
          setItems(itemJson.data?.items || []);
        } else {
          setError(itemJson.message || 'فشل تحميل البيانات');
        }
        if (whJson.success) {
          setWarehouses(whJson.data?.warehouses || []);
        }
      } catch {
        setError('فشل تحميل البيانات');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const columns = [
    { key: 'code', label: 'الرمز', sortable: true },
    { key: 'name', label: 'الاسم', sortable: true },
    { key: 'unit', label: 'الوحدة' },
    { key: 'quantity', label: 'الكمية', sortable: true },
    { key: 'unit_price', label: 'السعر', render: (row: any) => formatCurrency(row.unit_price) },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="المخزون" description="إدارة المخزون والأصناف"
          actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة صنف</Button>}
        />
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="المخزون" description="إدارة المخزون والأصناف"
        actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة صنف</Button>}
      />
      {items.length === 0 ? (
        <EmptyState title="لا توجد أصناف" actionLabel="إضافة صنف" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={items} searchable searchKeys={['name', 'code']} />
      )}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة صنف مخزون" footer={
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ"}</Button>
        </div>
      }>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="الاسم" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} className="col-span-2" />
            <Input label="الرمز" value={form.code} onChange={(e) => setForm({...form, code: e.target.value})} />
            <Input label="الوحدة" value={form.unit} onChange={(e) => setForm({...form, unit: e.target.value})} placeholder="مثال: قطعة، كيلو" />
            <Input label="الكمية" type="number" value={form.quantity} onChange={(e) => setForm({...form, quantity: parseFloat(e.target.value) || 0})} />
            <Input label="سعر الوحدة" type="number" value={form.unit_price} onChange={(e) => setForm({...form, unit_price: parseFloat(e.target.value) || 0})} />
            <Select
              label="المستودع"
              value={form.warehouse_id}
              onChange={(value) => setForm({...form, warehouse_id: value})}
              options={[
                { value: '', label: 'اختر مستودعاً' },
                ...warehouses.map(w => ({ value: w.id, label: w.name })),
              ]}
              className="col-span-2"
            />
          </div>
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
