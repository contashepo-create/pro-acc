'use client';

import { useState, useEffect } from 'react';

interface PortalInvoice {
  id: string;
  number: number;
  date: string;
  due_date: string;
  total: number;
  status: string;
  zatca_qr: string | null;
  items: Array<{ description: string; quantity: number; unit_price: number; total: number }>;
}

export default function CustomerPortalPage() {
  const [invoices, setInvoices] = useState<PortalInvoice[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<PortalInvoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');

  // Get portal token from URL or ask for email
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const portalToken = urlParams.get('token');
    if (portalToken) {
      setToken(portalToken);
      setAuthenticated(true);
      fetchInvoices(portalToken);
    } else {
      setLoading(false);
    }
  }, []);

  const handleLogin = async () => {
    if (!email) return;
    try {
      const res = await fetch('/api/portal/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (data.success) {
        setToken(data.data.token);
        setAuthenticated(true);
        fetchInvoices(data.data.token);
      } else {
        setError(data.message || 'فشل تسجيل الدخول');
      }
    } catch {
      setError('خطأ في الاتصال');
    }
  };

  const fetchInvoices = async (authToken: string) => {
    try {
      const res = await fetch('/api/portal/invoices', {
        headers: { 'X-Portal-Token': authToken },
      });
      const data = await res.json();
      if (data.success) {
        setInvoices(data.data.invoices);
      }
    } catch {
      setError('خطأ في تحميل الفواتير');
    } finally {
      setLoading(false);
    }
  };

  const fetchInvoiceDetails = async (invoiceId: string) => {
    try {
      const res = await fetch(`/api/portal/invoices/${invoiceId}`, {
        headers: { 'X-Portal-Token': token },
      });
      const data = await res.json();
      if (data.success) {
        setSelectedInvoice(data.data);
      }
    } catch {
      setError('خطأ في تحميل تفاصيل الفاتورة');
    }
  };

  // Login screen
  if (!authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-slate-100 p-4" dir="rtl">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-8">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">بوابة العملاء</h1>
            <p className="text-gray-500 mt-2">أدخل بريدك الإلكتروني للوصول لفواتيرك</p>
          </div>
          {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg mb-4 text-sm">{error}</div>}
          <div className="space-y-4">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="البريد الإلكتروني"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              dir="ltr"
            />
            <button
              onClick={handleLogin}
              disabled={!email}
              className="w-full py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 font-medium transition-colors"
            >
              دخول
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" dir="rtl">
        <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  const totalUnpaid = invoices.filter(i => i.status !== 'paid').reduce((sum, i) => sum + parseFloat(String(i.total)), 0);

  return (
    <div className="min-h-screen bg-gray-50" dir="rtl">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-gray-900">فواتيري</h1>
          </div>
          <button onClick={() => { setAuthenticated(false); setToken(''); }} className="text-sm text-gray-500 hover:text-gray-700">
            خروج
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-white rounded-xl p-5 shadow-sm">
            <p className="text-sm text-gray-500">إجمالي الفواتير</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{invoices.length}</p>
          </div>
          <div className="bg-white rounded-xl p-5 shadow-sm">
            <p className="text-sm text-gray-500">المستحق</p>
            <p className="text-2xl font-bold text-orange-600 mt-1">{totalUnpaid.toFixed(2)} <span className="text-sm">ر.س</span></p>
          </div>
          <div className="bg-white rounded-xl p-5 shadow-sm">
            <p className="text-sm text-gray-500">المدفوعة</p>
            <p className="text-2xl font-bold text-green-600 mt-1">{invoices.filter(i => i.status === 'paid').length}</p>
          </div>
        </div>

        {/* Invoice Detail Modal */}
        {selectedInvoice && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setSelectedInvoice(null)}>
            <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h2 className="text-xl font-bold">فاتورة رقم #{selectedInvoice.number}</h2>
                  <p className="text-gray-500 text-sm mt-1">التاريخ: {new Date(selectedInvoice.date).toLocaleDateString('ar-SA')}</p>
                </div>
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                  selectedInvoice.status === 'paid' ? 'bg-green-100 text-green-700' :
                  selectedInvoice.status === 'partial' ? 'bg-yellow-100 text-yellow-700' :
                  'bg-red-100 text-red-700'
                }`}>
                  {selectedInvoice.status === 'paid' ? 'مدفوعة' : selectedInvoice.status === 'partial' ? 'جزئية' : 'غير مدفوعة'}
                </span>
              </div>

              {/* Items Table */}
              <table className="w-full mb-6">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-right p-3 text-sm font-medium text-gray-600">الوصف</th>
                    <th className="text-center p-3 text-sm font-medium text-gray-600">الكمية</th>
                    <th className="text-center p-3 text-sm font-medium text-gray-600">السعر</th>
                    <th className="text-left p-3 text-sm font-medium text-gray-600">الإجمالي</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedInvoice.items.map((item, idx) => (
                    <tr key={idx} className="border-b">
                      <td className="p-3">{item.description}</td>
                      <td className="p-3 text-center">{item.quantity}</td>
                      <td className="p-3 text-center">{parseFloat(String(item.unit_price)).toFixed(2)}</td>
                      <td className="p-3 text-left font-medium">{parseFloat(String(item.total)).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Total */}
              <div className="bg-blue-50 rounded-xl p-4 flex justify-between items-center">
                <span className="font-bold text-lg">الإجمالي</span>
                <span className="font-bold text-2xl text-blue-700">{parseFloat(String(selectedInvoice.total)).toFixed(2)} ر.س</span>
              </div>

              {/* ZATCA QR */}
              {selectedInvoice.zatca_qr && (
                <div className="mt-6 text-center">
                  <p className="text-sm text-gray-500 mb-2">رمز ZATCA</p>
                  <div className="inline-block bg-white p-3 rounded-lg border">
                    <div className="w-32 h-32 bg-gray-100 flex items-center justify-center text-xs text-gray-400">
                      QR Code
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-6 flex gap-3">
                <button className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-medium">
                  تحميل PDF
                </button>
                <button onClick={() => setSelectedInvoice(null)} className="flex-1 py-2.5 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 font-medium">
                  إغلاق
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Invoices List */}
        {invoices.length === 0 ? (
          <div className="bg-white rounded-xl p-12 text-center">
            <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-gray-500">لا توجد فواتير</p>
          </div>
        ) : (
          <div className="space-y-3">
            {invoices.map(inv => (
              <div
                key={inv.id}
                onClick={() => fetchInvoiceDetails(inv.id)}
                className="bg-white rounded-xl p-5 shadow-sm hover:shadow-md cursor-pointer transition-shadow"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-bold text-gray-900">فاتورة #{inv.number}</p>
                    <p className="text-sm text-gray-500 mt-1">
                      {new Date(inv.date).toLocaleDateString('ar-SA')} • 
                      استحقاق: {new Date(inv.due_date).toLocaleDateString('ar-SA')}
                    </p>
                  </div>
                  <div className="text-left">
                    <p className="font-bold text-lg">{parseFloat(String(inv.total)).toFixed(2)} <span className="text-sm text-gray-500">ر.س</span></p>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      inv.status === 'paid' ? 'bg-green-100 text-green-700' :
                      inv.status === 'partial' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      {inv.status === 'paid' ? 'مدفوعة' : inv.status === 'partial' ? 'جزئية' : 'مستحقة'}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
