'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowRight, Printer, FileDown, Settings, Check } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { QRCode } from '@/components/ui/QRCode';
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

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [invRes, zatcaRes] = await Promise.all([
          fetch(`/api/invoices/${params.id}`),
          fetch(`/api/invoices/${params.id}/zatca`),
        ]);
        const [invJson, zatcaJson] = await Promise.all([invRes.json(), zatcaRes.json()]);
        if (invJson.success) { setInvoice(invJson.data); setCompany(invJson.data?.company || {}); }
        else setError(invJson.message || 'فشل تحميل الفاتورة');
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
      } catch { setError('خطأ في الاتصال بالخادم'); }
      finally { setLoading(false); }
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
  const tpl = getTemplateConfig(template);
  const c = settings.colorPrint ? tpl.colors : { primary: '#000', bg: '#fff', border: '#ccc', header: '#333' };

  const statusMap: Record<string, { label: string; color: string }> = {
    unpaid: { label: 'غير مدفوعة', color: '#f59e0b' },
    partial: { label: 'مدفوعة جزئياً', color: '#3b82f6' },
    paid: { label: 'مدفوعة', color: '#22c55e' },
    cancelled: { label: 'ملغاة', color: '#ef4444' },
  };
  const status = statusMap[invoice.status] || { label: invoice.status, color: '#999' };

  // ====== Render Header based on template layout ======
  const renderHeader = () => {
    const CompanyLogo = () => (
      settings.showLogo && (
        company?.logo_url ? (
          <img src={company.logo_url} alt={company.name} className="w-16 h-16 rounded-lg object-cover" />
        ) : (
          <div className="w-16 h-16 rounded-lg flex items-center justify-center text-white text-2xl font-bold" style={{ background: c.primary }}>
            {(company?.name || 'ب')[0]}
          </div>
        )
      )
    );

    const CompanyInfo = () => (
      <div>
        <h2 className="text-xl font-bold text-gray-900">{company?.name || 'الشركة'}</h2>
        {company?.tax_number && <p className="text-xs text-gray-500">الرقم الضريبي: {company.tax_number}</p>}
        {company?.commercial_registration && <p className="text-xs text-gray-500">سجل تجاري: {company.commercial_registration}</p>}
        {company?.address && <p className="text-xs text-gray-500">{company.address}</p>}
        {company?.phone && <p className="text-xs text-gray-500" dir="ltr">{company.phone}</p>}
      </div>
    );

    const InvoiceTitle = () => (
      <div className="text-left">
        <h3 className="text-2xl font-bold" style={{ color: c.primary }}>فاتورة ضريبية</h3>
        <p className="text-base text-gray-700 mt-0.5">#{invoice.number}</p>
        <div className="mt-2 text-xs text-gray-500 space-y-0.5">
          <p>التاريخ: {formatDate(invoice.date)}</p>
          {invoice.due_date && <p>الاستحقاق: {formatDate(invoice.due_date)}</p>}
        </div>
      </div>
    );

    switch (tpl.layout) {
      case 'horizontal-header':
        return (
          <div className="flex items-center justify-between p-6" style={{ background: c.bg }}>
            <div className="flex items-center gap-3"><CompanyLogo /><CompanyInfo /></div>
            <InvoiceTitle />
          </div>
        );

      case 'top-banner':
        return (
          <div>
            <div className="px-6 py-3 text-white flex items-center justify-between" style={{ background: c.header }}>
              <span className="text-lg font-bold">فاتورة ضريبية</span>
              <span className="text-sm">#{invoice.number}</span>
            </div>
            <div className="flex items-center justify-between p-6">
              <div className="flex items-center gap-3"><CompanyLogo /><CompanyInfo /></div>
              <div className="text-left text-xs text-gray-500 space-y-0.5">
                <p>التاريخ: {formatDate(invoice.date)}</p>
                {invoice.due_date && <p>الاستحقاق: {formatDate(invoice.due_date)}</p>}
              </div>
            </div>
          </div>
        );

      case 'compact':
        return (
          <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: c.border }}>
            <div className="flex items-center gap-2">
              <CompanyLogo />
              <div><h2 className="text-lg font-bold text-gray-900">{company?.name}</h2></div>
            </div>
            <div className="text-left">
              <h3 className="text-lg font-bold" style={{ color: c.primary }}>فاتورة #{invoice.number}</h3>
              <p className="text-xs text-gray-500">{formatDate(invoice.date)}</p>
            </div>
          </div>
        );

      case 'elegant':
        return (
          <div className="p-6" style={{ background: c.bg }}>
            <div className="flex items-center justify-between mb-4">
              <CompanyLogo />
              <div className="text-left">
                <h3 className="text-3xl font-light tracking-wide" style={{ color: c.primary }}>فاتورة</h3>
                <p className="text-sm text-gray-500">#{invoice.number}</p>
              </div>
            </div>
            <div className="flex items-start justify-between pt-4 border-t" style={{ borderColor: c.border }}>
              <CompanyInfo />
              <div className="text-left text-xs text-gray-500 space-y-0.5">
                <p>التاريخ: {formatDate(invoice.date)}</p>
                {invoice.due_date && <p>الاستحقاق: {formatDate(invoice.due_date)}</p>}
              </div>
            </div>
          </div>
        );

      case 'sidebar':
        return (
          <div className="flex">
            <div className="w-1/3 p-6 text-white" style={{ background: c.header }}>
              <div className="mb-4"><CompanyLogo /></div>
              <CompanyInfo />
              <div className="mt-6 pt-4 border-t border-white/20">
                <h3 className="text-xl font-bold mb-1">فاتورة ضريبية</h3>
                <p className="text-sm opacity-80">#{invoice.number}</p>
                <p className="text-xs opacity-60 mt-2">{formatDate(invoice.date)}</p>
                {invoice.due_date && <p className="text-xs opacity-60">الاستحقاق: {formatDate(invoice.due_date)}</p>}
              </div>
            </div>
            <div className="flex-1 p-6">
              <h4 className="text-sm font-medium text-gray-400 mb-2">فاتورة إلى:</h4>
              {renderClientInfo()}
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  // ====== Render Client Info ======
  const renderClientInfo = () => (
    <div>
      <p className="text-lg font-bold text-gray-900">{invoice.client_name || 'عميل'}</p>
      {settings.showClientTaxNumber && invoice.client_tax_number && <p className="text-xs text-gray-500">الرقم الضريبي: {invoice.client_tax_number}</p>}
      {settings.showClientAddress && invoice.client_address && <p className="text-xs text-gray-500">{invoice.client_address}</p>}
      {settings.showClientPhone && invoice.client_phone && <p className="text-xs text-gray-500" dir="ltr">{invoice.client_phone}</p>}
      {settings.showProject && invoice.project_name && <p className="text-xs text-gray-500 mt-1">المشروع: {invoice.project_name}</p>}
      {settings.showUserName && invoice.created_by_name && <p className="text-xs text-gray-400 mt-1">أعدّها: {invoice.created_by_name}</p>}
    </div>
  );

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-bg-secondary">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-bg-primary no-print flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.back()}><ArrowRight size={20} /></Button>
          <h1 className="text-lg font-bold text-text-primary">فاتورة #{invoice.number}</h1>
          <span className="px-2.5 py-0.5 rounded-full text-xs font-medium text-white" style={{ background: status.color }}>{status.label}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Template selector */}
          <div className="flex items-center gap-0.5 bg-bg-secondary rounded-lg p-0.5">
            {INVOICE_TEMPLATES.map(t => (
              <button key={t.id} onClick={() => setTemplate(t.id)} title={t.description}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${template === t.id ? 'bg-accent text-white shadow-sm' : 'text-text-secondary hover:text-text-primary'}`}>
                {t.name}
              </button>
            ))}
          </div>
          {/* Settings button */}
          <button onClick={() => setShowSettings(!showSettings)} className="p-1.5 rounded-lg bg-bg-secondary text-text-secondary border border-border hover:text-accent" title="إعدادات القالب">
            <Settings size={16} />
          </button>
          <Button variant="ghost" size="sm" onClick={handlePrint} leftIcon={<Printer size={16} />}>طباعة</Button>
          <Button variant="ghost" size="sm" onClick={handlePrint} leftIcon={<FileDown size={16} />}>PDF</Button>
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="px-6 py-3 border-b border-border bg-bg-primary no-print">
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={settings.colorPrint} onChange={e => setSettings({ ...settings, colorPrint: e.target.checked })} /> طباعة بالألوان</label>
            <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={settings.showLogo} onChange={e => setSettings({ ...settings, showLogo: e.target.checked })} /> الشعار</label>
            <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={settings.showUserName} onChange={e => setSettings({ ...settings, showUserName: e.target.checked })} /> اسم المستخدم</label>
            <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={settings.showClientTaxNumber} onChange={e => setSettings({ ...settings, showClientTaxNumber: e.target.checked })} /> رقم ضريبي العميل</label>
            <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={settings.showClientAddress} onChange={e => setSettings({ ...settings, showClientAddress: e.target.checked })} /> عنوان العميل</label>
            <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={settings.showClientPhone} onChange={e => setSettings({ ...settings, showClientPhone: e.target.checked })} /> هاتف العميل</label>
            <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={settings.showProject} onChange={e => setSettings({ ...settings, showProject: e.target.checked })} /> المشروع</label>
            <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={settings.showNotes} onChange={e => setSettings({ ...settings, showNotes: e.target.checked })} /> الملاحظات</label>
            <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={settings.showQR} onChange={e => setSettings({ ...settings, showQR: e.target.checked })} /> QR زاتكا</label>
            <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={settings.showJournalEntry} onChange={e => setSettings({ ...settings, showJournalEntry: e.target.checked })} /> القيد المحاسبي</label>
          </div>
        </div>
      )}

      {/* Invoice Document */}
      <div className="max-w-4xl mx-auto p-6 print-container">
        <div className="bg-white rounded-xl shadow-md overflow-hidden invoice-document"
          style={{ borderTop: tpl.layout !== 'sidebar' ? `3px solid ${c.primary}` : 'none' } as React.CSSProperties}>

          {/* Header (varies by template) */}
          {renderHeader()}

          {/* Client Info (skip for sidebar - already rendered) */}
          {tpl.layout !== 'sidebar' && (
            <div className="px-6 py-4 border-b" style={{ borderColor: c.border }}>
              <h4 className="text-xs font-medium text-gray-400 mb-1">فاتورة إلى:</h4>
              {renderClientInfo()}
            </div>
          )}

          {/* Items Table */}
          <div className="px-6 py-4">
            <table className="w-full">
              <thead>
                <tr style={{ background: c.header }}>
                  <th className="text-right py-2 px-2 text-xs font-bold text-white">#</th>
                  <th className="text-right py-2 px-2 text-xs font-bold text-white">البيان</th>
                  <th className="text-center py-2 px-2 text-xs font-bold text-white">الكمية</th>
                  <th className="text-center py-2 px-2 text-xs font-bold text-white">سعر الوحدة</th>
                  <th className="text-left py-2 px-2 text-xs font-bold text-white">الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                {(invoice.items || []).map((item: any, i: number) => (
                  <tr key={i} className="border-b" style={{ borderColor: c.border }}>
                    <td className="py-2 px-2 text-xs text-gray-500">{i + 1}</td>
                    <td className="py-2 px-2 text-sm text-gray-900 font-medium">{item.description}</td>
                    <td className="py-2 px-2 text-sm text-center text-gray-700">{item.quantity} {item.unit || ''}</td>
                    <td className="py-2 px-2 text-sm text-center text-gray-700">{formatCurrency(parseFloat(item.unit_price), locale, currencySymbol)}</td>
                    <td className="py-2 px-2 text-sm text-left font-bold text-gray-900">{formatCurrency(parseFloat(item.total), locale, currencySymbol)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals + QR */}
          <div className="flex justify-between items-start px-6 py-4 border-t" style={{ borderColor: c.border }}>
            {/* QR */}
            {settings.showQR && (
              <div className="flex flex-col items-center gap-1">
                {zatcaData?.qrData ? (
                  <>
                    <QRCode value={zatcaData.qrData} size={120} />
                    <p className="text-[10px] text-gray-400">رمز زاتكا</p>
                  </>
                ) : (
                  <p className="text-[10px] text-gray-400">QR غير متاح</p>
                )}
              </div>
            )}

            {/* Totals */}
            <div className="w-64 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">المجموع الفرعي</span>
                <span className="font-bold text-gray-900">{formatCurrency(subtotal, locale, currencySymbol)}</span>
              </div>
              {vatAmount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">ضريبة ({vatRate.toFixed(0)}%)</span>
                  <span className="font-bold text-gray-900">{formatCurrency(vatAmount, locale, currencySymbol)}</span>
                </div>
              )}
              {paidAmount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">المدفوع</span>
                  <span className="font-bold text-green-600">{formatCurrency(paidAmount, locale, currencySymbol)}</span>
                </div>
              )}
              {remaining > 0 && invoice.status !== 'paid' && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">المتبقي</span>
                  <span className="font-bold text-red-600">{formatCurrency(remaining, locale, currencySymbol)}</span>
                </div>
              )}
              <div className="flex justify-between pt-2 border-t" style={{ borderColor: c.border }}>
                <span className="text-base font-bold text-gray-900">الإجمالي</span>
                <span className="text-xl font-bold" style={{ color: c.primary }}>{formatCurrency(total, locale, currencySymbol)}</span>
              </div>
            </div>
          </div>

          {/* Notes */}
          {settings.showNotes && invoice.notes && (
            <div className="px-6 py-3 border-t" style={{ borderColor: c.border, background: c.bg }}>
              <p className="text-sm text-gray-600"><strong>ملاحظات:</strong> {invoice.notes}</p>
            </div>
          )}

          {/* Journal Entry */}
          {settings.showJournalEntry && invoice.journal_lines && invoice.journal_lines.length > 0 && (
            <div className="px-6 py-3 border-t no-print" style={{ borderColor: c.border }}>
              <h4 className="text-xs font-bold text-gray-400 mb-2">القيد المحاسبي:</h4>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-400">
                    <th className="text-right p-1">الحساب</th>
                    <th className="text-right p-1">الكود</th>
                    <th className="text-left p-1">مدين</th>
                    <th className="text-left p-1">دائن</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.journal_lines.map((jl: any, i: number) => (
                    <tr key={i} className="text-gray-600">
                      <td className="p-1">{jl.account_name}</td>
                      <td className="p-1 font-mono">{jl.account_code}</td>
                      <td className="p-1 text-left">{parseFloat(jl.debit) > 0 ? formatCurrency(parseFloat(jl.debit), locale, '') : '—'}</td>
                      <td className="p-1 text-left">{parseFloat(jl.credit) > 0 ? formatCurrency(parseFloat(jl.credit), locale, '') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Footer */}
          <div className="px-6 py-4 text-center border-t" style={{ borderColor: c.border, background: c.bg }}>
            <p className="text-xs text-gray-400">{settings.footerText || `هذه الفاتورة صادرة إلكترونياً من ${company?.name || 'النظام'}`}</p>
            {company?.country_code === 'SA' && zatcaData?.hasValidVATNumber && (
              <p className="text-[10px] text-gray-400 mt-1">متوافقة مع هيئة الزكاة والضريبة والجمارك</p>
            )}
          </div>
        </div>
      </div>

      {/* Print CSS */}
      <style jsx global>{`
        @media print {
          body { background: white !important; }
          .no-print { display: none !important; }
          .print-container { padding: 0 !important; max-width: none !important; }
          .invoice-document { box-shadow: none !important; border-radius: 0 !important; }
          @page { margin: 1cm; size: A4; }
        }
      `}</style>
    </div>
  );
}
