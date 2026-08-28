'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
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
import { companyDisplayMoney } from '@/lib/company-money';
import { defaultFiscalWindow, localDateISO } from '@/lib/fiscal-calendar';
import { apiFetch } from '@/lib/api-client';
import { Download, FileText, RefreshCw } from 'lucide-react';
import { useAuthStore } from '@/store/auth-store';
import { taxAuthorityName } from '@/lib/tax-authority';

const TYPE_LABELS: Record<string, string> = {
  asset: 'أصل',
  liability: 'خصم',
  equity: 'ملكية',
  revenue: 'إيراد',
  expense: 'مصروف',
};

interface TrialBalanceAccount { code: string; name: string; type: string; total_debit: number; total_credit: number; balance: number; }
interface TrialBalanceData { accounts: TrialBalanceAccount[]; total_debit: number; total_credit: number; }
interface MoneyRow { code: string; name: string; amount: number; balance?: number; }
interface IncomeStatementData { total_revenue: number; total_expenses: number; net_income: number; revenue: MoneyRow[]; expenses: MoneyRow[]; }
interface BalanceSheetRow { code: string; name: string; balance: number; }
interface BalanceSheetData { total_assets: number; total_liabilities: number; total_equity: number; assets: BalanceSheetRow[]; liabilities: BalanceSheetRow[]; equity: BalanceSheetRow[]; }
interface EquityRow { label: string; capital: number; retained_earnings: number; net_income: number; total: number; }
interface EquityChangesData { opening: { total: number }; changes: { net_income: number; total_change: number }; ending: { total: number }; rows: EquityRow[]; }
interface ContactRow { name: string; type: string; phone: string; tax_number?: string; opening_balance: number; period_debit: number; period_credit: number; closing_balance: number; balance_type?: string; }
interface ContactBalancesData { totals: { opening: number; debit: number; credit: number; closing: number }; contacts: ContactRow[]; }
interface ExpenseCategory { code: string; name: string; amount: number; percentage: number; }
interface ExpenseAnalysisData { total_expense: number; count: number; categories: ExpenseCategory[]; }
interface LedgerAccount { id: string; code: string; name: string; is_header?: boolean; children?: LedgerAccount[]; }
interface LedgerTransaction { date: string; number: string; account_code: string; description: string; debit: number; credit: number; balance: number; }
interface LedgerData { opening_balance: number; total_debit: number; total_credit: number; closing_balance: number; transactions: LedgerTransaction[]; }
interface CashFlowLine { account_name: string; description: string; amount: number; }
interface CashFlowData { opening_balance: number; closing_balance: number; operating: { net: number; inflows: CashFlowLine[]; outflows: CashFlowLine[] }; investing: { net: number }; }
interface ProfitabilityProject { name: string; client_name?: string; contract_value: number; revenue: number; total_costs: number; profit: number; profit_margin?: number; }
interface ProfitabilityData { totals: { contract_value: number; revenue: number; total_costs: number; profit: number }; projects: ProfitabilityProject[]; }
interface AgingRow { name: string; balance: number; buckets?: Record<string, number>; days_overdue?: number; }
interface AgingData { totals: Record<string, number>; aging: AgingRow[]; }
interface VatData { summary: { total_vat_collected: number; total_vat_paid: number; vat_payable: number; total_sales_excluding_vat: number; vat_payable_status?: string }; vat_rate: number; }
interface OperationalRow { date: string; item_name?: string; project_name?: string; type?: string; quantity?: number; total_value?: number; }
interface OperationalData { materials?: number; workers?: number; purchases?: number; subcontractors?: number; total?: number; rows?: OperationalRow[]; }
interface ProjectOption { id: string; name: string; }

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
  const { company } = useAuthStore();
  const money = (n: number) => companyDisplayMoney(Number(n) || 0, company);
  const authority = taxAuthorityName(company?.country_code);
  const vatPercentDefault = company?.country_code === 'EG' ? 14 : 15;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('trial_balance');
  const fromTouched = useRef(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(() => localDateISO());

  // Report Data States
  const [trialBalance, setTrialBalance] = useState<TrialBalanceData | null>(null);
  const [incomeStatement, setIncomeStatement] = useState<IncomeStatementData | null>(null);
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheetData | null>(null);
  const [equityChanges, setEquityChanges] = useState<EquityChangesData | null>(null);
  const [contactBalances, setContactBalances] = useState<ContactBalancesData | null>(null);
  const [contactTypeFilter, setContactTypeFilter] = useState('all');
  const [expenseAnalysis, setExpenseAnalysis] = useState<ExpenseAnalysisData | null>(null);
  const [profitability, setProfitability] = useState<ProfitabilityData | null>(null);
  const [aging, setAging] = useState<AgingData | null>(null);
  const [agingType, setAgingType] = useState('ar');
  const [operational, setOperational] = useState<OperationalData | null>(null);
  const [opType, setOpType] = useState('project-costs');
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectId, setProjectId] = useState('');
  const [cashFlow, setCashFlow] = useState<CashFlowData | null>(null);
  const [ledger, setLedger] = useState<LedgerData | null>(null);
  const [ledgerAccounts, setLedgerAccounts] = useState<LedgerAccount[]>([]);
  const [ledgerAccountId, setLedgerAccountId] = useState('');
  const [vat, setVat] = useState<VatData | null>(null);

  const load = useCallback(async () => {
    const qs = (extra: Record<string, string> = {}) => {
      const p = new URLSearchParams({ from, to, ...extra });
      return p.toString();
    };
    setLoading(true);
    setError('');
    try {
      if (tab === 'trial_balance' || tab === 'income_statement' || tab === 'balance_sheet') {
        const type = tab;
        const res = await apiFetch(`/api/reports/financial?type=${type}&${qs()}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.message || 'فشل تحميل التقرير');
        if (tab === 'trial_balance') setTrialBalance(json.data);
        if (tab === 'income_statement') setIncomeStatement(json.data);
        if (tab === 'balance_sheet') setBalanceSheet(json.data);
      } else if (tab === 'equity_changes') {
        const res = await fetch(`/api/reports/equity-changes?${qs()}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.message || 'فشل تحميل التقرير');
        setEquityChanges(json.data);
      } else if (tab === 'contact_balances') {
        const res = await fetch(`/api/reports/contact-balances?type=${contactTypeFilter}&${qs()}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.message || 'فشل تحميل التقرير');
        setContactBalances(json.data);
      } else if (tab === 'expense_analysis') {
        const res = await fetch(`/api/reports/expense-analysis?${qs()}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.message || 'فشل تحميل التقرير');
        setExpenseAnalysis(json.data);
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
    } catch (e) {
      setError((e instanceof Error ? e.message : '') || 'فشل تحميل البيانات');
    } finally {
      setLoading(false);
    }
  }, [tab, from, to, agingType, opType, projectId, ledgerAccountId, contactTypeFilter]);

  // Standard fetch-on-change effect: load() sets the loading indicator
  // synchronously before the network round trip so the UI never shows
  // stale data while refetching.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (from) load(); }, [load]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    if (fromTouched.current || !company) return;
    setFrom(defaultFiscalWindow(company.country_code).start);
  }, [company, company?.country_code]);

  useEffect(() => {
    fetch('/api/projects').then((r) => r.json()).then((j) => {
      if (j.success) setProjects(j.data?.rows || j.data?.projects || []);
    }).catch(() => {});

    fetch('/api/accounts').then((r) => r.json()).then((j) => {
      if (!j.success) return;
      const flat: LedgerAccount[] = [];
      const walk = (nodes: LedgerAccount[]) => {
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
        (trialBalance.accounts || []).map((a: TrialBalanceAccount) => [a.code, a.name, a.type, a.total_debit, a.total_credit, a.balance]));
    } else if (tab === 'income_statement' && incomeStatement) {
      downloadCsv('income-statement.csv', ['الكود', 'الحساب', 'النوع', 'المبلغ'], [
        ...(incomeStatement.revenue || []).map((r: MoneyRow) => [r.code, r.name, 'إيراد', r.amount]),
        ...(incomeStatement.expenses || []).map((r: MoneyRow) => [r.code, r.name, 'مصروف', r.amount]),
      ]);
    } else if (tab === 'balance_sheet' && balanceSheet) {
      downloadCsv('balance-sheet.csv', ['القسم', 'الكود', 'الحساب', 'الرصيد'], [
        ...(balanceSheet.assets || []).map((r: BalanceSheetRow) => ['أصول', r.code, r.name, r.balance]),
        ...(balanceSheet.liabilities || []).map((r: BalanceSheetRow) => ['خصوم', r.code, r.name, r.balance]),
        ...(balanceSheet.equity || []).map((r: BalanceSheetRow) => ['ملكية', r.code, r.name, r.balance]),
      ]);
    } else if (tab === 'equity_changes' && equityChanges?.rows) {
      downloadCsv('equity-changes.csv', ['البيان', 'رأس المال', 'الأرباح المحتجزة', 'صافي دخل الفترة', 'إجمالي حقوق الملكية'],
        (equityChanges.rows || []).map((r: EquityRow) => [r.label, r.capital, r.retained_earnings, r.net_income, r.total]));
    } else if (tab === 'contact_balances' && contactBalances?.contacts) {
      downloadCsv('contact-balances.csv', ['الاسم', 'النوع', 'الهاتف', 'الرقم الضريبي', 'رصيد افتتاحي', 'مدين', 'دائن', 'الرصيد الختامي'],
        (contactBalances.contacts || []).map((c: ContactRow) => [c.name, c.type, c.phone, c.tax_number ?? '', c.opening_balance, c.period_debit, c.period_credit, c.closing_balance]));
    } else if (tab === 'expense_analysis' && expenseAnalysis?.categories) {
      downloadCsv('expense-analysis.csv', ['رمز الحساب', 'اسم الحساب', 'المبلغ', 'النسبة المئوية %'],
        (expenseAnalysis.categories || []).map((c: ExpenseCategory) => [c.code, c.name, c.amount, `${c.percentage.toFixed(1)}%`]));
    } else if (tab === 'profitability' && profitability?.projects) {
      downloadCsv('profitability.csv', ['المشروع', 'التعاقد', 'الإيراد', 'التكلفة', 'الربح', 'الهامش %'],
        (profitability.projects || []).map((p: ProfitabilityProject) => [p.name, p.contract_value, p.revenue, p.total_costs, p.profit, p.profit_margin?.toFixed?.(1) ?? '']));
    } else if (tab === 'aging' && aging?.aging) {
      downloadCsv('aging.csv', ['الاسم', 'الرصيد', '0-30', '31-60', '61-90', '90+'],
        (aging.aging || []).map((r: AgingRow) => [r.name, r.balance, r.buckets?.['0-30'] ?? '', r.buckets?.['31-60'] ?? '', r.buckets?.['61-90'] ?? '', r.buckets?.['90+'] ?? '']));
    }
  };

  const tbCols = [
    { key: 'code', label: 'الكود', sortable: true },
    { key: 'name', label: 'الحساب', sortable: true },
    { key: 'type', label: 'النوع', render: (row: TrialBalanceAccount) => <Badge variant="info">{TYPE_LABELS[row.type] || row.type}</Badge> },
    { key: 'total_debit', label: 'مجموع مدين', render: (row: TrialBalanceAccount) => money(row.total_debit) },
    { key: 'total_credit', label: 'مجموع دائن', render: (row: TrialBalanceAccount) => money(row.total_credit) },
    { key: 'balance', label: 'الرصيد', render: (row: TrialBalanceAccount) => <span className={row.balance < 0 ? 'text-danger font-bold' : 'text-success font-bold'}>{money(row.balance)}</span> },
  ];

  const moneyCols = [
    { key: 'code', label: 'الكود' },
    { key: 'name', label: 'الحساب' },
    { key: 'amount', label: 'المبلغ', render: (row: MoneyRow) => money(row.amount ?? row.balance) },
  ];

  const bsCols = [
    { key: 'code', label: 'الكود' },
    { key: 'name', label: 'الحساب' },
    { key: 'balance', label: 'الرصيد', render: (row: BalanceSheetRow) => money(row.balance) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader 
        title="التقارير المالية والمحاسبية" 
        description={`تقارير مالية مبنية على القيود الفعلية ومطابقة للمعايير الدولية و${authority}`}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" leftIcon={<RefreshCw size={16} />} onClick={load}>تحديث البيانات</Button>
            <Button variant="secondary" leftIcon={<Download size={16} />} onClick={handleExport}>تصدير CSV</Button>
          </div>
        }
      />

      <div className="flex flex-wrap gap-4 items-end bg-bg-card border border-border p-4 rounded-xl">
        <Input label="من تاريخ" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input label="إلى تاريخ" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>

      <Tabs items={[
        { id: 'trial_balance', label: 'ميزان المراجعة' },
        { id: 'income_statement', label: 'قائمة الدخل' },
        { id: 'balance_sheet', label: 'الميزانية العمومية' },
        { id: 'equity_changes', label: 'التغيرات في حقوق الملكية 🏛️' },
        { id: 'general_ledger', label: 'الأستاذ العام' },
        { id: 'contact_balances', label: 'أرصدة العملاء والموردين 👥' },
        { id: 'expense_analysis', label: 'تحليل المصروفات 📊' },
        { id: 'cash_flow', label: 'التدفقات النقدية' },
        { id: 'profitability', label: 'ربحية المشاريع' },
        { id: 'aging', label: 'التقادم الزمني للديون' },
        { id: 'vat', label: 'ضريبة القيمة المضافة' },
        { id: 'operational', label: 'تقارير تشغيلية' },
      ]} activeTab={tab} onChange={setTab} />

      {error && <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>}
      {loading && <LoadingSkeleton variant="card" count={3} />}

      {/* 1. Trial Balance */}
      {!loading && !error && tab === 'trial_balance' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <StatCard title="إجمالي المدين" value={money(trialBalance?.total_debit || 0)} accentColor="var(--color-info)" />
            <StatCard title="إجمالي الدائن" value={money(trialBalance?.total_credit || 0)} accentColor="var(--color-accent)" />
          </div>
          {(trialBalance?.accounts || []).length === 0 ? (
            <p className="text-text-muted text-center py-8">لا توجد قيود في الفترة المحددة</p>
          ) : (
            <Table columns={tbCols} data={trialBalance?.accounts ?? []} />
          )}
        </div>
      )}

      {/* 2. Income Statement */}
      {!loading && !error && tab === 'income_statement' && (
        <div className="space-y-6">
          {incomeStatement ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <StatCard title="إجمالي الإيرادات" value={money(incomeStatement.total_revenue || 0)} accentColor="var(--color-success)" />
                <StatCard title="إجمالي المصروفات" value={money(incomeStatement.total_expenses || 0)} accentColor="var(--color-danger)" />
                <StatCard title="صافي الدخل (الربح / الخسارة)" value={money(incomeStatement.net_income || 0)} accentColor="var(--color-accent)" />
              </div>
              <Card title="الإيرادات"><Table columns={moneyCols} data={(incomeStatement.revenue || []).filter((r: MoneyRow) => r.amount)} /></Card>
              <Card title="المصروفات"><Table columns={moneyCols} data={(incomeStatement.expenses || []).filter((r: MoneyRow) => r.amount)} /></Card>
            </>
          ) : (
            <p className="text-text-muted text-center py-8">لا توجد بيانات</p>
          )}
        </div>
      )}

      {/* 3. Balance Sheet */}
      {!loading && !error && tab === 'balance_sheet' && (
        <div className="space-y-6">
          {balanceSheet ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <StatCard title="إجمالي الأصول" value={money(balanceSheet.total_assets || 0)} accentColor="var(--color-info)" />
                <StatCard title="إجمالي الخصوم" value={money(balanceSheet.total_liabilities || 0)} accentColor="var(--color-warning)" />
                <StatCard title="حقوق الملكية" value={money(balanceSheet.total_equity || 0)} accentColor="var(--color-accent)" />
              </div>
              <p className="text-sm text-text-muted">
                المعادلة المحاسبية: أصول = خصوم + حقوق ملكية
                {Math.abs((balanceSheet.total_assets || 0) - ((balanceSheet.total_liabilities || 0) + (balanceSheet.total_equity || 0))) < 0.05
                  ? ' — الميزانية متوازنة تماماً ✅'
                  : ` — فرق توازن: ${money((balanceSheet.total_assets || 0) - ((balanceSheet.total_liabilities || 0) + (balanceSheet.total_equity || 0)))}`}
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

      {/* 4. Statement of Changes in Equity (قائمة التغيرات في حقوق الملكية) */}
      {!loading && !error && tab === 'equity_changes' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <StatCard title="حقوق الملكية - بداية الفترة" value={money(equityChanges?.opening?.total || 0)} />
            <StatCard title="صافي دخل الفترة" value={money(equityChanges?.changes?.net_income || 0)} accentColor="var(--color-success)" />
            <StatCard title="صافي التغيرات" value={money(equityChanges?.changes?.total_change || 0)} accentColor="var(--color-info)" />
            <StatCard title="حقوق الملكية - نهاية الفترة" value={money(equityChanges?.ending?.total || 0)} accentColor="var(--color-accent)" />
          </div>

          <Card title="جدول قائمة التغيرات في حقوق الملكية (Statement of Changes in Equity)">
            <Table
              columns={[
                { key: 'label', label: 'البيان' },
                { key: 'capital', label: 'رأس المال', render: (r: EquityRow) => money(r.capital) },
                { key: 'retained_earnings', label: 'الأرباح المحتجزة', render: (r: EquityRow) => money(r.retained_earnings) },
                { key: 'net_income', label: 'أرباح / (خسائر) الفترة', render: (r: EquityRow) => money(r.net_income) },
                { key: 'total', label: 'إجمالي حقوق الملكية', render: (r: EquityRow) => <strong className="font-mono">{money(r.total)}</strong> },
              ]}
              data={equityChanges?.rows || []}
            />
          </Card>
        </div>
      )}

      {/* 5. Contact Balances Summary (كشف أرصدة العملاء والموردين) */}
      {!loading && !error && tab === 'contact_balances' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <Select
              label="نوع الحسابات"
              value={contactTypeFilter}
              onChange={setContactTypeFilter}
              options={[
                { value: 'all', label: 'الكل (عملاء وموردين)' },
                { value: 'client', label: 'العملاء فقط (مدينون)' },
                { value: 'supplier', label: 'الموردين فقط (دائنون)' },
              ]}
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard title="إجمالي الرصيد الافتتاحي" value={money(contactBalances?.totals?.opening || 0)} />
            <StatCard title="إجمالي الحركات المدينة" value={money(contactBalances?.totals?.debit || 0)} accentColor="var(--color-info)" />
            <StatCard title="إجمالي الحركات الدائنة" value={money(contactBalances?.totals?.credit || 0)} accentColor="var(--color-warning)" />
            <StatCard title="صافي الأرصدة الختامية" value={money(contactBalances?.totals?.closing || 0)} accentColor="var(--color-accent)" />
          </div>

          <Table
            columns={[
              { key: 'name', label: 'الاسم' },
              { key: 'type', label: 'النوع', render: (r: ContactRow) => <Badge variant="info">{r.type}</Badge> },
              { key: 'phone', label: 'الهاتف' },
              { key: 'opening_balance', label: 'رصيد افتتاحي', render: (r: ContactRow) => money(r.opening_balance) },
              { key: 'period_debit', label: 'حركات مدينة (+)', render: (r: ContactRow) => money(r.period_debit) },
              { key: 'period_credit', label: 'حركات دائنة (-)', render: (r: ContactRow) => money(r.period_credit) },
              { key: 'closing_balance', label: 'الرصيد الختامي', render: (r: ContactRow) => <strong className={r.closing_balance >= 0 ? 'text-success font-mono' : 'text-danger font-mono'}>{money(r.closing_balance)}</strong> },
              { key: 'balance_type', label: 'طبيعة الرصيد' },
            ]}
            data={contactBalances?.contacts || []}
          />
        </div>
      )}

      {/* 6. Expense Analysis (تحليل وتوزيع المصروفات) */}
      {!loading && !error && tab === 'expense_analysis' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <StatCard title="إجمالي المصروفات للفترة" value={money(expenseAnalysis?.total_expense || 0)} accentColor="var(--color-danger)" />
            <StatCard title="عدد بنود ومراكز المصروفات النشطة" value={String(expenseAnalysis?.count || 0)} />
          </div>

          <Card title="تفاصيل وتحليل المصروفات حسب الحساب والنسبة المئوية">
            <Table
              columns={[
                { key: 'code', label: 'كود الحساب' },
                { key: 'name', label: 'بند المصروف' },
                { key: 'amount', label: 'المبلغ', render: (r: ExpenseCategory) => <span className="font-mono font-bold">{money(r.amount)}</span> },
                { 
                  key: 'percentage', 
                  label: 'النسبة من إجمالي المصروفات %', 
                  render: (r: ExpenseCategory) => (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden w-24">
                        <div className="bg-danger h-full rounded-full" style={{ width: `${r.percentage}%` }} />
                      </div>
                      <span className="font-mono text-xs">{r.percentage.toFixed(1)}%</span>
                    </div>
                  )
                },
              ]}
              data={expenseAnalysis?.categories || []}
            />
          </Card>
        </div>
      )}

      {/* 7. General Ledger */}
      {!loading && !error && tab === 'general_ledger' && (
        <div className="space-y-4">
          <Select
            label="الحساب"
            value={ledgerAccountId}
            onChange={setLedgerAccountId}
            options={[{ value: '', label: 'كل الحسابات' }, ...ledgerAccounts.map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` }))]}
          />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard title="رصيد افتتاحي" value={money(ledger?.opening_balance || 0)} />
            <StatCard title="مدين" value={money(ledger?.total_debit || 0)} />
            <StatCard title="دائن" value={money(ledger?.total_credit || 0)} />
            <StatCard title="رصيد ختامي" value={money(ledger?.closing_balance || 0)} />
          </div>
          <Table
            columns={[
              { key: 'date', label: 'التاريخ' },
              { key: 'number', label: 'رقم القيد' },
              { key: 'account_code', label: 'الحساب' },
              { key: 'description', label: 'البيان' },
              { key: 'debit', label: 'مدين', render: (r: LedgerTransaction) => money(r.debit) },
              { key: 'credit', label: 'دائن', render: (r: LedgerTransaction) => money(r.credit) },
              { key: 'balance', label: 'الرصيد', render: (r: LedgerTransaction) => money(r.balance) },
            ]}
            data={ledger?.transactions || []}
          />
        </div>
      )}

      {/* 8. Cash Flow */}
      {!loading && !error && tab === 'cash_flow' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard title="رصيد أول المدة" value={money(cashFlow?.opening_balance || 0)} />
            <StatCard title="تشغيلي" value={money(cashFlow?.operating?.net || 0)} accentColor="var(--color-info)" />
            <StatCard title="استثماري" value={money(cashFlow?.investing?.net || 0)} />
            <StatCard title="رصيد آخر المدة" value={money(cashFlow?.closing_balance || 0)} accentColor="var(--color-success)" />
          </div>
          <Card title="الأنشطة التشغيلية — مقبوضات">
            <Table columns={[
              { key: 'account_name', label: 'الحساب' },
              { key: 'description', label: 'البيان' },
              { key: 'amount', label: 'المبلغ', render: (r: CashFlowLine) => money(r.amount) },
            ]} data={cashFlow?.operating?.inflows || []} />
          </Card>
          <Card title="الأنشطة التشغيلية — مدفوعات">
            <Table columns={[
              { key: 'account_name', label: 'الحساب' },
              { key: 'description', label: 'البيان' },
              { key: 'amount', label: 'المبلغ', render: (r: CashFlowLine) => money(r.amount) },
            ]} data={cashFlow?.operating?.outflows || []} />
          </Card>
        </div>
      )}

      {/* 9. Profitability */}
      {!loading && !error && tab === 'profitability' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard title="قيمة التعاقدات" value={money(profitability?.totals?.contract_value || 0)} />
            <StatCard title="الإيراد المحقق" value={money(profitability?.totals?.revenue || 0)} accentColor="var(--color-success)" />
            <StatCard title="التكاليف" value={money(profitability?.totals?.total_costs || 0)} accentColor="var(--color-danger)" />
            <StatCard title="صافي الربح" value={money(profitability?.totals?.profit || 0)} accentColor="var(--color-accent)" />
          </div>
          <Table
            columns={[
              { key: 'name', label: 'المشروع' },
              { key: 'client_name', label: 'العميل' },
              { key: 'contract_value', label: 'التعاقد', render: (r: ProfitabilityProject) => money(r.contract_value) },
              { key: 'revenue', label: 'الإيراد', render: (r: ProfitabilityProject) => money(r.revenue) },
              { key: 'total_costs', label: 'التكلفة', render: (r: ProfitabilityProject) => money(r.total_costs) },
              { key: 'profit', label: 'الربح', render: (r: ProfitabilityProject) => <span className={r.profit < 0 ? 'text-danger font-bold' : 'text-success font-bold'}>{money(r.profit)}</span> },
              { key: 'profit_margin', label: 'الهامش', render: (r: ProfitabilityProject) => `${(r.profit_margin || 0).toFixed(1)}%` },
            ]}
            data={profitability?.projects || []}
          />
        </div>
      )}

      {/* 10. Aging */}
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
            <StatCard title="الإجمالي" value={money(aging?.totals?.balance || 0)} />
            <StatCard title="0-30 يوم" value={money(aging?.totals?.['0-30'] || 0)} />
            <StatCard title="31-60" value={money(aging?.totals?.['31-60'] || 0)} />
            <StatCard title="61-90" value={money(aging?.totals?.['61-90'] || 0)} />
            <StatCard title="أكثر من 90" value={money(aging?.totals?.['90+'] || 0)} accentColor="var(--color-danger)" />
          </div>
          <Table
            columns={[
              { key: 'name', label: 'الاسم' },
              { key: 'balance', label: 'الرصيد', render: (r: AgingRow) => money(r.balance) },
              { key: 'b0', label: '0-30', render: (r: AgingRow) => money(r.buckets?.['0-30'] || 0) },
              { key: 'b1', label: '31-60', render: (r: AgingRow) => money(r.buckets?.['31-60'] || 0) },
              { key: 'b2', label: '61-90', render: (r: AgingRow) => money(r.buckets?.['61-90'] || 0) },
              { key: 'b3', label: '90+', render: (r: AgingRow) => money(r.buckets?.['90+'] || 0) },
              { key: 'days_overdue', label: 'أيام التأخير' },
            ]}
            data={aging?.aging || []}
          />
        </div>
      )}

      {/* 11. VAT */}
      {!loading && !error && tab === 'vat' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard title="ضريبة مخرجات" value={money(vat?.summary?.total_vat_collected || 0)} />
            <StatCard title="ضريبة مدخلات" value={money(vat?.summary?.total_vat_paid || 0)} />
            <StatCard title="الضريبة المستحقة" value={money(vat?.summary?.vat_payable || 0)} accentColor="var(--color-accent)" />
            <StatCard title="المبيعات بدون ضريبة" value={money(vat?.summary?.total_sales_excluding_vat || 0)} />
          </div>
          <p className="text-sm text-text-muted">
            الحالة: {vat?.summary?.vat_payable_status === 'refundable' ? `رصيد قابل للاسترداد من ${authority}` : `مستحق السداد لـ${authority}`} — نسبة الضريبة {(vat?.vat_rate || vatPercentDefault / 100) * 100}%
          </p>
        </div>
      )}

      {/* 12. Operational */}
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
              ...projects.map((p) => ({ value: p.id, label: p.name })),
            ]} />
            <Button variant="secondary" leftIcon={<FileText size={16} />} onClick={load}>عرض</Button>
          </div>
          {opType === 'project-costs' && operational && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
              <StatCard title="تكاليف المواد" value={money(operational.materials || 0)} accentColor="var(--color-info)" />
              <StatCard title="تكاليف العمالة" value={money(operational.workers || 0)} accentColor="var(--color-warning)" />
              <StatCard title="المشتريات" value={money(operational.purchases || 0)} accentColor="var(--color-accent)" />
              <StatCard title="مقاولو الباطن" value={money(operational.subcontractors || 0)} accentColor="var(--color-success)" />
              <StatCard title="الإجمالي" value={money(operational.total || 0)} />
            </div>
          )}
          {Array.isArray(operational?.rows) && (
            <Table
              columns={[
                { key: 'date', label: 'التاريخ' },
                { key: 'item_name', label: 'الصنف' },
                { key: 'project_name', label: 'المشروع' },
                { key: 'type', label: 'النوع' },
                { key: 'quantity', label: 'الكمية' },
                { key: 'total_value', label: 'القيمة', render: (r: OperationalRow) => money(r.total_value || 0) },
              ]}
              data={operational.rows}
            />
          )}
        </div>
      )}
    </div>
  );
}
