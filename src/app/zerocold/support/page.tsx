'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ChevronLeft, Loader2 } from 'lucide-react';

export default function AdminSupport() {
  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'open'|'in_progress'|'resolved'|'closed'|'all'>('open');
  const [busy, setBusy] = useState<string|null>(null);

  const load = async () => {
    setLoading(true);
    const r = await fetch(`/api/admin/support?status=${filter}`);
    const j = await r.json();
    if (j.success) setTickets(j.data.tickets || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [filter]);

  const setStatus = async (id: string, status: string) => {
    setBusy(id);
    await fetch('/api/admin/support', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    setBusy(null);
    load();
  };

  const CATEGORIES: Record<string,string> = {
    billing: 'دفع/اشتراك', payment: 'دفع', technical: 'تقني', account: 'حساب', data_request: 'بيانات', other: 'أخرى',
  };

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/zerocold" className="p-2 rounded-lg hover:bg-bg-card"><ChevronLeft size={18} /></Link>
          <h1 className="text-xl font-bold">تذاكر الدعم</h1>
        </div>
        <div className="flex gap-2 mb-4 flex-wrap">
          {(['open','in_progress','resolved','closed','all'] as const).map(s => (
            <button key={s} onClick={()=>setFilter(s)} className={`px-3 py-1.5 rounded-lg text-xs ${filter===s?'bg-accent text-white':'bg-bg-secondary'}`}>
              {s==='open'?'مفتوحة':s==='in_progress'?'قيد المعالجة':s==='resolved'?'محلولة':s==='closed'?'مغلقة':'الكل'}
            </button>
          ))}
        </div>
        {loading ? <div className="flex justify-center py-20"><Loader2 className="animate-spin"/></div>
          : <div className="space-y-3">
            {tickets.length === 0 && <p className="text-center py-20 text-text-muted">لا توجد تذاكر</p>}
            {tickets.map(t => (
              <div key={t.id} className="bg-bg-card border border-border rounded-xl p-4">
                <div className="flex justify-between gap-3 flex-wrap">
                  <div>
                    <div className="font-bold flex items-center gap-2">
                      {t.subject}
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent/20 text-accent">{CATEGORIES[t.category]||t.category}</span>
                    </div>
                    <div className="text-xs text-text-muted mt-1">{t.companies?.name} · {t.users?.name} · {t.users?.email}</div>
                    <p className="text-sm mt-2 whitespace-pre-wrap">{t.message}</p>
                    {t.attachment_url && <a href={t.attachment_url} target="_blank" rel="noreferrer" className="text-xs text-accent underline block mt-2">مرفق</a>}
                    {t.admin_notes && <div className="mt-2 text-xs text-text-muted border-t border-border pt-2">ملاحظة داخلية: {t.admin_notes}</div>}
                    <div className="text-[10px] text-text-muted mt-1">{new Date(t.created_at).toLocaleString('ar-SA')}</div>
                  </div>
                  <div className="flex gap-2 flex-col">
                    <span className={`px-2 py-1 rounded text-xs w-fit ${t.status==='open'?'bg-warning-light text-warning font-semibold':t.status==='in_progress'?'bg-blue-900/30 text-blue-400':t.status==='resolved'?'bg-success-light text-success font-semibold':'bg-gray-800 text-gray-400'}`}>
                      {t.status==='open'?'مفتوحة':t.status==='in_progress'?'قيد المعالجة':t.status==='resolved'?'محلولة':'مغلقة'}
                    </span>
                    {t.status !== 'resolved' && t.status !== 'closed' && (
                      <>
                        <button disabled={busy===t.id} onClick={()=>setStatus(t.id,'in_progress')} className="px-3 py-1.5 rounded-lg bg-blue-700/30 text-blue-300 border border-blue-700/40 text-xs">بدء المعالجة</button>
                        <button disabled={busy===t.id} onClick={()=>setStatus(t.id,'resolved')} className="px-3 py-1.5 rounded-lg bg-green-700/30 text-green-300 border border-green-700/40 text-xs">تم الحل</button>
                        <button disabled={busy===t.id} onClick={()=>setStatus(t.id,'closed')} className="px-3 py-1.5 rounded-lg bg-gray-700/30 text-gray-300 border border-gray-700/40 text-xs">إغلاق</button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>}
      </div>
    </div>
  );
}
