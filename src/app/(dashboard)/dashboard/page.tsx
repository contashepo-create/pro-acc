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
  ArrowUpLeft,
  FilePlus2,
  PlusCircle,
  PackagePlus,
  UserPlus,
  BarChart3,
  HardHat,
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
import { useAuthStore } from '@/store/auth-store';
import { formatCurrency } from '@/lib/utils';

interface DashboardProject {
  id: string;
  name: string;
  status: string;
  contract_value: number;
  progress?: number | null;
}
interface DashboardActivity {
  action: string;
  entity_type: string;
  created_at: string;
}

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
  projects: DashboardProject[];
  projectsTruncated: boolean;
  recentActivity: DashboardActivity[];
}

const empty: DashboardData = {
  totalRevenue: 0, totalExpense: 0, netProfit: 0, accountsReceivable: 0,
  accountsPayable: 0, cashBalance: 0, totalProjects: 0, activeProjects: 0,
  overdueInvoices: 0, overdueAmount: 0, revenueThisMonth: 0, expenseThisMonth: 0,
  projects: [], projectsTruncated: false, recentActivity: [],
};

function formatMoney(value: number, symbol: string) {
  return formatCurrency(value, undefined, symbol);
}

const ACCENTS: Record<string, { icon: string; name: string; nameEn: string }> = {
  success: { icon: 'linear-gradient(135deg, #34d399, #10b981)', name: 'الأخضر', nameEn: 'green' },
  danger: { icon: 'linear-gradient(135deg, #f87171, #ef4444)', name: 'الأحمر', nameEn: 'red' },
  accent: { icon: 'linear-gradient(135deg, #60a5fa, #3b82f6)', name: 'الأزرق', nameEn: 'blue' },
  info: { icon: 'linear-gradient(135deg, #38bdf8, #2563eb)', name: 'السماوي', nameEn: 'sky' },
  warning: { icon: 'linear-gradient(135deg, #fbbf24, #f59e0b)', name: 'الكهرماني', nameEn: 'amber' },
};

function StatCard({ title, value, icon: Icon, tone, sub }: {
  title: string; value: string; icon: React.ElementType;
  tone: 'success' | 'danger' | 'accent' | 'info' | 'warning'; sub?: string;
}) {
  const grad = ACCENTS[tone]?.icon || ACCENTS.accent.icon;
  return (
    <div
      className="relative overflow-hidden rounded-2xl border p-5 card-lift"
      style={{ background: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }}
    >
      <div className="flex items-start justify-between mb-4">
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center text-white shadow-sm"
          style={{ background: grad }}
        >
          <Icon size={20} />
        </div>
        <ArrowUpLeft size={16} className="opacity-30" style={{ color: 'var(--color-text-muted)' }} />
      </div>
      <div className="font-mono font-bold text-xl md:text-2xl leading-tight" style={{ color: 'var(--color-text-primary)' }}>
        {value}
      </div>
      <div className="text-sm mt-1.5 font-medium" style={{ color: 'var(--color-text-secondary)' }}>{title}</div>
      {sub && <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{sub}</div>}
    </div>
  );
}

function QuickAction({ href, label, icon: Icon, desc }: {
  href: string; label: string; icon: React.ElementType; desc: string;
}) {
  return (
    <a
      href={href}
      className="group flex items-center gap-3 rounded-xl border p-3 card-lift"
      style={{ background: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }}
    >
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 text-white"
        style={{ background: 'linear-gradient(135deg, var(--color-accent), var(--color-accent-hover))' }}
      >
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{label}</div>
        <div className="text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>{desc}</div>
      </div>
    </a>
  );
}

const ACTIVITY_LABELS: Record<string, string> = {
  create: 'إنشاء',
  update: 'تعديل',
  delete: 'حذف',
  approve: 'اعتماد',
  reject: 'رفض',
  post: 'ترحيل',
  request_approval: 'طلب اعتماد',
};

