'use client';

import { useState } from 'react';
import { Play, Eye } from 'lucide-react';
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

const mockPayroll = [
  { id: '1', date: '2026-06-01', employee_name: 'أحمد محمد', basic_salary: 12000, advance_deduction: 500, net_pay: 11500 },
  { id: '2', date: '2026-06-01', employee_name: 'سارة خالد', basic_salary: 15000, advance_deduction: 0, net_pay: 15000 },
];

export default function PayrollPage() {
  const [loading] = useState(false);
  const [showProcess, setShowProcess] = useState(false);

  const columns = [
    { key: 'date', label: 'الشهر', sortable: true, render: (row: any) => row.date?.substring(0, 7) },
    { key: 'employee_name', label: 'الموظف', sortable: true },
    { key: 'basic_salary', label: 'الراتب الأساسي', sortable: true, render: (row: any) => formatCurrency(row.basic_salary) },
    { key: 'advance_deduction', label: 'خصم السلف', sortable: true, render: (row: any) => formatCurrency(row.advance_deduction) },
    { key: 'net_pay', label: 'صافي الراتب', sortable: true, render: (row: any) => formatCurrency(row.net_pay) },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;

  return (
    <div className="space-y-6">
      <PageHeader title="الرواتب" description="إدارة ومعالجة الرواتب"
        actions={<Button onClick={() => setShowProcess(true)} leftIcon={<Play size={18} />}>معالجة الرواتب</Button>}
      />
      {mockPayroll.length === 0 ? (
        <EmptyState title="لا توجد معالجات سابقة" description="قم بمعالجة الرواتب لشهر جديد" actionLabel="معالجة الرواتب" onAction={() => setShowProcess(true)} />
      ) : (
        <DataTable columns={columns} data={mockPayroll} searchable searchKeys={['employee_name']} />
      )}
      <Modal isOpen={showProcess} onClose={() => setShowProcess(false)} title="معالجة الرواتب" size="lg" footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowProcess(false)}>إلغاء</Button><Button>معالجة</Button></div>}>
        <div className="space-y-4">
          <Input label="الشهر" type="month" />
          <Select label="الموظفين" options={[{ value: 'all', label: 'جميع الموظفين' }]} />
          <p className="text-sm text-text-muted">سيتم إنشاء قيد محاسبي (Dr مصروفات رواتب / Cr رواتب مستحقة + Cr سلف موظفين)</p>
        </div>
      </Modal>
    </div>
  );
}
