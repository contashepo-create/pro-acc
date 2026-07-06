'use client';

import { useState, useEffect } from 'react';
import { Megaphone, X } from 'lucide-react';

interface Ad {
  id: string;
  title: string;
  body: string;
  type: string;
  link_url: string | null;
  link_text: string | null;
}

export function AnnouncementBar() {
  const [ads, setAds] = useState<Ad[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch('/api/admin/advertisements?active=true')
      .then((r) => r.json())
      .then((d) => { if (d.success) setAds(d.data); })
      .catch(() => {});
  }, []);

  const visible = ads.filter((a) => !dismissed.has(a.id));

  if (visible.length === 0) return null;

  return (
    <div className="space-y-2 mb-4">
      {visible.map((ad) => (
        <div
          key={ad.id}
          className={`flex items-start gap-3 p-3 rounded-lg border text-sm ${
            ad.type === 'banner'
              ? 'bg-accent/10 border-accent/30'
              : ad.type === 'promotion'
              ? 'bg-success/10 border-success/30'
              : 'bg-bg-hover border-border'
          }`}
        >
          <Megaphone size={16} className="shrink-0 mt-0.5 text-accent" />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-text-primary text-xs">{ad.title}</p>
            <p className="text-text-muted text-xs mt-0.5">{ad.body}</p>
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
            onClick={() => setDismissed((prev) => new Set(prev).add(ad.id))}
            className="shrink-0 text-text-muted hover:text-text-primary transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
