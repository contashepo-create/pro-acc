'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Loader2, Check, X, DollarSign, Image as ImageIcon, Calendar, RefreshCw } from 'lucide-react';
import Link from 'next/link';

interface UpgradeRequest {
  id: string;
  company_id: string;
  requested_plan_id: string;
  duration_type: string;
  status: string;
  payment_method_code: string;
  payment_amount: number;
  payment_date: string;
  payment_time: string;
  receipt_image_url: string;
  notes: string;
  created_at: string;
  companies: { name: string; email: string; phone: string };
  subscription_plans: { name: string; code: string };
  users: { name: string; email: string };
}

export default function UpgradeRequestsPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<UpgradeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('pending');
  const [processing, setProcessing] = useState<string | null>(null);

  const fetchRequests = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/upgrade-requests?status=${filter}`);
      if (res.status === 401) { router.replace('/zerocold/login'); return; }
      const data = await res.json();
      if (data.success) setRequests(data.data.requests || []);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const handleAction = async (id: string, status: 'approved' | 'rejected', notes?: string) => {
    setProcessing(id);
    try {
      const res = await fetch('/api/admin/upgrade-requests', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status, admin_notes: notes }),
      });
      const data = await res.json();
      if (data.success) fetchRequests();
      else alert(data.message);
    } catch {
      alert('حدث خطأ');
    } finally { setProcessing(null); }
  };

  if (loading) return <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center"><Loader2 className="animate-spin text-amber-500" size={32} /></div>;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-amber-50">
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Link href="/zerocold/"><ChevronLeft size={18} className="text-amber-500/70" /></Link>
            <h1 className="text-lg font-bold">طلبات الترقية والدفع</h1>
            <span className="text-xs bg-amber-950/50 px-2 py-1 rounded-full">{requests.length}</span>
          </div>
          <div className="flex gap-2">
            <select value={filter} onChange={(e) => setFilter(e.target.value)} className="px-3 py-2 bg-[#12101a] border border-[#2a1f0a] rounded-xl text-sm">
              <option value="pending">معلق</option>
              <option value="approved">مقبول</option>
              <option value="rejected">مرفوض</option>
              <option value="all">الكل</option>
            </select>
            <button onClick={fetchRequests} className="p-2 bg-[#12101a] border border-[#2a1f0a] rounded-xl"><RefreshCw size={16} /></button>
          </div>
        </div>

        <div className="space-y-4">
          {requests.length === 0 ? (
            <div className="bg-[#12101a] border border-[#2a1f0a] rounded-2xl p-12 text-center text-amber-600/50">لا توجد طلبات {filter === 'pending' ? 'معلقة' : ''}</div>
          ) : requests.map((req) => (
            <div key={req.id} className="bg-[#12101a] border border-[#2a1f0a] rounded-2xl p-5">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-bold">{req.companies?.name || 'شركة'} - {req.subscription_plans?.name || req.requested_plan_id}</h3>
                  <p className="text-xs text-amber-400/60">{req.users?.name} ({req.users?.email}) - {req.companies?.phone}</p>
                  <div className="flex gap-2 mt-2 text-xs">
                    <span className="bg-[#1a1625] px-2 py-1 rounded">المدة: {req.duration_type === 'yearly' ? 'سنوي' : 'شهري'}</span>
                    <span className="bg-[#1a1625] px-2 py-1 rounded">الدفع: {req.payment_method_code}</span>
                    <span className={`px-2 py-1 rounded ${req.status === 'pending' ? 'bg-yellow-900/30 text-yellow-400' : req.status === 'approved' ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>{req.status}</span>
                  </div>
                </div>
                <div className="text-left text-xs text-amber-400/50">
                  <div className="flex items-center gap-1"><Calendar size={12} /> {new Date(req.created_at).toLocaleDateString('ar-EG')}</div>
                  <div className="flex items-center gap-1 mt-1"><DollarSign size={12} /> {req.payment_amount} ر.س</div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 text-sm bg-[#0a0a0f] rounded-xl p-3">
                <div>تاريخ التحويل: {req.payment_date} {req.payment_time}</div>
                <div>المبلغ: {req.payment_amount}</div>
                <div className="col-span-2">ملاحظات: {req.notes || 'لا يوجد'}</div>
                {req.receipt_image_url && (
                  <div className="col-span-2 flex items-center gap-2">
                    <ImageIcon size={14} />
                    <a href={req.receipt_image_url} target="_blank" className="text-amber-400 underline text-xs">عرض صورة الإيصال</a>
                  </div>
                )}
              </div>

              {req.status === 'pending' && (
                <div className="flex gap-2 mt-4">
                  <button disabled={!!processing} onClick={() => handleAction(req.id, 'approved')} className="flex-1 py-2.5 bg-green-700 hover:bg-green-600 text-white rounded-xl text-sm flex items-center justify-center gap-2 disabled:opacity-50">
                    {processing === req.id ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} قبول وترقية
                  </button>
                  <button disabled={!!processing} onClick={() => { const reason = prompt('سبب الرفض:'); if (reason !== null) handleAction(req.id, 'rejected', reason); }} className="flex-1 py-2.5 bg-red-900/50 hover:bg-red-900/80 text-red-300 rounded-xl text-sm flex items-center justify-center gap-2">
                    <X size={16} /> رفض
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
