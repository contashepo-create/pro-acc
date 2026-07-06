'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity, Search, Loader2, ShieldAlert, RefreshCw,
  ChevronLeft, Download, Trash2, Filter, Calendar
} from 'lucide-react';
import Link from 'next/link';

interface LogEntry {
  id: string;
  timestamp: string;
  action: string;
  details: string;
  ip: string;
}

export default function ZerocoldLogsPage() {
  const router = useRouter();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [clearing, setClearing] = useState(false);

  const actionTypes = [
    { value: '', label: 'كل الإجراءات' },
    { value: 'login', label: 'تسجيل دخول' },
    { value: 'create', label: 'إنشاء' },
    { value: 'update', label: 'تحديث' },
    { value: 'delete', label: 'حذف' },
    { value: 'backup', label: 'نسخ احتياطي' },
    { value: 'restore', label: 'استعادة' },
    { value: 'toggle_status', label: 'تغيير الحالة' },
  ];

  const fetchLogs = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (actionFilter) params.set('action', actionFilter);
      if (dateFrom) params.set('from', dateFrom);
      if (dateTo) params.set('to', dateTo);

      const res = await fetch(`/api/admin/logs?${params.toString()}`);

      if (res.status === 401) {
        router.replace('/zerocold/login');
        return;
      }

      const body = await res.json();
      if (!body.success) {
        setError(body.message || 'حدث خطأ');
        return;
      }

      setLogs(body.data?.logs ?? (Array.isArray(body.data) ? body.data : []));
    } catch {
      setError('حدث خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const handleExportCsv = () => {
    if (logs.length === 0) return;
    const headers = ['التاريخ', 'الإجراء', 'التفاصيل', 'IP'];
    const rows = logs.map((l) => [
      l.timestamp,
      l.action,
      l.details.replace(/,/g, '،'),
      l.ip,
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `admin-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClearLogs = async () => {
    if (!window.confirm('هل أنت متأكد من مسح سجل الأحداث بالكامل؟')) return;
    setClearing(true);
    try {
      const res = await fetch('/api/admin/logs', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ masterPassword: prompt('يرجى إدخال كلمة السر الرئيسية:') }),
      });

      const body = await res.json();
      if (body.success) {
        setLogs([]);
      } else {
        if (body.masterRequired) {
          alert('كلمة السر الرئيسية غير صحيحة');
        } else {
          alert(body.message || 'فشل مسح السجل');
        }
      }
    } catch {
      alert('حدث خطأ');
    } finally {
      setClearing(false);
    }
  };

  const filtered = logs;

  const actionLabels: Record<string, string> = {
    login: 'تسجيل دخول',
    create: 'إنشاء',
    update: 'تحديث',
    delete: 'حذف',
    backup: 'نسخ احتياطي',
    restore: 'استعادة',
    toggle_status: 'تغيير الحالة',
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
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-600 to-orange-700 flex items-center justify-center">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-amber-50">سجل الأحداث</h1>
              <p className="text-[0.7rem] text-amber-400/50">{logs.length} حدث</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportCsv}
              disabled={logs.length === 0}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#12101a] border border-[#2a1f0a] text-amber-400/70 hover:text-amber-400 disabled:opacity-40 disabled:cursor-not-allowed transition-all text-xs"
            >
              <Download size={14} />
              تصدير CSV
            </button>
            <button
              onClick={handleClearLogs}
              disabled={clearing || logs.length === 0}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#12101a] border border-red-800/30 text-red-400/70 hover:text-red-400 hover:border-red-800/50 disabled:opacity-40 disabled:cursor-not-allowed transition-all text-xs"
            >
              {clearing ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              مسح السجل
            </button>
            <button
              onClick={fetchLogs}
              className="p-2 rounded-xl bg-[#12101a] border border-[#2a1f0a] text-amber-500/70 hover:text-amber-400 transition-all"
              title="تحديث"
            >
              <RefreshCw size={16} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
          <div className="relative">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-amber-600/50" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث..."
              className="w-full pr-10 pl-4 py-2.5 bg-[#12101a] border border-[#2a1f0a] rounded-xl text-amber-50 placeholder-amber-700/50 focus:outline-none focus:border-amber-600 focus:ring-1 focus:ring-amber-600/30 transition-all text-sm"
            />
          </div>
          <div className="relative">
            <Filter size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-amber-600/50 pointer-events-none" />
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="w-full pr-10 pl-4 py-2.5 bg-[#12101a] border border-[#2a1f0a] rounded-xl text-amber-50 focus:outline-none focus:border-amber-600 focus:ring-1 focus:ring-amber-600/30 transition-all text-sm appearance-none cursor-pointer"
            >
              {actionTypes.map((at) => (
                <option key={at.value} value={at.value}>{at.label}</option>
              ))}
            </select>
          </div>
          <div className="relative">
            <Calendar size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-amber-600/50 pointer-events-none" />
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full pr-10 pl-4 py-2.5 bg-[#12101a] border border-[#2a1f0a] rounded-xl text-amber-50 focus:outline-none focus:border-amber-600 focus:ring-1 focus:ring-amber-600/30 transition-all text-sm"
            />
          </div>
          <div className="relative">
            <Calendar size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-amber-600/50 pointer-events-none" />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full pr-10 pl-4 py-2.5 bg-[#12101a] border border-[#2a1f0a] rounded-xl text-amber-50 focus:outline-none focus:border-amber-600 focus:ring-1 focus:ring-amber-600/30 transition-all text-sm"
            />
          </div>
        </div>

        <div className="flex justify-end mb-3">
          <button
            onClick={fetchLogs}
            className="px-4 py-2 bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 text-xs font-medium rounded-xl transition-all border border-amber-700/30"
          >
            بحث
          </button>
        </div>

        {error && (
          <div className="bg-red-950/40 border border-red-800/40 text-red-400 text-sm rounded-xl px-4 py-2.5 text-center mb-4">
            {error}
          </div>
        )}

        {filtered.length === 0 && !error ? (
          <div className="bg-[#12101a] border border-[#2a1f0a] rounded-xl p-8 text-center">
            <Activity size={32} className="text-amber-600/30 mx-auto mb-2" />
            <p className="text-amber-600/50 text-sm">لا توجد أحداث مسجلة</p>
          </div>
        ) : (
          <div className="bg-[#12101a] border border-[#2a1f0a] rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#2a1f0a]">
                    <th className="text-right p-3 text-[0.7rem] text-amber-500/60 font-medium">التاريخ</th>
                    <th className="text-right p-3 text-[0.7rem] text-amber-500/60 font-medium">الإجراء</th>
                    <th className="text-right p-3 text-[0.7rem] text-amber-500/60 font-medium">التفاصيل</th>
                    <th className="text-left p-3 text-[0.7rem] text-amber-500/60 font-medium" dir="ltr">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((log) => (
                    <tr key={log.id} className="border-b border-[#1f1725] last:border-0 hover:bg-[#1a1625] transition-all">
                      <td className="p-3">
                        <span className="text-xs text-amber-400/60">{log.timestamp}</span>
                      </td>
                      <td className="p-3">
                        <span className="text-xs text-amber-300/80">{actionLabels[log.action] || log.action}</span>
                      </td>
                      <td className="p-3">
                        <span className="text-xs text-amber-400/70">{log.details || '--'}</span>
                      </td>
                      <td className="p-3 text-left">
                        <span className="text-xs text-amber-500/50 font-mono" dir="ltr">{log.ip || '--'}</span>
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
