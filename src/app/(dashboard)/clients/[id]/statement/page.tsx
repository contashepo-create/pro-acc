'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowRight, Printer, FileDown, AlertTriangle, Eye, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { PrintButton } from '@/components/ui/PrintButton';
import { StatementHeader, SignatureFooter } from '@/components/ui/PrintTemplate';
import { formatDate, formatCurrency } from '@/lib/utils';
import { printCurrentPage } from '@/lib/print';
import { getClientBalanceMeaning } from '@/lib/contact-balance';

export default function ClientStatementPage() {
interface StatementEntry {
  id: string;
  date: string;
  entry_number?: string;
  type?: string;
  description?: string;
  debit: number;
  credit: number;
  balance: number;
  reference_id?: string;
  created_by_name?: string;
}
interface StatementData {
  client: { name: string; phone?: string; address?: string; tax_number?: string; commercial_registration?: string };
  entries: StatementEntry[];
  balance: number;
  total_debit: number;
  total_credit: number;
  pagination?: { total?: number; totalPages?: number };
}

  const params = useParams();
  const router = useRouter();
  const [data, setData] = useState<StatementData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportEntry, setReportEntry] = useState<StatementEntry | null>(null);
  const [reportNote, setReportNote] = useState('');
  const [reportSent, setReportSent] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/clients/${params.id}/statement?page=${page}&pageSize=100`);
        const json = await res.json();
        if (json.success) setData(json.data);
        else setError(json.message || 'فشل تحميل البيانات');
      } catch { setError('خطأ في الاتصال بالخادم'); }
      finally { setLoading(false); }
    };
    fetchData();
  }, [params.id, page]);

  const handlePrint = () => {
    void printCurrentPage();
  };

  const openReport = (entry: StatementEntry) => {
    setReportEntry(entry);
    setReportNote('');
    setReportSent(false);
    setShowReportModal(true);
  };

  const sendReport = async () => {
    if (!reportEntry || !reportNote) return;
    try {
      // Send error report to admin
      const response = await fetch('/api/complaints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: `خطأ في كشف حساب - ${data?.client?.name || ''}`,
          body: `خطأ في القيد رقم ${reportEntry.entry_number} بتاريخ ${reportEntry.date}.\nالوصف: ${reportEntry.description}\nملاحظة المستخدم: ${reportNote}\nنوع العملية: ${reportEntry.type}\nمرجع: ${reportEntry.reference_id || '—'}`,
          type: 'complaint',
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || 'فشل إرسال البلاغ');
      setReportSent(true);
    } catch {
      setError('فشل إرسال البلاغ');
    }
  };

  const toggleRow = (id: string) => {
    setExpandedRows(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const entryTypeLabel: Record<string, string> = {
    invoice: 'فاتورة',
    progress_billing: 'فاتورة مرحلية',
    voucher_receipt: 'سند قبض',
    voucher_receipt_reversal: 'عكس سند قبض',
    voucher_disbursement: 'سند صرف',
    voucher_disbursement_reversal: 'عكس سند صرف',
    invoice_reversal: 'عكس فاتورة',
    project_expense: 'مصروف مشروع',
    project_closure: 'إقفال مشروع',
    quotation_conversion: 'تحويل عرض',
    cash_transaction: 'نقدية',
    journal: 'قيد عام',
    general: 'قيد عام',
  };

  if (loading) return <div className="p-6 text-center text-text-secondary">جاري التحميل...</div>;
  if (error) return <div className="p-6"><div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div></div>;
  if (!data) return null;

  const { client, entries, balance, total_debit, total_credit, pagination } = data;
  const totalEntries = pagination?.total ?? entries.length;
  const totalPages = Math.max(1, pagination?.totalPages ?? 1);
  const closingBalanceMeaning = getClientBalanceMeaning(balance);

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-bg-secondary">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-bg-primary no-print flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.back()}><ArrowRight size={20} /></Button>
          <div>
            <h1 className="text-xl font-bold text-text-primary">كشف حساب: {client.name}</h1>
            <p className="text-sm text-text-secondary">{totalEntries} حركة</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={handlePrint} leftIcon={<Printer size={18} />}>طباعة</Button>
          <Button variant="ghost" onClick={handlePrint} leftIcon={<FileDown size={18} />}>PDF</Button>
        </div>
      </div>

      {/* Statement Document */}
      <div className="max-w-5xl mx-auto p-6 print-container">
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
        <StatementHeader title="كشف حساب عميل" subtitle={client.name} />
          {/* Header */}
          <div className="p-8 border-b border-gray-100 bg-blue-50">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">{client.name}</h2>
                {client.tax_number && <p className="text-sm text-gray-500">الرقم الضريبي: {client.tax_number}</p>}
                {client.commercial_registration && <p className="text-sm text-gray-500">سجل تجاري: {client.commercial_registration}</p>}
                {client.address && <p className="text-sm text-gray-500">{client.address}</p>}
                {client.phone && <p className="text-sm text-gray-500" dir="ltr">{client.phone}</p>}
              </div>
              <div className="text-left">
                <h3 className="text-2xl font-bold text-blue-600">كشف حساب</h3>
                <p className="text-sm text-gray-500 mt-1">بتاريخ: {formatDate(new Date().toISOString())}</p>
              </div>
            </div>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-6">
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
              <p className="text-xs text-gray-500 mb-1">إجمالي مدين</p>
              <p className="text-xl font-bold text-green-700">{formatCurrency(total_debit)}</p>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
              <p className="text-xs text-gray-500 mb-1">إجمالي دائن</p>
              <p className="text-xl font-bold text-red-700">{formatCurrency(total_credit)}</p>
            </div>
            <div className={`border rounded-xl p-4 text-center ${balance >= 0 ? 'bg-blue-50 border-blue-200' : 'bg-orange-50 border-orange-200'}`}>
              <p className="text-xs text-gray-500 mb-1">الرصيد الحالي</p>
              <p className={`text-xl font-bold ${balance >= 0 ? 'text-blue-700' : 'text-orange-700'}`}>{formatCurrency(Math.abs(balance))}</p>
              <p className="text-xs text-gray-500 font-semibold">
                {closingBalanceMeaning.label}
              </p>
            </div>
          </div>

          {/* Transactions Table */}
          <div className="px-8 pb-6">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-800 text-white">
                  <th className="text-right py-2 px-3 text-sm font-bold">التاريخ</th>
                  <th className="text-right py-2 px-3 text-sm font-bold">النوع</th>
                  <th className="text-right py-2 px-3 text-sm font-bold">البيان</th>
                  <th className="text-center py-2 px-3 text-sm font-bold">مدين</th>
                  <th className="text-center py-2 px-3 text-sm font-bold">دائن</th>
                  <th className="text-center py-2 px-3 text-sm font-bold">الرصيد</th>
                  <th className="text-center py-2 px-3 text-sm font-bold no-print">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {entries.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-8 text-gray-400">لا توجد حركات</td></tr>
                ) : (
                  entries.map((entry, i: number) => {
                    const isExpanded = expandedRows[entry.id];
                    return (
                      <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-2 px-3 text-sm text-gray-700">{formatDate(entry.date)}</td>
                        <td className="py-2 px-3 text-sm">
                          <span className={`px-2 py-0.5 rounded text-xs ${
                            entry.type === 'invoice' ? 'bg-blue-100 text-blue-700' :
                            entry.type === 'voucher_receipt' ? 'bg-green-100 text-green-700' :
                            entry.type === 'voucher_disbursement' ? 'bg-red-100 text-red-700' :
                            'bg-gray-100 text-gray-600'
                          }`}>{entryTypeLabel[entry.type ?? ''] || entry.type}</span>
                        </td>
                        <td className="py-2 px-3 text-sm text-gray-900">
                          <span
                            className="flex items-center gap-1 text-right cursor-pointer"
                            onClick={() => toggleRow(entry.id)}
                            role="button"
                            tabIndex={0}
                          >
                            <span>{entry.description}</span>
                            <span className="no-print">
                              {isExpanded ? <ChevronUp size={12} className="text-gray-400" /> : <ChevronDown size={12} className="text-gray-400" />}
                            </span>
                          </span>
                          {isExpanded && (
                            <div className="mt-2 p-2 bg-gray-50 rounded text-xs text-gray-500 space-y-1 no-print">
                              <p>رقم القيد: {entry.entry_number}</p>
                              <p>المرجع: {entry.reference_id || '—'}</p>
                              {entry.created_by_name && <p>أعدّها: {entry.created_by_name}</p>}
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-3 text-sm text-center font-medium text-green-700">{entry.debit > 0 ? formatCurrency(entry.debit) : '—'}</td>
                        <td className="py-2 px-3 text-sm text-center font-medium text-red-700">{entry.credit > 0 ? formatCurrency(entry.credit) : '—'}</td>
                        <td className="py-2 px-3 text-sm text-center font-bold text-gray-900">
                          <div>{formatCurrency(Math.abs(entry.balance))}</div>
                          <div className="text-[10px] font-medium text-gray-500">
                            {getClientBalanceMeaning(entry.balance).shortLabel}
                          </div>
                        </td>
                        <td className="py-2 px-3 text-center no-print">
                          <div className="flex items-center justify-center gap-1">
                            {entry.reference_id && (
                              <button onClick={() => {
                                if (entry.type === 'invoice') window.open(`/invoices/${entry.reference_id}/view`, '_blank');
                                else if (entry.type === 'voucher_receipt') window.open(`/vouchers/receipt`, '_blank');
                                else if (entry.type === 'voucher_disbursement') window.open(`/vouchers/disbursement`, '_blank');
                              }} className="p-1 rounded hover:bg-blue-50 text-blue-600" title="عرض العملية">
                                <Eye size={14} />
                              </button>
                            )}
                            <button onClick={() => openReport(entry)} className="p-1 rounded hover:bg-orange-50 text-orange-600" title="إبلاغ عن خطأ">
                              <AlertTriangle size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {entries.length > 0 && (
                <tfoot>
                  <tr className="bg-gray-100 font-bold">
                    <td colSpan={3} className="py-3 px-3 text-right text-gray-800">الإجمالي</td>
                    <td className="py-3 px-3 text-center text-green-700">{formatCurrency(total_debit)}</td>
                    <td className="py-3 px-3 text-center text-red-700">{formatCurrency(total_credit)}</td>
                    <td className="py-3 px-3 text-center text-gray-900">
                      <div>{formatCurrency(Math.abs(balance))}</div>
                      <div className="text-[10px] font-medium text-gray-600">
                        {closingBalanceMeaning.shortLabel}
                      </div>
                    </td>
                    <td className="no-print"></td>
                  </tr>
                </tfoot>
              )}
            </table>
            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between gap-3 no-print">
                <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
                  الصفحة السابقة
                </Button>
                <span className="text-sm text-gray-500">صفحة {page} من {totalPages}</span>
                <Button variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>
                  الصفحة التالية
                </Button>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-8 py-6 text-center border-t border-gray-100">
            <p className="text-sm text-gray-400">تم إنشاء هذا الكشف إلكترونياً</p>
          </div>
        </div>
      </div>

      {/* Error Report Modal */}
      {showReportModal && reportEntry && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 no-print" onClick={() => setShowReportModal(false)}>
          <div className="bg-white rounded-2xl max-w-md w-full" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 p-4 border-b border-gray-200">
              <AlertTriangle size={20} className="text-orange-500" />
              <h3 className="font-bold text-gray-900">إبلاغ عن خطأ</h3>
            </div>
            <div className="p-4 space-y-3">
              <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
                <p><span className="text-gray-500">التاريخ:</span> {formatDate(reportEntry.date)}</p>
                <p><span className="text-gray-500">رقم القيد:</span> {reportEntry.entry_number}</p>
                <p><span className="text-gray-500">البيان:</span> {reportEntry.description}</p>
                <p><span className="text-gray-500">مدين:</span> {reportEntry.debit > 0 ? formatCurrency(reportEntry.debit) : '—'}</p>
                <p><span className="text-gray-500">دائن:</span> {reportEntry.credit > 0 ? formatCurrency(reportEntry.credit) : '—'}</p>
              </div>
              <textarea
                className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:outline-none focus:border-orange-500"
                rows={4}
                placeholder="اشرح الخطأ الذي وجدته..."
                value={reportNote}
                onChange={e => setReportNote(e.target.value)}
              />
              {reportSent ? (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700 text-center">
                  ✅ تم إرسال البلاغ إلى الإدارة. سيتم مراجعته والرد عليك.
                </div>
              ) : null}
              <div className="flex gap-2">
                <button onClick={() => setShowReportModal(false)} className="flex-1 py-2.5 bg-gray-100 text-gray-700 rounded-lg text-sm">إغلاق</button>
                {!reportSent && (
                  <button onClick={sendReport} disabled={!reportNote} className="flex-1 py-2.5 bg-orange-600 text-white rounded-lg text-sm disabled:opacity-50">إرسال البلاغ</button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Print CSS */}
      <style jsx global>{`
        @media print {
          body { background: white !important; }
          .no-print { display: none !important; }
          .print-container { padding: 0 !important; max-width: none !important; margin: 0 !important; }
          .print-container > div {
            box-shadow: none !important;
            border-radius: 0 !important;
            border: none !important;
            overflow: visible !important;
          }
          .print-container * {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          /* تثبيت رأس الجدول على كل صفحة ومنع انقسام الصفوف/البطاقات */
          thead { display: table-header-group; }
          tfoot { display: table-footer-group; }
          .print-container tr { break-inside: avoid; page-break-inside: avoid; }
          .print-container .grid { break-inside: avoid; page-break-inside: avoid; }
          .print-container td, .print-container th {
            border: 1px solid #d1d5db !important;
          }
          @page { margin: 1.2cm; size: A4; }
        }
      `}</style>
    <SignatureFooter /><PrintButton /></div>
  );
}
