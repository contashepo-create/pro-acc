'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Download, FileSpreadsheet, FileText, Loader2, ShieldCheck, ArrowLeft, Ban, FileBarChart } from 'lucide-react';
import { useAuthStore } from '@/store/auth-store';
import { REPORTS, EXPORT_TABLES } from '@/lib/report-export';

/**
 * صفحة تحميل التقارير المحاسبية — المتاحة دائماً (حتى بعد انتهاء الاشتراك).
 *
 * السياسة المعتمدة:
 *  - العميل يحصل على تقارير محاسبية منسّقة لبيانات شركته (أسماء عربية واضحة،
 *    أسماء عملاء/مشاريع/حسابات بدل المعرّفات الخام، دون أي أعمدة تقنية أو
 *    بيانات حساسة) بصيغة Excel أو CSV — بنفس معايير البرامج المحاسبية.
 *  - لا توجد أي صيغة "نسخة قاعدة بيانات" ولا أي سبيل لاستعادة الملفات داخل
 *    المنصة؛ إعادة الإدخال تكون يدوياً فقط.
 */

type Format = 'csv' | 'excel';

export default function ExportDataPage() {
  const router = useRouter();
  const { user, isLoading, checkSession } = useAuthStore();
  const [selected, setSelected] = useState<string[]>([]);
  const [format, setFormat] = useState<Format>('excel');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [subscriptionExpired, setSubscriptionExpired] = useState(false);

  useEffect(() => { checkSession().catch(() => {}); }, [checkSession]);

  useEffect(() => {
    if (!isLoading && !user) router.replace('/login?redirect=/export-data');
  }, [isLoading, user, router]);

  // نعرف حالة الاشتراك لعرض زر العودة المناسب (تجديد مقابل لوحة التحكم).
  useEffect(() => {
    fetch('/api/auth/subscription-status')
      .then((r) => r.json())
      .then((d) => { if (d.success) setSubscriptionExpired(!!d.data?.is_expired); })
      .catch(() => {});
  }, []);

  if (isLoading) return <div className="min-h-screen bg-bg-primary flex items-center justify-center"><Loader2 className="animate-spin text-text-secondary" /></div>;
  if (!user) return null;

  const toggle = (t: string) => setSelected((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));
  const allSelected = selected.length === EXPORT_TABLES.length;

  const doExport = async () => {
    setBusy(true); setMessage('');
    const tables = selected.length ? selected : EXPORT_TABLES;
    try {
      const res = await fetch('/api/company/export-download', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tables, format }),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.message || 'فشل التصدير'); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `company-reports-${new Date().toISOString().slice(0, 10)}.${format === 'excel' ? 'xls' : format}`;
      a.click();
      URL.revokeObjectURL(url);
      setMessage('تم تنزيل ملف التقارير بنجاح.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'فشل التصدير');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-700 flex items-center justify-center">
            <FileBarChart className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold">تحميل تقارير بياناتك</h1>
            <p className="text-xs text-text-secondary">
              تقارير محاسبية منسّقة لبيانات شركتك (الفواتير، القيود، العملاء، المخزون،...) بأسماء واضحة وبصيغة Excel أو CSV —
              متاحة حتى بعد انتهاء الاشتراك، ولبيانات شركتك فقط.
            </p>
          </div>
        </div>

        <div className="bg-bg-card border border-border rounded-2xl p-5 mt-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-text-primary">اختر التقارير</h2>
            <button onClick={() => setSelected(allSelected ? [] : [...EXPORT_TABLES])} className="text-xs font-semibold text-amber-400 hover:text-amber-300 hover:underline">
              {allSelected ? 'إلغاء تحديد الكل' : 'تحديد الكل'}
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-72 overflow-y-auto p-1">
            {REPORTS.map((r) => (
              <label key={r.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs cursor-pointer transition-colors font-medium ${selected.includes(r.id) ? 'border-amber-500 bg-amber-500/20 text-amber-200' : 'border-border bg-bg-secondary text-text-secondary hover:text-text-primary'}`}>
                <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggle(r.id)} className="accent-amber-500" />
                {r.title}
              </label>
            ))}
          </div>
          <p className="mt-3 text-[0.7rem] text-text-secondary">
            كل تقرير يعرض أعمدة أعمال واضحة بأسماء عربية (اسم العميل والمشروع والحساب بدل المعرّفات، والحالات مترجمة) —
            ولا يتضمن أي بيانات حساسة أو معرفات تقنية.
          </p>
        </div>

        <div className="bg-bg-card border border-border rounded-2xl p-5 mt-4">
          <h2 className="text-sm font-bold text-text-primary mb-3">صيغة التصدير</h2>
          <div className="flex gap-2">
            {([['excel', FileSpreadsheet, 'Excel'], ['csv', FileText, 'CSV']] as const).map(([f, Icon, label]) => (
              <button key={f} onClick={() => setFormat(f)} className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-semibold transition-colors ${format === f ? 'border-amber-500 bg-amber-500/20 text-amber-200' : 'border-border bg-bg-secondary text-text-secondary hover:text-text-primary'}`}>
                <Icon size={16} /> {label}
              </button>
            ))}
          </div>
          <p className="mt-3 text-[0.7rem] text-text-secondary">صيغتا Excel وCSV هما المتاحتان فقط — وكلاهما مقبول في البرامج المحاسبية الأخرى عند الاستيراد.</p>
        </div>

        <button onClick={doExport} disabled={busy}
          className="w-full mt-5 flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-l from-emerald-600 to-teal-700 hover:from-emerald-500 hover:to-teal-600 disabled:opacity-50 text-white font-bold transition-all">
          {busy ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
          {busy ? 'جاري التصدير...' : 'تصدير التقارير'}
        </button>

        {message && (
          <div className="mt-3 text-center text-xs px-3 py-2 rounded-lg bg-bg-secondary border border-border text-text-primary font-medium">
            {message}
          </div>
        )}

        <div className="mt-6 space-y-2">
          <div className="flex items-center justify-center gap-2 text-[0.7rem] text-text-secondary">
            <ShieldCheck size={14} className="text-emerald-400" />
            بياناتك معزولة تماماً عن شركات أخرى — يشمل التصدير بيانات شركتك فقط.
          </div>
          <div className="flex items-center justify-center gap-2 text-[0.7rem] text-text-secondary">
            <Ban size={14} className="text-amber-400" />
            لا يمكن استعادة هذه الملفات داخل المنصة — أي إدخال للبيانات يتم يدوياً فقط.
          </div>
        </div>

        <button onClick={() => router.push(subscriptionExpired ? '/subscription?renew=1' : '/dashboard')} className="mt-4 mx-auto flex items-center gap-1 text-xs font-medium text-text-secondary hover:text-text-primary">
          <ArrowLeft size={14} /> {subscriptionExpired ? 'العودة لتجديد الاشتراك' : 'العودة للوحة التحكم'}
        </button>
      </div>
    </div>
  );
}
