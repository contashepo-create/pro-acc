'use client';

import { useState, useEffect } from 'react';
import { AlertTriangle, Crown, X, Download, MessageSquare } from 'lucide-react';
import Link from 'next/link';

/**
 * تنبيه حالة الاشتراك — تباين عالٍ إلزامي:
 * هذا التنبيه قد يكون آخر ما يراه مشترك انتهت صلاحيته، لذلك الخلفية صلبة
 * قوية والنص أبيض/أسود صريح والأزرار بيضاء بنص داكن — بلا ألوان شفافة
 * أو نصوص فاتحة على خلفيات فاتحة.
 */
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
  const expired = info.is_expired;

  return (
    <div
      role="alert"
      className={`rounded-xl p-3 mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-sm font-semibold shadow-lg border-2 ${
        expired
          ? 'bg-red-600 border-red-400 text-white'
          : 'bg-amber-400 border-amber-300 text-gray-900'
      }`}
    >
      <div className="flex items-center gap-2">
        {expired ? <AlertTriangle size={18} className="shrink-0" /> : <Crown size={18} className="shrink-0" />}
        <span>
          {isTrialExpired
            ? 'انتهت الفترة التجريبية. يمكنك الاشتراك أو إدخال كود تفعيل أو التواصل مع الدعم، أو تحميل تقارير بياناتك (Excel/CSV).'
            : expired
              ? 'اشتراكك منتهي. يمكنك التجديد أو إدخال كود تفعيل أو التواصل مع الدعم، أو تحميل تقارير بياناتك (Excel/CSV).'
              : `سيتم انتهاء اشتراكك خلال ${info.days_remaining} أيام (${info.end_date}).`}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0 flex-wrap">
        <Link
          href="/subscription"
          className={`px-3 py-1.5 rounded-lg font-bold text-xs inline-flex items-center gap-1 transition-colors ${
            expired
              ? 'bg-white text-red-700 hover:bg-red-50'
              : 'bg-gray-900 text-white hover:bg-black'
          }`}
        >
          <Crown size={14} /> {expired ? 'تجديد/اشتراك' : 'تفاصيل الاشتراك'}
        </Link>
        <Link
          href="/subscription?tab=support"
          className={`px-3 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-1 border transition-colors ${
            expired
              ? 'bg-red-700 text-white border-red-400 hover:bg-red-500'
              : 'bg-amber-500 text-gray-900 border-amber-600 hover:bg-amber-300'
          }`}
        >
          <MessageSquare size={14} /> تواصل مع الدعم
        </Link>
        {expired && (
          <Link
            href="/export-data"
            className="px-3 py-1.5 rounded-lg bg-red-700 text-white border border-red-400 hover:bg-red-500 transition-colors text-xs font-bold inline-flex items-center gap-1"
          >
            <Download size={14} /> تحميل تقارير بياناتي
          </Link>
        )}
        <button
          onClick={() => setDismissed(true)}
          aria-label="إغلاق التنبيه"
          className={`p-1 rounded-lg transition-colors ${
            expired ? 'hover:bg-red-500 text-white' : 'hover:bg-amber-500 text-gray-900'
          }`}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
