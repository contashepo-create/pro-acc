'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity, Search, Loader2, RefreshCw,
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      <div className="min-h-screen bg-bg-primary flex items-center justify-center">
        <Loader2 size={32} className="text-text-secondary animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-primary">
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Link href="/zerocold/" className="p-2 rounded-lg hover:bg-bg-card transition-all">
              <ChevronLeft size={18} className="text-text-secondary" />
            </Link>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent to-accent-hover flex items-center justify-center">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-text-primary">سجل الأحداث</h1>
              <p className="text-[0.7rem] text-text-muted">{logs.length} حدث</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportCsv}
              disabled={logs.length === 0}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-bg-card border border-border text-text-secondary hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed transition-all text-xs"
            >
              <Download size={14} />
              تصدير CSV
            </button>
            <button
              onClick={handleClearLogs}
              disabled={clearing || logs.length === 0}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-bg-card border bg-red-950/60 border-red-700/60 text-red-200 hover:text-white hover:bg-red-800/70 hover:border-red-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all text-xs"
            >
              {clearing ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              مسح السجل
            </button>
            <button
              onClick={fetchLogs}
              className="p-2 rounded-xl bg-bg-card border border-border text-text-secondary hover:text-accent transition-all"
              title="تحديث"
            >
              <RefreshCw size={16} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
          <div className="relative">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث..."
              className="w-full pr-10 pl-4 py-2.5 bg-bg-card border border-border rounded-xl text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent transition-all text-sm"
            />
          </div>
          <div className="relative">
            <Filter size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="w-full pr-10 pl-4 py-2.5 bg-bg-card border border-border rounded-xl text-text-primary focus:outline-none focus:border-accent transition-all text-sm appearance-none cursor-pointer"
            >
              {actionTypes.map((at) => (
                <option key={at.value} value={at.value}>{at.label}</option>
              ))}
            </select>
          </div>
          <div className="relative">
            <Calendar size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full pr-10 pl-4 py-2.5 bg-bg-card border border-border rounded-xl text-text-primary focus:outline-none focus:border-accent transition-all text-sm"
            />
          </div>
          <div className="relative">
            <Calendar size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full pr-10 pl-4 py-2.5 bg-bg-card border border-border rounded-xl text-text-primary focus:outline-none focus:border-accent transition-all text-sm"
            />
          </div>
        </div>

        <div className="flex justify-end mb-3">
          <button
            onClick={fetchLogs}
            className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-xs font-medium rounded-xl transition-all"
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
          <div className="bg-bg-card border border-border rounded-xl p-8 text-center">
            <Activity size={32} className="text-text-muted opacity-40 mx-auto mb-2" />
            <p className="text-text-muted text-sm">لا توجد أحداث مسجلة</p>
          </div>
        ) : (
          <div className="bg-bg-card border border-border rounded-xl overflow-x-auto">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-bg-secondary/40">
                    <th className="text-right p-3 text-xs text-text-secondary font-medium">التاريخ</th>
                    <th className="text-right p-3 text-xs text-text-secondary font-medium">الإجراء</th>
                    <th className="text-right p-3 text-xs text-text-secondary font-medium">التفاصيل</th>
                    <th className="text-left p-3 text-xs text-text-secondary font-medium" dir="ltr">IP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((log) => (
                    <tr key={log.id} className="hover:bg-bg-secondary/50 transition-all">
                      <td className="p-3">
                        <span className="text-xs text-text-secondary">{log.timestamp}</span>
                      </td>
                      <td className="p-3">
                        <span className="text-xs text-accent font-medium">{actionLabels[log.action] || log.action}</span>
                      </td>
                      <td className="p-3">
                        <span className="text-xs text-text-secondary">{log.details || '--'}</span>
                      </td>
                      <td className="p-3 text-left">
                        <span className="text-xs text-text-secondary/50 font-mono" dir="ltr">{log.ip || '--'}</span>
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
