'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Loader2, UserPlus, ShieldCheck, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { useAuthStore } from '@/store/auth-store';
import { getOperatingCountriesList, getCountryConfig } from '@/lib/countries';

export default function RegisterPage() {
  const router = useRouter();
  const checkSession = useAuthStore((s) => s.checkSession);
  const [companyName, setCompanyName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState('SA');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [captcha, setCaptcha] = useState<{ id: string; question: string } | null>(null);
  const [captchaAnswer, setCaptchaAnswer] = useState('');

  const countryConfig = getCountryConfig(country);
  const taxAuthorityLabel = countryConfig.taxAuthority === 'zatca' ? 'الهيئة العامة للزكاة والدخل (ZATCA)' : countryConfig.taxAuthority === 'eta' ? 'هيئة الضرائب المصرية (ETA)' : countryConfig.taxAuthority;

  useEffect(() => {
    // Fetch CAPTCHA challenge
    fetch('/api/auth/register')
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setCaptcha(d.data);
      })
      .catch(() => {});
  }, []);

  // The operating country is irreversible (migration 104 freezes it, the
  // platform has no reset — 088), so the first click only opens an explicit
  // final-confirmation step; the real registration runs from it.
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!companyName.trim()) { setError('يرجى إدخال اسم الشركة'); return; }
    if (!name.trim()) { setError('يرجى إدخال الاسم'); return; }
    if (!email.trim()) { setError('يرجى إدخال البريد الإلكتروني'); return; }
    if (!password || password.length < 8) { setError('كلمة المرور يجب أن تكون 8 أحرف على الأقل'); return; }
    if (!captcha || !captchaAnswer) { setError('يرجى إكمال التحقق الأمني'); return; }
    setConfirming(true);
  };

  const doRegister = async () => {
    if (!captcha) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName, name, email, phone, country, password, captchaId: captcha.id, captchaAnswer }),
      });
      const data = await res.json();
      if (data.success) {
        router.push('/dashboard');
        checkSession();
      } else {
        setError(data.message || 'حدث خطأ');
        setConfirming(false);
        // Refresh CAPTCHA on failure
        setCaptchaAnswer('');
        fetch('/api/auth/register')
          .then((r) => r.json())
          .then((d) => { if (d.success) setCaptcha(d.data); })
          .catch(() => {});
      }
    } catch {
      setError('حدث خطأ في الاتصال بالخادم');
      setConfirming(false);
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
          <label className="block text-sm font-medium text-text-secondary mb-1.5">دولة التشغيل</label>
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="input-base"
          >
            {getOperatingCountriesList().map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <div className="mt-2 rounded-xl border-2 border-danger bg-danger-light/60 p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={20} className="text-danger shrink-0" />
              <p className="text-sm font-bold text-danger">قرار نهائي — لا رجعة فيه</p>
            </div>
            <p className="text-sm text-text-primary leading-relaxed">
              بمجرد اختيار الدولة ({getOperatingCountriesList().map((c) => c.label).join(' أو ')}) تُثبَّت على حسابك للأبد:
              ضريبة القيمة المضافة، العملة، التأمينات الاجتماعية، السنة المالية وجهة الإيرادات
              (ZATCA في السعودية أو ETA في مصر).
            </p>
            <p className="text-sm font-semibold text-danger mt-2">
              لا يمكن تغيير الدولة لاحقاً — ولا تصفير بيانات الشركة — ولا البدء من جديد.
              إن أردت نظام دولة أخرى، فالطريق الوحيد هو إنشاء حساب جديد.
            </p>
          </div>
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

        {confirming ? (
          <div className="rounded-xl border-2 border-danger bg-danger-light/60 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle size={20} className="text-danger shrink-0" />
              <p className="text-sm font-bold text-danger">تأكيد أخير — لا رجعة في هذا القرار</p>
            </div>
            <p className="text-sm text-text-primary leading-relaxed">
              ستُنشئ حساب شركتك على نظام <span className="font-bold">{countryConfig.name}</span>:
              العملة {countryConfig.currencySymbol} ({countryConfig.currencyCode})، ضريبة القيمة المضافة {Math.round(countryConfig.vatRate * 100)}٪،
              السنة المالية وجهة الإيرادات {taxAuthorityLabel}.
              <span className="font-semibold text-danger">
                {' '}بمجرد الإنشاء: لا تغيير للدولة، ولا تصفير للبيانات، ولا بدء من جديد.
              </span>
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={loading}
                className="btn btn-secondary flex-1 h-11 text-sm"
              >
                تراجع
              </button>
              <button
                type="button"
                onClick={doRegister}
                disabled={loading}
                className="btn btn-danger flex-1 h-11 text-sm"
              >
                {loading ? <Loader2 size={18} className="animate-spin" /> : <AlertTriangle size={18} />}
                {loading ? 'جاري الإنشاء...' : 'أفهم — أنشئ الحساب'}
              </button>
            </div>
          </div>
        ) : (
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
        )}
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
