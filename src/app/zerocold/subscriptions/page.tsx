'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Users, Loader2, ChevronLeft } from 'lucide-react';
import Link from 'next/link';

interface Subscription {
  id: string; company_name: string; plan_code: string; plan_name: string;
  status: string; start_date: string; end_date: string; auto_renew: boolean;
}

const statusBadge: Record<string, string> = {
  active: 'bg-green-900/30 text-green-400',
  expired: 'bg-red-900/30 text-red-400',
  cancelled: 'bg-gray-800 text-gray-400',
  trial: 'bg-amber-900/30 text-amber-400',
};

const statusLabels: Record<string, string> = {
  active: 'نشط', trial: 'تجريبي', expired: 'منتهي', cancelled: 'ملغي'
};

export default function SubscriptionsPage() {
  const router = useRouter();
  const [data, setData] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch('/api/admin/subscriptions');
        if (res.status === 401) { router.replace('/zerocold/login'); return; }
        const body = await res.json();
        if (body.success) setData(body.data?.subscriptions ?? (Array.isArray(body.data) ? body.data : []));
        else setError(body.message || 'حدث خطأ');
      } catch {
        setError('حدث خطأ في الاتصال بالخادم');
      } finally { setLoading(false); }
    };
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = data.filter((s) => !filter || s.status === filter);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <Loader2 size={32} className="text-amber-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Link href="/zerocold/" className="p-2 rounded-lg hover:bg-[#12101a] transition-all">
              <ChevronLeft size={18} className="text-amber-500/70" />
            </Link>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-600 to-fuchsia-700 flex items-center justify-center">
              <Users className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-amber-50">الاشتراكات</h1>
              <p className="text-[0.7rem] text-amber-400/50">{data.length} اشتراك</p>
            </div>
          </div>
          <div className="flex gap-2">
            {['', 'active', 'trial', 'expired', 'cancelled'].map((s) => (
              <button key={s} onClick={() => setFilter(s)} className={`px-3 py-1.5 rounded-xl text-xs transition-colors ${filter === s ? 'bg-amber-600 text-white' : 'bg-[#1a1625] border border-[#2a1f0a] text-amber-400/70'}`}>
                {s ? statusLabels[s] : 'الكل'}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="bg-red-950/40 border border-red-800/40 text-red-400 text-sm rounded-xl px-4 py-2.5 text-center mb-4">
            {error}
          </div>
        )}

        {filtered.length === 0 ? (
          <div className="bg-[#12101a] border border-[#2a1f0a] rounded-xl p-8 text-center">
            <Users size={32} className="text-amber-600/30 mx-auto mb-2" />
            <p className="text-amber-600/50 text-sm">لا توجد اشتراكات</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((sub) => (
              <div key={sub.id} className="bg-[#12101a] border border-[#2a1f0a] rounded-2xl p-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-900/30 flex items-center justify-center"><Users size={18} className="text-amber-400" /></div>
                    <div>
                      <h3 className="text-amber-50 font-medium">{sub.company_name}</h3>
                      <p className="text-amber-400/50 text-xs">{sub.plan_name || sub.plan_code}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-amber-400/70 text-xs">{sub.start_date} → {sub.end_date}</span>
                    <span className={`px-2 py-1 rounded-lg text-xs font-medium ${statusBadge[sub.status] || ''}`}>
                      {statusLabels[sub.status] || sub.status}
                    </span>
                    <span className={`text-xs ${sub.auto_renew ? 'text-green-400' : 'text-amber-600'}`}>{sub.auto_renew ? 'تجديد تلقائي' : 'يدوي'}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
