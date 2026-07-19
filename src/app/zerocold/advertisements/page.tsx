'use client';

import { useState, useEffect } from 'react';
import { 
  Megaphone, Plus, Loader2, Trash2, EyeOff, Eye,
  Gift, Image, Crown, AlertTriangle, Info, Bell, Zap, Star
} from 'lucide-react';

interface Ad {
  id: string;
  title: string;
  body: string;
  type: string;
  is_active: boolean;
  link_url: string | null;
  link_text: string | null;
  starts_at: string;
  expires_at: string | null;
  created_at: string;
}

// تعريف كل نوع مع الأيقونة واللون الخاص به
const AD_TYPES: Record<string, { label: string; icon: any; iconClass: string; bgClass: string; badgeClass: string; description: string }> = {
  announcement: {
    label: 'إعلان',
    icon: Megaphone,
    iconClass: 'text-blue-500',
    bgClass: 'bg-blue-50 border-blue-200',
    badgeClass: 'bg-blue-100 text-blue-700 border-blue-200',
    description: 'إعلان عام للمستخدمين',
  },
  promotion: {
    label: 'ترويج',
    icon: Gift,
    iconClass: 'text-green-500',
    bgClass: 'bg-green-50 border-green-200',
    badgeClass: 'bg-green-100 text-green-700 border-green-200',
    description: 'عرض ترويجي أو خصم',
  },
  banner: {
    label: 'بانر',
    icon: Image,
    iconClass: 'text-purple-500',
    bgClass: 'bg-purple-50 border-purple-200',
    badgeClass: 'bg-purple-100 text-purple-700 border-purple-200',
    description: 'بانر إعلاني',
  },
  upgrade: {
    label: 'ترقية',
    icon: Crown,
    iconClass: 'text-amber-500',
    bgClass: 'bg-amber-50 border-amber-200',
    badgeClass: 'bg-amber-100 text-amber-700 border-amber-200',
    description: 'رسالة ترقية الباقة',
  },
  alert: {
    label: 'تنبيه',
    icon: AlertTriangle,
    iconClass: 'text-red-500',
    bgClass: 'bg-red-50 border-red-200',
    badgeClass: 'bg-red-100 text-red-700 border-red-200',
    description: 'تنبيه مهم أو عاجل',
  },
  info: {
    label: 'معلومة',
    icon: Info,
    iconClass: 'text-cyan-500',
    bgClass: 'bg-cyan-50 border-cyan-200',
    badgeClass: 'bg-cyan-100 text-cyan-700 border-cyan-200',
    description: 'معلومة أو نصيحة',
  },
  feature: {
    label: 'ميزة جديدة',
    icon: Zap,
    iconClass: 'text-orange-500',
    bgClass: 'bg-orange-50 border-orange-200',
    badgeClass: 'bg-orange-100 text-orange-700 border-orange-200',
    description: 'إعلان عن ميزة جديدة',
  },
  premium: {
    label: 'حصري',
    icon: Star,
    iconClass: 'text-yellow-500',
    bgClass: 'bg-yellow-50 border-yellow-200',
    badgeClass: 'bg-yellow-100 text-yellow-700 border-yellow-200',
    description: 'محتوى حصري أو مميز',
  },
};

