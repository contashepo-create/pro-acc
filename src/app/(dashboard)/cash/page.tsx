'use client';

import { useState } from 'react';
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
import { formatDate, formatCurrency } from '@/lib/utils';

const mockTxns = [
  { id: '1', date: '2026-06-22', type: 'revenue', account_name: 'إيرادات', amount: 85000, reason: 'دفعة فاتورة' },
  { id: '2', date: '2026-06-22', type: 'expense', account_name: 'مصروفات', amount: 12000, reason: 'مشتريات' },
];

export default function CashPage() {
  const [loading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [typeTab, setTypeTab] = useState('all');

  const filtered = typeTab === 'all' ? mockTxns : mockTxns.filter(t => t.type === typeTab);

  const columns = [
    { key: 'date', label: 'التاريخ', sortable: true, render: (row: any) => formatDate(row.date) },
    { key: 'type', label: 'النوع', sortable: true,
      render: (row: any) => <Badge variant={row.type === 'revenue' ? 'success' : 'danger'}>{row.type === 'revenue' ? 'قبض' : 'صرف'}</Badge>,
    },
    { key: 'account_name', label: 'الحساب', sortable: true },
    { key: 'amount', label: 'المبلغ', sortable: true, render: (row: any) => formatCurrency(row.amount) },
    { key: 'reason', label: 'البيان', sortable: true },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="النقدية"
        description="إدارة المعاملات النقدية"
        actions={
          <Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>
            إضافة معاملة
          </Button>
        }
      />

      <div className="flex gap-4">
        <Button variant={typeTab === 'all' ? 'primary' : 'secondary'} size="sm" onClick={() => setTypeTab('all')}>الكل</Button>
        <Button variant={typeTab === 'revenue' ? 'primary' : 'secondary'} size="sm" onClick={() => setTypeTab('revenue')}>قبض</Button>
        <Button variant={typeTab === 'expense' ? 'primary' : 'secondary'} size="sm" onClick={() => setTypeTab('expense')}>صرف</Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="لا توجد معاملات" description="أضف معاملة نقدية جديدة" actionLabel="إضافة معاملة" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={filtered} searchable searchKeys={['reason']} />
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة معاملة نقدية" size="lg" footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button onClick={() => {}}>حفظ</Button></div>}>
        <div className="grid grid-cols-2 gap-4">
          <Input label="التاريخ" type="date" />
          <Select label="النوع" options={[{ value: 'revenue', label: 'قبض' }, { value: 'expense', label: 'صرف' }]} />
          <Input label="المبلغ" type="number" />
          <Select label="الخزينة/البنك" options={[{ value: '', label: 'اختر' }]} />
          <Select label="الحساب" options={[{ value: '', label: 'اختر حساباً' }]} className="col-span-2" />
          <Input label="البيان" className="col-span-2" placeholder="سبب المعاملة" />
        </div>
      </Modal>
    </div>
  );
}
