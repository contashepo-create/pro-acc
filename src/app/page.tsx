'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Calculator, Shield, Clock, BarChart3, FileText, Users, Building2,
  CheckCircle, ArrowLeft, Mail, Phone, MessageSquare, AlertCircle,
  Loader2, Star, Zap, Lock, CreditCard
} from 'lucide-react';
import { useRouter } from 'next/navigation';

interface VisitorStats {
  visits: number;
  unique_visitors: number;
}

export default function LandingPage() {
  const router = useRouter();
  const [stats, setStats] = useState<VisitorStats | null>(null);
  const [complaintModal, setComplaintModal] = useState(false);
  const [complaintSent, setComplaintSent] = useState('');
  const [trackingId, setTrackingId] = useState('');
  const [trackModal, setTrackModal] = useState(false);
  const [trackResult, setTrackResult] = useState<any>(null);
  const [trackLoading, setTrackLoading] = useState(false);

  useEffect(() => {
    fetch('/api/visitors')
      .then((r) => r.json())
      .then((d) => { if (d.success) setStats(d.data); })
      .catch(() => {});
  }, []);

  const features = [
    { icon: Calculator, title: 'محاسبة متكاملة', desc: 'قيود يومية، فواتير، سندات قبض وصرف، ميزان مراجعة' },
    { icon: Building2, title: 'إدارة المشاريع', desc: 'متابعة تكاليف المشاريع، مقاولي الباطن، الفواتير المرحلية' },
    { icon: FileText, title: 'الفواتير والمشتريات', desc: 'فواتير المبيعات والمشتريات، عروض الأسعار، أوامر الشراء' },
    { icon: Users, title: 'إدارة الموظفين', desc: ' الرواتب، كشوف المرتبات، العمال اليوميين، العهد' },
    { icon: BarChart3, title: 'التقارير المالية', desc: 'قائمة الدخل، الميزانية العمومية، تقارير الربحية والتقادم' },
    { icon: Shield, title: 'حماية وأمان', desc: 'مصادقة ثنائية، تشفير كامل، عزل بيانات كل شركة' },
  ];

  const plans = [
    {
      name: 'تجريبي', price: '0', period: '30 يوم',
      features: ['جميع الميزات', 'شركة واحدة', 'مستخدم واحد', 'دعم عبر البريد'],
      color: 'border-border',
    },
    {
      name: 'احترافي', price: '199', period: 'شهرياً',
      features: ['كل ميزات التجريبي', 'حتى 10 مستخدمين', 'مشاريع غير محدودة', 'دعم优先', 'تقارير متقدمة'],
      color: 'border-accent ring-2 ring-accent',
    },
    {
      name: 'مؤسسات', price: '499', period: 'شهرياً',
      features: ['كل ميزات الاحترافي', 'مستخدمين غير محدودين', 'دعم مخصص', 'تكامل API', 'نسخ احتياطي'],
      color: 'border-border',
    },
  ];

  const handleComplaint = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const formData = new FormData(form);
    const data = Object.fromEntries(formData);
    setComplaintSent('جاري الإرسال...');
    try {
      const res = await fetch('/api/complaints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const result = await res.json();
      if (result.success) {
        setComplaintSent('تم إرسال شكواك بنجاح');
        setTrackingId(result.data?.tracking_id || result.data?.id || '');
        (form as HTMLFormElement).reset();
      } else {
        setComplaintSent('فشل الإرسال: ' + (result.message || ''));
      }
    } catch {
      setComplaintSent('حدث خطأ في الاتصال');
    }
  };

  const handleTrack = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const formData = new FormData(form);
    const id = formData.get('tracking_id') as string;
    if (!id) return;
    setTrackLoading(true);
    setTrackResult(null);
    try {
      const res = await fetch(`/api/complaints?tracking_id=${id}`);
      const result = await res.json();
      if (result.success) {
        setTrackResult(result.data);
      } else {
        setTrackResult({ error: result.message || 'لم يتم العثور على الشكوى' });
      }
    } catch {
      setTrackResult({ error: 'حدث خطأ في الاتصال' });
    }
    setTrackLoading(false);
  };

  return (
    <div className="min-h-screen">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 glass-header border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center">
              <Calculator size={22} className="text-white" />
            </div>
            <div>
              <h1 className="font-bold text-text-primary">برو <span className="text-accent">أكاوننت</span></h1>
              <p className="text-[10px] text-text-muted">نظام محاسبة متكامل</p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <a href="#features" className="hidden sm:block text-sm text-text-secondary hover:text-accent transition-colors">الميزات</a>
            <a href="#plans" className="hidden sm:block text-sm text-text-secondary hover:text-accent transition-colors">الخطط</a>
            <a href="#contact" className="hidden sm:block text-sm text-text-secondary hover:text-accent transition-colors">تواصل</a>
            <Link href="/login" className="btn btn-ghost btn-sm">تسجيل الدخول</Link>
            <Link href="/register" className="btn btn-primary btn-sm">ابدأ مجاناً</Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden py-20 sm:py-28">
        <div className="absolute inset-0 bg-gradient-to-br from-accent/5 to-transparent" />
        <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center relative">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-accent/10 border border-accent/20 mb-6">
            <Zap size={14} className="text-accent" />
            <span className="text-xs font-medium text-accent">تجربة مجانية 30 يوماً — بدون بطاقة ائتمان</span>
          </div>
          <h1 className="text-3xl sm:text-5xl font-bold text-text-primary mb-6 leading-tight">
            نظام محاسبة متكامل
            <br />
            <span className="text-accent">للشركات والمؤسسات</span>
          </h1>
          <p className="text-base sm:text-lg text-text-muted mb-8 max-w-2xl mx-auto leading-relaxed">
            أدِر حسابات شركتك بكفاءة — قيود محاسبية، فواتير، مشاريع، رواتب، تقارير مالية،
            وكل ما تحتاجه في مكان واحد آمن وسهل الاستخدام
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/register" className="btn btn-primary h-12 px-8 text-base">
              ابدأ مجاناً الآن
              <ArrowLeft size={18} />
            </Link>
            <Link href="/login" className="btn btn-ghost h-12 px-8 text-base">
              تسجيل الدخول
            </Link>
          </div>
          {stats && (
            <div className="flex items-center justify-center gap-6 mt-10 text-text-muted">
              <div className="text-center">
                <div className="text-2xl font-bold text-text-primary">{stats.visits || 0}</div>
                <div className="text-xs">زيارة</div>
              </div>
              <div className="w-px h-8 bg-border" />
              <div className="text-center">
                <div className="text-2xl font-bold text-text-primary">{stats.unique_visitors || 0}</div>
                <div className="text-xs">زائر فريد</div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-20 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold text-text-primary mb-3">كل ما تحتاجه في مكان واحد</h2>
            <p className="text-text-muted">ميزات شاملة تغطي جميع احتياجاتك المحاسبية والإدارية</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((f, i) => (
              <div key={i} className="card p-6 card-lift">
                <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center mb-4">
                  <f.icon size={24} className="text-accent" />
                </div>
                <h3 className="font-bold text-text-primary mb-2">{f.title}</h3>
                <p className="text-sm text-text-muted leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Plans */}
      <section id="plans" className="py-20 px-4 sm:px-6 bg-bg-secondary">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold text-text-primary mb-3">اختر الخطة المناسبة</h2>
            <p className="text-text-muted">ابدأ بتجربة مجانية ثم اختر الخطة التي تناسبك</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {plans.map((p, i) => (
              <div key={i} className={`card p-6 flex flex-col ${p.color}`}>
                <h3 className="text-lg font-bold text-text-primary mb-2">{p.name}</h3>
                <div className="mb-4">
                  <span className="text-3xl font-bold text-text-primary">{p.price}</span>
                  <span className="text-sm text-text-muted mr-1">ر.س / {p.period}</span>
                </div>
                <ul className="space-y-2 mb-6 flex-1">
                  {p.features.map((f, j) => (
                    <li key={j} className="flex items-center gap-2 text-sm text-text-secondary">
                      <CheckCircle size={16} className="text-success shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link href="/register" className={`btn w-full ${i === 1 ? 'btn-primary' : 'btn-secondary'}`}>
                  {i === 0 ? 'ابدأ تجربة مجانية' : 'اشترك الآن'}
                </Link>
              </div>
            ))}
          </div>
          <div className="text-center mt-8">
            <p className="text-sm text-text-muted">جميع الخطط تشمل تحديثات مجانية ودعم فني</p>
          </div>
        </div>
      </section>

      {/* Complaint & Track */}
      <section className="py-20 px-4 sm:px-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold text-text-primary mb-3">شكاوي واقتراحات</h2>
            <p className="text-text-muted">صوتك يهمنا — أرسل شكواك أو تتبع حالتها</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="card p-6">
              <h3 className="font-bold text-text-primary mb-4 flex items-center gap-2">
                <MessageSquare size={18} className="text-accent" />
                تقديم شكوى
              </h3>
              <form onSubmit={handleComplaint} className="space-y-3">
                <input type="text" name="name" placeholder="الاسم" className="input-base" required />
                <input type="email" name="email" placeholder="البريد الإلكتروني" className="input-base" required dir="ltr" />
                <input type="text" name="subject" placeholder="الموضوع" className="input-base" required />
                <textarea name="message" placeholder="تفاصيل الشكوى" className="input-base min-h-[100px] resize-y" required />
                <button type="submit" className="btn btn-primary w-full">إرسال</button>
                {complaintSent && (
                  <div className="text-sm text-center">
                    <p className={complaintSent.includes('بنجاح') ? 'text-success' : 'text-text-muted'}>{complaintSent}</p>
                    {trackingId && (
                      <div className="mt-2 p-3 rounded-lg bg-bg-secondary">
                        <p className="text-xs text-text-muted mb-1">رقم تتبع الشكوى:</p>
                        <p className="font-mono font-bold text-accent" dir="ltr">{trackingId}</p>
                      </div>
                    )}
                  </div>
                )}
              </form>
            </div>
            <div className="card p-6">
              <h3 className="font-bold text-text-primary mb-4 flex items-center gap-2">
                <AlertCircle size={18} className="text-accent" />
                تتبع شكوى
              </h3>
              <form onSubmit={handleTrack} className="space-y-3">
                <input type="text" name="tracking_id" placeholder="رقم الشكوى" className="input-base" required dir="ltr" />
                <button type="submit" disabled={trackLoading} className="btn btn-secondary w-full">
                  {trackLoading ? <Loader2 size={18} className="animate-spin" /> : 'تتبع'}
                </button>
                {trackResult && (
                  <div className="mt-3 p-4 rounded-lg bg-bg-secondary">
                    {trackResult.error ? (
                      <p className="text-sm text-danger">{trackResult.error}</p>
                    ) : (
                      <div className="space-y-1 text-sm">
                        <div><span className="text-text-muted">الموضوع:</span> {trackResult.subject}</div>
                        <div><span className="text-text-muted">الحالة:</span> {trackResult.status || 'قيد المعالجة'}</div>
                        <div><span className="text-text-muted">التاريخ:</span> {trackResult.created_at}</div>
                      </div>
                    )}
                  </div>
                )}
              </form>
            </div>
          </div>
        </div>
      </section>

      {/* Contact */}
      <section id="contact" className="py-20 px-4 sm:px-6 bg-bg-secondary">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-2xl sm:text-3xl font-bold text-text-primary mb-3">تواصل معنا</h2>
          <p className="text-text-muted mb-8">نحن هنا لمساعدتك في أي وقت</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div className="card p-6">
              <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center mx-auto mb-3">
                <Mail size={22} className="text-accent" />
              </div>
              <h3 className="font-bold text-text-primary mb-1">البريد الإلكتروني</h3>
              <a href="mailto:conta.moha@gmail.com" className="text-sm text-accent hover:underline" dir="ltr">conta.moha@gmail.com</a>
            </div>
            <div className="card p-6">
              <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center mx-auto mb-3">
                <Phone size={22} className="text-accent" />
              </div>
              <h3 className="font-bold text-text-primary mb-1">تيليجرام</h3>
              <a href="https://t.me/contashepo" className="text-sm text-accent hover:underline" dir="ltr">@contashepo</a>
            </div>
            <div className="card p-6">
              <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center mx-auto mb-3">
                <Clock size={22} className="text-accent" />
              </div>
              <h3 className="font-bold text-text-primary mb-1">دعم 24/7</h3>
              <p className="text-sm text-text-muted">دعم فني متواصل</p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-4 border-t border-border">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center">
              <Calculator size={16} className="text-white" />
            </div>
            <span className="text-sm text-text-muted">برو أكاوننت © {new Date().getFullYear()}</span>
          </div>
          <div className="flex items-center gap-4 text-sm text-text-muted">
            <Link href="/login" className="hover:text-accent transition-colors">تسجيل الدخول</Link>
            <Link href="/register" className="hover:text-accent transition-colors">حساب جديد</Link>
            <a href="#features" className="hover:text-accent transition-colors">الميزات</a>
            <a href="#plans" className="hover:text-accent transition-colors">الخطط</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
