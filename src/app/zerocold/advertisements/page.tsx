'use client';

import { useState, useEffect } from 'react';
import { 
  Megaphone, Plus, Loader2, Trash2, EyeOff, Eye, Edit2, BarChart3, Users,
  Gift, Image, Crown, AlertTriangle, Info, Bell, Zap, Star
} from 'lucide-react';

interface Ad {
  id: string;
  title: string;
  body: string;
  type: string;
  display_mode?: string;
  views?: number;
  clicks?: number;
  notifications_sent?: number;
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
  const [editingAd, setEditingAd] = useState<Ad | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [type, setType] = useState('announcement');
  const [displayMode, setDisplayMode] = useState('banner');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkText, setLinkText] = useState('');
  const [showDuration, setShowDuration] = useState('7'); // أيام
  const [saving, setSaving] = useState(false);
  const [showTracking, setShowTracking] = useState(false);
  const [selectedAdId, setSelectedAdId] = useState<string | null>(null);
  const [trackingData, setTrackingData] = useState<any>(null);
  const [loadingTracking, setLoadingTracking] = useState(false);

  const loadAds = async () => {
    const res = await fetch('/api/admin/advertisements');
    const data = await res.json();
    if (data.success) setAds(data.data);
    setLoading(false);
  };

  const loadTrackingData = async (adId: string) => {
    setLoadingTracking(true);
    try {
      const res = await fetch(`/api/admin/advertisements/tracking?ad_id=${adId}`);
      const data = await res.json();
      if (data.success) {
        setTrackingData(data.data);
        setSelectedAdId(adId);
        setShowTracking(true);
      }
    } catch (error) {
      console.error('Failed to load tracking data:', error);
    } finally {
      setLoadingTracking(false);
    }
  };

  useEffect(() => {
    loadAds();
  }, []);

  const openAddModal = () => {
    setEditingAd(null);
    setTitle(''); setBody(''); setType('announcement'); setDisplayMode('banner'); setLinkUrl(''); setLinkText(''); setShowDuration('7');
    setShowForm(true);
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

  const handleEdit = (ad: Ad) => {
    setEditingAd(ad);
    setTitle(ad.title);
    setBody(ad.body);
    setType(ad.type);
    setDisplayMode(ad.display_mode || 'banner');
    setLinkUrl(ad.link_url || '');
    setLinkText(ad.link_text || '');
    setShowForm(true);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;
    setSaving(true);
    await fetch('/api/admin/advertisements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body, type, display_mode: displayMode, linkUrl, linkText, showDuration }),
    });
    setTitle(''); setBody(''); setDisplayMode('banner'); setLinkUrl(''); setLinkText(''); setShowDuration('7');
    setShowForm(false);
    setSaving(false);
    loadAds();
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;
    setSaving(true);
    await fetch('/api/admin/advertisements', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        id: editingAd?.id, 
        title, 
        body, 
        type, 
        display_mode: displayMode,
        linkUrl, 
        linkText 
      }),
    });
    setEditingAd(null);
    setTitle(''); setBody(''); setDisplayMode('banner'); setLinkUrl(''); setLinkText(''); setShowDuration('7');
    setShowForm(false);
    setSaving(false);
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
        <button onClick={openAddModal} className="btn btn-primary text-sm gap-2">
          <Plus size={16} /> إعلان جديد
        </button>
      </div>

      {showForm && (
        <form onSubmit={editingAd ? handleUpdate : handleCreate} className="glass rounded-xl p-6 mb-6">
          <h3 className="font-bold text-text-primary mb-4">{editingAd ? `تعديل: ${editingAd.title}` : 'إعلان جديد'}</h3>
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
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">طريقة العرض</label>
              <select value={displayMode} onChange={(e) => setDisplayMode(e.target.value)} className="input-base w-full">
                <option value="banner">بانر — عرض كاملاً في الصفحة</option>
                <option value="popup">نافذة منبثقة — تظهر عند التحميل</option>
                <option value="notification">إشعار — داخل أيقونة الإشعارات</option>
              </select>
              <p className="text-[10px] text-text-muted mt-1">حدد كيف سيظهر الإعلان للمستخدمين</p>
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
            {!editingAd && (
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">مدة العرض (أيام)</label>
                <input type="number" min="1" max="365" value={showDuration} onChange={(e) => setShowDuration(e.target.value)} className="input-base w-full" placeholder="7" />
                <p className="text-[10px] text-text-muted mt-1">سيتم إخفاء الإعلان تلقائياً بعد هذه المدة لكل مستخدم</p>
              </div>
            )}
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
              {saving ? <Loader2 size={16} className="animate-spin" /> : editingAd ? <Edit2 size={16} /> : <Plus size={16} />}
              {editingAd ? 'تحديث' : 'حفظ'}
            </button>
            <button type="button" onClick={() => { setShowForm(false); setEditingAd(null); }} className="btn btn-ghost text-sm">إلغاء</button>
          </div>
        </form>
      )}

      {/* قسم عرض التتبع والإحصائيات */}
      {showTracking && trackingData && (
        <div className="glass rounded-xl p-6 mb-6 border border-accent/30">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-text-primary flex items-center gap-2">
              <BarChart3 size={20} className="text-accent" />
              إحصائيات وتتبع الإعلان
            </h3>
            <button onClick={() => setShowTracking(false)} className="btn btn-ghost btn-icon">
              ✕
            </button>
          </div>

          {/* بطاقات الإحصائيات */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-center gap-2 text-blue-600 mb-2">
                <Eye size={18} />
                <span className="text-sm font-medium">المشاهدات</span>
              </div>
              <div className="text-2xl font-bold text-blue-700">{trackingData.statistics.totalViews}</div>
              <div className="text-xs text-blue-600 mt-1">
                {trackingData.statistics.uniqueCompaniesViewed} شركة • {trackingData.statistics.uniqueUsersViewed} مستخدم
              </div>
            </div>
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="flex items-center gap-2 text-green-600 mb-2">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
                </svg>
                <span className="text-sm font-medium">النقرات</span>
              </div>
              <div className="text-2xl font-bold text-green-700">{trackingData.statistics.totalClicks}</div>
              <div className="text-xs text-green-600 mt-1">
                {trackingData.statistics.totalViews > 0 
                  ? `${((trackingData.statistics.totalClicks / trackingData.statistics.totalViews) * 100).toFixed(1)}% معدل النقر`
                  : '-'
                }
              </div>
            </div>
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
              <div className="flex items-center gap-2 text-purple-600 mb-2">
                <Bell size={18} />
                <span className="text-sm font-medium">الإشعارات</span>
              </div>
              <div className="text-2xl font-bold text-purple-700">{trackingData.statistics.totalNotifications}</div>
              <div className="text-xs text-purple-600 mt-1">تم الإرسال للمستخدمين</div>
            </div>
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
              <div className="flex items-center gap-2 text-orange-600 mb-2">
                <Users size={18} />
                <span className="text-sm font-medium">الشركات الفريدة</span>
              </div>
              <div className="text-2xl font-bold text-orange-700">{trackingData.statistics.uniqueCompaniesViewed}</div>
              <div className="text-xs text-orange-600 mt-1">شركة شاهدت الإعلان</div>
            </div>
          </div>

          {/* قوائم المستخدمين */}
          <div className="grid md:grid-cols-3 gap-6">
            {/* المشاهدات */}
            <div>
              <h4 className="font-medium text-text-primary mb-3 flex items-center gap-2">
                <Eye size={16} className="text-blue-500" />
                آخر المشاهدات
              </h4>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {trackingData.views.length === 0 ? (
                  <p className="text-sm text-text-muted">لا توجد مشاهدات</p>
                ) : (
                  trackingData.views.map((view: any, idx: number) => (
                    <div key={idx} className="bg-gray-50 rounded-lg p-3 text-sm">
                      <div className="font-medium text-text-primary">{view.companies?.name || 'غير معروف'}</div>
                      <div className="text-xs text-text-muted flex items-center justify-between mt-1">
                        <span>{view.users?.name || 'مستخدم'}</span>
                        <span dir="ltr">{new Date(view.viewed_at).toLocaleString('ar-SA')}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* النقرات */}
            <div>
              <h4 className="font-medium text-text-primary mb-3 flex items-center gap-2">
                <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
                </svg>
                آخر النقرات
              </h4>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {trackingData.clicks.length === 0 ? (
                  <p className="text-sm text-text-muted">لا توجد نقرات</p>
                ) : (
                  trackingData.clicks.map((click: any, idx: number) => (
                    <div key={idx} className="bg-gray-50 rounded-lg p-3 text-sm">
                      <div className="font-medium text-text-primary">{click.companies?.name || 'غير معروف'}</div>
                      <div className="text-xs text-text-muted flex items-center justify-between mt-1">
                        <span>{click.users?.name || 'مستخدم'}</span>
                        <span dir="ltr">{new Date(click.clicked_at).toLocaleString('ar-SA')}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* الإشعارات */}
            <div>
              <h4 className="font-medium text-text-primary mb-3 flex items-center gap-2">
                <Bell size={16} className="text-purple-500" />
                الإشعارات المرسلة
              </h4>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {trackingData.notifications.length === 0 ? (
                  <p className="text-sm text-text-muted">لا توجد إشعارات مرسلة</p>
                ) : (
                  trackingData.notifications.map((notif: any, idx: number) => (
                    <div key={idx} className="bg-gray-50 rounded-lg p-3 text-sm">
                      <div className="font-medium text-text-primary">{notif.companies?.name || 'غير معروف'}</div>
                      <div className="text-xs text-text-muted flex items-center justify-between mt-1">
                        <span>{notif.users?.name || 'مستخدم'}</span>
                        <span dir="ltr">{new Date(notif.sent_at).toLocaleString('ar-SA')}</span>
                      </div>
                      <div className="mt-2 flex items-center gap-2 text-xs">
                        <span className={`px-2 py-0.5 rounded ${notif.delivered ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                          {notif.delivered ? '✓ تم التوصيل' : 'قيد الانتظار'}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-700">
                          {notif.delivery_method}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
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
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <h3 className="font-bold text-text-primary text-lg">{ad.title}</h3>
                        <span className={`text-xs px-2.5 py-0.5 rounded-full border ${typeInfo.badgeClass}`}>
                          {typeInfo.label}
                        </span>
                        {!ad.is_active && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200">
                            مخفي
                          </span>
                        )}
                        {/* عرض طريقة العرض */}
                        {ad.display_mode && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200">
                            {ad.display_mode === 'banner' ? 'بانر' : ad.display_mode === 'popup' ? 'نافذة منبثقة' : 'إشعار'}
                          </span>
                        )}
                        {/* عرض الإحصائيات */}
                        <div className="flex items-center gap-3 text-xs text-text-muted ml-auto">
                          <span className="flex items-center gap-1">
                            <Eye size={12} /> {ad.views || 0}
                          </span>
                          <span className="flex items-center gap-1">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
                            </svg>
                            {ad.clicks || 0}
                          </span>
                          <span className="flex items-center gap-1">
                            <Bell size={12} /> {ad.notifications_sent || 0}
                          </span>
                        </div>
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
                    <button onClick={() => loadTrackingData(ad.id)} className="btn btn-ghost btn-icon text-accent" title="عرض التتبع والإحصائيات">
                      <BarChart3 size={16} />
                    </button>
                    <button onClick={() => handleEdit(ad)} className="btn btn-ghost btn-icon" title="تعديل">
                      <Edit2 size={16} />
                    </button>
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