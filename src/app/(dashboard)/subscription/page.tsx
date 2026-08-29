'use client';

import { useState, useEffect } from 'react';
import { Check, Loader2, Crown, AlertTriangle, Send, Key as KeyIcon, UserPlus, Building2, HardDrive, Download, CreditCard } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/store/auth-store';

const ADDONS = [
  { id: 'extra_user', label: 'مستخدم إضافي', monthly: 5, yearly: 48, icon: UserPlus },
  { id: 'extra_branch', label: 'فرع/مستودع إضافي', monthly: 10, yearly: 96, icon: Building2 },
  { id: 'storage_gb', label: '1 جيجا بايت تخزين', monthly: 3, yearly: 30, icon: HardDrive },
] as const;

interface Plan {
  id: string; code: string; name: string; description: string; description_ar: string;
  price_monthly: number; price_yearly: number; yearly_discount_percent: number;
  trial_days: number; max_users: number; max_clients: number | null; max_suppliers?: number | null;
  max_employees?: number | null; max_projects: number | null; max_invoices_per_month?: number | null;
  max_quotations_per_month?: number | null;
  max_storage_mb?: number;
  features_modules: Record<string, unknown>;
  currency?: string;
}

interface PaymentMethod {
  code: string; name_ar: string; account_number: string; instructions: string;
}

type AddonId = 'extra_user' | 'extra_branch' | 'storage_gb';

interface SubscriptionState {
  id?: string;
  subscriber_number?: string | null;
  plan_code?: string;
  plan_name?: string;
  status?: string;
  end_date?: string;
  days_remaining?: number;
  extra_users?: number;
  extra_branches?: number;
  extra_storage_gb?: number;
  is_expired?: boolean;
  is_expiring_soon?: boolean;
  limits?: {
    max_users?: number;
    max_invoices_per_month?: number | null;
    max_quotations_per_month?: number | null;
    max_storage_mb?: number;
  } | null;
}
interface FlashMessage { type: 'success' | 'error'; text: string; }
interface CodePreview { plan_name?: string; duration_months?: number; is_used?: boolean; }
interface UpgradeRequest {
  id: string;
  requested_plan_id?: string;
  subscription_plans?: { name?: string };
  duration_type?: string;
  payment_method_code?: string;
  payment_amount?: number;
  created_at: string;
  status?: string;
}
interface AddonRequest {
  id: string;
  addon_type?: string;
  quantity?: number;
  duration_type?: string;
  total_amount_usd?: number;
  created_at: string;
  status?: string;
}
interface SupportTicket { id: string; subject?: string; status?: string; created_at: string; }

