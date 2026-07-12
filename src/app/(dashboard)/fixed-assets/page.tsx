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
import { formatDate, formatCurrency } from '@/lib/utils';

export default function FixedAssetsPage() {
  const [assets, setAssets] = useState<any[]>([]);
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
        const res = await fetch('/api/fixed-assets');
        const json = await res.json();
        if (json.success) {
          setAssets(json.data?.assets || []);
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
    { key: 'name', label: 'الاسم', sortable: true },
    { key: 'category', label: 'التصنيف', sortable: true },
    { key: 'purchase_cost', label: 'تكلفة الشراء', render: (row: any) => formatCurrency(row.purchase_cost) },
    { key: 'accumulated_depreciation', label: 'الإهلاك المجمع', render: (row: any) => formatCurrency(row.accumulated_depreciation) },
    { key: 'net_book_value', label: 'القيمة الدفترية', render: (row: any) => formatCurrency(row.net_book_value) },
    { key: 'status', label: 'الحالة', render: (row: any) => <Badge variant={row.status === 'active' ? 'success' : 'warning'}>{row.status}</Badge> },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="الأصول الثابتة" description="إدارة الأصول الثابتة والإهلاكات"
          actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة أصل</Button>}
        />
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="الأصول الثابتة" description="إدارة الأصول الثابتة والإهلاكات"
        actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة أصل</Button>}
      />
      {assets.length === 0 ? (
        <EmptyState title="لا توجد أصول ثابتة" actionLabel="إضافة أصل" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={assets} searchable searchKeys={['name', 'code', 'category']} />
      )}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة أصل ثابت" size="lg" footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button onClick={handleSave}>حفظ</Button></div>}>
        <div className="grid grid-cols-2 gap-4">
          <Input label="الكود" /><Input label="اسم الأصل" className="col-span-2" />
          <Select label="التصنيف" options={[{ value: 'مركبات', label: 'مركبات' }, { value: 'أجهزة', label: 'أجهزة' }, { value: 'مباني', label: 'مباني' }, { value: 'أثاث', label: 'أثاث' }, { value: 'أخرى', label: 'أخرى' }]} />
          <Input label="تاريخ الشراء" type="date" />
          <Input label="تكلفة الشراء" type="number" />
          <Input label="العمر الإنتاجي (سنوات)" type="number" />
          <Select label="طريقة الإهلاك" options={[{ value: 'straight_line', label: 'القسط الثابت' }, { value: 'declining_balance', label: 'الرصيد المتناقص' }]} />
          <Input label="الموقع" /><Input label="ملاحظات" className="col-span-2" />
        </div>
      </Modal>
    </div>
  );
}
