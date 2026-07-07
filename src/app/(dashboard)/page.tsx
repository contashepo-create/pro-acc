'use client';

import { useState } from 'react';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Users,
  Building2,
  AlertTriangle,
  Receipt,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

// ─── Types ──────────────────────────────────────────────────
interface DashboardSummary {
  total_revenue: number;
  total_expenses: number;
  net_profit: number;
  accounts_receivable: number;
  accounts_payable: number;
  cash_balance: number;
  active_projects: number;
  overdue_invoices: number;
}

interface RecentTransaction {
  id: string;
  date: string;
  description: string;
  type: 'revenue' | 'expense';
  amount: number;
}

interface ActiveProject {
  id: string;
  name: string;
  client_name?: string;
  contract_value: number;
  progress: number;
}

interface OverdueInvoice {
  id: string;
  number: number;
  client_name: string;
  due_date: string;
  total: number;
  days_overdue: number;
}

// ─── StatCard ────────────────────────────────────────────────
function StatCard({
  title,
  value,
  icon: Icon,
  trend,
  trendLabel,
  color,
}: {
  title: string;
  value: string;
  icon: React.ElementType;
  trend?: 'up' | 'down';
  trendLabel?: string;
  color: string;
}) {
  return (
    <div className="card p-5 card-lift">
      <div className="flex items-start justify-between mb-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: `color-mix(in srgb, ${color} 12%, transparent)` }}
        >
          <Icon size={20} style={{ color }} />
        </div>
        {trend && (
          <span
            className={`flex items-center gap-1 text-xs font-medium ${
              trend === 'up' ? 'text-success' : 'text-danger'
            }`}
          >
            {trend === 'up' ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            {trendLabel}
          </span>
        )}
      </div>
      <div className="stat-number text-2xl text-text-primary mb-0.5">{value}</div>
      <div className="text-sm text-text-muted">{title}</div>
    </div>
  );
}

// ─── Mock Data (will be replaced with API calls) ────────────
const mockSummary: DashboardSummary = {
  total_revenue: 1250000,
  total_expenses: 890000,
  net_profit: 360000,
  accounts_receivable: 420000,
  accounts_payable: 185000,
  cash_balance: 540000,
  active_projects: 12,
  overdue_invoices: 5,
};

const mockChartData = [
  { month: 'يناير', revenue: 180000, expenses: 140000 },
  { month: 'فبراير', revenue: 210000, expenses: 155000 },
  { month: 'مارس', revenue: 195000, expenses: 148000 },
  { month: 'إبريل', revenue: 240000, expenses: 170000 },
  { month: 'مايو', revenue: 225000, expenses: 162000 },
  { month: 'يونيو', revenue: 200000, expenses: 115000 },
];

const mockTransactions: RecentTransaction[] = [
  { id: '1', date: '2026-06-22', description: 'دفعة فاتورة مشروع النخيل', type: 'revenue', amount: 85000 },
  { id: '2', date: '2026-06-22', description: 'صرف رواتب شهر يونيو', type: 'expense', amount: 62000 },
  { id: '3', date: '2026-06-21', description: 'دفعة مورد مواد بناء', type: 'expense', amount: 34000 },
  { id: '4', date: '2026-06-21', description: 'سند قبض - عميل مشروع الورود', type: 'revenue', amount: 120000 },
  { id: '5', date: '2026-06-20', description: 'مصاريف تشغيلية', type: 'expense', amount: 8500 },
  { id: '6', date: '2026-06-20', description: 'إيراد استشارات', type: 'revenue', amount: 15000 },
  { id: '7', date: '2026-06-19', description: 'شراء مواد مكتبية', type: 'expense', amount: 3200 },
  { id: '8', date: '2026-06-19', description: 'دفعة فاتورة مشروع الأزهار', type: 'revenue', amount: 45000 },
  { id: '9', date: '2026-06-18', description: 'صيانة معدات', type: 'expense', amount: 12800 },
  { id: '10', date: '2026-06-18', description: 'سند قبض - سلفة عميل', type: 'revenue', amount: 50000 },
];

const mockProjects: ActiveProject[] = [
  { id: '1', name: 'مشروع النخيل', client_name: 'شركة النخيل', contract_value: 1200000, progress: 65 },
  { id: '2', name: 'مشروع الورود', client_name: 'مؤسسة الورود', contract_value: 850000, progress: 40 },
  { id: '3', name: 'مشروع الأزهار', client_name: 'شركة الأزهار', contract_value: 600000, progress: 80 },
  { id: '4', name: 'مشروع البساتين', client_name: 'مؤسسة البساتين', contract_value: 950000, progress: 25 },
  { id: '5', name: 'مشروع الواحة', client_name: 'شركة الواحة', contract_value: 1500000, progress: 55 },
];

const mockOverdueInvoices: OverdueInvoice[] = [
  { id: '1', number: 1042, client_name: 'شركة النخيل', due_date: '2026-05-15', total: 125000, days_overdue: 39 },
  { id: '2', number: 1048, client_name: 'مؤسسة البساتين', due_date: '2026-05-28', total: 68000, days_overdue: 26 },
  { id: '3', number: 1051, client_name: 'مكتبة المعرفة', due_date: '2026-06-01', total: 22000, days_overdue: 22 },
  { id: '4', number: 1053, client_name: 'شركة الأصيلة', due_date: '2026-06-05', total: 45000, days_overdue: 18 },
  { id: '5', number: 1055, client_name: 'مؤسسة الورود', due_date: '2026-06-10', total: 87000, days_overdue: 13 },
];

const currencyFormatter = (value: number) =>
  new Intl.NumberFormat('ar-SA', { style: 'currency', currency: 'SAR', minimumFractionDigits: 0 }).format(value);

// ─── Main Dashboard ─────────────────────────────────────────
export default function DashboardPage() {
  const [summary] = useState<DashboardSummary>(mockSummary);
  const [transactions] = useState<RecentTransaction[]>(mockTransactions);
  const [projects] = useState<ActiveProject[]>(mockProjects);
  const [overdueInvoices] = useState<OverdueInvoice[]>(mockOverdueInvoices);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="page-header">
        <h1>لوحة التحكم</h1>
        <p>نظرة عامة على أداء الشركة</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard
          title="إجمالي الإيرادات"
          value={currencyFormatter(summary.total_revenue)}
          icon={TrendingUp}
          trend="up"
          trendLabel="+12%"
          color="var(--color-success)"
        />
        <StatCard
          title="إجمالي المصروفات"
          value={currencyFormatter(summary.total_expenses)}
          icon={TrendingDown}
          trend="down"
          trendLabel="+8%"
          color="var(--color-danger)"
        />
        <StatCard
          title="صافي الربح"
          value={currencyFormatter(summary.net_profit)}
          icon={DollarSign}
          color="var(--color-accent)"
        />
        <StatCard
          title="الذمم المدينة"
          value={currencyFormatter(summary.accounts_receivable)}
          icon={Users}
          color="var(--color-info)"
        />
        <StatCard
          title="الذمم الدائنة"
          value={currencyFormatter(summary.accounts_payable)}
          icon={Receipt}
          color="var(--color-warning)"
        />
        <StatCard
          title="المشاريع النشطة"
          value={String(summary.active_projects)}
          icon={Building2}
          color="var(--color-success)"
        />
      </div>

      {/* Chart + Recent Transactions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Revenue vs Expenses Chart */}
        <div className="card p-5 lg:col-span-2">
          <h3 className="text-base font-bold text-text-primary mb-4">الإيرادات vs المصروفات</h3>
          <div dir="ltr" style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={mockChartData} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis
                  dataKey="month"
                  tick={{ fill: 'var(--color-text-muted)', fontSize: 12 }}
                  axisLine={{ stroke: 'var(--color-border)' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: 'var(--color-text-muted)', fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--color-bg-elevated)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 8,
                    color: 'var(--color-text-primary)',
                  }}
                  formatter={(value) => currencyFormatter(Number(value) || 0)}
                />
                <Legend
                  wrapperStyle={{ fontSize: 12, color: 'var(--color-text-secondary)' }}
                />
                <Bar
                  dataKey="revenue"
                  name="الإيرادات"
                  fill="var(--color-success)"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={32}
                />
                <Bar
                  dataKey="expenses"
                  name="المصروفات"
                  fill="var(--color-danger)"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={32}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Recent Transactions */}
        <div className="card p-5">
          <h3 className="text-base font-bold text-text-primary mb-4">آخر المعاملات</h3>
          <div className="space-y-3">
            {transactions.slice(0, 7).map((tx) => (
              <div key={tx.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                      tx.type === 'revenue' ? 'bg-success-light' : 'bg-danger-light'
                    }`}
                  >
                    {tx.type === 'revenue' ? (
                      <TrendingUp size={16} className="text-success" />
                    ) : (
                      <TrendingDown size={16} className="text-danger" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm text-text-primary truncate max-w-[160px]">{tx.description}</div>
                    <div className="text-xs text-text-muted">{tx.date}</div>
                  </div>
                </div>
                <span
                  className={`text-sm font-semibold whitespace-nowrap mr-2 ${
                    tx.type === 'revenue' ? 'text-success' : 'text-danger'
                  }`}
                >
                  {tx.type === 'revenue' ? '+' : '-'}
                  {currencyFormatter(tx.amount)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Active Projects + Overdue Invoices */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Active Projects */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-text-primary">المشاريع النشطة</h3>
            <span className="badge badge-accent">{projects.length} مشاريع</span>
          </div>
          <div className="space-y-4">
            {projects.map((project) => (
              <div key={project.id}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-text-primary truncate">{project.name}</div>
                    <div className="text-xs text-text-muted">{project.client_name}</div>
                  </div>
                  <span className="text-sm font-semibold text-text-primary">
                    {currencyFormatter(project.contract_value)}
                  </span>
                </div>
                <div className="w-full h-2 rounded-full bg-border overflow-hidden">
                  <div
                    className="h-full rounded-full bg-accent transition-all duration-500"
                    style={{ width: `${project.progress}%` }}
                  />
                </div>
                <div className="text-xs text-text-muted mt-0.5 text-left">{project.progress}%</div>
              </div>
            ))}
          </div>
        </div>

        {/* Overdue Invoices */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-text-primary">فواتير متأخرة</h3>
            <span className="badge badge-danger">{overdueInvoices.length} فواتير</span>
          </div>
          <div className="space-y-3">
            {overdueInvoices.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-danger-light flex items-center justify-center shrink-0">
                    <AlertTriangle size={16} className="text-danger" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm text-text-primary truncate max-w-[160px]">
                      فاتورة #{inv.number} - {inv.client_name}
                    </div>
                    <div className="text-xs text-danger">
                      متأخرة {inv.days_overdue} يوم
                    </div>
                  </div>
                </div>
                <span className="text-sm font-semibold text-danger whitespace-nowrap mr-2">
                  {currencyFormatter(inv.total)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