export default function SubscriptionPageEnhanced() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);

  const searchParams = useSearchParams();

  // صفحة الباقات/التجديد متاحة لكل مستخدمي الشركة (وليس المدير فقط):
  // عند انتهاء الاشتراك يوجَّه الجميع сюда لتجديد الاشتراك أو تفعيل كود أو
  // تحميل جداول بياناتهم — ولا يمكنهم الوصول لأي قسم آخر.

  const [subscription, setSubscription] = useState<SubscriptionState | null>(null);
  const [upgradeRequests, setUpgradeRequests] = useState<UpgradeRequest[]>([]);
  const [addonRequests, setAddonRequests] = useState<AddonRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [duration, setDuration] = useState<'monthly' | 'yearly'>('monthly');
  const [form, setForm] = useState({ payment_method: 'instapay', amount: '', date: new Date().toISOString().split('T')[0], time: new Date().toTimeString().slice(0,5), receipt_url: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<FlashMessage | null>(null);

  // Add-on modal
  const [showAddonModal, setShowAddonModal] = useState(false);
  const [selectedAddon, setSelectedAddon] = useState<AddonId>('extra_user');
  const [addonQty, setAddonQty] = useState(1);
  const [addonDuration, setAddonDuration] = useState<'monthly'|'yearly'>('monthly');
  const [addonForm, setAddonForm] = useState({ payment_method: 'instapay', amount: '5', date: new Date().toISOString().split('T')[0], time: new Date().toTimeString().slice(0,5), receipt_url: '', notes: '' });
  const [addonSubmitting, setAddonSubmitting] = useState(false);
  const [receiptUploading, setReceiptUploading] = useState<'upgrade'|'addon'|null>(null);

  const uploadReceipt = async (file: File, target: 'upgrade'|'addon') => {
    setReceiptUploading(target);
    setMessage(null);
    try {
      const payload = new FormData();
      payload.append('file', file);
      const response = await fetch('/api/upload/receipt', { method: 'POST', body: payload });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.message || 'فشل رفع الإيصال');
      const reference = json.data.reference || json.data.fileName;
      if (target === 'upgrade') setForm((current) => ({ ...current, receipt_url: reference }));
      else setAddonForm((current) => ({ ...current, receipt_url: reference }));
      setMessage({ type: 'success', text: 'تم رفع إيصال الدفع إلى التخزين الآمن.' });
    } catch (uploadError) {
      setMessage({ type: 'error', text: uploadError instanceof Error ? uploadError.message : 'فشل رفع الإيصال' });
    } finally {
      setReceiptUploading(null);
    }
  };

  // Activation code state
  const [activationCode, setActivationCode] = useState('');
  const [codePreview, setCodePreview] = useState<CodePreview | null>(null);
  const [codeChecking, setCodeChecking] = useState(false);
  const [activating, setActivating] = useState(false);
  const [activationMsg, setActivationMsg] = useState<FlashMessage | null>(null);

  // Support tab state
  const [activeTab, setActiveTab] = useState<'plans'|'addons'|'support'|'export'>('plans');
  // Keep the active tab in sync with the ?tab= URL parameter (standard
  // URL-driven state sync on param change).
  useEffect(() => {
    const tab = searchParams?.get('tab');
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (tab === 'support' || tab === 'export' || tab === 'addons') setActiveTab(tab as 'support' | 'export' | 'addons');
  }, [searchParams]);

  // Support form
  const [supportForm, setSupportForm] = useState({ subject: '', message: '', category: 'billing' });
  const [supportSubmitting, setSupportSubmitting] = useState(false);
  const [supportTickets, setSupportTickets] = useState<SupportTicket[]>([]);

  const refreshAll = async () => {
    const [subData, payData, reqData, addonData, supData] = await Promise.all([
      fetch('/api/auth/subscription').then(r=>r.json()),
      fetch('/api/payment-methods').then(r=>r.json()).catch(()=>({success:false})),
      fetch('/api/subscription/upgrade-request').then(r=>r.json()).catch(()=>({success:false})),
      fetch('/api/subscription/addon-request').then(r=>r.json()).catch(()=>({success:false})),
      fetch('/api/support').then(r=>r.json()).catch(()=>({success:false})),
    ]);
    if (subData.success) { setPlans(subData.data.plans || []); setSubscription(subData.data.subscription); }
    if (payData.success) {
      const methods: PaymentMethod[] = payData.data.methods || [];
      setPaymentMethods(methods);
      // The browser used to keep the hard-coded "instapay" value even when
      // the select visually displayed another active method. PostgreSQL then
      // rejected the add-user/add-on request as an invalid payment method.
      if (methods.length > 0) {
        setForm((current) => methods.some((method) => method.code === current.payment_method)
          ? current
          : { ...current, payment_method: methods[0].code });
        setAddonForm((current) => methods.some((method) => method.code === current.payment_method)
          ? current
          : { ...current, payment_method: methods[0].code });
      }
    }
    if (reqData.success) setUpgradeRequests(reqData.data.requests || []);
    if (addonData.success) setAddonRequests(addonData.data.requests || []);
    if (supData.success) setSupportTickets(supData.data.tickets || []);
    setLoading(false);
  };

  // Initial load on mount (standard fetch pattern).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { refreshAll(); }, []);

  const openUpgrade = (plan: Plan) => {
    setSelectedPlan(plan);
    const price = duration === 'yearly' ? (plan.price_yearly || plan.price_monthly * 12 * (1 - plan.yearly_discount_percent/100)) : plan.price_monthly;
    setForm(prev => ({ ...prev, amount: String(Math.round(price)) }));
    setShowUpgradeModal(true);
  };

  const checkCode = async () => {
    if (!activationCode.trim()) return;
    setCodeChecking(true);
    setActivationMsg(null);
    setCodePreview(null);
    try {
      const res = await fetch(`/api/subscription/activate-code?code=${encodeURIComponent(activationCode.trim())}`);
      const json = await res.json();
      if (json.success && json.data.valid) {
        setCodePreview(json.data);
      } else {
        setActivationMsg({ type: 'error', text: json.message || 'كود غير صحيح' });
      }
    } catch {
      setActivationMsg({ type: 'error', text: 'خطأ في الاتصال' });
    } finally {
      setCodeChecking(false);
    }
  };

  const activateCode = async () => {
    if (!activationCode.trim()) return;
    setActivating(true);
    setActivationMsg(null);
    try {
      const res = await fetch('/api/subscription/activate-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: activationCode.trim() }),
      });
      const json = await res.json();
      if (json.success) {
        setActivationMsg({ 
          type: 'success', 
          text: `✅ تم تفعيل الباقة "${json.data.plan_name}" لمدة ${json.data.duration_months} شهر! تنتهي في ${json.data.end_date}` 
        });
        setActivationCode('');
        setCodePreview(null);
        // Refresh subscription data
        const subData = await fetch('/api/auth/subscription').then(r => r.json());
        if (subData.success) {
          setPlans(subData.data.plans || []);
          setSubscription(subData.data.subscription);
        }
      } else {
        setActivationMsg({ type: 'error', text: json.message || 'فشل التفعيل' });
      }
    } catch {
      setActivationMsg({ type: 'error', text: 'خطأ في الاتصال' });
    } finally {
      setActivating(false);
    }
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
        refreshAll();
      } else {
        setMessage({ type: 'error', text: data.message });
      }
    } catch {
      setMessage({ type: 'error', text: 'حدث خطأ في الإرسال' });
    } finally { setSubmitting(false); }
  };

  const openAddon = (id: AddonId) => {
    const addon = ADDONS.find(a => a.id === id)!;
    setSelectedAddon(id);
    setAddonQty(1);
    setAddonDuration('monthly');
    setAddonForm({ payment_method: paymentMethods[0]?.code || 'instapay', amount: String(addon.monthly), date: new Date().toISOString().split('T')[0], time: new Date().toTimeString().slice(0,5), receipt_url: '', notes: '' });
    setShowAddonModal(true);
  };

  const addonUnitPrice = () => {
    const a = ADDONS.find(x => x.id === selectedAddon)!;
    return addonDuration === 'monthly' ? a.monthly : a.yearly;
  };
  const addonTotal = () => addonUnitPrice() * addonQty;

  const submitAddon = async () => {
    setAddonSubmitting(true);
    try {
      const res = await fetch('/api/subscription/addon-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          addon_type: selectedAddon,
          quantity: addonQty,
          duration_type: addonDuration,
          payment_method_code: addonForm.payment_method,
          payment_amount: Number(addonForm.amount) || addonTotal(),
          payment_date: addonForm.date,
          payment_time: addonForm.time,
          receipt_image_url: addonForm.receipt_url,
          notes: addonForm.notes,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: 'success', text: 'تم إرسال طلب الإضافة. سيتم تفعيلها بعد مراجعة الدفع.' });
        setShowAddonModal(false);
        refreshAll();
      } else {
        setMessage({ type: 'error', text: data.message });
      }
    } catch {
      setMessage({ type: 'error', text: 'خطأ في الإرسال' });
    } finally { setAddonSubmitting(false); }
  };

  const submitSupport = async () => {
    if (!supportForm.subject.trim() || !supportForm.message.trim()) {
      setMessage({ type: 'error', text: 'العنوان والرسالة مطلوبان' });
      return;
    }
    setSupportSubmitting(true);
    try {
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(supportForm),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: 'success', text: 'تم إرسال رسالتك. سنتواصل معك قريباً.' });
        setSupportForm({ subject: '', message: '', category: 'billing' });
        refreshAll();
      } else setMessage({ type: 'error', text: data.message });
    } catch {
      setMessage({ type: 'error', text: 'خطأ في الإرسال' });
    } finally { setSupportSubmitting(false); }
  };

  if (loading) return <div className="flex justify-center h-64 items-center"><Loader2 className="animate-spin" /></div>;

  const currentPlanCode = subscription?.plan_code;
  const priceForSelected = selectedPlan ? (duration === 'yearly' ? (selectedPlan.price_yearly || selectedPlan.price_monthly * 12 * 0.8) : selectedPlan.price_monthly) : 0;

  // وضع التجديد: عند انتهاء الاشتراك (أو القدوم عبر ?renew=1) تظهر لافتة
  // بارزة توضح أن الأقسام مغلقة وأن المتاح هنا هو التجديد أو تحميل
  // جداول البيانات (Excel/CSV) — لجميع مستخدمي الشركة.
  const renewMode = searchParams?.get('renew') === '1' || !!subscription?.is_expired;

  const tabs = [
    { id: 'plans', label: 'الباقات' },
    { id: 'addons', label: 'الإضافات' },
    { id: 'support', label: 'الدعم والتواصل' },
    { id: 'export', label: 'تحميل تقارير بياناتي' },
  ] as const;

  return (
    <div className="space-y-6">
      <PageHeader title="الباقات والاشتراك" description="اختر الباقة، اطلب إضافات، تواصل مع الدعم، أو حمّل تقارير بياناتك" />

      {renewMode && (
        <div className="rounded-xl p-4 border-2 bg-danger-light border-danger text-danger flex flex-col sm:flex-row sm:items-center gap-3">
          <AlertTriangle size={22} className="shrink-0" />
          <div className="text-sm font-semibold flex-1">
            انتهى اشتراك شركتك — أقسام النظام مغلقة مؤقتاً وبياناتك محفوظة سليمة.
            من هذه الصفحة يمكنك تجديد الاشتراك أو تفعيل كود، أو تحميل تقارير بياناتك (Excel/CSV)، أو التواصل مع الدعم. بمجرد التجديد تعود كل الأقسام للعمل فوراً.
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap border-b border-border">
        {tabs.map(t => (
          <button key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${activeTab === t.id ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text-primary'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {message && (
        <div className={`rounded-xl p-4 text-sm font-semibold flex items-center gap-2 border-2 ${message.type === 'success' ? 'bg-success-light border-success text-success' : 'bg-danger-light border-danger text-danger'}`}>
          {message.type === 'success' ? <Check size={18} /> : <AlertTriangle size={18} />} {message.text}
        </div>
      )}

      {activeTab === 'plans' && (
        <>
          {subscription && (
            <Card title="اشتراكك الحالي">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Crown size={20} className="text-amber-500" />
                  <div>
                    <div className="font-bold">{subscription.plan_name || subscription.plan_code} {subscription.status === 'trial' && '(تجريبي - 7 أيام)'}</div>
                    <div className="text-xs text-text-muted">ينتهي: {subscription.end_date} - متبقي {subscription.days_remaining || '?'} يوم · مقاعد إضافية: {subscription.extra_users ?? 0} · فروع إضافية: {subscription.extra_branches ?? 0}</div>
                  </div>
                </div>
                {/* رقم المشترك — نفس منطق صفحة الإعدادات: القيمة الفريدة الدائمة
                    من subscriptions.subscriber_number (الهجرة 112)، مع تجزئة
                    المعرف كبديل احتياطي فقط للاشتراكات الأقدم من تعيين الأرقام */}
                <div className="flex items-center gap-3 bg-bg-secondary border border-border rounded-xl px-4 py-2.5">
                  <CreditCard size={18} className="text-accent shrink-0" />
                  <div>
                    <p className="text-[0.7rem] text-text-muted">رقم المشترك</p>
                    <p className="text-xl font-bold text-accent font-mono leading-tight" dir="ltr">
                      #{subscription.subscriber_number || subscription.id?.substring(0, 8) || '—'}
                    </p>
                  </div>
                </div>
              </div>
              <p className="mt-2 text-[0.7rem] text-text-muted">رقم المشترك فريد ودائم لا يتغير — استخدمه عند التواصل مع الدعم</p>
              {subscription.is_expiring_soon && <div className="mt-3 p-2 bg-warning-light border border-warning rounded-lg text-xs font-semibold text-warning flex items-center gap-2"><AlertTriangle size={14} /> اشتراكك ينتهي قريباً، اطلب تمديد أو ترقية</div>}
            </Card>
          )}

          {/* الإضافات المفعلة فعلياً على الاشتراك (من أعمدة subscriptions بعد
              اعتماد الإدارة) — عرض صريح لكل إضافة وكميتها وحدودها الفعلية */}
          {subscription && (
            <Card title="الإضافات المفعلة على اشتراكك">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="flex items-center gap-3 p-3 bg-bg-secondary rounded-xl border border-border">
                  <UserPlus size={20} className="text-accent shrink-0" />
                  <div className="text-sm">
                    <div className="font-bold">{subscription.extra_users ?? 0} × مستخدم إضافي</div>
                    <div className="text-xs text-text-muted">إجمالي المقاعد: {subscription.limits?.max_users ?? '—'}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 bg-bg-secondary rounded-xl border border-border">
                  <Building2 size={20} className="text-accent shrink-0" />
                  <div className="text-sm">
                    <div className="font-bold">{subscription.extra_branches ?? 0} × فرع/مستودع إضافي</div>
                    <div className="text-xs text-text-muted">تُحتسب ضمن حدود الباقة + الإضافات</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 bg-bg-secondary rounded-xl border border-border">
                  <HardDrive size={20} className="text-accent shrink-0" />
                  <div className="text-sm">
                    <div className="font-bold">{subscription.extra_storage_gb ?? 0} GB تخزين إضافي</div>
                    <div className="text-xs text-text-muted">
                      إجمالي التخزين: {subscription.limits?.max_storage_mb != null ? `${(subscription.limits.max_storage_mb / 1024).toFixed(1)} GB` : '—'}
                    </div>
                  </div>
                </div>
              </div>
              {(subscription.extra_users ?? 0) === 0 && (subscription.extra_branches ?? 0) === 0 && (subscription.extra_storage_gb ?? 0) === 0 && (
                <p className="mt-3 text-xs text-text-muted">لا توجد إضافات مفعلة حالياً — يمكنك طلبها من تبويب «الإضافات» بالأسفل.</p>
              )}
            </Card>
          )}

          {upgradeRequests.length > 0 && (
            <Card title="طلبات الترقية السابقة">
              <div className="space-y-2">
                {upgradeRequests.map((req: UpgradeRequest) => (
                  <div key={req.id} className="flex justify-between items-center p-3 bg-bg-secondary rounded-lg text-sm">
                    <div>
                      <div className="font-medium">{req.subscription_plans?.name || req.requested_plan_id} - {req.duration_type === 'yearly' ? 'سنوي' : 'شهري'}</div>
                      <div className="text-xs text-text-muted">{new Date(req.created_at).toLocaleDateString()} - {req.payment_method_code} - ${req.payment_amount}</div>
                    </div>
                    <span className={`px-2 py-1 rounded-full text-xs ${req.status === 'pending' ? 'bg-warning-light text-warning font-semibold' : req.status === 'approved' ? 'bg-success-light text-success font-semibold' : 'bg-danger-light text-danger font-semibold'}`}>{req.status === 'pending' ? 'معلق' : req.status === 'approved' ? 'مقبول' : 'مرفوض'}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                <KeyIcon size={20} className="text-green-600" />
              </div>
              <div>
                <h3 className="font-bold">تفعيل بكود</h3>
                <p className="text-xs text-text-muted">أدخل كود التفعيل لتفعيل الباقة أو الإضافات فوراً</p>
              </div>
            </div>
            {activationMsg && (
              <div className={`mb-3 p-3 rounded-lg text-sm ${activationMsg.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>{activationMsg.text}</div>
            )}
            {codePreview && (
              <div className="mb-3 p-3 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-700">
                <div><strong>الباقة:</strong> {codePreview.plan_name}</div>
                <div><strong>المدة:</strong> {codePreview.duration_months} شهر</div>
              </div>
            )}
            <div className="flex gap-2">
              <Input placeholder="أدخل كود التفعيل هنا..." value={activationCode} onChange={(e) => { setActivationCode(e.target.value); setCodePreview(null); }} dir="ltr" className="flex-1" />
              <Button variant="outline" onClick={checkCode} disabled={!activationCode || codeChecking}>{codeChecking ? '...' : 'تحقق'}</Button>
              <Button onClick={activateCode} disabled={!activationCode || !codePreview || codePreview?.is_used || activating}>{activating ? 'جاري التفعيل...' : 'تفعيل'}</Button>
            </div>
          </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {plans.map((plan) => {
          const isCurrent = currentPlanCode === plan.code;
          const isTrial = plan.code === 'trial';
          const currency = plan.currency || 'USD';
          const sym = currency === 'USD' ? '$' : currency;
          const monthlyPrice = plan.price_monthly;
          const yearlyPrice = plan.price_yearly || Math.round(plan.price_monthly * 12 * (1 - plan.yearly_discount_percent/100));
          const yearlyDiscount = plan.yearly_discount_percent || 20;
          const fmtLimit = (v: number | null | undefined) =>
            v === null || v === undefined ? 'غير محدود' : v;

          return (
            <div key={plan.id} className={`border rounded-2xl p-5 flex flex-col ${isCurrent ? 'border-accent ring-2 ring-accent/30 bg-accent/5' : 'border-border bg-card'}`}>
              <h3 className="font-bold text-lg">{plan.name}</h3>
              <p className="text-xs text-text-muted mt-1">{plan.description_ar || plan.description}</p>
              {isTrial && <span className="mt-2 text-xs bg-info-light text-info px-2 py-1 rounded-full w-fit">{plan.trial_days} أيام تجريبية</span>}

              <div className="mt-4">
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold">{sym}{monthlyPrice}</span>
                  <span className="text-xs text-text-muted">/شهر</span>
                </div>
                <div className="text-xs text-text-muted mt-1">
                  {sym}{yearlyPrice}/سنة <span className="text-success">خصم {yearlyDiscount}%</span>
                </div>
              </div>

              <div className="mt-4 space-y-1 text-xs">
                <div>👥 المستخدم الرئيسي: {plan.max_users}</div>
                <div>🧾 فواتير/شهر: {fmtLimit(plan.max_invoices_per_month)}</div>
                <div>📄 عروض سعر/شهر: {fmtLimit(plan.max_quotations_per_month)}</div>
                <div>💾 التخزين: {plan.max_storage_mb ?? 0} MB</div>
              </div>

              <div className="mt-3 flex flex-wrap gap-1">
                {Object.entries(plan.features_modules || {}).filter(([k,v])=>v && isNaN(Number(k))).slice(0,5).map(([k])=>(
                  <span key={k} className="text-[10px] bg-bg-secondary px-2 py-1 rounded-full">{k}</span>
                ))}
                {Object.entries(plan.features_modules || {}).filter(([k,v])=>v && isNaN(Number(k))).length > 5 && <span className="text-[10px] text-text-muted">+{Object.entries(plan.features_modules || {}).filter(([k,v])=>v && isNaN(Number(k))).length - 5} أكثر</span>}
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
              <button onClick={() => setDuration('monthly')} className={`flex-1 py-2 rounded-lg text-sm ${duration === 'monthly' ? 'bg-accent text-white' : 'text-text-muted'}`}>شهري - ${selectedPlan.price_monthly}</button>
              <button onClick={() => setDuration('yearly')} className={`flex-1 py-2 rounded-lg text-sm ${duration === 'yearly' ? 'bg-accent text-white' : 'text-text-muted'}`}>سنوي - ${Math.round((selectedPlan.price_yearly || selectedPlan.price_monthly * 12 * 0.8))} (خصم {selectedPlan.yearly_discount_percent}%)</button>
            </div>

            <div className="p-3 bg-info-light border border-info rounded-xl text-xs text-text-primary">
              <div className="font-bold mb-1">طرق الدفع المتاحة (يتحكم فيها الأدمن):</div>
              {paymentMethods.length === 0 ? (
                <div>انستا باي، أورنج كاش، تحويل بنكي - حول المبلغ ثم ارفق الإيصال</div>
              ) : paymentMethods.map((pm) => (
                <div key={pm.code} className="flex justify-between py-1"><span>{pm.name_ar}</span><span className="text-text-muted">{pm.account_number}</span></div>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-text-muted">طريقة الدفع</label>
                <select value={form.payment_method} onChange={(e) => setForm({...form, payment_method: e.target.value})} className="w-full mt-1 px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm">
                  {paymentMethods.length > 0 ? paymentMethods.map((pm) => (
                    <option key={pm.code} value={pm.code}>{pm.name_ar}</option>
                  )) : (<>
                  <option value="instapay">انستا باي</option>
                  <option value="orange_cash">أورنج كاش</option>
                  <option value="bank_transfer">تحويل بنكي</option>
                  </>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-text-muted">المبلغ المحول</label>
                <Input type="number" value={form.amount} onChange={(e)=>setForm({...form, amount: e.target.value})} />
              </div>
              <div>
                <label className="text-xs text-text-muted">تاريخ التحويل</label>
                <Input type="date" value={form.date} onChange={(e)=>setForm({...form, date: e.target.value})} />
              </div>
              <div>
                <label className="text-xs text-text-muted">وقت التحويل</label>
                <Input type="time" value={form.time} onChange={(e)=>setForm({...form, time: e.target.value})} />
              </div>
            </div>

            <div>
              <label className="text-xs text-text-muted">صورة إيصال الدفع (JPG أو PNG أو PDF، حتى 5MB)</label>
              <input
                type="file"
                accept="image/jpeg,image/png,application/pdf"
                disabled={receiptUploading !== null}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadReceipt(file, 'upgrade');
                }}
                className="w-full mt-1 px-3 py-2 bg-bg-secondary border border-border rounded-xl text-sm"
              />
              {receiptUploading === 'upgrade' && <p className="text-xs text-text-muted mt-1">جاري رفع الإيصال...</p>}
              {form.receipt_url && <p className="text-xs text-success mt-1">تم إرفاق الإيصال بأمان</p>}
            </div>

            <div>
              <label className="text-xs text-text-muted">ملاحظات إضافية</label>
              <textarea value={form.notes} onChange={(e)=>setForm({...form, notes: e.target.value})} className="w-full mt-1 px-3 py-2 bg-bg-secondary border border-border rounded-xl text-sm h-20" placeholder="اكتب تفاصيل إضافية..."></textarea>
            </div>

            <div className="bg-warning-light border border-warning rounded-xl p-3 text-xs text-warning">
              <div className="font-bold">المبلغ المطلوب: ${priceForSelected} ({duration === 'yearly' ? 'سنوي' : 'شهري'})</div>
              <div className="mt-1">بعد التحويل، ارفق قيمة التحويل وتاريخه ووقته وصورة الإيصال. سيصل الطلب للإدارة عبر البوت وسيتم تنبيه الإدارة في لوحة التحكم.</div>
            </div>

            <Button onClick={submitUpgrade} disabled={submitting || receiptUploading !== null || !form.receipt_url} className="w-full" leftIcon={submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}>
              {submitting ? 'جاري الإرسال...' : 'رفع طلب ترقية'}
            </Button>
          </div>
        )}
      </Modal>
      </>)}

      {activeTab === 'addons' && (
        <div className="space-y-4">
          <Card title="الإضافات المدفوعة">
            <p className="text-xs text-text-muted mb-4">اشترِ إضافات على باقتك الحالية دون تغيير الباقة نفسها. المدة تبدأ من تاريخ الموافقة.</p>
            <div className="grid md:grid-cols-3 gap-4">
              {ADDONS.map((a) => {
                const Icon = a.icon;
                // الكمية المفعلة تُقرأ من أعمدة الاشتراك نفسها (آخر ما اعتمدته
                // الإدارة) وليس من قيمة افتراضية — يشمل تخزين GB الذي كان
                // يظهر دوماً صفراً.
                const active = a.id === 'extra_user'
                  ? (subscription?.extra_users ?? 0)
                  : a.id === 'extra_branch'
                    ? (subscription?.extra_branches ?? 0)
                    : (subscription?.extra_storage_gb ?? 0);
                return (
                  <div key={a.id} className="border rounded-xl p-4 bg-bg-secondary flex flex-col gap-3">
                    <div className="flex items-center gap-2"><Icon size={22} className="text-accent" /><h3 className="font-bold">{a.label}</h3></div>
                    <div className="text-sm">
                      <div><strong>${a.monthly}</strong>/شهر · <strong>${a.yearly}</strong>/سنة (خصم {(100 - Math.round(a.yearly/(a.monthly*12)*100))}%)</div>
                      <div className="text-xs text-text-muted mt-1">
                        مفعّل حالياً: <strong>{active}</strong>
                        {active > 0 && <span className="text-success font-semibold"> ✓ مُعتمد</span>}
                      </div>
                    </div>
                    <Button onClick={() => openAddon(a.id)} className="mt-auto">شراء الإضافة</Button>
                  </div>
                );
              })}
            </div>
          </Card>

          {addonRequests.length > 0 && (
            <Card title="طلبات الإضافات السابقة">
              <div className="space-y-2">
                {addonRequests.map((r: AddonRequest) => (
                  <div key={r.id} className="flex justify-between items-center p-3 bg-bg-secondary rounded-lg text-sm">
                    <div>
                      <div className="font-medium">{r.addon_type === 'extra_user' ? 'مستخدم إضافي' : r.addon_type === 'extra_branch' ? 'فرع/مستودع إضافي' : 'تخزين إضافي'} ×{r.quantity} - {r.duration_type === 'yearly' ? 'سنوي' : 'شهري'}</div>
                      <div className="text-xs text-text-muted">{new Date(r.created_at).toLocaleDateString()} - ${r.total_amount_usd}</div>
                    </div>
                    <span className={`px-2 py-1 rounded-full text-xs ${r.status === 'pending' ? 'bg-warning-light text-warning font-semibold' : r.status === 'approved' ? 'bg-success-light text-success font-semibold' : 'bg-danger-light text-danger font-semibold'}`}>{r.status === 'pending' ? 'معلق' : r.status === 'approved' ? 'مقبول' : 'مرفوض'}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {activeTab === 'support' && (
        <div className="grid md:grid-cols-2 gap-4">
          <Card title="رسالة جديدة للدعم">
            <div className="space-y-3">
              <select value={supportForm.category} onChange={e => setSupportForm({...supportForm, category: e.target.value})} className="w-full px-3 py-2 bg-bg-secondary border rounded-lg text-sm">
                <option value="billing">دفع/اشتراك</option>
                <option value="technical">مشكلة تقنية</option>
                <option value="account">حسابي</option>
                <option value="data_request">طلب بيانات</option>
                <option value="other">أخرى</option>
              </select>
              <Input placeholder="عنوان الرسالة" value={supportForm.subject} onChange={(e) => setSupportForm({...supportForm, subject: e.target.value})} />
              <textarea value={supportForm.message} onChange={e => setSupportForm({...supportForm, message: e.target.value})} className="w-full px-3 py-2 bg-bg-secondary border rounded-xl text-sm h-32" placeholder="اشرح طلبك بوضوح..."></textarea>
              <Button onClick={submitSupport} disabled={supportSubmitting} leftIcon={supportSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}>{supportSubmitting ? 'جاري الإرسال...' : 'إرسال'}</Button>
              <p className="text-[10px] text-text-muted">تعمل الرسائل حتى مع انتهاء الاشتراك.</p>
            </div>
          </Card>
          <Card title="الرسائل السابقة">
            <div className="space-y-2">
              {supportTickets.length === 0 ? <p className="text-sm text-text-muted">لا توجد رسائل سابقة.</p> :
                supportTickets.map((t: SupportTicket) => (
                  <div key={t.id} className="p-3 bg-bg-secondary rounded-lg text-sm">
                    <div className="flex justify-between"><strong>{t.subject}</strong> <span className={`text-xs ${t.status === 'open' ? 'text-warning font-semibold' : t.status === 'resolved' ? 'text-success font-semibold' : 'text-text-muted'}`}>{t.status === 'open' ? 'مفتوحة' : t.status === 'in_progress' ? 'قيد المعالجة' : t.status === 'resolved' ? 'تم الحل' : 'مغلقة'}</span></div>
                    <div className="text-xs text-text-muted">{new Date(t.created_at).toLocaleDateString()}</div>
                  </div>
                ))}
            </div>
          </Card>
        </div>
      )}

      {activeTab === 'export' && (
        <Card title="تحميل تقارير بياناتك">
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">
              يمكنك تحميل تقارير محاسبية لبيانات شركتك (الحسابات، دفتر اليومية، الفواتير، العملاء، الموردون، المشاريع، العهد، المخزون،...) منسّقة بأسماء عربية واضحة بصيغة <strong>Excel</strong> أو <strong>CSV</strong> في أي وقت — حتى بعد انتهاء الاشتراك — وبيانات شركتك فقط. لا يُحذف شيء دون موافقتك.
            </p>
            <div className="p-3 rounded-xl bg-bg-secondary border border-border text-xs text-text-secondary space-y-1">
              <div>• الصيغتان (Excel / CSV) مقبولتان في البرامج المحاسبية الأخرى عند الاستيراد، لذا يمكنك مراجعة بياناتك أو الانتقال بها لمنصة أخرى بسهولة.</div>
              <div>• لا تتوفر "نسخة من قاعدة البيانات" ولا يمكن استعادة هذه الملفات داخل المنصة — أي إدخال للبيانات يتم يدوياً فقط.</div>
            </div>
            <a href="/export-data" className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-accent text-white text-sm font-semibold hover:opacity-90 transition-opacity">
              <Download size={16} /> فتح صفحة تحميل التقارير (Excel / CSV)
            </a>
          </div>
        </Card>
      )}

      <Modal isOpen={showAddonModal} onClose={() => setShowAddonModal(false)} title={`شراء: ${ADDONS.find(a => a.id === selectedAddon)?.label || ''}`} size="lg">
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-text-muted">الكمية</label>
              <input type="number" min={1} max={100} value={addonQty} onChange={e => setAddonQty(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} className="w-full mt-1 px-3 py-2 bg-bg-secondary border rounded-lg text-sm" />
            </div>
            <div>
              <label className="text-xs text-text-muted">المدة</label>
              <select value={addonDuration} onChange={e => setAddonDuration(e.target.value as 'monthly' | 'yearly')} className="w-full mt-1 px-3 py-2 bg-bg-secondary border rounded-lg text-sm">
                <option value="monthly">شهري - ${addonUnitPrice()}/وحدة</option>
                <option value="yearly">سنوي - ${addonUnitPrice()}/وحدة (توفير 20%)</option>
              </select>
            </div>
          </div>
          <div className="p-3 bg-warning-light border border-warning rounded-xl text-xs text-warning">
            المبلغ المطلوب: <strong>${addonTotal()}</strong>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-text-muted">طريقة الدفع</label>
              <select value={addonForm.payment_method} onChange={e => setAddonForm({...addonForm, payment_method: e.target.value})} className="w-full mt-1 px-3 py-2 bg-bg-secondary border rounded-lg text-sm">
                {paymentMethods.length > 0 ? paymentMethods.map((pm) => (
                  <option key={pm.code} value={pm.code}>{pm.name_ar}</option>
                )) : (<>
                <option value="instapay">انستا باي</option>
                <option value="orange_cash">أورنج كاش</option>
                <option value="bank_transfer">تحويل بنكي</option>
                </>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-text-muted">المبلغ</label>
              <Input type="number" value={addonForm.amount} onChange={(e)=>setAddonForm({...addonForm, amount: e.target.value})} />
            </div>
            <div><label className="text-xs text-text-muted">التاريخ</label><Input type="date" value={addonForm.date} onChange={(e)=>setAddonForm({...addonForm, date: e.target.value})} /></div>
            <div><label className="text-xs text-text-muted">الوقت</label><Input type="time" value={addonForm.time} onChange={(e)=>setAddonForm({...addonForm, time: e.target.value})} /></div>
          </div>
          <div>
            <label className="text-xs text-text-muted">إيصال الدفع (JPG أو PNG أو PDF، حتى 5MB)</label>
            <input
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              disabled={receiptUploading !== null}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadReceipt(file, 'addon');
              }}
              className="w-full mt-1 px-3 py-2 bg-bg-secondary border border-border rounded-xl text-sm"
            />
            {receiptUploading === 'addon' && <p className="text-xs text-text-muted mt-1">جاري رفع الإيصال...</p>}
            {addonForm.receipt_url && <p className="text-xs text-emerald-400 mt-1">تم إرفاق الإيصال بأمان</p>}
          </div>
          <Button onClick={submitAddon} disabled={addonSubmitting || receiptUploading !== null || !addonForm.receipt_url} className="w-full" leftIcon={addonSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}>{addonSubmitting ? 'جاري الإرسال...' : 'رفع طلب الإضافة'}</Button>
        </div>
      </Modal>
    </div>
  );
}