export default function AdminAdvertisementsPage() {
  const [ads, setAds] = useState<Ad[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [type, setType] = useState('announcement');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkText, setLinkText] = useState('');
  const [showDuration, setShowDuration] = useState('7'); // أيام
  const [saving, setSaving] = useState(false);

  const loadAds = async () => {
    const res = await fetch('/api/admin/advertisements');
    const data = await res.json();
    if (data.success) setAds(data.data);
    setLoading(false);
  };

  useEffect(() => {
    loadAds();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;
    setSaving(true);
    await fetch('/api/admin/advertisements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body, type, linkUrl, linkText, showDuration }),
    });
    setTitle(''); setBody(''); setLinkUrl(''); setLinkText(''); setShowDuration('7');
    setShowForm(false);
    setSaving(false);
    loadAds();
  };

  const toggleActive = async (id: string, current: boolean) => {
    await fetch('/api/admin/advertisements', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, isActive: !current }),
    });
    loadAds();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('حذف هذا الإعلان؟')) return;
    await fetch('/api/admin/advertisements', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    loadAds();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
            <Megaphone size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-text-primary">الإعلانات</h1>
            <p className="text-xs text-text-muted">{ads.length} إعلان — كل نوع بلون وأيقونة مختلفة</p>
          </div>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="btn btn-primary text-sm gap-2">
          <Plus size={16} /> إعلان جديد
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="glass rounded-xl p-6 mb-6">
          <h3 className="font-bold text-text-primary mb-4">إعلان جديد</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">العنوان</label>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="input-base w-full" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">النوع</label>
              <select value={type} onChange={(e) => setType(e.target.value)} className="input-base w-full">
                {Object.entries(AD_TYPES).map(([key, val]) => (
                  <option key={key} value={key}>{val.label} — {val.description}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-text-secondary mb-1.5">النص</label>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} className="input-base w-full min-h-[80px] resize-none" rows={3} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">رابط (اختياري)</label>
              <input type="url" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} className="input-base w-full" placeholder="https://" />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">نص الرابط</label>
              <input type="text" value={linkText} onChange={(e) => setLinkText(e.target.value)} className="input-base w-full" placeholder="اعرف المزيد" />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">مدة العرض (أيام)</label>
              <input type="number" min="1" max="365" value={showDuration} onChange={(e) => setShowDuration(e.target.value)} className="input-base w-full" placeholder="7" />
              <p className="text-[10px] text-text-muted mt-1">سيتم إخفاء الإعلان تلقائياً بعد هذه المدة لكل مستخدم</p>
            </div>
          </div>
          {/* معاينة النوع المختار */}
          {AD_TYPES[type] && (() => {
            const t = AD_TYPES[type];
            const Icon = t.icon;
            return (
              <div className={`mb-4 p-3 rounded-lg border flex items-center gap-3 ${t.bgClass}`}>
                <Icon size={20} className={t.iconClass} />
                <span className="text-sm font-medium">معاينة: {t.label} — {t.description}</span>
              </div>
            );
          })()}
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="btn btn-primary text-sm gap-2">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              حفظ
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="btn btn-ghost text-sm">إلغاء</button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-accent" /></div>
      ) : (
        <div className="space-y-4">
          {ads.map((ad) => {
            const typeInfo = AD_TYPES[ad.type] || AD_TYPES.announcement;
            const Icon = typeInfo.icon;
            
            return (
              <div 
                key={ad.id} 
                className={`glass rounded-xl p-5 border-r-4 ${!ad.is_active ? 'opacity-60' : ''}`}
                style={{ borderRightColor: ad.type === 'alert' ? '#ef4444' : ad.type === 'promotion' ? '#22c55e' : ad.type === 'banner' ? '#a855f7' : ad.type === 'upgrade' ? '#f59e0b' : ad.type === 'info' ? '#06b6d4' : ad.type === 'feature' ? '#f97316' : ad.type === 'premium' ? '#eab308' : '#3b82f6' }}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-start gap-4 flex-1">
                    {/* أيقونة مميزة لكل نوع */}
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${typeInfo.bgClass}`}>
                      <Icon size={22} className={typeInfo.iconClass} />
                    </div>
                    
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1.5">
                        <h3 className="font-bold text-text-primary text-lg">{ad.title}</h3>
                        <span className={`text-xs px-2.5 py-0.5 rounded-full border ${typeInfo.badgeClass}`}>
                          {typeInfo.label}
                        </span>
                        {!ad.is_active && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200">
                            مخفي
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-text-secondary leading-relaxed">{ad.body}</p>
                      {ad.link_url && (
                        <a href={ad.link_url} target="_blank" className="text-xs text-accent hover:underline mt-2 inline-block">
                          {ad.link_text || ad.link_url}
                        </a>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => toggleActive(ad.id, ad.is_active)} className="btn btn-ghost btn-icon" title={ad.is_active ? 'إخفاء' : 'إظهار'}>
                      {ad.is_active ? <Eye size={16} /> : <EyeOff size={16} />}
                    </button>
                    <button onClick={() => handleDelete(ad.id)} className="btn btn-ghost btn-icon text-danger" title="حذف">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                <p className="text-xs text-text-muted mt-2" dir="ltr">
                  {new Date(ad.created_at).toLocaleString('ar-SA')}
                </p>
              </div>
            );
          })}
          {ads.length === 0 && (
            <div className="text-text-muted text-sm text-center py-12">
              <Megaphone size={40} className="mx-auto mb-3 opacity-30" />
              <p>لا توجد إعلانات</p>
              <p className="text-xs mt-1">اضغط "إعلان جديد" لإنشاء أول إعلان</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
