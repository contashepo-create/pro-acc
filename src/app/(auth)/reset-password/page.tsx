'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff, Loader2, KeyRound, CheckCircle } from 'lucide-react';
import Link from 'next/link';

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!token) setError('رابط إعادة التعيين غير صالح');
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!token) { setError('رابط إعادة التعيين غير صالح'); return; }
    if (!password || password.length < 6) { setError('كلمة المرور يجب أن تكون 6 أحرف على الأقل'); return; }
    if (password !== confirmPassword) { setError('كلمة المرور غير متطابقة'); return; }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (data.success) setDone(true);
      else setError(data.message || 'حدث خطأ');
    } catch {
      setError('حدث خطأ في الاتصال بالخادم');
    } finally { setLoading(false); }
  };

  if (done) {
    return (
      <div className="glass rounded-2xl p-8 w-full shadow-modal">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-full bg-success/20 flex items-center justify-center mx-auto mb-4">
            <CheckCircle size={32} className="text-success" />
          </div>
          <h1 className="text-xl font-bold text-text-primary">تم تغيير كلمة المرور</h1>
          <p className="text-text-muted text-sm mt-2">يمكنك الآن تسجيل الدخول بكلمة المرور الجديدة</p>
        </div>
        <Link href="/login" className="btn btn-primary w-full h-11 text-base flex items-center justify-center gap-2">
          <KeyRound size={20} />
          تسجيل الدخول
        </Link>
      </div>
    );
  }

  return (
    <div className="glass rounded-2xl p-8 w-full shadow-modal">
      <div className="text-center mb-8">
        <div className="w-16 h-16 rounded-2xl bg-accent flex items-center justify-center mx-auto mb-4">
          <span className="text-3xl font-bold text-text-inverse">ب</span>
        </div>
        <h1 className="text-2xl font-bold text-text-primary">إعادة تعيين كلمة المرور</h1>
        <p className="text-text-muted text-sm mt-1">أدخل كلمة المرور الجديدة</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1.5">كلمة المرور الجديدة</label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="input-base pl-10"
              dir="ltr"
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors"
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1.5">تأكيد كلمة المرور</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="••••••••"
            className="input-base"
            dir="ltr"
          />
        </div>

        {error && (
          <div className="bg-danger-light/30 border border-danger/30 text-danger text-sm rounded-lg px-4 py-2.5">{error}</div>
        )}

        <button type="submit" disabled={loading || !token} className="btn btn-primary w-full h-11 text-base">
          {loading ? <Loader2 size={20} className="animate-spin" /> : <KeyRound size={20} />}
          {loading ? 'جاري التغيير...' : 'تغيير كلمة المرور'}
        </button>
      </form>

      <div className="mt-6 text-center">
        <Link href="/login" className="text-accent hover:text-accent-hover text-sm font-medium transition-colors">
          العودة إلى تسجيل الدخول
        </Link>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div className="glass rounded-2xl p-8 w-full shadow-modal flex items-center justify-center h-64">
        <Loader2 size={32} className="animate-spin text-accent" />
      </div>
    }>
      <ResetPasswordForm />
    </Suspense>
  );
}
