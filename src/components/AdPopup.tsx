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

const TYPE_ICONS: Record<string, { icon: any; color: string; bg: string }> = {
  announcement: { icon: Gift, color: 'text-blue-600', bg: 'bg-blue-100' },
  promotion: { icon: Gift, color: 'text-green-600', bg: 'bg-green-100' },
  banner: { icon: Image, color: 'text-purple-600', bg: 'bg-purple-100' },
  upgrade: { icon: Crown, color: 'text-amber-600', bg: 'bg-amber-100' },
  alert: { icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-100' },
  info: { icon: Info, color: 'text-cyan-600', bg: 'bg-cyan-100' },
  feature: { icon: Zap, color: 'text-orange-600', bg: 'bg-orange-100' },
  premium: { icon: Star, color: 'text-yellow-600', bg: 'bg-yellow-100' },
};

const STORAGE_KEY = 'proacc_dismissed_popups';
const SESSION_KEY = 'proacc_popup_shown_this_session';

function getDismissedPopups(): Set<string> {
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

function dismissPopup(adId: string, showUntil?: string | null) {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const data = stored ? JSON.parse(stored) : {};
    if (showUntil) {
      data[adId] = showUntil;
    } else {
      data[adId] = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

function hasShownThisSession(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === 'true';
  } catch {
    return false;
  }
}

function markShownThisSession() {
  try {
    sessionStorage.setItem(SESSION_KEY, 'true');
  } catch {}
}

export function AdPopup() {
  const [ads, setAds] = useState<Ad[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [showPopup, setShowPopup] = useState(false);

  useEffect(() => {
    // التحقق من عدم العرض في هذه الجلسة
    if (hasShownThisSession()) return;

    fetch('/api/admin/advertisements?active=true&display_mode=popup')
      .then((r) => r.json())
      .then((d) => { 
        if (d.success) setAds(d.data || []); 
      })
      .catch(() => {});
    
    setDismissed(getDismissedPopups());
  }, []);

  useEffect(() => {
    const visible = ads.filter((ad) => !dismissed.has(ad.id));
    if (visible.length > 0 && !hasShownThisSession()) {
      // تأخير بسيط للعرض
      const timer = setTimeout(() => {
        setShowPopup(true);
        markShownThisSession();
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [ads, dismissed]);

  if (!showPopup || ads.length === 0) return null;

  const ad = ads.filter((a) => !dismissed.has(a.id))[0];
  if (!ad) return null;

  const typeInfo = TYPE_ICONS[ad.type] || TYPE_ICONS.announcement;
  const Icon = typeInfo.icon;

  const handleClose = () => {
    dismissPopup(ad.id, ad.show_until);
    setDismissed((prev) => new Set([...prev, ad.id]));
    setShowPopup(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-[fade-in_0.2s_ease-out]">
      <div className="relative w-full max-w-lg bg-bg-card rounded-2xl shadow-2xl border border-border overflow-hidden animate-[scale-in_0.3s_ease-out]">
        {/* Header */}
        <div className={`p-6 ${typeInfo.bg}`}>
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <div className={`w-16 h-16 rounded-2xl bg-white/50 backdrop-blur-sm flex items-center justify-center`}>
                <Icon size={32} className={typeInfo.color} />
              </div>
              <div className="flex-1">
                <h2 className="text-2xl font-bold text-text-primary mb-1">{ad.title}</h2>
                <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${typeInfo.bg} ${typeInfo.color} border border-current/20`}>
                  {ad.type}
                </span>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="shrink-0 w-10 h-10 rounded-xl bg-white/50 hover:bg-white/80 flex items-center justify-center transition-colors"
              title="إغلاق"
            >
              <X size={20} className="text-text-primary" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6">
          <p className="text-text-secondary leading-relaxed text-base mb-6">{ad.body}</p>
          
          {ad.link_url && (
            <a
              href={ad.link_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3 bg-accent text-white rounded-xl hover:bg-accent/90 transition-colors font-medium shadow-lg"
            >
              {ad.link_text || 'المزيد'}
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </a>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6">
          <button
            onClick={handleClose}
            className="w-full py-3 text-text-muted hover:text-text-primary transition-colors font-medium"
          >
            لا أهتم، أغلق النافذة
          </button>
        </div>
      </div>
    </div>
  );
}
