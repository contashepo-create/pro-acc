'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { 
  ArrowRight, Printer, Settings, ShieldCheck, Eye, EyeOff, 
  MapPin, Phone, Mail, Layers, Save 
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { QRCode } from '@/components/ui/QRCode';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { toast } from '@/components/ui/Toast';
import { formatDate, formatCurrency } from '@/lib/utils';
import { 
  INVOICE_TEMPLATES, 
  getTemplateConfig, 
  DEFAULT_INVOICE_SETTINGS, 
  resolveInvoiceTitle,
  type InvoiceTemplateSettings,
} from '@/lib/invoice-templates';

// ==========================================
// Standalone Top-Level Subcomponents (ESLint Safe)
// ==========================================
function CompanyBlock({ company, settings }: { company: any; settings: InvoiceTemplateSettings }) {
  return (
    <div className="space-y-1 text-right text-xs">
      {settings.showCompanyName && (
        <h2 className="text-base font-black text-slate-900 leading-snug">{company?.name || 'اسم المنشأة'}</h2>
      )}
      {settings.showCompanyTaxNumber && company?.tax_number && (
        <div className="flex items-center gap-1.5 text-slate-600">
          <span className="font-semibold text-slate-500">الرقم الضريبي:</span>
          <span className="font-mono font-bold text-slate-800" dir="ltr">{company.tax_number}</span>
        </div>
      )}
      {settings.showCompanyCR && company?.commercial_registration && (
        <div className="flex items-center gap-1.5 text-slate-600">
          <span className="font-semibold text-slate-500">السجل التجاري:</span>
          <span className="font-mono text-slate-700" dir="ltr">{company.commercial_registration}</span>
        </div>
      )}
      {settings.showCompanyAddress && company?.address && (
        <div className="flex items-start gap-1.5 text-slate-600">
          <MapPin size={13} className="text-slate-400 mt-0.5 shrink-0" />
          <span>{company.address}</span>
        </div>
      )}
      {settings.showCompanyPhone && company?.phone && (
        <div className="flex items-center gap-1.5 text-slate-600">
          <Phone size={13} className="text-slate-400 shrink-0" />
          <span className="font-semibold text-slate-500">الهاتف:</span>
          <span className="font-mono font-medium text-slate-800" dir="ltr">{company.phone}</span>
        </div>
      )}
      {settings.showCompanyEmail && company?.email && (
        <div className="flex items-center gap-1.5 text-slate-600">
          <Mail size={13} className="text-slate-400 shrink-0" />
          <span dir="ltr" className="font-mono text-slate-700">{company.email}</span>
        </div>
      )}
    </div>
  );
}

function ClientBlock({ invoice, settings }: { invoice: any; settings: InvoiceTemplateSettings }) {
  return (
    <div className="space-y-1 text-right text-xs">
      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
        بيانات العميل (المشتري) / Buyer
      </div>
      {settings.showClientName && (
        <p className="text-sm font-bold text-slate-900">{invoice.client_name || 'عميل نقدي'}</p>
      )}
      {settings.showClientTaxNumber && invoice.client_tax_number && (
        <div className="flex items-center gap-1.5 text-slate-600">
          <span className="font-semibold text-slate-500">الرقم الضريبي:</span>
          <span className="font-mono font-bold text-slate-800" dir="ltr">{invoice.client_tax_number}</span>
        </div>
      )}
      {settings.showClientCR && invoice.client_commercial_registration && (
        <div className="flex items-center gap-1.5 text-slate-600">
          <span className="font-semibold text-slate-500">السجل التجاري:</span>
          <span className="font-mono text-slate-700" dir="ltr">{invoice.client_commercial_registration}</span>
        </div>
      )}
      {settings.showClientAddress && invoice.client_address && (
        <div className="flex items-start gap-1.5 text-slate-600">
          <MapPin size={13} className="text-slate-400 mt-0.5 shrink-0" />
          <span>{invoice.client_address}</span>
        </div>
      )}
      {settings.showClientPhone && invoice.client_phone && (
        <div className="flex items-center gap-1.5 text-slate-600">
          <Phone size={13} className="text-slate-400 shrink-0" />
          <span className="font-semibold text-slate-500">الجوال:</span>
          <span className="font-mono font-medium text-slate-800" dir="ltr">{invoice.client_phone}</span>
        </div>
      )}
      {settings.showClientEmail && invoice.client_email && (
        <div className="flex items-center gap-1.5 text-slate-600">
          <Mail size={13} className="text-slate-400 shrink-0" />
          <span dir="ltr" className="font-mono text-slate-700">{invoice.client_email}</span>
        </div>
      )}
      {settings.showProject && invoice.project_name && (
        <div className="mt-1.5 pt-1.5 border-t border-slate-100 flex items-center gap-1.5 text-slate-700 font-medium">
          <Layers size={13} className="text-accent" />
          <span>المشروع:</span>
          <span className="font-bold text-slate-900">{invoice.project_name}</span>
        </div>
      )}
    </div>
  );
}

function LogoBlock({ company, settings, primaryColor, className = "w-14 h-14" }: { company: any; settings: InvoiceTemplateSettings; primaryColor: string; className?: string }) {
  if (!settings.showLogo) return null;
  return company?.logo_url ? (
    <img src={company.logo_url} alt={company.name} className={`${className} rounded-xl object-contain border border-slate-100 shadow-sm bg-white p-1`} />
  ) : (
    <div 
      className={`${className} rounded-xl flex items-center justify-center text-white text-2xl font-black shadow-sm`}
      style={{ background: primaryColor }}
    >
      {(company?.name || 'ب')[0]}
    </div>
  );
}

