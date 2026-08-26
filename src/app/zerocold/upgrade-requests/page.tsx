'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Loader2, Check, X, DollarSign, Image as ImageIcon, Calendar, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { MasterPasswordModal } from '@/components/ui/MasterPasswordModal';

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
  const [rejectTarget, setRejectTarget] = useState<{ id: string; name: string } | null>(null);

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

  const handleAction = async (id: string, status: 'approved' | 'rejected', notes?: string, password?: string) => {
    setProcessing(id);
    try {
      const res = await fetch('/api/admin/upgrade-requests', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(password ? { 'x-master-password': password } : {}) },
        body: JSON.stringify({ id, status, admin_notes: notes }),
      });
      const data = await res.json();
      if (data.success) fetchRequests();
      else alert(data.message);
    } catch {
      alert('حدث خطأ');
    } finally { setProcessing(null); }
  };

  if (loading) return <div className="min-h-screen bg-bg-primary flex items-center justify-center"><Loader2 className="animate-spin text-text-secondary" size={32} /></div>;

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Link href="/zerocold/"><ChevronLeft size={18} className="text-text-secondary hover:text-accent transition-colors" /></Link>
            <h1 className="text-lg font-bold">طلبات الترقية والدفع</h1>
            <span className="text-xs bg-accent/10 border border-accent/20 text-accent font-semibold px-2.5 py-0.5 rounded-full">{requests.length}</span>
          </div>
          <div className="flex gap-2">
            <select value={filter} onChange={(e) => setFilter(e.target.value)} className="px-3 py-2 bg-bg-card border border-border rounded-xl text-sm text-text-primary focus:outline-none focus:border-accent">
              <option value="pending">معلق</option>
              <option value="approved">مقبول</option>
              <option value="rejected">مرفوض</option>
              <option value="all">الكل</option>
            </select>
            <button onClick={fetchRequests} className="p-2 bg-bg-card border border-border rounded-xl text-text-secondary hover:text-accent transition-colors"><RefreshCw size={16} /></button>
          </div>
        </div>

        <div className="space-y-4">
          {requests.length === 0 ? (
            <div className="bg-bg-card border border-border rounded-2xl p-12 text-center text-text-muted">لا توجد طلبات {filter === 'pending' ? 'معلقة' : ''}</div>
          ) : requests.map((req) => (
            <div key={req.id} className="bg-bg-card border border-border rounded-2xl p-5">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-bold">{req.companies?.name || 'شركة'} - {req.subscription_plans?.name || req.requested_plan_id}</h3>
                  <p className="text-xs text-text-secondary">{req.users?.name} ({req.users?.email}) - {req.companies?.phone}</p>
                  <div className="flex gap-2 mt-2 text-xs">
                    <span className="bg-bg-secondary px-2 py-1 rounded text-text-secondary">المدة: {req.duration_type === 'yearly' ? 'سنوي' : 'شهري'}</span>
                    <span className="bg-bg-secondary px-2 py-1 rounded text-text-secondary">الدفع: {req.payment_method_code}</span>
                    <span className={`px-2 py-1 rounded ${req.status === 'pending' ? 'bg-warning-light text-warning font-semibold' : req.status === 'approved' ? 'bg-success-light text-success font-semibold' : 'bg-danger-light text-danger font-semibold'}`}>{req.status}</span>
                  </div>
                </div>
                <div className="text-left text-xs text-text-muted">
                  <div className="flex items-center gap-1"><Calendar size={12} /> {new Date(req.created_at).toLocaleDateString('ar-EG')}</div>
                  <div className="flex items-center gap-1 mt-1"><DollarSign size={12} /> {req.payment_amount} ر.س</div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm bg-bg-secondary rounded-xl p-3 border border-border">
                <div>تاريخ التحويل: {req.payment_date} {req.payment_time}</div>
                <div>المبلغ: {req.payment_amount}</div>
                <div className="col-span-2">ملاحظات: {req.notes || 'لا يوجد'}</div>
                {req.receipt_image_url && (
                  <div className="col-span-2 flex items-center gap-2">
                    <ImageIcon size={14} className="text-accent" />
                    <a href={req.receipt_image_url} target="_blank" className="text-accent hover:underline text-xs font-semibold">عرض صورة الإيصال</a>
                  </div>
                )}
              </div>

              {req.status === 'pending' && (
                <div className="flex gap-2 mt-4">
                  <button disabled={!!processing} onClick={() => handleAction(req.id, 'approved')} className="flex-1 py-2.5 bg-green-700 hover:bg-green-600 text-white rounded-xl text-sm flex items-center justify-center gap-2 disabled:opacity-50 transition-colors">
                    {processing === req.id ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} قبول وترقية
                  </button>
                  <button disabled={!!processing} onClick={() => setRejectTarget({ id: req.id, name: req.companies?.name || 'الشركة' })} className="flex-1 py-2.5 bg-danger-light hover:bg-danger hover:text-white text-danger border border-danger rounded-xl text-sm flex items-center justify-center gap-2 transition-colors">
                    <X size={16} /> رفض
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {rejectTarget && (
        <MasterPasswordModal
          isOpen={true}
          title={`رفض طلب: ${rejectTarget.name}`}
          submitLabel="تأكيد الرفض"
          submitClassName="bg-red-600 hover:bg-red-500"
          extraLabel="سبب الرفض (مطلوب)"
          extraRequired
          onCancel={() => setRejectTarget(null)}
          onSubmit={(mp: string, reason?: string) => (reason ? handleAction(rejectTarget.id, 'rejected', reason, mp).then(() => setRejectTarget(null)) : Promise.resolve())}
        />
      )}
    </div>
  );
}
