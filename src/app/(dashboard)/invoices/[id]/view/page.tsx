'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowRight, Printer, FileDown, Palette } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { QRCode } from '@/components/ui/QRCode';
import { formatDate, formatCurrency } from '@/lib/utils';

const TEMPLATES = [
  { id: 'modern', name: 'عصري', colors: { primary: '#2563eb', bg: '#f0f4ff', border: '#dbeafe' } },
  { id: 'classic', name: 'كلاسيكي', colors: { primary: '#1e293b', bg: '#f8fafc', border: '#e2e8f0' } },
  { id: 'minimal', name: 'بسيط', colors: { primary: '#059669', bg: '#ecfdf5', border: '#d1fae5' } },
  { id: 'elegant', name: 'أنيق', colors: { primary: '#7c3aed', bg: '#f5f3ff', border: '#ede9fe' } },
  { id: 'professional', name: 'احترافي', colors: { primary: '#dc2626', bg: '#fef2f2', border: '#fecaca' } },
];

export default function InvoiceViewPage() {
  const params = useParams();
  const router = useRouter();
  const printRef = useRef<HTMLDivElement>(null);
  const [invoice, setInvoice] = useState<any>(null);
  const [company, setCompany] = useState<any>(null);
  const [zatcaData, setZatcaData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [template, setTemplate] = useState('modern');
  const [colorPrint, setColorPrint] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showUserName, setShowUserName] = useState(true);

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
      } catch { setError('خطأ في الاتصال بالخادم'); }
      finally { setLoading(false); }
    };
    fetchData();
  }, [params.id]);

  const handlePrint = () => window.print();

  const handleExportPDF = () => {
    window.print();
  };

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
  const tpl = TEMPLATES.find(t => t.id === template) || TEMPLATES[0];
  const primaryColor = colorPrint ? tpl.colors.primary : '#000000';
  const bgColor = colorPrint ? tpl.colors.bg : '#ffffff';
  const borderColor = colorPrint ? tpl.colors.border : '#cccccc';

  const statusMap: Record<string, { label: string; color: string }> = {
    unpaid: { label: 'غير مدفوعة', color: '#f59e0b' },
    partial: { label: 'مدفوعة جزئياً', color: '#3b82f6' },
    paid: { label: 'مدفوعة', color: '#22c55e' },
    cancelled: { label: 'ملغاة', color: '#ef4444' },
  };
  const status = statusMap[invoice.status] || { label: invoice.status, color: '#999' };

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-bg-secondary">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-bg-primary no-print flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.back()}><ArrowRight size={20} /></Button>
          <h1 className="text-xl font-bold text-text-primary">فاتورة #{invoice.number}</h1>
          <span className="px-3 py-1 rounded-full text-sm font-medium text-white" style={{ backgroundColor: status.color }}>{status.label}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Template selector */}
          <div className="flex items-center gap-1 bg-bg-secondary rounded-lg p-1">
            {TEMPLATES.map(t => (
              <button key={t.id} onClick={() => setTemplate(t.id)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${template === t.id ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'}`}>
                {t.name}
              </button>
            ))}
          </div>
          {/* Color toggle */}
          <button onClick={() => setColorPrint(!colorPrint)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${colorPrint ? 'bg-accent/10 text-accent border-accent/30' : 'bg-bg-secondary text-text-secondary border-border'}`}>
            {colorPrint ? 'ألوان' : 'أبيض/أسود'}
          </button>
          {/* Print */}
          <Button variant="ghost" onClick={handlePrint} leftIcon={<Printer size={18} />}>طباعة</Button>
          <Button variant="ghost" onClick={handleExportPDF} leftIcon={<FileDown size={18} />}>PDF</Button>
        </div>
      </div>

      {/* Invoice Document */}
      <div className="max-w-4xl mx-auto p-6 print-container" ref={printRef}>
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden invoice-document"
          style={{ borderTop: `4px solid ${primaryColor}` } as React.CSSProperties}>

          {/* Header */}
          <div className="flex items-start justify-between p-8" style={{ background: bgColor } as React.CSSProperties}>
            <div className="flex items-center gap-4">
              {company?.logo_url ? (
                <img src={company.logo_url} alt={company.name} className="w-20 h-20 rounded-xl object-cover" style={{ border: `2px solid ${borderColor}` }} />
              ) : (
                <div className="w-20 h-20 rounded-xl flex items-center justify-center" style={{ background: primaryColor } as React.CSSProperties}>
                  <span className="text-3xl font-bold text-white">{(company?.name || 'ب')[0]}</span>
                </div>
              )}
              <div>
                <h2 className="text-2xl font-bold text-gray-900">{company?.name || 'الشركة'}</h2>
                {company?.tax_number && <p className="text-sm text-gray-500">الرقم الضريبي: {company.tax_number}</p>}
                {company?.commercial_registration && <p className="text-sm text-gray-500">سجل تجاري: {company.commercial_registration}</p>}
                {company?.address && <p className="text-sm text-gray-500">{company.address}</p>}
                {company?.phone && <p className="text-sm text-gray-500" dir="ltr">{company.phone}</p>}
                {company?.email && <p className="text-sm text-gray-500" dir="ltr">{company.email}</p>}
              </div>
            </div>
            <div className="text-left">
              <h3 className="text-3xl font-bold" style={{ color: primaryColor } as React.CSSProperties}>فاتورة ضريبية</h3>
              <p className="text-lg text-gray-700 mt-1">#{invoice.number}</p>
              <div className="mt-3 space-y-1 text-sm text-gray-500">
                <p>التاريخ: {formatDate(invoice.date)}</p>
                {invoice.due_date && <p>الاستحقاق: {formatDate(invoice.due_date)}</p>}
              </div>
            </div>
          </div>

          {/* Client Info */}
          <div className="px-8 py-6 border-b" style={{ borderColor: borderColor } as React.CSSProperties}>
            <h4 className="text-sm font-medium text-gray-400 mb-2">فاتورة إلى:</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-lg font-bold text-gray-900">{invoice.client_name || 'عميل'}</p>
                {invoice.client_tax_number && <p className="text-sm text-gray-500">الرقم الضريبي: {invoice.client_tax_number}</p>}
                {invoice.client_commercial_registration && <p className="text-sm text-gray-500">سجل تجاري: {invoice.client_commercial_registration}</p>}
                {invoice.client_address && <p className="text-sm text-gray-500">{invoice.client_address}</p>}
                {invoice.client_phone && <p className="text-sm text-gray-500" dir="ltr">{invoice.client_phone}</p>}
              </div>
              <div className="text-left">
                {invoice.project_name && <p className="text-sm text-gray-500"><strong>المشروع:</strong> {invoice.project_name}</p>}
                {showUserName && invoice.created_by_name && <p className="text-sm text-gray-500"><strong>أعدّها:</strong> {invoice.created_by_name}</p>}
                <p className="text-sm text-gray-500"><strong>طُبعت:</strong> {formatDate(new Date().toISOString())}</p>
              </div>
            </div>
          </div>

          {/* Items Table */}
          <div className="px-8 py-6">
            <table className="w-full">
              <thead>
                <tr style={{ background: primaryColor } as React.CSSProperties}>
                  <th className="text-right py-3 px-3 text-sm font-bold text-white rounded-r-lg">#</th>
                  <th className="text-right py-3 px-3 text-sm font-bold text-white">البيان</th>
                  <th className="text-center py-3 px-3 text-sm font-bold text-white">الكمية</th>
                  <th className="text-center py-3 px-3 text-sm font-bold text-white">الوحدة</th>
                  <th className="text-center py-3 px-3 text-sm font-bold text-white">سعر الوحدة</th>
                  <th className="text-left py-3 px-3 text-sm font-bold text-white rounded-l-lg">الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                {(invoice.items || []).map((item: any, i: number) => (
                  <tr key={i} className="border-b" style={{ borderColor: borderColor } as React.CSSProperties}>
                    <td className="py-3 px-3 text-sm text-gray-500">{i + 1}</td>
                    <td className="py-3 px-3 text-sm text-gray-900 font-medium">{item.description}</td>
                    <td className="py-3 px-3 text-sm text-center text-gray-700">{item.quantity}</td>
                    <td className="py-3 px-3 text-sm text-center text-gray-500">{item.unit || ''}</td>
                    <td className="py-3 px-3 text-sm text-center text-gray-700">{formatCurrency(parseFloat(item.unit_price), locale, currencySymbol)}</td>
                    <td className="py-3 px-3 text-sm text-left font-bold text-gray-900">{formatCurrency(parseFloat(item.total), locale, currencySymbol)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals + QR */}
          <div className="flex justify-between items-start px-8 py-6 border-t" style={{ borderColor: borderColor } as React.CSSProperties}>
            {/* QR Code */}
            <div className="flex flex-col items-center gap-2">
              {zatcaData?.qrData ? (
                <>
                  <QRCode value={zatcaData.qrData} size={140} />
                  <p className="text-xs text-gray-400">رمز زاتكا (QR)</p>
                </>
              ) : (
                <p className="text-xs text-gray-400">الرقم الضريبي غير مكتمل لزاتكا</p>
              )}
            </div>

            {/* Totals */}
            <div className="w-80 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">المجموع الفرعي</span>
                <span className="font-bold text-gray-900">{formatCurrency(subtotal, locale, currencySymbol)}</span>
              </div>
              {vatAmount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">ضريبة القيمة المضافة ({vatRate.toFixed(0)}%)</span>
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
              <div className="flex justify-between pt-3 border-t-2" style={{ borderColor: borderColor } as React.CSSProperties}>
                <span className="text-lg font-bold text-gray-900">الإجمالي</span>
                <span className="text-2xl font-bold" style={{ color: primaryColor } as React.CSSProperties}>{formatCurrency(total, locale, currencySymbol)}</span>
              </div>
            </div>
          </div>

          {/* Notes */}
          {invoice.notes && (
            <div className="px-8 py-4 border-t" style={{ borderColor: borderColor, background: bgColor } as React.CSSProperties}>
              <p className="text-sm text-gray-600"><strong>ملاحظات:</strong> {invoice.notes}</p>
            </div>
          )}

          {/* Journal Entry Summary */}
          {invoice.journal_lines && invoice.journal_lines.length > 0 && (
            <div className="px-8 py-4 border-t no-print" style={{ borderColor: borderColor } as React.CSSProperties}>
              <h4 className="text-xs font-bold text-gray-400 mb-2">القيد المحاسبي:</h4>
              <div className="overflow-x-auto">
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
            </div>
          )}

          {/* Footer */}
          <div className="px-8 py-6 text-center border-t" style={{ borderColor: borderColor, background: bgColor } as React.CSSProperties}>
            <p className="text-sm text-gray-400">هذه الفاتورة صادرة إلكترونياً من {company?.name || 'النظام'}</p>
            {showUserName && invoice.created_by_name && <p className="text-xs text-gray-400 mt-1">أعدّها: {invoice.created_by_name}</p>}
            {company?.country_code === 'SA' && zatcaData?.hasValidVATNumber && (
              <p className="text-xs text-gray-400 mt-1">متوافقة مع متطلبات هيئة الزكاة والضريبة والجمارك</p>
            )}
          </div>
        </div>
      </div>

      {/* Print-only styles */}
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
