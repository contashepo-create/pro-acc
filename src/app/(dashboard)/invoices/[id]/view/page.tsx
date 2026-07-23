'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowRight, Printer, FileDown, Settings, Check, ShieldCheck, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { QRCode } from '@/components/ui/QRCode';
import { useAuthStore } from '@/store/auth-store'; // FIXED: Added missing import for useAuthStore to prevent ReferenceError crash on render
import { formatDate, formatCurrency } from '@/lib/utils';
import { INVOICE_TEMPLATES, getTemplateConfig, DEFAULT_INVOICE_SETTINGS, type InvoiceTemplateSettings } from '@/lib/invoice-templates';

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
  const [showSettings, setShowSettings] = useState(false);
  const [showInternalJournal, setShowInternalJournal] = useState(true); // التحكم في إخفاء/إظهار القيد للمراجعة الداخلية

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

        // Load invoice settings
        try {
          const setRes = await fetch('/api/settings');
          const setJson = await setRes.json();
          if (setJson.success && setJson.data?.invoice_template_settings) {
            const saved = typeof setJson.data.invoice_template_settings === 'string'
              ? JSON.parse(setJson.data.invoice_template_settings)
              : setJson.data.invoice_template_settings;
            setSettings({ ...DEFAULT_INVOICE_SETTINGS, ...saved });
            setTemplate(saved.defaultTemplate || 'modern');
          }
        } catch {}
      } catch { 
        setError('خطأ في الاتصال بالخادم'); 
      } finally { 
        setLoading(false); 
      }
    };
    fetchData();
  }, [params.id]);

  const handlePrint = () => window.print();

  if (loading) return <div className="p-6 text-center text-text-secondary">جاري التحميل...</div>;
  if (error) return <div className="p-6"><div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div></div>;
  if (!invoice) return null;

  const vatRate = parseFloat(invoice.tax_rate || invoice.vat_rate || 0);
  const vatAmount = parseFloat(invoice.tax_amount || invoice.vat_amount || 0);
  const subtotal = parseFloat(invoice.subtotal || 0);
  const total = parseFloat(invoice.total || 0);
  const paidAmount = parseFloat(invoice.paid_amount || 0);
  const remaining = total - paidAmount;
  const currencySymbol = company?.currency_symbol || 'ر.س';
  const locale = company?.locale || 'ar-SA';
  
  // FIXED: تحسين الألوان وتدرج السطوع للقوالب لتواكب أرقى الأنظمة العالمية (Stripe / Xero)
  // تم تقليل حدة الألوان الخلفية الثقيلة واستخدام خطوط رمادية رفيعة وأنيقة
  const tpl = getTemplateConfig(template);
  const c = {
    primary: tpl.id === 'modern' ? '#2563eb' : tpl.id === 'compact' ? '#0d9488' : tpl.id === 'elegant' ? '#7c3aed' : '#1e293b',
    border: '#f1f5f9',
    bg: '#ffffff',
    header: '#f8fafc'
  };

  const statusMap: Record<string, { label: string; color: string; bg: string }> = {
    unpaid: { label: 'غير مدفوعة', color: '#b45309', bg: '#fef3c7' },
    partial: { label: 'مدفوعة جزئياً', color: '#1d4ed8', bg: '#dbeafe' },
    paid: { label: 'مدفوعة', color: '#15803d', bg: '#dcfce7' },
    cancelled: { label: 'ملغاة', color: '#b91c1c', bg: '#fee2e2' },
  };
  const status = statusMap[invoice.status] || { label: invoice.status, color: '#4b5563', bg: '#f3f4f6' };

  // ====== Render Header based on template layout ======
  const renderHeader = () => {
    const CompanyLogo = () => (
      settings.showLogo && (
        company?.logo_url ? (
          <img src={company.logo_url} alt={company.name} className="w-12 h-12 rounded-xl object-cover border border-slate-100 shadow-sm" />
        ) : (
          <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white text-xl font-bold shadow-sm" style={{ background: c.primary }}>
            {(company?.name || 'ب')[0]}
          </div>
        )
      )
    );

    const CompanyInfo = () => (
      <div className="space-y-0.5">
        <h2 className="text-lg font-bold text-slate-900">{company?.name || 'الشركة'}</h2>
        {company?.tax_number && <p className="text-xs text-slate-500">الرقم الضريبي: <span className="font-mono font-medium">{company.tax_number}</span></p>}
        {company?.commercial_registration && <p className="text-xs text-slate-500">سجل تجاري: <span className="font-mono">{company.commercial_registration}</span></p>}
        {company?.address && <p className="text-xs text-slate-400">{company.address}</p>}
        {company?.phone && <p className="text-xs text-slate-400 font-mono" dir="ltr">{company.phone}</p>}
      </div>
    );

    const InvoiceTitle = () => (
      <div className="text-left">
        {/* العنوان الثنائي المعتمد لضريبة زاتكا المبسطة */}
        <h3 className="text-xl font-black tracking-tight" style={{ color: c.primary }}>فاتورة ضريبية مبسطة</h3>
        <p className="text-xs text-slate-400 font-medium">Simplified Tax Invoice</p>
        <p className="text-sm font-bold text-slate-800 mt-2 font-mono">#{invoice.number}</p>
        <div className="mt-2 text-xs text-slate-500 space-y-0.5">
          <p>تاريخ الإصدار: {formatDate(invoice.date)}</p>
          {invoice.due_date && <p>تاريخ الاستحقاق: {formatDate(invoice.due_date)}</p>}
        </div>
      </div>
    );

    return (
      <div className="flex items-center justify-between p-6 border-b border-slate-100" style={{ background: c.bg }}>
        <div className="flex items-start gap-4">
          <CompanyLogo />
          <CompanyInfo />
        </div>
        <InvoiceTitle />
      </div>
    );
  };

  const renderClientInfo = () => (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div>
        <span className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">العميل / Client</span>
        <p className="text-sm font-bold text-slate-800">{invoice.client_name || 'عميل'}</p>
        {settings.showClientTaxNumber && invoice.client_tax_number && (
          <p className="text-xs text-slate-500 mt-1">الرقم الضريبي: <span className="font-mono">{invoice.client_tax_number}</span></p>
        )}
      </div>
      {(invoice.client_address || invoice.client_phone || invoice.project_name) && (
        <div className="space-y-0.5 text-xs text-slate-500">
          {settings.showClientAddress && invoice.client_address && <p>{invoice.client_address}</p>}
          {settings.showClientPhone && invoice.client_phone && <p dir="ltr" className="font-mono">{invoice.client_phone}</p>}
          {settings.showProject && invoice.project_name && (
            <p className="mt-1.5"><span className="text-slate-400">المشروع:</span> <span className="font-medium text-slate-700">{invoice.project_name}</span></p>
          )}
          {settings.showUserName && invoice.created_by_name && (
            <p className="text-[10px] text-slate-400">أعدّها: {invoice.created_by_name}</p>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-bg-secondary">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-bg-primary no-print flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.back()}><ArrowRight size={20} /></Button>
          <h1 className="text-sm font-bold text-text-primary">عرض الفاتورة</h1>
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold" style={{ background: status.bg, color: status.color }}>{status.label}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Template selector */}
          <div className="flex items-center gap-0.5 bg-bg-secondary rounded-lg p-0.5 border border-border">
            {INVOICE_TEMPLATES.map(t => (
              <button key={t.id} onClick={() => setTemplate(t.id)} title={t.description}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${template === t.id ? 'bg-accent text-white shadow-sm' : 'text-text-secondary hover:text-text-primary'}`}>
                {t.name}
              </button>
            ))}
          </div>
          {/* Settings button */}
          <button onClick={() => setShowSettings(!showSettings)} className="p-1.5 rounded-xl bg-bg-secondary text-text-secondary border border-border hover:text-accent" title="إعدادات القالب">
            <Settings size={16} />
          </button>
          <Button variant="ghost" size="sm" onClick={handlePrint} leftIcon={<Printer size={16} />}>طباعة الفاتورة</Button>
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="px-6 py-3 border-b border-border bg-bg-primary no-print">
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" className="rounded border-border accent-accent" checked={settings.showLogo} onChange={e => setSettings({ ...settings, showLogo: e.target.checked })} /> الشعار</label>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" className="rounded border-border accent-accent" checked={settings.showUserName} onChange={e => setSettings({ ...settings, showUserName: e.target.checked })} /> اسم الموظف</label>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" className="rounded border-border accent-accent" checked={settings.showClientTaxNumber} onChange={e => setSettings({ ...settings, showClientTaxNumber: e.target.checked })} /> رقم ضريبي العميل</label>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" className="rounded border-border accent-accent" checked={settings.showClientAddress} onChange={e => setSettings({ ...settings, showClientAddress: e.target.checked })} /> عنوان العميل</label>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" className="rounded border-border accent-accent" checked={settings.showClientPhone} onChange={e => setSettings({ ...settings, showClientPhone: e.target.checked })} /> هاتف العميل</label>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" className="rounded border-border accent-accent" checked={settings.showProject} onChange={e => setSettings({ ...settings, showProject: e.target.checked })} /> المشروع</label>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" className="rounded border-border accent-accent" checked={settings.showNotes} onChange={e => setSettings({ ...settings, showNotes: e.target.checked })} /> الملاحظات</label>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" className="rounded border-border accent-accent" checked={settings.showQR} onChange={e => setSettings({ ...settings, showQR: e.target.checked })} /> QR زاتكا</label>
          </div>
        </div>
      )}

      {/* Invoice Document (Sleek Modern Standard Layout) */}
      <div className="max-w-4xl mx-auto p-4 sm:p-6 print-container">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden invoice-document"
          style={{ borderTop: `4px solid ${c.primary}` }}>

          {/* Header */}
          {renderHeader()}

          {/* Client Info */}
          <div className="px-6 py-4 border-b border-slate-100">
            {renderClientInfo()}
          </div>

          {/* Items Table — High-contrast, minimalist, ultra-clean */}
          <div className="px-6 py-4">
            <table className="w-full">
              <thead>
                <tr className="border-b-2 border-slate-900">
                  <th className="text-right py-2.5 px-2 text-xs font-bold text-slate-800 bg-transparent">#</th>
                  <th className="text-right py-2.5 px-2 text-xs font-bold text-slate-800 bg-transparent">البيان / Description</th>
                  <th className="text-center py-2.5 px-2 text-xs font-bold text-slate-800 bg-transparent">الكمية / Qty</th>
                  <th className="text-center py-2.5 px-2 text-xs font-bold text-slate-800 bg-transparent">سعر الوحدة / Rate</th>
                  <th className="text-left py-2.5 px-2 text-xs font-bold text-slate-800 bg-transparent">الإجمالي / Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(invoice.items || []).map((item: any, i: number) => (
                  <tr key={i}>
                    <td className="py-3 px-2 text-xs text-slate-400 font-mono">{i + 1}</td>
                    <td className="py-3 px-2 text-sm text-slate-800 font-semibold">{item.description}</td>
                    <td className="py-3 px-2 text-sm text-center text-slate-600 font-mono">{item.quantity}</td>
                    <td className="py-3 px-2 text-sm text-center text-slate-600 font-mono">{formatCurrency(parseFloat(item.unit_price), locale, '')}</td>
                    <td className="py-3 px-2 text-sm text-left font-bold text-slate-900 font-mono">{formatCurrency(parseFloat(item.total), locale, currencySymbol)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals + QR */}
          <div className="flex justify-between items-start px-6 py-4 bg-slate-50/50 border-t border-slate-100">
            {/* QR ZATCA */}
            {settings.showQR && (
              <div className="flex flex-col items-center gap-1.5 p-1 rounded-xl bg-white border border-slate-100 shadow-sm">
                {zatcaData?.qrData ? (
                  <>
                    <QRCode value={zatcaData.qrData} size={100} />
                    <p className="text-[9px] font-bold text-slate-400">هيئة الزكاة والجمارك</p>
                  </>
                ) : (
                  <p className="text-[10px] text-gray-400">QR غير متاح</p>
                )}
              </div>
            )}

            {/* Totals */}
            <div className="w-72 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">المجموع الفرعي (غير شامل الضريبة)</span>
                <span className="font-bold text-slate-900 font-mono">{formatCurrency(subtotal, locale, currencySymbol)}</span>
              </div>
              {vatAmount > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-500">ضريبة القيمة المضافة ({vatRate * 100}%)</span>
                  <span className="font-bold text-slate-900 font-mono">{formatCurrency(vatAmount, locale, currencySymbol)}</span>
                </div>
              )}
              {paidAmount > 0 && (
                <div className="flex justify-between text-xs">
                  <span className="text-green-600">المبلغ المدفوع سابقاُ</span>
                  <span className="font-bold text-green-600 font-mono">{formatCurrency(paidAmount, locale, currencySymbol)}</span>
                </div>
              )}
              {remaining > 0 && invoice.status !== 'paid' && (
                <div className="flex justify-between text-xs">
                  <span className="text-red-500">المبلغ المتبقي للسداد</span>
                  <span className="font-bold text-red-600 font-mono">{formatCurrency(remaining, locale, currencySymbol)}</span>
                </div>
              )}
              <div className="flex justify-between pt-2 border-t border-slate-200">
                <span className="text-sm font-black text-slate-800">الإجمالي الكلي شامل الضريبة / Total</span>
                <span className="text-lg font-black font-mono" style={{ color: c.primary }}>{formatCurrency(total, locale, currencySymbol)}</span>
              </div>
            </div>
          </div>

          {/* Notes */}
          {settings.showNotes && invoice.notes && (
            <div className="px-6 py-3 border-t border-slate-100 bg-white">
              <p className="text-xs text-slate-500"><strong>ملاحظات:</strong> {invoice.notes}</p>
            </div>
          )}

          {/* Footer */}
          <div className="px-6 py-4 text-center border-t border-slate-100 bg-slate-50/50">
            <p className="text-xs text-slate-400">{settings.footerText || `هذه الفاتورة صادرة إلكترونياً من نظام ${company?.name || 'برو أكاوننت'}`}</p>
            {company?.country_code === 'SA' && (
              <p className="text-[9px] text-slate-400 mt-1 font-medium">فاتورة ضريبية مبسطة متوافقة بالكامل مع شروط هيئة الزكاة والضريبة والجمارك بالمملكة العربية السعودية</p>
            )}
          </div>
        </div>
      </div>

      {/* FIXED: عزل كامل لـ "القيد المحاسبي" (Journal Entry) وجعله للمراجعة الداخلية للمحاسب فقط، ومحجوب تماماً من الطباعة no-print */}
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
