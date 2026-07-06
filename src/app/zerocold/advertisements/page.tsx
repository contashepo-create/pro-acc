'use client';

import { useState, useEffect } from 'react';
import { Megaphone, Plus, Loader2, Trash2, EyeOff, Eye } from 'lucide-react';

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

export default function AdminAdvertisementsPage() {
  const [ads, setAds] = useState<Ad[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [type, setType] = useState('announcement');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkText, setLinkText] = useState('');
  const [saving, setSaving] = useState(false);

  const loadAds = async () => {
    const res = await fetch('/api/admin/advertisements');
    const data = await res.json();
    if (data.success) setAds(data.data);
    setLoading(false);
  };

  useEffect(() => { loadAds(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;
    setSaving(true);
    await fetch('/api/admin/advertisements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body, type, linkUrl, linkText }),
    });
    setTitle(''); setBody(''); setLinkUrl(''); setLinkText('');
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
    await fetch('/api/admin/advertisements', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    loadAds();
  };

  const typeLabel: Record<string, string> = {
    announcement: 'إعلان', banner: 'بانر', promotion: 'ترويج',
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Megaphone size={24} className="text-accent" />
          <h1 className="text-2xl font-bold text-text-primary">الإعلانات</h1>
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
                <option value="announcement">إعلان</option>
                <option value="banner">بانر</option>
                <option value="promotion">ترويج</option>
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
          </div>
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
          {ads.map((ad) => (
            <div key={ad.id} className={`glass rounded-xl p-6 ${!ad.is_active ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-bold text-text-primary">{ad.title}</h3>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-accent/10 text-accent">{typeLabel[ad.type]}</span>
                  </div>
                  <p className="text-sm text-text-secondary">{ad.body}</p>
                  {ad.link_url && (
                    <a href={ad.link_url} target="_blank" className="text-xs text-accent hover:underline mt-1 inline-block">{ad.link_text || ad.link_url}</a>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => toggleActive(ad.id, ad.is_active)} className="btn btn-ghost btn-icon" title={ad.is_active ? 'إخفاء' : 'إظهار'}>
                    {ad.is_active ? <Eye size={16} /> : <EyeOff size={16} />}
                  </button>
                  <button onClick={() => handleDelete(ad.id)} className="btn btn-ghost btn-icon text-danger" title="حذف">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              <p className="text-xs text-text-muted" dir="ltr">{new Date(ad.created_at).toLocaleString('ar-SA')}</p>
            </div>
          ))}
          {ads.length === 0 && <p className="text-text-muted text-sm text-center py-8">لا توجد إعلانات</p>}
        </div>
      )}
    </div>
  );
}
