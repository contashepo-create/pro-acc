'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';
import Link from 'next/link';

function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus('error');
      setMessage('رمز التحقق مفقود');
      return;
    }

    fetch('/api/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setStatus('success');
          setMessage(data.data?.message || 'تم تأكيد البريد الإلكتروني');
        } else {
          setStatus('error');
          setMessage(data.message || 'فشل التحقق');
        }
      })
      .catch(() => {
        setStatus('error');
        setMessage('حدث خطأ في الاتصال');
      });
  }, [token]);

  return (
    <div className="glass rounded-2xl p-8 w-full shadow-modal">
      <div className="text-center">
        {status === 'loading' && (
          <>
            <Loader2 size={48} className="animate-spin text-accent mx-auto mb-4" />
            <h1 className="text-xl font-bold text-text-primary">جاري التحقق...</h1>
            <p className="text-text-muted text-sm mt-2">يرجى الانتظار</p>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle size={48} className="text-success mx-auto mb-4" />
            <h1 className="text-xl font-bold text-text-primary">تم التأكيد!</h1>
            <p className="text-text-muted text-sm mt-2">{message}</p>
            <Link href="/login" className="btn btn-primary mt-6 inline-block">
              تسجيل الدخول
            </Link>
          </>
        )}
        {status === 'error' && (
          <>
            <XCircle size={48} className="text-danger mx-auto mb-4" />
            <h1 className="text-xl font-bold text-text-primary">فشل التحقق</h1>
            <p className="text-text-muted text-sm mt-2">{message}</p>
            <Link href="/register" className="btn btn-primary mt-6 inline-block">
              العودة للتسجيل
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><Loader2 size={32} className="animate-spin text-accent" /></div>}>
      <VerifyEmailContent />
    </Suspense>
  );
}
