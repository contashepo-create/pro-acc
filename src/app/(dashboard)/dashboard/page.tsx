'use client';

import { useState, useEffect } from 'react';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Users,
  Building2,
  AlertTriangle,
  Receipt,
  Loader2,
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

interface DashboardData {
  total_revenue: number;
  total_expenses: number;
  net_profit: number;
  accounts_receivable: number;
  accounts_payable: number;
  cash_balance: number;
  active_projects: number;
  overdue_invoices: number;
}

function StatCard({ title, value, icon: Icon, trend, trendLabel, color }: {
  title: string; value: string; icon: React.ElementType; trend?: 'up' | 'down'; trendLabel?: string; color: string;
}) {
  return (
    <div className="card p-5 card-lift">
      <div className="flex items-start justify-between mb-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `color-mix(in srgb, ${color} 12%, transparent)` }}>
          <Icon size={20} style={{ color }} />
        </div>
        {trend && (
          <span className={`flex items-center gap-1 text-xs font-medium ${trend === 'up' ? 'text-success' : 'text-danger'}`}>
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

const currencyFormatter = (value: number) =>
  new Intl.NumberFormat('ar-SA', { style: 'currency', currency: 'SAR', minimumFractionDigits: 0 }).format(value || 0);

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/dashboard')
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setData(d.data);
        else setError(d.message || 'فشل تحميل البيانات');
      })
      .catch(() => setError('حدث خطأ في الاتصال'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={32} className="animate-spin text-accent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div className="page-header"><h1>لوحة التحكم</h1><p>نظرة عامة على أداء الشركة</p></div>
        <div className="card p-8 text-center">
          <AlertTriangle size={48} className="text-warning mx-auto mb-4" />
          <p className="text-text-muted">{error}</p>
          <p className="text-text-muted text-sm mt-2">سيتم عرض البيانات عند بدء استخدام النظام</p>
        </div>
      </div>
    );
  }

  const summary = data || { total_revenue: 0, total_expenses: 0, net_profit: 0, accounts_receivable: 0, accounts_payable: 0, cash_balance: 0, active_projects: 0, overdue_invoices: 0 };

  return (
    <div className="space-y-6">
      <div className="page-header">
        <h1>لوحة التحكم</h1>
        <p>نظرة عامة على أداء الشركة</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard title="إجمالي الإيرادات" value={currencyFormatter(summary.total_revenue)} icon={TrendingUp} color="var(--color-success)" />
        <StatCard title="إجمالي المصروفات" value={currencyFormatter(summary.total_expenses)} icon={TrendingDown} color="var(--color-danger)" />
        <StatCard title="صافي الربح" value={currencyFormatter(summary.net_profit)} icon={DollarSign} color="var(--color-accent)" />
        <StatCard title="الذمم المدينة" value={currencyFormatter(summary.accounts_receivable)} icon={Users} color="var(--color-info)" />
        <StatCard title="الذمم الدائنة" value={currencyFormatter(summary.accounts_payable)} icon={Receipt} color="var(--color-warning)" />
        <StatCard title="المشاريع النشطة" value={String(summary.active_projects)} icon={Building2} color="var(--color-success)" />
      </div>

      <div className="card p-5">
        <h3 className="text-base font-bold text-text-primary mb-4">الملخص المالي</h3>
        {summary.total_revenue === 0 && summary.total_expenses === 0 ? (
          <div className="text-center py-12 text-text-muted">
            <p>لا توجد بيانات مالية بعد. ابدأ بإضافة فواتير وقيود محاسبية.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="text-center p-4 rounded-xl bg-success-light/20">
              <p className="text-sm text-text-muted mb-1">الإيرادات</p>
              <p className="text-xl font-bold text-success">{currencyFormatter(summary.total_revenue)}</p>
            </div>
            <div className="text-center p-4 rounded-xl bg-danger-light/20">
              <p className="text-sm text-text-muted mb-1">المصروفات</p>
              <p className="text-xl font-bold text-danger">{currencyFormatter(summary.total_expenses)}</p>
            </div>
            <div className="text-center p-4 rounded-xl bg-accent/10">
              <p className="text-sm text-text-muted mb-1">صافي الربح</p>
              <p className="text-xl font-bold text-accent">{currencyFormatter(summary.net_profit)}</p>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-5">
          <h3 className="text-base font-bold text-text-primary mb-4">الرصيد النقدي</h3>
          <p className="text-3xl font-bold text-accent">{currencyFormatter(summary.cash_balance)}</p>
        </div>
        <div className="card p-5">
          <h3 className="text-base font-bold text-text-primary mb-4">فواتير متأخرة</h3>
          <p className="text-3xl font-bold text-danger">{summary.overdue_invoices}</p>
        </div>
      </div>
    </div>
  );
}
