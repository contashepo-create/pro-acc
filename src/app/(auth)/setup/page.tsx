'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, UserPlus, Loader2, CheckCircle, ArrowLeft, ArrowRight } from 'lucide-react';

interface CompanyForm {
  name: string;
  commercial_registration: string;
  tax_number: string;
}

interface AdminForm {
  name: string;
  email: string;
  password: string;
  confirm_password: string;
}

export default function SetupPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const [company, setCompany] = useState<CompanyForm>({
    name: '',
    commercial_registration: '',
    tax_number: '',
  });

  const [admin, setAdmin] = useState<AdminForm>({
    name: '',
    email: '',
    password: '',
    confirm_password: '',
  });

  const updateCompany = (field: keyof CompanyForm, value: string) =>
    setCompany((prev) => ({ ...prev, [field]: value }));

  const updateAdmin = (field: keyof AdminForm, value: string) =>
    setAdmin((prev) => ({ ...prev, [field]: value }));

  const handleNext = () => {
    setError('');
    if (!company.name.trim()) { setError('يرجى إدخال اسم الشركة'); return; }
    setStep(2);
  };

  const handleBack = () => setStep(1);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!admin.name.trim()) { setError('يرجى إدخال اسم المدير'); return; }
    if (!admin.email.trim()) { setError('يرجى إدخال البريد الإلكتروني'); return; }
    if (!admin.password) { setError('يرجى إدخال كلمة المرور'); return; }
    if (admin.password.length < 6) { setError('كلمة المرور يجب أن تكون 6 أحرف على الأقل'); return; }
    if (admin.password !== admin.confirm_password) { setError('كلمة المرور غير متطابقة'); return; }

    setLoading(true);
    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company, admin }),
      });

      const body = await res.json();

      if (!res.ok || !body.success) {
        setError(body.message || 'حدث خطأ أثناء إعداد النظام');
        return;
      }

      setSuccess(true);
      setTimeout(() => router.push('/login'), 2000);
    } catch {
      setError('حدث خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="glass rounded-2xl p-8 w-full shadow-modal text-center">
        <div className="w-16 h-16 rounded-full bg-success-light flex items-center justify-center mx-auto mb-4">
          <CheckCircle size={32} className="text-success" />
        </div>
        <h2 className="text-xl font-bold text-text-primary mb-2">تم إعداد النظام بنجاح</h2>
        <p className="text-text-muted text-sm">جاري تحويلك إلى صفحة تسجيل الدخول...</p>
      </div>
    );
  }

  return (
    <div className="glass rounded-2xl p-8 w-full shadow-modal">
      {/* Logo */}
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold text-text-primary">
          برو <span className="text-accent">أكاوننت</span>
        </h1>
        <p className="text-text-muted text-sm mt-1">الإعداد الأولي للنظام</p>
      </div>

      {/* Progress */}
      <div className="flex items-center gap-2 mb-8">
        <div className={`flex-1 h-2 rounded-full ${step >= 1 ? 'bg-accent' : 'bg-border'}`} />
        <div className={`flex-1 h-2 rounded-full ${step >= 2 ? 'bg-accent' : 'bg-border'}`} />
      </div>

      {error && (
        <div className="bg-danger-light/30 border border-danger/30 text-danger text-sm rounded-lg px-4 py-2.5 mb-4">
          {error}
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-accent-light flex items-center justify-center">
              <Building2 size={20} className="text-accent" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-text-primary">معلومات الشركة</h2>
              <p className="text-xs text-text-muted">الخطوة 1 من 2</p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">اسم الشركة <span className="text-danger">*</span></label>
            <input
              type="text"
              value={company.name}
              onChange={(e) => updateCompany('name', e.target.value)}
              placeholder="الاسم التجاري للشركة"
              className="input-base"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">السجل التجاري</label>
            <input
              type="text"
              value={company.commercial_registration}
              onChange={(e) => updateCompany('commercial_registration', e.target.value)}
              placeholder="رقم السجل التجاري"
              className="input-base"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">الرقم الضريبي</label>
            <input
              type="text"
              value={company.tax_number}
              onChange={(e) => updateCompany('tax_number', e.target.value)}
              placeholder="رقم التسجيل الضريبي"
              className="input-base"
            />
          </div>

          <button onClick={handleNext} className="btn btn-primary w-full h-11 mt-2">
            التالي
            <ArrowLeft size={18} />
          </button>
        </div>
      )}

      {step === 2 && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-accent-light flex items-center justify-center">
              <UserPlus size={20} className="text-accent" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-text-primary">المستخدم المسؤول</h2>
              <p className="text-xs text-text-muted">الخطوة 2 من 2</p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">الاسم <span className="text-danger">*</span></label>
            <input
              type="text"
              value={admin.name}
              onChange={(e) => updateAdmin('name', e.target.value)}
              placeholder="الاسم الكامل"
              className="input-base"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">البريد الإلكتروني <span className="text-danger">*</span></label>
            <input
              type="email"
              value={admin.email}
              onChange={(e) => updateAdmin('email', e.target.value)}
              placeholder="admin@example.com"
              className="input-base"
              dir="ltr"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">كلمة المرور <span className="text-danger">*</span></label>
            <input
              type="password"
              value={admin.password}
              onChange={(e) => updateAdmin('password', e.target.value)}
              placeholder="••••••••"
              className="input-base"
              dir="ltr"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">تأكيد كلمة المرور <span className="text-danger">*</span></label>
            <input
              type="password"
              value={admin.confirm_password}
              onChange={(e) => updateAdmin('confirm_password', e.target.value)}
              placeholder="••••••••"
              className="input-base"
              dir="ltr"
            />
          </div>

          <div className="flex gap-3 mt-2">
            <button type="button" onClick={handleBack} className="btn btn-secondary flex-1 h-11">
              <ArrowRight size={18} />
              السابق
            </button>
            <button type="submit" disabled={loading} className="btn btn-primary flex-1 h-11">
              {loading ? (
                <Loader2 size={20} className="animate-spin" />
              ) : (
                <CheckCircle size={20} />
              )}
              {loading ? 'جاري الإعداد...' : 'إنشاء النظام'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
