'use client';

import { useState, useEffect } from 'react';
import { AlertTriangle, Crown, X, Download, MessageSquare } from 'lucide-react';
import Link from 'next/link';

export function SubscriptionBanner() {
  const [info, setInfo] = useState<{
    is_expired: boolean;
    is_trial_expired?: boolean;
    is_expiring_soon: boolean;
    days_remaining: number;
    plan_name: string | null;
    end_date: string;
    status: string | null;
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

  const isTrialExpired = info.status === 'trial' && info.is_expired;

  return (
    <div className={`rounded-xl p-3 mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-sm ${
      info.is_expired
        ? 'bg-red-950/20 border border-red-800/40 text-red-300'
        : 'bg-amber-950/20 border border-amber-800/40 text-amber-300'
    }`}>
      <div className="flex items-center gap-2">
        {info.is_expired ? <AlertTriangle size={18} className="shrink-0" /> : <Crown size={18} className="shrink-0" />}
        <span>
          {isTrialExpired
            ? 'انتهت الفترة التجريبية. يمكنك الاشتراك أو إدخال كود تفعيل أو التواصل مع الدعم، أو تحميل جداول بياناتك (Excel/CSV).'
            : info.is_expired
              ? 'اشتراكك منتهي. يمكنك التجديد أو إدخال كود تفعيل أو التواصل مع الدعم، أو تحميل جداول بياناتك (Excel/CSV).'
              : `سيتم انتهاء اشتراكك خلال ${info.days_remaining} أيام (${info.end_date}).`}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0 flex-wrap">
        <Link
          href="/subscription"
          className="px-3 py-1.5 rounded-lg bg-accent/20 text-accent hover:bg-accent/30 transition-colors text-xs font-medium inline-flex items-center gap-1"
        >
          <Crown size={14} /> {info.is_expired ? 'تجديد/اشتراك' : 'تفاصيل الاشتراك'}
        </Link>
        <Link
          href="/subscription?tab=support"
          className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors text-xs font-medium inline-flex items-center gap-1"
        >
          <MessageSquare size={14} /> تواصل مع الدعم
        </Link>
        {info.is_expired && (
          <Link
            href="/export-data"
            className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors text-xs font-medium inline-flex items-center gap-1"
          >
            <Download size={14} /> تحميل جداول بياناتي
          </Link>
        )}
        <button onClick={() => setDismissed(true)} className="p-1 hover:bg-black/10 rounded-lg transition-colors">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
