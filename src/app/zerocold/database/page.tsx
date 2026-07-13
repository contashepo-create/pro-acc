'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Database, HardDrive, Table2, Upload, Download, Loader2,
  RefreshCw, ChevronLeft, AlertTriangle, CheckCircle
} from 'lucide-react';
import Link from 'next/link';

interface TableInfo {
  name: string;
  row_count: number;
  size: string;
}

interface DbInfo {
  dbSize: string;
  dbPath: string;
  healthStatus: string;
  tables: TableInfo[];
  indexHealth: { total: number; missing: number; issues: string[] };
  slowQueries: { query: string; avg_time: string; count: number }[];
}

export default function ZerocoldDatabasePage() {
  const router = useRouter();
  const [dbInfo, setDbInfo] = useState<DbInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [backingUp, setBackingUp] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [backupMessage, setBackupMessage] = useState('');
  const [restoreMessage, setRestoreMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchDbInfo = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/database');

      if (res.status === 401) {
        router.replace('/zerocold/login');
        return;
      }

      const body = await res.json();
      if (!body.success) {
        setError(body.message || 'حدث خطأ');
        return;
      }

      setDbInfo(body.data);
    } catch {
      setError('حدث خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchDbInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleBackup = async () => {
    setBackingUp(true);
    setBackupMessage('');
    try {
      const res = await fetch('/api/admin/database/backup', {
        method: 'POST',
      });

      const body = await res.json();
      if (body.success) {
        setBackupMessage('تم إنشاء النسخة الاحتياطية وإرسالها إلى التليجرام بنجاح');
      } else {
        setBackupMessage(body.message || 'فشل إنشاء النسخة الاحتياطية');
      }
    } catch {
      setBackupMessage('حدث خطأ في الاتصال بالخادم');
    } finally {
      setBackingUp(false);
    }
  };

  const handleRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setRestoring(true);
    setRestoreMessage('');
    try {
      const formData = new FormData();
      formData.append('backup', file);

      const res = await fetch('/api/admin/database/restore', {
        method: 'POST',
        body: formData,
      });

      const body = await res.json();
      if (body.success) {
        setRestoreMessage('تمت استعادة قاعدة البيانات بنجاح');
        fetchDbInfo();
      } else {
        setRestoreMessage(body.message || 'فشلت عملية الاستعادة');
      }
    } catch {
      setRestoreMessage('حدث خطأ في الاتصال بالخادم');
    } finally {
      setRestoring(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
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
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-purple-700 flex items-center justify-center">
              <Database className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-amber-50">قاعدة البيانات</h1>
              <p className="text-[0.7rem] text-amber-400/50">إدارة قاعدة البيانات والنسخ الاحتياطي</p>
            </div>
          </div>
          <button
            onClick={fetchDbInfo}
            className="p-2 rounded-xl bg-[#12101a] border border-[#2a1f0a] text-amber-500/70 hover:text-amber-400 transition-all"
            title="تحديث"
          >
            <RefreshCw size={16} />
          </button>
        </div>

        {error && (
          <div className="bg-red-950/40 border border-red-800/40 text-red-400 text-sm rounded-xl px-4 py-2.5 text-center mb-4">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          <div className="bg-[#12101a] border border-[#2a1f0a] rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <HardDrive size={16} className="text-amber-500/70" />
              <span className="text-xs text-amber-400/60 font-medium">حجم قاعدة البيانات</span>
            </div>
            <p className="text-lg font-bold text-amber-50 font-mono">{dbInfo?.dbSize ?? '--'}</p>
          </div>
          <div className="bg-[#12101a] border border-[#2a1f0a] rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Table2 size={16} className="text-amber-500/70" />
              <span className="text-xs text-amber-400/60 font-medium">عدد الجداول</span>
            </div>
            <p className="text-lg font-bold text-amber-50 font-mono">{dbInfo?.tables?.length ?? 0}</p>
          </div>
          <div className="bg-[#12101a] border border-[#2a1f0a] rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              {dbInfo?.healthStatus === 'good' ? (
                <CheckCircle size={16} className="text-emerald-400" />
              ) : (
                <AlertTriangle size={16} className="text-amber-400" />
              )}
              <span className="text-xs text-amber-400/60 font-medium">حالة قاعدة البيانات</span>
            </div>
            <p className="text-sm font-bold text-amber-50">
              {dbInfo?.healthStatus === 'good' ? 'سليمة' : dbInfo?.healthStatus === 'warning' ? 'تحذير' : '--'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div className="bg-[#12101a] border border-[#2a1f0a] rounded-xl p-5">
            <h2 className="text-sm font-bold text-amber-300/80 mb-3">النسخ الاحتياطي والاستعادة</h2>
            <div className="space-y-3">
              <button
                onClick={handleBackup}
                disabled={backingUp}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-gradient-to-l from-amber-600 to-orange-700 hover:from-amber-500 hover:to-orange-600 disabled:from-amber-800 disabled:to-orange-900 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all text-sm shadow-lg shadow-amber-900/20"
              >
                {backingUp ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Download size={16} />
                )}
                {backingUp ? 'جاري إنشاء النسخة...' : 'نسخ احتياطي'}
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept=".db,.sqlite,.sqlite3,.backup"
                onChange={handleRestore}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={restoring}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#1a1625] border border-[#2a1f0a] hover:border-[#3a2f1a] disabled:opacity-50 disabled:cursor-not-allowed text-amber-300/80 font-semibold rounded-xl transition-all text-sm"
              >
                {restoring ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Upload size={16} />
                )}
                {restoring ? 'جاري الاستعادة...' : 'استعادة نسخة احتياطية'}
              </button>

              {backupMessage && (
                <div className={`text-xs text-center px-3 py-2 rounded-lg ${
                  backupMessage.includes('نجاح') ? 'bg-emerald-950/40 text-emerald-400' : 'bg-red-950/40 text-red-400'
                }`}>
                  {backupMessage}
                </div>
              )}

              {restoreMessage && (
                <div className={`text-xs text-center px-3 py-2 rounded-lg ${
                  restoreMessage.includes('نجاح') ? 'bg-emerald-950/40 text-emerald-400' : 'bg-red-950/40 text-red-400'
                }`}>
                  {restoreMessage}
                </div>
              )}
            </div>
          </div>

          <div className="bg-[#12101a] border border-[#2a1f0a] rounded-xl p-5">
            <h2 className="text-sm font-bold text-amber-300/80 mb-3">مؤشرات قاعدة البيانات</h2>
            <div className="space-y-2">
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#1a1625] border border-[#2a1f0a]">
                <span className="text-xs text-amber-400/60">إجمالي المؤشرات</span>
                <span className="text-xs font-mono text-amber-200">{dbInfo?.indexHealth?.total ?? 0}</span>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#1a1625] border border-[#2a1f0a]">
                <span className="text-xs text-amber-400/60">مؤشرات مفقودة</span>
                <span className={`text-xs font-mono ${(dbInfo?.indexHealth?.missing ?? 0) > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                  {dbInfo?.indexHealth?.missing ?? 0}
                </span>
              </div>
              {dbInfo?.indexHealth?.issues && dbInfo.indexHealth.issues.length > 0 && (
                <div className="mt-2">
                  <p className="text-[0.65rem] text-red-400/70 mb-1.5">المشكلات:</p>
                  {dbInfo.indexHealth.issues.map((issue, i) => (
                    <p key={i} className="text-[0.65rem] text-amber-400/50 mr-2">• {issue}</p>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="bg-[#12101a] border border-[#2a1f0a] rounded-xl p-5 mb-6">
          <h2 className="text-sm font-bold text-amber-300/80 mb-3">جداول قاعدة البيانات</h2>
          {dbInfo?.tables && dbInfo.tables.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#2a1f0a]">
                    <th className="text-right p-2.5 text-[0.7rem] text-amber-500/60 font-medium">الجدول</th>
                    <th className="text-center p-2.5 text-[0.7rem] text-amber-500/60 font-medium">عدد السجلات</th>
                    <th className="text-left p-2.5 text-[0.7rem] text-amber-500/60 font-medium" dir="ltr">الحجم</th>
                  </tr>
                </thead>
                <tbody>
                  {dbInfo.tables.map((table) => (
                    <tr key={table.name} className="border-b border-[#1f1725] last:border-0 hover:bg-[#1a1625] transition-all">
                      <td className="p-2.5">
                        <span className="text-xs text-amber-300/80 font-mono">{table.name}</span>
                      </td>
                      <td className="p-2.5 text-center">
                        <span className="text-xs text-amber-400/60 font-mono">{table.row_count}</span>
                      </td>
                      <td className="p-2.5 text-left">
                        <span className="text-xs text-amber-400/60 font-mono" dir="ltr">{table.size}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex items-center justify-center py-6">
              <Table2 size={20} className="text-amber-600/30" />
              <span className="text-xs text-amber-600/40 mr-2">لا توجد بيانات</span>
            </div>
          )}
        </div>

        {dbInfo?.slowQueries && dbInfo.slowQueries.length > 0 && (
          <div className="bg-[#12101a] border border-[#2a1f0a] rounded-xl p-5">
            <h2 className="text-sm font-bold text-amber-300/80 mb-3">الاستعلامات البطيئة</h2>
            <div className="space-y-2">
              {dbInfo.slowQueries.map((sq, i) => (
                <div key={i} className="p-2.5 rounded-lg bg-[#1a1625] border border-[#2a1f0a]">
                  <p className="text-[0.65rem] text-amber-400/60 font-mono truncate mb-1" dir="ltr">{sq.query}</p>
                  <div className="flex items-center gap-3">
                    <span className="text-[0.6rem] text-red-400/60">متوسط الوقت: {sq.avg_time}</span>
                    <span className="text-[0.6rem] text-amber-400/60">العدد: {sq.count}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
