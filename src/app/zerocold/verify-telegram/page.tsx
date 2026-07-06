'use client';

import { useState, useRef, useEffect, KeyboardEvent, ClipboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, MessageCircle, ArrowLeft } from 'lucide-react';

const ADMIN_SESSION_KEY = 'zerocold_session';
const RESEND_COOLDOWN = 60;

export default function VerifyTelegramPage() {
  const router = useRouter();
  const [code, setCode] = useState<string[]>(Array(6).fill(''));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(RESEND_COOLDOWN);
  const [canResend, setCanResend] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    const session = sessionStorage.getItem(ADMIN_SESSION_KEY);
    if (!session) {
      router.replace('/zerocold/login');
      return;
    }
    try {
      const data = JSON.parse(session);
      if (data.step !== 'login') {
        router.replace('/zerocold/login');
      }
    } catch {
      router.replace('/zerocold/login');
    }
  }, [router]);

  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  useEffect(() => {
    if (countdown > 0 && !canResend) {
      const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
      return () => clearTimeout(timer);
    }
    if (countdown === 0 && !canResend) {
      setCanResend(true);
    }
  }, [countdown, canResend]);

  useEffect(() => {
    const session = sessionStorage.getItem(ADMIN_SESSION_KEY);
    if (session) {
      try {
        const data = JSON.parse(session);
        if (data.telegramCodeSent) return;
      } catch {}
    }
    sendTelegramCode();
  }, []);

  const sendTelegramCode = async () => {
    try {
      const session = sessionStorage.getItem(ADMIN_SESSION_KEY);
      if (!session) return;
      const { email } = JSON.parse(session);

      const res = await fetch('/api/admin/send-telegram-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const body = await res.json();
      if (res.ok && body.success) {
        const sessionData = JSON.parse(sessionStorage.getItem(ADMIN_SESSION_KEY) || '{}');
        sessionData.telegramCodeSent = true;
        sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(sessionData));
      }
    } catch {}
  };

  const handleChange = (index: number, value: string) => {
    if (value && !/^\d$/.test(value)) return;
    const newCode = [...code];
    newCode[index] = value;
    setCode(newCode);
    setError('');

    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
    if (e.key === 'Enter') {
      handleVerify();
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    const newCode = Array(6).fill('');
    for (let i = 0; i < pasted.length; i++) {
      newCode[i] = pasted[i];
    }
    setCode(newCode);
    const nextIndex = Math.min(pasted.length, 5);
    inputRefs.current[nextIndex]?.focus();
  };

  const handleVerify = async () => {
    const fullCode = code.join('');
    if (fullCode.length !== 6) {
      setError('يرجى إدخال الرمز المكون من 6 أرقام');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const session = sessionStorage.getItem(ADMIN_SESSION_KEY);
      if (!session) {
        router.replace('/zerocold/login');
        return;
      }
      const { email } = JSON.parse(session);

      const res = await fetch('/api/admin/verify-telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code: fullCode }),
      });

      const body = await res.json();

      if (!res.ok || !body.success) {
        setError(body.message || 'رمز التحقق غير صحيح');
        setCode(Array(6).fill(''));
        inputRefs.current[0]?.focus();
        return;
      }

      const sessionData = JSON.parse(sessionStorage.getItem(ADMIN_SESSION_KEY) || '{}');
      sessionData.step = 'telegram';
      sessionData.telegramVerified = true;
      sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(sessionData));

      router.push('/zerocold/verify-master');
    } catch {
      setError('حدث خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!canResend) return;
    setCanResend(false);
    setCountdown(RESEND_COOLDOWN);
    setCode(Array(6).fill(''));
    setError('');
    await sendTelegramCode();
  };

  const handleBack = () => {
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
    router.push('/zerocold/login');
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
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-sky-600 to-blue-700 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-sky-900/30">
            <MessageCircle className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-amber-50">التحقق عبر التليجرام</h1>
          <p className="text-amber-400/60 text-sm mt-2 leading-relaxed max-w-xs mx-auto">
            تم إرسال رمز تحقق مكون من 6 أرقام إلى بوت التليجرام الخاص بك
          </p>
        </div>

        <div className="bg-[#12101a] border border-[#2a1f0a] rounded-2xl p-6 shadow-2xl">
          <div className="flex items-center justify-center gap-2.5 mb-6" dir="ltr">
            {code.map((digit, index) => (
              <input
                key={index}
                ref={(el) => {
                  inputRefs.current[index] = el;
                }}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={(e) => handleChange(index, e.target.value)}
                onKeyDown={(e) => handleKeyDown(index, e)}
                onPaste={index === 0 ? handlePaste : undefined}
                className="w-11 h-14 text-center text-lg font-bold bg-[#1a1625] border border-[#2a1f0a] rounded-xl text-amber-50 focus:outline-none focus:border-amber-600 focus:ring-1 focus:ring-amber-600/30 transition-all"
              />
            ))}
          </div>

          {error && (
            <div className="bg-red-950/40 border border-red-800/40 text-red-400 text-sm rounded-xl px-4 py-2.5 text-center mb-4">
              {error}
            </div>
          )}

          <button
            onClick={handleVerify}
            disabled={loading || code.join('').length !== 6}
            className="w-full py-2.5 bg-gradient-to-l from-sky-600 to-blue-700 hover:from-sky-500 hover:to-blue-600 disabled:from-sky-800 disabled:to-blue-900 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all text-sm shadow-lg shadow-sky-900/20 flex items-center justify-center gap-2"
          >
            {loading && <Loader2 size={18} className="animate-spin" />}
            {loading ? 'جاري التحقق...' : 'تحقق'}
          </button>

          <div className="mt-4 text-center">
            {canResend ? (
              <button
                onClick={handleResend}
                className="text-amber-500 hover:text-amber-400 text-sm transition-colors"
              >
                إعادة إرسال الرمز
              </button>
            ) : (
              <p className="text-amber-600/50 text-sm">
                إعادة الإرسال بعد {countdown} ثانية
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
