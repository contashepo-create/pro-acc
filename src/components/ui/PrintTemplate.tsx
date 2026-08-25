'use client';

import { useEffect, useState } from 'react';

export interface PrintColumn<T> {
  key: string;
  label: string;
  render?: (row: T) => React.ReactNode;
  align?: 'start' | 'center' | 'end';
}

interface Props<T> {
  title: string;
  subtitle?: string;
  rows: T[];
  columns: PrintColumn<T>[];
  footerTotals?: Array<{ label: string; value: string }>;
  extraInfo?: Array<{ label: string; value: string }>;
}

/** Unified professional print/document shell used by every statement.
 *  NOTE: intentionally NOT used by invoice view, which has its own
 *  dedicated templates and settings. */
export function PrintTemplate<T>({ title, subtitle, rows, columns, footerTotals, extraInfo }: Props<T>) {
  const [company, setCompany] = useState<{ name?: string; tax_number?: string; phone?: string; logo_url?: string; address?: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/company/logo');
        const json = await res.json();
        if (json.success) setCompany(json.data?.company || json.data || null);
      } catch { /* header degrades gracefully */ }
    })();
  }, []);

  return (
    <div className="bg-white text-black min-h-screen p-6" dir="rtl">
      <header className="flex items-start justify-between border-b-2 border-black pb-3 mb-4">
        <div>
          <h1 className="text-2xl font-extrabold">{company?.name || 'شركة'}</h1>
          {company?.address && <p className="text-xs mt-1">{company.address}</p>}
          <p className="text-xs mt-0.5">
            {company?.tax_number ? `الرقم الضريبي: ${company.tax_number}` : ''}
            {company?.phone ? ` — هاتف: ${company.phone}` : ''}
          </p>
        </div>
        <div className="text-left">
          <div className="border border-black rounded px-3 py-1 font-bold">{title}</div>
          {subtitle && <p className="text-xs mt-1">{subtitle}</p>}
          <p className="text-[10px] mt-1">تاريخ الطباعة: {new Date().toLocaleDateString('ar-SA')}</p>
        </div>
      </header>

      {extraInfo && extraInfo.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4 text-sm">
          {extraInfo.map((i) => (
            <div key={i.label} className="border border-gray-300 rounded p-2">
              <div className="text-[10px] text-gray-600">{i.label}</div>
              <div className="font-bold" dir="auto">{i.value}</div>
            </div>
          ))}
        </div>
      )}

      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-100">
            {columns.map((c) => (
              <th key={c.key} className={`border border-gray-400 px-2 py-1.5 text-${c.align || 'start'} font-bold`}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={columns.length} className="border border-gray-300 px-2 py-4 text-center text-gray-500">لا توجد حركات في الفترة</td></tr>
          )}
          {rows.map((row, i) => (
            <tr key={i} className="break-inside-avoid">
              {columns.map((c) => (
                <td key={c.key} className={`border border-gray-300 px-2 py-1 text-${c.align || 'start'}`}>
                  {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {footerTotals && footerTotals.length > 0 && (
        <div className="flex justify-end gap-4 mt-3">
          {footerTotals.map((t) => (
            <div key={t.label} className="border-t-2 border-black pt-1 min-w-40">
              <span className="text-xs text-gray-600">{t.label}: </span>
              <span className="font-bold">{t.value}</span>
            </div>
          ))}
        </div>
      )}

      <footer className="mt-10 grid grid-cols-3 gap-4 text-center text-xs">
        <div className="border-t border-black pt-1">المحاسب</div>
        <div className="border-t border-black pt-1">المدير المالي</div>
        <div className="border-t border-black pt-1">الختم والتوقيع</div>
      </footer>

      {/* Screen-only toolbar */}
      <div className="no-print fixed bottom-4 left-4 flex gap-2">
        <button onClick={() => window.print()} className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm shadow">🖨️ طباعة / PDF</button>
        <button onClick={() => history.back()} className="bg-gray-200 rounded-lg px-4 py-2 text-sm">رجوع</button>
      </div>
    </div>
  );
}
