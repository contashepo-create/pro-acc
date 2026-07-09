'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Loader2, UserPlus, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useAuthStore } from '@/store/auth-store';

export default function RegisterPage() {
  const router = useRouter();
  const checkSession = useAuthStore((s) => s.checkSession);
  const [companyName, setCompanyName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [captcha, setCaptcha] = useState<{ id: string; question: string } | null>(null);
  const [captchaAnswer, setCaptchaAnswer] = useState('');

  useEffect(() => {
    // Fetch CAPTCHA challenge
    fetch('/api/auth/register')
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setCaptcha(d.data);
      })
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!companyName.trim()) { setError('يرجى إدخال اسم الشركة'); return; }
    if (!name.trim()) { setError('يرجى إدخال الاسم'); return; }
    if (!email.trim()) { setError('يرجى إدخال البريد الإلكتروني'); return; }
    if (!password || password.length < 6) { setError('كلمة المرور يجب أن تكون 6 أحرف على الأقل'); return; }
    if (!captcha || !captchaAnswer) { setError('يرجى إكمال التحقق الأمني'); return; }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName, name, email, phone, password, captchaId: captcha.id, captchaAnswer }),
      });
      const data = await res.json();
      if (data.success) {
        router.push('/dashboard');
        checkSession();
      } else {
        setError(data.message || 'حدث خطأ');
        // Refresh CAPTCHA on failure
        setCaptchaAnswer('');
        fetch('/api/auth/register')
          .then((r) => r.json())
          .then((d) => { if (d.success) setCaptcha(d.data); })
          .catch(() => {});
      }
    } catch {
      setError('حدث خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glass rounded-2xl p-8 w-full shadow-modal">
      <div className="text-center mb-8">
        <div className="w-16 h-16 rounded-2xl bg-accent flex items-center justify-center mx-auto mb-4">
          <span className="text-3xl font-bold text-text-inverse">ب</span>
        </div>
        <h1 className="text-2xl font-bold text-text-primary">إنشاء حساب جديد</h1>
        <p className="text-text-muted text-sm mt-1">سجل شركتك وابدأ فوراً</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1.5">اسم الشركة</label>
          <input
            type="text"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="شركة المحترف للمحاسبة"
            className="input-base"
            autoFocus
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1.5">الاسم</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="أحمد محمد"
            className="input-base"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1.5">البريد الإلكتروني</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@company.com"
            className="input-base"
            dir="ltr"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1.5">رقم الجوال (اختياري)</label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+966501234567"
            className="input-base"
            dir="ltr"
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

        {/* CAPTCHA */}
        {captcha && (
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">التحقق الأمني</label>
            <div className="flex items-center gap-2">
              <ShieldCheck size={18} className="text-text-muted shrink-0" />
              <span className="text-sm text-text-secondary font-mono" dir="ltr">{captcha.question}</span>
              <input
                type="number"
                value={captchaAnswer}
                onChange={(e) => setCaptchaAnswer(e.target.value)}
                placeholder="الإجابة"
                className="input-base w-24"
                dir="ltr"
              />
            </div>
          </div>
        )}

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
            <UserPlus size={20} />
          )}
          {loading ? 'جاري إنشاء الحساب...' : 'إنشاء حساب جديد'}
        </button>
      </form>

      <div className="mt-6 text-center space-y-2">
        <p className="text-sm text-text-muted">
          لديك حساب بالفعل؟{' '}
          <Link href="/login" className="text-accent hover:text-accent-hover font-medium transition-colors">
            تسجيل الدخول
          </Link>
        </p>
      </div>
    </div>
  );
}
