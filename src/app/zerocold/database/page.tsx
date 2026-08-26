'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Database, HardDrive, Table2, Download, Loader2,
  RefreshCw, ChevronLeft, AlertTriangle, CheckCircle, ShieldAlert
} from 'lucide-react';
import Link from 'next/link';
import { MasterPasswordModal } from '@/components/ui/MasterPasswordModal';

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
  const [backupMessage, setBackupMessage] = useState('');
  const [restoreMessage, setRestoreMessage] = useState('');
  const [showBackupModal, setShowBackupModal] = useState(false);

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

  const handleBackup = async (masterPassword: string) => {
    setBackingUp(true);
    setBackupMessage('');
    try {
      const res = await fetch('/api/admin/database/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ masterPassword }),
      });
      const body = await res.json();
      if (body.success) {
        setBackupMessage(body.message || 'تم تسجيل طلب النسخة الاحتياطية في السجلات. استخدم أداة النسخ في Supabase أو pg_dump لإنشاء النسخة الفعلية.');
      } else {
        setBackupMessage(body.message || 'فشل إنشاء النسخة الاحتياطية');
      }
    } catch {
      setBackupMessage('حدث خطأ في الاتصال بالخادم');
    } finally {
      setBackingUp(false);
    }
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
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-purple-700 flex items-center justify-center">
              <Database className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-text-primary">قاعدة البيانات</h1>
              <p className="text-[0.7rem] text-text-muted">إدارة قاعدة البيانات والنسخ الاحتياطي</p>
            </div>
          </div>
          <button
            onClick={fetchDbInfo}
            className="p-2 rounded-xl bg-bg-card border border-border text-text-secondary hover:text-amber-400 transition-all"
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
          <div className="bg-bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <HardDrive size={16} className="text-text-secondary" />
              <span className="text-xs text-text-secondary font-medium">حجم قاعدة البيانات</span>
            </div>
            <p className="text-lg font-bold text-text-primary font-mono">{dbInfo?.dbSize ?? '--'}</p>
          </div>
          <div className="bg-bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Table2 size={16} className="text-text-secondary" />
              <span className="text-xs text-text-secondary font-medium">عدد الجداول</span>
            </div>
            <p className="text-lg font-bold text-text-primary font-mono">{dbInfo?.tables?.length ?? 0}</p>
          </div>
          <div className="bg-bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              {dbInfo?.healthStatus === 'good' ? (
                <CheckCircle size={16} className="text-emerald-400" />
              ) : (
                <AlertTriangle size={16} className="text-amber-400" />
              )}
              <span className="text-xs text-text-secondary font-medium">حالة قاعدة البيانات</span>
            </div>
            <p className="text-sm font-bold text-text-primary">
              {dbInfo?.healthStatus === 'good' ? 'سليمة' : dbInfo?.healthStatus === 'warning' ? 'تحذير' : '--'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div className="bg-bg-card border border-border rounded-xl p-5">
            <h2 className="text-sm font-bold text-amber-300/80 mb-3">النسخ الاحتياطي والاستعادة</h2>
            <div className="space-y-3">
              <button
                onClick={() => setShowBackupModal(true)}
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

              <button
                onClick={() => setRestoreMessage('استعادة قاعدة البيانات عبر الويب معطلة لأسباب أمنية. استخدم لوحة تحكم Supabase مع ملف نسخة احتياطية موثّق وموقّع.')}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-bg-secondary border border-border hover:border-[#3a2f1a] text-amber-300/80 font-semibold rounded-xl transition-all text-sm"
              >
                <ShieldAlert size={16} />
                استعادة نسخة احتياطية
              </button>
              <p className="text-[0.65rem] text-text-muted leading-relaxed text-center px-1">
                الاستعادة تتم عبر لوحة تحكم Supabase فقط لضمان الأمان. هذا الزر يوضّح الإجراء المطلوب.
              </p>

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

          <div className="bg-bg-card border border-border rounded-xl p-5">
            <h2 className="text-sm font-bold text-amber-300/80 mb-3">مؤشرات قاعدة البيانات</h2>
            <div className="space-y-2">
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-bg-secondary border border-border">
                <span className="text-xs text-text-secondary">إجمالي المؤشرات</span>
                <span className="text-xs font-mono text-amber-200">{dbInfo?.indexHealth?.total ?? 0}</span>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-bg-secondary border border-border">
                <span className="text-xs text-text-secondary">مؤشرات مفقودة</span>
                <span className={`text-xs font-mono ${(dbInfo?.indexHealth?.missing ?? 0) > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                  {dbInfo?.indexHealth?.missing ?? 0}
                </span>
              </div>
              {dbInfo?.indexHealth?.issues && dbInfo.indexHealth.issues.length > 0 && (
                <div className="mt-2">
                  <p className="text-[0.65rem] text-red-400/70 mb-1.5">المشكلات:</p>
                  {dbInfo.indexHealth.issues.map((issue, i) => (
                    <p key={i} className="text-[0.65rem] text-text-muted mr-2">• {issue}</p>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="bg-bg-card border border-border rounded-xl p-5 mb-6">
          <h2 className="text-sm font-bold text-amber-300/80 mb-3">جداول قاعدة البيانات</h2>
          {dbInfo?.tables && dbInfo.tables.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-right p-2.5 text-[0.7rem] text-text-secondary/60 font-medium">الجدول</th>
                    <th className="text-center p-2.5 text-[0.7rem] text-text-secondary/60 font-medium">عدد السجلات</th>
                    <th className="text-left p-2.5 text-[0.7rem] text-text-secondary/60 font-medium" dir="ltr">الحجم</th>
                  </tr>
                </thead>
                <tbody>
                  {dbInfo.tables.map((table) => (
                    <tr key={table.name} className="border-b border-[#1f1725] last:border-0 hover:bg-bg-secondary transition-all">
                      <td className="p-2.5">
                        <span className="text-xs text-amber-300/80 font-mono">{table.name}</span>
                      </td>
                      <td className="p-2.5 text-center">
                        <span className="text-xs text-text-secondary font-mono">{table.row_count}</span>
                      </td>
                      <td className="p-2.5 text-left">
                        <span className="text-xs text-text-secondary font-mono" dir="ltr">{table.size}</span>
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
          <div className="bg-bg-card border border-border rounded-xl p-5">
            <h2 className="text-sm font-bold text-amber-300/80 mb-3">الاستعلامات البطيئة</h2>
            <div className="space-y-2">
              {dbInfo.slowQueries.map((sq, i) => (
                <div key={i} className="p-2.5 rounded-lg bg-bg-secondary border border-border">
                  <p className="text-[0.65rem] text-text-secondary font-mono truncate mb-1" dir="ltr">{sq.query}</p>
                  <div className="flex items-center gap-3">
                    <span className="text-[0.6rem] text-red-400/60">متوسط الوقت: {sq.avg_time}</span>
                    <span className="text-[0.6rem] text-text-secondary">العدد: {sq.count}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <MasterPasswordModal
          isOpen={showBackupModal}
          title="تأكيد النسخ الاحتياطي"
          description="سيتم تسجيل العملية في سجلات التدقيق. أنشئ النسخة الفعلية عبر أداة Supabase أو pg_dump."
          submitLabel="تأكيد النسخ الاحتياطي"
          onCancel={() => setShowBackupModal(false)}
          onSubmit={(mp) => { setShowBackupModal(false); return handleBackup(mp); }}
        />
      </div>
    </div>
  );
}
