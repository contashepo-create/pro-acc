'use client';

import { useState, useEffect } from 'react';
import { Gift, Image, Crown, AlertTriangle, Info, Zap, Star, X } from 'lucide-react';

interface Ad {
  id: string;
  title: string;
  body: string;
  type: string;
  link_url: string | null;
  link_text: string | null;
  priority: number;
}

const TYPE_ICONS: Record<string, { icon: any; gradient: string }> = {
  announcement: { icon: Gift, gradient: 'from-blue-500 to-blue-600' },
  promotion: { icon: Gift, gradient: 'from-green-500 to-emerald-600' },
  banner: { icon: Image, gradient: 'from-purple-500 to-purple-600' },
  upgrade: { icon: Crown, gradient: 'from-amber-500 to-orange-600' },
  alert: { icon: AlertTriangle, gradient: 'from-red-500 to-red-600' },
  info: { icon: Info, gradient: 'from-cyan-500 to-cyan-600' },
  feature: { icon: Zap, gradient: 'from-orange-500 to-red-600' },
  premium: { icon: Star, gradient: 'from-yellow-500 to-amber-600' },
};

const STORAGE_KEY = 'proacc_dismissed_banners';

function getDismissedBanners(): Set<string> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return new Set();
    return new Set(JSON.parse(stored));
  } catch {
    return new Set();
  }
}

function dismissBanner(adId: string) {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const data = stored ? JSON.parse(stored) : [];
    if (!data.includes(adId)) {
      data.push(adId);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }
  } catch {}
}

export function AdBanner() {
  const [ads, setAds] = useState<Ad[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch('/api/admin/advertisements?active=true&display_mode=banner')
      .then((r) => r.json())
      .then((d) => { 
        if (d.success) setAds(d.data || []); 
      })
      .catch(() => {});
    
    setDismissed(getDismissedBanners());
  }, []);

  const visible = ads.filter((ad) => !dismissed.has(ad.id));

  if (visible.length === 0) return null;

  const ad = visible[0]; // عرض أول إعلان فقط
  const typeInfo = TYPE_ICONS[ad.type] || TYPE_ICONS.announcement;
  const Icon = typeInfo.icon;

  const handleDismiss = () => {
    dismissBanner(ad.id);
    setDismissed((prev) => new Set([...prev, ad.id]));
  };

  return (
    <div className={`relative overflow-hidden rounded-xl bg-gradient-to-r ${typeInfo.gradient} shadow-lg`}>
      <div className="absolute inset-0 bg-black/10"></div>
      <div className="relative p-6 text-white">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4 flex-1">
            <div className="w-14 h-14 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <Icon size={28} className="text-white" />
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-bold mb-2">{ad.title}</h3>
              <p className="text-white/90 leading-relaxed">{ad.body}</p>
              {ad.link_url && (
                <a
                  href={ad.link_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 mt-4 px-4 py-2 bg-white/20 backdrop-blur-sm rounded-lg hover:bg-white/30 transition-colors font-medium"
                >
                  {ad.link_text || 'المزيد'}
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </a>
              )}
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="shrink-0 w-8 h-8 rounded-lg bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors"
            title="إخفاء"
          >
            <X size={16} className="text-white" />
          </button>
        </div>
      </div>
    </div>
  );
}
