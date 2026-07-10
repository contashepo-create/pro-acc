'use client';

import { useState, useEffect } from 'react';
import { Check, Loader2, CreditCard, Crown, AlertTriangle, Upload, DollarSign, Calendar, Clock, Image as ImageIcon, Send } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';

interface Plan {
  id: string; code: string; name: string; description: string; description_ar: string;
  price_monthly: number; price_yearly: number; yearly_discount_percent: number;
  trial_days: number; max_users: number; max_clients: number; max_projects: number;
  features_modules: any;
}

interface PaymentMethod {
  code: string; name_ar: string; account_number: string; instructions: string;
}

export default function SubscriptionPageEnhanced() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [subscription, setSubscription] = useState<any>(null);
  const [upgradeRequests, setUpgradeRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [duration, setDuration] = useState<'monthly' | 'yearly'>('monthly');
  const [form, setForm] = useState({ payment_method: 'instapay', amount: '', date: new Date().toISOString().split('T')[0], time: new Date().toTimeString().slice(0,5), receipt_url: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<any>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/auth/subscription').then(r=>r.json()),
      fetch('/api/admin/payment-methods').then(r=>r.json()).catch(()=>({success:false})),
      fetch('/api/subscription/upgrade-request').then(r=>r.json()).catch(()=>({success:false}))
    ]).then(([subData, payData, reqData]) => {
      if (subData.success) {
        setPlans(subData.data.plans || []);
        setSubscription(subData.data.subscription);
      }
      if (payData.success) setPaymentMethods(payData.data.methods || []);
      if (reqData.success) setUpgradeRequests(reqData.data.requests || []);
      setLoading(false);
    });
  }, []);

  const openUpgrade = (plan: Plan) => {
    setSelectedPlan(plan);
    const price = duration === 'yearly' ? (plan.price_yearly || plan.price_monthly * 12 * (1 - plan.yearly_discount_percent/100)) : plan.price_monthly;
    setForm(prev => ({ ...prev, amount: String(Math.round(price)) }));
    setShowUpgradeModal(true);
  };

  const submitUpgrade = async () => {
    if (!selectedPlan) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/subscription/upgrade-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requested_plan_id: selectedPlan.id,
          duration_type: duration,
          payment_method_code: form.payment_method,
          payment_amount: Number(form.amount),
          payment_date: form.date,
          payment_time: form.time,
          receipt_image_url: form.receipt_url,
          notes: form.notes,
        })
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: 'success', text: 'تم إرسال طلب الترقية. سيتم مراجعته قريباً.' });
        setShowUpgradeModal(false);
        // Refresh requests
        fetch('/api/subscription/upgrade-request').then(r=>r.json()).then(d=>{ if(d.success) setUpgradeRequests(d.data.requests); });
      } else {
        setMessage({ type: 'error', text: data.message });
      }
    } catch {
      setMessage({ type: 'error', text: 'حدث خطأ في الإرسال' });
    } finally { setSubmitting(false); }
  };

  if (loading) return <div className="flex justify-center h-64 items-center"><Loader2 className="animate-spin" /></div>;

  const currentPlanCode = subscription?.plan_code;
  const priceForSelected = selectedPlan ? (duration === 'yearly' ? (selectedPlan.price_yearly || selectedPlan.price_monthly * 12 * 0.8) : selectedPlan.price_monthly) : 0;

  return (
    <div className="space-y-6">
      <PageHeader title="الباقات والترقية" description="اختر الباقة المناسبة واطلب ترقية مع إرفاق إيصال الدفع" />

      {message && (
        <div className={`rounded-xl p-4 text-sm flex items-center gap-2 ${message.type === 'success' ? 'bg-green-900/20 border border-green-800/30 text-green-300' : 'bg-red-900/20 border border-red-800/30 text-red-300'}`}>
          {message.type === 'success' ? <Check size={18} /> : <AlertTriangle size={18} />} {message.text}
        </div>
      )}

      {subscription && (
        <Card title="اشتراكك الحالي">
          <div className="flex items-center gap-3">
            <Crown size={20} className="text-amber-500" />
            <div>
              <div className="font-bold">{subscription.plan_name || subscription.plan_code} {subscription.status === 'trial' && '(تجريبي - 7 أيام)'}</div>
              <div className="text-xs text-text-muted">ينتهي: {subscription.end_date} - متبقي {subscription.days_remaining || '?'} يوم</div>
            </div>
          </div>
          {subscription.is_expiring_soon && <div className="mt-3 p-2 bg-yellow-900/20 border border-yellow-800/30 rounded-lg text-xs text-yellow-300 flex items-center gap-2"><AlertTriangle size={14} /> اشتراكك ينتهي قريباً، اطلب تمديد أو ترقية</div>}
        </Card>
      )}

      {upgradeRequests.length > 0 && (
        <Card title="طلبات الترقية السابقة">
          <div className="space-y-2">
            {upgradeRequests.map((req: any) => (
              <div key={req.id} className="flex justify-between items-center p-3 bg-bg-secondary rounded-lg text-sm">
                <div>
                  <div className="font-medium">{req.subscription_plans?.name || req.requested_plan_id} - {req.duration_type === 'yearly' ? 'سنوي' : 'شهري'}</div>
                  <div className="text-xs text-text-muted">{new Date(req.created_at).toLocaleDateString()} - {req.payment_method_code} - {req.payment_amount} ر.س</div>
                </div>
                <span className={`px-2 py-1 rounded-full text-xs ${req.status === 'pending' ? 'bg-yellow-900/30 text-yellow-400' : req.status === 'approved' ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>{req.status === 'pending' ? 'معلق' : req.status === 'approved' ? 'مقبول' : 'مرفوض'}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {plans.map((plan) => {
          const isCurrent = currentPlanCode === plan.code;
          const isTrial = plan.code === 'trial';
          const monthlyPrice = plan.price_monthly;
          const yearlyPrice = plan.price_yearly || Math.round(plan.price_monthly * 12 * (1 - plan.yearly_discount_percent/100));
          const yearlyDiscount = plan.yearly_discount_percent || 20;
          
          return (
            <div key={plan.id} className={`border rounded-2xl p-5 flex flex-col ${isCurrent ? 'border-accent ring-2 ring-accent/30 bg-accent/5' : 'border-border bg-card'}`}>
              <h3 className="font-bold text-lg">{plan.name}</h3>
              <p className="text-xs text-text-muted mt-1">{plan.description_ar || plan.description}</p>
              {isTrial && <span className="mt-2 text-xs bg-blue-900/30 text-blue-300 px-2 py-1 rounded-full w-fit">{plan.trial_days} أيام تجريبية</span>}
              
              <div className="mt-4">
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold">{monthlyPrice}</span>
                  <span className="text-xs text-text-muted">ر.س/شهر</span>
                </div>
                <div className="text-xs text-text-muted mt-1">
                  {yearlyPrice} ر.س/سنة <span className="text-green-400">خصم {yearlyDiscount}%</span>
                </div>
              </div>

              <div className="mt-4 space-y-1 text-xs">
                <div>👥 مستخدمين: {plan.max_users}</div>
                <div>👤 عملاء: {plan.max_clients}</div>
                <div>🏗️ مشاريع: {plan.max_projects}</div>
                <div>🧾 فواتير/شهر: {plan.max_invoices_per_month}</div>
              </div>

              <div className="mt-3 flex flex-wrap gap-1">
                {Object.entries(plan.features_modules || {}).filter(([_,v])=>v).slice(0,5).map(([k])=>(
                  <span key={k} className="text-[10px] bg-bg-secondary px-2 py-1 rounded-full">{k}</span>
                ))}
                {Object.keys(plan.features_modules || {}).length > 5 && <span className="text-[10px] text-text-muted">+{Object.keys(plan.features_modules).length - 5} أكثر</span>}
              </div>

              <Button disabled={isCurrent} onClick={() => openUpgrade(plan)} className="w-full mt-5">
                {isCurrent ? 'الباقة الحالية' : isTrial ? 'تجربة مجانية' : 'طلب ترقية'}
              </Button>
            </div>
          );
        })}
      </div>

      <Modal isOpen={showUpgradeModal} onClose={() => setShowUpgradeModal(false)} title={`طلب ترقية إلى ${selectedPlan?.name}`} size="lg">
        {selectedPlan && (
          <div className="space-y-5">
            <div className="flex gap-2 p-1 bg-bg-secondary rounded-xl">
              <button onClick={() => setDuration('monthly')} className={`flex-1 py-2 rounded-lg text-sm ${duration === 'monthly' ? 'bg-accent text-white' : 'text-text-muted'}`}>شهري - {selectedPlan.price_monthly} ر.س</button>
              <button onClick={() => setDuration('yearly')} className={`flex-1 py-2 rounded-lg text-sm ${duration === 'yearly' ? 'bg-accent text-white' : 'text-text-muted'}`}>سنوي - {Math.round((selectedPlan.price_yearly || selectedPlan.price_monthly * 12 * 0.8))} ر.س (خصم {selectedPlan.yearly_discount_percent}%)</button>
            </div>

            <div className="p-3 bg-blue-900/20 border border-blue-800/30 rounded-xl text-xs">
              <div className="font-bold mb-1">طرق الدفع المتاحة (يتحكم فيها الأدمن):</div>
              {paymentMethods.length === 0 ? (
                <div>انستا باي، أورنج كاش، تحويل بنكي - حول المبلغ ثم ارفق الإيصال</div>
              ) : paymentMethods.map((pm) => (
                <div key={pm.code} className="flex justify-between py-1"><span>{pm.name_ar}</span><span className="text-text-muted">{pm.account_number}</span></div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-text-muted">طريقة الدفع</label>
                <select value={form.payment_method} onChange={(e) => setForm({...form, payment_method: e.target.value})} className="w-full mt-1 px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm">
                  <option value="instapay">انستا باي</option>
                  <option value="orange_cash">أورنج كاش</option>
                  <option value="bank_transfer">تحويل بنكي</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-text-muted">المبلغ المحول</label>
                <Input type="number" value={form.amount} onChange={(e:any)=>setForm({...form, amount: e.target.value})} />
              </div>
              <div>
                <label className="text-xs text-text-muted">تاريخ التحويل</label>
                <Input type="date" value={form.date} onChange={(e:any)=>setForm({...form, date: e.target.value})} />
              </div>
              <div>
                <label className="text-xs text-text-muted">وقت التحويل</label>
                <Input type="time" value={form.time} onChange={(e:any)=>setForm({...form, time: e.target.value})} />
              </div>
            </div>

            <div>
              <label className="text-xs text-text-muted">رابط صورة الإيصال (ارفع الصورة على أي موقع وانسخ الرابط أو اتركه فارغ وأرسل الصورة للدعم)</label>
              <Input placeholder="https://..." value={form.receipt_url} onChange={(e:any)=>setForm({...form, receipt_url: e.target.value})} />
            </div>

            <div>
              <label className="text-xs text-text-muted">ملاحظات إضافية</label>
              <textarea value={form.notes} onChange={(e)=>setForm({...form, notes: e.target.value})} className="w-full mt-1 px-3 py-2 bg-bg-secondary border border-border rounded-xl text-sm h-20" placeholder="اكتب تفاصيل إضافية..."></textarea>
            </div>

            <div className="bg-amber-950/20 border border-amber-900/30 rounded-xl p-3 text-xs text-amber-300">
              <div className="font-bold">المبلغ المطلوب: {priceForSelected} ر.س ({duration === 'yearly' ? 'سنوي' : 'شهري'})</div>
              <div className="mt-1">بعد التحويل، ارفق قيمة التحويل وتاريخه ووقته وصورة الإيصال. سيصل الطلب للإدارة عبر البوت وسيتم تنبيه الإدارة في لوحة التحكم.</div>
            </div>

            <Button onClick={submitUpgrade} disabled={submitting} className="w-full" leftIcon={submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}>
              {submitting ? 'جاري الإرسال...' : 'رفع طلب ترقية'}
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
