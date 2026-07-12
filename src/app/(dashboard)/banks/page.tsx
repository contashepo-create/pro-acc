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

export default function BanksPage() {
  const [banks, setBanks] = useState<any[]>([]);
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
        const res = await fetch('/api/banks');
        const json = await res.json();
        if (json.success) {
          setBanks(json.data?.banks || []);
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
    { key: 'name', label: 'الاسم', sortable: true },
    { key: 'type', label: 'النوع', render: (row: any) => <Badge variant={row.type === 'bank' ? 'info' : 'accent'}>{row.type === 'bank' ? 'بنك' : 'صندوق'}</Badge> },
    { key: 'account_number', label: 'رقم الحساب' },
    { key: 'opening_balance', label: 'الرصيد الافتتاحي', render: (row: any) => formatCurrency(row.opening_balance) },
    { key: 'is_active', label: 'الحالة', render: (row: any) => <Badge variant={row.is_active ? 'success' : 'danger'}>{row.is_active ? 'نشط' : 'غير نشط'}</Badge> },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="البنوك والخزائن" description="إدارة الحسابات البنكية والخزائن النقدية"
          actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة بنك/خزينة</Button>}
        />
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="البنوك والخزائن" description="إدارة الحسابات البنكية والخزائن النقدية"
        actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة بنك/خزينة</Button>}
      />
      {banks.length === 0 ? (
        <EmptyState title="لا توجد بنوك أو خزائن" actionLabel="إضافة بنك/خزينة" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={banks} searchable searchKeys={['name', 'account_number']} />
      )}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة بنك/خزينة" size="lg" footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button onClick={handleSave}>حفظ</Button></div>}>
        <div className="grid grid-cols-2 gap-4">
          <Input label="الاسم" className="col-span-2" />
          <Select label="النوع" options={[{ value: 'bank', label: 'بنك' }, { value: 'safe', label: 'صندوق' }]} />
          <Input label="رقم الحساب" />
          <Input label="الرصيد الافتتاحي" type="number" />
        </div>
      </Modal>
    </div>
  );
}
