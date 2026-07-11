'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Loader2, ShieldAlert } from 'lucide-react';

export default function ZerocoldLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.trim()) {
      setError('يرجى إدخال البريد الإلكتروني');
      return;
    }
    if (!password) {
      setError('يرجى إدخال كلمة المرور');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
        credentials: 'same-origin',
      });

      let body;
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        try {
          body = await res.json();
        } catch (jsonErr: any) {
          const text = await res.text().catch(() => '');
          console.error('Failed to parse JSON:', text, jsonErr);
          setError(`خطأ في الخادم (HTTP ${res.status}): ${text.substring(0, 300)}`);
          return;
        }
      } else {
        const text = await res.text().catch(() => '');
        console.error('Non-JSON response:', text);
        setError(`خطأ في الخادم (HTTP ${res.status}): ${text.substring(0, 300)}`);
        return;
      }

      if (!res.ok || !body.success) {
        setError(body.message || body.error || 'البريد الإلكتروني أو كلمة المرور غير صحيحة');
        return;
      }

      router.push(`/zerocold/verify-telegram?email=${encodeURIComponent(body.data?.email?.toLowerCase() || email.toLowerCase())}`);
    } catch (err: any) {
      console.error('Login fetch error:', err);
      setError(`حدث خطأ في الاتصال بالخادم: ${err?.message || 'فشل الشبكة'} - حاول تاني أو افتح /api/admin/debug`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0a0a0f] to-[#1a0f0a] p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-600 to-orange-700 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-amber-900/30">
            <ShieldAlert className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-amber-50">لوحة المطور</h1>
          <p className="text-amber-400/70 text-sm mt-1">لوحة تحكم المطور الخاصة بالنظام</p>
        </div>

        <div className="bg-[#12101a] border border-[#2a1f0a] rounded-2xl p-6 shadow-2xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-amber-300/80 mb-1.5">البريد الإلكتروني</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
                className="w-full px-4 py-2.5 bg-[#1a1625] border border-[#2a1f0a] rounded-xl text-amber-50 placeholder-amber-700/50 focus:outline-none focus:border-amber-600 focus:ring-1 focus:ring-amber-600/30 transition-all text-sm"
                dir="ltr"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-amber-300/80 mb-1.5">كلمة المرور</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-2.5 bg-[#1a1625] border border-[#2a1f0a] rounded-xl text-amber-50 placeholder-amber-700/50 focus:outline-none focus:border-amber-600 focus:ring-1 focus:ring-amber-600/30 transition-all text-sm pl-10"
                  dir="ltr"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-600/60 hover:text-amber-400 transition-colors"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="bg-red-950/40 border border-red-800/40 text-red-400 text-sm rounded-xl px-4 py-2.5 text-center">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-gradient-to-l from-amber-600 to-orange-700 hover:from-amber-500 hover:to-orange-600 disabled:from-amber-800 disabled:to-orange-900 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all text-sm shadow-lg shadow-amber-900/20 flex items-center justify-center gap-2"
            >
              {loading && <Loader2 size={18} className="animate-spin" />}
              {loading ? 'جاري تسجيل الدخول...' : 'تسجيل الدخول'}
            </button>
          </form>
        </div>

        <p className="text-center mt-6 text-[0.7rem] text-amber-700/40">
          منطقة المطور — الدخول مقصور على المصرح لهم فقط
        </p>
      </div>
    </div>
  );
}
