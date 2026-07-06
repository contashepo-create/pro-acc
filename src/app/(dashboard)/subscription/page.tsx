'use client';

import { useState, useEffect } from 'react';
import { Check, Loader2, CreditCard, Crown } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';

interface Plan {
  id: string;
  code: string;
  name: string;
  description: string;
  duration_days: number;
  price: number;
  currency: string;
}

interface Subscription {
  id: string;
  plan_name: string;
  status: string;
  start_date: string;
  end_date: string;
}

export default function SubscriptionPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);

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

      {subscription && (
        <div className="glass rounded-xl p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <Crown size={24} className="text-accent" />
            <div>
              <h3 className="font-bold text-text-primary">اشتراكك الحالي</h3>
              <p className="text-sm text-text-muted">
                {subscription.plan_name} — {subscription.status === 'trial' ? 'تجريبي' : subscription.status === 'active' ? 'نشط' : subscription.status}
              </p>
            </div>
          </div>
          <div className="text-sm text-text-secondary">
            <span>تاريخ الانتهاء: </span>
            <span className="font-medium text-text-primary" dir="ltr">{subscription.end_date}</span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {plans.map((plan) => {
          const isCurrent = subscription?.plan_name === plan.name;
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
                <span className="text-3xl font-bold text-text-primary">{plan.price.toLocaleString()}</span>
                <span className="text-sm text-text-muted mr-1">{plan.currency}</span>
                <span className="text-xs text-text-muted block mt-0.5">
                  / {plan.duration_days} يوم
                </span>
              </div>

              <ul className="space-y-2 mb-6 flex-1">
                <li className="flex items-center gap-2 text-sm text-text-secondary">
                  <Check size={16} className="text-success shrink-0" />
                  نظام محاسبة متكامل
                </li>
                <li className="flex items-center gap-2 text-sm text-text-secondary">
                  <Check size={16} className="text-success shrink-0" />
                  فواتير ومشتريات
                </li>
                <li className="flex items-center gap-2 text-sm text-text-secondary">
                  <Check size={16} className="text-success shrink-0" />
                  تقارير مالية
                </li>
                <li className="flex items-center gap-2 text-sm text-text-secondary">
                  <Check size={16} className="text-success shrink-0" />
                  دعم فني
                </li>
              </ul>

              <button
                disabled={isCurrent}
                className={`btn w-full h-10 text-sm ${
                  isCurrent
                    ? 'bg-accent/20 text-accent cursor-default'
                    : 'btn-primary'
                }`}
              >
                {isCurrent ? 'الاشتراك الحالي' : plan.price === 0 ? 'تجربة مجانية' : 'اشتراك'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
