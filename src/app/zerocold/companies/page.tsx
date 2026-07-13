'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2, Search, Loader2, RefreshCw,
  CheckCircle, XCircle, ChevronLeft
} from 'lucide-react';
import Link from 'next/link';

interface Company {
  id: string;
  name: string;
  commercial_registration: string;
  tax_number: string;
  user_count: number;
  created_at: string;
  status: 'active' | 'suspended';
}

export default function ZerocoldCompaniesPage() {
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchCompanies = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/companies');

      if (res.status === 401) {
        router.replace('/zerocold/login');
        return;
      }

      const body = await res.json();
      if (!body.success) {
        setError(body.message || 'حدث خطأ');
        return;
      }

      const rawCompanies = body.data?.companies ?? (Array.isArray(body.data) ? body.data : []);
      setCompanies(rawCompanies.map((c: any) => ({
        ...c,
        status: c.is_active ? 'active' : 'suspended',
      })));
    } catch {
      setError('حدث خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchCompanies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleStatus = async (companyId: string, currentStatus: string) => {
    const masterPassword = prompt('يرجى إدخال كلمة السر الرئيسية:');
    if (!masterPassword) return;

    setActionLoading(companyId);
    try {
      const res = await fetch('/api/admin/companies/toggle-status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-master-password': masterPassword,
        },
        body: JSON.stringify({ companyId, is_active: currentStatus !== 'active' }),
      });

      const body = await res.json();

      if (!res.ok || !body.success) {
        alert(body.message || 'فشل التحديث');
        return;
      }

      setCompanies((prev) =>
        prev.map((c) =>
          c.id === companyId
            ? { ...c, status: currentStatus === 'active' ? 'suspended' : 'active', is_active: currentStatus !== 'active' }
            : c
        )
      );
    } catch {
      alert('حدث خطأ في الاتصال');
    } finally {
      setActionLoading(null);
    }
  };

  const filtered = companies.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.commercial_registration?.toLowerCase().includes(search.toLowerCase()) ||
    c.tax_number?.toLowerCase().includes(search.toLowerCase())
  );

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
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-600 to-blue-700 flex items-center justify-center">
              <Building2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-amber-50">إدارة الشركات</h1>
              <p className="text-[0.7rem] text-amber-400/50">{companies.length} شركة</p>
            </div>
          </div>
          <button
            onClick={fetchCompanies}
            className="p-2 rounded-xl bg-[#12101a] border border-[#2a1f0a] text-amber-500/70 hover:text-amber-400 transition-all"
            title="تحديث"
          >
            <RefreshCw size={16} />
          </button>
        </div>

        <div className="relative mb-4">
          <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-amber-600/50" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث عن شركة..."
            className="w-full pr-10 pl-4 py-2.5 bg-[#12101a] border border-[#2a1f0a] rounded-xl text-amber-50 placeholder-amber-700/50 focus:outline-none focus:border-amber-600 focus:ring-1 focus:ring-amber-600/30 transition-all text-sm"
          />
        </div>

        {error && (
          <div className="bg-red-950/40 border border-red-800/40 text-red-400 text-sm rounded-xl px-4 py-2.5 text-center mb-4">
            {error}
          </div>
        )}

        {filtered.length === 0 && !error ? (
          <div className="bg-[#12101a] border border-[#2a1f0a] rounded-xl p-8 text-center">
            <Building2 size={32} className="text-amber-600/30 mx-auto mb-2" />
            <p className="text-amber-600/50 text-sm">لا توجد شركات مطابقة للبحث</p>
          </div>
        ) : (
          <div className="bg-[#12101a] border border-[#2a1f0a] rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#2a1f0a]">
                    <th className="text-right p-3 text-[0.7rem] text-amber-500/60 font-medium">اسم الشركة</th>
                    <th className="text-right p-3 text-[0.7rem] text-amber-500/60 font-medium">رقم السجل</th>
                    <th className="text-right p-3 text-[0.7rem] text-amber-500/60 font-medium">الرقم الضريبي</th>
                    <th className="text-center p-3 text-[0.7rem] text-amber-500/60 font-medium">المستخدمين</th>
                    <th className="text-right p-3 text-[0.7rem] text-amber-500/60 font-medium">تاريخ الإنشاء</th>
                    <th className="text-center p-3 text-[0.7rem] text-amber-500/60 font-medium">الحالة</th>
                    <th className="text-center p-3 text-[0.7rem] text-amber-500/60 font-medium">الإجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((company) => (
                    <tr key={company.id} className="border-b border-[#1f1725] last:border-0 hover:bg-[#1a1625] transition-all">
                      <td className="p-3">
                        <span className="text-sm text-amber-200 font-medium">{company.name}</span>
                      </td>
                      <td className="p-3">
                        <span className="text-xs text-amber-400/60 font-mono">{company.commercial_registration || '--'}</span>
                      </td>
                      <td className="p-3">
                        <span className="text-xs text-amber-400/60 font-mono">{company.tax_number || '--'}</span>
                      </td>
                      <td className="p-3 text-center">
                        <span className="text-xs text-amber-400/80 font-mono">{company.user_count}</span>
                      </td>
                      <td className="p-3">
                        <span className="text-xs text-amber-400/60">{company.created_at}</span>
                      </td>
                      <td className="p-3 text-center">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.65rem] font-medium ${
                            company.status === 'active'
                              ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-800/30'
                              : 'bg-red-950/40 text-red-400 border border-red-800/30'
                          }`}
                        >
                          {company.status === 'active' ? (
                            <CheckCircle size={10} />
                          ) : (
                            <XCircle size={10} />
                          )}
                          {company.status === 'active' ? 'نشط' : 'موقوف'}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => toggleStatus(company.id, company.status)}
                            disabled={actionLoading === company.id}
                            className={`px-2.5 py-1 rounded-lg text-[0.65rem] font-medium transition-all border ${
                              company.status === 'active'
                                ? 'bg-red-950/20 text-red-400/70 border-red-800/20 hover:bg-red-950/40 hover:text-red-400'
                                : 'bg-emerald-950/20 text-emerald-400/70 border-emerald-800/20 hover:bg-emerald-950/40 hover:text-emerald-400'
                            }`}
                          >
                            {actionLoading === company.id ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : company.status === 'active' ? (
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
      </div>
    </div>
  );
}
