'use client';

import { useState, useEffect } from 'react';
import { AlertTriangle, Crown, X } from 'lucide-react';
import Link from 'next/link';

export function SubscriptionBanner() {
  const [info, setInfo] = useState<{
    is_expired: boolean;
    is_expiring_soon: boolean;
    days_remaining: number;
    plan_name: string | null;
    end_date: string;
  } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    fetch('/api/auth/subscription-status')
      .then((r) => r.json())
      .then((d) => {
        if (d.success && d.data) setInfo(d.data);
      })
      .catch(() => {});
  }, []);

  if (!info || dismissed) return null;
  if (!info.is_expired && !info.is_expiring_soon) return null;

  return (
    <div className={`rounded-xl p-3 mb-4 flex items-center justify-between gap-3 text-sm ${
      info.is_expired
        ? 'bg-danger/10 border border-danger/20 text-danger'
        : 'bg-warning/10 border border-warning/20 text-warning'
    }`}>
      <div className="flex items-center gap-2">
        {info.is_expired ? <AlertTriangle size={18} /> : <Crown size={18} />}
        <span>
          {info.is_expired
            ? 'اشتراكك منتهي. يرجى تجديد الاشتراك للاستمرار في استخدام النظام.'
            : `سيتم انتهاء اشتراكك خلال ${info.days_remaining} أيام (${info.end_date}).`}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Link
          href="/subscription"
          className="px-3 py-1.5 rounded-lg bg-accent/20 text-accent hover:bg-accent/30 transition-colors text-xs font-medium"
        >
          تجديد الاشتراك
        </Link>
        <button onClick={() => setDismissed(true)} className="p-1 hover:bg-black/10 rounded-lg transition-colors">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
