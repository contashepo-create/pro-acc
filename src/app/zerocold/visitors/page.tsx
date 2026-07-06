'use client';

import { useState, useEffect } from 'react';
import { Eye, Loader2, TrendingUp, Users, Calendar } from 'lucide-react';

export default function VisitorsPage() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/visitors')
      .then((r) => r.json())
      .then((d) => { if (d.success) setStats(d.data); })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-amber-500" /></div>;
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Eye size={24} className="text-amber-500" />
        <h1 className="text-2xl font-bold text-amber-50">إحصائيات الزوار</h1>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-[#12101a] border border-[#2a1f0a] rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-amber-400/60">اليوم</span>
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-600 to-blue-700 flex items-center justify-center">
              <Calendar size={14} className="text-white" />
            </div>
          </div>
          <p className="text-2xl font-bold text-amber-50 font-mono">{stats?.today?.visits || 0}</p>
          <p className="text-xs text-amber-400/40 mt-1">زيارة اليوم</p>
        </div>

        <div className="bg-[#12101a] border border-[#2a1f0a] rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-amber-400/60">مميزون</span>
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-600 to-green-700 flex items-center justify-center">
              <Users size={14} className="text-white" />
            </div>
          </div>
          <p className="text-2xl font-bold text-amber-50 font-mono">{stats?.today?.unique_visitors || 0}</p>
          <p className="text-xs text-amber-400/40 mt-1">زائر فريد اليوم</p>
        </div>

        <div className="bg-[#12101a] border border-[#2a1f0a] rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-amber-400/60">الإجمالي</span>
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-600 to-fuchsia-700 flex items-center justify-center">
              <TrendingUp size={14} className="text-white" />
            </div>
          </div>
          <p className="text-2xl font-bold text-amber-50 font-mono">{stats?.totalVisits || 0}</p>
          <p className="text-xs text-amber-400/40 mt-1">إجمالي الزيارات</p>
        </div>
      </div>

      {stats?.weekly && stats.weekly.length > 0 && (
        <div className="bg-[#12101a] border border-[#2a1f0a] rounded-xl p-5">
          <h2 className="text-sm font-bold text-amber-300/80 mb-4">آخر 7 أيام</h2>
          <div className="space-y-2">
            {stats.weekly.map((day: any) => (
              <div key={day.date} className="flex items-center gap-3">
                <span className="text-xs text-amber-400/60 w-28" dir="ltr">{day.date}</span>
                <div className="flex-1 h-6 rounded-full bg-[#1a1625] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-l from-amber-600 to-orange-600 transition-all duration-500"
                    style={{ width: `${Math.min(100, (day.visits / (stats.today?.visits || 1)) * 100)}%` }}
                  />
                </div>
                <span className="text-xs text-amber-300/80 font-mono w-16 text-left">{day.visits}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
