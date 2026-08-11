'use client';

import { useState, useEffect, useCallback } from 'react';
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
import { Download, FileText, RefreshCw } from 'lucide-react';

const TYPE_LABELS: Record<string, string> = {
  asset: 'أصل',
  liability: 'خصم',
  equity: 'ملكية',
  revenue: 'إيراد',
  expense: 'مصروف',
};

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function yearStartISO() {
  return `${new Date().getFullYear()}-01-01`;
}

function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '\uFEFF' + [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('trial_balance');
  const [from, setFrom] = useState(yearStartISO());
  const [to, setTo] = useState(todayISO());
  const [trialBalance, setTrialBalance] = useState<any>(null);
  const [incomeStatement, setIncomeStatement] = useState<any>(null);
  const [balanceSheet, setBalanceSheet] = useState<any>(null);
  const [profitability, setProfitability] = useState<any>(null);
  const [aging, setAging] = useState<any>(null);
  const [agingType, setAgingType] = useState('ar');
  const [operational, setOperational] = useState<any>(null);
  const [opType, setOpType] = useState('project-costs');
  const [projects, setProjects] = useState<any[]>([]);
  const [projectId, setProjectId] = useState('');
  const [cashFlow, setCashFlow] = useState<any>(null);
  const [ledger, setLedger] = useState<any>(null);
  const [ledgerAccounts, setLedgerAccounts] = useState<any[]>([]);
  const [ledgerAccountId, setLedgerAccountId] = useState('');
  const [vat, setVat] = useState<any>(null);

  const qs = (extra: Record<string, string> = {}) => {
    const p = new URLSearchParams({ from, to, ...extra });
    return p.toString();
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (tab === 'trial_balance' || tab === 'income_statement' || tab === 'balance_sheet') {
        const type = tab;
        const res = await fetch(`/api/reports/financial?type=${type}&${qs()}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.message || 'فشل تحميل التقرير');
        if (tab === 'trial_balance') setTrialBalance(json.data);
        if (tab === 'income_statement') setIncomeStatement(json.data);
        if (tab === 'balance_sheet') setBalanceSheet(json.data);
      } else if (tab === 'profitability') {
        const res = await fetch(`/api/reports/profitability?${qs()}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.message || 'فشل تحميل التقرير');
        setProfitability(json.data);
      } else if (tab === 'aging') {
        const res = await fetch(`/api/reports/aging?type=${agingType}&asOf=${to}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.message || 'فشل تحميل التقرير');
        setAging(json.data);
      } else if (tab === 'operational') {
        const extra: Record<string, string> = { type: opType };
        if (projectId) extra.projectId = projectId;
        const res = await fetch(`/api/reports/operational?${qs(extra)}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.message || 'فشل تحميل التقرير');
        setOperational(json.data);
      } else if (tab === 'cash_flow') {
        const res = await fetch(`/api/reports/cash-flow?${qs()}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.message || 'فشل تحميل التقرير');
        setCashFlow(json.data);
      } else if (tab === 'general_ledger') {
        const extra: Record<string, string> = {};
        if (ledgerAccountId) extra.account_id = ledgerAccountId;
        const res = await fetch(`/api/reports/general-ledger?${qs(extra)}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.message || 'فشل تحميل التقرير');
        setLedger(json.data);
      } else if (tab === 'vat') {
        const res = await fetch(`/api/reports/vat?${qs()}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.message || 'فشل تحميل التقرير');
        setVat(json.data);
      }
    } catch (e: any) {
      setError(e?.message || 'فشل تحميل البيانات');
    } finally {
      setLoading(false);
    }
  }, [tab, from, to, agingType, opType, projectId, ledgerAccountId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch('/api/projects').then((r) => r.json()).then((j) => {
      if (j.success) setProjects(j.data?.rows || j.data?.projects || []);
    }).catch(() => {});

    fetch('/api/accounts').then((r) => r.json()).then((j) => {
      if (!j.success) return;
      const flat: any[] = [];
      const walk = (nodes: any[]) => {
        for (const n of nodes || []) {
          if (!n.is_header) flat.push(n);
          if (n.children?.length) walk(n.children);
        }
      };
      walk(j.data?.accounts || []);
      setLedgerAccounts(flat);
    }).catch(() => {});
  }, []);

  const handleExport = () => {
    if (tab === 'trial_balance' && trialBalance?.accounts) {
      downloadCsv('trial-balance.csv', ['الكود', 'الحساب', 'النوع', 'مدين', 'دائن', 'الرصيد'],
        trialBalance.accounts.map((a: any) => [a.code, a.name, a.type, a.total_debit, a.total_credit, a.balance]));
    } else if (tab === 'income_statement' && incomeStatement) {
      downloadCsv('income-statement.csv', ['الكود', 'الحساب', 'النوع', 'المبلغ'], [
        ...(incomeStatement.revenue || []).map((r: any) => [r.code, r.name, 'إيراد', r.amount]),
        ...(incomeStatement.expenses || []).map((r: any) => [r.code, r.name, 'مصروف', r.amount]),
      ]);
    } else if (tab === 'profitability' && profitability?.projects) {
      downloadCsv('profitability.csv', ['المشروع', 'التعاقد', 'الإيراد', 'التكلفة', 'الربح', 'الهامش %'],
        profitability.projects.map((p: any) => [p.name, p.contract_value, p.revenue, p.total_costs, p.profit, p.profit_margin?.toFixed?.(1)]));
    } else if (tab === 'aging' && aging?.aging) {
      downloadCsv('aging.csv', ['الاسم', 'الرصيد', '0-30', '31-60', '61-90', '90+'],
        aging.aging.map((r: any) => [r.name, r.balance, r.buckets?.['0-30'], r.buckets?.['31-60'], r.buckets?.['61-90'], r.buckets?.['90+']]));
    } else if (tab === 'balance_sheet' && balanceSheet) {
      downloadCsv('balance-sheet.csv', ['القسم', 'الكود', 'الحساب', 'الرصيد'], [
        ...(balanceSheet.assets || []).map((r: any) => ['أصول', r.code, r.name, r.balance]),
        ...(balanceSheet.liabilities || []).map((r: any) => ['خصوم', r.code, r.name, r.balance]),
        ...(balanceSheet.equity || []).map((r: any) => ['ملكية', r.code, r.name, r.balance]),
      ]);
    }
  };

  const tbCols = [
    { key: 'code', label: 'الكود', sortable: true },
    { key: 'name', label: 'الحساب', sortable: true },
    { key: 'type', label: 'النوع', render: (row: any) => <Badge variant="info">{TYPE_LABELS[row.type] || row.type}</Badge> },
    { key: 'total_debit', label: 'مجموع مدين', render: (row: any) => formatCurrency(row.total_debit) },
    { key: 'total_credit', label: 'مجموع دائن', render: (row: any) => formatCurrency(row.total_credit) },
    { key: 'balance', label: 'الرصيد', render: (row: any) => <span className={row.balance < 0 ? 'text-danger' : 'text-success'}>{formatCurrency(row.balance)}</span> },
  ];

  const moneyCols = [
    { key: 'code', label: 'الكود' },
    { key: 'name', label: 'الحساب' },
    { key: 'amount', label: 'المبلغ', render: (row: any) => formatCurrency(row.amount ?? row.balance) },
  ];

  const bsCols = [
    { key: 'code', label: 'الكود' },
    { key: 'name', label: 'الحساب' },
    { key: 'balance', label: 'الرصيد', render: (row: any) => formatCurrency(row.balance) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="التقارير" description="تقارير مالية مبنية على القيود الفعلية — ليست أرقاماً تجريبية"
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" leftIcon={<RefreshCw size={16} />} onClick={load}>تحديث</Button>
            <Button variant="secondary" leftIcon={<Download size={16} />} onClick={handleExport}>تصدير CSV</Button>
          </div>
        }
      />

      <div className="flex flex-wrap gap-4 items-end">
        <Input label="من تاريخ" type="date" value={from} onChange={(e: any) => setFrom(e.target.value)} />
        <Input label="إلى تاريخ" type="date" value={to} onChange={(e: any) => setTo(e.target.value)} />
      </div>

      <Tabs items={[
        { id: 'trial_balance', label: 'ميزان المراجعة' },
        { id: 'income_statement', label: 'قائمة الدخل' },
        { id: 'balance_sheet', label: 'الميزانية العمومية' },
        { id: 'general_ledger', label: 'الأستاذ العام' },
        { id: 'cash_flow', label: 'التدفقات النقدية' },
        { id: 'profitability', label: 'ربحية المشاريع' },
        { id: 'aging', label: 'التقادم الزمني' },
        { id: 'vat', label: 'ضريبة القيمة المضافة' },
        { id: 'operational', label: 'تقارير تشغيلية' },
      ]} activeTab={tab} onChange={setTab} />

      {error && <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>}
      {loading && <LoadingSkeleton variant="card" count={3} />}

      {!loading && !error && tab === 'trial_balance' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <StatCard title="إجمالي المدين" value={formatCurrency(trialBalance?.total_debit || 0)} accentColor="var(--color-info)" />
            <StatCard title="إجمالي الدائن" value={formatCurrency(trialBalance?.total_credit || 0)} accentColor="var(--color-accent)" />
          </div>
          {(trialBalance?.accounts || []).length === 0 ? (
            <p className="text-text-muted text-center py-8">لا توجد قيود في الفترة المحددة</p>
          ) : (
            <Table columns={tbCols} data={trialBalance.accounts} />
          )}
        </div>
      )}

      {!loading && !error && tab === 'income_statement' && (
        <div className="space-y-6">
          {incomeStatement ? (
            <>
              <div className="grid grid-cols-3 gap-4">
                <StatCard title="إجمالي الإيرادات" value={formatCurrency(incomeStatement.total_revenue || 0)} accentColor="var(--color-success)" />
                <StatCard title="إجمالي المصروفات" value={formatCurrency(incomeStatement.total_expenses || 0)} accentColor="var(--color-danger)" />
                <StatCard title="صافي الدخل" value={formatCurrency(incomeStatement.net_income || 0)} accentColor="var(--color-accent)" />
              </div>
              <Card title="الإيرادات"><Table columns={moneyCols} data={(incomeStatement.revenue || []).filter((r: any) => r.amount)} /></Card>
              <Card title="المصروفات"><Table columns={moneyCols} data={(incomeStatement.expenses || []).filter((r: any) => r.amount)} /></Card>
            </>
          ) : (
            <p className="text-text-muted text-center py-8">لا توجد بيانات</p>
          )}
        </div>
      )}

      {!loading && !error && tab === 'balance_sheet' && (
        <div className="space-y-6">
          {balanceSheet ? (
            <>
              <div className="grid grid-cols-3 gap-4">
                <StatCard title="إجمالي الأصول" value={formatCurrency(balanceSheet.total_assets || 0)} accentColor="var(--color-info)" />
                <StatCard title="إجمالي الخصوم" value={formatCurrency(balanceSheet.total_liabilities || 0)} accentColor="var(--color-warning)" />
                <StatCard title="حقوق الملكية" value={formatCurrency(balanceSheet.total_equity || 0)} accentColor="var(--color-accent)" />
              </div>
              <p className="text-sm text-text-muted">
                المعادلة: أصول = خصوم + حقوق ملكية
                {Math.abs((balanceSheet.total_assets || 0) - ((balanceSheet.total_liabilities || 0) + (balanceSheet.total_equity || 0))) < 0.05
                  ? ' — متوازنة'
                  : ` — فرق ${formatCurrency((balanceSheet.total_assets || 0) - ((balanceSheet.total_liabilities || 0) + (balanceSheet.total_equity || 0)))}`}
              </p>
              <Card title="الأصول"><Table columns={bsCols} data={balanceSheet.assets || []} /></Card>
              <Card title="الخصوم"><Table columns={bsCols} data={balanceSheet.liabilities || []} /></Card>
              <Card title="حقوق الملكية"><Table columns={bsCols} data={balanceSheet.equity || []} /></Card>
            </>
          ) : (
            <p className="text-text-muted text-center py-8">لا توجد بيانات</p>
          )}
        </div>
      )}

      {!loading && !error && tab === 'general_ledger' && (
        <div className="space-y-4">
          <Select
            label="الحساب"
            value={ledgerAccountId}
            onChange={setLedgerAccountId}
            options={[{ value: '', label: 'كل الحسابات' }, ...ledgerAccounts.map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` }))]}
          />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard title="رصيد افتتاحي" value={formatCurrency(ledger?.opening_balance || 0)} />
            <StatCard title="مدين" value={formatCurrency(ledger?.total_debit || 0)} />
            <StatCard title="دائن" value={formatCurrency(ledger?.total_credit || 0)} />
            <StatCard title="رصيد ختامي" value={formatCurrency(ledger?.closing_balance || 0)} />
          </div>
          <Table
            columns={[
              { key: 'date', label: 'التاريخ' },
              { key: 'number', label: 'رقم القيد' },
              { key: 'account_code', label: 'الحساب' },
              { key: 'description', label: 'البيان' },
              { key: 'debit', label: 'مدين', render: (r: any) => formatCurrency(r.debit) },
              { key: 'credit', label: 'دائن', render: (r: any) => formatCurrency(r.credit) },
              { key: 'balance', label: 'الرصيد', render: (r: any) => formatCurrency(r.balance) },
            ]}
            data={ledger?.transactions || []}
          />
        </div>
      )}

      {!loading && !error && tab === 'cash_flow' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard title="رصيد أول المدة" value={formatCurrency(cashFlow?.opening_balance || 0)} />
            <StatCard title="تشغيلي" value={formatCurrency(cashFlow?.operating?.net || 0)} accentColor="var(--color-info)" />
            <StatCard title="استثماري" value={formatCurrency(cashFlow?.investing?.net || 0)} />
            <StatCard title="رصيد آخر المدة" value={formatCurrency(cashFlow?.closing_balance || 0)} accentColor="var(--color-success)" />
          </div>
          <Card title="الأنشطة التشغيلية — مقبوضات">
            <Table columns={[
              { key: 'account_name', label: 'الحساب' },
              { key: 'description', label: 'البيان' },
              { key: 'amount', label: 'المبلغ', render: (r: any) => formatCurrency(r.amount) },
            ]} data={cashFlow?.operating?.inflows || []} />
          </Card>
          <Card title="الأنشطة التشغيلية — مدفوعات">
            <Table columns={[
              { key: 'account_name', label: 'الحساب' },
              { key: 'description', label: 'البيان' },
              { key: 'amount', label: 'المبلغ', render: (r: any) => formatCurrency(r.amount) },
            ]} data={cashFlow?.operating?.outflows || []} />
          </Card>
        </div>
      )}

      {!loading && !error && tab === 'profitability' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard title="قيمة التعاقدات" value={formatCurrency(profitability?.totals?.contract_value || 0)} />
            <StatCard title="الإيراد المحقق" value={formatCurrency(profitability?.totals?.revenue || 0)} accentColor="var(--color-success)" />
            <StatCard title="التكاليف" value={formatCurrency(profitability?.totals?.total_costs || 0)} accentColor="var(--color-danger)" />
            <StatCard title="صافي الربح" value={formatCurrency(profitability?.totals?.profit || 0)} accentColor="var(--color-accent)" />
          </div>
          <Table
            columns={[
              { key: 'name', label: 'المشروع' },
              { key: 'client_name', label: 'العميل' },
              { key: 'contract_value', label: 'التعاقد', render: (r: any) => formatCurrency(r.contract_value) },
              { key: 'revenue', label: 'الإيراد', render: (r: any) => formatCurrency(r.revenue) },
              { key: 'total_costs', label: 'التكلفة', render: (r: any) => formatCurrency(r.total_costs) },
              { key: 'profit', label: 'الربح', render: (r: any) => <span className={r.profit < 0 ? 'text-danger' : 'text-success'}>{formatCurrency(r.profit)}</span> },
              { key: 'profit_margin', label: 'الهامش', render: (r: any) => `${(r.profit_margin || 0).toFixed(1)}%` },
            ]}
            data={profitability?.projects || []}
          />
        </div>
      )}

      {!loading && !error && tab === 'aging' && (
        <div className="space-y-4">
          <Select
            label="النوع"
            value={agingType}
            onChange={setAgingType}
            options={[
              { value: 'ar', label: 'ذمم العملاء (مدينون)' },
              { value: 'ap', label: 'ذمم الموردين (دائنون)' },
            ]}
          />
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            <StatCard title="الإجمالي" value={formatCurrency(aging?.totals?.balance || 0)} />
            <StatCard title="0-30 يوم" value={formatCurrency(aging?.totals?.['0-30'] || 0)} />
            <StatCard title="31-60" value={formatCurrency(aging?.totals?.['31-60'] || 0)} />
            <StatCard title="61-90" value={formatCurrency(aging?.totals?.['61-90'] || 0)} />
            <StatCard title="أكثر من 90" value={formatCurrency(aging?.totals?.['90+'] || 0)} accentColor="var(--color-danger)" />
          </div>
          <Table
            columns={[
              { key: 'name', label: 'الاسم' },
              { key: 'balance', label: 'الرصيد', render: (r: any) => formatCurrency(r.balance) },
              { key: 'b0', label: '0-30', render: (r: any) => formatCurrency(r.buckets?.['0-30'] || 0) },
              { key: 'b1', label: '31-60', render: (r: any) => formatCurrency(r.buckets?.['31-60'] || 0) },
              { key: 'b2', label: '61-90', render: (r: any) => formatCurrency(r.buckets?.['61-90'] || 0) },
              { key: 'b3', label: '90+', render: (r: any) => formatCurrency(r.buckets?.['90+'] || 0) },
              { key: 'days_overdue', label: 'أيام التأخير' },
            ]}
            data={aging?.aging || []}
          />
        </div>
      )}

      {!loading && !error && tab === 'vat' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard title="ضريبة مخرجات" value={formatCurrency(vat?.summary?.total_vat_collected || 0)} />
            <StatCard title="ضريبة مدخلات" value={formatCurrency(vat?.summary?.total_vat_paid || 0)} />
            <StatCard title="الضريبة المستحقة" value={formatCurrency(vat?.summary?.vat_payable || 0)} accentColor="var(--color-accent)" />
            <StatCard title="المبيعات بدون ضريبة" value={formatCurrency(vat?.summary?.total_sales_excluding_vat || 0)} />
          </div>
          <p className="text-sm text-text-muted">
            الحالة: {vat?.summary?.vat_payable_status === 'refundable' ? 'رصيد قابل للاسترداد' : 'مستحق السداد'} — نسبة الضريبة {(vat?.vat_rate || 0.15) * 100}%
          </p>
        </div>
      )}

      {!loading && !error && tab === 'operational' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <Select label="نوع التقرير" value={opType} onChange={setOpType} options={[
              { value: 'project-costs', label: 'تكاليف المشاريع' },
              { value: 'material-issuances', label: 'صرف المواد' },
              { value: 'inventory-transfers', label: 'تحويلات مخزنية' },
            ]} />
            <Select label="المشروع" value={projectId} onChange={setProjectId} options={[
              { value: '', label: 'كل المشاريع' },
              ...projects.map((p: any) => ({ value: p.id, label: p.name })),
            ]} />
            <Button variant="secondary" leftIcon={<FileText size={16} />} onClick={load}>عرض</Button>
          </div>
          {opType === 'project-costs' && operational && !Array.isArray(operational) && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
              <StatCard title="تكاليف المواد" value={formatCurrency(operational.materials || 0)} accentColor="var(--color-info)" />
              <StatCard title="تكاليف العمالة" value={formatCurrency(operational.workers || 0)} accentColor="var(--color-warning)" />
              <StatCard title="المشتريات" value={formatCurrency(operational.purchases || 0)} accentColor="var(--color-accent)" />
              <StatCard title="مقاولو الباطن" value={formatCurrency(operational.subcontractors || 0)} accentColor="var(--color-success)" />
              <StatCard title="الإجمالي" value={formatCurrency(operational.total || 0)} />
            </div>
          )}
          {Array.isArray(operational) && (
            <Table
              columns={[
                { key: 'date', label: 'التاريخ' },
                { key: 'item_name', label: 'الصنف' },
                { key: 'project_name', label: 'المشروع' },
                { key: 'type', label: 'النوع' },
                { key: 'quantity', label: 'الكمية' },
                { key: 'total_value', label: 'القيمة', render: (r: any) => formatCurrency(r.total_value || 0) },
              ]}
              data={operational}
            />
          )}
        </div>
      )}
    </div>
  );
}
