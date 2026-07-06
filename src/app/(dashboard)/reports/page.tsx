'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Tabs } from '@/components/ui/Tabs';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Table } from '@/components/ui/Table';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { StatCard } from '@/components/ui/StatCard';
import { formatCurrency } from '@/lib/utils';
import { Download, FileText } from 'lucide-react';

const mockTB = [
  { id: '1', code: '1110', name: 'النقدية', type: 'asset', total_debit: 500000, total_credit: 100000, balance: 400000 },
  { id: '2', code: '2110', name: 'الدائنون', type: 'liability', total_debit: 0, total_credit: 200000, balance: -200000 },
  { id: '3', code: '4100', name: 'إيرادات العقود', type: 'revenue', total_debit: 0, total_credit: 500000, balance: -500000 },
];

const mockIncome = {
  revenue: [{ id: '1', code: '4100', name: 'إيرادات العقود', amount: 500000 }],
  expenses: [{ id: '2', code: '5100', name: 'تكاليف مباشرة', amount: 300000 }],
  total_revenue: 500000, total_expenses: 300000, net_income: 200000,
};

export default function ReportsPage() {
  const [loading] = useState(false);
  const [tab, setTab] = useState('trial_balance');

  const tbCols = [
    { key: 'code', label: 'الكود', sortable: true },
    { key: 'name', label: 'الحساب', sortable: true },
    { key: 'type', label: 'النوع', render: (row: any) => <Badge variant="info">{row.type}</Badge> },
    { key: 'total_debit', label: 'مجموع مدين', render: (row: any) => formatCurrency(row.total_debit) },
    { key: 'total_credit', label: 'مجموع دائن', render: (row: any) => formatCurrency(row.total_credit) },
    { key: 'balance', label: 'الرصيد', render: (row: any) => <span className={row.balance < 0 ? 'text-danger' : 'text-success'}>{formatCurrency(Math.abs(row.balance))}</span> },
  ];

  const incomeCols = [
    { key: 'code', label: 'الكود' }, { key: 'name', label: 'الحساب' },
    { key: 'amount', label: 'المبلغ', render: (row: any) => formatCurrency(row.amount) },
  ];

  if (loading) return <LoadingSkeleton variant="card" count={4} />;

  return (
    <div className="space-y-6">
      <PageHeader title="التقارير" description="التقارير المالية والمحاسبية"
        actions={<Button variant="secondary" leftIcon={<Download size={16} />}>تصدير</Button>}
      />

      <Tabs items={[
        { id: 'trial_balance', label: 'ميزان المراجعة' },
        { id: 'income_statement', label: 'قائمة الدخل' },
        { id: 'balance_sheet', label: 'الميزانية العمومية' },
        { id: 'profitability', label: 'ربحية المشاريع' },
        { id: 'aging', label: 'التقادم الزمني' },
        { id: 'operational', label: 'تقارير تشغيلية' },
      ]} activeTab={tab} onChange={setTab} />

      {tab === 'trial_balance' && (
        <div className="space-y-4">
          <div className="flex gap-4">
            <Input label="من تاريخ" type="date" />
            <Input label="إلى تاريخ" type="date" />
          </div>
          <Table columns={tbCols} data={mockTB} />
        </div>
      )}

      {tab === 'income_statement' && (
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-4">
            <StatCard title="إجمالي الإيرادات" value={formatCurrency(mockIncome.total_revenue)} accentColor="var(--color-success)" />
            <StatCard title="إجمالي المصروفات" value={formatCurrency(mockIncome.total_expenses)} accentColor="var(--color-danger)" />
            <StatCard title="صافي الدخل" value={formatCurrency(mockIncome.net_income)} accentColor="var(--color-accent)" />
          </div>
          <Card title="الإيرادات"><Table columns={incomeCols} data={mockIncome.revenue} /></Card>
          <Card title="المصروفات"><Table columns={incomeCols} data={mockIncome.expenses} /></Card>
        </div>
      )}

      {tab === 'profitability' && (
        <div>
          <p className="text-text-muted">تقرير ربحية المشاريع - قيد التطوير</p>
        </div>
      )}

      {tab === 'aging' && (
        <div>
          <p className="text-text-muted">تقرير التقادم الزمني للذمم - قيد التطوير</p>
        </div>
      )}

      {tab === 'operational' && (
        <div className="space-y-4">
          <div className="flex gap-4">
            <Select label="نوع التقرير" options={[
              { value: 'project-costs', label: 'تكاليف المشاريع' },
              { value: 'material-issuances', label: 'صرف المواد' },
              { value: 'inventory-transfers', label: 'تحويلات مخزنية' },
            ]} />
            <Select label="المشروع" options={[{ value: '', label: 'الكل' }]} />
            <Button variant="secondary" leftIcon={<FileText size={16} />}>عرض</Button>
          </div>
          <Card title="تفاصيل التكاليف التشغيلية">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <StatCard title="تكاليف المواد" value={formatCurrency(85000)} accentColor="var(--color-info)" />
              <StatCard title="تكاليف العمالة" value={formatCurrency(45000)} accentColor="var(--color-warning)" />
              <StatCard title="المشتريات" value={formatCurrency(120000)} accentColor="var(--color-accent)" />
              <StatCard title="مقاولو الباطن" value={formatCurrency(65000)} accentColor="var(--color-success)" />
            </div>
          </Card>
        </div>
      )}

      {tab === 'balance_sheet' && (
        <div>
          <p className="text-text-muted">الميزانية العمومية - قيد التطوير</p>
        </div>
      )}
    </div>
  );
}
