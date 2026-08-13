'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, Loader2, Save } from 'lucide-react';

export default function SubscriptionDetail() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [sub, setSub] = useState<any>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<any>({});
  const [msg, setMsg] = useState<any>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/admin/subscriptions/${params.id}`).then(r => r.json()),
      fetch('/api/admin/subscription-plans').then(r => r.json()).catch(()=>({success:false,data:{plans:[]}})),
    ]).then(([a,b]) => {
      if (a.success) { setSub(a.data.subscription); setForm(a.data.subscription); }
      if (b.success) setPlans(b.data.plans || []);
      setLoading(false);
    });
  }, [params.id]);

  const save = async () => {
    setSaving(true);
    const r = await fetch(`/api/admin/subscriptions/${params.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plan_id: form.plan_id,
        status: form.status,
        end_date: form.end_date,
        extra_users: form.extra_users,
        extra_branches: form.extra_branches,
      }),
    });
    const j = await r.json();
    if (j.success) {
      setMsg({ type:'ok', text:'تم الحفظ' });
      setSub(j.data.subscription);
    } else { setMsg({ type:'err', text: j.message }); }
    setSaving(false);
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin"/></div>;
  if (!sub) return <div className="p-6">الاشتراك غير موجود</div>;

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/zerocold" className="p-2 rounded-lg hover:bg-bg-card"><ChevronLeft size={18}/></Link>
          <h1 className="text-xl font-bold">تفاصيل الاشتراك</h1>
        </div>
        {msg && <div className={`p-3 rounded-lg text-sm ${msg.type==='ok'?'bg-green-900/20 text-green-300 border border-green-800/30':'bg-red-900/20 text-red-300 border border-red-800/30'}`}>{msg.text}</div>}
        <div className="bg-bg-card border rounded-xl p-5 space-y-4">
          <div>
            <div className="text-xs text-text-muted">الشركة</div>
            <div className="font-bold">{sub.companies?.name} <span className="text-xs text-text-muted">({sub.companies?.email})</span></div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-text-muted">الباقة</label>
              <select value={form.plan_id||''} onChange={e=>setForm({...form,plan_id:e.target.value})} className="w-full mt-1 px-3 py-2 bg-bg-secondary border rounded-lg text-sm">
                {plans.map(p => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-text-muted">الحالة</label>
              <select value={form.status||'active'} onChange={e=>setForm({...form,status:e.target.value})} className="w-full mt-1 px-3 py-2 bg-bg-secondary border rounded-lg text-sm">
                <option value="trial">تجريبي</option>
                <option value="active">نشط</option>
                <option value="expired">منتهي</option>
                <option value="cancelled">ملغي</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-text-muted">تاريخ الانتهاء</label>
              <input type="date" value={(form.end_date||'').slice(0,10)} onChange={e=>setForm({...form,end_date:e.target.value})} className="w-full mt-1 px-3 py-2 bg-bg-secondary border rounded-lg text-sm"/>
            </div>
            <div>
              <label className="text-xs text-text-muted">مستخدمين إضافيين (0 = بدون)</label>
              <input type="number" min={0} value={form.extra_users||0} onChange={e=>setForm({...form,extra_users:Number(e.target.value)})} className="w-full mt-1 px-3 py-2 bg-bg-secondary border rounded-lg text-sm"/>
            </div>
            <div>
              <label className="text-xs text-text-muted">فروع/مستودعات إضافية (0 = بدون)</label>
              <input type="number" min={0} value={form.extra_branches||0} onChange={e=>setForm({...form,extra_branches:Number(e.target.value)})} className="w-full mt-1 px-3 py-2 bg-bg-secondary border rounded-lg text-sm"/>
            </div>
          </div>
          <ButtonPrimary onClick={save} disabled={saving} leftIcon={saving ? <Loader2 size={16} className="animate-spin"/> : <Save size={16}/>}>{saving?'جاري الحفظ...':'حفظ التغييرات'}</ButtonPrimary>
        </div>
      </div>
    </div>
  );
}

function ButtonPrimary({ children, onClick, disabled, leftIcon }: any) {
  return <button onClick={onClick} disabled={disabled} className="px-4 py-2 bg-accent text-white rounded-lg text-sm inline-flex items-center gap-2 disabled:opacity-50">{leftIcon}{children}</button>;
}
