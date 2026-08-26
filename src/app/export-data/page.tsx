'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Download, FileSpreadsheet, FileText, Printer, Loader2, ShieldCheck, ArrowLeft } from 'lucide-react';
import { useAuthStore } from '@/store/auth-store';

const EXPORT_TABLES = [
  'accounts', 'journal_entries', 'journal_lines', 'clients', 'contacts',
  'invoices', 'invoice_items', 'quotations', 'quotation_items',
  'purchase_invoices', 'custodies', 'custody_transactions',
  'employees', 'employee_advances', 'projects', 'project_expenses',
  'fixed_assets', 'inventory', 'inventory_transactions', 'warehouses',
  'branches', 'banks', 'cash_transactions', 'bonds', 'vouchers',
  'budgets', 'cost_centers', 'notifications', 'settings', 'tax_returns',
];

const ARABIC: Record<string, string> = {
  accounts: 'الحسابات', journal_entries: 'القيود', journal_lines: 'تفاصيل القيود',
  clients: 'العملاء', contacts: 'جهات الاتصال', invoices: 'الفواتير',
  invoice_items: 'بنود الفواتير', quotations: 'عروض الأسعار', quotation_items: 'بنود عروض الأسعار',
  purchase_invoices: 'فواتير المشتريات', custodies: 'العهد', custody_transactions: 'حركات العهد',
  employees: 'الموظفون', employee_advances: 'سلف الموظفين', projects: 'المشاريع', project_expenses: 'مصروفات المشاريع',
  fixed_assets: 'الأصول الثابتة', inventory: 'المخزون', inventory_transactions: 'حركات المخزون', warehouses: 'المستودعات',
  branches: 'الفروع', banks: 'البنوك', cash_transactions: 'حركات النقدية', bonds: 'السندات', vouchers: 'الإيصالات',
  budgets: 'الميزانيات', cost_centers: 'مراكز التكلفة', notifications: 'الإشعارات', settings: 'الإعدادات', tax_returns: 'الإقرارات الضريبية',
};

type Format = 'csv' | 'excel' | 'pdf';