function TitleBlock({ invoice, settings, titleInfo, primaryColor, status, align = 'left' }: { invoice: any; settings: InvoiceTemplateSettings; titleInfo: any; primaryColor: string; status: any; align?: 'left' | 'right' | 'center' }) {
  return (
    <div className={`text-${align}`}>
      <h1 className="text-xl font-black tracking-tight" style={{ color: primaryColor }}>
        {titleInfo.titleAr}
      </h1>
      <p className="text-xs font-semibold text-slate-400">{titleInfo.titleEn}</p>
      <div className="inline-block mt-2 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-800 font-mono font-bold text-sm">
        #{invoice.number}
      </div>
      <div className="mt-2 text-xs text-slate-500 space-y-0.5">
        <p><span className="text-slate-400">تاريخ الإصدار:</span> <span className="font-medium text-slate-800">{formatDate(invoice.date)}</span></p>
        {settings.showDueDate && invoice.due_date && (
          <p><span className="text-slate-400">تاريخ الاستحقاق:</span> <span className="font-medium text-slate-800">{formatDate(invoice.due_date)}</span></p>
        )}
        {settings.showPaymentStatus && (
          <div className="pt-1">
            <Badge variant={status.variant}>{status.label}</Badge>
          </div>
        )}
      </div>
    </div>
  );
}

