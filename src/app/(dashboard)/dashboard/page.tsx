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
  Wallet,
  CalendarClock,
  Activity,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

interface DashboardData {
  totalRevenue: number;
  totalExpense: number;
  netProfit: number;
  accountsReceivable: number;
  accountsPayable: number;
  cashBalance: number;
  totalProjects: number;
  activeProjects: number;
  overdueInvoices: number;
  overdueAmount: number;
  revenueThisMonth: number;
  expenseThisMonth: number;
  projects: any[];
  projectsTruncated: boolean;
  recentActivity: any[];
}

const empty: DashboardData = {
  totalRevenue: 0, totalExpense: 0, netProfit: 0, accountsReceivable: 0,
  accountsPayable: 0, cashBalance: 0, totalProjects: 0, activeProjects: 0,
  overdueInvoices: 0, overdueAmount: 0, revenueThisMonth: 0, expenseThisMonth: 0,
  projects: [], projectsTruncated: false, recentActivity: [],
};

function formatAmount(value: number) {
  return new Intl.NumberFormat('ar-SA', { maximumFractionDigits: 0 }).format(value || 0);
}

function formatSAR(value: number) {
  const sign = value < 0 ? '-' : '';
  return `${sign}${formatAmount(Math.abs(value))} ر.س`;
}