export default function ExportDataPage() {
  const router = useRouter();
  const { user, isLoading, checkSession } = useAuthStore();
  const [selected, setSelected] = useState<string[]>([]);
  const [format, setFormat] = useState<Format>('csv');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => { checkSession().catch(() => {}); }, [checkSession]);

  useEffect(() => {
    if (!isLoading && !user) router.replace('/login?redirect=/export-data');
  }, [isLoading, user, router]);

  if (isLoading) return <div className="min-h-screen bg-bg-primary flex items-center justify-center"><Loader2 className="animate-spin text-text-secondary" /></div>;
  if (!user) return null;

  const toggle = (t: string) => setSelected((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));
  const allSelected = selected.length === EXPORT_TABLES.length;

  const doExport = async () => {
    setBusy(true); setMessage('');
    const tables = selected.length ? selected : EXPORT_TABLES;
    try {
      if (format === 'pdf') {
        const res = await fetch('/api/company/export-download', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tables, format: 'json' }),
        });
        const blob = await res.blob();
        const bundle = JSON.parse(await blob.text());
        openPdfWindow(bundle);
        setMessage('تم تجهيز نافذة الطباعة — اختر "حفظ كـ PDF".');
      } else {
        const res = await fetch('/api/company/export-download', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tables, format }),
        });
        if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.message || 'فشل التصدير'); }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `company-export-${new Date().toISOString().slice(0, 10)}.${format === 'excel' ? 'xls' : format}`;
        a.click();
        URL.revokeObjectURL(url);
        setMessage('تم تنزيل الملف بنجاح.');
      }
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
            <Download className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold">تصدير بيانات الشركة</h1>
            <p className="text-xs text-text-muted">صدّر بيانات شركتك كاملةً أو جدولاً بجدول بصيغة Excel / PDF / CSV — متاح حتى بعد انتهاء الاشتراك.</p>
          </div>
        </div>

        <div className="bg-bg-card border border-border rounded-2xl p-5 mt-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-amber-300/80">اختر الجداول</h2>
            <button onClick={() => setSelected(allSelected ? [] : EXPORT_TABLES)} className="text-xs text-amber-400 hover:underline">
              {allSelected ? 'إلغاء تحديد الكل' : 'تحديد الكل'}
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-72 overflow-y-auto p-1">
            {EXPORT_TABLES.map((t) => (
              <label key={t} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs cursor-pointer transition-colors ${selected.includes(t) ? 'border-amber-600 bg-amber-950/20 text-amber-300' : 'border-border bg-bg-secondary text-text-secondary'}`}>
                <input type="checkbox" checked={selected.includes(t)} onChange={() => toggle(t)} className="accent-amber-600" />
                {ARABIC[t] || t}
              </label>
            ))}
          </div>
        </div>

        <div className="bg-bg-card border border-border rounded-2xl p-5 mt-4">
          <h2 className="text-sm font-bold text-amber-300/80 mb-3">صيغة التصدير</h2>
          <div className="flex gap-2">
            {([['excel', FileSpreadsheet, 'Excel'], ['pdf', FileText, 'PDF'], ['csv', FileText, 'CSV']] as const).map(([f, Icon, label]) => (
              <button key={f} onClick={() => setFormat(f)} className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm transition-colors ${format === f ? 'border-amber-600 bg-amber-950/20 text-amber-300' : 'border-border bg-bg-secondary text-text-secondary'}`}>
                <Icon size={16} /> {label}
              </button>
            ))}
          </div>
        </div>

        <button onClick={doExport} disabled={busy}
          className="w-full mt-5 flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-l from-emerald-600 to-teal-700 hover:from-emerald-500 hover:to-teal-600 disabled:opacity-50 text-white font-semibold transition-all">
          {busy ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
          {busy ? 'جاري التصدير...' : 'تصدير البيانات'}
        </button>

        {message && (
          <div className="mt-3 text-center text-xs px-3 py-2 rounded-lg bg-bg-secondary border border-border text-text-secondary">
            {message}
          </div>
        )}

        <div className="mt-6 flex items-center justify-center gap-2 text-[0.7rem] text-text-muted">
          <ShieldCheck size={14} className="text-emerald-400" />
          بياناتك معزولة تماماً عن شركات أخرى — يشمل التصدير بيانات شركتك فقط.
        </div>

        <button onClick={() => router.push('/dashboard')} className="mt-4 mx-auto flex items-center gap-1 text-xs text-text-secondary hover:text-amber-400">
          <ArrowLeft size={14} /> العودة للوحة التحكم
        </button>
      </div>
    </div>
  );
}

function openPdfWindow(bundle: Record<string, Record<string, unknown>[]>) {
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) return;
  const rows = (arr: Record<string, unknown>[]) =>
    arr.length
      ? `<tr>${Object.keys(arr[0]).map((h) => `<th style="border:1px solid #999;padding:4px;background:#eee">${esc(h)}</th>`).join('')}</tr>` +
        arr.map((r) => `<tr>${Object.keys(arr[0]).map((h) => `<td style="border:1px solid #ccc;padding:4px">${esc(r[h])}</td>`).join('')}</tr>`).join('')
      : '<tr><td>—</td></tr>';
  const html = Object.entries(bundle).map(([t, arr]) =>
    `<h3 style="margin-top:16px">${ARABIC[t] || t} (${arr.length})</h3><table style="border-collapse:collapse;width:100%;font-size:11px">${rows(arr)}</table>`
  ).join('<hr/>');
  w.document.write(`<html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>تصدير البيانات</title></head><body>${html}<script>window.onload=()=>window.print()</script></body></html>`);
  w.document.close();
}

function esc(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
