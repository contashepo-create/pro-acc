'use client';

import { useState } from 'react';
import { Mail, Loader2, ArrowLeft, CheckCircle } from 'lucide-react';
import Link from 'next/link';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [resetUrl, setResetUrl] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim()) { setError('يرجى إدخال البريد الإلكتروني'); return; }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (data.success) {
        setSent(true);
        setResetUrl(data.data?.resetUrl || '');
      } else {
        setError(data.message || 'حدث خطأ');
      }
    } catch {
      setError('حدث خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="glass rounded-2xl p-8 w-full shadow-modal">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-full bg-success/20 flex items-center justify-center mx-auto mb-4">
            <CheckCircle size={32} className="text-success" />
          </div>
          <h1 className="text-xl font-bold text-text-primary">تم إرسال رابط إعادة التعيين</h1>
          <p className="text-text-muted text-sm mt-2">
            إذا كان البريد الإلكتروني مسجلاً، ستتلقى رابط إعادة تعيين كلمة المرور
          </p>
        </div>
        {resetUrl && (
          <div className="bg-bg-hover rounded-lg p-3 mb-4">
            <p className="text-xs text-text-muted mb-1">رابط إعادة التعيين (للاختبار):</p>
            <a href={resetUrl} className="text-sm text-accent break-all hover:underline">{resetUrl}</a>
          </div>
        )}
        <div className="text-center mt-6">
          <Link href="/login" className="text-accent hover:text-accent-hover text-sm font-medium transition-colors inline-flex items-center gap-1">
            <ArrowLeft size={16} />
            العودة إلى تسجيل الدخول
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="glass rounded-2xl p-8 w-full shadow-modal">
      <div className="text-center mb-8">
        <div className="w-16 h-16 rounded-2xl bg-accent flex items-center justify-center mx-auto mb-4">
          <span className="text-3xl font-bold text-text-inverse">ب</span>
        </div>
        <h1 className="text-2xl font-bold text-text-primary">نسيت كلمة المرور</h1>
        <p className="text-text-muted text-sm mt-1">أدخل بريدك الإلكتروني وسنرسل لك رابط إعادة التعيين</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1.5">البريد الإلكتروني</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@example.com"
            className="input-base"
            dir="ltr"
            autoFocus
          />
        </div>

        {error && (
          <div className="bg-danger-light/30 border border-danger/30 text-danger text-sm rounded-lg px-4 py-2.5">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="btn btn-primary w-full h-11 text-base"
        >
          {loading ? (
            <Loader2 size={20} className="animate-spin" />
          ) : (
            <Mail size={20} />
          )}
          {loading ? 'جاري الإرسال...' : 'إرسال رابط إعادة التعيين'}
        </button>
      </form>

      <div className="mt-6 text-center">
        <Link href="/login" className="text-accent hover:text-accent-hover text-sm font-medium transition-colors inline-flex items-center gap-1">
          <ArrowLeft size={16} />
          العودة إلى تسجيل الدخول
        </Link>
      </div>
    </div>
  );
}
