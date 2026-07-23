'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowRight, Printer, Download } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { QRCode } from '@/components/ui/QRCode';
import { formatDate, formatCurrency } from '@/lib/utils';

export default function InvoiceViewPage() {
  const params = useParams();
  const router = useRouter();
  const [invoice, setInvoice] = useState<any>(null);
  const [company, setCompany] = useState<any>(null);
  const [zatcaData, setZatcaData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [invRes, zatcaRes] = await Promise.all([
          fetch(`/api/invoices/${params.id}`),
          fetch(`/api/invoices/${params.id}/zatca`),
        ]);
        const [invJson, zatcaJson] = await Promise.all([
          invRes.json(),
          zatcaRes.json(),
        ]);

        if (invJson.success) {
          setInvoice(invJson.data);
          setCompany(invJson.data?.company || {});
        } else {
          setError(invJson.message || 'فشل تحميل الفاتورة');
        }

        if (zatcaJson.success) {
          setZatcaData(zatcaJson.data);
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

  if (loading) return <div className="p-6 text-center text-text-secondary">جاري التحميل...</div>;
  if (error) return <div className="p-6"><div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div></div>;
  if (!invoice) return null;

  const vatRate = parseFloat(invoice.tax_rate || invoice.vat_rate || 0);
  const vatAmount = parseFloat(invoice.tax_amount || invoice.vat_amount || 0);
  const subtotal = parseFloat(invoice.subtotal || 0);
  const total = parseFloat(invoice.total || 0);
  const currencySymbol = company?.currency_symbol || 'ر.س';
  const locale = company?.locale || 'ar-SA';

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
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-bg-primary no-print">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.back()}>
            <ArrowRight size={20} />
          </Button>
          <h1 className="text-xl font-bold text-text-primary">فاتورة #{invoice.number}</h1>
          <span className="px-3 py-1 rounded-full text-sm font-medium text-white" style={{ backgroundColor: status.color }}>
            {status.label}
          </span>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={handlePrint} leftIcon={<Printer size={18} />}>
            طباعة
          </Button>
        </div>
      </div>

      {/* Invoice Document */}
      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
          {/* Header */}
          <div className="flex items-start justify-between p-8 border-b border-gray-100">
            <div className="flex items-center gap-4">
              {company?.logo_url ? (
                <img src={company.logo_url} alt={company.name} className="w-16 h-16 rounded-lg object-cover" />
              ) : (
                <div className="w-16 h-16 rounded-lg bg-accent flex items-center justify-center">
                  <span className="text-2xl font-bold text-white">{(company?.name || 'ب')[0]}</span>
                </div>
              )}
              <div>
                <h2 className="text-2xl font-bold text-gray-900">{company?.name || 'الشركة'}</h2>
                {company?.tax_number && <p className="text-sm text-gray-500">الرقم الضريبي: {company.tax_number}</p>}
                {company?.address && <p className="text-sm text-gray-500">{company.address}</p>}
                {company?.phone && <p className="text-sm text-gray-500">{company.phone}</p>}
              </div>
            </div>
            <div className="text-left">
              <h3 className="text-3xl font-bold text-accent">فاتورة ضريبية</h3>
              <p className="text-lg text-gray-700 mt-1">#{invoice.number}</p>
              <div className="mt-3 space-y-1 text-sm text-gray-500">
                <p>التاريخ: {formatDate(invoice.date)}</p>
                {invoice.due_date && <p>الاستحقاق: {formatDate(invoice.due_date)}</p>}
              </div>
            </div>
          </div>

          {/* Client Info */}
          <div className="px-8 py-6 border-b border-gray-100 bg-gray-50">
            <h4 className="text-sm font-medium text-gray-500 mb-2">فاتورة إلى:</h4>
            <p className="text-lg font-bold text-gray-900">{invoice.contact_name || invoice.client_name || 'عميل'}</p>
            {invoice.contact_tax_number && <p className="text-sm text-gray-500">الرقم الضريبي: {invoice.contact_tax_number}</p>}
            {invoice.project_name && <p className="text-sm text-gray-500">المشروع: {invoice.project_name}</p>}
          </div>

          {/* Items Table */}
          <div className="px-8 py-6">
            <table className="w-full">
              <thead>
                <tr className="border-b-2 border-gray-200">
                  <th className="text-right py-3 px-2 text-sm font-bold text-gray-600">#</th>
                  <th className="text-right py-3 px-2 text-sm font-bold text-gray-600">البيان</th>
                  <th className="text-center py-3 px-2 text-sm font-bold text-gray-600">الكمية</th>
                  <th className="text-center py-3 px-2 text-sm font-bold text-gray-600">سعر الوحدة</th>
                  <th className="text-left py-3 px-2 text-sm font-bold text-gray-600">الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                {(invoice.items || []).map((item: any, i: number) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="py-3 px-2 text-sm text-gray-500">{i + 1}</td>
                    <td className="py-3 px-2 text-sm text-gray-900 font-medium">{item.description}
                      {item.barcode && (
                        <div className="mt-1 text-xs text-gray-400">باركود: {item.barcode}</div>
                      )}
                    </td>
                    <td className="py-3 px-2 text-sm text-center text-gray-700">{item.quantity} {item.unit || ''}</td>
                    <td className="py-3 px-2 text-sm text-center text-gray-700">{formatCurrency(parseFloat(item.unit_price), locale, currencySymbol)}</td>
                    <td className="py-3 px-2 text-sm text-left font-bold text-gray-900">{formatCurrency(parseFloat(item.total), locale, currencySymbol)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals + QR */}
          <div className="flex justify-between items-start px-8 py-6 border-t border-gray-100">
            {/* QR Code */}
            <div className="flex flex-col items-center gap-2">
              {zatcaData?.qrData && (
                <>
                  <QRCode value={zatcaData.qrData} size={140} />
                  <p className="text-xs text-gray-400">رمز زاتكا (QR)</p>
                </>
              )}
              {zatcaData && !zatcaData.hasValidVATNumber && (
                <p className="text-xs text-gray-400">الرقم الضريبي غير مكتمل</p>
              )}
            </div>

            {/* Totals */}
            <div className="w-72 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">المجموع الفرعي</span>
                <span className="font-bold text-gray-900">{formatCurrency(subtotal, locale, currencySymbol)}</span>
              </div>
              {vatAmount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">ضريبة القيمة المضافة ({(vatRate * 100).toFixed(0)}%)</span>
                  <span className="font-bold text-gray-900">{formatCurrency(vatAmount, locale, currencySymbol)}</span>
                </div>
              )}
              {invoice.paid_amount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">المدفوع</span>
                  <span className="font-bold text-green-600">{formatCurrency(parseFloat(invoice.paid_amount), locale, currencySymbol)}</span>
                </div>
              )}
              <div className="flex justify-between pt-3 border-t-2 border-gray-200">
                <span className="text-lg font-bold text-gray-900">الإجمالي</span>
                <span className="text-2xl font-bold text-accent">{formatCurrency(total, locale, currencySymbol)}</span>
              </div>
            </div>
          </div>

          {/* Notes */}
          {invoice.notes && (
            <div className="px-8 py-4 border-t border-gray-100 bg-gray-50">
              <p className="text-sm text-gray-500"><strong>ملاحظات:</strong> {invoice.notes}</p>
            </div>
          )}

          {/* Footer */}
          <div className="px-8 py-6 text-center border-t border-gray-100">
            <p className="text-sm text-gray-400">هذه الفاتورة صادرة إلكترونياً من {company?.name || 'النظام'}</p>
            {company?.country_code === 'SA' && zatcaData?.hasValidVATNumber && (
              <p className="text-xs text-gray-400 mt-1">متوافقة مع متطلبات هيئة الزكاة والضريبة والجمارك</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
