'use client';

import { useState, useEffect } from 'react';
import { MessageSquareWarning, Send, Loader2, AlertCircle, Lightbulb, Inbox } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';

interface Complaint {
  id: string;
  type: 'complaint' | 'suggestion';
  subject: string;
  body: string;
  status: string;
  admin_reply: string | null;
  created_at: string;
}

export default function ComplaintsPage() {
  const [items, setItems] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState<'complaint' | 'suggestion'>('complaint');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const loadData = async () => {
    const res = await fetch('/api/complaints');
    const data = await res.json();
    if (data.success) setItems(data.data);
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, []);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!subject.trim() || !body.trim()) { setError('يرجى ملء جميع الحقول'); return; }

    setSending(true);
    const res = await fetch('/api/complaints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, subject, body }),
    });
    const data = await res.json();
    if (data.success) {
      setSubject('');
      setBody('');
      loadData();
    } else {
      setError(data.message || 'حدث خطأ');
    }
    setSending(false);
  };

  const statusLabel: Record<string, string> = {
    pending: 'قيد المراجعة',
    read: 'تم الاطلاع',
    replied: 'تم الرد',
    closed: 'مغلق',
  };

  return (
    <div>
      <PageHeader title="الشكاوي والاقتراحات" icon={MessageSquareWarning} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="glass rounded-xl p-6">
            <h3 className="font-bold text-text-primary mb-4 flex items-center gap-2">
              <Inbox size={18} className="text-accent" />
              الطلبات السابقة
            </h3>

            {loading ? (
              <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-accent" /></div>
            ) : items.length === 0 ? (
              <p className="text-text-muted text-sm text-center py-8">لا توجد طلبات</p>
            ) : (
              <div className="space-y-3">
                {items.map((item) => (
                  <div key={item.id} className="p-4 rounded-lg border border-border">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {item.type === 'complaint' ? <AlertCircle size={16} className="text-danger" /> : <Lightbulb size={16} className="text-accent" />}
                        <h4 className="font-medium text-text-primary text-sm">{item.subject}</h4>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        item.status === 'pending' ? 'bg-warning/10 text-warning' :
                        item.status === 'replied' ? 'bg-success/10 text-success' :
                        'bg-text-muted/10 text-text-muted'
                      }`}>{statusLabel[item.status]}</span>
                    </div>
                    <p className="text-sm text-text-secondary">{item.body}</p>
                    {item.admin_reply && (
                      <div className="mt-3 p-3 bg-accent/5 rounded-lg border border-accent/20">
                        <p className="text-xs text-accent font-medium mb-1">رد الإدارة:</p>
                        <p className="text-sm text-text-secondary">{item.admin_reply}</p>
                      </div>
                    )}
                    <p className="text-xs text-text-muted mt-2" dir="ltr">{new Date(item.created_at).toLocaleDateString('ar-SA')}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div>
          <form onSubmit={handleSend} className="glass rounded-xl p-6">
            <h3 className="font-bold text-text-primary mb-4">إرسال جديد</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">النوع</label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setType('complaint')} className={`flex-1 h-10 rounded-lg text-sm font-medium transition-colors ${
                    type === 'complaint' ? 'bg-danger/20 text-danger border border-danger/30' : 'bg-bg-hover text-text-secondary'
                  }`}>شكوى</button>
                  <button type="button" onClick={() => setType('suggestion')} className={`flex-1 h-10 rounded-lg text-sm font-medium transition-colors ${
                    type === 'suggestion' ? 'bg-accent/20 text-accent border border-accent/30' : 'bg-bg-hover text-text-secondary'
                  }`}>اقتراح</button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">العنوان</label>
                <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} className="input-base" placeholder="عنوان الطلب" />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">التفاصيل</label>
                <textarea value={body} onChange={(e) => setBody(e.target.value)} className="input-base min-h-[120px] resize-none" placeholder="اكتب تفاصيل طلبك..." rows={4} />
              </div>

              {error && <div className="text-danger text-xs">{error}</div>}

              <button type="submit" disabled={sending} className="btn btn-primary w-full h-10 text-sm">
                {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                إرسال
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
