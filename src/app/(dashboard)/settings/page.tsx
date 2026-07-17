'use client';

import { useState, useEffect } from 'react';
import { Save, Palette, Sun, Moon, Check, Info, CreditCard, Mail, Phone, Building2, Calendar, AlertCircle } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Tabs } from '@/components/ui/Tabs';
import { Card } from '@/components/ui/Card';
import { useThemeStore } from '@/store/theme-store';
import { useAuthStore } from '@/store/auth-store';
import { themes } from '@/lib/themes';

export default function SettingsPage() {
  const [tab, setTab] = useState('general');
  const [toast, setToast] = useState('');
  const [loading, setLoading] = useState(true);
  const { themeId, isDark, setTheme, toggleMode } = useThemeStore();
  const { user, company } = useAuthStore();

  // Company form state
  const [companyName, setCompanyName] = useState('');
  const [registration, setRegistration] = useState('');
  const [taxNumber, setTaxNumber] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');

  // Accounting settings
  const [fiscalStart, setFiscalStart] = useState('');
  const [decimalPlaces, setDecimalPlaces] = useState('2');
  const [vatRate, setVatRate] = useState('15');
  
  // Notifications
  const [notifInvoice, setNotifInvoice] = useState(true);
  const [notifDue, setNotifDue] = useState(true);
  const [notifStock, setNotifStock] = useState(true);
  const [notifVoucher, setNotifVoucher] = useState(false);

  // Subscription state
  const [subscription, setSubscription] = useState<any>(null);
  const [subLoading, setSubLoading] = useState(true);

  useEffect(() => {
    // Load company data and settings
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          const c = d.data?.company;
          if (c) {
            setCompanyName(c.name || '');
            setRegistration(c.commercial_registration || c.registrationNumber || '');
            setTaxNumber(c.tax_number || c.taxNumber || '');
            setPhone(c.phone || '');
            setEmail(c.email || '');
            setAddress(c.address || '');
          }
          const s = d.data?.settings || {};
          if (s.fiscal_start) setFiscalStart(s.fiscal_start);
          if (s.decimal_places) setDecimalPlaces(s.decimal_places);
          if (s.vat_rate) setVatRate(s.vat_rate);
          if (s.notif_invoice !== undefined) setNotifInvoice(s.notif_invoice === 'true');
          if (s.notif_due !== undefined) setNotifDue(s.notif_due === 'true');
          if (s.notif_stock !== undefined) setNotifStock(s.notif_stock === 'true');
          if (s.notif_voucher !== undefined) setNotifVoucher(s.notif_voucher === 'true');
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    // Load subscription data
    fetch('/api/auth/subscription-status')
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setSubscription(d.data);
      })
      .catch(() => {})
      .finally(() => setSubLoading(false));
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const handleSaveCompany = async () => {
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: companyName,
          commercial_registration: registration,
          tax_number: taxNumber,
          phone: phone,
          email: email,
          address: address,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast('تم حفظ إعدادات الشركة بنجاح');
      } else {
        showToast(data.message || 'فشل الحفظ');
      }
    } catch {
      showToast('حدث خطأ في الاتصال');
    }
  };

  const handleSaveAccounting = async () => {
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: {
            fiscal_start: fiscalStart,
            decimal_places: decimalPlaces,
          }
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast('تم حفظ الإعدادات المحاسبية');
      } else {
        showToast(data.message || 'فشل الحفظ');
      }
    } catch {
      showToast('حدث خطأ في الاتصال');
    }
  };

  const handleSaveTax = async () => {
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: {
            vat_rate: vatRate,
          }
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast('تم حفظ إعدادات الضرائب');
      } else {
        showToast(data.message || 'فشل الحفظ');
      }
    } catch {
      showToast('حدث خطأ في الاتصال');
    }
  };

  const handleSaveNotifications = async () => {
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: {
            notif_invoice: String(notifInvoice),
            notif_due: String(notifDue),
            notif_stock: String(notifStock),
            notif_voucher: String(notifVoucher),
          }
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast('تم حفظ إعدادات الإشعارات');
      } else {
        showToast(data.message || 'فشل الحفظ');
      }
    } catch {
      showToast('حدث خطأ في الاتصال');
    }
  };

  const currentTheme = themes.find((t) => t.id === themeId) || themes[0];

  return (
    <div className="space-y-6">
      <PageHeader title="الإعدادات" description="إعدادات الشركة والنظام" />

      <Tabs items={[
        { id: 'general', label: 'عام' },
        { id: 'accounting', label: 'محاسبة' },
        { id: 'tax', label: 'ضرائب' },
        { id: 'subscription', label: 'الاشتراك' },
        { id: 'about', label: 'حول البرنامج' },
        { id: 'appearance', label: 'المظهر' },
        { id: 'notifications', label: 'إشعارات' },
      ]} activeTab={tab} onChange={setTab} />

      {/* General — Company Info */}
      {tab === 'general' && (
        <Card title="معلومات الشركة">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="اسم الشركة" value={companyName} onChange={(e: any) => setCompanyName(e.target.value)} className="col-span-2" />
            <Input label="رقم السجل التجاري" value={registration} onChange={(e: any) => setRegistration(e.target.value)} />
            <Input label="الرقم الضريبي" value={taxNumber} onChange={(e: any) => setTaxNumber(e.target.value)} />
            <Input label="الهاتف" type="tel" type="tel" value={phone} onChange={(e: any) => setPhone(e.target.value)} />
            <Input label="البريد الإلكتروني" type="email" value={email} onChange={(e: any) => setEmail(e.target.value)} />
            <Input label="العنوان" value={address} onChange={(e: any) => setAddress(e.target.value)} className="col-span-2" />
          </div>
          <div className="mt-4">
            <Button onClick={handleSaveCompany} leftIcon={<Save size={16} />}>حفظ الإعدادات</Button>
          </div>
        </Card>
      )}

      {/* Accounting */}
      {tab === 'accounting' && (
        <Card title="الإعدادات المحاسبية">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="بداية السنة المالية" type="date" value={fiscalStart} onChange={(e:any)=>setFiscalStart(e.target.value)} />
            <Input label="عدد المنازل العشرية" type="number" value={decimalPlaces} onChange={(e:any)=>setDecimalPlaces(e.target.value)} />
          </div>
          <div className="mt-4">
            <Button onClick={handleSaveAccounting} leftIcon={<Save size={16} />}>حفظ</Button>
          </div>
        </Card>
      )}

      {/* Tax */}
      {tab === 'tax' && (
        <Card title="إعدادات الضرائب">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="نسبة ضريبة القيمة المضافة (%)" type="number" value={vatRate} onChange={(e:any)=>setVatRate(e.target.value)} />
          </div>
          <div className="mt-4">
            <Button onClick={handleSaveTax} leftIcon={<Save size={16} />}>حفظ</Button>
          </div>
        </Card>
      )}

      {/* Subscription */}
      {tab === 'subscription' && (
        <div className="space-y-4">
          {subLoading ? (
            <Card><div className="text-center py-8 text-text-muted">جاري التحميل...</div></Card>
          ) : subscription ? (
            <>
              <Card title="حالة الاشتراك">
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 rounded-lg bg-bg-secondary">
                    <span className="text-sm text-text-muted">الباقة الحالية</span>
                    <span className="font-bold text-accent">{subscription.plan_name || 'تجريبي'}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-bg-secondary">
                    <span className="text-sm text-text-muted">الحالة</span>
                    <span className={`font-bold ${subscription.is_expired ? 'text-danger' : 'text-success'}`}>
                      {subscription.is_expired ? 'منتهي' : 'نشط'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-bg-secondary">
                    <span className="text-sm text-text-muted">تاريخ الانتهاء</span>
                    <span className="font-medium text-text-primary" dir="ltr">{subscription.end_date}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-bg-secondary">
                    <span className="text-sm text-text-muted">الأيام المتبقية</span>
                    <span className={`font-bold ${subscription.days_remaining <= 7 ? 'text-warning' : 'text-success'}`}>
                      {subscription.days_remaining} يوم
                    </span>
                  </div>
                  {subscription.is_expiring_soon && !subscription.is_expired && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-warning/10 border border-warning/30 text-warning text-sm">
                      <AlertCircle size={16} />
                      اشتراكك ينتهي قريباً — يرجى التجديد
                    </div>
                  )}
                  <Button onClick={() => window.location.href = '/subscription'} leftIcon={<CreditCard size={16} />}>
                    ترقية / تجديد الاشتراك
                  </Button>
                </div>
              </Card>
            </>
          ) : (
            <Card><div className="text-center py-8 text-text-muted">لا يوجد اشتراك. <a href="/subscription" className="text-accent">اشترك الآن</a></div></Card>
          )}
        </div>
      )}

      {/* About */}
      {tab === 'about' && (
        <Card title="حول البرنامج">
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 rounded-xl bg-accent/5">
              <div className="w-12 h-12 rounded-xl bg-accent flex items-center justify-center">
                <Building2 size={24} className="text-white" />
              </div>
              <div>
                <h3 className="font-bold text-text-primary">برو أكاوننت — AccWeb</h3>
                <p className="text-xs text-text-muted">نظام محاسبة متكامل — الإصدار 1.0</p>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-bold text-text-secondary mb-2">بيانات حسابك</h4>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-bg-secondary">
                <Mail size={16} className="text-text-muted" />
                <span className="text-sm text-text-muted">البريد:</span>
                <span className="text-sm font-medium text-text-primary" dir="ltr">{user?.email || '—'}</span>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-bg-secondary">
                <Info size={16} className="text-text-muted" />
                <span className="text-sm text-text-muted">الاسم:</span>
                <span className="text-sm font-medium text-text-primary">{user?.name || '—'}</span>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-bg-secondary">
                <Building2 size={16} className="text-text-muted" />
                <span className="text-sm text-text-muted">الشركة:</span>
                <span className="text-sm font-medium text-text-primary">{company?.name || '—'}</span>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-bg-secondary">
                <CreditCard size={16} className="text-text-muted" />
                <span className="text-sm text-text-muted">رقم الاشتراك:</span>
                <span className="text-sm font-medium text-text-primary font-mono" dir="ltr">
                  {subscription ? subscription.id?.substring(0, 8) : '—'}
                </span>
              </div>
            </div>

            <div className="space-y-2 pt-4 border-t border-border">
              <h4 className="text-sm font-bold text-text-secondary mb-2">للتواصل والدعم</h4>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-bg-secondary">
                <Mail size={16} className="text-accent" />
                <span className="text-sm text-text-muted">البريد:</span>
                <a href="mailto:conta.moha@gmail.com" className="text-sm text-accent hover:underline" dir="ltr">conta.moha@gmail.com</a>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-bg-secondary">
                <Phone size={16} className="text-accent" />
                <span className="text-sm text-text-muted">تيليجرام:</span>
                <a href="https://t.me/contashepo" className="text-sm text-accent hover:underline" dir="ltr">@contashepo</a>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-bg-secondary text-center">
              <p className="text-xs text-text-muted">
                عند التواصل مع الدعم، يرجى إرسال رقم اشتراكك وبريدك الإلكتروني لتسهيل المساعدة
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Appearance */}
      {tab === 'appearance' && (
        <div className="space-y-6">
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold">الوضع</h3>
                <p className="text-sm text-text-muted mt-0.5">
                  {isDark ? 'وضع داكن — ألوان عميقة مريحة للعين' : 'وضع فاتح — ألوان نقية مناسبة للإضاءة القوية'}
                </p>
              </div>
              <button
                onClick={toggleMode}
                className={`relative w-16 h-8 rounded-full transition-colors duration-300 ${isDark ? 'bg-accent/30' : 'bg-border'}`}
              >
                <div
                  className={`absolute top-1 w-6 h-6 rounded-full bg-accent flex items-center justify-center transition-all duration-300 shadow-md ${isDark ? 'right-1' : 'right-9'}`}
                >
                  {isDark ? <Moon size={12} className="text-white" /> : <Sun size={12} className="text-white" />}
                </div>
              </button>
            </div>
          </Card>

          <Card>
            <div className="flex items-center gap-2 mb-4">
              <Palette size={18} className="text-accent" />
              <h3 className="text-base font-semibold">الثيم</h3>
            </div>
            <p className="text-sm text-text-muted mb-4">
              اختر لوحة الألوان الأساسية.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {themes.map((theme) => {
                const isActive = theme.id === themeId;
                const previewAccent = isDark ? theme.dark['--color-accent'] : theme.light['--color-accent'];
                const previewCard = isDark ? theme.dark['--color-bg-card'] : theme.light['--color-bg-card'];
                const previewBg = isDark ? theme.dark['--color-bg-primary'] : theme.light['--color-bg-primary'];
                const previewBorder = isDark ? theme.dark['--color-border'] : theme.light['--color-border'];

                return (
                  <button
                    key={theme.id}
                    onClick={() => setTheme(theme.id)}
                    className={`relative p-3 rounded-xl border-2 text-right transition-all duration-200 hover:-translate-y-0.5 ${isActive ? 'border-accent shadow-md' : 'border-border hover:border-border-light'}`}
                    style={{ background: previewCard }}
                  >
                    {isActive && (
                      <div className="absolute top-2 left-2 w-5 h-5 rounded-full bg-accent flex items-center justify-center">
                        <Check size={12} className="text-white" />
                      </div>
                    )}
                    <div className="flex gap-2 mb-2">
                      <div className="w-8 h-8 rounded-lg" style={{ background: previewAccent }} />
                      <div>
                        <div className="text-sm font-semibold text-text-primary">{theme.name}</div>
                        <div className="text-[11px] text-text-muted">{theme.nameEn}</div>
                      </div>
                    </div>
                    <p className="text-xs text-text-muted leading-relaxed mb-2">{theme.description}</p>
                    <div className="h-8 rounded-lg flex gap-1 p-1" style={{ background: previewBg, border: `1px solid ${previewBorder}` }}>
                      <div className="flex-1 rounded" style={{ background: previewCard }} />
                      <div className="w-6 rounded" style={{ background: previewAccent }} />
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>
        </div>
      )}

      {/* Notifications */}
      {tab === 'notifications' && (
        <Card title="الإشعارات">
          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 rounded border-border accent-accent" checked={notifInvoice} onChange={(e)=>setNotifInvoice(e.target.checked)} />
              <span className="text-sm">إشعار عند إضافة فاتورة جديدة</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 rounded border-border accent-accent" checked={notifDue} onChange={(e)=>setNotifDue(e.target.checked)} />
              <span className="text-sm">إشعار عند استحقاق فاتورة</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 rounded border-border accent-accent" checked={notifStock} onChange={(e)=>setNotifStock(e.target.checked)} />
              <span className="text-sm">إشعار عند انخفاض رصيد المخزون</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 rounded border-border accent-accent" checked={notifVoucher} onChange={(e)=>setNotifVoucher(e.target.checked)} />
              <span className="text-sm">إشعار عند إنشاء سند قبض/صرف</span>
            </label>
          </div>
          <div className="mt-4">
            <Button onClick={handleSaveNotifications} leftIcon={<Save size={16} />}>حفظ</Button>
          </div>
        </Card>
      )}

      {toast && (
        <div className="toast toast-success">
          <span>{toast}</span>
          <button onClick={() => setToast('')} className="btn-ghost btn-sm">✕</button>
        </div>
      )}
    </div>
  );
}
