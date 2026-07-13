'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Loader2, LogIn } from 'lucide-react';
import { useAuthStore } from '@/store/auth-store';
import Link from 'next/link';

export default function LoginPage() {
  const router = useRouter();
  const login = useAuthStore((s) => s.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim()) { setError('يرجى إدخال البريد الإلكتروني'); return; }
    if (!password) { setError('يرجى إدخال كلمة المرور'); return; }

    setLoading(true);
    try {
      const result = await login(email, password);
      if (result.success) {
        router.push('/dashboard');
      } else {
        setError(result.message || 'البريد الإلكتروني أو كلمة المرور غير صحيحة');
      }
    } catch {
      setError('حدث خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glass rounded-2xl p-8 w-full shadow-modal">
      {/* Logo */}
      <div className="text-center mb-8">
        <div className="w-16 h-16 rounded-2xl bg-accent flex items-center justify-center mx-auto mb-4">
          <span className="text-3xl font-bold text-text-inverse">ب</span>
        </div>
        <h1 className="text-2xl font-bold text-text-primary">
          برو <span className="text-accent">أكاوننت</span>
        </h1>
        <p className="text-text-muted text-sm mt-1">نظام محاسبة متكامل</p>
      </div>

      {/* Form */}
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

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1.5">كلمة المرور</label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="input-base pl-10"
              dir="ltr"
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
            <LogIn size={20} />
          )}
          {loading ? 'جاري تسجيل الدخول...' : 'تسجيل الدخول'}
        </button>
      </form>

      <div className="mt-6 text-center space-y-2">
        <p className="text-sm text-text-muted">
          ليس لديك حساب؟{' '}
          <Link href="/register" className="text-accent hover:text-accent-hover font-medium transition-colors">
            إنشاء حساب جديد
          </Link>
        </p>
        <p className="text-xs text-text-muted">
          <Link href="/forgot-password" className="hover:text-accent transition-colors">
            نسيت كلمة المرور؟
          </Link>
        </p>
        <p className="text-xs text-text-muted pt-2 border-t border-border">
          <Link href="/setup" className="hover:text-accent transition-colors">
            إعداد النظام (للمرة الأولى)
          </Link>
        </p>
      </div>
    </div>
  );
}
