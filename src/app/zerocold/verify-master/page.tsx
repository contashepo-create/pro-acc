'use client';

import { useState, useEffect, FormEvent, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff, Loader2, KeyRound, ArrowLeft, Lock } from 'lucide-react';

const MAX_ATTEMPTS = 3;
const BLOCK_DURATION = 15 * 60 * 1000;

export default function VerifyMasterPageWrapper() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 size={24} className="animate-spin text-amber-600" /></div>}>
      <VerifyMasterPage />
    </Suspense>
  );
}

function VerifyMasterPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get('email') || '';
  const [masterPassword, setMasterPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [blockedUntil, setBlockedUntil] = useState<number | null>(null);

  useEffect(() => {
    if (!email) {
      router.replace('/zerocold/login');
      return;
    }
  }, [email, router]);

  useEffect(() => {
    const blocked = localStorage.getItem('zerocold_master_blocked');
    if (blocked) {
      const until = parseInt(blocked, 10);
      if (Date.now() < until) {
        setBlockedUntil(until);
      } else {
        localStorage.removeItem('zerocold_master_blocked');
      }
    }
    const savedAttempts = localStorage.getItem('zerocold_master_attempts');
    if (savedAttempts) {
      setAttempts(parseInt(savedAttempts, 10));
    }
  }, []);

  useEffect(() => {
    if (blockedUntil && Date.now() >= blockedUntil) {
      setBlockedUntil(null);
      setAttempts(0);
      localStorage.removeItem('zerocold_master_blocked');
      localStorage.removeItem('zerocold_master_attempts');
    }
  }, [blockedUntil]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (blockedUntil && Date.now() < blockedUntil) {
      const remaining = Math.ceil((blockedUntil - Date.now()) / 60000);
      setError(`تم حظر المحاولة. يرجى الانتظار ${remaining} دقائق`);
      return;
    }

    if (!masterPassword) {
      setError('يرجى إدخال كلمة السر الرئيسية');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/admin/verify-master', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, masterPassword }),
      });

      const body = await res.json();

      if (!res.ok || !body.success) {
        const newAttempts = attempts + 1;
        setAttempts(newAttempts);
        localStorage.setItem('zerocold_master_attempts', String(newAttempts));
        if (newAttempts >= MAX_ATTEMPTS) {
          const until = Date.now() + BLOCK_DURATION;
          setBlockedUntil(until);
          localStorage.setItem('zerocold_master_blocked', String(until));
          setError('تم حظر المحاولة بسبب تجاوز عدد المحاولات المسموحة');
        } else {
          setError(`كلمة السر غير صحيحة. المحاولات المتبقية: ${MAX_ATTEMPTS - newAttempts}`);
        }

        setMasterPassword('');
        return;
      }

      localStorage.removeItem('zerocold_master_attempts');
      localStorage.removeItem('zerocold_master_blocked');

      router.push('/zerocold/');
    } catch {
      setError('حدث خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    router.push('/zerocold/login');
  };

  const formatBlockTime = () => {
    if (!blockedUntil) return '';
    const remaining = Math.max(0, blockedUntil - Date.now());
    const mins = Math.ceil(remaining / 60000);
    if (mins >= 60) {
      return `${Math.floor(mins / 60)} ساعة و ${mins % 60} دقيقة`;
    }
    return `${mins} دقائق`;
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0a0a0f] to-[#1a0f0a] p-4">
      <div className="w-full max-w-sm">
        <button
          onClick={handleBack}
          className="flex items-center gap-1.5 text-amber-600/60 hover:text-amber-400 text-sm mb-6 transition-colors"
        >
          <ArrowLeft size={16} />
          العودة لتسجيل الدخول
        </button>

        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-red-600 to-rose-700 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-red-900/30">
            <KeyRound className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-amber-50">كلمة السر الرئيسية</h1>
          <p className="text-amber-400/60 text-sm mt-2 leading-relaxed max-w-xs mx-auto">
            أدخل كلمة السر الرئيسية للوحة المطور
          </p>
        </div>

        <div className="bg-[#12101a] border border-[#2a1f0a] rounded-2xl p-6 shadow-2xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-amber-300/80 mb-1.5">كلمة السر الرئيسية</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={masterPassword}
                  onChange={(e) => setMasterPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-2.5 bg-[#1a1625] border border-[#2a1f0a] rounded-xl text-amber-50 placeholder-amber-700/50 focus:outline-none focus:border-amber-600 focus:ring-1 focus:ring-amber-600/30 transition-all text-sm pl-10"
                  dir="ltr"
                  autoFocus
                  disabled={!!(blockedUntil && Date.now() < blockedUntil)}
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

            {blockedUntil && Date.now() < blockedUntil && (
              <div className="bg-red-950/40 border border-red-800/40 text-red-400 text-sm rounded-xl px-4 py-2.5 text-center">
                <Lock size={16} className="inline ml-1.5" />
                تم الحظر. المتبقي: {formatBlockTime()}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || (!!(blockedUntil && Date.now() < blockedUntil))}
              className="w-full py-2.5 bg-gradient-to-l from-red-600 to-rose-700 hover:from-red-500 hover:to-rose-600 disabled:from-red-800 disabled:to-rose-900 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all text-sm shadow-lg shadow-red-900/20 flex items-center justify-center gap-2"
            >
              {loading ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Lock size={18} />
              )}
              {loading ? 'جاري التحقق...' : 'تأكيد'}
            </button>
          </form>

          {attempts > 0 && attempts < MAX_ATTEMPTS && (
            <p className="text-amber-600/50 text-xs text-center mt-3">
              المحاولات الفاشلة: {attempts} / {MAX_ATTEMPTS}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
