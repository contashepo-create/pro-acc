'use client';

import { useState, useEffect } from 'react';
import { MessageSquare, Send, Loader2, Mail, Inbox } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';

interface Message {
  id: string;
  subject: string;
  body: string;
  direction: 'admin_to_company' | 'company_to_admin';
  is_read: boolean;
  created_at: string;
}

export default function MessagesPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const loadMessages = async () => {
    const res = await fetch('/api/messages');
    const data = await res.json();
    if (data.success) setMessages(data.data.messages);
    setLoading(false);
  };

  useEffect(() => { loadMessages(); }, []);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!subject.trim() || !body.trim()) { setError('يرجى ملء جميع الحقول'); return; }

    setSending(true);
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, body }),
      });
      const data = await res.json();
      if (data.success) {
        setSubject('');
        setBody('');
        loadMessages();
      } else {
        setError(data.message || 'حدث خطأ');
      }
    } catch {
      setError('حدث خطأ في الاتصال');
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <PageHeader title="الرسائل" icon={MessageSquare} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="glass rounded-xl p-6">
            <h3 className="font-bold text-text-primary mb-4 flex items-center gap-2">
              <Inbox size={18} className="text-accent" />
              الرسائل الواردة
            </h3>

            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 size={24} className="animate-spin text-accent" />
              </div>
            ) : messages.length === 0 ? (
              <p className="text-text-muted text-sm text-center py-8">لا توجد رسائل</p>
            ) : (
              <div className="space-y-3">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`p-4 rounded-lg border ${
                      !msg.is_read && msg.direction === 'admin_to_company'
                        ? 'border-accent/30 bg-accent/5'
                        : 'border-border'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium text-text-primary text-sm">{msg.subject}</h4>
                      <div className="flex items-center gap-2">
                        {msg.direction === 'admin_to_company' ? (
                          <span className="text-xs text-accent">من الإدارة</span>
                        ) : (
                          <span className="text-xs text-text-muted">منك</span>
                        )}
                        <span className="text-xs text-text-muted" dir="ltr">
                          {new Date(msg.created_at).toLocaleDateString('ar-SA')}
                        </span>
                      </div>
                    </div>
                    <p className="text-sm text-text-secondary whitespace-pre-wrap">{msg.body}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div>
          <form onSubmit={handleSend} className="glass rounded-xl p-6">
            <h3 className="font-bold text-text-primary mb-4 flex items-center gap-2">
              <Mail size={18} className="text-accent" />
              إرسال رسالة للإدارة
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">الموضوع</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="input-base"
                  placeholder="عنوان الرسالة"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">الرسالة</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className="input-base min-h-[150px] resize-none"
                  placeholder="نص الرسالة..."
                  rows={5}
                />
              </div>

              {error && (
                <div className="text-danger text-xs">{error}</div>
              )}

              <button
                type="submit"
                disabled={sending}
                className="btn btn-primary w-full h-10 text-sm"
              >
                {sending ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Send size={16} />
                )}
                {sending ? 'جاري الإرسال...' : 'إرسال'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
