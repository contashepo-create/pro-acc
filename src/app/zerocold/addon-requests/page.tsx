'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ChevronLeft, Check, X, Loader2 } from 'lucide-react';

interface AddonRequest {
  id: string;
  addon_type: 'extra_user'|'extra_branch'|'storage_gb';
  quantity: number;
  duration_type: 'monthly'|'yearly';
  total_amount_usd: number;
  payment_method_code: string;
  payment_amount: number | null;
  receipt_image_url: string | null;
  subscriber_number?: string | null;
  notes: string | null;
  status: 'pending'|'approved'|'rejected'|'cancelled';
  created_at: string;
  companies: { id: string; name: string; email: string; phone: string | null };
  users: { id: string; name: string; email: string };
}

const LABELS: Record<string,string> = {
  extra_user: 'مستخدم إضافي',
  extra_branch: 'فرع/مستودع إضافي',
  storage_gb: '1 جيجا تخزين',
};

export default function AdminAddonRequests() {
  const [requests, setRequests] = useState<AddonRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'pending'|'approved'|'rejected'|'all'>('pending');
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string,string>>({});

  const load = async () => {
    setLoading(true);
    const r = await fetch(`/api/admin/addon-requests?status=${filter}`);
    const j = await r.json();
    if (j.success) setRequests(j.data.requests || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [filter]);

  const review = async (id: string, status: 'approved'|'rejected') => {
    setBusy(id);
    await fetch('/api/admin/addon-requests', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status, admin_notes: notes[id] || '' }),
    });
    setBusy(null);
    load();
  };

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/zerocold" className="p-2 rounded-lg hover:bg-bg-card"><ChevronLeft size={18} /></Link>
          <h1 className="text-xl font-bold">طلبات الإضافات</h1>
        </div>

        <div className="flex gap-2 mb-4">
          {(['pending','approved','rejected','all'] as const).map(s => (
            <button key={s} onClick={() => setFilter(s)} className={`px-3 py-1.5 rounded-lg text-xs ${filter===s?'bg-accent text-white':'bg-bg-secondary'}`}>
              {s==='pending'?'معلقة':s==='approved'?'مقبولة':s==='rejected'?'مرفوضة':'الكل'}
            </button>
          ))}
        </div>

        {loading ? <div className="flex justify-center py-20"><Loader2 className="animate-spin" /></div> :
        <div className="space-y-3">
          {requests.length === 0 && <p className="text-center text-text-muted py-20">لا توجد طلبات</p>}
          {requests.map(r => (
            <div key={r.id} className="bg-bg-card border border-border rounded-xl p-4">
              <div className="flex justify-between items-start gap-4 flex-wrap">
                <div>
                  <div className="font-bold">{LABELS[r.addon_type] || r.addon_type} × {r.quantity} — {r.duration_type === 'yearly' ? 'سنوي' : 'شهري'}</div>
                  <div className="text-xs text-text-muted mt-1">
                    {r.companies?.name} · {r.users?.name} · {r.companies?.email}
                    {r.companies?.phone ? ` · ${r.companies.phone}` : ''}
                  </div>
                  <div className="text-xs mt-1">
                    طريقة الدفع: <strong>{r.payment_method_code}</strong> ·
                    المبلغ: <strong>${r.total_amount_usd}</strong> · محول: ${r.payment_amount ?? '—'}
                    {r.subscriber_number && (
                      <> · رقم المشترك: <strong className="font-mono text-accent" dir="ltr">#{r.subscriber_number}</strong></>
                    )}
                  </div>
                  {/* الإيصالات تصل على تليجرام — يطابقها المطور برقم المشترك */}
                  {r.receipt_image_url
                    ? <a href={r.receipt_image_url} target="_blank" rel="noreferrer" className="text-xs text-accent underline block mt-1">عرض الإيصال (سجل قديم)</a>
                    : <span className="inline-flex items-center gap-1 text-xs text-[#229ED9] mt-1">الإيصال عبر تليجرام — طابقه مع رقم المشترك</span>}
                  {r.notes && <div className="text-xs text-text-muted mt-1">ملاحظات: {r.notes}</div>}
                  <div className="text-[10px] text-text-muted mt-1">{new Date(r.created_at).toLocaleString('ar-SA')}</div>
                </div>
                <div className="flex flex-col gap-2">
                  <span className={`px-2 py-1 rounded text-xs w-fit ${r.status==='pending'?'bg-warning-light text-warning font-semibold':r.status==='approved'?'bg-success-light text-success font-semibold':'bg-danger-light text-danger font-semibold'}`}>
                    {r.status==='pending'?'معلق':r.status==='approved'?'مقبول':'مرفوض'}
                  </span>
                  {r.status === 'pending' && (
                    <>
                      <input placeholder="ملاحظات داخلية (اختياري)" value={notes[r.id]||''} onChange={e=>setNotes({...notes,[r.id]:e.target.value})} className="text-xs px-2 py-1 bg-bg-secondary border rounded w-48" />
                      <div className="flex gap-2">
                        <button onClick={()=>review(r.id,'approved')} disabled={busy===r.id} className="px-3 py-1.5 rounded-lg bg-green-600 text-white text-xs flex items-center gap-1"><Check size={14}/> قبول وتفعيل</button>
                        <button onClick={()=>review(r.id,'rejected')} disabled={busy===r.id} className="px-3 py-1.5 rounded-lg bg-red-600/20 text-red-400 border border-red-800/30 text-xs flex items-center gap-1"><X size={14}/> رفض</button>
                      </div>
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
