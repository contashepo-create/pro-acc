'use client';

import { useState, useEffect } from 'react';
import { Check, Loader2, CreditCard, Crown, AlertTriangle } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';

interface Plan {
  id: string;
  code: string;
  name: string;
  description: string;
  duration_days: number;
  price: number;
  price_monthly?: number;
  price_yearly?: number;
  currency: string;
  features?: string[];
}

interface Subscription {
  id: string;
  plan_id: string;
  plan_name: string;
  plan_code: string;
  status: string;
  start_date: string;
  end_date: string;
}

export default function SubscriptionPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [subscribing, setSubscribing] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    fetch('/api/auth/subscription')
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setPlans(d.data.plans);
          setSubscription(d.data.subscription);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSubscribe = async (planCode: string) => {
    setSubscribing(planCode);
    setMessage(null);
    try {
      const res = await fetch('/api/auth/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planCode }),
      });
      const d = await res.json();
      if (d.success) {
        setMessage({ type: 'success', text: 'تم التبديل إلى الباقة بنجاح' });
        setSubscription(d.data.subscription);
      } else {
        setMessage({ type: 'error', text: d.message || 'حدث خطأ' });
      }
    } catch {
      setMessage({ type: 'error', text: 'حدث خطأ في الاتصال بالخادم' });
    } finally {
      setSubscribing(null);
    }
  };

  const isExpired = subscription && new Date(subscription.end_date) < new Date(new Date().toDateString());

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={32} className="animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="الباقات والاشتراك" icon={CreditCard} />

      {message && (
        <div className={`glass rounded-xl p-4 mb-6 text-sm flex items-center gap-2 ${
          message.type === 'success' ? 'text-success border border-success/20' : 'text-danger border border-danger/20'
        }`}>
          {message.type === 'success' ? <Check size={18} /> : <AlertTriangle size={18} />}
          {message.text}
        </div>
      )}

      {subscription && (
        <div className={`glass rounded-xl p-6 mb-6 ${isExpired ? 'border border-danger/30' : ''}`}>
          <div className="flex items-center gap-3 mb-4">
            {isExpired ? <AlertTriangle size={24} className="text-danger" /> : <Crown size={24} className="text-accent" />}
            <div>
              <h3 className="font-bold text-text-primary">اشتراكك الحالي</h3>
              <p className="text-sm text-text-muted">
                {subscription.plan_name}
                {subscription.status === 'trial' ? ' — تجريبي' : ''}
                {isExpired ? ' — منتهي' : ''}
              </p>
            </div>
          </div>
          <div className="text-sm text-text-secondary">
            <span>تاريخ الانتهاء: </span>
            <span className={`font-medium ${isExpired ? 'text-danger' : 'text-text-primary'}`} dir="ltr">
              {subscription.end_date}
            </span>
            {isExpired && (
              <span className="text-danger mr-2">(منتهي — يرجى تجديد الاشتراك)</span>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {plans.map((plan) => {
          const isCurrent = subscription?.plan_code === plan.code;
          const features = plan.features || [
            'نظام محاسبة متكامل',
            'فواتير ومشتريات',
            'تقارير مالية',
            'دعم فني',
          ];
          return (
            <div
              key={plan.id}
              className={`glass rounded-xl p-6 flex flex-col transition-all duration-200 hover:shadow-modal ${
                isCurrent ? 'ring-2 ring-accent' : ''
              }`}
            >
              <div className="mb-4">
                <h3 className="text-lg font-bold text-text-primary">{plan.name}</h3>
                {plan.description && (
                  <p className="text-xs text-text-muted mt-1">{plan.description}</p>
                )}
              </div>

              <div className="mb-6">
                <span className="text-3xl font-bold text-text-primary">
                  {(plan.price_monthly ?? plan.price).toLocaleString()}
                </span>
                <span className="text-sm text-text-muted mr-1">{plan.currency}</span>
                <span className="text-xs text-text-muted block mt-0.5">/ شهرياً</span>
                {plan.price_yearly != null && plan.price_yearly > 0 && (
                  <span className="text-xs text-text-muted block mt-0.5">
                    {plan.price_yearly.toLocaleString()} {plan.currency} / سنوياً
                  </span>
                )}
              </div>

              <ul className="space-y-2 mb-6 flex-1">
                {features.map((f, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm text-text-secondary">
                    <Check size={16} className="text-success shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>

              <button
                disabled={isCurrent || subscribing === plan.code}
                onClick={() => handleSubscribe(plan.code)}
                className={`btn w-full h-10 text-sm ${
                  isCurrent
                    ? 'bg-accent/20 text-accent cursor-default'
                    : 'btn-primary'
                }`}
              >
                {subscribing === plan.code ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : isCurrent ? (
                  'الاشتراك الحالي'
                ) : plan.price === 0 ? (
                  'تجربة مجانية'
                ) : (
                  'اشتراك'
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
