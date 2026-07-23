'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Users, Loader2, ChevronLeft, Calendar, Ban, CreditCard, RefreshCw, X, Hash } from 'lucide-react';
import Link from 'next/link';

interface Subscription {
  id: string; company_id: string; company_name: string; plan_code: string; plan_name: string;
  status: string; start_date: string; end_date: string; auto_renew: boolean;
  subscriber_number?: number | null;
}

const statusLabels: Record<string, string> = { active: 'نشط', trial: 'تجريبي', expired: 'منتهي', cancelled: 'ملغي' };

export default function SubscriptionsPage() {
  const router = useRouter();
  const [data, setData] = useState<Subscription[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [showExtendModal, setShowExtendModal] = useState(false);
  const [selectedSub, setSelectedSub] = useState<Subscription | null>(null);
  const [planForm, setPlanForm] = useState({ plan_id: '', duration_days: 30, auto_renew: false });
  const [extendDays, setExtendDays] = useState(30);
  const [masterPassword, setMasterPassword] = useState('');

  const fetchData = async () => {
    setLoading(true);
    try {
      const [subRes, planRes] = await Promise.all([
        fetch('/api/admin/subscriptions'),
        fetch('/api/admin/subscription-plans'),
      ]);
      if (subRes.status === 401) { router.replace('/zerocold/login'); return; }
      const [subBody, planBody] = await Promise.all([subRes.json(), planRes.json()]);
      if (subBody.success) setData(subBody.data?.subscriptions || subBody.data || []);
      if (planBody.success) setPlans(planBody.data || []);
    } catch { setError('خطأ في الاتصال'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const doAction = async (sub: Subscription, action: string, extra: any = {}) => {
    setActionLoading(action + sub.id);
    try {
      const res = await fetch(`/api/admin/companies/${sub.company_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-master-password': masterPassword },
        body: JSON.stringify({ action, ...extra }),
      });
      const body = await res.json();
      if (body.success) {
        setShowPlanModal(false); setShowExtendModal(false); setMasterPassword('');
        fetchData();
        alert(body.message);
      } else alert(body.message || 'فشل');
    } catch { alert('خطأ في الاتصال'); }
    finally { setActionLoading(null); }
  };

  const openPlanModal = (sub: Subscription) => { setSelectedSub(sub); setPlanForm({ plan_id: '', duration_days: 30, auto_renew: false }); setShowPlanModal(true); };
  const openExtendModal = (sub: Subscription) => { setSelectedSub(sub); setExtendDays(30); setShowExtendModal(true); };

  const filtered = data.filter(s => !filter || s.status === filter);

  if (loading) return <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center"><Loader2 size={32} className="text-amber-500 animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Link href="/zerocold/" className="p-2 rounded-lg hover:bg-[#12101a]"><ChevronLeft size={18} className="text-amber-500/70" /></Link>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-600 to-fuchsia-700 flex items-center justify-center"><Users className="w-5 h-5 text-white" /></div>
            <div><h1 className="text-lg font-bold text-amber-50">الاشتراكات</h1><p className="text-[0.7rem] text-amber-400/50">{data.length} اشتراك</p></div>
          </div>
          <button onClick={fetchData} className="p-2 rounded-xl bg-[#12101a] border border-[#2a1f0a] text-amber-500/70"><RefreshCw size={16} /></button>
        </div>

        <div className="flex gap-2 mb-4">
          {['', 'active', 'trial', 'expired', 'cancelled'].map(s => (
            <button key={s} onClick={() => setFilter(s)} className={`px-3 py-1.5 rounded-xl text-xs transition-colors ${filter === s ? 'bg-amber-600 text-white' : 'bg-[#1a1625] border border-[#2a1f0a] text-amber-400/70'}`}>
              {s ? statusLabels[s] : 'الكل'}
            </button>
          ))}
        </div>

        {error && <div className="bg-red-950/40 border border-red-800/40 text-red-400 text-sm rounded-xl px-4 py-2.5 text-center mb-4">{error}</div>}

        {filtered.length === 0 ? (
          <div className="bg-[#12101a] border border-[#2a1f0a] rounded-xl p-8 text-center"><Users size={32} className="text-amber-600/30 mx-auto mb-2" /><p className="text-amber-600/50 text-sm">لا توجد اشتراكات</p></div>
        ) : (
          <div className="space-y-3">
            {filtered.map(sub => (
              <div key={sub.id} className="bg-[#12101a] border border-[#2a1f0a] rounded-2xl p-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-900/30 flex items-center justify-center"><Users size={18} className="text-amber-400" /></div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-amber-50 font-medium">{sub.company_name}</h3>
                        {sub.subscriber_number && <span className="flex items-center gap-1 text-xs px-2 py-0.5 bg-amber-900/30 text-amber-400 rounded font-mono"><Hash size={10} />{sub.subscriber_number}</span>}
                      </div>
                      <p className="text-amber-400/50 text-xs">{sub.plan_name || sub.plan_code}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-amber-400/70 text-xs" dir="ltr">{sub.start_date} → {sub.end_date}</span>
                    <span className={`px-2 py-1 rounded-lg text-xs font-medium ${
                      sub.status === 'active' ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-800/30' :
                      sub.status === 'trial' ? 'bg-blue-950/40 text-blue-400 border border-blue-800/30' :
                      sub.status === 'expired' ? 'bg-red-950/40 text-red-400 border border-red-800/30' :
                      'bg-gray-800 text-gray-400'
                    }`}>{statusLabels[sub.status] || sub.status}</span>
                    <span className={`text-xs ${sub.auto_renew ? 'text-green-400' : 'text-amber-600'}`}>{sub.auto_renew ? 'تلقائي' : 'يدوي'}</span>
                  </div>
                </div>
                {/* Action buttons */}
                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[#2a1f0a]">
                  <button onClick={() => openPlanModal(sub)} disabled={actionLoading === 'change_plan' + sub.id} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-purple-950/20 text-purple-400/70 border border-purple-800/20 hover:bg-purple-950/40 text-xs">
                    {actionLoading === 'change_plan' + sub.id ? <Loader2 size={12} className="animate-spin" /> : <CreditCard size={12} />} تغيير الباقة
                  </button>
                  <button onClick={() => openExtendModal(sub)} disabled={actionLoading === 'extend_subscription' + sub.id} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-950/20 text-emerald-400/70 border border-emerald-800/20 hover:bg-emerald-950/40 text-xs">
                    {actionLoading === 'extend_subscription' + sub.id ? <Loader2 size={12} className="animate-spin" /> : <Calendar size={12} />} تمديد
                  </button>
                  <button onClick={() => { if (confirm('إلغاء الاشتراك؟')) { const mp = prompt('كلمة السر الرئيسية:'); if (mp) { setMasterPassword(mp); doAction(sub, 'cancel_subscription'); } } }} disabled={actionLoading === 'cancel_subscription' + sub.id} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-950/20 text-red-400/70 border border-red-800/20 hover:bg-red-950/40 text-xs">
                    {actionLoading === 'cancel_subscription' + sub.id ? <Loader2 size={12} className="animate-spin" /> : <Ban size={12} />} إلغاء
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Change Plan Modal */}
        {showPlanModal && selectedSub && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowPlanModal(false)}>
            <div className="bg-[#12101a] border border-[#2a1f0a] rounded-2xl max-w-md w-full" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-4 border-b border-[#2a1f0a]">
                <h3 className="font-bold text-amber-50">تغيير باقة: {selectedSub.company_name}</h3>
                <button onClick={() => setShowPlanModal(false)} className="text-amber-500/50"><X size={18} /></button>
              </div>
              <div className="p-4 space-y-3">
                <select className="w-full bg-[#0a0a0f] border border-[#2a1f0a] rounded-lg px-3 py-2 text-sm text-amber-50 focus:outline-none focus:border-amber-600" value={planForm.plan_id} onChange={e => setPlanForm({ ...planForm, plan_id: e.target.value })}>
                  <option value="">— اختر الباقة —</option>
                  {plans.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <input type="number" className="w-full bg-[#0a0a0f] border border-[#2a1f0a] rounded-lg px-3 py-2 text-sm text-amber-50" placeholder="عدد الأيام" value={planForm.duration_days} onChange={e => setPlanForm({ ...planForm, duration_days: parseInt(e.target.value) || 30 })} />
                <label className="flex items-center gap-2 text-sm text-amber-200"><input type="checkbox" checked={planForm.auto_renew} onChange={e => setPlanForm({ ...planForm, auto_renew: e.target.checked })} /> تجديد تلقائي</label>
                <input className="w-full bg-[#0a0a0f] border border-[#2a1f0a] rounded-lg px-3 py-2 text-sm text-amber-50" type="password" placeholder="كلمة السر الرئيسية" value={masterPassword} onChange={e => setMasterPassword(e.target.value)} />
                <button onClick={() => doAction(selectedSub, 'change_plan', planForm)} disabled={!masterPassword || !planForm.plan_id} className="w-full py-2.5 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-500 disabled:opacity-50">تغيير الباقة</button>
              </div>
            </div>
          </div>
        )}

        {/* Extend Modal */}
        {showExtendModal && selectedSub && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowExtendModal(false)}>
            <div className="bg-[#12101a] border border-[#2a1f0a] rounded-2xl max-w-md w-full" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-4 border-b border-[#2a1f0a]">
                <h3 className="font-bold text-amber-50">تمديد اشتراك: {selectedSub.company_name}</h3>
                <button onClick={() => setShowExtendModal(false)} className="text-amber-500/50"><X size={18} /></button>
              </div>
              <div className="p-4 space-y-3">
                <input type="number" className="w-full bg-[#0a0a0f] border border-[#2a1f0a] rounded-lg px-3 py-2 text-sm text-amber-50" placeholder="عدد الأيام" value={extendDays} onChange={e => setExtendDays(parseInt(e.target.value) || 30)} />
                <input className="w-full bg-[#0a0a0f] border border-[#2a1f0a] rounded-lg px-3 py-2 text-sm text-amber-50" type="password" placeholder="كلمة السر الرئيسية" value={masterPassword} onChange={e => setMasterPassword(e.target.value)} />
                <button onClick={() => doAction(selectedSub, 'extend_subscription', { days: extendDays })} disabled={!masterPassword} className="w-full py-2.5 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-500 disabled:opacity-50">تمديد الاشتراك</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