// ==========================================
// Main Invoice View Page
// ==========================================
export default function InvoiceViewPage() {
  const params = useParams();
  const router = useRouter();
  const [invoice, setInvoice] = useState<any>(null);
  const [company, setCompany] = useState<any>(null);
  const [zatcaData, setZatcaData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const [template, setTemplate] = useState('modern');
  const [settings, setSettings] = useState<InvoiceTemplateSettings>(DEFAULT_INVOICE_SETTINGS);
  const [companyDefaultTemplate, setCompanyDefaultTemplate] = useState('modern');
  const [savingSettings, setSavingSettings] = useState(false);
  const [showInternalJournal, setShowInternalJournal] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [invRes, zatcaRes] = await Promise.all([
          fetch(`/api/invoices/${params.id}`),
          fetch(`/api/invoices/${params.id}/zatca`),
        ]);
        const [invJson, zatcaJson] = await Promise.all([invRes.json(), zatcaRes.json()]);
        if (invJson.success) { 
          setInvoice(invJson.data); 
          setCompany(invJson.data?.company || {}); 
        } else {
          setError(invJson.message || 'فشل تحميل الفاتورة');
        }
        if (zatcaJson.success) setZatcaData(zatcaJson.data);

        // Load invoice template settings from DB
        try {
          const setRes = await fetch('/api/settings');
          const setJson = await setRes.json();
          if (setJson.success && setJson.data?.invoice_template_settings) {
            const saved = typeof setJson.data.invoice_template_settings === 'string'
              ? JSON.parse(setJson.data.invoice_template_settings)
              : setJson.data.invoice_template_settings;
            const merged = { ...DEFAULT_INVOICE_SETTINGS, ...saved };
            setSettings(merged);
            const def = merged.defaultTemplate || 'modern';
            setCompanyDefaultTemplate(def);
            setTemplate(def);
          }
        } catch (e) {
          console.warn('Failed to fetch invoice settings:', e);
        }
      } catch { 
        setError('خطأ في الاتصال بالخادم'); 
      } finally { 
        setLoading(false); 
      }
    };
    fetchData();
  }, [params.id]);

  const handlePrint = () => window.print();

  // Save current view preferences permanently to company settings
  const handleSaveAsDefaultSettings = async () => {
    try {
      setSavingSettings(true);
      const toSave = { ...settings, defaultTemplate: template };
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: {
            invoice_template_settings: toSave,
          },
        }),
      });
      const json = await res.json();
      if (json.success) {
        setCompanyDefaultTemplate(template);
        setSettings((s) => ({ ...s, defaultTemplate: template }));
        toast.success('تم اعتماد هذا القالب كافتراضي للشركة');
      } else {
        toast.error(json.message || 'فشل حفظ الإعدادات');
      }
    } catch {
      toast.error('حدث خطأ أثناء حفظ الإعدادات');
    } finally {
      setSavingSettings(false);
    }
  };

  if (loading) return <div className="p-12 text-center text-text-secondary">جاري تحميل الفاتورة...</div>;
  if (error) return <div className="p-6"><div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div></div>;
  if (!invoice) return null;

  const vatRate = parseFloat(invoice.tax_rate || invoice.vat_rate || 0);
  const vatAmount = parseFloat(invoice.tax_amount || invoice.vat_amount || 0);
  const subtotal = parseFloat(invoice.subtotal || 0);
  const total = parseFloat(invoice.total || 0);
  const paidAmount = parseFloat(invoice.paid_amount || 0);
  const remaining = Math.max(0, total - paidAmount);
  const currencySymbol = company?.currency_symbol || 'ر.س';
  const locale = company?.locale || 'ar-SA';
  
  const currentTemplate = getTemplateConfig(template);
  const titleInfo = resolveInvoiceTitle(invoice, settings.invoiceType);

  const statusMap: Record<string, { label: string; variant: 'warning' | 'info' | 'success' | 'danger' }> = {
    unpaid: { label: 'غير مدفوعة', variant: 'warning' },
    partial: { label: 'مدفوعة جزئياً', variant: 'info' },
    paid: { label: 'مدفوعة بالكامل', variant: 'success' },
    cancelled: { label: 'ملغاة', variant: 'danger' },
  };
  const status = statusMap[invoice.status] || { label: invoice.status, variant: 'warning' };

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-bg-secondary pb-12">
      {/* Top Toolbar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-bg-primary no-print flex-wrap gap-3 sticky top-0 z-30 shadow-sm">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.back()}>
            <ArrowRight size={20} />
          </Button>
          <div>
            <h1 className="text-sm font-bold text-text-primary flex items-center gap-2">
              <span>فاتورة رقم #{invoice.number}</span>
              <Badge variant={titleInfo.isSimplified ? 'info' : 'accent'}>{titleInfo.titleAr}</Badge>
            </h1>
            <p className="text-[11px] text-text-muted">{titleInfo.reason}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Template Selector Bar */}
          <div className="flex items-center gap-1 bg-bg-secondary rounded-xl p-1 border border-border">
            {INVOICE_TEMPLATES.map((t) => (
              <button
                key={t.id}
                onClick={() => setTemplate(t.id)}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                  template === t.id
                    ? 'bg-accent text-white shadow-sm'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
                title={t.description}
              >
                {t.name}
              </button>
            ))}
          </div>

          {/* Quick Invoice Type Switcher */}
          <div className="flex items-center bg-bg-secondary rounded-xl p-1 border border-border">
            <button
              onClick={() => setSettings({ ...settings, invoiceType: 'auto' })}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${
                settings.invoiceType === 'auto' ? 'bg-bg-primary shadow text-accent' : 'text-text-secondary'
              }`}
              title="تحديد النوع تلقائياً حسب توفر بيانات العميل الضريبية"
            >
              تلقائي
            </button>
            <button
              onClick={() => setSettings({ ...settings, invoiceType: 'standard' })}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${
                settings.invoiceType === 'standard' ? 'bg-bg-primary shadow text-accent' : 'text-text-secondary'
              }`}
              title="فاتورة ضريبية قياسية (B2B للمنشآت)"
            >
              ضريبية (B2B)
            </button>
            <button
              onClick={() => setSettings({ ...settings, invoiceType: 'simplified' })}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${
                settings.invoiceType === 'simplified' ? 'bg-bg-primary shadow text-accent' : 'text-text-secondary'
              }`}
              title="فاتورة ضريبية مبسطة (B2C للأفراد)"
            >
              مبسطة (B2C)
            </button>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push('/settings?tab=invoices')}
            leftIcon={<Settings size={15} />}
          >
            إعدادات الطباعة
          </Button>

          {template !== companyDefaultTemplate && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleSaveAsDefaultSettings}
              disabled={savingSettings}
              leftIcon={<Save size={14} />}
            >
              {savingSettings ? 'جاري الحفظ...' : 'اعتماد هذا القالب كافتراضي'}
            </Button>
          )}

          <Button variant="secondary" size="sm" onClick={handlePrint} leftIcon={<Printer size={16} />}>
            طباعة الفاتورة
          </Button>
        </div>
      </div>

      {/* Interactive Customization Settings Drawer */}
      {showSettings && (
        <div className="max-w-4xl mx-auto mt-4 p-5 bg-bg-primary border border-border rounded-2xl shadow-sm no-print space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <Settings size={18} className="text-accent" />
              <h3 className="font-bold text-text-primary text-sm">تخصيص الحقول والعناصر الظاهرة على الفاتورة</h3>
            </div>
            <Button 
              size="sm" 
              onClick={handleSaveAsDefaultSettings} 
              disabled={savingSettings}
              leftIcon={<Save size={14} />}
            >
              {savingSettings ? 'جاري الحفظ...' : 'حفظ كإعدادات دائمة للفواتير القادمة'}
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-xs">
            {/* Company Visibility */}
            <div className="space-y-2">
              <h4 className="font-bold text-text-primary pb-1 border-b border-border text-slate-800">بيانات المنشأة (البائع)</h4>
              <label className="flex items-center gap-2 cursor-pointer text-text-secondary hover:text-text-primary">
                <input type="checkbox" className="rounded accent-accent" checked={settings.showLogo} onChange={e => setSettings({ ...settings, showLogo: e.target.checked })} />
                <span>الشعار (Logo)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-text-secondary hover:text-text-primary">
                <input type="checkbox" className="rounded accent-accent" checked={settings.showCompanyName} onChange={e => setSettings({ ...settings, showCompanyName: e.target.checked })} />
                <span>اسم المنشأة</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-text-secondary hover:text-text-primary">
                <input type="checkbox" className="rounded accent-accent" checked={settings.showCompanyTaxNumber} onChange={e => setSettings({ ...settings, showCompanyTaxNumber: e.target.checked })} />
                <span>الرقم الضريبي للمنشأة</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-text-secondary hover:text-text-primary">
                <input type="checkbox" className="rounded accent-accent" checked={settings.showCompanyCR} onChange={e => setSettings({ ...settings, showCompanyCR: e.target.checked })} />
                <span>السجل التجاري</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-text-secondary hover:text-text-primary">
                <input type="checkbox" className="rounded accent-accent" checked={settings.showCompanyAddress} onChange={e => setSettings({ ...settings, showCompanyAddress: e.target.checked })} />
                <span>العنوان الوطني للمنشأة</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-text-secondary hover:text-text-primary">
                <input type="checkbox" className="rounded accent-accent" checked={settings.showCompanyPhone} onChange={e => setSettings({ ...settings, showCompanyPhone: e.target.checked })} />
                <span>رقم هاتف المنشأة</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-text-secondary hover:text-text-primary">
                <input type="checkbox" className="rounded accent-accent" checked={settings.showCompanyEmail} onChange={e => setSettings({ ...settings, showCompanyEmail: e.target.checked })} />
                <span>البريد الإلكتروني</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-text-secondary hover:text-text-primary">
                <input type="checkbox" className="rounded accent-accent" checked={settings.showCompanyBankDetails} onChange={e => setSettings({ ...settings, showCompanyBankDetails: e.target.checked })} />
                <span>البيانات البنكية ورقم الآيبان (IBAN)</span>
              </label>
            </div>

            {/* Client Visibility */}
            <div className="space-y-2">
              <h4 className="font-bold text-text-primary pb-1 border-b border-border text-slate-800">بيانات العميل (المشتري)</h4>
              <label className="flex items-center gap-2 cursor-pointer text-text-secondary hover:text-text-primary">
                <input type="checkbox" className="rounded accent-accent" checked={settings.showClientName} onChange={e => setSettings({ ...settings, showClientName: e.target.checked })} />
                <span>اسم العميل</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-text-secondary hover:text-text-primary">
                <input type="checkbox" className="rounded accent-accent" checked={settings.showClientTaxNumber} onChange={e => setSettings({ ...settings, showClientTaxNumber: e.target.checked })} />
                <span>الرقم الضريبي للعميل</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-text-secondary hover:text-text-primary">
                <input type="checkbox" className="rounded accent-accent" checked={settings.showClientCR} onChange={e => setSettings({ ...settings, showClientCR: e.target.checked })} />
                <span>السجل التجاري للعميل</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-text-secondary hover:text-text-primary">
                <input type="checkbox" className="rounded accent-accent" checked={settings.showClientAddress} onChange={e => setSettings({ ...settings, showClientAddress: e.target.checked })} />
                <span>عنوان العميل</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-text-secondary hover:text-text-primary">
                <input type="checkbox" className="rounded accent-accent" checked={settings.showClientPhone} onChange={e => setSettings({ ...settings, showClientPhone: e.target.checked })} />
                <span>رقم هاتف العميل</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-text-secondary hover:text-text-primary">
                <input type="checkbox" className="rounded accent-accent" checked={settings.showClientEmail} onChange={e => setSettings({ ...settings, showClientEmail: e.target.checked })} />
                <span>بريد العميل</span>
              </label>
            </div>

            {/* Document Elements */}
            <div className="space-y-2">
              <h4 className="font-bold text-text-primary pb-1 border-b border-border text-slate-800">عناصر الفاتورة الإضافية</h4>
              <label className="flex items-center gap-2 cursor-pointer text-text-secondary hover:text-text-primary">
                <input type="checkbox" className="rounded accent-accent" checked={settings.showProject} onChange={e => setSettings({ ...settings, showProject: e.target.checked })} />
                <span>المشروع المرتبط</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-text-secondary hover:text-text-primary">
                <input type="checkbox" className="rounded accent-accent" checked={settings.showDueDate} onChange={e => setSettings({ ...settings, showDueDate: e.target.checked })} />
                <span>تاريخ الاستحقاق</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-text-secondary hover:text-text-primary">
                <input type="checkbox" className="rounded accent-accent" checked={settings.showPaymentStatus} onChange={e => setSettings({ ...settings, showPaymentStatus: e.target.checked })} />
                <span>حالة السداد (مدفوعة/غير مدفوعة)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-text-secondary hover:text-text-primary">
                <input type="checkbox" className="rounded accent-accent" checked={settings.showQR} onChange={e => setSettings({ ...settings, showQR: e.target.checked })} />
                <span>رمز الاستجابة السريع (ZATCA QR)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-text-secondary hover:text-text-primary">
                <input type="checkbox" className="rounded accent-accent" checked={settings.showNotes} onChange={e => setSettings({ ...settings, showNotes: e.target.checked })} />
                <span>الملاحظات</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-text-secondary hover:text-text-primary">
                <input type="checkbox" className="rounded accent-accent" checked={settings.showSignatureArea} onChange={e => setSettings({ ...settings, showSignatureArea: e.target.checked })} />
                <span>مكان الختم والتوقيع الرسمي</span>
              </label>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* INVOICE DOCUMENT RENDERER BASED ON SELECTED TEMPLATE */}
      {/* ========================================================================= */}
      <div className="max-w-4xl mx-auto p-4 sm:p-6 print-container">
        {/* TEMPLATE 1: MODERN */}
        {template === 'modern' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden invoice-document">
            <div className="h-2.5 w-full bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-500" />
            <div className="p-8 pb-6 flex items-start justify-between gap-6 border-b border-slate-100">
              <div className="flex items-start gap-4">
                <LogoBlock company={company} settings={settings} primaryColor={currentTemplate.colors.primary} className="w-16 h-16" />
                <CompanyBlock company={company} settings={settings} />
              </div>
              <TitleBlock invoice={invoice} settings={settings} titleInfo={titleInfo} primaryColor={currentTemplate.colors.primary} status={status} align="left" />
            </div>

            <div className="p-6 bg-slate-50/70 border-b border-slate-100">
              <ClientBlock invoice={invoice} settings={settings} />
            </div>

            <div className="p-6">
              <table className="w-full text-right">
                <thead>
                  <tr className="border-b-2 border-slate-900 text-slate-800 text-xs font-bold">
                    <th className="py-3 px-2 w-8">#</th>
                    <th className="py-3 px-2">البيان / Description</th>
                    <th className="py-3 px-2 text-center w-24">الكمية</th>
                    <th className="py-3 px-2 text-center w-32">سعر الوحدة</th>
                    <th className="py-3 px-2 text-left w-36">المجموع</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {(invoice.items || []).map((item: any, i: number) => (
                    <tr key={i} className="hover:bg-slate-50/50">
                      <td className="py-3.5 px-2 text-slate-400 text-xs font-mono">{i + 1}</td>
                      <td className="py-3.5 px-2 font-bold text-slate-800">{item.description}</td>
                      <td className="py-3.5 px-2 text-center text-slate-600 font-mono">{item.quantity}</td>
                      <td className="py-3.5 px-2 text-center text-slate-600 font-mono">{formatCurrency(parseFloat(item.unit_price), locale, '')}</td>
                      <td className="py-3.5 px-2 text-left font-black text-slate-900 font-mono">{formatCurrency(parseFloat(item.total), locale, currencySymbol)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between items-start p-6 bg-slate-50/80 border-t border-slate-100 gap-6">
              {settings.showQR && (
                <div className="p-2.5 rounded-xl bg-white border border-slate-200 shadow-sm flex flex-col items-center gap-1.5">
                  {zatcaData?.qrData ? (
                    <>
                      <QRCode value={zatcaData.qrData} size={110} />
                      <span className="text-[9px] font-bold text-slate-500">هيئة الزكاة والضريبة والجمارك</span>
                    </>
                  ) : (
                    <span className="text-xs text-slate-400 p-4">QR غير متاح</span>
                  )}
                </div>
              )}

              <div className="w-80 space-y-2.5 text-xs text-right">
                <div className="flex justify-between text-slate-600">
                  <span>المجموع الفرعي (قبل الضريبة):</span>
                  <span className="font-bold text-slate-900 font-mono">{formatCurrency(subtotal, locale, currencySymbol)}</span>
                </div>
                {vatAmount > 0 && (
                  <div className="flex justify-between text-slate-600">
                    <span>ضريبة القيمة المضافة ({vatRate * 100}%):</span>
                    <span className="font-bold text-slate-900 font-mono">{formatCurrency(vatAmount, locale, currencySymbol)}</span>
                  </div>
                )}
                {paidAmount > 0 && (
                  <div className="flex justify-between text-green-600 font-medium">
                    <span>المبلغ المسدد مسبقاً:</span>
                    <span className="font-bold font-mono">{formatCurrency(paidAmount, locale, currencySymbol)}</span>
                  </div>
                )}
                {remaining > 0 && invoice.status !== 'paid' && (
                  <div className="flex justify-between text-red-600 font-medium">
                    <span>المتبقي المستحق:</span>
                    <span className="font-bold font-mono">{formatCurrency(remaining, locale, currencySymbol)}</span>
                  </div>
                )}
                <div className="flex justify-between pt-3 border-t-2 border-slate-900 text-sm">
                  <span className="font-black text-slate-900">الإجمالي الكلي شامل الضريبة:</span>
                  <span className="font-black font-mono text-blue-600 text-base">{formatCurrency(total, locale, currencySymbol)}</span>
                </div>
              </div>
            </div>

            <div className="p-6 bg-white border-t border-slate-100 space-y-4 text-xs">
              {settings.showNotes && invoice.notes && (
                <div>
                  <h5 className="font-bold text-slate-700 mb-1">ملاحظات:</h5>
                  <p className="text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-100">{invoice.notes}</p>
                </div>
              )}

              {settings.showSignatureArea && (
                <div className="grid grid-cols-2 gap-8 pt-6 border-t border-slate-100 text-center">
                  <div>
                    <p className="font-bold text-slate-700 mb-12">توقيع المستلم (العميل)</p>
                    <div className="border-t border-dashed border-slate-300 w-48 mx-auto" />
                  </div>
                  <div>
                    <p className="font-bold text-slate-700 mb-12">الختم والتوقيع المعتمد</p>
                    <div className="border-t border-dashed border-slate-300 w-48 mx-auto" />
                  </div>
                </div>
              )}

              <div className="text-center text-[10px] text-slate-400 pt-3 border-t border-slate-100">
                {settings.footerText || `فاتورة إلكترونية صادرة من ${company?.name || 'النظام المحاسبي'} معتمدة ضريبياً`}
              </div>
            </div>
          </div>
        )}

        {/* TEMPLATE 2: CLASSIC */}
        {template === 'classic' && (
          <div className="bg-white p-8 shadow-sm border-2 border-slate-800 rounded-none invoice-document">
            <div className="border-b-2 border-slate-800 pb-6 mb-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <LogoBlock company={company} settings={settings} primaryColor={currentTemplate.colors.primary} className="w-16 h-16 rounded-none border-2 border-slate-800" />
                  <CompanyBlock company={company} settings={settings} />
                </div>
                <div className="text-left border-2 border-slate-800 p-4 bg-slate-50 min-w-[240px]">
                  <h1 className="text-lg font-black text-slate-900 text-center border-b border-slate-800 pb-1 mb-2">
                    {titleInfo.titleAr}
                  </h1>
                  <p className="text-xs text-center font-bold text-slate-500 mb-2">{titleInfo.titleEn}</p>
                  <p className="text-xs font-mono font-bold text-slate-800">رقم الفاتورة: #{invoice.number}</p>
                  <p className="text-xs text-slate-600">التاريخ: {formatDate(invoice.date)}</p>
                </div>
              </div>
            </div>

            <div className="border border-slate-800 p-4 mb-6 bg-slate-50/50">
              <ClientBlock invoice={invoice} settings={settings} />
            </div>

            <div className="mb-6 overflow-hidden border border-slate-800">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-800 text-white font-bold">
                  <tr>
                    <th className="p-2 border border-slate-800 text-center w-8">م</th>
                    <th className="p-2 border border-slate-800">البيان وتفاصيل الخدمة / الصنف</th>
                    <th className="p-2 border border-slate-800 text-center w-20">الكمية</th>
                    <th className="p-2 border border-slate-800 text-center w-28">سعر الوحدة</th>
                    <th className="p-2 border border-slate-800 text-left w-32">المبلغ الإجمالي</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-300">
                  {(invoice.items || []).map((item: any, i: number) => (
                    <tr key={i}>
                      <td className="p-2.5 text-center font-mono border-r border-l border-slate-300">{i + 1}</td>
                      <td className="p-2.5 font-bold text-slate-800 border-r border-slate-300">{item.description}</td>
                      <td className="p-2.5 text-center font-mono border-r border-slate-300">{item.quantity}</td>
                      <td className="p-2.5 text-center font-mono border-r border-slate-300">{formatCurrency(parseFloat(item.unit_price), locale, '')}</td>
                      <td className="p-2.5 text-left font-black font-mono border-r border-slate-300">{formatCurrency(parseFloat(item.total), locale, currencySymbol)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-2 gap-6 items-start border border-slate-800 p-4 mb-6">
              <div>
                {settings.showQR && (
                  <div className="flex items-center gap-4">
                    <QRCode value={zatcaData?.qrData || ''} size={100} />
                    <div className="text-[11px] text-slate-600 leading-relaxed">
                      <strong>الفاتورة الإلكترونية المعتمدة</strong>
                      <p>مطابقة لمتطلبات الفوترة الضريبية الصادرة عن هيئة الزكاة والضريبة والجمارك.</p>
                    </div>
                  </div>
                )}
              </div>
              <div className="space-y-2 text-xs border-r border-slate-800 pr-6">
                <div className="flex justify-between font-bold">
                  <span>المجموع الخاضع للضريبة:</span>
                  <span className="font-mono">{formatCurrency(subtotal, locale, currencySymbol)}</span>
                </div>
                <div className="flex justify-between text-slate-700">
                  <span>نسبة الضريبة ({vatRate * 100}%):</span>
                  <span className="font-mono">{formatCurrency(vatAmount, locale, currencySymbol)}</span>
                </div>
                <div className="flex justify-between font-black text-sm pt-2 border-t-2 border-slate-800 text-slate-900">
                  <span>صافي الفاتورة النهائي:</span>
                  <span className="font-mono">{formatCurrency(total, locale, currencySymbol)}</span>
                </div>
              </div>
            </div>

            {settings.showSignatureArea && (
              <div className="grid grid-cols-2 gap-12 text-center pt-8 border-t border-slate-800 text-xs">
                <div>
                  <p className="font-bold mb-10">توقيع المستلم</p>
                  <div className="border-t border-slate-400 w-40 mx-auto" />
                </div>
                <div>
                  <p className="font-bold mb-10">الختم الرسمي للمؤسسة</p>
                  <div className="border-t border-slate-400 w-40 mx-auto" />
                </div>
              </div>
            )}
          </div>
        )}

        {/* TEMPLATE 3: COMPACT */}
        {template === 'compact' && (
          <div className="bg-white p-6 shadow-sm border border-slate-200 rounded-lg text-xs invoice-document">
            <div className="flex justify-between items-center pb-4 border-b border-slate-200">
              <div className="flex items-center gap-3">
                <LogoBlock company={company} settings={settings} primaryColor={currentTemplate.colors.primary} className="w-10 h-10" />
                <div>
                  <h2 className="font-bold text-sm text-slate-900">{company?.name}</h2>
                  <p className="text-[10px] text-slate-500 font-mono">الضريبي: {company?.tax_number} | هاتف: {company?.phone}</p>
                </div>
              </div>
              <div className="text-left">
                <h1 className="font-black text-sm text-teal-700">{titleInfo.titleAr}</h1>
                <p className="font-mono font-bold text-slate-700">#{invoice.number} | {formatDate(invoice.date)}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 py-3 border-b border-slate-200 text-[11px] bg-slate-50/50 px-2 my-2 rounded">
              <div>
                <span className="text-slate-400">العميل: </span>
                <strong className="text-slate-800">{invoice.client_name}</strong>
                {invoice.client_tax_number && <span className="font-mono text-slate-600 mr-2">({invoice.client_tax_number})</span>}
              </div>
              <div className="text-left">
                <span className="text-slate-400">المشروع: </span>
                <span className="font-semibold text-slate-700">{invoice.project_name || '—'}</span>
              </div>
            </div>

            <table className="w-full text-right mb-4">
              <thead className="bg-teal-50 text-teal-900 font-bold border-y border-teal-200">
                <tr>
                  <th className="py-1.5 px-2">#</th>
                  <th className="py-1.5 px-2">البيان</th>
                  <th className="py-1.5 px-2 text-center">الكمية</th>
                  <th className="py-1.5 px-2 text-center">السعر</th>
                  <th className="py-1.5 px-2 text-left">المجموع</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(invoice.items || []).map((item: any, i: number) => (
                  <tr key={i}>
                    <td className="py-1.5 px-2 font-mono text-slate-400">{i + 1}</td>
                    <td className="py-1.5 px-2 font-semibold text-slate-800">{item.description}</td>
                    <td className="py-1.5 px-2 text-center font-mono">{item.quantity}</td>
                    <td className="py-1.5 px-2 text-center font-mono">{formatCurrency(parseFloat(item.unit_price), locale, '')}</td>
                    <td className="py-1.5 px-2 text-left font-bold font-mono">{formatCurrency(parseFloat(item.total), locale, currencySymbol)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex justify-between items-center pt-3 border-t border-slate-200">
              {settings.showQR && (
                <div className="flex items-center gap-2">
                  <QRCode value={zatcaData?.qrData || ''} size={70} />
                  <span className="text-[9px] text-slate-400">فاتورة زاتكا الإلكترونية</span>
                </div>
              )}
              <div className="w-64 space-y-1 text-right">
                <div className="flex justify-between text-slate-500">
                  <span>المجموع:</span>
                  <span className="font-mono">{formatCurrency(subtotal, locale, currencySymbol)}</span>
                </div>
                <div className="flex justify-between text-slate-500">
                  <span>الضريبة ({vatRate * 100}%):</span>
                  <span className="font-mono">{formatCurrency(vatAmount, locale, currencySymbol)}</span>
                </div>
                <div className="flex justify-between font-black text-sm text-teal-800 pt-1 border-t border-slate-300">
                  <span>الإجمالي الكلي:</span>
                  <span className="font-mono">{formatCurrency(total, locale, currencySymbol)}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TEMPLATE 4: ELEGANT */}
        {template === 'elegant' && (
          <div className="bg-white p-8 shadow-md rounded-3xl border border-purple-100 invoice-document">
            <div className="text-center pb-6 border-b border-purple-100">
              <div className="flex justify-center mb-3">
                <LogoBlock company={company} settings={settings} primaryColor={currentTemplate.colors.primary} className="w-16 h-16 rounded-2xl" />
              </div>
              <h1 className="text-2xl font-black text-purple-900 mb-1">{titleInfo.titleAr}</h1>
              <p className="text-xs text-purple-600 font-semibold mb-3">{titleInfo.titleEn}</p>
              <div className="inline-flex items-center gap-4 px-4 py-1.5 rounded-full bg-purple-50 text-purple-800 text-xs font-mono font-bold">
                <span>رقم: #{invoice.number}</span>
                <span>•</span>
                <span>التاريخ: {formatDate(invoice.date)}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 my-6">
              <div className="p-4 rounded-2xl bg-purple-50/40 border border-purple-100">
                <CompanyBlock company={company} settings={settings} />
              </div>
              <div className="p-4 rounded-2xl bg-purple-50/40 border border-purple-100">
                <ClientBlock invoice={invoice} settings={settings} />
              </div>
            </div>

            <div className="rounded-2xl border border-purple-100 overflow-hidden mb-6">
              <table className="w-full text-right text-xs">
                <thead className="bg-purple-900 text-white font-bold">
                  <tr>
                    <th className="p-3">#</th>
                    <th className="p-3">البيان</th>
                    <th className="p-3 text-center">الكمية</th>
                    <th className="p-3 text-center">السعر</th>
                    <th className="p-3 text-left">المجموع</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-purple-50">
                  {(invoice.items || []).map((item: any, i: number) => (
                    <tr key={i} className="hover:bg-purple-50/30">
                      <td className="p-3 text-purple-400 font-mono">{i + 1}</td>
                      <td className="p-3 font-bold text-slate-800">{item.description}</td>
                      <td className="p-3 text-center font-mono">{item.quantity}</td>
                      <td className="p-3 text-center font-mono">{formatCurrency(parseFloat(item.unit_price), locale, '')}</td>
                      <td className="p-3 text-left font-black text-purple-950 font-mono">{formatCurrency(parseFloat(item.total), locale, currencySymbol)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between items-center p-6 rounded-2xl bg-purple-900 text-white">
              {settings.showQR ? (
                <div className="p-2 bg-white rounded-xl">
                  <QRCode value={zatcaData?.qrData || ''} size={90} />
                </div>
              ) : <div />}
              <div className="w-72 space-y-2 text-left">
                <div className="flex justify-between text-purple-200 text-xs">
                  <span>المجموع الفرعي:</span>
                  <span className="font-mono font-bold">{formatCurrency(subtotal, locale, currencySymbol)}</span>
                </div>
                <div className="flex justify-between text-purple-200 text-xs">
                  <span>ضريبة القيمة المضافة ({vatRate * 100}%):</span>
                  <span className="font-mono font-bold">{formatCurrency(vatAmount, locale, currencySymbol)}</span>
                </div>
                <div className="flex justify-between text-base font-black pt-2 border-t border-purple-700">
                  <span>الإجمالي الكلي:</span>
                  <span className="font-mono text-yellow-300 text-xl">{formatCurrency(total, locale, currencySymbol)}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TEMPLATE 5: CONSTRUCTION (CONTRACTING / BOQ) */}
        {template === 'construction' && (
          <div className="bg-white p-6 shadow-sm border-t-8 border-amber-600 rounded-xl invoice-document text-xs">
            <div className="flex justify-between items-start pb-4 border-b-2 border-slate-200">
              <div className="flex gap-4 items-start">
                <LogoBlock company={company} settings={settings} primaryColor={currentTemplate.colors.primary} className="w-14 h-14" />
                <div>
                  <h2 className="text-base font-bold text-slate-900">{company?.name}</h2>
                  <p className="text-slate-500 font-mono">الرقم الضريبي: {company?.tax_number} | السجل: {company?.commercial_registration}</p>
                  <p className="text-amber-800 font-semibold mt-1">قسم المشاريع وعقود المقاولات العامة</p>
                </div>
              </div>
              <div className="text-left bg-amber-50 p-3 rounded-lg border border-amber-200">
                <h1 className="font-black text-amber-900 text-sm">{titleInfo.titleAr} - مستخلص أعمال</h1>
                <p className="font-mono font-bold text-slate-800 mt-1">رقم الفاتورة: #{invoice.number}</p>
                <p className="text-slate-600">التاريخ: {formatDate(invoice.date)}</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 p-3 my-4 bg-slate-50 rounded-lg border border-slate-200 text-slate-700">
              <div><strong>العميل / المالك:</strong> {invoice.client_name}</div>
              <div><strong>المشروع:</strong> {invoice.project_name || 'مشروع إنشائي'}</div>
              <div><strong>حالة المستخلص:</strong> <Badge variant="success">معتمد</Badge></div>
            </div>

            <table className="w-full text-right mb-4 border border-slate-200">
              <thead className="bg-slate-800 text-white font-bold">
                <tr>
                  <th className="p-2.5 text-center w-8">بند</th>
                  <th className="p-2.5">توصيف بنود الأعمال المنفذة (BOQ Items)</th>
                  <th className="p-2.5 text-center w-24">الكمية المنفذة</th>
                  <th className="p-2.5 text-center w-28">فئة السعر</th>
                  <th className="p-2.5 text-left w-36">إجمالي القيمة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {(invoice.items || []).map((item: any, i: number) => (
                  <tr key={i} className="hover:bg-amber-50/30">
                    <td className="p-2.5 text-center font-mono">{i + 1}</td>
                    <td className="p-2.5 font-bold text-slate-800">{item.description}</td>
                    <td className="p-2.5 text-center font-mono">{item.quantity}</td>
                    <td className="p-2.5 text-center font-mono">{formatCurrency(parseFloat(item.unit_price), locale, '')}</td>
                    <td className="p-2.5 text-left font-bold font-mono">{formatCurrency(parseFloat(item.total), locale, currencySymbol)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="grid grid-cols-2 gap-6 items-start p-4 bg-slate-50 rounded-lg border border-slate-200">
              {settings.showQR && (
                <div className="flex items-center gap-3">
                  <QRCode value={zatcaData?.qrData || ''} size={90} />
                  <p className="text-[10px] text-slate-500">فاتورة ضريبية رسمية متوافقة مع منظومة الفاتورة الإلكترونية (فاتورة).</p>
                </div>
              )}
              <div className="space-y-1.5 text-right">
                <div className="flex justify-between">
                  <span>قيمة الأعمال المنفذة (غير شامل الضريبة):</span>
                  <span className="font-mono font-bold">{formatCurrency(subtotal, locale, currencySymbol)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>ضريبة القيمة المضافة ({vatRate * 100}%):</span>
                  <span className="font-mono">{formatCurrency(vatAmount, locale, currencySymbol)}</span>
                </div>
                <div className="flex justify-between text-sm font-black text-amber-900 pt-2 border-t border-slate-300">
                  <span>صافي المستحق للمقاول:</span>
                  <span className="font-mono text-base">{formatCurrency(total, locale, currencySymbol)}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TEMPLATE 6: THERMAL (80mm POS RECEIPT) */}
        {template === 'thermal' && (
          <div className="max-w-[340px] mx-auto bg-white p-4 shadow border border-slate-300 font-mono text-xs text-black invoice-document">
            <div className="text-center pb-2 border-b border-dashed border-black">
              {settings.showLogo && company?.logo_url && (
                <img src={company.logo_url} alt="" className="w-12 h-12 mx-auto mb-1 object-contain" />
              )}
              <h2 className="font-black text-sm">{company?.name}</h2>
              <p className="text-[10px]">الرقم الضريبي: {company?.tax_number}</p>
              <p className="text-[10px]">{company?.phone}</p>
              <div className="mt-1 pt-1 border-t border-dotted border-black font-bold">
                {titleInfo.titleAr}
              </div>
              <p className="text-[10px]">فاتورة رقم: #{invoice.number}</p>
              <p className="text-[10px]">{formatDate(invoice.date)}</p>
            </div>

            <div className="py-2 border-b border-dashed border-black text-[10px]">
              <p>العميل: {invoice.client_name}</p>
              {invoice.client_tax_number && <p>الضريبي: {invoice.client_tax_number}</p>}
            </div>

            <table className="w-full my-2 text-[10px]">
              <thead>
                <tr className="border-b border-black">
                  <th className="text-right py-1">الصنف</th>
                  <th className="text-center py-1">الكمية</th>
                  <th className="text-left py-1">الإجمالي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dotted divide-slate-300">
                {(invoice.items || []).map((item: any, i: number) => (
                  <tr key={i}>
                    <td className="py-1">{item.description}</td>
                    <td className="py-1 text-center">{item.quantity}</td>
                    <td className="py-1 text-left">{parseFloat(item.total).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="space-y-1 pt-2 border-t border-dashed border-black text-[11px]">
              <div className="flex justify-between">
                <span>المجموع:</span>
                <span>{subtotal.toFixed(2)} {currencySymbol}</span>
              </div>
              <div className="flex justify-between">
                <span>الضريبة (15%):</span>
                <span>{vatAmount.toFixed(2)} {currencySymbol}</span>
              </div>
              <div className="flex justify-between font-black text-xs pt-1 border-t border-black">
                <span>الإجمالي:</span>
                <span>{total.toFixed(2)} {currencySymbol}</span>
              </div>
            </div>

            {settings.showQR && zatcaData?.qrData && (
              <div className="mt-4 pt-2 border-t border-dashed border-black text-center flex flex-col items-center">
                <QRCode value={zatcaData.qrData} size={110} />
                <p className="text-[9px] mt-1">شكراً لزيارتكم</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Internal Accountant Review: Double-Entry Journal Viewer */}
      {invoice.journal_lines && invoice.journal_lines.length > 0 && (
        <div className="max-w-4xl mx-auto p-4 sm:p-6 pt-0 no-print">
          <Card className="bg-slate-50 border-slate-200 p-4">
            <div className="flex items-center justify-between mb-4 border-b border-slate-200 pb-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="text-accent" size={18} />
                <h4 className="text-sm font-bold text-slate-800">تأكيد الترحيل - القيد المحاسبي المزدوج (للمراجعة الداخلية فقط)</h4>
              </div>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setShowInternalJournal(!showInternalJournal)}
                leftIcon={showInternalJournal ? <EyeOff size={14} /> : <Eye size={14} />}
              >
                {showInternalJournal ? 'إخفاء القيد' : 'عرض القيد'}
              </Button>
            </div>
            
            {showInternalJournal && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-right">
                  <thead>
                    <tr className="text-slate-400 border-b border-slate-200">
                      <th className="p-1 font-bold text-slate-500 bg-transparent">الحساب المدين / الدائن</th>
                      <th className="p-1 font-bold text-slate-500 bg-transparent text-center">كود الحساب</th>
                      <th className="p-1 font-bold text-slate-500 bg-transparent text-left">مدين (Debit)</th>
                      <th className="p-1 font-bold text-slate-500 bg-transparent text-left">دائن (Credit)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.journal_lines.map((jl: any, i: number) => (
                      <tr key={i} className="text-slate-600 border-b border-slate-100/50 last:border-0">
                        <td className="p-2 font-medium">{jl.account_name}</td>
                        <td className="p-2 text-center font-mono text-slate-400">{jl.account_code}</td>
                        <td className="p-2 text-left font-mono font-bold text-slate-800">{parseFloat(jl.debit) > 0 ? formatCurrency(parseFloat(jl.debit), locale, '') : '—'}</td>
                        <td className="p-2 text-left font-mono font-bold text-slate-800">{parseFloat(jl.credit) > 0 ? formatCurrency(parseFloat(jl.credit), locale, '') : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
