'use client';

import { useState, useEffect } from 'react';
import { MessageSquare, Send, Loader2, Search } from 'lucide-react';

interface Message {
  id: string;
  subject: string;
  body: string;
  direction: string;
  is_read: boolean;
  created_at: string;
  company_name: string;
}

export default function AdminMessagesPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  const loadMessages = async () => {
    const params = companyId ? `?companyId=${companyId}` : '';
    const res = await fetch(`/api/admin/messages${params}`);
    const data = await res.json();
    if (data.success) setMessages(data.data);
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId || !subject.trim() || !body.trim()) return;

    setSending(true);
    await fetch('/api/admin/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId, subject, body }),
    });
    setSubject('');
    setBody('');
    setSending(false);
    loadMessages();
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <MessageSquare size={24} className="text-accent" />
        <h1 className="text-2xl font-bold text-text-primary">الرسائل</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="glass rounded-xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 relative">
                <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted" />
                <input
                  type="text"
                  placeholder="البحث برقم الشركة..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="input-base pr-9 w-full"
                />
              </div>
              <input
                type="text"
                placeholder="شركة ID"
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                className="input-base w-40"
                dir="ltr"
              />
            </div>

            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 size={24} className="animate-spin text-accent" />
              </div>
            ) : messages.length === 0 ? (
              <p className="text-text-muted text-sm text-center py-8">لا توجد رسائل</p>
            ) : (
              <div className="space-y-3 max-h-[500px] overflow-y-auto">
                {messages.map((msg) => (
                  <div key={msg.id} className="p-4 rounded-lg border border-border">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium text-text-primary text-sm">{msg.subject}</h4>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-text-muted">{msg.company_name}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          msg.direction === 'admin_to_company'
                            ? 'bg-accent/10 text-accent'
                            : 'bg-primary/10 text-primary'
                        }`}>
                          {msg.direction === 'admin_to_company' ? 'إدارة → شركة' : 'شركة → إدارة'}
                        </span>
                      </div>
                    </div>
                    <p className="text-sm text-text-secondary whitespace-pre-wrap">{msg.body}</p>
                    <p className="text-xs text-text-muted mt-2" dir="ltr">
                      {new Date(msg.created_at).toLocaleString('ar-SA')}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div>
          <form onSubmit={handleSend} className="glass rounded-xl p-6">
            <h3 className="font-bold text-text-primary mb-4 flex items-center gap-2">
              <Send size={18} className="text-accent" />
              إرسال رسالة لشركة
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">معرف الشركة</label>
                <input
                  type="text"
                  value={companyId}
                  onChange={(e) => setCompanyId(e.target.value)}
                  className="input-base"
                  placeholder="Company UUID"
                  dir="ltr"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">الموضوع</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="input-base"
                  placeholder="عنوان الرسالة"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">الرسالة</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className="input-base min-h-[120px] resize-none"
                  placeholder="نص الرسالة..."
                  rows={4}
                  required
                />
              </div>
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
