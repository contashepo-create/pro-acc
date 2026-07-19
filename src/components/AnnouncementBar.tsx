'use client';

import { useState, useEffect } from 'react';
import { Megaphone, X, Gift, Image, Crown, AlertTriangle, Info, Zap, Star } from 'lucide-react';

interface Ad {
  id: string;
  title: string;
  body: string;
  type: string;
  link_url: string | null;
  link_text: string | null;
  show_until?: string | null; // تاريخ انتهاء عرض الإعلان للمستخدم
  created_at: string;
}

// مفتاح التخزين المحلي لتتبع الإعلانات التي رآها المستخدم
const STORAGE_KEY = 'proacc_dismissed_ads';
const SESSION_KEY = 'proacc_session_ads';

// أيقونات حسب النوع
const TYPE_ICONS: Record<string, { icon: any; color: string }> = {
  announcement: { icon: Megaphone, color: 'text-blue-500' },
  promotion: { icon: Gift, color: 'text-green-500' },
  banner: { icon: Image, color: 'text-purple-500' },
  upgrade: { icon: Crown, color: 'text-amber-500' },
  alert: { icon: AlertTriangle, color: 'text-red-500' },
  info: { icon: Info, color: 'text-cyan-500' },
  feature: { icon: Zap, color: 'text-orange-500' },
  premium: { icon: Star, color: 'text-yellow-500' },
};

function getDismissedAds(): Set<string> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return new Set();
    const data = JSON.parse(stored);
    // تنظيف التواريخ المنتهية
    const now = new Date();
    for (const [adId, dismissedAt] of Object.entries(data)) {
      if (new Date(dismissedAt as string) < now) {
        delete data[adId];
      }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return new Set(Object.keys(data));
  } catch {
    return new Set();
  }
}

function dismissAd(adId: string, showUntil?: string | null) {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const data = stored ? JSON.parse(stored) : {};
    // إذا كان هناك تاريخ انتهاء، نخزنه
    if (showUntil) {
      data[adId] = showUntil;
    } else {
      data[adId] = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // يوم واحد افتراضياً
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

export function AnnouncementBar() {
  const [ads, setAds] = useState<Ad[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    // جلب الإعلانات النشطة
    fetch('/api/admin/advertisements?active=true')
      .then((r) => r.json())
      .then((d) => { 
        if (d.success) setAds(d.data || []); 
      })
      .catch(() => {});
    
    // تحميل الإعلانات المخفية
    setDismissed(getDismissedAds());
  }, []);

  // فلترة الإعلانات المرئية
  const visible = ads.filter((ad) => {
    // إخفاء إذا تم إخفاؤه سابقاً
    if (dismissed.has(ad.id)) return false;
    // إخفاء إذا تجاوز تاريخ انتهاء العرض
    if (ad.show_until && new Date(ad.show_until) < new Date()) return false;
    return true;
  });

  const handleDismiss = (ad: Ad) => {
    // حساب مدة الإخفاء
    let showUntil: string;
    if (ad.show_until) {
      // إذا كان للإعلان تاريخ انتهاء، نخفيه حتى ذلك التاريخ
      showUntil = ad.show_until;
    } else {
      // افتراضياً نخفيه لمدة 24 ساعة
      showUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    }
    
    dismissAd(ad.id, showUntil);
    setDismissed((prev) => new Set([...prev, ad.id]));
  };

  if (visible.length === 0) return null;

  return (
    <div className="space-y-2 mb-4">
      {visible.map((ad) => {
        const typeInfo = TYPE_ICONS[ad.type] || TYPE_ICONS.announcement;
        const Icon = typeInfo.icon;
        
        return (
          <div
            key={ad.id}
            className={`flex items-start gap-3 p-3 rounded-lg border text-sm animate-[slide-in_0.3s_ease-out] ${
              ad.type === 'alert'
                ? 'bg-red-50 border-red-200'
                : ad.type === 'promotion'
                ? 'bg-green-50 border-green-200'
                : ad.type === 'upgrade'
                ? 'bg-amber-50 border-amber-200'
                : ad.type === 'banner'
                ? 'bg-purple-50 border-purple-200'
                : ad.type === 'info'
                ? 'bg-cyan-50 border-cyan-200'
                : ad.type === 'feature'
                ? 'bg-orange-50 border-orange-200'
                : ad.type === 'premium'
                ? 'bg-yellow-50 border-yellow-200'
                : 'bg-blue-50 border-blue-200'
            }`}
          >
            <Icon size={16} className={`shrink-0 mt-0.5 ${typeInfo.color}`} />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-text-primary text-xs">{ad.title}</p>
              <p className="text-text-muted text-xs mt-0.5 leading-relaxed">{ad.body}</p>
              {ad.link_url && (
                <a
                  href={ad.link_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline text-xs mt-1 inline-block"
                >
                  {ad.link_text || 'المزيد'}
                </a>
              )}
            </div>
            <button
              onClick={() => handleDismiss(ad)}
              className="shrink-0 text-text-muted hover:text-text-primary transition-colors p-0.5 rounded hover:bg-black/5"
              title="إخفاء الإعلان"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