function StatCard({ title, value, icon: Icon, tone }: {
  title: string; value: string; icon: React.ElementType;
  tone: 'success' | 'danger' | 'accent' | 'info' | 'warning';
}) {
  const iconColor = `var(--color-${tone})`;
  const chipBg = `var(--color-${tone}-light)`;
  return (
    <div className="rounded-2xl border p-5 shadow-sm" style={{ background: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }}>
      <div className="flex items-start justify-between mb-3">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: chipBg }}>
          <Icon size={20} style={{ color: iconColor }} />
        </div>
      </div>
      <div className="font-mono font-bold text-2xl" style={{ color: 'var(--color-text-primary)' }}>{value}</div>
      <div className="text-sm mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{title}</div>
    </div>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deniedNotice, setDeniedNotice] = useState(false);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('denied') === 'admin-only') {
        setDeniedNotice(true);
        window.history.replaceState({}, '', '/dashboard');
      }
    } catch { /* ignore */ }
  }, []);

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
        <Loader2 size={32} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <HeaderBlock />
        <div className="rounded-2xl border p-8 text-center" style={{ background: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }}>
          <AlertTriangle size={48} style={{ color: 'var(--color-warning)' }} className="mx-auto mb-4" />
          <p style={{ color: 'var(--color-text-muted)' }}>{error}</p>
          <p className="text-sm mt-2" style={{ color: 'var(--color-text-muted)' }}>سيتم عرض البيانات عند بدء استخدام النظام</p>
        </div>
      </div>
    );
  }

  const s = data || empty;
  const netTone = s.netProfit >= 0 ? 'success' : 'danger';
  const netLabel = `${s.netProfit >= 0 ? '' : '-'}${formatAmount(Math.abs(s.netProfit))} ر.س`;

  const chartData = [
    { name: 'هذا الشهر', 'الإيرادات': s.revenueThisMonth, 'المصروفات': s.expenseThisMonth },
    { name: 'الإجمالي', 'الإيرادات': s.totalRevenue, 'المصروفات': s.totalExpense },
  ];

  const hasFinance = s.totalRevenue !== 0 || s.totalExpense !== 0 || s.cashBalance !== 0;

  return (
    <div className="space-y-6">
      <HeaderBlock />

      {deniedNotice && (
        <div className="rounded-xl p-4 text-sm font-semibold flex items-center gap-2"
          style={{ background: 'var(--color-warning-light)', border: '1px solid var(--color-warning)', color: 'var(--color-warning)' }}>
          <AlertTriangle size={18} />
          هذه الصفحة متاحة لمدير النظام فقط. تم تحويلك إلى لوحة التحكم.
        </div>
      )}

      {/* مؤشرات رئيسية */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="إجمالي الإيرادات" value={formatSAR(s.totalRevenue)} icon={TrendingUp} tone="success" />
        <StatCard title="إجمالي المصروفات" value={formatSAR(s.totalExpense)} icon={TrendingDown} tone="danger" />
        <StatCard title="صافي الربح" value={netLabel} icon={DollarSign} tone={netTone === 'success' ? 'success' : 'danger'} />
        <StatCard title="الرصيد النقدي" value={formatSAR(s.cashBalance)} icon={Wallet} tone="accent" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="الذمم المدينة (لنا)" value={formatSAR(s.accountsReceivable)} icon={Users} tone="info" />
        <StatCard title="الذمم الدائنة (علينا)" value={formatSAR(s.accountsPayable)} icon={Receipt} tone="warning" />
        <StatCard title="المشاريع النشطة" value={String(s.activeProjects)} icon={Building2} tone="success" />
        <StatCard title="فواتير متأخرة" value={`${s.overdueInvoices} (${formatSAR(s.overdueAmount)})`} icon={CalendarClock} tone="danger" />
      </div>

      {/* الرسم البياني */}
      <div className="rounded-2xl border p-5" style={{ background: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>مقارنة الإيرادات والمصروفات</h3>
        </div>
        {hasFinance ? (
          <div className="h-64" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} barGap={8}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="name" tick={{ fill: 'var(--color-text-muted)', fontSize: 12 }} stroke="var(--color-border)" />
                <YAxis tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }} stroke="var(--color-border)" />
                <Tooltip
                  contentStyle={{
                    background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)',
                    borderRadius: 12, color: 'var(--color-text-primary)', fontSize: 13,
                  }}
                  labelStyle={{ color: 'var(--color-text-primary)', fontWeight: 700 }}
                />
                <Bar dataKey="الإيرادات" radius={[6, 6, 0, 0]}>
                  <Cell fill="var(--color-success)" />
                </Bar>
                <Bar dataKey="المصروفات" radius={[6, 6, 0, 0]}>
                  <Cell fill="var(--color-danger)" />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="text-center py-12" style={{ color: 'var(--color-text-muted)' }}>
            <p>لا توجد بيانات مالية بعد. ابدأ بإضافة فواتير وقيود محاسبية.</p>
          </div>
        )}
      </div>

      {/* المشاريع + النشاط */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-2xl border p-5" style={{ background: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }}>
          <div className="flex items-center gap-2 mb-4">
            <Building2 size={18} style={{ color: 'var(--color-accent)' }} />
            <h3 className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>أحدث المشاريع</h3>
          </div>
          {s.projects.length === 0 ? (
            <p className="text-sm py-8 text-center" style={{ color: 'var(--color-text-muted)' }}>لا توجد مشاريع بعد</p>
          ) : (
            <ul className="space-y-3">
              {s.projects.slice(0, 6).map((p: any) => (
                <li key={p.id} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{p.name}</div>
                    <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      {p.status === 'active' ? 'نشط' : p.status === 'completed' ? 'مكتمل' : 'معلّق'} · {formatAmount(p.contract_value)} ر.س
                    </div>
                  </div>
                  <div className="w-24 shrink-0">
                    <div className="h-2 rounded-full" style={{ background: 'var(--color-bg-secondary)' }}>
                      <div className="h-2 rounded-full" style={{ width: `${p.progress || 0}%`, background: 'var(--color-accent)' }} />
                    </div>
                    <div className="text-[10px] text-left mt-0.5 font-mono" style={{ color: 'var(--color-text-muted)' }}>{Math.round(p.progress || 0)}%</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border p-5" style={{ background: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }}>
          <div className="flex items-center gap-2 mb-4">
            <Activity size={18} style={{ color: 'var(--color-accent)' }} />
            <h3 className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>آخر النشاطات</h3>
          </div>
          {s.recentActivity.length === 0 ? (
            <p className="text-sm py-8 text-center" style={{ color: 'var(--color-text-muted)' }}>لا يوجد نشاط حديث</p>
          ) : (
            <ul className="space-y-3">
              {s.recentActivity.slice(0, 8).map((a: any, i: number) => (
                <li key={i} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>
                      {a.action} · {a.entity_type}
                    </div>
                  </div>
                  <div className="text-xs whitespace-nowrap font-mono" style={{ color: 'var(--color-text-muted)' }}>
                    {a.created_at ? new Date(a.created_at).toLocaleString('ar-SA', { dateStyle: 'short', timeStyle: 'short' }) : ''}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function HeaderBlock() {
  return (
    <div>
      <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>لوحة التحكم</h1>
      <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>نظرة عامة على أداء الشركة المالي والتشغيلي</p>
    </div>
  );
}
