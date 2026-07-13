'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Users, Search, Loader2, RefreshCw,
  CheckCircle, XCircle, ChevronLeft, Filter, Eye
} from 'lucide-react';
import Link from 'next/link';

interface AppUser {
  id: string;
  name: string;
  email: string;
  company_name: string;
  company_id: string;
  role: string;
  status: 'active' | 'suspended';
  last_login: string | null;
}

export default function ZerocoldUsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<AppUser | null>(null);
  const [userActivity, setUserActivity] = useState<{ action: string; timestamp: string }[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const [usersRes, companiesRes] = await Promise.all([
        fetch('/api/admin/users'),
        fetch('/api/admin/companies'),
      ]);

      if (usersRes.status === 401) {
        router.replace('/zerocold/login');
        return;
      }

      const usersBody = await usersRes.json();
      const companiesBody = await companiesRes.json();

      if (!usersBody.success) {
        setError(usersBody.message || 'حدث خطأ');
        return;
      }

      const rawUsers = usersBody.data?.users ?? (Array.isArray(usersBody.data) ? usersBody.data : []);
      setUsers(rawUsers.map((u: any) => ({
        ...u,
        status: u.is_active ? 'active' : 'suspended',
      })));
      if (companiesBody.success) {
        const companiesData = companiesBody.data?.companies ?? (Array.isArray(companiesBody.data) ? companiesBody.data : []);
        setCompanies(companiesData);
      }
    } catch {
      setError('حدث خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleStatus = async (userId: string, currentStatus: string) => {
    const masterPassword = prompt('يرجى إدخال كلمة السر الرئيسية:');
    if (!masterPassword) return;

    setActionLoading(userId);
    try {
      const res = await fetch('/api/admin/users/toggle-status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-master-password': masterPassword,
        },
        body: JSON.stringify({ userId, is_active: currentStatus !== 'active' }),
      });

      const body = await res.json();
      if (!res.ok || !body.success) {
        alert(body.message || 'فشل التحديث');
        return;
      }

      setUsers((prev) =>
        prev.map((u) =>
          u.id === userId
            ? { ...u, status: u.status === 'active' ? 'suspended' : 'active', is_active: u.status !== 'active' }
            : u
        )
      );
    } catch {} finally {
      setActionLoading(null);
    }
  };

  const showUserActivity = async (user: AppUser) => {
    setSelectedUser(user);
    setActivityLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/activity`);
      const body = await res.json();
      setUserActivity(body.success ? body.data : []);
    } catch {
      setUserActivity([]);
    } finally {
      setActivityLoading(false);
    }
  };

  const filtered = users.filter((u) => {
    const matchesSearch =
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase());
    const matchesCompany = !companyFilter || u.company_id === companyFilter;
    return matchesSearch && matchesCompany;
  });

  const roleLabels: Record<string, string> = {
    admin: 'مدير',
    accountant: 'محاسب',
    manager: 'مشرف',
    supervisor: 'مراقب',
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <Loader2 size={32} className="text-amber-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Link href="/zerocold/" className="p-2 rounded-lg hover:bg-[#12101a] transition-all">
              <ChevronLeft size={18} className="text-amber-500/70" />
            </Link>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-600 to-green-700 flex items-center justify-center">
              <Users className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-amber-50">إدارة المستخدمين</h1>
              <p className="text-[0.7rem] text-amber-400/50">{users.length} مستخدم</p>
            </div>
          </div>
          <button
            onClick={fetchData}
            className="p-2 rounded-xl bg-[#12101a] border border-[#2a1f0a] text-amber-500/70 hover:text-amber-400 transition-all"
            title="تحديث"
          >
            <RefreshCw size={16} />
          </button>
        </div>

        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-amber-600/50" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث عن مستخدم..."
              className="w-full pr-10 pl-4 py-2.5 bg-[#12101a] border border-[#2a1f0a] rounded-xl text-amber-50 placeholder-amber-700/50 focus:outline-none focus:border-amber-600 focus:ring-1 focus:ring-amber-600/30 transition-all text-sm"
            />
          </div>
          <div className="relative">
            <Filter size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-amber-600/50 pointer-events-none" />
            <select
              value={companyFilter}
              onChange={(e) => setCompanyFilter(e.target.value)}
              className="pr-10 pl-4 py-2.5 bg-[#12101a] border border-[#2a1f0a] rounded-xl text-amber-50 focus:outline-none focus:border-amber-600 focus:ring-1 focus:ring-amber-600/30 transition-all text-sm appearance-none cursor-pointer"
            >
              <option value="">كل الشركات</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>

        {error && (
          <div className="bg-red-950/40 border border-red-800/40 text-red-400 text-sm rounded-xl px-4 py-2.5 text-center mb-4">
            {error}
          </div>
        )}

        {filtered.length === 0 && !error ? (
          <div className="bg-[#12101a] border border-[#2a1f0a] rounded-xl p-8 text-center">
            <Users size={32} className="text-amber-600/30 mx-auto mb-2" />
            <p className="text-amber-600/50 text-sm">لا يوجد مستخدمون مطابقون للبحث</p>
          </div>
        ) : (
          <div className="bg-[#12101a] border border-[#2a1f0a] rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#2a1f0a]">
                    <th className="text-right p-3 text-[0.7rem] text-amber-500/60 font-medium">الاسم</th>
                    <th className="text-right p-3 text-[0.7rem] text-amber-500/60 font-medium">البريد الإلكتروني</th>
                    <th className="text-right p-3 text-[0.7rem] text-amber-500/60 font-medium">الشركة</th>
                    <th className="text-center p-3 text-[0.7rem] text-amber-500/60 font-medium">الدور</th>
                    <th className="text-center p-3 text-[0.7rem] text-amber-500/60 font-medium">الحالة</th>
                    <th className="text-right p-3 text-[0.7rem] text-amber-500/60 font-medium">آخر دخول</th>
                    <th className="text-center p-3 text-[0.7rem] text-amber-500/60 font-medium">الإجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((user) => (
                    <tr key={user.id} className="border-b border-[#1f1725] last:border-0 hover:bg-[#1a1625] transition-all">
                      <td className="p-3">
                        <span className="text-sm text-amber-200 font-medium">{user.name}</span>
                      </td>
                      <td className="p-3">
                        <span className="text-xs text-amber-400/60 font-mono" dir="ltr">{user.email}</span>
                      </td>
                      <td className="p-3">
                        <span className="text-xs text-amber-400/80">{user.company_name}</span>
                      </td>
                      <td className="p-3 text-center">
                        <span className="text-xs text-amber-400/60">{roleLabels[user.role] || user.role}</span>
                      </td>
                      <td className="p-3 text-center">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.65rem] font-medium ${
                            user.status === 'active'
                              ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-800/30'
                              : 'bg-red-950/40 text-red-400 border border-red-800/30'
                          }`}
                        >
                          {user.status === 'active' ? (
                            <CheckCircle size={10} />
                          ) : (
                            <XCircle size={10} />
                          )}
                          {user.status === 'active' ? 'نشط' : 'موقوف'}
                        </span>
                      </td>
                      <td className="p-3">
                        <span className="text-xs text-amber-400/60">{user.last_login || '--'}</span>
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => showUserActivity(user)}
                            className="px-2.5 py-1 rounded-lg bg-sky-950/20 text-sky-400/70 border border-sky-800/20 hover:bg-sky-950/40 hover:text-sky-400 text-[0.65rem] font-medium transition-all"
                          >
                            <Eye size={12} className="inline ml-1" />
                            النشاطات
                          </button>
                          <button
                            onClick={() => toggleStatus(user.id, user.status)}
                            disabled={actionLoading === user.id}
                            className={`px-2.5 py-1 rounded-lg text-[0.65rem] font-medium transition-all border ${
                              user.status === 'active'
                                ? 'bg-red-950/20 text-red-400/70 border-red-800/20 hover:bg-red-950/40 hover:text-red-400'
                                : 'bg-emerald-950/20 text-emerald-400/70 border-emerald-800/20 hover:bg-emerald-950/40 hover:text-emerald-400'
                            }`}
                          >
                            {actionLoading === user.id ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : user.status === 'active' ? (
                              'تعليق'
                            ) : (
                              'تفعيل'
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {selectedUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSelectedUser(null)} />
            <div className="relative bg-[#12101a] border border-[#2a1f0a] rounded-2xl p-5 w-full max-w-md shadow-2xl modal-content">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-amber-200">نشاطات المستخدم</h3>
                <button
                  onClick={() => setSelectedUser(null)}
                  className="text-amber-600/60 hover:text-amber-400 text-sm transition-colors"
                >
                  إغلاق
                </button>
              </div>
              <p className="text-xs text-amber-400/60 mb-4">
                {selectedUser.name} — {selectedUser.email}
              </p>
              {activityLoading ? (
                <div className="flex justify-center py-6">
                  <Loader2 size={20} className="text-amber-500 animate-spin" />
                </div>
              ) : userActivity.length > 0 ? (
                <div className="space-y-1 max-h-60 overflow-y-auto">
                  {userActivity.map((act, i) => (
                    <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-[#1a1625]">
                      <span className="text-xs text-amber-300/70">{act.action}</span>
                      <span className="text-[0.65rem] text-amber-600/40">{act.timestamp}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-amber-600/50 text-xs text-center py-6">لا توجد نشاطات مسجلة</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
