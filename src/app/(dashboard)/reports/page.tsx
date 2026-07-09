'use client';

import { useState, useEffect } from 'react';
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

export default function ReportsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('trial_balance');
  const [trialBalance, setTrialBalance] = useState<any[]>([]);
  const [incomeStatement, setIncomeStatement] = useState<any>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/reports/financial?type=${tab === 'income_statement' ? 'income_statement' : 'trial_balance'}`);
        const json = await res.json();
        if (json.success) {
          if (tab === 'income_statement') {
            setIncomeStatement(json.data || null);
          } else {
            setTrialBalance(json.data?.accounts || []);
          }
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
  }, [tab]);

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

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="التقارير" description="التقارير المالية والمحاسبية"
          actions={<Button variant="secondary" leftIcon={<Download size={16} />}>تصدير</Button>}
        />
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>
      </div>
    );
  }

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
          {trialBalance.length === 0 ? (
            <p className="text-text-muted text-center py-8">لا توجد بيانات</p>
          ) : (
            <Table columns={tbCols} data={trialBalance} />
          )}
        </div>
      )}

      {tab === 'income_statement' && (
        <div className="space-y-6">
          {incomeStatement ? (
            <>
              <div className="grid grid-cols-3 gap-4">
                <StatCard title="إجمالي الإيرادات" value={formatCurrency(incomeStatement.total_revenue || 0)} accentColor="var(--color-success)" />
                <StatCard title="إجمالي المصروفات" value={formatCurrency(incomeStatement.total_expenses || 0)} accentColor="var(--color-danger)" />
                <StatCard title="صافي الدخل" value={formatCurrency(incomeStatement.net_income || 0)} accentColor="var(--color-accent)" />
              </div>
              <Card title="الإيرادات"><Table columns={incomeCols} data={incomeStatement.revenue || []} /></Card>
              <Card title="المصروفات"><Table columns={incomeCols} data={incomeStatement.expenses || []} /></Card>
            </>
          ) : (
            <p className="text-text-muted text-center py-8">لا توجد بيانات</p>
          )}
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
