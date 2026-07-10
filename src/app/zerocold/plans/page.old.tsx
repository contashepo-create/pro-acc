'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Package, Plus, Loader2, Check, X, ChevronLeft, RefreshCw, ShieldAlert } from 'lucide-react';
import Link from 'next/link';

interface Plan {
  id: string; code: string; name: string; description: string;
  price_monthly: number; price_yearly: number; max_users: number;
  max_projects: number; is_active: boolean; sort_order: number;
}

export default function PlansPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', description: '', price_monthly: 0, price_yearly: 0, max_users: 1, max_projects: 0 });
  const [saving, setSaving] = useState(false);

  const fetchPlans = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/subscription-plans');
      if (res.status === 401) { router.replace('/zerocold/login'); return; }
      const body = await res.json();
      if (body.success) setPlans(body.data?.plans ?? (Array.isArray(body.data) ? body.data : []));
      else setError(body.message || 'حدث خطأ');
    } catch {
      setError('حدث خطأ في الاتصال بالخادم');
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchPlans(); }, []);

  const savePlan = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/subscription-plans', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (body.success) { setShowForm(false); fetchPlans(); setForm({ code: '', name: '', description: '', price_monthly: 0, price_yearly: 0, max_users: 1, max_projects: 0 }); }
    } finally { setSaving(false); }
  };

  const toggleActive = async (plan: Plan) => {
    await fetch(`/api/admin/subscription-plans/${plan.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !plan.is_active }),
    });
    fetchPlans();
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
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Link href="/zerocold/" className="p-2 rounded-lg hover:bg-[#12101a] transition-all">
              <ChevronLeft size={18} className="text-amber-500/70" />
            </Link>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-600 to-orange-700 flex items-center justify-center">
              <Package className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-amber-50">خطط الاشتراك</h1>
              <p className="text-[0.7rem] text-amber-400/50">{plans.length} خطة</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowForm(true)} className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-sm flex items-center gap-2 transition-colors">
              <Plus size={16} />إضافة خطة
            </button>
            <button onClick={fetchPlans} className="p-2 rounded-xl bg-[#12101a] border border-[#2a1f0a] text-amber-500/70 hover:text-amber-400 transition-all" title="تحديث">
              <RefreshCw size={16} />
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-950/40 border border-red-800/40 text-red-400 text-sm rounded-xl px-4 py-2.5 text-center mb-4">
            {error}
          </div>
        )}

        <div className="grid gap-4">
          {plans.length === 0 ? (
            <div className="bg-[#12101a] border border-[#2a1f0a] rounded-xl p-8 text-center">
              <Package size={32} className="text-amber-600/30 mx-auto mb-2" />
              <p className="text-amber-600/50 text-sm">لا توجد خطط اشتراك</p>
            </div>
          ) : plans.map((plan) => (
            <div key={plan.id} className="bg-[#12101a] border border-[#2a1f0a] rounded-2xl p-5">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-amber-50 font-bold text-lg">{plan.name}</h3>
                  <code className="text-xs text-amber-600 bg-amber-950/30 px-2 py-0.5 rounded">{plan.code}</code>
                  <p className="text-amber-400/50 text-sm mt-1">{plan.description}</p>
                </div>
                <button onClick={() => toggleActive(plan)} className={`p-2 rounded-lg transition-colors ${plan.is_active ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>
                  {plan.is_active ? <Check size={16} /> : <X size={16} />}
                </button>
              </div>
              <div className="flex flex-wrap gap-4 mt-4 text-sm">
                <span className="text-amber-300/80">شهرياً: <strong className="text-amber-50">{plan.price_monthly} ريال</strong></span>
                <span className="text-amber-300/80">سنوياً: <strong className="text-amber-50">{plan.price_yearly || plan.price_monthly * 12} ريال</strong></span>
                <span className="text-amber-300/80">المستخدمون: <strong className="text-amber-50">{plan.max_users}</strong></span>
                <span className="text-amber-300/80">المشاريع: <strong className="text-amber-50">{plan.max_projects || 'غير محدود'}</strong></span>
              </div>
            </div>
          ))}
        </div>

        {showForm && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowForm(false)}>
            <div className="bg-[#12101a] border border-[#2a1f0a] rounded-2xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
              <h2 className="text-lg font-bold text-amber-50 mb-4">إضافة خطة جديدة</h2>
              <div className="space-y-3">
                <input placeholder="الكود (مثال: premium)" value={form.code} onChange={(e) => setForm({...form, code: e.target.value})} className="w-full px-4 py-2.5 bg-[#1a1625] border border-[#2a1f0a] rounded-xl text-amber-50 text-sm" />
                <input placeholder="اسم الخطة" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} className="w-full px-4 py-2.5 bg-[#1a1625] border border-[#2a1f0a] rounded-xl text-amber-50 text-sm" />
                <input placeholder="الوصف" value={form.description} onChange={(e) => setForm({...form, description: e.target.value})} className="w-full px-4 py-2.5 bg-[#1a1625] border border-[#2a1f0a] rounded-xl text-amber-50 text-sm" />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input type="number" placeholder="السعر شهرياً" value={form.price_monthly} onChange={(e) => setForm({...form, price_monthly: Number(e.target.value)})} className="w-full px-4 py-2.5 bg-[#1a1625] border border-[#2a1f0a] rounded-xl text-amber-50 text-sm" />
                  <input type="number" placeholder="السعر سنوياً" value={form.price_yearly} onChange={(e) => setForm({...form, price_yearly: Number(e.target.value)})} className="w-full px-4 py-2.5 bg-[#1a1625] border border-[#2a1f0a] rounded-xl text-amber-50 text-sm" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input type="number" placeholder="أقصى عدد مستخدمين" value={form.max_users} onChange={(e) => setForm({...form, max_users: Number(e.target.value)})} className="w-full px-4 py-2.5 bg-[#1a1625] border border-[#2a1f0a] rounded-xl text-amber-50 text-sm" />
                  <input type="number" placeholder="أقصى عدد مشاريع (0 = غير محدود)" value={form.max_projects} onChange={(e) => setForm({...form, max_projects: Number(e.target.value)})} className="w-full px-4 py-2.5 bg-[#1a1625] border border-[#2a1f0a] rounded-xl text-amber-50 text-sm" />
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button onClick={() => setShowForm(false)} className="flex-1 py-2.5 bg-[#1a1625] border border-[#2a1f0a] text-amber-300 rounded-xl text-sm">إلغاء</button>
                <button onClick={savePlan} disabled={saving || !form.name} className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-500 disabled:bg-amber-800 text-white rounded-xl text-sm flex items-center justify-center gap-2">{saving && <Loader2 size={16} className="animate-spin" />}حفظ</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
