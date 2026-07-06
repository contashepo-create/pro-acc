'use client';

import { useState } from 'react';
import { Plus, Eye, Search, CheckCircle2, XCircle } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';

const mockReconciliations = [
  { id: '1', bank_safe_name: 'البنك الأهلي', date: '2026-06-01', closing_balance: 150000, status: 'completed', difference: 0 },
  { id: '2', bank_safe_name: 'خزينة رئيسية', date: '2026-05-01', closing_balance: 50000, status: 'pending', difference: 1200 },
];

export default function BankReconciliationPage() {
  const [loading] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const columns = [
    { key: 'bank_safe_name', label: 'البنك/الخزينة', sortable: true },
    { key: 'date', label: 'التاريخ', sortable: true },
    { key: 'closing_balance', label: 'الرصيد الختامي', sortable: true,
      render: (row: any) => row.closing_balance.toLocaleString(),
    },
    { key: 'difference', label: 'الفروقات',
      render: (row: any) => (
        <span className={row.difference === 0 ? 'text-green-600' : 'text-red-600'}>
          {row.difference === 0 ? '✓ مطابق' : `${row.difference.toLocaleString()} غير مطابق`}
        </span>
      ),
    },
    { key: 'status', label: 'الحالة',
      render: (row: any) => row.status === 'completed'
        ? <Badge variant="success">مغلقة</Badge>
        : <Badge variant="warning">معلقة</Badge>,
    },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={6} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="تسوية البنوك"
        description="مطابقة كشوف الحساب البنكي مع القيود المحاسبية"
        actions={
          <Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>تسوية جديدة</Button>
        }
      />
      {mockReconciliations.length === 0 ? (
        <EmptyState title="لا توجد تسويات" actionLabel="تسوية جديدة" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={mockReconciliations} searchable searchKeys={['bank_safe_name']} />
      )}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="تسوية بنكية جديدة" size="lg" footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button>حفظ التسوية</Button></div>}>
        <div className="space-y-4">
          <Select label="البنك/الخزينة" options={[{ value: '', label: 'اختر' }]} />
          <Input label="تاريخ التسوية" type="date" />
          <Input label="الرصيد الختامي حسب كشف الحساب" type="number" />
          <div className="border border-border rounded-lg p-4">
            <h3 className="font-medium mb-3">حركات كشف الحساب</h3>
            <div className="space-y-2">
              <div className="flex items-center gap-2 p-2 bg-bg-card rounded-lg border border-border">
                <Input placeholder="الوصف" className="flex-1" />
                <Input type="number" placeholder="المبلغ" className="w-32" />
                <Input type="date" className="w-40" />
              </div>
            </div>
            <Button variant="ghost" size="sm" className="mt-2">+ إضافة حركة</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