export default function DashboardPage() {
  const { user, company } = useAuthStore();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deniedNotice, setDeniedNotice] = useState(false);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('denied') === 'admin-only') {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch pattern
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
      <div className="flex flex-col items-center justify-center h-72 gap-3">
        <Loader2 size={36} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>جاري تحميل لوحة التحكم...</p>
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
  const moneySymbol = company?.currency_symbol || 'ر.س';
  const netTone = s.netProfit >= 0 ? 'success' : 'danger';
  const netLabel = formatMoney(s.netProfit, moneySymbol);
  const firstName = user?.name?.split(' ')[0] || '';

  const chartData = [
    { name: 'هذا الشهر', 'الإيرادات': s.revenueThisMonth, 'المصروفات': s.expenseThisMonth },
    { name: 'الإجمالي', 'الإيرادات': s.totalRevenue, 'المصروفات': s.totalExpense },
  ];

  const hasFinance = s.totalRevenue !== 0 || s.totalExpense !== 0 || s.cashBalance !== 0;

  return (
    <div className="space-y-6">
      {/* Welcome banner */}
      <div
        className="relative overflow-hidden rounded-2xl border p-6"
        style={{ background: 'linear-gradient(135deg, var(--color-bg-card), var(--color-bg-elevated))', borderColor: 'var(--color-border)' }}
      >
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{ background: 'linear-gradient(135deg, var(--color-accent), transparent)' }}
        />
        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>أهلاً بك،</span>
              <span className="text-lg font-bold" style={{ color: 'var(--color-text-primary)' }}>
                {firstName || 'مستخدم'} 👋
              </span>
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
              لوحة التحكم
            </h1>
            <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
              {company?.name ? `نظرة عامة على أداء ${company.name} المالي والتشغيلي` : 'نظرة عامة على أداء الشركة المالي والتشغيلي'}
            </p>
          </div>
          <div className="text-sm px-4 py-2 rounded-xl border" style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text-muted)', borderColor: 'var(--color-border)' }}>
            {typeof window !== 'undefined'
              ? new Date().toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
              : ''}
          </div>
        </div>
      </div>

      {deniedNotice && (
        <div className="rounded-xl p-4 text-sm font-semibold flex items-center gap-2"
          style={{ background: 'var(--color-warning-light)', border: '1px solid var(--color-warning)', color: 'var(--color-warning)' }}>
          <AlertTriangle size={18} />
          هذه الصفحة متاحة لمدير النظام فقط. تم تحويلك إلى لوحة التحكم.
        </div>
      )}

      {/* مؤشرات مالية رئيسية */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="إجمالي الإيرادات" value={formatMoney(s.totalRevenue, moneySymbol)} icon={TrendingUp} tone="success" sub={`هذا الشهر: ${formatMoney(s.revenueThisMonth, moneySymbol)}`} />
        <StatCard title="إجمالي المصروفات" value={formatMoney(s.totalExpense, moneySymbol)} icon={TrendingDown} tone="danger" sub={`هذا الشهر: ${formatMoney(s.expenseThisMonth, moneySymbol)}`} />
        <StatCard title="صافي الربح" value={netLabel} icon={DollarSign} tone={netTone === 'success' ? 'success' : 'danger'} />
        <StatCard title="الرصيد النقدي" value={formatMoney(s.cashBalance, moneySymbol)} icon={Wallet} tone="accent" />
      </div>

      {/* مؤشرات تشغيلية */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="الذمم المدينة (لنا)" value={formatMoney(s.accountsReceivable, moneySymbol)} icon={Users} tone="info" />
        <StatCard title="الذمم الدائنة (علينا)" value={formatMoney(s.accountsPayable, moneySymbol)} icon={Receipt} tone="warning" />
        <StatCard title="المشاريع النشطة" value={String(s.activeProjects)} icon={Building2} tone="success" sub={`إجمالي المشاريع: ${s.totalProjects}`} />
        <StatCard title="فواتير متأخرة" value={`${s.overdueInvoices}`} icon={CalendarClock} tone="danger" sub={formatMoney(s.overdueAmount, moneySymbol)} />
      </div>

      {/* إجراءات سريعة */}
      <div className="rounded-2xl border p-5" style={{ background: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }}>
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 size={18} style={{ color: 'var(--color-accent)' }} />
          <h3 className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>إجراءات سريعة</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <QuickAction href="/invoices" label="فاتورة مبيعات" icon={FilePlus2} desc="إصدار فاتورة جديدة" />
          <QuickAction href="/projects" label="مشروع جديد" icon={HardHat} desc="إضافة مشروع" />
          <QuickAction href="/purchases/orders" label="أمر شراء" icon={PackagePlus} desc="طلب توريد" />
          <QuickAction href="/clients" label="عميل جديد" icon={UserPlus} desc="إضافة عميل" />
          <QuickAction href="/journal/new" label="قيد محاسبي" icon={PlusCircle} desc="ترحيل قيد" />
        </div>
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
              {s.projects.slice(0, 6).map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{p.name}</div>
                    <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      {p.status === 'active' ? 'نشط' : p.status === 'completed' ? 'مكتمل' : 'معلّق'} · {formatMoney(p.contract_value, moneySymbol)}
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
              {s.recentActivity.slice(0, 8).map((a, i: number) => (
                <li key={i} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>
                      <span className="font-bold" style={{ color: 'var(--color-accent)' }}>{ACTIVITY_LABELS[a.action] || a.action}</span> · {a.entity_type}
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
  const today = typeof window !== 'undefined'
    ? new Date().toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : '';
  return (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>لوحة التحكم</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>نظرة عامة على أداء الشركة المالي والتشغيلي</p>
      </div>
      <div className="text-sm px-3 py-1.5 rounded-lg" style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text-muted)' }}>
        {today}
      </div>
    </div>
  );
}
