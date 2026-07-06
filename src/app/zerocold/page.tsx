'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2, Users, Database, Package, Key,
  Activity, LogOut, Server,
  HardDrive, ShieldAlert, RefreshCw, Loader2, ChevronLeft,
  TrendingUp,
  CheckCircle, XCircle
} from 'lucide-react';
import Link from 'next/link';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';

interface DashboardData {
  companiesCount: number;
  usersCount: number;
  activeSubscriptions: number;
  monthlyRevenue: number;
  unusedCodes: number;
  dbSize: string;
  lastLogin: string;
  recentActivity: { action: string; details: string; timestamp: string }[];
  recentCompanies: { id: string; name: string; is_active: boolean; created_at: string }[];
  recentSubscriptions: { id: string; company_name: string; plan_name: string; status: string; end_date: string }[];
  planDistribution: { name: string; price: number; is_active: boolean }[];
  systemHealth: { apiResponseTime: string; uptime: string; dbStatus: string };
}

export default function ZerocoldDashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchDashboard = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/dashboard');

      if (res.status === 401) {
        router.replace('/zerocold/login');
        return;
      }

      const body = await res.json();
      if (!body.success) {
        setError(body.message || 'حدث خطأ');
        return;
      }

      setData(body.data);
    } catch {
      setError('حدث خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
  }, []);

  const handleLogout = async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    router.replace('/zerocold/login');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <Loader2 size={32} className="text-amber-500 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="text-center">
          <ShieldAlert className="w-12 h-12 text-red-500 mx-auto mb-3" />
          <p className="text-red-400 text-sm">{error}</p>
          <button onClick={fetchDashboard} className="mt-4 text-amber-500 hover:text-amber-400 text-sm underline">
            إعادة المحاولة
          </button>
        </div>
      </div>
    );
  }

  const stats = [
    { label: 'الشركات', value: data?.companiesCount ?? 0, icon: Building2, color: 'from-sky-600 to-blue-700' },
    { label: 'المستخدمين', value: data?.usersCount ?? 0, icon: Users, color: 'from-emerald-600 to-green-700' },
    { label: 'اشتراكات نشطة', value: data?.activeSubscriptions ?? 0, icon: CheckCircle, color: 'from-green-600 to-teal-700' },
    { label: 'الإيراد الشهري', value: `${(data?.monthlyRevenue ?? 0).toLocaleString()} ر.س`, icon: TrendingUp, color: 'from-amber-600 to-orange-700' },
    { label: 'أكواد غير مستخدمة', value: data?.unusedCodes ?? 0, icon: Key, color: 'from-purple-600 to-fuchsia-700' },
    { label: 'حجم قاعدة البيانات', value: data?.dbSize ?? '--', icon: HardDrive, color: 'from-violet-600 to-purple-700' },
  ];

  const quickActions = [
    { label: 'إدارة الشركات', href: '/zerocold/companies', icon: Building2, color: 'border-sky-700/30 hover:border-sky-600/50' },
    { label: 'إدارة المستخدمين', href: '/zerocold/users', icon: Users, color: 'border-emerald-700/30 hover:border-emerald-600/50' },
    { label: 'خطط الاشتراك', href: '/zerocold/plans', icon: Package, color: 'border-amber-700/30 hover:border-amber-600/50' },
    { label: 'الاشتراكات', href: '/zerocold/subscriptions', icon: Users, color: 'border-purple-700/30 hover:border-purple-600/50' },
    { label: 'أكواد التفعيل', href: '/zerocold/codes', icon: Key, color: 'border-green-700/30 hover:border-green-600/50' },
    { label: 'قاعدة البيانات', href: '/zerocold/database', icon: Database, color: 'border-violet-700/30 hover:border-violet-600/50' },
    { label: 'سجل الأحداث', href: '/zerocold/logs', icon: Activity, color: 'border-amber-700/30 hover:border-amber-600/50' },
  ];

  const healthItems = data?.systemHealth ? [
    { label: 'حالة قاعدة البيانات', value: data.systemHealth.dbStatus, color: 'text-emerald-400' },
    { label: 'زمن استجابة API', value: data.systemHealth.apiResponseTime, color: 'text-amber-400' },
    { label: 'مدة التشغيل', value: data.systemHealth.uptime, color: 'text-sky-400' },
  ] : [];

  const planData = (data?.planDistribution || []).map((p) => ({ name: p.name, value: p.price || 0 }));

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-600 to-orange-700 flex items-center justify-center shadow-lg shadow-amber-900/20">
              <ShieldAlert className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-amber-50">لوحة المطور</h1>
              <p className="text-[0.7rem] text-amber-400/50">نظرة عامة على النظام</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={fetchDashboard}
              className="p-2 rounded-xl bg-[#12101a] border border-[#2a1f0a] text-amber-500/70 hover:text-amber-400 hover:border-amber-700/50 transition-all"
              title="تحديث"
            >
              <RefreshCw size={16} />
            </button>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#12101a] border border-[#2a1f0a] text-red-400/70 hover:text-red-400 hover:border-red-800/50 transition-all text-xs"
            >
              <LogOut size={14} />
              تسجيل الخروج
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
          {stats.map((stat) => (
            <div key={stat.label} className="bg-[#12101a] border border-[#2a1f0a] rounded-xl p-4 hover:border-[#3a2f1a] transition-all">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[0.7rem] text-amber-400/60 font-medium">{stat.label}</span>
                <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${stat.color} flex items-center justify-center`}>
                  <stat.icon size={14} className="text-white" />
                </div>
              </div>
              <p className="text-xl font-bold text-amber-50 font-mono">{stat.value}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div className="bg-[#12101a] border border-[#2a1f0a] rounded-xl p-5">
            <h2 className="text-sm font-bold text-amber-300/80 mb-3">الوصول السريع</h2>
            <div className="grid grid-cols-2 gap-3">
              {quickActions.map((action) => (
                <Link
                  key={action.label}
                  href={action.href}
                  className={`flex items-center gap-3 p-3 rounded-xl bg-[#1a1625] border ${action.color} transition-all group`}
                >
                  <div className="w-9 h-9 rounded-lg bg-[#12101a] border border-[#2a1f0a] flex items-center justify-center group-hover:border-amber-700/50 transition-all">
                    <action.icon size={16} className="text-amber-500/70 group-hover:text-amber-400 transition-all" />
                  </div>
                  <span className="text-xs text-amber-300/70 group-hover:text-amber-200 transition-all">{action.label}</span>
                  <ChevronLeft size={14} className="mr-auto text-amber-600/30 group-hover:text-amber-500/50 transition-all" />
                </Link>
              ))}
            </div>
          </div>

          <div className="bg-[#12101a] border border-[#2a1f0a] rounded-xl p-5">
            <h2 className="text-sm font-bold text-amber-300/80 mb-3">حالة النظام</h2>
            <div className="space-y-3">
              {healthItems.length > 0 ? healthItems.map((item) => (
                <div key={item.label} className="flex items-center justify-between p-2.5 rounded-lg bg-[#1a1625] border border-[#2a1f0a]">
                  <div className="flex items-center gap-2">
                    <Server size={14} className="text-amber-600/50" />
                    <span className="text-xs text-amber-400/60">{item.label}</span>
                  </div>
                  <span className={`text-xs font-medium ${item.color}`}>{item.value}</span>
                </div>
              )) : (
                <div className="flex items-center justify-center py-6">
                  <Activity size={20} className="text-amber-600/30" />
                  <span className="text-xs text-amber-600/40 mr-2">بيانات غير متوفرة</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {planData.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <div className="bg-[#12101a] border border-[#2a1f0a] rounded-xl p-5">
              <h2 className="text-sm font-bold text-amber-300/80 mb-3">توزيع الخطط</h2>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={planData}>
                  <XAxis dataKey="name" tick={{ fill: '#f59e0b', fontSize: 10 }} axisLine={{ stroke: '#2a1f0a' }} />
                  <YAxis tick={{ fill: '#f59e0b', fontSize: 10 }} axisLine={{ stroke: '#2a1f0a' }} />
                  <Tooltip
                    contentStyle={{ background: '#12101a', border: '1px solid #2a1f0a', borderRadius: '8px', fontSize: '12px' }}
                    labelStyle={{ color: '#f59e0b' }}
                  />
                  <Bar dataKey="value" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-[#12101a] border border-[#2a1f0a] rounded-xl p-5">
              <h2 className="text-sm font-bold text-amber-300/80 mb-3">آخر الشركات</h2>
              {data?.recentCompanies && data.recentCompanies.length > 0 ? (
                <div className="space-y-1">
                  {data.recentCompanies.map((company) => (
                    <div key={company.id} className="flex items-center justify-between p-2.5 rounded-lg hover:bg-[#1a1625] transition-all">
                      <div className="flex items-center gap-2">
                        {company.is_active ? (
                          <CheckCircle size={14} className="text-emerald-400" />
                        ) : (
                          <XCircle size={14} className="text-red-400" />
                        )}
                        <span className="text-xs text-amber-300/80">{company.name}</span>
                      </div>
                      <span className="text-[0.65rem] text-amber-600/40">{company.created_at}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center py-6">
                  <Building2 size={20} className="text-amber-600/30" />
                  <span className="text-xs text-amber-600/40 mr-2">لا توجد شركات</span>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="bg-[#12101a] border border-[#2a1f0a] rounded-xl p-5">
          <h2 className="text-sm font-bold text-amber-300/80 mb-3">آخر النشاطات</h2>
          {data?.recentActivity && data.recentActivity.length > 0 ? (
            <div className="space-y-1">
              {data.recentActivity.map((activity, i) => (
                <div key={i} className="flex items-center justify-between p-2.5 rounded-lg hover:bg-[#1a1625] transition-all">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-600/50 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs text-amber-300/80 truncate">{activity.action}</p>
                      {activity.details && (
                        <p className="text-[0.7rem] text-amber-600/50 truncate">{activity.details}</p>
                      )}
                    </div>
                  </div>
                  <span className="text-[0.65rem] text-amber-600/40 flex-shrink-0">{activity.timestamp}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center py-6">
              <Activity size={20} className="text-amber-600/30" />
              <span className="text-xs text-amber-600/40 mr-2">لا توجد نشاطات حديثة</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
