'use client';

import { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { formatCurrency } from '@/lib/utils';

export default function BoqPage() {
  const [boqItems, setBoqItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<any>({"project_id": "", "description": "", "quantity": "", "unit_price": ""});

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    try {
      const res = await fetch('/api/boq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setForm({});
        // Refresh data
        window.location.reload();
      } else {
        setSaveError(json.message || 'فشل الحفظ: ' + JSON.stringify(json));
      }
    } catch (e) {
      setSaveError('خطأ في الاتصال بالخادم: ' + ('خطأ'));
    } finally {
      setSaving(false);
    }
  };





  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/boq');
        const json = await res.json();
        if (json.success) {
          setBoqItems(json.data?.boqItems || []);
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
    { key: 'item_code', label: 'الكود', sortable: true },
    { key: 'description', label: 'البيان', sortable: true },
    { key: 'unit', label: 'الوحدة' },
    { key: 'quantity', label: 'الكمية', sortable: true },
    { key: 'unit_price', label: 'سعر الوحدة', render: (row: any) => formatCurrency(row.unit_price) },
    { key: 'total', label: 'الإجمالي', render: (row: any) => formatCurrency(row.total) },
    { key: 'project_name', label: 'المشروع', sortable: true },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="بنود الكميات" description="إدارة بنود الكميات للمشاريع"
          actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة بند</Button>}
        />
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="بنود الكميات" description="إدارة بنود الكميات للمشاريع"
        actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة بند</Button>}
      />
      {boqItems.length === 0 ? (
        <EmptyState title="لا توجد بنود كميات" actionLabel="إضافة بند" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={boqItems} searchable searchKeys={['item_code', 'description', 'project_name']} />
      )}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة بند كمية" size="lg" footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button onClick={handleSave} disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ"}</Button></div>}>
        <div className="grid grid-cols-2 gap-4">
          <Select label="المشروع" options={[{ value: '', label: 'اختر مشروعاً' }]} className="col-span-2" value={form.project_id} onChange={(value) => setForm({...form, project_id: value})} />
          <Input label="كود البند" value={form.code} onChange={(e) => setForm({...form, كود_البند: e.target.value})} /><Input label="الوحدة" value={form.unit} onChange={(e) => setForm({...form, unit: e.target.value})} />
          <Input label="البيان" className="col-span-2" value={form.description} onChange={(e) => setForm({...form, البيان: e.target.value})} />
          <Input label="الكمية" type="number" value={form.quantity} onChange={(e) => setForm({...form, quantity: e.target.value})} /><Input label="سعر الوحدة" type="number" value={form.unit_price} onChange={(e) => setForm({...form, unit_price: e.target.value})} />
                  {saveError && <div className="col-span-2 bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
