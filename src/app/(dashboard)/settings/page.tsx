'use client';

import { useState, useEffect } from 'react';
import {
  Save, Palette, Sun, Moon, Check, Info, CreditCard, Mail, Phone,
  Building2, Calendar, AlertCircle, Bot, Send, RefreshCw, ExternalLink, Trash2, Key, Globe, MessageSquare, Download, Copy,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

import { Textarea } from '@/components/ui/Textarea';
import { Tabs } from '@/components/ui/Tabs';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useThemeStore } from '@/store/theme-store';
import { useAuthStore } from '@/store/auth-store';
import { themes } from '@/lib/themes';
import { getCountryConfig } from '@/lib/countries';
import { companyMoneyParts } from '@/lib/company-money';
import { defaultFiscalStart } from '@/lib/fiscal-calendar';
import { parseCompanyVatRate, vatPercentLabel } from '@/lib/company-vat';
import { taxQrCaption } from '@/lib/tax-authority';
import OverheadSettings from '@/components/settings/OverheadSettings';
import { 
  INVOICE_TEMPLATES, 
  DEFAULT_INVOICE_SETTINGS, 
  type InvoiceTemplateSettings 
} from '@/lib/invoice-templates';

export default function SettingsPage() {
  const [tab, setTab] = useState('general');
  const [toast, setToast] = useState('');
  const [, setLoading] = useState(true);
  const { themeId, isDark, setTheme, toggleMode } = useThemeStore();
  const { user, company } = useAuthStore();

  // Company form state
  const [companyName, setCompanyName] = useState('');
  const [registration, setRegistration] = useState('');
  const [taxNumber, setTaxNumber] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');

  // Invoice & Print Settings State
  const [invoiceSettings, setInvoiceSettings] = useState<InvoiceTemplateSettings>(DEFAULT_INVOICE_SETTINGS);
  const [invoiceSettingsLoading, setInvoiceSettingsLoading] = useState(false);

  // Accounting settings
  const [fiscalStart, setFiscalStart] = useState('');
  const [decimalPlaces, setDecimalPlaces] = useState('2');
  const [autoAllocateFifo, setAutoAllocateFifo] = useState(false);
  const [vatRate, setVatRate] = useState('15');
  const [countryCode, setCountryCode] = useState(company?.country_code || 'SA');
  const initialMoney = companyMoneyParts(company);
  const [currencySymbol, setCurrencySymbol] = useState(initialMoney.symbol);
  const [currencyCode, setCurrencyCode] = useState(initialMoney.code);
  
  // Notifications
  const [notifInvoice, setNotifInvoice] = useState(true);
  const [notifDue, setNotifDue] = useState(true);
  const [notifStock, setNotifStock] = useState(true);
  const [notifVoucher, setNotifVoucher] = useState(false);

interface SettingsSubscription {
  id?: string;
  subscriber_number?: string;
  plan_name?: string;
  end_date?: string;
  days_remaining: number;
  is_expired: boolean;
  is_expiring_soon: boolean;
}
interface AppSettingsData {
  app_name?: string;
  app_name_en?: string;
  app_version?: string;
  developer_name?: string;
  support_email?: string;
  support_phone?: string;
  support_whatsapp?: string;
  support_telegram?: string;
  support_website?: string;
  payment_info?: string;
  payment_bank_name?: string;
  payment_iban?: string;
  payment_stc_pay?: string;
  footer_text?: string;
}
interface TelegramSettings {
  chat_id: string;
  is_enabled: boolean;
  notify_invoices: boolean;
  notify_cash_transactions: boolean;
  notify_user_logins: boolean;
  approvals_enabled: boolean;
  approval_threshold: string;
}

  // Subscription state
  const [subscription, setSubscription] = useState<SettingsSubscription | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettingsData>({});
  const [subLoading, setSubLoading] = useState(true);
  const [copiedSubNumber, setCopiedSubNumber] = useState(false);

  const copySubscriberNumber = async () => {
    const num = subscription?.subscriber_number;
    if (!num) return;
    try {
      await navigator.clipboard.writeText(num);
      setCopiedSubNumber(true);
      setTimeout(() => setCopiedSubNumber(false), 2000);
    } catch { /* المتصفح لا يدعم النسخ التلقائي */ }
  };

  // Telegram Settings State
  const [telegramAllowed, setTelegramAllowed] = useState(true);
  const [telegramConfig, setTelegramConfig] = useState<TelegramSettings>({
    chat_id: '',
    is_enabled: false,
    notify_invoices: true,
    notify_cash_transactions: true,
    notify_user_logins: true,
    approvals_enabled: false,
    approval_threshold: '5000'
  });
  const [telegramLoading, setTelegramLoading] = useState(false);
  const [testRunId, setTestRunId] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<string>(''); // '', 'pending', 'accepted', 'rejected', 'expired'
  const [testLoading, setTestLoading] = useState(false);

  // تليجرام الموحد للمنصة - يتم تعديله من خلال متغيرات المطور
  const TELEGRAM_BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || 'Proaccwebcontroller_bot';

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (t) setTab(t);
    // Load company data and settings
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          const c = d.data?.company;
          const s = d.data || {}; // settings are at top level, not nested under .settings
          if (c) {
            setCompanyName(c.name || '');
            setRegistration(c.commercial_registration || c.registrationNumber || '');
            setTaxNumber(c.tax_number || c.taxNumber || '');
            setPhone(c.phone || '');
            setEmail(c.email || '');
            setAddress(c.address || '');
          }
          if (s.invoice_template_settings) {
            const saved = typeof s.invoice_template_settings === 'string'
              ? JSON.parse(s.invoice_template_settings)
              : s.invoice_template_settings;
            setInvoiceSettings({ ...DEFAULT_INVOICE_SETTINGS, ...saved });
          }
          if (s.fiscal_start) setFiscalStart(s.fiscal_start);
          else if (c?.country_code) setFiscalStart(defaultFiscalStart(c.country_code));
          if (s.decimal_places) setDecimalPlaces(s.decimal_places);
          if (s.auto_allocate_receipts_fifo !== undefined) {
            const v = s.auto_allocate_receipts_fifo;
            setAutoAllocateFifo(v === true || v === 'true' || v === '1');
          }
          if (c?.country_code) setCountryCode(c.country_code);
          if (c) {
            const parts = companyMoneyParts(c);
            setCurrencySymbol(parts.symbol);
            setCurrencyCode(parts.code);
          }
          if (c) setVatRate(vatPercentLabel(parseCompanyVatRate(c)));
          if (s.notif_invoice !== undefined) setNotifInvoice(s.notif_invoice === 'true' || s.notif_invoice === true);
          if (s.notif_due !== undefined) setNotifDue(s.notif_due === 'true' || s.notif_due === true);
          if (s.notif_stock !== undefined) setNotifStock(s.notif_stock === 'true' || s.notif_stock === true);
          if (s.notif_voucher !== undefined) setNotifVoucher(s.notif_voucher === 'true' || s.notif_voucher === true);
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

    // Load app settings
    fetch('/api/app-settings')
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setAppSettings(d.data || {});
      })
      .catch(() => {});
  }, []);

  // Load Telegram Configurations on tab click
  useEffect(() => {
    if (tab === 'telegram') {
      fetch('/api/settings/telegram')
        .then((r) => r.json())
        .then((d) => {
          if (d.success) {
            setTelegramAllowed(d.data.isAllowed);
            if (d.data.config) {
              setTelegramConfig({
                ...d.data.config,
                approval_threshold: String(d.data.config.approval_threshold || '5000')
              });
            }
          }
        })
        .catch(() => {});
    }
  }, [tab]);

  // Real-time polling for Telegram Interactive Test Run
  useEffect(() => {
    if (testStatus !== 'pending' || !testRunId) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/settings/telegram/test?test_run_id=${testRunId}`);
        const data = await res.json();
        if (data.success && data.data) {
          const status = data.data.status;
          if (status !== 'pending') {
            setTestStatus(status);
            clearInterval(interval);
          }
        }
      } catch (e) {
        console.error('Telegram polling failed:', e);
      }
    }, 2000);

    // Expire the test run after 60 seconds to prevent infinite loops
    const timeout = setTimeout(() => {
      setTestStatus((current) => {
        if (current === 'pending') {
          clearInterval(interval);
          return 'expired';
        }
        return current;
      });
    }, 60000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [testStatus, testRunId]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const handleSaveCompany = async () => {
    const pct = parseFloat(vatRate);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      showToast('نسبة الضريبة غير صالحة');
      return;
    }
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: {
            name: companyName,
            commercial_registration: registration,
            tax_number: taxNumber,
            phone: phone,
            email: email,
            address: address,
            vat_rate: pct / 100,
          },
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

  const handleSaveInvoiceSettings = async () => {
    setInvoiceSettingsLoading(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: {
            invoice_template_settings: invoiceSettings,
          },
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast('تم حفظ إعدادات وقوالب الفواتير بنجاح لجميع الفواتير القادمة! 🎉');
      } else {
        showToast(data.message || 'فشل الحفظ');
      }
    } catch {
      showToast('حدث خطأ في الاتصال');
    } finally {
      setInvoiceSettingsLoading(false);
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
            auto_allocate_receipts_fifo: String(autoAllocateFifo),
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
    const pct = parseFloat(vatRate);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      showToast('نسبة الضريبة غير صالحة');
      return;
    }
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: {
            vat_rate: pct / 100,
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

  const handleSaveTelegram = async () => {
    setTelegramLoading(true);
    try {
      const res = await fetch('/api/settings/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(telegramConfig),
      });
      const data = await res.json();
      if (data.success) {
        showToast('تم حفظ إعدادات تيليجرام بنجاح');
      } else {
        showToast(data.message || 'فشل الحفظ');
      }
    } catch {
      showToast('حدث خطأ في الاتصال');
    } finally {
      setTelegramLoading(false);
    }
  };

  const handleStartTest = async () => {
    if (!telegramConfig.chat_id) {
      showToast('يرجى تعيين وحفظ "معرف الدردشة" (Chat ID) أولاً قبل البدء بالفحص');
      return;
    }
    setTestLoading(true);
    setTestStatus('');
    setTestRunId(null);
    try {
      // First save settings to ensure DB is aligned
      await fetch('/api/settings/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(telegramConfig),
      });

      const res = await fetch('/api/settings/telegram/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.success) {
        setTestRunId(data.data.testRunId);
        setTestStatus('pending');
        showToast('تم إرسال رسالة الفحص لتيليجرام بنجاح');
      } else {
        showToast(data.message || 'فشل البدء بالفحص التفاعلي');
      }
    } catch {
      showToast('حدث خطأ في الاتصال بالشبكة');
    } finally {
      setTestLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="الإعدادات" description="إعدادات الشركة والنظام والربط التقني والتطهير" />

      <Tabs items={[
        { id: 'general', label: 'عام' },
        { id: 'invoices', label: 'الفواتير والطباعة 🧾' },
        { id: 'accounting', label: 'محاسبة' },
        { id: 'tax', label: 'ضرائب' },
        { id: 'subscription', label: 'الاشتراك' },
        { id: 'about', label: 'حول البرنامج' },
        { id: 'appearance', label: 'المظهر' },
        { id: 'notifications', label: 'إشعارات' },
        { id: 'projectcosting', label: 'المشاريع والتكاليف' },
        { id: 'telegram', label: 'تيليجرام 🤖' },
      ]} activeTab={tab} onChange={setTab} />

      {/* General — Company Info */}
      {tab === 'general' && (
        <Card title="معلومات الشركة">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="اسم الشركة" value={companyName} onChange={(e) => setCompanyName(e.target.value)} className="col-span-2" />
            <Input label="رقم السجل التجاري" value={registration} onChange={(e) => setRegistration(e.target.value)} />
            <Input label="الرقم الضريبي" value={taxNumber} onChange={(e) => setTaxNumber(e.target.value)} />
            <Input label="الهاتف" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <Input label="البريد الإلكتروني" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Input label="العنوان" value={address} onChange={(e) => setAddress(e.target.value)} className="col-span-2" />
          </div>

          {/* Country & Currency Section */}
          <div className="mt-6 pt-6 border-t border-border">
            <h4 className="text-sm font-bold text-text-primary mb-3">البلد والعملة</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="دولة التشغيل"
                value={getCountryConfig(countryCode).name}
                disabled
              />
              <p className="sm:col-span-2 text-xs text-text-muted -mt-2">
                تُختار مرة واحدة عند إنشاء الحساب (السعودية أو مصر) ولا يمكن تغييرها. العملة ونسبة الضريبة والتأمينات تتبع هذه الدولة.
              </p>
              <Input label="رمز العملة" value={currencyCode} disabled />
              <Input label="رمز العملة (العرض)" value={currencySymbol} disabled />
              <p className="sm:col-span-2 text-xs text-text-muted -mt-2">
                رمز العرض يتبع دولة التشغيل ولا يُعدَّل يدوياً حتى لا تختلف التقارير عن الدفاتر.
              </p>
              <Input label="نسبة الضريبة (%)" type="number" value={vatRate} onChange={(e) => setVatRate(e.target.value)} />
            </div>
          </div>

          <div className="mt-4">
            <Button onClick={handleSaveCompany} leftIcon={<Save size={16} />}>حفظ الإعدادات</Button>
          </div>
        </Card>
      )}

      {/* Invoice Template & Print Customization Tab */}
      {tab === 'invoices' && (
        <div className="space-y-6 max-w-4xl">
          {/* Default Template Chooser Card */}
          <Card title="القالب الافتراضي للفواتير">
            <p className="text-xs text-text-muted mb-4">
              اختر القالب الافتراضي الذي سيتم استخدامه تلقائياً عند إنشاء وطباعة الفواتير لعملائك:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {INVOICE_TEMPLATES.map((t) => {
                const isSelected = invoiceSettings.defaultTemplate === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setInvoiceSettings({ ...invoiceSettings, defaultTemplate: t.id })}
                    className={`p-4 rounded-2xl border-2 text-right transition-all flex flex-col justify-between ${
                      isSelected 
                        ? 'border-accent bg-accent/5 shadow-md ring-2 ring-accent/20' 
                        : 'border-border bg-bg-primary hover:border-accent/40'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className="w-3.5 h-3.5 rounded-full" style={{ background: t.colors.primary }} />
                          <span className="font-bold text-sm text-text-primary">{t.name}</span>
                        </div>
                        {isSelected && <Badge variant="accent">الافتراضي</Badge>}
                      </div>
                      <p className="text-xs text-text-muted leading-relaxed">{t.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>

          {/* Presentation label only; this does not attest regulatory compliance. */}
          <Card title="تصنيف عرض الفاتورة الضريبية (B2B / B2C)">
            <div className="space-y-3">
              <p className="text-xs text-text-muted leading-relaxed">
                حدد كيفية تسمية وتصنيف الفواتير الصادرة لعملائك:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => setInvoiceSettings({ ...invoiceSettings, invoiceType: 'auto' })}
                  className={`p-3 rounded-xl border text-right transition-all ${
                    invoiceSettings.invoiceType === 'auto'
                      ? 'border-accent bg-accent/5 font-bold text-accent'
                      : 'border-border bg-bg-primary text-text-secondary'
                  }`}
                >
                  <div className="font-bold text-xs mb-1">تحديد تلقائي ذكي (موصى به)</div>
                  <div className="text-[11px] text-text-muted">إذا كان للعميل رقم ضريبي تصبح (فاتورة ضريبية B2B)، وإلا تصبح (فاتورة مبسطة B2C).</div>
                </button>

                <button
                  type="button"
                  onClick={() => setInvoiceSettings({ ...invoiceSettings, invoiceType: 'standard' })}
                  className={`p-3 rounded-xl border text-right transition-all ${
                    invoiceSettings.invoiceType === 'standard'
                      ? 'border-accent bg-accent/5 font-bold text-accent'
                      : 'border-border bg-bg-primary text-text-secondary'
                  }`}
                >
                  <div className="font-bold text-xs mb-1">فاتورة ضريبية (Standard B2B)</div>
                  <div className="text-[11px] text-text-muted">مخصصة للتعاملات مع الشركات والمؤسسات والجهات الحكومية المسجلة ضريبياً.</div>
                </button>

                <button
                  type="button"
                  onClick={() => setInvoiceSettings({ ...invoiceSettings, invoiceType: 'simplified' })}
                  className={`p-3 rounded-xl border text-right transition-all ${
                    invoiceSettings.invoiceType === 'simplified'
                      ? 'border-accent bg-accent/5 font-bold text-accent'
                      : 'border-border bg-bg-primary text-text-secondary'
                  }`}
                >
                  <div className="font-bold text-xs mb-1">فاتورة ضريبية مبسطة (Simplified B2C)</div>
                  <div className="text-[11px] text-text-muted">مخصصة للمستهلكين الأفراد والبيع النقدي المباشر.</div>
                </button>
              </div>
            </div>
          </Card>

          {/* Visibility Controls for Company & Client */}
          <Card title="التحكم في ظهور بيانات المنشأة والعميل على الفاتورة المطبوعة">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 text-xs">
              {/* Company Info Checks */}
              <div className="space-y-2.5">
                <h4 className="font-bold text-sm text-text-primary pb-1 border-b border-border text-slate-800">بيانات منشأتك (البائع)</h4>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input type="checkbox" className="rounded accent-accent w-4 h-4" checked={invoiceSettings.showLogo} onChange={e => setInvoiceSettings({ ...invoiceSettings, showLogo: e.target.checked })} />
                  <span>إظهار شعار المنشأة (Logo)</span>
                </label>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input type="checkbox" className="rounded accent-accent w-4 h-4" checked={invoiceSettings.showCompanyName} onChange={e => setInvoiceSettings({ ...invoiceSettings, showCompanyName: e.target.checked })} />
                  <span>إظهار اسم المنشأة الرسمي</span>
                </label>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input type="checkbox" className="rounded accent-accent w-4 h-4" checked={invoiceSettings.showCompanyTaxNumber} onChange={e => setInvoiceSettings({ ...invoiceSettings, showCompanyTaxNumber: e.target.checked })} />
                  <span>إظهار الرقم الضريبي للمنشأة</span>
                </label>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input type="checkbox" className="rounded accent-accent w-4 h-4" checked={invoiceSettings.showCompanyCR} onChange={e => setInvoiceSettings({ ...invoiceSettings, showCompanyCR: e.target.checked })} />
                  <span>إظهار رقم السجل التجاري</span>
                </label>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input type="checkbox" className="rounded accent-accent w-4 h-4" checked={invoiceSettings.showCompanyAddress} onChange={e => setInvoiceSettings({ ...invoiceSettings, showCompanyAddress: e.target.checked })} />
                  <span>إظهار العنوان الوطني للمنشأة</span>
                </label>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input type="checkbox" className="rounded accent-accent w-4 h-4" checked={invoiceSettings.showCompanyPhone} onChange={e => setInvoiceSettings({ ...invoiceSettings, showCompanyPhone: e.target.checked })} />
                  <span>إظهار رقم الهاتف / الجوال</span>
                </label>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input type="checkbox" className="rounded accent-accent w-4 h-4" checked={invoiceSettings.showCompanyEmail} onChange={e => setInvoiceSettings({ ...invoiceSettings, showCompanyEmail: e.target.checked })} />
                  <span>إظهار البريد الإلكتروني للمنشأة</span>
                </label>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input type="checkbox" className="rounded accent-accent w-4 h-4" checked={invoiceSettings.showCompanyBankDetails} onChange={e => setInvoiceSettings({ ...invoiceSettings, showCompanyBankDetails: e.target.checked })} />
                  <span>إظهار الحساب البنكي ورقم الآيبان (IBAN) في أسفل الفاتورة</span>
                </label>
              </div>

              {/* Client Info Checks */}
              <div className="space-y-2.5">
                <h4 className="font-bold text-sm text-text-primary pb-1 border-b border-border text-slate-800">بيانات العميل (المشتري)</h4>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input type="checkbox" className="rounded accent-accent w-4 h-4" checked={invoiceSettings.showClientName} onChange={e => setInvoiceSettings({ ...invoiceSettings, showClientName: e.target.checked })} />
                  <span>إظهار اسم العميل</span>
                </label>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input type="checkbox" className="rounded accent-accent w-4 h-4" checked={invoiceSettings.showClientTaxNumber} onChange={e => setInvoiceSettings({ ...invoiceSettings, showClientTaxNumber: e.target.checked })} />
                  <span>إظهار الرقم الضريبي للعميل (إن وُجد)</span>
                </label>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input type="checkbox" className="rounded accent-accent w-4 h-4" checked={invoiceSettings.showClientCR} onChange={e => setInvoiceSettings({ ...invoiceSettings, showClientCR: e.target.checked })} />
                  <span>إظهار السجل التجاري للعميل</span>
                </label>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input type="checkbox" className="rounded accent-accent w-4 h-4" checked={invoiceSettings.showClientAddress} onChange={e => setInvoiceSettings({ ...invoiceSettings, showClientAddress: e.target.checked })} />
                  <span>إظهار عنوان العميل</span>
                </label>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input type="checkbox" className="rounded accent-accent w-4 h-4" checked={invoiceSettings.showClientPhone} onChange={e => setInvoiceSettings({ ...invoiceSettings, showClientPhone: e.target.checked })} />
                  <span>إظهار رقم جوال العميل</span>
                </label>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input type="checkbox" className="rounded accent-accent w-4 h-4" checked={invoiceSettings.showClientEmail} onChange={e => setInvoiceSettings({ ...invoiceSettings, showClientEmail: e.target.checked })} />
                  <span>إظهار البريد الإلكتروني للعميل</span>
                </label>
              </div>
            </div>

            {/* Additional Elements */}
            <div className="mt-6 pt-6 border-t border-border grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input type="checkbox" className="rounded accent-accent w-4 h-4" checked={invoiceSettings.showProject} onChange={e => setInvoiceSettings({ ...invoiceSettings, showProject: e.target.checked })} />
                <span>إظهار اسم المشروع المرتبط بالفاتورة</span>
              </label>
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input type="checkbox" className="rounded accent-accent w-4 h-4" checked={invoiceSettings.showDueDate} onChange={e => setInvoiceSettings({ ...invoiceSettings, showDueDate: e.target.checked })} />
                <span>إظهار تاريخ الاستحقاق</span>
              </label>
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input type="checkbox" className="rounded accent-accent w-4 h-4" checked={invoiceSettings.showPaymentStatus} onChange={e => setInvoiceSettings({ ...invoiceSettings, showPaymentStatus: e.target.checked })} />
                <span>إظهار وسم حالة السداد (مدفوعة / غير مدفوعة)</span>
              </label>
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input type="checkbox" className="rounded accent-accent w-4 h-4" checked={invoiceSettings.showQR} onChange={e => setInvoiceSettings({ ...invoiceSettings, showQR: e.target.checked })} />
                <span>{taxQrCaption(countryCode)}</span>
              </label>
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input type="checkbox" className="rounded accent-accent w-4 h-4" checked={invoiceSettings.showSignatureArea} onChange={e => setInvoiceSettings({ ...invoiceSettings, showSignatureArea: e.target.checked })} />
                <span>إظهار مساحة التوقيع والختم المعتمد في أسفل الفاتورة</span>
              </label>
            </div>
          </Card>

          {/* Footer & Notes */}
          <Card title="نصوص التذييل والشروط والأحكام الافتراضية">
            <div className="space-y-4">
              <Textarea
                label="الشروط والأحكام وسياسة الضمان الافتراضية"
                value={invoiceSettings.termsAndConditions}
                onChange={e => setInvoiceSettings({ ...invoiceSettings, termsAndConditions: e.target.value })}
                placeholder="أدخل الشروط والأحكام التي تود ظهورها في أسفل جميع فواتيرك..."
              />
              <Input
                label="نص التذييل الثابت (Footer Note)"
                value={invoiceSettings.footerText}
                onChange={(e) => setInvoiceSettings({ ...invoiceSettings, footerText: e.target.value })}
                placeholder="مثال: شكراً لتعاملكم معنا • للإيداع البنكي: بنك الراجحي SA..."
              />
            </div>
          </Card>

          <div className="pt-2">
            <Button 
              onClick={handleSaveInvoiceSettings} 
              disabled={invoiceSettingsLoading}
              leftIcon={<Save size={16} />}
            >
              {invoiceSettingsLoading ? 'جاري حفظ الإعدادات...' : 'حفظ إعدادات وقوالب الفواتير'}
            </Button>
          </div>
        </div>
      )}

      {/* Accounting */}
      {tab === 'accounting' && (
        <Card title="الإعدادات المحاسبية">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="بداية السنة المالية" type="date" value={fiscalStart} onChange={(e)=>setFiscalStart(e.target.value)} />
            <Input label="عدد المنازل العشرية" type="number" value={decimalPlaces} onChange={(e)=>setDecimalPlaces(e.target.value)} />
            <p className="sm:col-span-2 text-xs text-text-muted -mt-2">
              {countryCode === 'EG'
                ? 'الافتراضي لمصر: أول يوليو حتى آخر يونيو. لا يغيّر السنوات المفتوحة القائمة.'
                : 'الافتراضي للسعودية: أول يناير حتى آخر ديسمبر.'}
            </p>
          </div>
          <label className="flex items-start gap-3 mt-5 cursor-pointer">
            <input
              type="checkbox"
              className="mt-1 w-4 h-4 rounded border-border accent-accent"
              checked={autoAllocateFifo}
              onChange={(e) => setAutoAllocateFifo(e.target.checked)}
            />
            <span className="text-sm">
              <span className="font-semibold block">تخصيص سند القبض تلقائيًا على أقدم الفواتير</span>
              <span className="text-text-muted text-xs leading-relaxed block mt-0.5">
                إن أنشأت سند قبض لعميل دون اختيار فواتير، يُسدَّد الأقدم فالأقدم. رصيد العميل في الدفاتر لا يتغير — تتغير حالة الفواتير فقط. الزيادة تبقى مقدمًا غير مخصص. إن اخترت فواتير في السند يُحترم اختيارك.
              </span>
            </span>
          </label>
          <div className="mt-4">
            <Button onClick={handleSaveAccounting} leftIcon={<Save size={16} />}>حفظ</Button>
          </div>
        </Card>
      )}

      {/* Tax */}
      {tab === 'tax' && (
        <Card title="إعدادات الضرائب">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="نسبة ضريبة القيمة المضافة (%)" type="number" value={vatRate} onChange={(e)=>setVatRate(e.target.value)} />
          </div>
          <div className="mt-4">
            <Button onClick={handleSaveTax} leftIcon={<Save size={16} />}>حفظ</Button>
          </div>
        </Card>
      )}

      {/* Subscription — بطاقة موحدة: رقم المشترك + ملخص الاشتراك + أزرار الإدارة.
          التفاصيل الكاملة والترقية في صفحة /subscription حتى لا تتكرر نفس
          المعلومات في قسمين */}
      {tab === 'subscription' && (
        <div className="space-y-4 max-w-2xl">
          {subLoading ? (
            <Card><div className="text-center py-8 text-text-muted">جاري التحميل...</div></Card>
          ) : subscription ? (
            <>
              <div className="bg-bg-primary border border-border rounded-2xl overflow-hidden">
                {/* رقم المشترك — العنصر الأبرز في البطاقة */}
                <div className="bg-gradient-to-br from-accent/10 to-transparent p-6 border-b border-border">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-text-muted mb-1">رقم المشترك</p>
                      <div className="flex items-center gap-3">
                        <p className="text-3xl font-bold text-accent font-mono" dir="ltr">
                          {subscription.subscriber_number ? `#${subscription.subscriber_number}` : '—'}
                        </p>
                        {subscription.subscriber_number && (
                          <button
                            onClick={copySubscriberNumber}
                            title="نسخ رقم المشترك"
                            className="p-2 rounded-lg text-text-muted hover:text-accent hover:bg-accent/10 transition-colors"
                          >
                            {copiedSubNumber ? <Check size={16} className="text-success" /> : <Copy size={16} />}
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="w-14 h-14 rounded-2xl bg-accent/20 flex items-center justify-center">
                      <CreditCard size={28} className="text-accent" />
                    </div>
                  </div>
                  <p className="text-xs text-text-muted mt-3">
                    رقم فريد دائم لا يمكن تخمينه ولا يتغير — أرسله مع إيصال الدفع على تليجرام واستخدمه عند التواصل مع الدعم
                  </p>
                </div>

                {/* ملخص الاشتراك — صفوف مختصرة فقط، والتفاصيل الكاملة في صفحة الباقات */}
                <div className="divide-y divide-border">
                  <div className="flex items-center justify-between px-6 py-3">
                    <div className="flex items-center gap-3">
                      <Building2 size={18} className="text-text-muted" />
                      <span className="text-sm text-text-muted">الباقة</span>
                    </div>
                    <span className="font-bold text-accent">{subscription.plan_name || 'تجريبي'}</span>
                  </div>
                  <div className="flex items-center justify-between px-6 py-3">
                    <div className="flex items-center gap-3">
                      <Check size={18} className="text-text-muted" />
                      <span className="text-sm text-text-muted">الحالة</span>
                    </div>
                    <span className={`font-bold ${subscription.is_expired ? 'text-danger' : 'text-success'}`}>
                      {subscription.is_expired ? 'منتهي' : 'نشط'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between px-6 py-3">
                    <div className="flex items-center gap-3">
                      <Calendar size={18} className="text-text-muted" />
                      <span className="text-sm text-text-muted">تاريخ الانتهاء</span>
                    </div>
                    <span className="font-medium text-text-primary" dir="ltr">{subscription.end_date || '—'}</span>
                  </div>
                  <div className="flex items-center justify-between px-6 py-3">
                    <div className="flex items-center gap-3">
                      <AlertCircle size={18} className="text-text-muted" />
                      <span className="text-sm text-text-muted">الأيام المتبقية</span>
                    </div>
                    <span className={`font-bold ${subscription.days_remaining <= 7 ? 'text-warning' : 'text-success'}`}>
                      {subscription.days_remaining} يوم
                    </span>
                  </div>
                </div>
              </div>

              {subscription.is_expiring_soon && !subscription.is_expired && (
                <div className="flex items-center gap-2 p-4 rounded-xl bg-warning/10 border border-warning/30 text-warning text-sm">
                  <AlertCircle size={18} />
                  اشتراكك ينتهي قريباً — يرجى التجديد
                </div>
              )}
              <div className="flex flex-wrap gap-3">
                <Button onClick={() => window.location.href = '/subscription'} leftIcon={<CreditCard size={16} />}>
                  إدارة الاشتراك — ترقية / تجديد
                </Button>
                <a href="/export-data" className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-bg-secondary border border-border text-text-secondary hover:text-amber-400 text-sm transition-colors">
                  <Download size={16} /> تصدير تقارير بياناتي (Excel / CSV)
                </a>
              </div>
            </>
          ) : (
            <Card><div className="text-center py-8 text-text-muted">لا يوجد اشتراك. <a href="/subscription" className="text-accent">اشترك الآن</a></div></Card>
          )}
        </div>
      )}

      {/* About */}
      {tab === 'about' && (
        <div className="space-y-6 max-w-2xl">
          {/* App Identity Card */}
          <div className="bg-gradient-to-br from-accent/10 to-transparent border border-accent/20 rounded-2xl p-6">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-accent flex items-center justify-center shrink-0">
                <Building2 size={32} className="text-white" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-text-primary">{appSettings.app_name || 'برو أكاونت'}</h3>
                <p className="text-sm text-text-muted">{appSettings.app_name_en || 'ProAccount'} — الإصدار {appSettings.app_version || '1.0'}</p>
                <p className="text-xs text-text-muted mt-1">مطور بواسطة {appSettings.developer_name || 'ContaShepo'}</p>
              </div>
            </div>
          </div>

          {/* Account Info */}
          <div className="bg-bg-primary border border-border rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border">
              <h4 className="font-bold text-text-primary">بيانات حسابك</h4>
            </div>
            <div className="divide-y divide-border">
              <div className="flex items-center gap-3 px-6 py-3">
                <Mail size={18} className="text-text-muted shrink-0" />
                <span className="text-sm text-text-muted w-24">البريد</span>
                <span className="text-sm font-medium text-text-primary" dir="ltr">{user?.email || '—'}</span>
              </div>
              <div className="flex items-center gap-3 px-6 py-3">
                <Info size={18} className="text-text-muted shrink-0" />
                <span className="text-sm text-text-muted w-24">الاسم</span>
                <span className="text-sm font-medium text-text-primary">{user?.name || '—'}</span>
              </div>
              <div className="flex items-center gap-3 px-6 py-3">
                <Building2 size={18} className="text-text-muted shrink-0" />
                <span className="text-sm text-text-muted w-24">الشركة</span>
                <span className="text-sm font-medium text-text-primary">{company?.name || '—'}</span>
              </div>
            </div>
          </div>

          {/* Contact & Support */}
          <div className="bg-bg-primary border border-border rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border">
              <h4 className="font-bold text-text-primary">التواصل والدعم</h4>
            </div>
            <div className="divide-y divide-border">
              {appSettings.support_email && (
                <div className="flex items-center gap-3 px-6 py-3">
                  <Mail size={18} className="text-accent shrink-0" />
                  <span className="text-sm text-text-muted w-24">البريد</span>
                  <a href={`mailto:${appSettings.support_email}`} className="text-sm text-accent hover:underline" dir="ltr">{appSettings.support_email}</a>
                </div>
              )}
              {appSettings.support_phone && (
                <div className="flex items-center gap-3 px-6 py-3">
                  <Phone size={18} className="text-accent shrink-0" />
                  <span className="text-sm text-text-muted w-24">الهاتف</span>
                  <a href={`tel:${appSettings.support_phone}`} className="text-sm text-accent hover:underline" dir="ltr">{appSettings.support_phone}</a>
                </div>
              )}
              {appSettings.support_whatsapp && (
                <div className="flex items-center gap-3 px-6 py-3">
                  <MessageSquare size={18} className="text-accent shrink-0" />
                  <span className="text-sm text-text-muted w-24">واتساب</span>
                  <a href={`https://wa.me/${appSettings.support_whatsapp.replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener noreferrer" className="text-sm text-accent hover:underline" dir="ltr">{appSettings.support_whatsapp}</a>
                </div>
              )}
              {appSettings.support_telegram && (
                <div className="flex items-center gap-3 px-6 py-3">
                  <Send size={18} className="text-accent shrink-0" />
                  <span className="text-sm text-text-muted w-24">تيليجرام</span>
                  <a href={`https://t.me/${appSettings.support_telegram}`} target="_blank" rel="noopener noreferrer" className="text-sm text-accent hover:underline" dir="ltr">@{appSettings.support_telegram}</a>
                </div>
              )}
              {appSettings.support_website && (
                <div className="flex items-center gap-3 px-6 py-3">
                  <Globe size={18} className="text-accent shrink-0" />
                  <span className="text-sm text-text-muted w-24">الموقع</span>
                  <a href={appSettings.support_website} target="_blank" rel="noopener noreferrer" className="text-sm text-accent hover:underline" dir="ltr">{appSettings.support_website}</a>
                </div>
              )}
            </div>
          </div>

          {/* Payment Info */}
          {appSettings.payment_info && (
            <div className="bg-bg-primary border border-border rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-border">
                <h4 className="font-bold text-text-primary">معلومات الدفع</h4>
              </div>
              <div className="px-6 py-4 space-y-2">
                <p className="text-sm text-text-secondary">{appSettings.payment_info}</p>
                {appSettings.payment_bank_name && (
                  <div className="flex items-center gap-3 py-2">
                    <CreditCard size={18} className="text-text-muted shrink-0" />
                    <span className="text-sm text-text-muted">البنك:</span>
                    <span className="text-sm font-medium text-text-primary">{appSettings.payment_bank_name}</span>
                  </div>
                )}
                {appSettings.payment_iban && (
                  <div className="flex items-center gap-3 py-2">
                    <CreditCard size={18} className="text-text-muted shrink-0" />
                    <span className="text-sm text-text-muted">IBAN:</span>
                    <span className="text-sm font-mono text-text-primary" dir="ltr">{appSettings.payment_iban}</span>
                  </div>
                )}
                {appSettings.payment_stc_pay && (
                  <div className="flex items-center gap-3 py-2">
                    <CreditCard size={18} className="text-text-muted shrink-0" />
                    <span className="text-sm text-text-muted">STC Pay:</span>
                    <span className="text-sm font-mono text-text-primary" dir="ltr">{appSettings.payment_stc_pay}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="text-center py-4">
            <p className="text-xs text-text-muted">
              {appSettings.footer_text || '© 2026 برو أكاونت - جميع الحقوق محفوظة'}
            </p>
            <p className="text-xs text-text-muted mt-1">
              عند التواصل مع الدعم، يرجى إرسال رقم اشتراكك
            </p>
          </div>
        </div>
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
        <Card title="إشعارات النظام">
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
            <Button onClick={handleSaveNotifications} leftIcon={<Save size={16} />}>حفظ الإشعار</Button>
          </div>
        </Card>
      )}

      {/* Project Costing & Overhead Tab */}
      {tab === 'projectcosting' && <OverheadSettings />}

      {/* Telegram Tab */}
      {tab === 'telegram' && (
        <div className="space-y-6">
          {!telegramAllowed ? (
            <Card>
              <div className="text-center py-10 px-4">
                <div className="w-16 h-16 rounded-full bg-warning/10 flex items-center justify-center mx-auto mb-4">
                  <Bot size={32} className="text-warning" />
                </div>
                <h3 className="text-lg font-bold text-text-primary mb-2">ميزة حصرية بالباقة الاحترافية 🚀</h3>
                <p className="text-sm text-text-muted max-w-md mx-auto mb-6 leading-relaxed">
                  ميزة ربط تليجرام التفاعلية والموافقات المباشرة عبر الجوال متوفرة للمشتركين في الباقة الاحترافية أو باقة المؤسسات فقط.
                </p>
                <Button onClick={() => setTab('subscription')} leftIcon={<CreditCard size={16} />}>
                  ترقية اشتراكي الآن
                </Button>
              </div>
            </Card>
          ) : (
            <>
              {/* Detailed Step-by-Step Customer Interactive Guide Card */}
              <Card title="دليل تفعيل البوت المحاسبي التفاعلي للعملاء 📖">
                <div className="space-y-4">
                  <p className="text-sm text-text-secondary leading-relaxed">
                    برجاء اتباع الخطوات الـ 3 البسيطة التالية بدقة لربط حسابك وتفعيل الإشعارات والموافقات الفورية على جوالك:
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-4 rounded-xl bg-bg-secondary border border-border space-y-2 flex flex-col justify-between">
                      <div>
                        <div className="w-8 h-8 rounded-lg bg-accent text-white flex items-center justify-center font-bold text-sm mb-2">1</div>
                        <h4 className="text-sm font-bold text-text-primary">البحث عن البوت الرسمي</h4>
                        <p className="text-xs text-text-muted leading-relaxed">
                          افتح تطبيق تلغرام وابحث عن البوت الرسمي للمنصة:
                          <span className="block mt-1 font-mono text-accent font-bold">@{TELEGRAM_BOT_USERNAME}</span>
                        </p>
                      </div>
                      <a 
                        href={`https://t.me/${TELEGRAM_BOT_USERNAME}`} 
                        target="_blank" 
                        rel="noreferrer" 
                        className="mt-3 text-xs text-accent font-bold hover:underline inline-flex items-center gap-1"
                      >
                        فتح البوت في تليجرام <ExternalLink size={12} />
                      </a>
                    </div>

                    <div className="p-4 rounded-xl bg-bg-secondary border border-border space-y-2">
                      <div className="w-8 h-8 rounded-lg bg-accent text-white flex items-center justify-center font-bold text-sm mb-2">2</div>
                      <h4 className="text-sm font-bold text-text-primary">الحصول على المعرف الرقمي</h4>
                      <p className="text-xs text-text-muted leading-relaxed">
                        اضغط على زر <b>ابدأ (Start)</b> أو أرسل أمر <code className="font-mono text-accent">/start</code> داخل المحادثة.
                        <br />
                        سيقوم البوت بالترحيب بك وإرسال <b>معرّف الدردشة الرقمي الفريد</b> الخاص بك فوراً على الشاشة.
                      </p>
                    </div>

                    <div className="p-4 rounded-xl bg-bg-secondary border border-border space-y-2">
                      <div className="w-8 h-8 rounded-lg bg-accent text-white flex items-center justify-center font-bold text-sm mb-2">3</div>
                      <h4 className="text-sm font-bold text-text-primary">ربط المعرّف في الموقع</h4>
                      <p className="text-xs text-text-muted leading-relaxed">
                        قم بنسخ المعرّف الرقمي المكون من أرقام فقط (مثال: <code className="font-mono text-accent">876543210</code>) وضعه في خانة <b>Chat ID</b> بالبطاقة أدناه، ثم علم على خيار &quot;تفعيل&quot; واضغط على حفظ الإعدادات!
                      </p>
                    </div>
                  </div>
                </div>
              </Card>

              <Card title="بيانات الربط والتحكم بالتنبيهات">
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Input 
                      label="معرف الدردشة تيليجرام (Chat ID)" 
                      placeholder="أدخل الأرقام هنا (مثال: 987654321)" 
                      value={telegramConfig.chat_id} 
                      onChange={(e) => setTelegramConfig({...telegramConfig, chat_id: e.target.value})} 
                    />
                    <div className="flex flex-col justify-end pb-1">
                      <label className="flex items-center gap-3 cursor-pointer py-3">
                        <input 
                          type="checkbox" 
                          className="w-4 h-4 rounded border-border accent-accent" 
                          checked={telegramConfig.is_enabled} 
                          onChange={(e) => setTelegramConfig({...telegramConfig, is_enabled: e.target.checked})} 
                        />
                        <span className="text-sm font-semibold">تفعيل البوت والربط المباشر</span>
                      </label>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-border space-y-3">
                    <h4 className="text-sm font-bold text-text-secondary">تخصيص الإشعارات المباشرة (تنبيهات لحظية)</h4>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input 
                        type="checkbox" 
                        className="w-4 h-4 rounded border-border accent-accent" 
                        checked={telegramConfig.notify_invoices} 
                        onChange={(e) => setTelegramConfig({...telegramConfig, notify_invoices: e.target.checked})} 
                      />
                      <span className="text-sm">إرسال تفاصيل الفواتير والتحصيلات فور إصدارها</span>
                    </label>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input 
                        type="checkbox" 
                        className="w-4 h-4 rounded border-border accent-accent" 
                        checked={telegramConfig.notify_cash_transactions} 
                        onChange={(e) => setTelegramConfig({...telegramConfig, notify_cash_transactions: e.target.checked})} 
                      />
                      <span className="text-sm">إشعار فوري بحركات النقدية الكبيرة وسندات الصرف والعهود المالية</span>
                    </label>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input 
                        type="checkbox" 
                        className="w-4 h-4 rounded border-border accent-accent" 
                        checked={telegramConfig.notify_user_logins} 
                        onChange={(e) => setTelegramConfig({...telegramConfig, notify_user_logins: e.target.checked})} 
                      />
                      <span className="text-sm">تنبيهات أمنية فائرة عند تسجيل دخول الموظفين للرقابة التامة</span>
                    </label>
                  </div>

                  <div className="pt-4 border-t border-border space-y-3">
                    <h4 className="text-sm font-bold text-text-secondary">نظام الموافقات والاعتمادات المالية عبر الجوال (Telegram Approvals)</h4>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input 
                        type="checkbox" 
                        className="w-4 h-4 rounded border-border accent-accent" 
                        checked={telegramConfig.approvals_enabled} 
                        onChange={(e) => setTelegramConfig({...telegramConfig, approvals_enabled: e.target.checked})} 
                      />
                      <span className="text-sm font-semibold text-accent">تمكين اعتماد الأوامر والقيود اليومية عبر تيليجرام</span>
                    </label>
                    
                    {telegramConfig.approvals_enabled && (
                      <div className="pl-4 pr-4 py-3 rounded-lg bg-bg-secondary border border-border max-w-md">
                        <Input 
                          label={`فرض الموافقات فقط للمبالغ التي تتجاوز (${currencySymbol}):`} 
                          type="number" 
                          placeholder="5000" 
                          value={telegramConfig.approval_threshold} 
                          onChange={(e) => setTelegramConfig({...telegramConfig, approval_threshold: e.target.value})} 
                        />
                        <p className="text-[10px] text-text-muted mt-1 leading-relaxed">
                          أي مستند (سند صرف، عهدة، قيد مالي) يتخطى هذا المبلغ، سيتطلب نقرة موافقة تفاعلية من هاتف المدير قبل ترحيله للدفاتر المحاسبية.
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 pt-4 border-t border-border">
                    <Button 
                      onClick={handleSaveTelegram} 
                      disabled={telegramLoading} 
                      leftIcon={<Save size={16} />}
                    >
                      {telegramLoading ? 'جاري الحفظ...' : 'حفظ إعدادات تيليجرام'}
                    </Button>
                  </div>
                </div>
              </Card>

              {/* Real-time Interactive Test Connection Card */}
              <Card title="فحص الاتصال والربط التفاعلي اللحظي 🧪">
                <div className="space-y-4">
                  <p className="text-xs text-text-muted leading-relaxed">
                    اضغط على زر الفحص أدناه. سيقوم الموقع بإرسال رسالة تفاعلية ذكية فوراً إلى هاتفك تحتوي على خيار القبول والرفض. 
                    اضغط عليها وسينعكس اختيارك وتحديثه أمامك على شاشة الموقع فورياً لتتأكد من نجاح الربط بنسبة 100%.
                  </p>

                  <div className="flex flex-col sm:flex-row items-center gap-4">
                    <Button 
                      onClick={handleStartTest} 
                      disabled={testLoading || testStatus === 'pending'} 
                      leftIcon={<Send size={16} />} 
                      className="btn-secondary"
                    >
                      {testLoading ? 'جاري التحميل...' : 'إطلاق الفحص التفاعلي اللحظي 🚀'}
                    </Button>

                    {testStatus === 'pending' && (
                      <div className="flex items-center gap-2 text-sm text-accent font-semibold animate-pulse">
                        <RefreshCw size={16} className="animate-spin" />
                        <span>انتظار النقر على جوالك في تيليجرام... (60 ثانية)</span>
                      </div>
                    )}

                    {testStatus === 'accepted' && (
                      <div className="p-2.5 rounded-lg bg-success/10 border border-success/30 text-success text-xs font-bold">
                        تم تأكيد فحص الربط التفاعلي بنجاح! الحالة: مقبول وموافق عليه من هاتف المدير ✅
                      </div>
                    )}

                    {testStatus === 'rejected' && (
                      <div className="p-2.5 rounded-lg bg-danger/10 border border-danger/30 text-danger text-xs font-bold">
                        تم تأكيد فحص الربط التفاعلي بنجاح! الحالة: تم الرفض والمرفوض من هاتف المدير ❌
                      </div>
                    )}

                    {testStatus === 'expired' && (
                      <div className="p-2.5 rounded-lg bg-warning/10 border border-warning/30 text-warning text-xs font-bold">
                        انتهت مهلة الفحص المتاحة (60 ثانية) دون الضغط على الزر. يرجى المحاولة مجدداً.
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            </>
          )}
        </div>
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
