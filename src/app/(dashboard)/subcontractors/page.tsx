'use client';

import { useState, useEffect } from 'react';
import { Plus, Eye } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Tabs } from '@/components/ui/Tabs';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { formatDate, formatCurrency } from '@/lib/utils';

export default function SubcontractorsPage() {
  const [contracts, setContracts] = useState<any[]>([]);
  const [certificates, setCertificates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('contracts');
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/subcontractors/contracts');
        const json = await res.json();
        if (json.success) {
          setContracts(json.data?.contracts || []);
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

  const contractCols = [
    { key: 'contract_number', label: 'رقم العقد', sortable: true },
    { key: 'subcontractor_name', label: 'مقاول الباطن', sortable: true },
    { key: 'contract_value', label: 'قيمة العقد', sortable: true, render: (row: any) => formatCurrency(row.contract_value) },
    { key: 'status', label: 'الحالة', render: (row: any) => <Badge variant={row.status === 'active' ? 'success' : 'warning'}>{row.status}</Badge> },
  ];

  const certCols = [
    { key: 'certificate_number', label: 'رقم الشهادة', sortable: true },
    { key: 'contract_number', label: 'العقد', sortable: true },
    { key: 'subcontractor_name', label: 'المقاول', sortable: true },
    { key: 'gross_amount', label: 'الإجمالي', render: (row: any) => formatCurrency(row.gross_amount) },
    { key: 'net_amount', label: 'الصافي', render: (row: any) => formatCurrency(row.net_amount) },
    { key: 'date', label: 'التاريخ', render: (row: any) => formatDate(row.date) },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="مقاولو الباطن" description="إدارة عقود وشهادات مقاولي الباطن"
          actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة عقد</Button>}
        />
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="مقاولو الباطن" description="إدارة عقود وشهادات مقاولي الباطن"
        actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة {tab === 'contracts' ? 'عقد' : 'شهادة'}</Button>}
      />
      <Tabs items={[{ id: 'contracts', label: 'العقود' }, { id: 'certificates', label: 'الشهادات' }]} activeTab={tab} onChange={setTab} />
      {tab === 'contracts' ? (
        contracts.length === 0 ? <EmptyState title="لا توجد عقود" actionLabel="إضافة عقد" onAction={() => setShowModal(true)} /> : <DataTable columns={contractCols} data={contracts} searchable searchKeys={['contract_number', 'subcontractor_name']} />
      ) : (
        certificates.length === 0 ? <EmptyState title="لا توجد شهادات" actionLabel="إضافة شهادة" onAction={() => setShowModal(true)} /> : <DataTable columns={certCols} data={certificates} searchable searchKeys={['certificate_number', 'subcontractor_name']} />
      )}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={tab === 'contracts' ? 'إضافة عقد' : 'إضافة شهادة'} size="lg" footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button>حفظ</Button></div>}>
        {tab === 'contracts' ? (
          <div className="grid grid-cols-2 gap-4">
            <Input label="رقم العقد" /><Select label="مقاول الباطن" options={[{ value: '', label: 'اختر' }]} className="col-span-2" />
            <Input label="قيمة العقد" type="number" /><Input label="نسبة الاحتجاز" type="number" />
            <Input label="تاريخ البداية" type="date" /><Input label="تاريخ النهاية" type="date" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <Input label="رقم الشهادة" /><Select label="العقد" options={[{ value: '', label: 'اختر' }]} />
            <Input label="التاريخ" type="date" /><Input label="المبلغ الإجمالي" type="number" />
            <Input label="نسبة الاحتجاز" type="number" />
          </div>
        )}
      </Modal>
    </div>
  );
}
