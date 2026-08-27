'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  suggestions?: Array<{ text: string; action?: string }>;
}

export default function AssistantPage() {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: 'مرحباً! أنا المساعد المحاسبي. كيف يمكنني مساعدتك اليوم؟' },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim()) return;
    const userMsg: Message = { role: 'user', content: input };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: input }),
      });
      const data = await res.json();
      if (data.success) {
        const reply = data.data?.response || 'لم أحصل على إجابة.';
        const suggestions = data.data?.suggestions || [];
        setMessages(prev => [...prev, { role: 'assistant', content: reply, suggestions }]);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: 'عذراً، حدث خطأ في الاتصال' }]);
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'عذراً، حدث خطأ في الاتصال' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 flex flex-col h-[calc(100vh-200px)]">
      <PageHeader title="المساعد المحاسبي" description="اسأل المساعد الذكي عن أي استفسار محاسبي" />

      <div className="flex-1 overflow-y-auto space-y-4 p-4 card">
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${msg.role === 'assistant' ? 'bg-accent-light text-accent' : 'bg-bg-elevated text-text-secondary'}`}>
              {msg.role === 'assistant' ? <Bot size={16} /> : <User size={16} />}
            </div>
            <div className={`max-w-[80%] p-3 rounded-lg text-sm whitespace-pre-wrap ${
              msg.role === 'assistant' ? 'bg-bg-elevated text-text-primary' : 'bg-accent text-text-inverse'
            }`}>
              {msg.content}
              {msg.suggestions && msg.suggestions.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {msg.suggestions.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => setInput(s.text)}
                      className="px-2.5 py-1 rounded-full bg-accent/10 text-accent text-xs font-semibold hover:bg-accent/20 transition-colors"
                    >
                      {s.text}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-lg bg-accent-light flex items-center justify-center"><Bot size={16} className="text-accent" /></div>
            <div className="bg-bg-elevated p-3 rounded-lg"><Spinner size="sm" /></div>
          </div>
        )}
        <div ref={chatEnd} />
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !loading && handleSend()}
          placeholder="اكتب سؤالك هنا..."
          className="input-base flex-1"
        />
        <button onClick={handleSend} disabled={loading} className="btn btn-primary btn-icon">
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}
