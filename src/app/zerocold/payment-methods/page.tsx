'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Loader2, Plus, RefreshCw, DollarSign } from 'lucide-react';
import Link from 'next/link';

interface PaymentMethod {
  id: string;
  code: string;
  name_ar: string;
  account_number: string;
  account_name: string;
  instructions: string;
  is_active: boolean;
}

export default function PaymentMethodsPage() {
  const router = useRouter();
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ code: '', name_ar: '', account_number: '', account_name: '', instructions: '', is_active: true });
  const [saving, setSaving] = useState(false);

  const fetchMethods = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/payment-methods');
      if (res.status === 401) { router.replace('/zerocold/login'); return; }
      const data = await res.json();
      if (data.success) setMethods(data.data.methods || []);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchMethods();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveMethod = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/payment-methods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.success) { setShowForm(false); setForm({ code: '', name_ar: '', account_number: '', account_name: '', instructions: '', is_active: true }); fetchMethods(); }
      else alert(data.message);
    } finally { setSaving(false); }
  };

  const toggleActive = async (m: PaymentMethod) => {
    await fetch('/api/admin/payment-methods', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: m.id, is_active: !m.is_active }),
    });
    fetchMethods();
  };

  if (loading) return <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center"><Loader2 className="animate-spin text-amber-500" size={32} /></div>;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-amber-50">
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Link href="/zerocold/"><ChevronLeft size={18} className="text-amber-500/70" /></Link>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-600 to-emerald-700 flex items-center justify-center"><DollarSign className="w-5 h-5 text-white" /></div>
            <div>
              <h1 className="text-lg font-bold">طرق الدفع</h1>
              <p className="text-[0.7rem] text-amber-400/50">تحكم في طرق الدفع المتاحة للعملاء (انستا باي، أورنج كاش، بنكي)</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowForm(true)} className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-sm flex items-center gap-2"><Plus size={16} />إضافة طريقة</button>
            <button onClick={fetchMethods} className="p-2 rounded-xl bg-[#12101a] border border-[#2a1f0a] text-amber-500/70"><RefreshCw size={16} /></button>
          </div>
        </div>

        <div className="grid gap-4">
          {methods.length === 0 ? (
            <div className="bg-[#12101a] border border-[#2a1f0a] rounded-2xl p-12 text-center text-amber-600/50">لا توجد طرق دفع - أضف انستا باي، أورنج كاش، تحويل بنكي</div>
          ) : methods.map((m) => (
            <div key={m.id} className="bg-[#12101a] border border-[#2a1f0a] rounded-2xl p-5">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-bold">{m.name_ar} <code className="text-xs bg-[#1a1625] px-2 py-1 rounded ml-2">{m.code}</code></h3>
                  <div className="text-xs text-amber-400/60 mt-1">حساب: {m.account_number || 'غير محدد'} - {m.account_name || ''}</div>
                  <div className="text-xs text-amber-400/50 mt-1">{m.instructions}</div>
                </div>
                <button onClick={() => toggleActive(m)} className={`w-12 h-6 rounded-full transition-colors relative ${m.is_active ? 'bg-green-600' : 'bg-[#1a1625]'}`}>
                  <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all ${m.is_active ? 'right-0.5' : 'right-6'}`}></div>
                </button>
              </div>
            </div>
          ))}
        </div>

        {showForm && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setShowForm(false)}>
            <div className="bg-[#12101a] border border-[#2a1f0a] rounded-2xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
              <h2 className="font-bold text-lg mb-4">إضافة طريقة دفع</h2>
              <div className="space-y-3">
                <input placeholder="الكود (مثلاً: instapay)" value={form.code} onChange={(e) => setForm({...form, code: e.target.value})} className="w-full px-4 py-2.5 bg-[#1a1625] border border-[#2a1f0a] rounded-xl text-sm" />
                <input placeholder="الاسم عربي (مثلاً: انستا باي)" value={form.name_ar} onChange={(e) => setForm({...form, name_ar: e.target.value})} className="w-full px-4 py-2.5 bg-[#1a1625] border border-[#2a1f0a] rounded-xl text-sm" />
                <input placeholder="رقم الحساب" value={form.account_number} onChange={(e) => setForm({...form, account_number: e.target.value})} className="w-full px-4 py-2.5 bg-[#1a1625] border border-[#2a1f0a] rounded-xl text-sm" />
                <input placeholder="اسم صاحب الحساب" value={form.account_name} onChange={(e) => setForm({...form, account_name: e.target.value})} className="w-full px-4 py-2.5 bg-[#1a1625] border border-[#2a1f0a] rounded-xl text-sm" />
                <textarea placeholder="تعليمات الدفع" value={form.instructions} onChange={(e) => setForm({...form, instructions: e.target.value})} className="w-full px-4 py-2.5 bg-[#1a1625] border border-[#2a1f0a] rounded-xl text-sm h-20"></textarea>
              </div>
              <div className="flex gap-3 mt-6">
                <button onClick={() => setShowForm(false)} className="flex-1 py-2.5 bg-[#1a1625] border border-[#2a1f0a] rounded-xl text-sm">إلغاء</button>
                <button onClick={saveMethod} disabled={saving || !form.code || !form.name_ar} className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-sm flex items-center justify-center gap-2">{saving && <Loader2 size={16} className="animate-spin" />}حفظ</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
