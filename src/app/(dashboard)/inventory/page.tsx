'use client';

import { useState, useEffect } from 'react';
import { Plus, Eye } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Tabs } from '@/components/ui/Tabs';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { formatCurrency } from '@/lib/utils';

export default function InventoryPage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);

  const handleSave = async () => {
    // TODO: Implement save logic for this page
    // This is a temporary fix to prevent empty button
    alert('جاري تطوير حفظ البيانات لهذا القسم - سيتم تفعيله قريباً');
    setShowModal(false);
  };



  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/inventory');
        const json = await res.json();
        if (json.success) {
          setItems(json.data?.items || []);
        } else {
          setError(json.message || 'فشل تحميل البيانات');
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
    { key: 'code', label: 'الكود', sortable: true },
    { key: 'name', label: 'اسم الصنف', sortable: true },
    { key: 'unit', label: 'الوحدة', sortable: true },
    { key: 'quantity', label: 'الكمية', sortable: true },
    { key: 'unit_price', label: 'سعر الوحدة', sortable: true, render: (row: any) => formatCurrency(row.unit_price) },
    { key: 'warehouse_name', label: 'المستودع', sortable: true },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="المخزون" description="إدارة أصناف المخزون"
          actions={<div className="flex gap-2"><Button variant="secondary" leftIcon={<Eye size={18} />}>الحركات</Button><Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة صنف</Button></div>}
        />
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="المخزون"
        description="إدارة أصناف المخزون"
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" leftIcon={<Eye size={18} />}>الحركات</Button>
            <Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة صنف</Button>
          </div>
        }
      />

      {items.length === 0 ? (
        <EmptyState title="لا توجد أصناف" description="أضف صنفاً جديداً للمخزون" actionLabel="إضافة صنف" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={items} searchable searchKeys={['name', 'code']} />
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة صنف جديد" size="lg" footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button onClick={handleSave}>حفظ</Button></div>}>
        <div className="grid grid-cols-2 gap-4">
          <Input label="الكود" placeholder="كود الصنف" />
          <Input label="الوحدة" placeholder="مثال: كيس، طن" />
          <Input label="اسم الصنف" placeholder="اسم الصنف" className="col-span-2" />
          <Select label="المستودع" options={[{ value: '', label: 'اختر مستودعاً' }]} className="col-span-2" />
          <Input label="التصنيف" placeholder="اختياري" className="col-span-2" />
        </div>
      </Modal>
    </div>
  );
}
