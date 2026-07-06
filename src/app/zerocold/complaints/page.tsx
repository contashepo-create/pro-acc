'use client';

import { useState, useEffect } from 'react';
import { MessageSquareWarning, Loader2, Search, CheckCircle, Reply, AlertCircle, Lightbulb } from 'lucide-react';

interface Complaint {
  id: string;
  type: string;
  subject: string;
  body: string;
  status: string;
  admin_reply: string | null;
  company_name: string;
  created_at: string;
}

export default function AdminComplaintsPage() {
  const [items, setItems] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [replyText, setReplyText] = useState('');
  const [replyId, setReplyId] = useState<string | null>(null);

  const loadData = async () => {
    const params = filter ? `?status=${filter}` : '';
    const res = await fetch(`/api/admin/complaints${params}`);
    const data = await res.json();
    if (data.success) setItems(data.data);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, [filter]);

  const handleReply = async (id: string) => {
    if (!replyText.trim()) return;
    await fetch('/api/admin/complaints', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status: 'replied', adminReply: replyText.trim() }),
    });
    setReplyText('');
    setReplyId(null);
    loadData();
  };

  const handleStatus = async (id: string, status: string) => {
    await fetch('/api/admin/complaints', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    loadData();
  };

  const statusLabel: Record<string, string> = {
    pending: 'قيد المراجعة', read: 'تم الاطلاع', replied: 'تم الرد', closed: 'مغلق',
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <MessageSquareWarning size={24} className="text-accent" />
        <h1 className="text-2xl font-bold text-text-primary">الشكاوي والاقتراحات</h1>
      </div>

      <div className="flex gap-2 mb-6 flex-wrap">
        {['', 'pending', 'read', 'replied', 'closed'].map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-4 py-1.5 rounded-lg text-sm transition-colors ${
              filter === s ? 'bg-accent text-white' : 'glass text-text-secondary hover:text-text-primary'
            }`}
          >
            {s ? statusLabel[s] : 'الكل'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-accent" /></div>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <div key={item.id} className="glass rounded-xl p-6">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  {item.type === 'complaint' ? <AlertCircle size={18} className="text-danger" /> : <Lightbulb size={18} className="text-accent" />}
                  <div>
                    <h3 className="font-bold text-text-primary">{item.subject}</h3>
                    <p className="text-xs text-text-muted">{item.company_name}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    item.status === 'pending' ? 'bg-warning/10 text-warning' :
                    item.status === 'replied' ? 'bg-success/10 text-success' :
                    'bg-text-muted/10 text-text-muted'
                  }`}>{statusLabel[item.status]}</span>
                  {item.status === 'pending' && (
                    <button onClick={() => handleStatus(item.id, 'read')} className="btn btn-ghost btn-icon" title="تم الاطلاع">
                      <CheckCircle size={16} />
                    </button>
                  )}
                </div>
              </div>
              <p className="text-sm text-text-secondary mb-3">{item.body}</p>

              {item.admin_reply && (
                <div className="mb-3 p-3 bg-accent/5 rounded-lg border border-accent/20">
                  <p className="text-xs text-accent font-medium mb-1">الرد:</p>
                  <p className="text-sm text-text-secondary">{item.admin_reply}</p>
                </div>
              )}

              <div className="flex items-center gap-2">
                <button onClick={() => setReplyId(replyId === item.id ? null : item.id)} className="btn btn-ghost text-xs gap-1">
                  <Reply size={14} /> رد
                </button>
                <button onClick={() => handleStatus(item.id, 'closed')} className="btn btn-ghost text-xs gap-1 text-text-muted">
                  إغلاق
                </button>
              </div>

              {replyId === item.id && (
                <div className="mt-3 flex gap-2">
                  <textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    className="input-base flex-1 min-h-[60px] resize-none text-sm"
                    placeholder="اكتب ردك..."
                    rows={2}
                  />
                  <button onClick={() => handleReply(item.id)} className="btn btn-primary h-auto px-4 text-sm self-end">
                    إرسال
                  </button>
                </div>
              )}

              <p className="text-xs text-text-muted mt-2" dir="ltr">{new Date(item.created_at).toLocaleString('ar-SA')}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
